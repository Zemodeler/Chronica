import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  economyOf,
  ensureProvinceMaterial,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { ensureConstitutions } from "./constitutions";
import { createIdFactory } from "./ports";

/**
 * A kit for the tests of who may do what (docs/plans/government.md, "H0 as built"): the Punic opening with its
 * constitutions seated, set to a day, and the acts of the twelve written as the engine reads them.
 */
export const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
export const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };

export function opening(day = 200): WorldState {
  const world = ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government, toDay: 0 });
  return { ...world, instant: { day, minute: 0 }, elapsedStep: day };
}

export const atDay = (world: WorldState, day: number): WorldState => ({ ...world, instant: { ...world.instant, day }, elapsedStep: day });

/** The context an act is applied in, by this man, with the acts named as the order's own where `order` says so. */
export function as(characterId: string, day: number, order: readonly WorldDelta[] = []): ApplyContext {
  return {
    now: { day, minute: 540 }, actorRef: { kind: "character", id: characterId }, offices: government.offices, successionRules: government.successionRules,
    warfare: definition.warfare, terrains: definition.map.terrains, clock: definition.clock, ids: createIdFactory(`gov-${characterId}-${day}`), gameId: "game-gov",
    ...(order.length === 0 ? {} : { orderDeltas: new Set(order) }),
  };
}

/** One act, parsed as the engine parses every answer so each op carries its defaults, applied by a man. */
export function act(world: WorldState, characterId: string, raw: Record<string, unknown>, options: { readonly order?: boolean; readonly context?: Partial<ApplyContext> } = {}) {
  const delta = WorldDeltaSchema.parse(raw);
  return applyDeltas(world, [delta], { ...as(characterId, world.elapsedStep, options.order === true ? [delta] : []), ...options.context });
}

/** The men who hold an office, in seat order. */
export const holdersOf = (world: WorldState, officeId: string): string[] =>
  world.material.officeSeats.filter((seat) => seat.officeId === officeId && seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!);

export const taxSet = (polityId: string, rateBps: number, scope: "polity" | "customs" = "polity") => ({
  op: "tax_policy_set", scope, polityId, provinceId: null, regime: "land_levy", rateBps, reason: "The rate is set.",
});

export const rateOf = (world: WorldState, polityId: string): number | undefined => economyOf(world).taxPolicies.find((policy) => policy.polityId === polityId)?.rateBps;
export const customsOf = (world: WorldState, polityId: string): number | undefined => economyOf(world).customsRates.find((entry) => entry.polityId === polityId)?.rateBps;
export const chestOf = (world: WorldState, polityId: string) => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)!;

/** The opinion one man holds of another, set. */
export function thinksIll(world: WorldState, subjectId: string, ofId: string, score = -60): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === subjectId
      ? { ...character, relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== ofId), {
        subjectCharacterId: ofId, causes: [{ id: `ill-${subjectId}-${ofId}`, label: "Quarrelled.", score, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }],
      }] }
      : character)),
  };
}

/** An act already parsed -- the one a refusal handed back -- applied again as what the chamber's vote made it: its own authority. */
export function actCarried(world: WorldState, characterId: string, delta: WorldDelta) {
  return applyDeltas(world, [delta], { ...as(characterId, world.elapsedStep, [delta]), sanctionedDeltas: new Set([delta]) });
}
