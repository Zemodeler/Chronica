// Complete, uncached CLI turn against the public scenario seed. No saved game is changed.
// node --env-file=apps/web/.env.local --import tsx scripts/benchmark-turn.mts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { createWindowWriter, orderOutcomeLines, runSimulationBurst, type SimModelPort } from "@chronica/sim";
import { answerWithHandCodex } from "../packages/ai/src/adapters/hand-codex";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1] ?? fallback;
};
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
let world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const player = option("--as", "gaius-genucius");
const actorRef = { kind: "character" as const, id: player };
const actorPolityId = world.characters.find((person) => person.id === player)?.polityId ?? null;
const out = path.resolve("eval-out/hand-speed", `turn-${Date.now()}`);
mkdirSync(out, { recursive: true });
let calls: { operation: string; seconds: number; actors?: number; promptChars: number }[] = [];
let number = 0;
let started = performance.now();
const port: SimModelPort = {
  async complete(operation, system, asked) {
    const id = ++number;
    const at = performance.now();
    console.log(JSON.stringify({ started: operation, call: id, elapsed: +((at - started) / 1000).toFixed(1) }));
    const result = await answerWithHandCodex(system, asked, path.join(out, `call-${id}.json`), { operation });
    const actors = operation === "simulate_cognition" ? (asked.match(/^Today is /gm) ?? []).length : undefined;
    writeFileSync(path.join(out, `call-${id}-${operation}.txt`), `${asked.slice(0, 600)}
----
${result}`);
    calls.push({ operation, seconds: +((performance.now() - at) / 1000).toFixed(2), ...(actors === undefined ? {} : { actors }), promptChars: asked.length });
    return result;
  },
};
const turns = Number(option("--turns", "1"));
const orders = ["Recruit two more cohorts and drill them.", "Send word to our allies and ask what they will commit.", "Inspect the grain stores and the walls."];
const summaries: { seconds: number }[] = [];
for (let turn = 0; turn < turns; turn++) {
  calls = []; number = 0; started = performance.now();
  // The web's time budget: 75 s for a week up to 4 minutes for a month; past it, nobody is asked and the days pass.
  const spanDays = Number(option("--span", "30"));
  const budgetMs = args.includes("--budget") ? Math.round(Math.min(240, Math.max(60, 75 + (spanDays - 7) * 6.5)) * 1000) : null;
  const turnStart = Date.now();
  const writer = createWindowWriter({ port, clock: definition.clock, observer: actorRef, observerPolityId: actorPolityId,
    offices: definition.government.offices, recentSubjects: [], recentTitles: [],
    ...(budgetMs === null ? {} : { skipRetries: () => Date.now() - turnStart > budgetMs }) });
  const result = await runSimulationBurst({ world, clock: definition.clock, offices: definition.government.offices,
    warfare: definition.warfare, burstId: `speed-benchmark-${turn}`, gameId: "speed-benchmark", actorRef, actorPolityId,
    orderText: turns > 1 ? orders[turn % orders.length]! : args.includes("--order") ? option("--order", "") : null, spanDays: Number(option("--span", "30")),
    knownFacts: [], queue: [], port, onWindowClosed: writer.closed,
    ...(budgetMs === null ? {} : { outOfTime: () => Date.now() - turnStart > budgetMs, prefetch: true }),
    ...(args.includes("--deadline") ? { shouldStop: () => performance.now() - started > Number(option("--deadline", "150")) * 1000 } : {}) });
  const report = await writer.finish();
  const seconds = +((performance.now() - started) / 1000).toFixed(2);
  const summary = { seconds, underThreeMinutes: seconds <= 180, daysPassed: result.world.instant.day - world.instant.day, rounds: result.iterations, stopReason: result.stopReason,
    modelCalls: result.modelCalls, modelWorkCalls: result.modelWorkCalls,
    calls, entries: report.entries.length, parseFailures: result.parseFailures, skipped: result.skipped,
    loadable: WorldStateSchema.safeParse(result.world).success };
  const outcome = result.orderRecordId === null ? [] : orderOutcomeLines(result.world, result.orderRecordId, definition.clock);
  writeFileSync(path.join(out, `outcome-${turn}.json`), JSON.stringify(outcome, null, 2));
  writeFileSync(path.join(out, `summary-${turn}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(out, `report-${turn}.json`), JSON.stringify(report.entries, null, 2));
  console.log(JSON.stringify(summary));
  world = result.world;
  summaries.push(summary);
}
const secs = summaries.map((entry) => entry.seconds);
console.log(JSON.stringify({ turns, seconds: secs, mean: +(secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1) }));
