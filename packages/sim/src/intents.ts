import type { CharacterIntent, WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";

/**
 * What people mean to do, and when they stop meaning it (character-sim
 * phase 3, the intent's life).
 *
 * An intent was written once and never moved again: an actor who had a
 * "proposed" intent was never given a fresh one, and nothing ever took an
 * intent out of "proposed", so a senator alarmed in March was still "watching
 * events" about March's news in December, and the slice -- which shows the
 * oldest first -- showed that. An intent now lives a month unless something
 * ends it sooner: the man acts (he is asked in his own right), he dies, the
 * reason is replaced by a newer one, or a man already meaning three things
 * lets the least of them go. What has ended is kept a while for the record
 * and then pruned.
 */

/** How long a man goes on meaning to do a thing nobody asked him about. */
export const INTENT_LIFETIME_DAYS = 30;
/** The most open intents one man carries; past this, the least pressing is let go. */
export const MAX_OPEN_INTENTS = 3;
/** How long an ended intent stays on record before it is pruned. */
const ENDED_KEPT_DAYS = 60;
/** The engine's own watching intents, told apart from what the model wrote by their words. */
const WATCHING = "Watching events: ";

export const isOpenIntent = (intent: CharacterIntent): boolean => intent.status === "proposed" || intent.status === "prepared";

/** What a set of intents shows a reader: the most pressing first, the newest among equals. */
export function mostPressingFirst(intents: readonly CharacterIntent[]): CharacterIntent[] {
  return [...intents].sort((a, b) => b.priority - a.priority || b.createdAtStep - a.createdAtStep || a.id.localeCompare(b.id));
}

const end = (intent: CharacterIntent, status: CharacterIntent["status"], why: string, atStep: number): CharacterIntent =>
  ({ ...intent, status, reviewedAtStep: atStep, resolutionReason: why });

/**
 * Every intent moved on to today: lapsed, ended with its man, and the ended
 * ones past keeping pruned. Idempotent.
 */
export function reviewIntents(world: WorldState, atStep: number): WorldState {
  const living = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
  const reviewed = world.characterIntents.flatMap((intent): CharacterIntent[] => {
    if (!isOpenIntent(intent)) {
      return atStep - (intent.reviewedAtStep ?? intent.createdAtStep) > ENDED_KEPT_DAYS ? [] : [intent];
    }
    if (!living.has(intent.actorCharacterId)) return [end(intent, "abandoned", "He did not live to do it.", atStep)];
    const expires = intent.expiresAtStep ?? intent.createdAtStep + INTENT_LIFETIME_DAYS;
    if (expires <= atStep) return [end(intent, "abandoned", "It came to nothing in its time.", atStep)];
    return [intent];
  });
  // A man meaning more than he can hold lets the least of it go.
  const openBy = new Map<string, CharacterIntent[]>();
  for (const intent of reviewed) if (isOpenIntent(intent)) openBy.set(intent.actorCharacterId, [...(openBy.get(intent.actorCharacterId) ?? []), intent]);
  const dropped = new Set<string>();
  for (const open of openBy.values()) for (const intent of mostPressingFirst(open).slice(MAX_OPEN_INTENTS)) dropped.add(intent.id);
  return {
    ...world,
    characterIntents: reviewed.map((intent) => (dropped.has(intent.id) ? end(intent, "abandoned", "Other things pressed harder.", atStep) : intent)),
  };
}

/**
 * Records what the actors who care -- but do not warrant a model call -- mean
 * to do about it (VISION §19's "active" tier), and settles the watching of
 * those who are being asked in their own right this round: they act now, and
 * what they meant to do is what they are doing.
 *
 * Without this the router's middle tier was computed and thrown away every
 * burst. An intent is cheap, deterministic, and visible to the next burst's
 * slice, so a senator who has been quietly alarmed twice is on the record as
 * such before he ever becomes worth a call of his own. A man already
 * watching is given the fresh reason rather than a second intent.
 */
export function recordActiveIntents(
  world: WorldState,
  active: readonly RoutedActor[],
  focused: readonly RoutedActor[],
  ids: { next(prefix: string): string },
): WorldState {
  const atStep = world.elapsedStep;
  const asked = new Set(focused.map((actor) => actor.characterId));
  let intents = world.characterIntents.map((intent) => (isOpenIntent(intent) && asked.has(intent.actorCharacterId) && intent.rationale.startsWith(WATCHING)
    ? end(intent, "executed", "He was asked, and answered for himself.", atStep)
    : intent));

  const fresh: CharacterIntent[] = [];
  for (const actor of active.slice(0, 6)) {
    if (asked.has(actor.characterId)) continue;
    const rationale = `${WATCHING}${actor.why}.`.slice(0, 400);
    const watching = intents.find((intent) => intent.actorCharacterId === actor.characterId && isOpenIntent(intent) && intent.rationale.startsWith(WATCHING));
    if (watching !== undefined) {
      intents = intents.map((intent) => (intent.id === watching.id
        ? { ...intent, rationale, priority: Math.min(100, actor.score), reviewedAtStep: atStep, expiresAtStep: atStep + INTENT_LIFETIME_DAYS }
        : intent));
      continue;
    }
    fresh.push({
      id: ids.next("intent"),
      actorCharacterId: actor.characterId,
      sourceGoalId: null,
      sourcePlotId: null,
      sourceCommitmentId: null,
      actionType: "prepare",
      targetIds: [],
      rationale,
      prerequisites: [],
      intendedWorkflowIds: [],
      priority: Math.min(100, actor.score),
      status: "proposed",
      createdAtStep: atStep,
      reviewedAtStep: null,
      expiresAtStep: atStep + INTENT_LIFETIME_DAYS,
      visibility: "private",
      sourceEventIds: [],
      resolutionReason: null,
    });
  }
  return reviewIntents({ ...world, characterIntents: [...intents, ...fresh] }, atStep);
}
