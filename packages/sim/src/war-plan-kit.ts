import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  isSummerMonth,
  isWinterMonth,
  monthOfDay,
  type Force,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { ensureConstitutions } from "./constitutions";
import { decideStatecraft, type StatecraftDecision, type StatecraftInput } from "./statecraft";
import type { StrategyContext } from "./grand-strategy";

/**
 * A world to test war plans in: the Punic opening with Rome and Carthage at war, the player an Egyptian, so that the rules lead both
 * armies, and the monthly statecraft pass run and applied without the burst (docs/plans/war-plans.md).
 */
export const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
export const PLAYER = "ptolemaic-egypt-ruler-5mbdla";

export function atWar(day = 90): WorldState {
  let world = ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, toDay: day });
  world = { ...world, instant: { ...world.instant, day }, elapsedStep: day };
  const open = WorldDeltaSchema.parse({ op: "agreement_open", localId: "kit-war", kind: "war", polityId: "carthage", otherPolityId: "rome", terms: "The war for Sicily.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." });
  return applyDeltas(world, [open], context(world, PLAYER) as never).world;
}

export const context = (world: WorldState, actor: string, gameId = "war-plan-kit") => ({
  now: world.instant, actorRef: { kind: "character" as const, id: actor }, actsForTheWorld: true, offices: definition.government.offices,
  warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory(`${gameId}-${world.instant.day}`), gameId,
});

export function inputFor(world: WorldState, over: Partial<StatecraftInput> = {}): StatecraftInput {
  return {
    world, gameId: "war-plan-kit", excludedPolityIds: new Set(["ptolemaic-egypt"]), playedByModel: new Set<string>(), playerCharacterId: PLAYER, nearPlayer: null,
    pressures: [], warfare: definition.warfare, offices: definition.government.offices, clock: definition.clock, ...over,
  };
}

/** The month's statecraft, decided and applied, one decision after another, as the burst applies them. */
export function aMonth(world: WorldState, over: Partial<StatecraftInput> = {}): { readonly world: WorldState; readonly decisions: StatecraftDecision[]; readonly facts: string[] } {
  const decisions = decideStatecraft(inputFor(world, over));
  let next = world;
  const facts: string[] = [];
  for (const decision of decisions) {
    if (decision.deltas.length === 0) continue;
    const applied = applyDeltas(next, [...decision.deltas], context(next, decision.actorCharacterId) as never);
    facts.push(...applied.factProposals.map((fact) => fact.summary));
    next = applied.world;
  }
  return { world: next, decisions, facts };
}

export const forceOf = (world: WorldState, id: string): Force => world.material.forces.find((force) => force.id === id)!;

/** The same army somewhere else, for a test that wants the armies in a place. */
export function placed(world: WorldState, forceId: string, provinceId: string): WorldState {
  return { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === forceId ? { ...force, locationId: provinceId } : force)) } };
}

/** Rome's war with the Campanians of Rhegium ended, so that the war is Rome's with Carthage alone. */
export function romeAndCarthageAlone(world: WorldState): WorldState {
  return { ...world, polityAgreements: world.polityAgreements.map((agreement) => (agreement.id === "war-rome-rhegium" ? { ...agreement, status: "ended" as const, endedAtStep: world.elapsedStep, endedReason: "Ended for the test." } : agreement)) };
}

/** A man's nature at the head of an army: how bold, how careful, how good a soldier. */
export function ledBy(world: WorldState, forceId: string, nature: { boldness?: number; caution?: number; martial?: number; strategist?: number; logistics?: number; cruelty?: number }): WorldState {
  const commander = forceOf(world, forceId).commanderCharacterId;
  return {
    ...world,
    characters: world.characters.map((character) => (character.id !== commander ? character : {
      ...character,
      skills: { ...character.skills, ...(nature.martial === undefined ? {} : { martial: nature.martial }), ...(nature.strategist === undefined && nature.logistics === undefined ? {} : { subSkills: { ...character.skills.subSkills, ...(nature.strategist === undefined ? {} : { strategist: nature.strategist }), ...(nature.logistics === undefined ? {} : { logistics: nature.logistics }) } }) },
      mind: { ...character.mind, temperament: { ...character.mind.temperament, ...(nature.boldness === undefined ? {} : { boldness: nature.boldness }), ...(nature.caution === undefined ? {} : { caution: nature.caution }), ...(nature.cruelty === undefined ? {} : { cruelty: nature.cruelty }) } },
    })),
  };
}

/** Provinces one march from this one, nearest first. */
export function neighboursOf(world: WorldState, provinceId: string): string[] {
  return world.map.edges.filter((edge) => (edge.from === provinceId || edge.to === provinceId) && edge.crossing !== "sea_lane" && edge.crossing !== "strait")
    .sort((a, b) => a.distance - b.distance).map((edge) => (edge.from === provinceId ? edge.to : edge.from));
}

/** Men set in an army, all of the one kind it already has. */
export function withMen(world: WorldState, forceId: string, men: number): WorldState {
  return { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id !== forceId ? force : { ...force, authorizedStrength: men, personnel: force.personnel.map((group, index) => (index === 0 ? { ...group, fit: men } : { ...group, fit: 0 })) })) } };
}

/** The context the war's rules are worked in, for a test that calls them directly. */
export function strategyCtx(world: WorldState, polityId: string, enemies: readonly string[]): StrategyContext {
  const ruler = world.characters.find((character) => character.polityId === polityId && character.alive)!;
  return { world, gameId: "war-plan-kit", polityId, ruler, enemies: new Set(enemies), warfare: definition.warfare, clock: definition.clock, provinces: new Map(world.map.provinces.map((province) => [province.id, province] as const)) };
}

/** Rome's army before the walls of Carthage's port, with the siege laid. */
export function aSiegeLaid(world: WorldState): WorldState {
  const before = placed(world, "roman-field-army", "afr-9sdex");
  const lay = WorldDeltaSchema.parse({ op: "siege_lay", localId: "kit-siege", forceRef: "roman-field-army", settlementId: null, reason: "The siege is laid." });
  return applyDeltas(before, [lay], context(before, "gaius-genucius") as never).world;
}

/** The first day of a winter, and of a summer, in the scenario's own calendar. */
export function dayInSeason(season: "winter" | "summer"): number {
  for (let day = 100; day < 600; day += 1) {
    const month = monthOfDay(day, definition.clock);
    if (season === "winter" ? isWinterMonth(month) && isWinterMonth(monthOfDay(day + 20, definition.clock)) : isSummerMonth(month) && isSummerMonth(monthOfDay(day + 20, definition.clock))) return day + 5;
  }
  throw new Error("no such season");
}

/** An army with its bread as given. */
export function fed(world: WorldState, forceId: string, provisionStatus: "provisioned" | "shortage" | "critical"): WorldState {
  return { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === forceId ? { ...force, provisionStatus } : force)) } };
}
