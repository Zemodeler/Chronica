import {
  TRAP_MAX_TOLL_BPS,
  TRAP_MIN_TOLL_BPS,
  TRAP_SPEND_FOR_FULL_TOLL,
  createPressure,
  ensureProvinceMaterial,
  isContingencyArmed,
  warfareWith,
  type Contingency,
  type FactProposalDraft,
  type Force,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement, type BattleAccount } from "./battle";
import { firedBetween, watchReading } from "./watch";
import type { IdFactory } from "./ports";

/**
 * Plans laid in advance, springing by themselves.
 *
 * *"Prepare a strategy called the Burning City: when the Carthaginians pass
 * through the first layer of walls, set it ablaze and lock the gates, making
 * sure every troop stuck inside that layer dies."*
 *
 * About a fifth of the orders in the play corpus are shaped like that, and
 * until now every one of them depended on the narrator remembering a note. The
 * plan could be written down -- `generic_entity_create` took its trigger, its
 * action and its owner -- and nothing in the engine ever read it back. A trap
 * that works only when somebody remembers is not a trap, and "a trap shall
 * always realistically work" is the rule this was built to.
 *
 * ## Who decides what
 *
 * The same split as everywhere else, and it is the whole reason this shape was
 * chosen over the two nearby ones.
 *
 * **The world decides what was prepared**: where, against whom, what was spent
 * on it, who is waiting to fall on them afterwards. All of that is judgment
 * and all of it is the author's.
 *
 * **The engine decides what it did.** The toll is computed here, from what was
 * actually paid for and how many men walked into it, and it is bounded: a third
 * of them at the very most, and only for a trap somebody spent a season's money
 * on. The player asked for every man inside the ward to die; the honest answer
 * is a third of them dead and the rest broken and running, which decides a
 * siege without pretending an army is a number in a box.
 *
 * The rejected alternative is worth naming, because it is the tempting one: a
 * contingency that carries its own deltas. That hands an author a way to write
 * six thousand basis points of casualties with no battle resolved, and the
 * moment one plan can do it every plan will.
 *
 * ## When it springs
 *
 * The same predicate language and the same edge the ruler's own watch
 * conditions use, so there is one answer in this codebase to "has this become
 * true" -- but read differently, because the two watchers are not alike. A
 * burst's watch compares the start of the burst with the end of it. A plan is
 * armed in March and springs in August, and the world it was armed against is
 * long gone by then, so it carries the *reading* its trigger gave on the day it
 * was laid and fires when that reading changes in the right direction.
 *
 * One consequence is worth stating because it looks like a bug and is not: a
 * trap armed under men who are *already* standing in it does not fire until
 * they leave and come back. You cannot spring a trap on men who are already
 * past it.
 */

/** Guards a pathological number of plans from turning one tick into a campaign. */
const MAX_SPRINGS_PER_TICK = 8;

/**
 * What a trap actually takes, given what was spent laying it.
 *
 * Square-rooted, so the first coins buy the most and the ceiling costs a great
 * deal: a devastating trap is a season's work and a real expense, not a
 * sentence in an order. A trap nobody paid for still does something -- men
 * panic in a burning building whoever lit it -- and it does not decide a war.
 */
export function trapTollBps(spend: number): number {
  const share = Math.min(1, Math.sqrt(Math.max(0, spend) / TRAP_SPEND_FOR_FULL_TOLL));
  return Math.round(TRAP_MIN_TOLL_BPS + (TRAP_MAX_TOLL_BPS - TRAP_MIN_TOLL_BPS) * share);
}

/** Which forces are standing in the thing when it goes off. */
export function caughtIn(world: WorldState, plan: Contingency): readonly Force[] {
  return world.material.forces.filter((force) => {
    if (force.locationId !== plan.provinceId) return false;
    if (plan.positionId !== null && force.positionId !== plan.positionId) return false;
    // Null catches whoever walked into it. A trap does not check papers, and
    // an owner who lays one without naming a victim may burn his own men.
    return plan.againstPolityId === null ? force.polityId !== plan.ownerPolityId : force.polityId === plan.againstPolityId;
  });
}

export interface ContingencyReviewInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  readonly warfare?: ScenarioWarfareRules | undefined;
}

export interface ContingencyReviewResult {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  /** Battles the ambush half started, for whoever writes them up. */
  readonly battles: BattleAccount[];
  /** Plans that sprang this tick, so the burst knows to hand the ruler back the wheel. */
  readonly sprung: readonly string[];
}

