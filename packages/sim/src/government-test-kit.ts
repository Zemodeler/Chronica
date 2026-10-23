import { economyOf, ensureMarkets, type WorldState } from "@chronica/shared";
import { applyDecision, atDay, definition, government, input, opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { decideMagistrates } from "./magistrates";
import type { StatecraftDecision } from "./statecraft";

/**
 * A kit for the tests of the magistrates and the bodies (docs/plans/government.md, "H2 as built", "H3 as built"): the Punic opening, a power set to hunger,
 * the magistrates' month read as the burst reads it, and what a decision does applied.
 */
export { applyDecision, atDay, definition, government, input, opening, withChest, withIncome, withWar };

/** What every grain market of a power says grain costs, as a share of its base price (14,000 is the famine price the rules read as dearth). */
export function famine(opened: WorldState, polityId: string, priceBps = 16_000, hubsHit = Number.POSITIVE_INFINITY): WorldState {
  const world = ensureMarkets(opened);
  const held = new Set(world.map.provinces.filter((province) => province.controllerPolityId === polityId).map((province) => province.id));
  const memory = economyOf(world);
  let left = hubsHit;
  return {
    ...world,
    economy: {
      ...memory,
      markets: memory.markets.map((hub) => (held.has(hub.hubId) && left-- > 0 ? { ...hub, goods: hub.goods.map((good) => (good.good === "grain" ? { ...good, priceBps } : good)) } : hub)),
    },
  };
}

/** The magistrates' decisions for the power the player is not (by default nobody's), at a day. */
export function decideTheMonth(world: WorldState, day: number, options: { readonly player?: string; readonly played?: readonly string[] } = {}): StatecraftDecision[] {
  const there = world.instant.day === day && world.elapsedStep === day ? world : atDay(world, day);
  const base = input(there, options.player ?? "none");
  return decideMagistrates({ ...base, warfare: definition.warfare, playedByModel: new Set(options.played ?? []) });
}

/** The first month from `from`, a month apart, that a decision of the kind appears for the power. */
export function firstMonth(world: WorldState, polityId: string, kind: string | RegExp, from = 120, to = 600, options: Parameters<typeof decideTheMonth>[2] = {}): { readonly day: number; readonly world: WorldState; readonly decision: StatecraftDecision } | undefined {
  for (let day = from; day <= to; day += 30) {
    const there = atDay(world, day);
    const found = decideTheMonth(there, day, options).find((decision) => decision.polityId === polityId && (typeof kind === "string" ? decision.why.startsWith(kind) : kind.test(decision.why)));
    if (found !== undefined) return { day, world: there, decision: found };
  }
  return undefined;
}

/** Applies what the month decided and writes it in the log as the burst does. */
export function carryOut(world: WorldState, decision: StatecraftDecision) {
  const done = applyDecision(world, decision);
  const entry = { day: world.instant.day, polityId: decision.polityId, actorCharacterId: decision.actorCharacterId, act: decision.act, targetPolityId: decision.targetPolityId, why: decision.why };
  return { ...done, world: { ...done.world, statecraft: { ...done.world.statecraft, log: [...done.world.statecraft.log, entry] } } };
}

/** A question laid before a chamber, as the engine writes one, with a day to be put. */
export function question(world: WorldState, input: { readonly id: string; readonly bodyId: string; readonly sponsor: string; readonly label: string; readonly concerns?: readonly string[]; readonly openedAt?: number; readonly votesOn: number; readonly subjectId?: string }): WorldState {
  const procedure = {
    id: input.id, type: "council_deliberation", institutionId: input.bodyId, sponsorCharacterId: input.sponsor, subjectKind: "polity", subjectId: input.subjectId ?? "rome",
    label: input.label, eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote", openedAtStep: input.openedAt ?? 0,
    deadlineStep: input.votesOn, resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [],
    concerns: [...(input.concerns ?? [])],
  } as unknown as WorldState["material"]["politicalProcedures"][number];
  return { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } };
}

export const holdersOfOffice = (world: WorldState, officeId: string): string[] =>
  world.material.officeSeats.filter((seat) => seat.officeId === officeId && seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!);

/** One man thinks ill of another. */
export function ill(world: WorldState, subjectId: string, ofId: string, score = -60): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === subjectId
      ? { ...character, relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== ofId), { subjectCharacterId: ofId, causes: [{ id: `ill-${subjectId}-${ofId}`, label: "Quarrelled.", score, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
      : character)),
  };
}
