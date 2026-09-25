import {
  addMinutes,
  emitFacts,
  type Fact,
  type FactDraft,
  type FactProposalDraft,
  type OrderPartyRef,
  type WorldInstant,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/** The longest summary `FactSchema` admits. */
const FACT_SUMMARY_MAX = 600;

/**
 * Turns the model's fact proposals into canonical `Fact`s.
 *
 * The model supplies judgment -- what happened, who it touches, how visible it
 * is, how much it matters. Everything else is the engine's: the id, the
 * timestamp, the causal depth, and when a delayed or rumoured fact actually
 * becomes knowable. That last one is the mechanism behind VISION §16's
 * travelling news: a private arrangement in Rome is simply not knowable in
 * Carthage until enough days have passed, and no prompt has to remember that.
 */

export interface MaterializeFactsInput {
  readonly proposals: readonly FactProposalDraft[];
  readonly now: WorldInstant;
  readonly atStep: number;
  readonly ids: IdFactory;
  readonly causalDepth: number;
  /** localId → assigned id, so a fact can name what this batch created. */
  readonly assignedIds: ReadonlyMap<string, string>;
}

export interface MaterializedFacts {
  readonly facts: readonly Fact[];
  /** Fact localId → assigned fact id, so scheduled events can cite their cause. */
  readonly factIds: ReadonlyMap<string, string>;
  /**
   * Per-fact significance, by fact id. Significance is the actor's judgment of
   * weight, not a property of the fact itself, so it is not part of `Fact` --
   * but it must survive to storage, because accumulated significance is what
   * paces the whole simulation (VISION §22).
   */
  readonly significanceByFactId: ReadonlyMap<string, number>;
  readonly significance: number;
  /** Fact id → the storyline it belongs to (resolved), for the caller to link the thread. */
  readonly storylineByFactId: ReadonlyMap<string, string>;
}

export function materializeFacts(input: MaterializeFactsInput): MaterializedFacts {
  const factIds = new Map<string, string>();

  const resolveId = (id: string): string => input.assignedIds.get(id.replace(/^local:/, "")) ?? id;
  const resolveParty = (ref: OrderPartyRef): OrderPartyRef => ({ kind: ref.kind, id: resolveId(ref.id) });

  const drafts: FactDraft[] = input.proposals.map((proposal) => {
    const timed = proposal.discoveryState === "delayed" || proposal.discoveryState === "rumoured" || proposal.discoveryState === "intercepted";
    return {
      time: input.now,
      atStep: input.atStep,
      kind: proposal.kind,
      // The record's cap on a summary is the schema's, and a model's proposal
      // arrives already within it; an engine-made one -- a project completed
      // with a long account of what it produced -- once ran past it and
      // failed the whole burst. The engine's facts are cut to fit, never
      // refused: nothing the tick says may end a turn.
      summary: proposal.summary.length > FACT_SUMMARY_MAX ? `${proposal.summary.slice(0, FACT_SUMMARY_MAX - 1).trimEnd()}…` : proposal.summary,
      affectedEntities: (proposal.affectedRefs ?? []).map(resolveParty),
      resourceChanges: [],
      authorityChange: undefined,
      visibility: proposal.visibility,
      discovery: {
        state: proposal.discoveryState,
        knowableAtInstant: timed ? addMinutes(input.now, (proposal.knowableInDays ?? 0) * 1440) : null,
        // The people in the room know it the moment it happens. Without this a
        // private fact was known to nobody, its author included, so a plotter
        // could never be woken by their own plot.
        discoveredBy: (proposal.knownToRefs ?? []).map((ref) => ({ observerRef: resolveParty(ref), atInstant: input.now, via: "witnessed" as const })),
      },
      evidence: null,
      eligibleReactionScopes: [],
      sourceEventId: null,
      sourceActionId: null,
      causalDepth: input.causalDepth,
    };
  });

  const facts = emitFacts(drafts, () => input.ids.next("fact"));
  const significanceByFactId = new Map<string, number>();
  const storylineByFactId = new Map<string, string>();
  facts.forEach((fact, index) => {
    const proposal = input.proposals[index];
    if (proposal === undefined) return;
    factIds.set(proposal.localId, fact.id);
    significanceByFactId.set(fact.id, proposal.significance);
    if (proposal.storylineRef !== null && proposal.storylineRef !== undefined) storylineByFactId.set(fact.id, resolveId(proposal.storylineRef));
  });

  const significance = input.proposals.reduce((sum, proposal) => sum + proposal.significance, 0);
  return { facts, factIds, significanceByFactId, significance, storylineByFactId };
}
