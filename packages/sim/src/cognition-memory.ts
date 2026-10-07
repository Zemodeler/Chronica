import { COGNITION_REVIEW_DAYS, COGNITION_REVIEW_VERSION, answerDueOf, type CognitionReview, type ScenarioClock, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { renderCharacterPortrait } from "./cognition";
import { stateCrisisLine } from "./kept-by-the-officers";

/** Ignore countdown prose in the comparison only; prompts and the simulation clock remain unchanged. */
function circumstances(text: string): string {
  return text.split("\n").map((line) => {
    if (/^ {6}(next|then) \[/.test(line)) {
      return line.replace(/\(in (\d+) days\)/g, (whole, days: string) => Number(days) > 1 ? "(upcoming)" : whole);
    }
    if (line.startsWith("Their power is at war with ")) return line.replace(/, and has been for \d+ days\b/, ", and is ongoing");
    return line.replace(/^(the .+ votes on ".+" \[[^\]]+\] in )(\d+)( days;)/,
      (whole, before: string, days: string, after: string) => Number(days) > 1 ? `${before}upcoming${after}` : whole);
  }).join("\n");
}

/** What the actor can act on, without the closing date, routing score or changing cast composition. */
export function cognitionDecisionContext(actor: RoutedActor, world: WorldState, clock: ScenarioClock, wanted?: string): string {
  const orders = world.orderAttempts.filter((attempt) => attempt.recipientRef.id === actor.characterId);
  return JSON.stringify([
    circumstances(renderCharacterPortrait(actor.characterId, actor.name, world, clock, { routineIsKept: true })),
    stateCrisisLine(world, actor.characterId),
    circumstances(wanted ?? ""), actor.note ?? null,
    orders.map((attempt) => [attempt, world.elapsedStep >= answerDueOf(attempt)]),
  ]);
}

/** A short, stable hash for comparing what a person last decided on. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * What each person was last asked about and decided on. It starts from the
 * reviews the world kept (`WorldState.cognitionReviews`, S4): a later burst
 * does not buy everybody a first review, only the people whose circumstances
 * changed or whose last review is older than `COGNITION_REVIEW_DAYS`. Reviews
 * of another policy version are ignored.
 */
export function createCognitionMemory(saved: readonly CognitionReview[] = [], nowStep = 0) {
  const contexts = new Map<string, { context: string; reason: string; atStep: number }>();
  const weights = new Map<string, number>();
  for (const review of saved) {
    if (review.version !== COGNITION_REVIEW_VERSION || nowStep - review.atStep > COGNITION_REVIEW_DAYS) continue;
    contexts.set(review.characterId, { context: review.context, reason: review.reason, atStep: review.atStep });
    weights.set(review.characterId, review.weight);
  }
  return {
    weights,
    changed(actor: RoutedActor, world: WorldState, clock: ScenarioClock, wanted?: string): boolean {
      const previous = contexts.get(actor.characterId);
      return previous === undefined || previous.context !== hashOf(cognitionDecisionContext(actor, world, clock))
        || (wanted !== undefined && previous.reason !== hashOf(circumstances(wanted)));
    },
    remember(actor: RoutedActor, world: WorldState, clock: ScenarioClock, wanted: string | undefined, answerSize: number): void {
      contexts.set(actor.characterId, { context: hashOf(cognitionDecisionContext(actor, world, clock)), reason: hashOf(circumstances(wanted ?? "")), atStep: world.elapsedStep });
      weights.set(actor.characterId, Math.max(1, answerSize));
    },
    /** What to keep on the world: the freshest reviews, at most as many as the world holds. */
    snapshot(nowStep: number): CognitionReview[] {
      return [...contexts.entries()]
        .filter(([, entry]) => nowStep - entry.atStep <= COGNITION_REVIEW_DAYS)
        .sort((a, b) => b[1].atStep - a[1].atStep)
        .slice(0, 200)
        .map(([characterId, entry]) => ({ characterId, context: entry.context, reason: entry.reason, atStep: entry.atStep, weight: Math.min(10_000, weights.get(characterId) ?? 1), version: COGNITION_REVIEW_VERSION }));
    },
  };
}
