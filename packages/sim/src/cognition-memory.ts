import { answerDueOf, type ScenarioClock, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { renderCharacterPortrait } from "./cognition";

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
    circumstances(renderCharacterPortrait(actor.characterId, actor.name, world, clock)),
    circumstances(wanted ?? ""), actor.note ?? null,
    orders.map((attempt) => [attempt, world.elapsedStep >= answerDueOf(attempt)]),
  ]);
}

/** Kept within one burst only. A later turn starts with fresh decisions. */
export function createCognitionMemory() {
  const contexts = new Map<string, { context: string; reason: string }>();
  const weights = new Map<string, number>();
  return {
    weights,
    changed(actor: RoutedActor, world: WorldState, clock: ScenarioClock, wanted?: string): boolean {
      const previous = contexts.get(actor.characterId);
      return previous === undefined || previous.context !== cognitionDecisionContext(actor, world, clock)
        || (wanted !== undefined && previous.reason !== circumstances(wanted));
    },
    remember(actor: RoutedActor, world: WorldState, clock: ScenarioClock, wanted: string | undefined, answerSize: number): void {
      contexts.set(actor.characterId, { context: cognitionDecisionContext(actor, world, clock), reason: circumstances(wanted ?? "") });
      weights.set(actor.characterId, Math.max(1, answerSize));
    },
  };
}
