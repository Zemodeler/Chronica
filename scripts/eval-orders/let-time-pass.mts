// Two years of nothing but the calendar, on a world an eval chain left, with
// a scripted model that answers nothing and refuses to write a rule: what the
// rules already written do when nobody is asking (plan §2's done-when and its
// kill criterion). Deterministic and free.
//
// Usage: npx tsx scripts/eval-orders/let-time-pass.mts eval-out/world-<chain>.json [--years 2]
import { readFileSync } from "node:fs";
import { WorldStateSchema } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type SimModelPort } from "@chronica/sim";
import { definition } from "./opening";

const [path, ...rest] = process.argv.slice(2);
if (!path) throw new Error("usage: let-time-pass <world.json> [--years n]");
const years = Number(rest[rest.indexOf("--years") + 1] || 2);
let world = WorldStateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
const startDay = world.instant.day;

/** Nobody says anything; a rule asked for is a fault. */
const port: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Time passes.", domains: ["other"] }, narrativeSummary: "Time passes.", frictions: [], deltas: [], worldDeltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    if (operation === "write_mechanic") return Promise.reject(new Error("no rule may be written while time merely passes"));
    return Promise.reject(new Error(`nothing scripted for ${operation}`));
  },
};

const player = world.characters.find((character) => character.polityId === "rome" && character.officeId !== null) ?? world.characters[0]!;
const audit: { kind: string; reason: string }[] = [];
let bursts = 0;
while (world.instant.day - startDay < years * 365) {
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
    burstId: `pass-${bursts}`, gameId: "pass", actorRef: { kind: "character", id: player.id }, actorPolityId: player.polityId, orderText: null,
    spanDays: definition.clock.maxSpanDays, knownFacts: [], queue: [], port, budget: { ...DEFAULT_BUDGET, maxMechanicCalls: 0 },
  });
  world = result.world;
  audit.push(...result.audit.filter((entry) => entry.kind.startsWith("mechanic")).map((entry) => ({ kind: entry.kind, reason: entry.reason })));
  bursts += 1;
  if (result.stopReason === "budget_exhausted" && world.instant.day === startDay) break;
}

const periods = Math.floor((world.instant.day - startDay) / 30);
console.log(`${bursts} burst(s), day ${startDay} → ${world.instant.day} (${periods} months)\n`);
const rules = world.genericEntities.filter((entity) => entity.mechanic !== undefined);
if (rules.length === 0) console.log("No rules on this world.");
for (const entity of rules) {
  const rule = entity.mechanic!;
  const rows = world.material.transactions.filter((row) => row.cause.kind === "mechanic" && row.cause.id === entity.id);
  const flags: string[] = [];
  if (rule.firedCount > 0 && rule.changedCount === 0) flags.push("FIRES-ON-NOTHING");
  if (rule.firedCount === 0 && rule.endedAtStep === null) flags.push("NEVER-FIRED");
  if (rule.trigger.kind === "monthly" && rule.conditions.length === 0 && rule.end.kind === "never" && !rule.effects.some((effect) => effect.op === "money_transfer")) flags.push("EVERY-MONTH-NO-CONDITIONS");
  console.log(`- ${entity.label} [${entity.id}] (${entity.kind}, ${rule.origin}): trigger ${rule.trigger.kind}, ${rule.conditions.length} condition(s), end ${rule.end.kind}; fired ${rule.firedCount}, changed ${rule.changedCount}, empty ${rule.emptyFirings}${rule.endedReason === null ? "" : `; ended: ${rule.endedReason}`}; ${rows.length} transaction(s) totalling ${rows.reduce((sum, row) => sum + row.amount, 0)}${flags.length === 0 ? "" : `  ${flags.join(" ")}`}`);
}
const refusedEffects = audit.filter((entry) => entry.kind === "mechanic_effect" || entry.kind === "mechanic_warrant_lapsed");
console.log(`\n${refusedEffects.length} refused effect(s) / lapsed warrant(s)`);
for (const entry of refusedEffects.slice(0, 20)) console.log(`  ${entry.kind}: ${entry.reason.slice(0, 160)}`);
