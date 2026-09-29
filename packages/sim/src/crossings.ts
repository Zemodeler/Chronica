import {
  atWar,
  isNavalForce,
  isWinterMonth,
  landHopsBetween,
  paperWeightedStrength,
  passageFor,
  stormFinds,
  stormLossBps,
  strictHopsBetween,
  WINTER_PASS_LOSS_BPS,
  warfareWith,
  type FactProposalDraft,
  type Force,
  type Project,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement, type BattleAccount } from "./battle";
import { takeMen } from "./campaign";
import type { IdFactory } from "./ports";

/**
 * What the water and the mountains do to an army crossing them.
 *
 * A crossing was a ferry timetable: the loads, the days, and the army on the
 * far shore. Nobody's fleet stood in the way -- Carthage's navy could lie off
 * Messana while Roman legions were carried past it in eight loads -- and the
 * sea was as calm in January as in July. A storm happened only when a
 * narrator seed asked the model to invent one.
 *
 * - **Interception.** A crossing whose either shore has an enemy fleet off it
 *   is fought for. Escorts less than half the enemy's weight do not put out
 *   at all: the crossing turns back, and the army stays where it stood.
 *   Otherwise the enemy falls on the escorts, and if it wins the crossing is
 *   broken up, with men drowned in the transports it caught.
 * - **Storms.** A voyage rolls against the season (`seasons.ts`): the open
 *   sea in winter is a gamble, a strait in summer almost never is. Caught,
 *   the fleets lose hulls and the army men.
 * - **Passes.** A winter march whose every road goes over a pass leaves men
 *   in the snow.
 */

/** Escorts lighter than this share of the enemy's fleet do not put out. */
const ESCORT_DARES_AT = 0.5;
/** Of the army aboard a crossing the enemy broke up, the share drowned, in basis points. */
const DROWNED_WHEN_BROKEN_BPS = 800;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

/** The day this march reaches the end of its road, if it is today or before. */
const arrivesBy = (project: Project, toDay: number): boolean =>
  (project.status === "funded" || project.status === "in_progress")
  && project.completionOutcome?.kind === "force_move"
  && project.milestones.every((milestone) => milestone.status !== "pending" || project.startedAtStep + milestone.requiredAtElapsedOffset <= toDay)
  && project.milestones.some((milestone) => milestone.status === "pending");

/** Enemy fleets -- at war with the army's power, or answering to none -- lying off any of these shores. */
export function enemyFleetsOff(world: WorldState, army: Force, shores: readonly string[], warfare: ScenarioWarfareRules | undefined): Force[] {
  return world.material.forces.filter((force) => shores.includes(force.locationId) && force.polityId !== army.polityId && fitOf(force) > 0
    && isNavalForce(force, warfare) && (force.outlaw === true || atWar(world.polityAgreements, force.polityId, army.polityId)));
}

export const enemyFleetOff = (world: WorldState, army: Force, shores: readonly string[], warfare: ScenarioWarfareRules | undefined): boolean =>
  enemyFleetsOff(world, army, shores, warfare).length > 0;

export interface InterceptInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly month: number | null;
  readonly warfare: ScenarioWarfareRules;
  readonly ids: IdFactory;
  readonly playerCharacterId?: string | null | undefined;
}

/**
 * Crossings arriving today that an enemy fleet stands across, fought for
 * before the tick lets them land. A crossing that is turned back or broken up
 * fails, and says why; one whose escorts win lands as it would have.
 */
