import type { OrderPartyRef } from "../actions/orders";

/**
 * Who is actually calling a tool this turn, bound by the orchestrator
 * (`runMultiAgentTurn`) and enforced inside `GameMasterSession` -- never
 * merely instructed in a prompt. A model-supplied `actorId` argument is only
 * ever a claim; `Principal` is the fact.
 *
 * - `player`: the human's own character. Full action surface, but bound to
 *   that one character's identity -- see `actorIdForPrincipal`.
 * - `npc`: one selected character's own agent. Bound to that character.
 * - `star_context`: speaks for a scope (a theatre, a distant polity) with no
 *   single relevant living character. When `representativeCharacterId` is
 *   set, it may act as that living representative; when null, it is
 *   read-only (`canActAsPrincipal` returns false).
 * - `closing`: the turn's closing pass. Read/report only, no mutation.
 * - `system`: unrestricted -- may claim any `actorId`. This is
 *   `GameMasterSession`'s default principal when a call site supplies none,
 *   which is exactly v1's single, omniscient Game Master (it decides and
 *   executes actions for the player's character and every NPC alike, so it
 *   is never bound to one claimable identity) and deterministic engine code
 *   (battle resolution, project ticks). The multi-agent orchestrator is the
 *   only caller that ever narrows this, one bound principal per agent.
 */
export type Principal =
  | { readonly kind: "player"; readonly characterId: string }
  | { readonly kind: "npc"; readonly characterId: string }
  | { readonly kind: "star_context"; readonly representativeCharacterId: string | null; readonly scopeRef: OrderPartyRef }
  | { readonly kind: "closing" }
  | { readonly kind: "system" };

/**
 * The one character id this principal may claim as `actorId` in a tool call,
 * or null when the principal is not bound to any single character (a
 * star-context with no living representative, the closing pass, or the
 * unconstrained system principal -- the last never reaches this check from a
 * model call in practice, but is null here for the same "no claim to bind"
 * reason).
 */
export function actorIdForPrincipal(principal: Principal): string | null {
  switch (principal.kind) {
    case "player":
    case "npc":
      return principal.characterId;
    case "star_context":
      return principal.representativeCharacterId;
    case "closing":
    case "system":
      return null;
  }
}

/** Whether this principal may take any state-changing action at all. */
export function canActAsPrincipal(principal: Principal): boolean {
  if (principal.kind === "closing") return false;
  if (principal.kind === "star_context") return principal.representativeCharacterId !== null;
  return true;
}
