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

/** Parameter-key suffix -> the resource kind that key names, mirroring `workflows/diagnose.ts`'s own `KEY_KIND_BY_SUFFIX` for the same reason: a call's own argument names tell you what it claims without a per-workflow declaration. */
const CLAIM_KIND_BY_PARAM_SUFFIX: readonly (readonly [string, ReservationKind])[] = [
  ["forceid", "force"],
  ["accountid", "account"],
  ["officeid", "office"],
];

export interface ResourceClaim {
  readonly kind: ReservationKind;
  readonly resourceId: string;
}

/**
 * What a plan stage claims exclusive use of while it runs (unified action
 * runtime, Stage 6): the acting character's own time, always, plus whichever
 * of the call's own id parameters name a force, an account, or an office --
 * found generically from the parameter key's own suffix, not a per-workflow
 * declaration. A stage with no such parameter (a read, a social act) still
 * claims its actor's time; that alone is enough to keep two plans from
 * scheduling the same character into two unfinished stages at once.
 */
export function claimedResourcesForStage(actorId: string, parameters: Record<string, unknown>): ResourceClaim[] {
  const claims: ResourceClaim[] = [{ kind: "character_time", resourceId: actorId }];
  const seen = new Set(claims.map((c) => `${c.kind}:${c.resourceId}`));
  const add = (kind: ReservationKind, resourceId: string) => {
    const key = `${kind}:${resourceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, resourceId });
  };
  for (const [key, value] of Object.entries(parameters)) {
    if (!/Id$|Ids$/.test(key)) continue;
    const normalized = key.toLowerCase().replace(/s$/, "");
    const match = CLAIM_KIND_BY_PARAM_SUFFIX.find(([suffix]) => normalized.endsWith(suffix));
    if (!match) continue;
    const [, kind] = match;
    const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    for (const id of ids) add(kind, id);
  }
  return claims;
}
