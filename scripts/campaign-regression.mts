/**
 * The campaign regression run: the Punic opening advanced a bounded number of months, provider-free, with nobody at the
 * player's seat in any power at war (the player is an Egyptian), and the armies' conduct checked against what went wrong once:
 *
 *   - the allies' contingents were sent to the consul's siege of Rhegium, reckoned the garrison against themselves alone with his
 *     legions beside them, fell back home, and were sent again the next month (`war-direction.ts`, `campaign-orders.ts`);
 *   - a march turned on the road lost the days walked (`apply/marches.ts`).
 *
 * It reports, month by month, the cpu cost, the decisions the powers took, the march orders given, the journeys called off while
 * under way, and the contingents' fall-backs and re-orders; then checks the invariants and the money audit, and replays the first
 * months from the same opening to show the run is deterministic. Exit code 1 where an invariant fails.
 *
 *   npx tsx scripts/campaign-regression.mts [--months=7] [--replay=2] [--max-follower-fallbacks=0] [--max-arrive-and-flee=0] [--max-contingent-called-off=0]
 */
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, fitStrengthOf, formatWorldDate, isNavalForce, leaderOf, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, auditMoney, combineAudits, emptyAudit, runSimulationBurst, type SimModelPort } from "@chronica/sim";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => Number((args.find((arg) => arg.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1]);
const months = flag("months", 7);
const replay = Math.min(months, flag("replay", 2));
const limits = { followerFallbacks: flag("max-follower-fallbacks", 0), arriveAndFlee: flag("max-arrive-and-flee", 0), contingentCalledOff: flag("max-contingent-called-off", 0) };
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
  },
};
const ACTOR = "ptolemaic-egypt-ruler-5mbdla";
const ACTOR_POLITY = "ptolemaic-egypt";

interface Month {
  readonly month: number;
  readonly day: number;
  readonly cpuMs: number;
  readonly decisions: number;
  readonly marchOrders: number;
  readonly calledOff: number;
  readonly contingentCalledOff: number;
  readonly followerFallbacks: number;
  readonly followerOrders: number;
  readonly armies: number;
  readonly men: number;
}

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

async function aMonth(world: WorldState, index: number, tag: string): Promise<{ world: WorldState; facts: readonly { kind: string; summary: string; affectedRefs: readonly { kind: string; id: string }[] }[] }> {
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: `${tag}-${index}`, gameId: "war-sanity", actorRef: { kind: "character", id: ACTOR }, actorPolityId: ACTOR_POLITY,
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  return { world: result.world, facts: result.newFacts };
}

/** The place a fall-back was from, as the decision's reason names it ("... at Rhegium coast: too many"). */
const fellBackFrom = (why: string): string | null => / at (.+): too many$/.exec(why)?.[1] ?? null;

