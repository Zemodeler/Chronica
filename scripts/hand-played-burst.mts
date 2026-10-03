// Real bursts on the Punic Wars opening, with the model answered by hand.
//
// The base way to test the engine: nothing is sent to any provider and no
// coins are spent. Every model call goes to the hand adapter
// (`packages/ai/src/adapters/hand.ts`), which writes the prompt to a file
// named by its own hash and waits for the answer beside it. By default this
// script stops at the first prompt with no answer (exit code 3) so it can be
// answered and the run started again: the engine is deterministic, so every
// prompt already answered is asked again word for word and answered from
// disk, and the run goes one call further. With --wait it keeps running and
// waits instead.
//
// Written to test NPC plans by hand (gap document §5); good for anything a
// scripted port is too blunt for, since the answers are read against the real
// prompts and the real engine does everything else.
//
// Usage:
//   npm run play -- [--dir eval-out/hand-played] [--bursts 2] [--span 30]
//     [--as gaius-genucius] [--order "<an order; none means waiting>"] [--focused 3] [--ambient 4] [--wait]
//     [--declare "<role>" --name "<name>"]   play a newly declared Roman instead, as --as
//
// With --declare, the player is a new person declared into the opening world
// the way the web declares one (`materializePlayerCharacter`): "a legionary of
// the hastati", "a centurion", "a military tribune". The report then says,
// after each burst, where he stands in his army and what his army is made of.
//
// In <dir>: system-<op>.txt is each operation's system prompt, written once;
// <op>-<hash>.prompt.txt is a call waiting for its answer, <op>-<hash>.json
// the answer; queue.log lists prompts in the order they were asked. When the
// run finishes, the report is printed and saved as report.txt.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHandAdapter } from "@chronica/ai";
import { PUNIC_IDS, punicWarsScenario } from "@chronica/db";
import { CharacterKnowledgebaseSchema, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, formatWorldDate, materializePlayerCharacter, ordersUnderWay, type Fact, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, armyInWords, orderOutcomeLines, runSimulationBurst, serviceInWords, type PendingEvent, type PlanTally, type SimModelPort } from "@chronica/sim";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1] ?? fallback;
};
const dir = option("dir", "eval-out/hand-played");
const bursts = Number(option("bursts", "2"));
const spanDays = Number(option("span", "30"));
const player = option("as", "gaius-genucius");
// No order text by default: waiting, as the web's "let a month pass" sends it.
// A typed "let the month pass" is an order the engine records as a pursuit and
// offers the rule writer, which is a call spent on nothing.
const orderText = args.includes("--order") ? option("order", "") : null;
const budget = { ...DEFAULT_BUDGET, maxFocusedActors: Number(option("focused", "3")), maxAmbientActors: Number(option("ambient", "4")) };
mkdirSync(dir, { recursive: true });

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
let world: WorldState = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const declaredRole = args.includes("--declare") ? option("declare", "") : null;
if (declaredRole !== null) {
  const rome = world.material.forces.find((force) => force.id === "roman-field-army")?.locationId ?? PUNIC_IDS.rome;
  world = materializePlayerCharacter(world, player, CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: player, gameId: "hand-played", canonicalName: option("name", "Titus Vettius"),
    nickname: null, birthYearApprox: -296, deathYearApprox: null, origin: "invented", period: "270 BCE",
    locationProvinceId: rome, culture: "Roman", faith: null,
    biography: "A farmer's son of the Sabine hills, levied for the year.", notableEvents: [],
    role: declaredRole, authority: [], socioEconomicClass: "Plebeian", startingMoney: 40,
    skills: { martial: 45, intrigue: 20, learning: 15, piety: 40, stewardship: 20, diplomacy: 20, body: 60, subSkills: {} },
    skillRationale: {},
    relations: [
      { name: "Vettia", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      { name: "Gnaeus Vettius", relationship: "brother", historical: false, notes: "Too young for the levy.", kind: "person", category: "family", familyRole: "sibling" },
      { name: "Aulus", relationship: "friend", historical: false, notes: "From the next farm.", kind: "person", category: "other", familyRole: null },
      { name: "Publius", relationship: "creditor", historical: false, notes: "Lent him for his kit.", kind: "person", category: "other", familyRole: null },
    ],
    confirmedByPlayer: true, confirmationDraft: null,
  }), definition.government);
}
const polity = world.characters.find((character) => character.id === player)?.polityId ?? null;

let call = 0;
const stopWhenWaiting = !args.includes("--wait");
let stopping = false;
const adapter = createHandAdapter({
  dir,
  pollMs: 200,
  onWaiting: (promptPath) => {
    console.log(`WAITING ${promptPath}`);
    // Concurrent calls in the same round are each written before the run
    // stops, so a split cast is answered in one sitting.
    if (stopWhenWaiting && !stopping) {
      stopping = true;
      setTimeout(() => process.exit(3), 300);
    }
  },
});
const port: SimModelPort = {
  async complete(operation, system, user) {
    call += 1;
    return (await adapter.call(operation, system, user)).content;
  },
};