export function reviewContingencies(input: ContingencyReviewInput): ContingencyReviewResult {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  const sprung: string[] = [];
  let sequence = 0;
  const nextLocalId = (prefix: string): string => `${prefix}_${input.toDay}_${sequence++}`;

  for (const plan of input.world.contingencies) {
    if (!isContingencyArmed(plan)) continue;

    // A plan nobody sprang goes stale: the timber rots and the men are moved.
    if (plan.expiresAtStep !== null && input.toDay >= plan.expiresAtStep) {
      world = close(world, plan.id, "lapsed", input.toDay, null);
      facts.push({
        localId: nextLocalId("plan_lapsed"),
        kind: "preparation_lapsed",
        summary: `${plan.label} was never sprung, and is no longer anything anybody could spring.`,
        affectedRefs: [{ kind: "character", id: plan.ownerCharacterId }],
        visibility: "private",
        discoveryState: "private",
        knowableInDays: 0,
        significance: 15,
        knownToRefs: [{ kind: "character", id: plan.ownerCharacterId }],
      });
      continue;
    }

    if (sprung.length >= MAX_SPRINGS_PER_TICK) continue;

    // Against the reading it was armed with, never against the start of this
    // tick: a plan laid in March is not comparable to a world from August, and
    // comparing it to the tick's opening would mean a trap only ever fired if
    // the men happened to walk in during the same tick that first observed it.
    const reading = watchReading(plan.trigger, world);
    if (!firedBetween(plan.trigger, plan.armedReading, reading)) {
      world = reread(world, plan.id, reading);
      continue;
    }

    const result = plan.effect === "spring_trap"
      ? springTrap(world, plan, input, nextLocalId)
      : standTo(world, plan, input, nextLocalId);

    world = result.world;
    facts.push(...result.facts);
    battles.push(...result.battles);
    sprung.push(plan.id);
  }

  return { world, facts, battles, sprung };
}

