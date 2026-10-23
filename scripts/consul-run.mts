// A resumable hand-played run: one burst per invocation, the world kept between them.
//
// scripts/hand-played-burst.mts always starts from the scenario and replays every answered prompt, which is
// quadratic for a long run. This keeps world, queue and known facts in <dir>/state.json and runs ONE burst from
// there. Model calls go to the hand adapter (answers in <dir>); the run stops with exit code 3 at the first
// prompt with no answer, and the burst is run again after it is answered (the engine is deterministic).
//
// Usage: npx tsx scripts/consul-run.mts --dir eval-out/consul-run [--order "<text>"] [--span 30] [--as gaius-genucius]
//          [--focused 3] [--ambient 4] [--reset] [--decide <option id>]  (answers the decision the last burst stopped on)
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHandAdapter } from "@chronica/ai";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, formatWorldDate, isDelivered, ordersUnderWay, type Fact, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, armyInWords, commandReport, forceNameWithoutBirthplace, factsForPlayer, lineOf, orderOutcomeLines, runSimulationBurst, serviceInWords, type PendingEvent, type SimModelPort } from "@chronica/sim";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1] ?? fallback;
};
const dir = option("dir", "eval-out/consul-run");
const spanDays = Number(option("span", "30"));
const player = option("as", "gaius-genucius");
const orderText = args.includes("--order") ? option("order", "") : null;
const budget = { ...DEFAULT_BUDGET, maxFocusedActors: Number(option("focused", "3")), maxAmbientActors: Number(option("ambient", "4")) };
mkdirSync(dir, { recursive: true });
const statePath = path.join(dir, "state.json");

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
let world: WorldState;
let queue: PendingEvent[] = [];
let knownFacts: Fact[] = [];
let burstNo = 0;
/** The question the last burst stopped on, kept so `--decide <option id>` can answer it (consul-run-issues T3). */
let pending: { prompt: string; options: { id: string; label: string; summary: string }[] } | null = null;
if (existsSync(statePath) && !args.includes("--reset")) {
  const saved = JSON.parse(readFileSync(statePath, "utf8"));
  world = WorldStateSchema.parse(saved.world);
  queue = saved.queue;
  knownFacts = saved.knownFacts;
  burstNo = saved.burstNo;
  pending = saved.decision ?? null;
} else {
  world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
}
const polity = world.characters.find((character) => character.id === player)?.polityId ?? null;

let calls = 0;
let stopping = false;
const adapter = createHandAdapter({
  dir,
  pollMs: 200,
  onWaiting: (promptPath) => {
    console.log(`WAITING ${promptPath}`);
    if (!stopping) { stopping = true; setTimeout(() => process.exit(3), 300); }
  },
});
const port: SimModelPort = {
  async complete(operation, system, user) {
    calls += 1;
    return (await adapter.call(operation, system, user)).content;
  },
};

const decideId = args.includes("--decide") ? option("decide", "") : null;
const chosen = decideId === null ? undefined : pending?.options.find((candidate) => candidate.id === decideId);
if (decideId !== null && chosen === undefined) {
  console.log(`No pending decision has an option "${decideId}". Pending: ${JSON.stringify(pending)}`);
  process.exit(2);
}
const answeredDecision = chosen === undefined || pending === null ? undefined : { prompt: pending.prompt, label: chosen.label, summary: chosen.summary, optionId: chosen.id };
const from = world.instant;
const result = await runSimulationBurst({
  world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
  terrains: definition.map.terrains, burstId: `consul-${burstNo}`, gameId: "consul-run",
  life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
  actorRef: { kind: "character", id: player }, actorPolityId: polity,
  orderText, spanDays, knownFacts, queue, port, budget, ...(answeredDecision === undefined ? {} : { answeredDecision }),
});
world = result.world;
const fired = new Set(result.firedEventIds);
queue = [...queue, ...result.scheduled].filter((event) => !fired.has(event.id));
knownFacts = [...knownFacts, ...result.newFacts].slice(-300);
burstNo += 1;

