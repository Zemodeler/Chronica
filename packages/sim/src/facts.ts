import {
  addMinutes,
  emitFacts,
  type Fact,
  type FactDraft,
  type FactProposal,
  type WorldInstant,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

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
  readonly proposals: readonly FactProposal[];
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
}

export function materializeFacts(input: MaterializeFactsInput): MaterializedFacts {
  const factIds = new Map<string, string>();

  const drafts: FactDraft[] = input.proposals.map((proposal) => {
    const timed = proposal.discoveryState === "delayed" || proposal.discoveryState === "rumoured" || proposal.discoveryState === "intercepted";
    return {
      time: input.now,
      atStep: input.atStep,
      kind: proposal.kind,
      summary: proposal.summary,
      affectedEntities: proposal.affectedRefs.map((ref) => ({
        kind: ref.kind,
        id: input.assignedIds.get(ref.id.replace(/^local:/, "")) ?? ref.id,
      })),
      resourceChanges: [],
      authorityChange: undefined,
      visibility: proposal.visibility,
      discovery: {
        state: proposal.discoveryState,
        knowableAtInstant: timed ? addMinutes(input.now, proposal.knowableInDays * 1440) : null,
        discoveredBy: [],
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
  facts.forEach((fact, index) => {
    const proposal = input.proposals[index];
    if (proposal === undefined) return;
    factIds.set(proposal.localId, fact.id);
    significanceByFactId.set(fact.id, proposal.significance);
  });

  const significance = input.proposals.reduce((sum, proposal) => sum + proposal.significance, 0);
  return { facts, factIds, significanceByFactId, significance };
}
