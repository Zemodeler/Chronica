import type {
  AuthorityCheckResult,
  FactProposal,
  Office,
  OrderPartyRef,
  ScenarioWarfareRules,
  WorldDelta,
  WorldInstant,
  WorldState,
} from "@chronica/shared";
import type { IdFactory } from "../ports";

export interface ApplyContext {
  readonly now: WorldInstant;
  /** Who is acting. Authority is judged against this, and it is never the model's to choose. */
  readonly actorRef: OrderPartyRef;
  /** Scenario offices -- authority derivation needs them and they are not part of `WorldState`. */
  readonly offices: readonly Office[];
  /**
   * The scenario's warfare rules. Like offices, they belong to the scenario
   * rather than the world, and battle resolution cannot proceed without them.
   */
  readonly warfare: ScenarioWarfareRules;
  readonly ids: IdFactory;
  readonly gameId: string;
  /**
   * True when these deltas come from the orchestrator, which speaks for the
   * whole world and not only for the actor whose order it is answering.
   *
   * It matters only for authority. The world giving the Boii a chieftain, or
   * deciding what Carthage privately wants, is not the Roman consul reaching
   * beyond his powers -- but a Carthaginian who moves a Roman legion is, and
   * that case must keep breaching (VISION §12). So the exemption follows who is
   * speaking, not what is being acted on: when a person acts for themselves,
   * everything they do is theirs to answer for.
   */
  readonly actsForTheWorld?: boolean | undefined;
}

export interface AppliedDelta {
  readonly delta: WorldDelta;
  readonly authority: AuthorityCheckResult;
}

export interface RejectedDelta {
  readonly delta: WorldDelta;
  readonly reason: string;
  /**
   * "world" means the world genuinely could not comply -- the treasury was
   * short, the province was not ours. That is friction the player should hear
   * about (VISION §8).
   *
   * "reference" means the proposal named something that does not exist. That is
   * the engine catching a malformed payload, and belongs in the record for
   * debugging rather than in a Chronicle.
   */
  readonly kind: "world" | "reference";
}

/**
 * An act carried out without the authority to carry it out.
 *
 * Not an error: VISION §12 is explicit that a general who marches without
 * orders has not performed an invalid action, he has committed
 * insubordination. The delta applies; the breach is recorded so the world can
 * react to it.
 */
export interface AuthorityBreach {
  readonly delta: WorldDelta;
  readonly reason: string;
}

export interface ApplyResult {
  readonly world: WorldState;
  readonly applied: readonly AppliedDelta[];
  readonly rejected: readonly RejectedDelta[];
  readonly breaches: readonly AuthorityBreach[];
  /**
   * What the engine itself made true while applying the batch.
   *
   * Some acts have consequences the model neither wrote nor could write: a
   * battle produces casualties it is not allowed to author (VISION §3 --
   * arithmetic is the engine's). Those are emitted here and materialized
   * alongside the proposal's own facts, so the world hears about them.
   *
   * Facts emitted by a delta that is then rejected are discarded with it.
   */
  readonly factProposals: readonly FactProposal[];
  /** `localId` → the id the engine assigned, for resolving references in facts and events. */
  readonly assignedIds: ReadonlyMap<string, string>;
}