export function interceptCrossings(input: InterceptInput): { world: WorldState; facts: FactProposalDraft[]; battles: BattleAccount[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  const rules = warfareWith(world, input.warfare);
  const name = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;

  for (const project of input.world.projects) {
    if (!arrivesBy(project, input.toDay)) continue;
    const outcome = project.completionOutcome!;
    const army = world.material.forces.find((force) => force.id === outcome.forceId);
    if (army === undefined || outcome.provinceId === null || isNavalForce(army, rules)) continue;
    const passage = passageFor(world, army, outcome.provinceId, rules, input.month);
    if (passage.by !== "sea") continue;
    const enemies = enemyFleetsOff(world, army, [army.locationId, outcome.provinceId], rules)
      .sort((a, b) => paperWeightedStrength(b, rules) - paperWeightedStrength(a, rules) || a.id.localeCompare(b.id));
    if (enemies.length === 0) continue;
    const escorts = [...passage.ferry.fleets].sort((a, b) => paperWeightedStrength(b, rules) - paperWeightedStrength(a, rules) || a.id.localeCompare(b.id));
    const theirs = enemies.reduce((sum, fleet) => sum + paperWeightedStrength(fleet, rules), 0);
    const ours = escorts.reduce((sum, fleet) => sum + paperWeightedStrength(fleet, rules), 0);
    const lying = `${enemies.map((fleet) => fleet.name).join(" and ")} lay off ${name(enemies[0]!.locationId)}`;
    const fail = (why: string, significance: number): void => {
      world = { ...world, projects: world.projects.map((candidate) => (candidate.id === project.id ? { ...candidate, status: "failed" as const, completedAtStep: input.toDay } : candidate)) };
      facts.push({
        localId: `crossing_stopped_${project.id}`.slice(0, 60),
        kind: "crossing_stopped",
        summary: why.slice(0, 600),
        affectedRefs: [{ kind: "force", id: army.id }, { kind: "province", id: outcome.provinceId! }, ...enemies.slice(0, 3).map((fleet) => ({ kind: "force" as const, id: fleet.id }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance,
      });
    };

    if (ours < theirs * ESCORT_DARES_AT) {
      fail(`${army.name} did not cross to ${name(outcome.provinceId)}: ${lying}, and ${escorts.map((fleet) => fleet.name).join(" and ")} could not hope to carry the army past them. It stays in ${name(army.locationId)}.`, 55);
      continue;
    }

    const engagement = resolveEngagement({
      world,
      attacker: enemies[0]!,
      attackerAllies: enemies.slice(1),
      defender: escorts[0]!,
      defenderAllies: escorts.slice(1),
      posture: "offer_battle",
      tactic: null,
      warfare: rules,
      battleId: input.ids.next("battle"),
      seed: `${project.id}:intercept:${input.toDay}`,
      playerCharacterId: input.playerCharacterId ?? null,
    }, 0);
    world = engagement.world;
    facts.push(...engagement.facts);
    if (engagement.account !== undefined) battles.push(engagement.account);
    // The escorts beaten, or driven off the shore the army sails from: there
    // is nothing left to carry it past.
    const lost = engagement.account?.outcome === "attacker_victory"
      || world.material.forces.filter((force) => escorts.some((escort) => escort.id === force.id)).every((force) => force.locationId !== army.locationId || fitOf(force) === 0);
    if (!lost) continue;
    const drowned = Math.floor((fitOf(army) * DROWNED_WHEN_BROKEN_BPS) / 10_000);
    world = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === army.id ? takeMen(force, drowned, "attrition_death", input.toDay, `${project.id}:intercepted`) : force)) } };
    fail(`The crossing of ${army.name} to ${name(outcome.provinceId)} was broken up at sea: ${lying} and fell on the escorts, and ${drowned} men went down with the transports they caught. The rest are back in ${name(army.locationId)}.`, 70);
  }
  return { world, facts, battles };
}

/**
 * What the road did to an army that has just come to the end of it: a storm on
 * the crossing, or snow on the pass. The fleets that carried it and the army
 * itself, as they arrive, and a sentence for the arrival -- empty when
 * nothing happened.
 */
export function perilsOfTheRoad(
  world: WorldState,
  army: Force,
  fleets: readonly Force[],
  toProvinceId: string,
  over: "strait" | "sea_lane" | null,
  month: number | null,
  atStep: number,
  cause: string,
): { army: Force; fleets: Force[]; words: string } {
  if (over !== null) {
    if (!stormFinds(month, over, [army.id, cause, atStep])) return { army, fleets: [...fleets], words: "" };
    const share = stormLossBps(month);
    let hulls = 0;
    const battered = fleets.map((fleet) => {
      const lost = Math.floor((fitOf(fleet) * share) / 10_000);
      hulls += lost;
      return { ...takeMen(fleet, lost, "attrition_death", atStep, `${cause}:storm`), moraleBps: Math.max(0, fleet.moraleBps - 800) };
    });
    const drowned = Math.floor((fitOf(army) * share) / 20_000);
    return {
      army: { ...takeMen(army, drowned, "attrition_death", atStep, `${cause}:storm`), moraleBps: Math.max(0, army.moraleBps - 500) },
      fleets: battered,
      words: ` A storm caught the crossing${isWinterMonth(month) ? ", as the season had warned it would" : ""}: ${hulls} ships were lost and ${drowned} men drowned.`,
    };
  }
  // Snow on the only roads there.
  if (!isWinterMonth(month) || landHopsBetween(world, army.locationId, toProvinceId) === null) return { army, fleets: [...fleets], words: "" };
  if (strictHopsBetween(world, army.locationId, toProvinceId, (crossing) => crossing !== "pass" && crossing !== "strait" && crossing !== "sea_lane") !== null) {
    return { army, fleets: [...fleets], words: "" };
  }
  const frozen = Math.floor((fitOf(army) * WINTER_PASS_LOSS_BPS) / 10_000);
  const through = takeMen(army, frozen, "attrition_death", atStep, `${cause}:snow`);
  return {
    army: { ...through, fatigueBps: Math.min(10_000, through.fatigueBps + 2_000) },
    fleets: [...fleets],
    words: frozen > 0 ? ` The pass was deep in snow, and ${frozen} men were left in it.` : "",
  };
}
