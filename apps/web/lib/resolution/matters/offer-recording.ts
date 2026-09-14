import "server-only";
import {
  resolveMatterRecipients,
  type AuthorityIndex,
  type MatterOffer,
  type WorldInstant,
  type WorldMatter,
  type WorldState,
} from "@chronica/shared";

/**
 * What actually happened for one selected actor this turn, as far as the
 * multi-agent orchestrator (`apps/web/lib/resolution/agents/orchestrator.ts`)
 * can tell right after its actor-decision loop: did it declare anything, and
 * under which (already-merged-into-the-shared-session) intent ids. This is
 * deliberately narrower than `MatterOffer` itself -- the orchestrator has no
 * per-matter knowledge at that point, only per-actor outcomes; matching each
 * outcome back to the matters it actually concerns is this module's job, via
 * the same `resolveMatterRecipients` ladder `matterPriorityActors` used to
 * decide the actor was worth running in the first place.
 */
export interface ActorTurnOutcome {
  readonly characterId: string;
  /** Empty means the actor was offered a matter and did nothing about it this turn. */
  readonly declaredIntentIds: readonly string[];
}

const OFFERABLE_STATUSES: ReadonlySet<WorldMatter["status"]> = new Set(["due", "overdue"]);

function sameInstant(a: WorldInstant, b: WorldInstant): boolean {
  return a.day === b.day && a.minute === b.minute;
}

/**
 * Folds this turn's selected-actor outcomes into each relevant matter's own
 * `offers[]` (docs/plans/ai-world-matters-runtime.md, Phase 2 -- "4. Offer"):
 * `"intent_declared"` (with the actor's `intentIds`) when they declared
 * something, `"no_action"` when they were offered the matter and declared
 * nothing. Only touches actors named in `outcomes` -- an actor this turn
 * never ran gets no offer record at all, same as before this function
 * existed. An offer already updated this same instant (e.g. by
 * `GameMasterSession.declareIntent`'s own `matterIds` handling, which is
 * more precise -- it knows the actor named this exact matter, not just that
 * the ladder would route it to them) is left alone rather than
 * double-recorded; a stale offer from an earlier turn is replaced in place
 * rather than appended, so one actor's record for one matter never grows
 * unbounded.
 *
 * Deviation from the doc's literal description: `authorityIndex` is an
 * explicit parameter, since `resolveMatterRecipients` cannot run without it.
 */
export function recordMatterOffers(
  world: WorldState,
  authorityIndex: AuthorityIndex,
  outcomes: readonly ActorTurnOutcome[],
  atStep: number,
  atInstant: WorldInstant,
): WorldState {
  const matters = world.worldMatters ?? [];
  if (outcomes.length === 0 || matters.length === 0) return world;

  const outcomeByCharacterId = new Map(outcomes.map((o) => [o.characterId, o] as const));
  let anyChanged = false;

  const next = matters.map((matter) => {
    if (!OFFERABLE_STATUSES.has(matter.status)) return matter;
    const { recipients } = resolveMatterRecipients(world, matter, authorityIndex, atStep, null);

    let offers = matter.offers;
    let changed = false;
    for (const recipient of recipients) {
      if (recipient.actorRef.kind !== "character") continue;
      const outcome = outcomeByCharacterId.get(recipient.actorRef.id);
      if (outcome === undefined) continue;

      const alreadyRecordedThisInstant = offers.some(
        (offer) => offer.actorRef.kind === "character" && offer.actorRef.id === recipient.actorRef.id && sameInstant(offer.offeredAt, atInstant),
      );
      if (alreadyRecordedThisInstant) continue;

      const staleIndex = offers.findIndex((offer) => offer.actorRef.kind === "character" && offer.actorRef.id === recipient.actorRef.id);
      const declared = outcome.declaredIntentIds.length > 0;
      const fresh: MatterOffer = {
        actorRef: recipient.actorRef,
        offeredAt: atInstant,
        role: recipient.role,
        knowledgeFactIds: matter.relevantFactIds.slice(0, 8),
        outcome: declared ? "intent_declared" : "no_action",
        intentIds: outcome.declaredIntentIds.slice(0, 4),
      };
      offers = staleIndex === -1 ? [...offers, fresh] : offers.map((offer, index) => (index === staleIndex ? fresh : offer));
      changed = true;
    }
    if (changed) anyChanged = true;
    return changed ? { ...matter, offers } : matter;
  });

  return anyChanged ? { ...world, worldMatters: next } : world;
}
