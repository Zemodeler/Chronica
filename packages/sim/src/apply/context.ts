import type {
  AuthorityCheckResult,
  FactProposalDraft,
  Office,
  OrderPartyRef,
  ScenarioWarfareRules,
  ScenarioWealthRules,
  TerrainDefinition,
  WorldDelta,
  WorldInstant,
  WorldState,
} from "@chronica/shared";
import type { BattleAccount } from "../battle";
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
  /**
   * The scenario's terrains, so movement can ask what a crossing admits. Also
   * scenario data rather than world state. Optional: a caller that omits them
   * gets adjacency enforced and crossing types unjudged, which is the right
   * behaviour for a scenario that declares no terrain rules at all.
   */
  readonly terrains?: readonly TerrainDefinition[] | undefined;
  /**
   * What a person of a given standing is worth here. Omitted, the engine's
   * own coarse bands apply -- which is still better than believing whatever
   * number came back.
   */
  readonly wealth?: ScenarioWealthRules | undefined;
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
  /**
   * Of the deltas passed, the ones that are the order itself rather than the
   * world moving beside it (the orchestrator's `deltas`, as against its
   * `worldDeltas`).
   *
   * The world speaking may move any power's men; the order may not. An act of
   * the order's inside another power still records no breach -- a Roman is not
   * insubordinate to Carthage -- but its men, money and offices have to answer
   * to him, or nobody moves.
   */
  readonly orderDeltas?: ReadonlySet<WorldDelta> | undefined;
  /**
   * Whose life is the game. A duel or a death that would take the player has
   * to be the player's own act, or follow from something they let happen --
   * captivity -- and never another man's decision alone.
   */
  readonly playerCharacterId?: string | null | undefined;
  /**
   * Local ids already assigned by an earlier pass over the same proposal.
   *
   * A repaired delta may still say `local:new_pay`, because the obligation it
   * names was minted successfully in the first pass and only the delta that
   * referred to it was wrong. Without this the repair cannot see what the
   * first pass created and has to mint everything a second time.
   */
  readonly assignedIds?: ReadonlyMap<string, string> | undefined;
}

export interface AppliedDelta {
  readonly delta: WorldDelta;
  readonly authority: AuthorityCheckResult;
  /** Whether it was one of the order's own acts. */
  readonly ofTheOrder?: boolean | undefined;
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
   *
   * "ignored" means nobody was obliged to do it: somebody gave an order to men,
   * money or ground that answer to someone else (see `nobodyListens`). Not a
   * failure of the world or of the writing -- a public embarrassment, and told
   * as one.
   */
  readonly kind: "world" | "reference" | "ignored";
  /** Whether it was one of the order's own acts, so a corrected version of it is judged as one. */
  readonly ofTheOrder?: boolean | undefined;
}

/**
 * An act the engine carried out after answering part of it itself: a payer
 * that named no account, a place that named no province (see `fillGaps`).
 * Kept so the audit can show what was assumed, and so an assumption that
 * keeps being wrong can be found.
 */
export interface AssumedDetail {
  readonly delta: WorldDelta;
  readonly assumed: readonly string[];
  readonly ofTheOrder: boolean;
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
  readonly factProposals: readonly FactProposalDraft[];
  /**
   * What happened in any battle this batch fought, for whoever writes it up.
   *
   * Carried out beside the facts rather than folded into them: a summary of at
   * most six hundred characters is what a battle used to be reduced to, and
   * that is what made a death in one unearnable.
   */
  readonly battleAccounts: readonly BattleAccount[];
  /** `localId` → the id the engine assigned, for resolving references in facts and events. */
  readonly assignedIds: ReadonlyMap<string, string>;
  /** Applied acts the engine filled a detail of. */
  readonly assumptions: readonly AssumedDetail[];
}
