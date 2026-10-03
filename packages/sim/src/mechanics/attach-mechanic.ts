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
 * Refused for money: an owner who cannot afford it -- the setup and three
 * months of its keep come to more than half of what he holds, or the setup
 * would have to be bought on credit -- keeps a plain arrangement, and the
 * audit says so, unless the order itself said to pay for it.
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
  /** The order the arrangement came of, where there was one: whether it said to pay. */
  readonly orderText?: string | null | undefined;
}

export type AttachOutcome =
  | { readonly ok: true; readonly world: WorldState; readonly facts: readonly FactProposalDraft[]; readonly mechanic: Mechanic }
  | { readonly ok: false; readonly reason: string };

/** Of what the owner holds, the most a rule's setup and three months of its keep may come to. */
const AFFORDABLE_SHARE = 0.5;
/** And what he keeps back, which no rule's setup is paid out of. */
const KEPT_BACK_SHARE = 0.1;
const KEEP_MONTHS = 3;
/** Words that say the order meant money to be spent. */
const NAMES_PAYING = /\b(pay|pays|paid|paying|spend|spends|spent|spending|fund|funds|funding|finance|financing|buy|buys|bought|hire|hires|cost|costs|drachm\w*|denar\w*|silver|coins?|money|purse|outlay|subsid\w*|bribe\w*|reward\w*|dole|grain)\b/i;

/** Whether the order said to spend money: then a rule may cost what it costs. */
export function orderNamesPaying(orderText: string | null | undefined): boolean {
  return orderText != null && NAMES_PAYING.test(orderText);
}

/** Kinds of thing a rule is never written for: what a man is doing, and what is said or felt rather than run. */
const NOT_A_RULE = /pursuit|letter|message|petition|correspondence|request|appeal|greeting|courtesy|respect|regard|visit|audience|friendship|favou?r|gift|condolence|congratulation|introduction|speech|oath|promise/i;

/**
 * Whether an arrangement is worth offering to the mechanic writer (play-test E20).
 *
 * A letter of respect became a rule that fired every month and paid for the
 * privilege: pursuits and letters were offered like any toll-house. Never a
 * pursuit, nor anything that is a letter, a petition or a courtesy by its kind
 * or its name; nor anything kept from an act the engine already prices -- a
 * venture, an estate or an income kept as an arrangement pays by its own
 * effect, and a rule on it would be a second price for the same business.
 * What was kept from the model's own arrangement is still its own.
 */
export function worthARule(entity: { readonly kind: string; readonly label: string }, keptFrom: string | null): boolean {
  if (entity.kind === "law" || entity.kind === "pursuit") return false;
  if (NOT_A_RULE.test(entity.kind) || NOT_A_RULE.test(entity.label)) return false;
  if (keptFrom !== null && keptFrom !== "generic_entity_create" && keptFrom !== "project_create") return false;
  return true;
}

export function attachMechanic(input: AttachInput): AttachOutcome {
  const { entity, draft, refs } = input;
  const day = input.world.instant.day;
  const movesMoney = draft.effects.some((effect) => effect.op === "money_transfer");
  const price = priceMechanic(input.world, entity, refs.ownerPolityId, draft.price, movesMoney);
  const facts: FactProposalDraft[] = [];
  let world = input.world;

  if (refs.ownerAccountId === null) return { ok: false, reason: `${refs.owner.id} has no purse to pay for the rule with` };
  const held = world.material.accounts.find((account) => account.id === refs.ownerAccountId)?.balance ?? 0;
  const bill = price.setup + KEEP_MONTHS * price.keepPerMonth;
  if (bill > 0 && !orderNamesPaying(input.orderText)) {
    if (bill > held * AFFORDABLE_SHARE) return { ok: false, reason: `the rule would cost ${price.setup} and ${price.keepPerMonth} a month, more than half of the ${held} ${refs.owner.id} holds, and the order said nothing of paying for it` };
    if (price.setup > held - Math.ceil(held * KEPT_BACK_SHARE)) return { ok: false, reason: `the rule's ${price.setup} would have to be bought on credit, and the order said nothing of paying for it` };
  }
  if (price.setup > 0) {
    try {
      world = payOrBorrow(world, refs.ownerAccountId, price.setup, `the rule behind ${entity.label}`, null, {
        now: world.instant, actorRef: refs.owner, offices: input.offices, warfare: input.warfare, ids: input.ids, gameId: input.gameId,
      }, (fact) => facts.push(fact));
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
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