async function run(): Promise<void> {
  let world = opening();
  const rows: Month[] = [];
  const seenProjects = new Set<string>();
  const seenLog = new Set<string>();
  let audit = emptyAudit();
  /** The marches begun, by force, for the arrive-and-flee check: a march to X followed within 40 days by a fall-back from X. */
  const marches: { forceId: string; commanderId: string; polityId: string; to: string; day: number }[] = [];
  const arriveAndFlee: string[] = [];
  const reissuedAfterFallBack: string[] = [];
  const isFollower = (polityId: string): boolean => leaderOf(world.polityAgreements, polityId) !== null;
  for (let month = 0; month < months; month += 1) {
    const before = world;
    const cpu0 = process.cpuUsage();
    const passed = await aMonth(world, month, "campaign-regression");
    world = passed.world;
    const cpu = process.cpuUsage(cpu0);
    audit = combineAudits(audit, auditMoney(before, world));
    const day = world.instant.day;
    const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
    let marchOrders = 0;
    for (const project of world.projects) {
      const outcome = project.completionOutcome;
      if (outcome?.kind !== "force_move" || outcome.forceId == null || seenProjects.has(project.id)) continue;
      seenProjects.add(project.id);
      const force = world.material.forces.find((candidate) => candidate.id === outcome.forceId);
      if (force === undefined || isNavalForce(force, definition.warfare)) continue;
      marchOrders += 1;
      if (outcome.provinceId !== null && project.kind === "march") marches.push({ forceId: force.id, commanderId: force.commanderCharacterId, polityId: force.polityId, to: provinceName(outcome.provinceId), day: project.startedAtStep });
    }
    const calledOff = passed.facts.filter((fact) => fact.kind === "march_called_off");
    const contingentCalledOff = calledOff.filter((fact) => {
      const forceId = fact.affectedRefs.find((ref) => ref.kind === "force")?.id;
      const force = forceId === undefined ? undefined : world.material.forces.find((candidate) => candidate.id === forceId);
      return force !== undefined && isFollower(force.polityId);
    });
    const entries = world.statecraft.log.filter((entry) => entry.day > day - 30 && entry.day <= day);
    let decisions = 0;
    let followerFallbacks = 0;
    let followerOrders = 0;
    for (const entry of entries) {
      const key = `${entry.day}|${entry.polityId}|${entry.actorCharacterId ?? ""}|${entry.act}|${entry.why}`;
      if (seenLog.has(key)) continue;
      seenLog.add(key);
      decisions += 1;
      if (!isFollower(entry.polityId)) continue;
      if (entry.act === "war_plan") followerOrders += 1;
      if (entry.act === "fall_back") {
        followerFallbacks += 1;
        const from = fellBackFrom(entry.why);
        const march = marches.find((candidate) => candidate.commanderId === entry.actorCharacterId && candidate.to === from && entry.day - candidate.day <= 40 && entry.day >= candidate.day);
        if (from !== null && march !== undefined) arriveAndFlee.push(`day ${entry.day}: ${entry.polityId} marched to ${from} on day ${march.day} and fell back from it (${entry.why.slice(0, 80)})`);
      }
    }
    // A contingent sent again, within sixty days of falling back, to the place it fell back from: the thing that repeated every month.
    for (const entry of entries) {
      if (entry.act !== "war_plan" || !isFollower(entry.polityId)) continue;
      const place = / at (.+?)(?::|$)/.exec(entry.why)?.[1] ?? null;
      if (place === null) continue;
      const earlier = world.statecraft.log.find((other) => other.act === "fall_back" && other.polityId === entry.polityId && other.actorCharacterId === entry.actorCharacterId && entry.day - other.day > 0 && entry.day - other.day < 60 && fellBackFrom(other.why) === place);
      if (earlier !== undefined) reissuedAfterFallBack.push(`day ${entry.day}: ${entry.polityId} sent again to ${place} after falling back from it on day ${earlier.day}`);
    }
    const land = world.material.forces.filter((force) => !isNavalForce(force, definition.warfare) && fitStrengthOf(force) > 0);
    rows.push({
      month: month + 1, day, cpuMs: Math.round((cpu.user + cpu.system) / 1000), decisions, marchOrders, calledOff: calledOff.length, contingentCalledOff: contingentCalledOff.length,
      followerFallbacks, followerOrders, armies: land.length, men: land.reduce((sum, force) => sum + fitStrengthOf(force), 0),
    });
    const row = rows[rows.length - 1]!;
    console.log(`month ${String(row.month).padStart(2)} (${formatWorldDate(world.instant, definition.clock)}): cpu ${String(row.cpuMs).padStart(6)} ms, decisions ${String(row.decisions).padStart(3)}, march orders ${String(row.marchOrders).padStart(3)}, called off ${row.calledOff} (contingents ${row.contingentCalledOff}), contingent fall-backs ${row.followerFallbacks}, contingent orders ${row.followerOrders}, armies ${row.armies}, men ${row.men}`);
    for (const fact of calledOff) console.log(`    called off: ${fact.summary.slice(0, 160)}`);
  }

  const sum = (pick: (row: Month) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  console.log(`TOTAL over ${months} months: cpu ${sum((row) => row.cpuMs)} ms (worst ${Math.max(...rows.map((row) => row.cpuMs))} ms), decisions ${sum((row) => row.decisions)}, march orders ${sum((row) => row.marchOrders)}, called off ${sum((row) => row.calledOff)} (contingents ${sum((row) => row.contingentCalledOff)}), contingent fall-backs ${sum((row) => row.followerFallbacks)}, contingent orders ${sum((row) => row.followerOrders)}`);

  // The replay: the same opening, the same months, the same world.
  let again = opening();
  for (let month = 0; month < replay; month += 1) again = (await aMonth(again, month, "campaign-regression")).world;
  let first = opening();
  for (let month = 0; month < replay; month += 1) first = (await aMonth(first, month, "campaign-regression")).world;
  const deterministic = JSON.stringify(first) === JSON.stringify(again);

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
    if (!ok) failures.push(name);
  };
  check("contingent fall-backs", sum((row) => row.followerFallbacks) <= limits.followerFallbacks, `${sum((row) => row.followerFallbacks)} (at most ${limits.followerFallbacks})`);
  check("arrive and flee", arriveAndFlee.length <= limits.arriveAndFlee, `${arriveAndFlee.length} (at most ${limits.arriveAndFlee})${arriveAndFlee.length === 0 ? "" : `: ${arriveAndFlee.slice(0, 4).join("; ")}`}`);
  check("sent again where it fell back from", reissuedAfterFallBack.length === 0, `${reissuedAfterFallBack.length}${reissuedAfterFallBack.length === 0 ? "" : `: ${reissuedAfterFallBack.slice(0, 4).join("; ")}`}`);
  check("contingent journeys called off", sum((row) => row.contingentCalledOff) <= limits.contingentCalledOff, `${sum((row) => row.contingentCalledOff)} (at most ${limits.contingentCalledOff})`);
  check("money audit", audit.unexplained.length === 0, `${audit.unexplained.length} unexplained entries`);
  check("deterministic replay", deterministic, `${replay} months replayed ${deterministic ? "identically" : "DIFFERENTLY"}`);
  if (failures.length > 0) {
    console.log(`FAILED: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

await run();
