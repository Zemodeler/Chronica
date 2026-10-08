/**
 * The war sanity run (docs/plans/war-plans.md): the Punic opening advanced a number of game years, month by
 * month, with a model that never acts and with nobody at the player's seat in any power at war (the player is
 * an Egyptian), so that the rules conduct both Rome's and Carthage's wars. Opens a Rome-Carthage war at month 6.
 * Reports per year: wars, battles, sieges, march orders and how many were flips (a new objective ordered
 * before the last one was reached), plan shifts, naval moves, men under arms, and the months' cpu cost.
 * Closes with the money audit (unexplained must be 0). No provider is called.
 *
 *   npx tsx scripts/war-sanity.mts [years=5] [--actor=<characterId>] [--actor-polity=<polityId>]
 */
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, WorldDeltaSchema, ensureProvinceMaterial, fitStrengthOf, isNavalForce, formatWorldDate, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, applyDeltas, auditMoney, combineAudits, emptyAudit, auditInWords, createIdFactory, runSimulationBurst, type SimModelPort } from "@chronica/sim";

const args = process.argv.slice(2);
const years = Number(args.find((a) => /^\d+$/.test(a)) ?? "5");
const actor = (args.find((a) => a.startsWith("--actor=")) ?? "--actor=ptolemaic-egypt-ruler-5mbdla").split("=")[1]!;
const actorPolity = (args.find((a) => a.startsWith("--actor-polity=")) ?? "--actor-polity=ptolemaic-egypt").split("=")[1]!;
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
  },
};
const idFor = createIdFactory("war-sanity");
let world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = () => ({ now: world.instant, actorRef: { kind: "character" as const, id: actor }, actsForTheWorld: true, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.terrains ?? definition.map.terrains, ids: idFor, gameId: "war-sanity" });

interface Year { orders: number; flips: number; naval: number; battles: number; sieges: number; planShifts: number; wars: number; cpu: number; men: number; engagements: number }
const blank = (): Year => ({ orders: 0, flips: 0, naval: 0, battles: 0, sieges: 0, planShifts: 0, wars: 0, cpu: 0, men: 0, engagements: 0 });
const perYear: Year[] = [];
const lastOrder = new Map<string, string>();
const seenProjects = new Set<string>();
const seenSieges = new Set<string>();
const seenEngagements = new Set<string>();
const planSignature = new Map<string, string>();
const battlesOf = (w: WorldState): number => w.polityAgreements.filter((a) => a.kind === "war").reduce((sum, a) => sum + (a.battles?.length ?? 0), 0);
const menOf = (w: WorldState): number => w.material.forces.reduce((sum, f) => sum + fitStrengthOf(f), 0);
let total = emptyAudit();
const worstMonth = { ms: 0, month: 0 };
const flipLog: string[] = [];
for (let month = 0; month < years * 12; month += 1) {
  if (month === 6) {
    world = applyDeltas(world, [WorldDeltaSchema.parse({ op: "agreement_open", localId: "sanity-war", kind: "war", polityId: "carthage", otherPolityId: "rome", terms: "The war for Sicily.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." })], context() as never).world;
  }
  const year = Math.floor(month / 12);
  const row = (perYear[year] ??= blank());
  const before = world;
  const cpu0 = process.cpuUsage();
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: `war-sanity-${month}`, gameId: "war-sanity", actorRef: { kind: "character", id: actor }, actorPolityId: actorPolity,
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  world = result.world;
  const cpu = process.cpuUsage(cpu0);
  const ms = (cpu.user + cpu.system) / 1000;
  row.cpu += ms;
  if (ms > worstMonth.ms) { worstMonth.ms = ms; worstMonth.month = month + 1; }
  total = combineAudits(total, auditMoney(before, world));
  // March orders: a new force_move project; a flip when the force's last order had not been carried out.
  for (const project of world.projects) {
    const outcome = project.completionOutcome;
    if (outcome?.kind !== "force_move" || outcome.forceId == null || seenProjects.has(project.id)) continue;
    seenProjects.add(project.id);
    const force = world.material.forces.find((f) => f.id === outcome.forceId);
    if (force === undefined) continue;
    if (isNavalForce(force, definition.warfare)) { row.naval += 1; continue; }
    row.orders += 1;
    const last = lastOrder.get(force.id);
    if (last !== undefined && last !== outcome.provinceId && before.material.forces.find((f) => f.id === force.id)?.locationId !== last) {
      row.flips += 1;
      flipLog.push(`month ${month + 1}: ${force.name} ordered to ${String(outcome.provinceId)} before reaching ${last}`);
    }
    lastOrder.set(force.id, String(outcome.provinceId));
  }
  for (const siege of world.sieges) if (!seenSieges.has(siege.id)) { seenSieges.add(siege.id); row.sieges += 1; }
  for (const engagement of world.engagements ?? []) if (!seenEngagements.has(engagement.id)) { seenEngagements.add(engagement.id); row.engagements += 1; }
  const plans = ((world as unknown as { warPlans?: { warId: string; polityId: string; aims: unknown[]; posture: string }[] }).warPlans ?? []);
  for (const plan of plans) {
    const key = `${plan.warId}/${plan.polityId}`;
    const signature = `${plan.posture}:${JSON.stringify(plan.aims)}`;
    if (planSignature.has(key) && planSignature.get(key) !== signature) row.planShifts += 1;
    planSignature.set(key, signature);
  }
  row.wars = world.polityAgreements.filter((a) => a.kind === "war" && a.status === "active").length;
  row.battles = battlesOf(world);
  row.men = menOf(world);
  if ((month + 1) % 12 === 0) {
    const r = perYear[year]!;
    const army = world.material.forces.filter((f) => !isNavalForce(f, definition.warfare) && fitStrengthOf(f) > 0).length;
    console.log(`${formatWorldDate(world.instant, definition.clock)}: wars ${r.wars}, battles (cum) ${r.battles}, engagements opened ${r.engagements}, sieges laid ${r.sieges}, march orders ${r.orders} (flips ${r.flips}), plan shifts ${r.planShifts}, naval moves ${r.naval}, men under arms ${r.men}, armies ${army}, cpu/month ${(r.cpu / 12).toFixed(0)} ms`);
  }
}
const sum = (f: (y: Year) => number): number => perYear.reduce((s, y) => s + f(y), 0);
console.log(`TOTAL march orders ${sum((y) => y.orders)}, flips ${sum((y) => y.flips)}, plan shifts ${sum((y) => y.planShifts)}, naval ${sum((y) => y.naval)}; worst month ${worstMonth.ms.toFixed(0)} ms (month ${worstMonth.month})`);
for (const line of flipLog.slice(0, 12)) console.log(`  flip: ${line}`);
const plans = ((world as unknown as { warPlans?: unknown[] }).warPlans ?? []);
if (plans.length > 0) console.log(`final war plans: ${JSON.stringify(plans).slice(0, 1_800)}`);
const campaigns = ((world as unknown as { campaigns?: unknown[] }).campaigns ?? []);
if (campaigns.length > 0) console.log(`final campaign plans: ${JSON.stringify(campaigns).slice(0, 1_800)}`);
console.log(`unexplained money entries: ${total.unexplained.length}`);
if (args.includes("--audit")) console.log(auditInWords(total));
