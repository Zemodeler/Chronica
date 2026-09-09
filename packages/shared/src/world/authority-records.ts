import { z } from "zod";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema } from "../material-state";

// Physical/political separation of a location's standing (docs/32, Part C.4):
// four independent record kinds instead of one cached "controller" field, so
// capturing a province changes who *controls* it without silently erasing
// who still *claims* it, who is physically *occupying* it, or who actually
// *administers* it day to day. `Province.controllerPolityId`/
// `Settlement.controllerPolityId` remain as cached read-path fields -- these
// records are their source of truth (`change_province_control`, the only
// writer, keeps the cache in sync) and the only place the other three kinds
// of standing live at all.

export const AuthorityRecordLocationKindSchema = z.enum(["province", "settlement"]);
export type AuthorityRecordLocationKind = z.infer<typeof AuthorityRecordLocationKindSchema>;

/**
 * De facto control: who actually holds a location right now. At most one
 * *active* record may exist per location -- a second control record for the
 * same place must first close the one before it, the way a controller
 * changing hands is one event, not an overlapping pair.
 */
export const ControlRecordSchema = z
  .object({
    id: EntityIdSchema,
    locationKind: AuthorityRecordLocationKindSchema,
    locationId: EntityIdSchema,
    controllerPolityId: EntityIdSchema,
    firmnessBps: BasisPointsSchema,
    startedAtStep: ElapsedStepSchema,
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    status: z.enum(["active", "ended"]),
  })
  .strict();
export type ControlRecord = z.infer<typeof ControlRecordSchema>;

/**
 * A legal claim to a location -- deliberately unbounded: many polities may
 * claim the same place at once, and a rival taking control never closes
 * another polity's claim on its own. Only an explicit act (a treaty
 * renouncing it, a dynasty dying out) closes one.
 */
export const ClaimRecordSchema = z
  .object({
    id: EntityIdSchema,
    locationKind: AuthorityRecordLocationKindSchema,
    locationId: EntityIdSchema,
    claimantPolityId: EntityIdSchema,
    claimKind: z.enum(["conquest", "inheritance", "purchase", "treaty", "historical", "other"]),
    strengthBps: BasisPointsSchema,
    rationale: z.string().trim().min(1).max(400),
    startedAtStep: ElapsedStepSchema,
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    status: z.enum(["active", "ended"]),
  })
  .strict();
export type ClaimRecord = z.infer<typeof ClaimRecordSchema>;

/** Military presence at a location, distinct from formal control -- an army can occupy ground it has no lawful claim to. */
export const OccupationRecordSchema = z
  .object({
    id: EntityIdSchema,
    locationKind: AuthorityRecordLocationKindSchema,
    locationId: EntityIdSchema,
    occupyingPolityId: EntityIdSchema,
    forceId: EntityIdSchema.nullable().default(null),
    startedAtStep: ElapsedStepSchema,
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    status: z.enum(["active", "ended"]),
  })
  .strict();
export type OccupationRecord = z.infer<typeof OccupationRecordSchema>;

/** Who actually runs a location day to day -- feeds tax capacity, and may lag behind control during a contested handover. */
export const AdministrationRecordSchema = z
  .object({
    id: EntityIdSchema,
    locationKind: AuthorityRecordLocationKindSchema,
    locationId: EntityIdSchema,
    administeringPolityId: EntityIdSchema,
    taxCapacityBps: BasisPointsSchema,
    startedAtStep: ElapsedStepSchema,
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    status: z.enum(["active", "ended"]),
  })
  .strict();
export type AdministrationRecord = z.infer<typeof AdministrationRecordSchema>;

export interface AuthorityRecordCollections {
  readonly controlRecords: readonly ControlRecord[];
  readonly claimRecords: readonly ClaimRecord[];
  readonly occupationRecords: readonly OccupationRecord[];
  readonly administrationRecords: readonly AdministrationRecord[];
}

function locationKey(kind: AuthorityRecordLocationKind, id: string): string {
  return `${kind}:${id}`;
}

/** The single active control record at a location, if any. */
export function activeControlRecord(
  records: readonly ControlRecord[],
  locationKind: AuthorityRecordLocationKind,
  locationId: string,
): ControlRecord | undefined {
  return records.find((r) => r.status === "active" && r.locationKind === locationKind && r.locationId === locationId);
}

/**
 * Ends whatever control record is active at this location (if any) and opens
 * a new one -- the only place `ControlRecord`s change. Never touches
 * `ClaimRecord`s: a location changing hands leaves every existing claim on
 * it exactly as it was.
 */