const report: string[] = [];
const say = (line: string): void => { report.push(line); };
let knownFacts: Fact[] = [];
let queue: PendingEvent[] = [];
const tallies: PlanTally[] = [];

for (let index = 0; index < bursts; index += 1) {
  const printedFrom = report.length;
  const from = world.instant;
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, burstId: `hand-${index}`, gameId: "hand-played",
    // As the web passes them (`apps/web/lib/burst-runner.ts`). Left out, nobody
    // aged, died or was born in any hand run, and the age's pressures never
    // reached the narrator: the observer's "no deaths, no births" was this.
    life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    actorRef: { kind: "character", id: player }, actorPolityId: polity,
    orderText, spanDays, knownFacts, queue, port, budget,
  });
  world = result.world;
  const fired = new Set(result.firedEventIds);
  queue = [...queue, ...result.scheduled].filter((event) => !fired.has(event.id));
  knownFacts = [...knownFacts, ...result.newFacts].slice(-300);
  tallies.push(result.plans);
  const p = result.plans;
  say(`Burst ${index + 1}: ${formatWorldDate(from, definition.clock)} to ${formatWorldDate(world.instant, definition.clock)}, stopped on ${result.stopReason}, ${result.modelCalls} model call(s).`);
  say(`  rounds per chain of reactions: ${result.chainRounds.join(", ")} (the first counts the orchestration), and ${result.planRounds} of plan owners alone.`);
  say(`  plans: ${p.laid} laid, ${p.taken} step(s) taken, ${p.missed} missed, ${p.woken} owner(s) woken; ${p.actedOnAPlan} of ${p.acted} who acted did so on a plan.`);
  for (const fact of result.newFacts.filter((entry) => entry.kind === "plan_fell_behind")) say(`  ${fact.summary}`);
  for (const skip of result.skipped) say(`  skipped ${skip.stage}: ${skip.reason}`);
  // What the engine refused or filled in, so an answer that did less than it
  // said is visible here and not only in the world it left.
  for (const entry of result.audit) say(`  audit ${entry.kind} ${entry.op} (${entry.actorRef?.id ?? "world"}): ${entry.reason.slice(0, 200)}`);
  for (const rejected of result.frictions) say(`  friction: ${rejected.line.slice(0, 200)}`);
  if (result.parseFailures.length > 0) say(`  unreadable: ${result.parseFailures.join(" | ")}`);
  if (result.salvaged.length > 0) say(`  dropped to keep the answer: ${result.salvaged.join(", ")}`);
  // What each part of the order came to, and what the Council would show.
  if (result.orderRecordId !== null) for (const line of orderOutcomeLines(world, result.orderRecordId)) say(`  order: ${line}`);
  for (const item of ordersUnderWay(world, player, definition.government.offices, definition.clock)) say(`  under way${item.stalled ? " (stalled)" : ""}: ${item.label} -- ${item.detail}`);
  // Where he stands, and what the armies he answers for are made of.
  const me = world.characters.find((character) => character.id === player);
  const placed = me === undefined ? null : serviceInWords(world, me);
  if (placed !== null) say(`  in the ranks: ${placed}`);
  for (const force of world.material.forces.filter((candidate) => candidate.commanderCharacterId === player || candidate.memberCharacterIds.includes(player))) {
    const make = armyInWords(world, force);
    if (make !== null) say(`  army: ${force.name} -- ${make}`);
  }
  console.log(report.slice(printedFrom).join("\n"));
}

say("");
say("Plans at the end:");
for (const character of world.characters) {
  const planned = character.ambitions.filter((ambition) => ambition.steps.length > 0);
  for (const ambition of planned) {
    say(`- ${character.name}: ${ambition.label} (${ambition.status})`);
    for (const step of ambition.steps) {
      const settled = step.settledOnDay === null ? "" : `, settled ${formatWorldDate({ day: step.settledOnDay, minute: 0 }, definition.clock)}`;
      say(`    ${step.status.padEnd(7)} ${step.act} (due ${formatWorldDate({ day: step.dueDay, minute: 0 }, definition.clock)}${settled})`);
    }
  }
}
const total = tallies.reduce((sum, tally) => ({ acted: sum.acted + tally.acted, onPlan: sum.onPlan + tally.actedOnAPlan }), { acted: 0, onPlan: 0 });
say("");
say(`Across the run, ${total.onPlan} of ${total.acted} answers that left a mark belonged to a plan. ${call} model call(s), all answered from ${dir}.`);

writeFileSync(path.join(dir, "report.txt"), `${report.join("\n")}\n`);
// A world that will not load is never saved as though it would (E1).
const loadable = WorldStateSchema.safeParse(world);
if (!loadable.success) throw new Error(`The world would not load (${loadable.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}); it was not written.`);
writeFileSync(path.join(dir, "world.json"), JSON.stringify(loadable.data));
console.log(report.join("\n"));
