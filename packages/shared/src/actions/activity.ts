import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema } from "../material-state";
import type { WorldState } from "../world/world-state";

export const ActorActivitySchema = z.object({ actorId: EntityIdSchema, atStep: ElapsedStepSchema, usedBps: z.number().int().min(0).max(10_000) }).strict();
/** Fractions of a character's turn, not extra world-clock ticks per tool call. */
export function actionTimeCost(actionId: string, category?: string): number {
  if (actionId === "move_character") return 10_000;
  if (!category) return 5_000;
  if (category === "narrative" || actionId.startsWith("rename_")) return 0;
  if (category === "military" || category === "material") return 2_500;
  return 1_250;
}

/** Charge the people who actually travel, even when a custom action moved them. */
export function chargeActivity(before: WorldState, after: WorldState, actorId: string, actionId: string, category: string | undefined, atStep: number): WorldState | string {
  const charges = new Map([[actorId, actionTimeCost(actionId, category)]]);
  for (const character of before.characters) {
    const updated = after.characters.find(c => c.id === character.id);
    if (updated && updated.locationProvinceId !== character.locationProvinceId) charges.set(character.id, 10_000);
  }
  const activities = (before.actorActivities ?? []).filter(a => a.atStep === atStep && !charges.has(a.actorId));
  for (const [id, cost] of charges) {
    const used = before.actorActivities?.find(a => a.actorId === id && a.atStep === atStep)?.usedBps ?? 0;
    if (used + cost > 10_000) return `${before.characters.find(c => c.id === id)?.name ?? "The executor"} lacks time for this activity this turn.`;
    activities.push({ actorId: id, atStep, usedBps: used + cost });
  }
  return { ...after, actorActivities: activities };
}