const out: string[] = [];
const say = (line: string): void => { out.push(line); };
say(`## Burst ${burstNo}: ${formatWorldDate(from, definition.clock)} to ${formatWorldDate(world.instant, definition.clock)}, stopped on ${result.stopReason}, ${result.modelCalls} model call(s).${orderText === null ? "" : ` ORDER: ${orderText}`}`);
for (const skip of result.skipped.filter((entry) => entry.stage !== "mechanic")) say(`  skipped ${skip.stage}: ${skip.reason}`);
// Only the player's own refusals: another power's refused act (an ally's supply order, a rival's march) is not news to him.
const mine = (actorId: string | undefined): boolean => actorId === undefined || actorId === player;
for (const entry of result.audit.filter((candidate) => candidate.kind !== "mechanic_candidate" && mine(candidate.actorRef?.id))) say(`  audit ${entry.kind} ${entry.op} (${entry.actorRef?.id ?? "world"}): ${entry.reason.slice(0, 220)}`);
for (const rejected of result.frictions.filter((candidate) => mine(candidate.actorRef?.id))) say(`  friction: ${rejected.line.slice(0, 220)}`);
if (result.parseFailures.length > 0) say(`  unreadable: ${result.parseFailures.join(" | ")}`);
if (result.salvaged.length > 0) say(`  dropped to keep the answer: ${result.salvaged.join(", ")}`);
if (result.orderRecordId !== null) {
  // A one-part order carried out is answered by its passage in the game; a hand run has none, so it is told here as done.
  const told = orderOutcomeLines(world, result.orderRecordId);
  const record = world.orders.find((candidate) => candidate.id === result.orderRecordId);
  for (const line of told.length > 0 || record === undefined ? told : record.parts.map((part) => lineOf(world, part, record.actorCharacterId, definition.clock))) say(`  order: ${line}`);
}
for (const item of ordersUnderWay(world, player, definition.government.offices, definition.clock)) say(`  under way${item.stalled ? " (stalled)" : ""}: ${item.label} -- ${item.detail}`);
// Letters the player's power must answer, and those it is waiting on: a run that cannot see them answers none (consul-run-issues T3).
// A letter still on the road has not reached the desk: it is not listed as one to answer, for it cannot be answered yet.
for (const message of world.diplomacy.filter((candidate) => candidate.status === "awaiting_reply" && polity !== null && (candidate.toPolityId === polity || candidate.fromPolityId === polity) && (candidate.toPolityId !== polity || isDelivered(candidate, world.elapsedStep)))) {
  // A letter the player wrote to a man of his own power is his, awaiting that man's reply, not one for him to answer.
  const theirs = message.toPolityId === polity && message.fromCharacterId !== player;
  const withinPower = message.fromPolityId === message.toPolityId;
  const otherCharacterId = theirs ? message.fromCharacterId : message.toCharacterId;
  const other = withinPower && otherCharacterId !== null && otherCharacterId !== undefined
    ? world.characters.find((candidate) => candidate.id === otherCharacterId)?.name ?? otherCharacterId
    : world.map.polities.find((candidate) => candidate.id === (theirs ? message.fromPolityId : message.toPolityId))?.name ?? (theirs ? message.fromPolityId : message.toPolityId);
  const due = message.replyDueByStep === null ? "" : `, answer due ${formatWorldDate({ day: message.replyDueByStep, minute: 0 }, definition.clock)}`;
  say(`  letter ${theirs ? "to answer" : "awaiting reply"} [${message.id}] ${message.kind} ${theirs ? "from" : "to"} ${other}: ${message.subject}${due}`);
  // What it says: a letter whose terms are not shown cannot be answered.
  if (theirs && message.terms.trim() !== "") say(`      "${message.terms.slice(0, 400)}"`);
}
for (const due of result.deadlines) say(`  DEADLINE ${due.kind} from ${world.map.polities.find((candidate) => candidate.id === due.otherPolityId)?.name ?? due.otherPolityId}: ${due.subject}${due.dueStep === null ? "" : `, due ${formatWorldDate({ day: due.dueStep, minute: 0 }, definition.clock)}`}${due.onRefusal === null ? "" : ` (else ${due.onRefusal.replaceAll("_", " ")})`}`);
const me = world.characters.find((character) => character.id === player);
if (me !== undefined) { const placed = serviceInWords(world, me); if (placed !== null) say(`  in the ranks: ${placed}`); }
for (const force of world.material.forces.filter((candidate) => candidate.commanderCharacterId === player || candidate.memberCharacterIds.includes(player))) {
  const make = armyInWords(world, force);
  const fit = force.personnel.reduce((sum, row) => sum + row.fit, 0);
  const place = world.map.provinces.find((province) => province.id === force.locationId)?.name ?? force.locationId;
  const shown = forceNameWithoutBirthplace(world, force.name);
  say(`  army: ${shown}${shown.endsWith(String(place)) ? "" : ` at ${place}`} -- ${fit} fit, morale ${Math.round(force.moraleBps / 100)}/100${make === null ? "" : `; ${make}`}`);
}
for (const line of commandReport(world, player, definition.clock)) say(line);
const facts = factsForPlayer(result.newFacts, result.significanceByFactId, world, player, polity, definition.government.offices);
say(`  facts (${facts.length}; what touches you first, then by weight):`);
for (const fact of facts.slice(0, Number(option("facts", "25")))) say(`   [${result.significanceByFactId.get(fact.id) ?? 0}] ${fact.kind}: ${fact.summary.slice(0, 260)}`);
if (result.playerDecision !== null) say(`  player decision (answer with --decide <id>): ${result.playerDecision.prompt} | ${result.playerDecision.options.map((entry) => `${entry.id}: ${entry.label}`).join(" | ")}`.slice(0, 900));
const loadable = WorldStateSchema.safeParse(world);
if (!loadable.success) {
  say(`  !! THE WORLD WOULD NOT LOAD (${loadable.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}); state NOT saved`);
  console.log(out.join("\n"));
  appendFileSync(path.join(dir, "log.md"), `${out.join("\n")}\n\n`);
  process.exit(4);
}
// The save before this one stays beside it, so a burst run with a wrong order can be taken back.
if (existsSync(statePath)) copyFileSync(statePath, path.join(dir, "state.prev.json"));
writeFileSync(statePath, JSON.stringify({ world: loadable.data, queue, knownFacts, burstNo, decision: result.playerDecision ?? null }));
console.log(out.join("\n"));
appendFileSync(path.join(dir, "log.md"), `${out.join("\n")}\n\n`);
console.log(`(${calls} call(s) answered from ${dir})`);
