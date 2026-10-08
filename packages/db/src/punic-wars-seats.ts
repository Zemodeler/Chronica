/**
 * Which chamber each authored membership office is a seat in (`Office.chamberId`), so no reader has to guess it from what the two are called.
 * A seat that is in no chamber says so with `null`: a military tribune is an officer of his legion, not a member of the Senate; the judges of the
 * Hundred and Four sit in the court, not in the Council of Elders. Notes: docs/plans/scenario-notes-offices.md.
 */
export const SEAT_CHAMBERS: Readonly<Record<string, string | null>> = {
  "roman-senator": "roman-senate",
  "roman-military-tribune": null,
  "carthaginian-elder": "carthaginian-council",
  "carthaginian-judge": "carthaginian-hundred-and-four",
  "syracusan-friend": "syracusan-council",
  "mamertine-councillor": "mamertine-council",
  "campanian-councillor": "campanian-assembly",
};

/** The `chamberId` field for an authored office, where its seat's chamber is known. */
export const seatChamberField = (officeId: unknown): { chamberId?: string | null } =>
  typeof officeId === "string" && Object.prototype.hasOwnProperty.call(SEAT_CHAMBERS, officeId) ? { chamberId: SEAT_CHAMBERS[officeId]! ?? null } : {};
