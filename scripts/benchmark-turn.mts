// Complete, uncached CLI turn against the public scenario seed. No saved game is changed.
// node --env-file=apps/web/.env.local --import tsx scripts/benchmark-turn.mts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { createWindowWriter, runSimulationBurst, type SimModelPort } from "@chronica/sim";
import { answerWithHandCodex } from "../packages/ai/src/adapters/hand-codex";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1] ?? fallback;
};
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const player = option("--as", "gaius-genucius");
const actorRef = { kind: "character" as const, id: player };
const actorPolityId = world.characters.find((person) => person.id === player)?.polityId ?? null;
const out = path.resolve("eval-out/hand-speed", `turn-${Date.now()}`);
mkdirSync(out, { recursive: true });
const calls: { operation: string; seconds: number }[] = [];
let number = 0;
const started = performance.now();
const port: SimModelPort = {
  async complete(operation, system, asked) {
    const id = ++number;
    const at = performance.now();
    console.log(JSON.stringify({ started: operation, call: id, elapsed: +((at - started) / 1000).toFixed(1) }));
    const result = await answerWithHandCodex(system, asked, path.join(out, `call-${id}.json`), { operation });
    calls.push({ operation, seconds: +((performance.now() - at) / 1000).toFixed(2) });
    return result;
  },
};
const writer = createWindowWriter({ port, clock: definition.clock, observer: actorRef, observerPolityId: actorPolityId,
  offices: definition.government.offices, recentSubjects: [], recentTitles: [] });
const result = await runSimulationBurst({ world, clock: definition.clock, offices: definition.government.offices,
  warfare: definition.warfare, burstId: "speed-benchmark", gameId: "speed-benchmark", actorRef, actorPolityId,
  orderText: args.includes("--order") ? option("--order", "") : null, spanDays: Number(option("--span", "30")),
  knownFacts: [], queue: [], port, onWindowClosed: writer.closed });
const report = await writer.finish();
const seconds = +((performance.now() - started) / 1000).toFixed(2);
const summary = { seconds, underThreeMinutes: seconds <= 180, stopReason: result.stopReason,
  modelCalls: result.modelCalls, modelWorkCalls: result.modelWorkCalls,
  calls, entries: report.entries.length, parseFailures: result.parseFailures, skipped: result.skipped,
  loadable: WorldStateSchema.safeParse(result.world).success };
writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(path.join(out, "report.json"), JSON.stringify(report.entries, null, 2));
console.log(JSON.stringify(summary));
