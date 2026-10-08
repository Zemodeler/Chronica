/**
 * The war sanity run (docs/plans/war-plans.md): the Punic opening advanced a number of game years, month by
 * month, with a model that never acts and with nobody at the player's seat in any power at war (the player is
 * an Egyptian), so that the rules conduct both Rome's and Carthage's wars. Opens a Rome-Carthage war at month 6.
 * Reports per year: wars, battles, sieges, march orders and how many were flips (a new objective ordered
 * before the last one was reached), plan shifts, naval moves, men under arms, and the months' cpu cost.
 * Closes with the money audit (unexplained must be 0). No provider is called.
 *
 *   npx tsx scripts/war-sanity.mts [years=5] [--actor=<characterId>] [--actor-polity=<polityId>] [--free]
 *
 * `--free` leaves the war with Carthage unopened: the report then says whether, and when, the rules went to it of themselves, and what stood in Sicily.
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

interface Year { orders: number; flips: number; naval: number; battles: number; sieges: number; planShifts: number; retargets: number; wars: number; cpu: number; men: number; engagements: number }
const blank = (): Year => ({ orders: 0, flips: 0, naval: 0, battles: 0, sieges: 0, planShifts: 0, retargets: 0, wars: 0, cpu: 0, men: 0, engagements: 0 });
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
let pendingBefore = new Map<string, string>();
const lastObjective = new Map<string, string>();
const priorIssued = new Map<string, number>();
const free = args.includes("--free");
let carthageWarDay: number | null = null;
for (let month = 0; month < years * 12; month += 1) {
  if (month === 6 && !free) {
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
  // March orders: a new force_move project. A flip is a new destination ordered for an army whose last march (as the month before ended) had not been finished.
  const pendingNow = new Map<string, string>();
  for (const project of world.projects) {
    const outcome = project.completionOutcome;
    if (outcome?.kind !== "force_move" || outcome.forceId == null || (project.status !== "funded" && project.status !== "in_progress")) continue;
    pendingNow.set(outcome.forceId, String(outcome.provinceId));
  }
  for (const project of world.projects) {
    const outcome = project.completionOutcome;
    if (outcome?.kind !== "force_move" || outcome.forceId == null || seenProjects.has(project.id)) continue;
    seenProjects.add(project.id);
    const force = world.material.forces.find((f) => f.id === outcome.forceId);
    if (force === undefined) continue;
    if (isNavalForce(force, definition.warfare)) { row.naval += 1; continue; }
    row.orders += 1;
    const last = lastOrder.get(force.id);
    const earlier = pendingBefore.get(force.id);
    if (last !== undefined && last !== outcome.provinceId && earlier !== undefined && earlier !== outcome.provinceId) {
      row.flips += 1;
      flipLog.push(`month ${month + 1}: ${force.name} ordered to ${String(outcome.provinceId)} before reaching ${earlier}`);
    }
    lastOrder.set(force.id, String(outcome.provinceId));
  }
  pendingBefore = pendingNow;
  // The objective an army is sent on, changed before it was reached or run out (new rules only).
  for (const cp of (world as unknown as { campaigns?: { forceId: string; objective: { kind: string; provinceId?: string; forceId?: string }; mode: string; expiresStep: number; issuedStep: number }[] }).campaigns ?? []) {
    const key = JSON.stringify([cp.objective, cp.mode]);
    const prior = lastObjective.get(cp.forceId);
    if (prior !== undefined && prior !== key && cp.issuedStep > (priorIssued.get(cp.forceId) ?? 0)) row.retargets += 1;
    lastObjective.set(cp.forceId, key);
    priorIssued.set(cp.forceId, cp.issuedStep);
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
  if (carthageWarDay === null && world.polityAgreements.some((a) => a.kind === "war" && a.status === "active" && [a.polityId, a.otherPolityId].includes("rome") && [a.polityId, a.otherPolityId].includes("carthage"))) carthageWarDay = world.instant.day;
  row.wars = world.polityAgreements.filter((a) => a.kind === "war" && a.status === "active").length;
  row.battles = battlesOf(world);
  row.men = menOf(world);
  if ((month + 1) % 12 === 0) {
    const r = perYear[year]!;
    const army = world.material.forces.filter((f) => !isNavalForce(f, definition.warfare) && fitStrengthOf(f) > 0).length;
    if (args.includes("--armies")) {
      const campaigns = (world as unknown as { campaigns?: { forceId: string; mode: string; objective: { kind: string; provinceId?: string; forceId?: string }; expiresStep: number }[] }).campaigns ?? [];
      const atWarWith = new Set(world.polityAgreements.filter((agreement) => agreement.kind === "war" && agreement.status === "active").flatMap((agreement) => [agreement.polityId, agreement.otherPolityId]));
      for (const force of world.material.forces.filter((f) => atWarWith.has(f.polityId) && !isNavalForce(f, definition.warfare) && fitStrengthOf(f) > 0).slice(0, 40)) {
        const cp = campaigns.find((c) => c.forceId === force.id);
        console.log(`    ${force.polityId.padEnd(22)} ${force.name.slice(0, 30).padEnd(30)} ${String(fitStrengthOf(force)).padStart(6)} at ${force.locationId} ${cp === undefined ? "no orders" : `${cp.mode} ${cp.objective.provinceId ?? cp.objective.forceId} (to ${cp.expiresStep})`}${force.hold === true ? " HOLD" : ""}`);
      }
    }
    if (free || args.includes("--armies")) {
      const where = (f: (typeof world.material.forces)[number]) => `${f.name.slice(0, 22)} ${fitStrengthOf(f)} @${world.map.provinces.find((p) => p.id === f.locationId)?.name ?? f.locationId}`;
      const side = (polity: string) => world.material.forces.filter((f) => f.polityId === polity && fitStrengthOf(f) > 0);
      console.log(`    fleet motions: ${world.material.politicalProcedures.filter((p) => /a fleet of|boarding-bridge/.test(p.label)).map((p) => `${p.label.slice(0, 60)} => ${p.outcome ?? p.stage}`).join("; ") || "none"}; shipbuilding works: ${world.projects.filter((w) => w.kind === "shipbuilding").map((w) => `${w.label} ${w.status}`).join("; ") || "none"}`);
      console.log(`    rome-carthage: war ${carthageWarDay === null ? "not opened" : `opened day ${carthageWarDay}`}; rome ${side("rome").map(where).join("; ")}; carthage ${side("carthage").map(where).join("; ")}; roman warships ${side("rome").reduce((n, f) => n + f.personnel.filter((row) => row.categoryId === "warship").reduce((m, row) => m + row.fit, 0), 0)}`);
    }
    console.log(`${formatWorldDate(world.instant, definition.clock)}: wars ${r.wars}, battles (cum) ${r.battles}, engagements opened ${r.engagements}, sieges laid ${r.sieges}, march orders ${r.orders} (flips ${r.flips}), plan shifts ${r.planShifts}, objective changes ${r.retargets}, modes ${modeCount()}, naval moves ${r.naval}, men under arms ${r.men}, armies ${army}, cpu/month ${(r.cpu / 12).toFixed(0)} ms`);
  }
}
function modeCount(): string {
  const count = new Map<string, number>();
  for (const cp of (world as unknown as { campaigns?: { mode: string; expiresStep: number }[] }).campaigns ?? []) if (cp.expiresStep > world.instant.day) count.set(cp.mode, (count.get(cp.mode) ?? 0) + 1);
  return [...count].map(([k, v]) => `${k} ${v}`).join("/") || "none";
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
