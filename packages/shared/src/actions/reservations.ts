import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema } from "../material-state";

/**
 * Resource reservations (docs/32, Phase 4).
 *
 * A reservation is not consumption -- it prevents two plans from assuming
 * exclusive access to the same character's time, force, account, or office
 * while both are still unfinished. Releasing one changes nothing about
 * resources a stage already spent; see `conflicts.ts`'s preemption rules for
 * what happens to a stage that loses a claim.
 */
export const ReservationKindSchema = z.enum(["character_time", "force", "account", "office"]);
export type ReservationKind = z.infer<typeof ReservationKindSchema>;

export const ResourceReservationSchema = z.object({
  id: EntityIdSchema,
  planId: EntityIdSchema,
  stageId: EntityIdSchema,
  kind: ReservationKindSchema,
  resourceId: EntityIdSchema,
  createdAtStep: ElapsedStepSchema,
  /** Null while the reservation still holds. Never deleted -- a released reservation is history, not erased. */
  releasedAtStep: ElapsedStepSchema.nullable().default(null),
}).strict();
export type ResourceReservation = z.infer<typeof ResourceReservationSchema>;

export function reserveResource(
  reservations: readonly ResourceReservation[],
  input: { planId: string; stageId: string; kind: ReservationKind; resourceId: string; atStep: number },
): ResourceReservation[] {
  const id = `reservation-${input.kind}-${input.resourceId}-${input.planId}-${input.stageId}`;
  if (reservations.some((r) => r.id === id && r.releasedAtStep === null)) return [...reservations];
  return [...reservations, { id, planId: input.planId, stageId: input.stageId, kind: input.kind, resourceId: input.resourceId, createdAtStep: input.atStep, releasedAtStep: null }];
}

export function releaseReservation(reservations: readonly ResourceReservation[], id: string, atStep: number): ResourceReservation[] {
  return reservations.map((r) => (r.id !== id || r.releasedAtStep !== null ? r : { ...r, releasedAtStep: atStep }));
}

/** Releases every reservation a stage still holds -- used when a stage is superseded, cancelled, or interrupted. */
export function releaseStageReservations(reservations: readonly ResourceReservation[], stageId: string, atStep: number): ResourceReservation[] {
  return reservations.map((r) => (r.stageId !== stageId || r.releasedAtStep !== null ? r : { ...r, releasedAtStep: atStep }));
}

export function activeReservations(
  reservations: readonly ResourceReservation[],
  filter: { kind?: ReservationKind; resourceId?: string } = {},
): ResourceReservation[] {
  return reservations.filter((r) =>
    r.releasedAtStep === null &&
    (filter.kind === undefined || r.kind === filter.kind) &&
    (filter.resourceId === undefined || r.resourceId === filter.resourceId));
}
