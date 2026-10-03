/**
 * The world left alone (docs/plans/a-living-world.md §11): the Punic Wars
 * opening run for N months with a model that never acts -- the consul waits,
 * and everybody asked answers "nothing" -- so whatever happens is the engine's
 * and the world AI's own doing. No provider is called and nothing is spent.
 *
 * Prints the big moves month by month, the rule ledger, and a liveliness
 * summary: wars opened and ended away from the player, alliances, risings,
 * sieges, cities taken, and how many powers acted.
 *
 *   npx tsx scripts/world-alone.mts [months=12] [--quiet] [--save world.json]
 */
import { writeFileSync } from "node:fs";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, formatWorldDate } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type SimModelPort } from "@chronica/sim";

const months = Number(process.argv[2] ?? "12");
const quiet = process.argv.includes("--quiet");
const saveAt = process.argv.indexOf("--save") === -1 ? null : process.argv[process.argv.indexOf("--save") + 1] ?? null;
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
  },
};
const PLAYER_POLITY = "rome";
const BIG = /^(province_occupied|war_declared|war_cause|revolt|alliance_made|alliance_refused|peace_made|polity_ended|province_raided|siege_laid|siege_ended|battle|polity_created|rising)/;

let world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
let refused = 0;
const kinds = new Map<string, number>();
for (let month = 0; month < months; month += 1) {
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: `alone-${month}`, gameId: "world-alone", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: PLAYER_POLITY,
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  world = result.world;
  const rejected = result.audit.filter((entry) => entry.kind === "world" || entry.kind === "reference" || entry.kind === "ignored");
  refused += rejected.length;
  for (const fact of result.newFacts) kinds.set(fact.kind, (kinds.get(fact.kind) ?? 0) + 1);
  if (quiet) continue;
  console.log(`\n== ${formatWorldDate(world.instant, definition.clock)}: ${result.newFacts.length} facts, ${rejected.length} refused`);
  for (const fact of result.newFacts.filter((candidate) => BIG.test(candidate.kind)).slice(0, 16)) console.log(`  [${fact.kind}] ${fact.summary.slice(0, 170)}`);
  for (const entry of rejected.slice(0, 6)) console.log(`  REFUSED ${entry.op}: ${(entry.reason ?? "").slice(0, 160)}`);
}

const log = world.statecraft.log;
if (!quiet) {
  console.log("\nRULE LEDGER");
  for (const entry of log) console.log(`  day ${entry.day} ${entry.act} ${entry.polityId}${entry.targetPolityId === null ? "" : ` -> ${entry.targetPolityId}`}: ${entry.why.slice(0, 110)}`);
}
const away = (agreement: (typeof world.polityAgreements)[number]): boolean => agreement.polityId !== PLAYER_POLITY && agreement.otherPolityId !== PLAYER_POLITY;
const wars = world.polityAgreements.filter((agreement) => agreement.kind === "war" && agreement.sinceStep > 0);
console.log(`\nLIVELINESS over ${months} months`);
console.log(`  wars opened: ${wars.length} (${wars.filter(away).length} not the player's), ended: ${wars.filter((war) => war.status === "ended").length}`);
console.log(`  alliances made: ${world.polityAgreements.filter((agreement) => agreement.kind === "alliance" && agreement.sinceStep > 0).length}`);
console.log(`  powers that acted by rule: ${new Set(log.map((entry) => entry.polityId)).size}; rule acts: ${log.length}`);
console.log(`  sieges laid: ${kinds.get("siege_laid") ?? 0}, cities given up: ${kinds.get("siege_ended") ?? 0}, provinces occupied: ${kinds.get("province_occupied") ?? 0}, raids: ${kinds.get("province_raided") ?? 0}, powers ended: ${kinds.get("polity_ended") ?? 0}`);
console.log(`  provinces held by somebody other than their owner now: ${world.map.provinces.filter((province) => province.ownerPolityId != null && province.ownerPolityId !== province.controllerPolityId).length}`);
console.log(`  acts the applier refused: ${refused}`);
if (saveAt !== null) {
  // A world that will not load is never saved as though it would (E1).
  const loadable = WorldStateSchema.safeParse(world);
  if (!loadable.success) throw new Error(`The world would not load (${loadable.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}); it was not written.`);
  writeFileSync(saveAt, JSON.stringify(loadable.data));
}
