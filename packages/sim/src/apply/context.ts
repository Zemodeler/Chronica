import type {
  AuthorityCheckResult,
  Office,
  OrderPartyRef,
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
  readonly ids: IdFactory;
  readonly gameId: string;
}

export interface AppliedDelta {
  readonly delta: WorldDelta;
  readonly authority: AuthorityCheckResult;
}

export interface RejectedDelta {
  readonly delta: WorldDelta;
  readonly reason: string;
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
  /** `localId` → the id the engine assigned, for resolving references in facts and events. */
  readonly assignedIds: ReadonlyMap<string, string>;
}