/** The prepared thing happens. */
function springTrap(
  world: WorldState,
  plan: Contingency,
  input: ContingencyReviewInput,
  nextLocalId: (prefix: string) => string,
): { world: WorldState; facts: FactProposalDraft[]; battles: BattleAccount[] } {
  const caught = caughtIn(world, plan);
  const toll = trapTollBps(plan.preparationSpend);
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];

  // It fired, and there was nobody in it. The trigger and the trap are about
  // different things -- "when a Carthaginian force enters the province" may be
  // true of an army nowhere near the ward that was mined.
  if (caught.length === 0) {
    return {
      world: close(world, plan.id, "sprung", input.toDay, 0),
      facts: [{
        localId: nextLocalId("plan_empty"),
        kind: "preparation_wasted",
        summary: `${plan.label} was sprung and caught nobody.`,
        affectedRefs: [{ kind: "character", id: plan.ownerCharacterId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 1,
        significance: 30,
      }],
      battles,
    };
  }

  let next = world;
  let killed = 0;
  for (const force of caught) {
    const personnel = force.personnel.map((category) => {
      const lost = Math.floor((category.fit * toll) / 10_000);
      killed += lost;
      return { ...category, fit: Math.max(0, category.fit - lost) };
    });
    next = {
      ...next,
      material: {
        ...next.material,
        forces: next.material.forces.map((candidate) => (candidate.id === force.id
          ? {
            ...candidate,
            personnel,
            // Men who have watched a third of the army burn do not hold
            // together. The order goes before the numbers do, which is why a
            // trap decides a siege out of proportion to what it kills.
            moraleBps: Math.max(0, candidate.moraleBps - toll * 2),
            cohesionBps: Math.max(0, candidate.cohesionBps - toll * 2),
            history: [...candidate.history, {
              id: input.ids.next("personnel"),
              atStep: input.toDay,
              kind: "attrition_death" as const,
              categoryId: candidate.personnel[0]?.categoryId ?? "infantry",
              count: Math.max(1, Math.floor((candidate.personnel.reduce((sum, category) => sum + category.fit, 0) * toll) / 10_000)),
              causeId: plan.id,
            }].slice(-64),
          }
          : candidate)),
      },
    };
  }

  // The ward burns with them in it. A trap is done to a place as much as to an
  // army, and the place does not recover because the siege ended well.
  // `ensureProvinceMaterial` first: a province nothing has happened in yet has
  // no row, and mapping over the rows there are would burn the ward in silence.
  next = ensureProvinceMaterial(next, input.toDay);
  next = {
    ...next,
    material: {
      ...next.material,
      provinceMaterial: next.material.provinceMaterial.map((material) => (material.provinceId === plan.provinceId
        ? {
          ...material,
          warDamageBps: Math.min(10_000, material.warDamageBps + Math.round(toll / 2)),
          productiveCapacityBps: Math.max(0, material.productiveCapacityBps - Math.round(toll / 3)),
        }
        : material)),
    },
  };

  facts.push({
    localId: nextLocalId("plan_sprung"),
    kind: "trap_sprung",
    summary: `${plan.label} was sprung: ${killed} men caught in it, and what was left of them broke.`,
    affectedRefs: [
      { kind: "character", id: plan.ownerCharacterId },
      ...caught.map((force) => ({ kind: "force" as const, id: force.id })),
    ],
    visibility: "public",
    discoveryState: "public",
    knowableInDays: 0,
    significance: 90,
  });

  // And then the men who were waiting come in. An ordinary battle, resolved by
  // the ordinary resolver, against an enemy that has just lost a third of its
  // strength and most of its order -- which is the whole point of waiting.
  const ambusher = plan.ambushForceId === null
    ? undefined
    : next.material.forces.find((force) => force.id === plan.ambushForceId && force.locationId === plan.provinceId);
  const victim = ambusher === undefined
    ? undefined
    : next.material.forces.find((force) => force.id === caught[0]!.id);

  if (ambusher !== undefined && victim !== undefined && input.warfare !== undefined) {
    const engagement = resolveEngagement({
      world: next,
      attacker: ambusher,
      defender: victim,
      posture: "offer_battle",
      tactic: {
        factor: "surprise",
        magnitude: "meaningful",
        rationale: `${plan.label}: the men held back for this fall on them while the ward is still burning.`,
      },
      // The engine sprang it, so there is no author's claim to check; and the
      // men who waited on the heights come down off them.
      engineTactic: true,
      attackerFromPosition: true,
      warfare: warfareWith(next, input.warfare),
      battleId: input.ids.next("battle"),
      seed: `${plan.id}:${input.toDay}`,
    }, 0);
    next = engagement.world;
    facts.push(...engagement.facts);
    if (engagement.account !== undefined) battles.push(engagement.account);
  }

  return { world: close(next, plan.id, "sprung", input.toDay, toll), facts, battles };
}

/**
 * The alarm is raised, and the ruler is handed the wheel.
 *
 * The honest answer to every conditional whose consequence is a judgment rather
 * than a bang. "Should Hadrumentum fall, write to the Senate for legions" is
 * not an effect anybody can compute: it is the next order, and what it was
 * missing was not a mechanism but a prompt at the moment the condition held.
 */
function standTo(
  world: WorldState,
  plan: Contingency,
  input: ContingencyReviewInput,
  nextLocalId: (prefix: string) => string,
): { world: WorldState; facts: FactProposalDraft[]; battles: BattleAccount[] } {
  const pressured = createPressure(
    { characters: world.characters, characterPressures: world.characterPressures },
    {
      id: input.ids.next("pressure"),
      characterId: plan.ownerCharacterId,
      kind: "military_emergency",
      intensity: 70,
      label: plan.label,
      sourceEventId: null,
      atStep: input.toDay,
      reviewInSteps: 14,
      expiresInSteps: 120,
      visibility: "polity",
    },
  );

  return {
    world: close({
      ...world,
      characters: [...pressured.characters],
      characterPressures: [...pressured.characterPressures],
    }, plan.id, "sprung", input.toDay, null),
    facts: [{
      localId: nextLocalId("plan_stood_to"),
      kind: "contingency_met",
      summary: `The thing ${plan.label} was waiting on has happened.`,
      affectedRefs: [{ kind: "character", id: plan.ownerCharacterId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      // Heavy enough to clear any entry bar: the ruler laid this plan against
      // exactly this moment, and reading about it a month later is no use.
      significance: 75,
    }],
    battles: [],
  };
}

/**
 * Keeps a standing plan's reading current without springing it.
 *
 * The men left the ward; the city changed hands back. A plan that did not keep
 * up would spring on the *next* change in either direction, which is not what
 * anybody laid it for.
 */
function reread(world: WorldState, planId: string, reading: string): WorldState {
  return {
    ...world,
    contingencies: world.contingencies.map((plan) => (plan.id === planId ? { ...plan, armedReading: reading } : plan)),
  };
}

function close(world: WorldState, planId: string, status: Contingency["status"], atDay: number, tollBps: number | null): WorldState {
  return {
    ...world,
    contingencies: world.contingencies.map((plan) => (plan.id === planId
      ? { ...plan, status, sprungAtStep: status === "sprung" ? atDay : null, tollBps }
      : plan)),
  };
}
