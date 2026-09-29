import {
  EFFECT_PERIOD_DAYS,
  stableKey,
  type DebitWarrant,
  type FactProposalDraft,
  type GenericEntity,
  type Mechanic,
  type MechanicDraft,
  type Office,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import { payOrBorrow } from "../apply/apply-deltas";
import type { IdFactory } from "../ports";
import { watchReading } from "../watch";
import { mechanicInWords } from "./mechanic-words";
import { priceMechanic, strongerBand } from "./price-mechanic";
import { readableRefsFor, type ReadableRefs } from "./refs";

/**
 * Puts a validated rule on its arrangement: charges the setup, folds the keep
 * into the entity's own upkeep, arms the readings so nothing fires at once,
 * and writes the fact.
 *
 * Refused only for money: an owner who cannot put a quarter of the setup down
 * keeps a plain arrangement, and the audit says so.
 */

export interface AttachInput {
  readonly world: WorldState;
  readonly entity: GenericEntity;
  readonly draft: MechanicDraft;
  readonly origin: Mechanic["origin"];
  readonly warrants: readonly DebitWarrant[];
  readonly refs: ReadableRefs;
  readonly ids: IdFactory;
  readonly offices: readonly Office[];
  readonly warfare: ScenarioWarfareRules;
  readonly gameId: string;
}

export type AttachOutcome =
  | { readonly ok: true; readonly world: WorldState; readonly facts: readonly FactProposalDraft[]; readonly mechanic: Mechanic }
  | { readonly ok: false; readonly reason: string };

export function attachMechanic(input: AttachInput): AttachOutcome {
  const { entity, draft, refs } = input;
  const day = input.world.instant.day;
  const price = priceMechanic(input.world, entity, refs.ownerPolityId, draft.price);
  const facts: FactProposalDraft[] = [];
  let world = input.world;

  if (refs.ownerAccountId === null) return { ok: false, reason: `${refs.owner.id} has no purse to pay for the rule with` };
  try {
    world = payOrBorrow(world, refs.ownerAccountId, price.setup, `the rule behind ${entity.label}`, null, {
      now: world.instant, actorRef: refs.owner, offices: input.offices, warfare: input.warfare, ids: input.ids, gameId: input.gameId,
    }, (fact) => facts.push(fact));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  const mechanic: Mechanic = {
    ...draft,
    attachedAtStep: day,
    origin: input.origin,
    shapeKey: stableKey(draft),
    debitWarrants: [...input.warrants],
    nextDueStep: draft.trigger.kind === "monthly" ? day + EFFECT_PERIOD_DAYS : null,
    armedReading: draft.trigger.kind === "when" ? watchReading(draft.trigger.predicate, world) : null,
    endArmedReading: draft.end.kind === "when" ? watchReading(draft.end.predicate, world) : null,
    endsAtStep: draft.end.kind === "term" ? day + draft.end.days : null,
    setupPaid: price.setup,
    firedCount: 0,
    changedCount: 0,
    lastFiredStep: null,
    emptyFirings: 0,
    endedAtStep: null,
    endedReason: null,
  };
  const current = world.genericEntities.find((candidate) => candidate.id === entity.id) ?? entity;
  const upkeep = price.upkeepBand === null
    ? current.upkeep ?? null
    : { fromAccountId: current.upkeep?.fromAccountId ?? refs.ownerAccountId, band: strongerBand(current.upkeep?.band ?? null, price.upkeepBand) };
  world = {
    ...world,
    genericEntities: world.genericEntities.map((candidate) => (candidate.id === entity.id ? { ...candidate, mechanic, upkeep } : candidate)),
  };
  facts.push({
    localId: `mechanic_written_${entity.id}`.slice(0, 60),
    kind: "mechanic_written",
    summary: `${entity.label} now runs by a rule: ${mechanicInWords(draft, world)}. It cost ${price.setup} to set up.`,
    affectedRefs: [refs.owner, ...(entity.provinceId === null || entity.provinceId === undefined ? [] : [{ kind: "province" as const, id: entity.provinceId }])],
    visibility: "private",
    discoveryState: "private",
    knowableInDays: 0,
    significance: 25,
    knownToRefs: [refs.owner],
  });
  return { ok: true, world, facts, mechanic };
}

export { readableRefsFor };
