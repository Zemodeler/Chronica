import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema } from "../material-state";

// Per-turn time budgeting (a deterministic cap on how much one actor could do
// in a turn) was removed: whether an actor has time for an action is
// judgement, left to the Game Master. `actorActivities` stays on WorldState
// only as inert, unwritten history for worlds that recorded it previously.
export const ActorActivitySchema = z.object({ actorId: EntityIdSchema, atStep: ElapsedStepSchema, usedBps: z.number().int().min(0).max(10_000) }).strict();