export function transferControl(
  records: readonly ControlRecord[],
  input: { readonly id: string; readonly locationKind: AuthorityRecordLocationKind; readonly locationId: string; readonly controllerPolityId: string; readonly firmnessBps: number; readonly atStep: number },
): ControlRecord[] {
  const closed = records.map((r) =>
    r.status === "active" && r.locationKind === input.locationKind && r.locationId === input.locationId
      ? { ...r, status: "ended" as const, endedAtStep: input.atStep }
      : r,
  );
  return [
    ...closed,
    {
      id: input.id,
      locationKind: input.locationKind,
      locationId: input.locationId,
      controllerPolityId: input.controllerPolityId,
      firmnessBps: input.firmnessBps,
      startedAtStep: input.atStep,
      endedAtStep: null,
      status: "active",
    },
  ];
}

/**
 * Seeds one active `ControlRecord` per province/settlement from the existing
 * cached `controllerPolityId` field, for a snapshot that predates this
 * schema (migration step 7). Idempotent: a location that already has an
 * active control record is left untouched.
 */
export function seedControlRecordsFromCache(
  locations: readonly { readonly kind: AuthorityRecordLocationKind; readonly id: string; readonly controllerPolityId: string | null; readonly controlFirmnessBps?: number }[],
  existing: readonly ControlRecord[],
  atStep: number,
  idFactory: (kind: AuthorityRecordLocationKind, id: string) => string = (kind, id) => `seed-control-${kind}-${id}`,
): ControlRecord[] {
  const covered = new Set(existing.filter((r) => r.status === "active").map((r) => locationKey(r.locationKind, r.locationId)));
  const seeded: ControlRecord[] = [];
  for (const location of locations) {
    if (location.controllerPolityId === null) continue;
    if (covered.has(locationKey(location.kind, location.id))) continue;
    seeded.push({
      id: idFactory(location.kind, location.id),
      locationKind: location.kind,
      locationId: location.id,
      controllerPolityId: location.controllerPolityId,
      firmnessBps: location.controlFirmnessBps ?? 5_000,
      startedAtStep: atStep,
      endedAtStep: null,
      status: "active",
    });
  }
  return [...existing, ...seeded];
}

/** The single active occupation record at a location, if any. */
export function activeOccupationRecord(
  records: readonly OccupationRecord[],
  locationKind: AuthorityRecordLocationKind,
  locationId: string,
): OccupationRecord | undefined {
  return records.find((r) => r.status === "active" && r.locationKind === locationKind && r.locationId === locationId);
}

/** Ends whatever occupation record is active at this location and opens a new one -- physical presence, independent of `ControlRecord`/`ClaimRecord`. */
export function transferOccupation(
  records: readonly OccupationRecord[],
  input: { readonly id: string; readonly locationKind: AuthorityRecordLocationKind; readonly locationId: string; readonly occupyingPolityId: string; readonly forceId: string | null; readonly atStep: number },
): OccupationRecord[] {
  const closed = records.map((r) =>
    r.status === "active" && r.locationKind === input.locationKind && r.locationId === input.locationId
      ? { ...r, status: "ended" as const, endedAtStep: input.atStep }
      : r,
  );
  return [...closed, { id: input.id, locationKind: input.locationKind, locationId: input.locationId, occupyingPolityId: input.occupyingPolityId, forceId: input.forceId, startedAtStep: input.atStep, endedAtStep: null, status: "active" }];
}

/** Ends an active occupation record without opening a new one -- a withdrawal. */
export function endOccupation(records: readonly OccupationRecord[], locationKind: AuthorityRecordLocationKind, locationId: string, atStep: number): OccupationRecord[] {
  return records.map((r) => (r.status === "active" && r.locationKind === locationKind && r.locationId === locationId ? { ...r, status: "ended" as const, endedAtStep: atStep } : r));
}

/** The single active administration record at a location, if any. */
export function activeAdministrationRecord(
  records: readonly AdministrationRecord[],
  locationKind: AuthorityRecordLocationKind,
  locationId: string,
): AdministrationRecord | undefined {
  return records.find((r) => r.status === "active" && r.locationKind === locationKind && r.locationId === locationId);
}

/** Ends whatever administration record is active at this location and opens a new one -- who actually runs it day to day, which may lag behind `ControlRecord` during a contested handover. */
export function transferAdministration(
  records: readonly AdministrationRecord[],
  input: { readonly id: string; readonly locationKind: AuthorityRecordLocationKind; readonly locationId: string; readonly administeringPolityId: string; readonly taxCapacityBps: number; readonly atStep: number },
): AdministrationRecord[] {
  const closed = records.map((r) =>
    r.status === "active" && r.locationKind === input.locationKind && r.locationId === input.locationId
      ? { ...r, status: "ended" as const, endedAtStep: input.atStep }
      : r,
  );
  return [...closed, { id: input.id, locationKind: input.locationKind, locationId: input.locationId, administeringPolityId: input.administeringPolityId, taxCapacityBps: input.taxCapacityBps, startedAtStep: input.atStep, endedAtStep: null, status: "active" }];
}
