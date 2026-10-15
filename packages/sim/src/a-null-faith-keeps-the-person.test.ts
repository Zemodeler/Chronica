import { describe, expect, it } from "vitest";
import { WorldDeltaSchema } from "@chronica/shared";
import { readLeniently } from "./bare-refs";

/**
 * A person made with no faith said is still made (docs/reports/consul-run-issues.md, M3). "faith": null was refused, so a
 * ruler written with it was dropped whole, and the army that named him was raised under a stand-in called after his handle:
 * "Marsic Meddix", "Umbrian Marones". A null where a value or nothing is wanted is now read as nothing said.
 */
const answer = (faith: unknown) => ({ deltas: [{
  op: "character_create", localId: "marsic_meddix", name: "Novius Vettius", polityId: "marsi-paeligni", provinceId: null, age: 48,
  officeLabel: "Meddix of the Marsi and Paeligni", traits: ["proud"], kin: null, faith, generatedBecause: "The Marsi had nobody in the record.",
}] });
const schema = { safeParse: (value: unknown) => {
  const deltas = (value as { deltas: unknown[] }).deltas.map((delta) => WorldDeltaSchema.safeParse(delta));
  const failed = deltas.flatMap((parsed, index) => (parsed.success ? [] : parsed.error.issues.map((issue) => ({ ...issue, path: ["deltas", index, ...issue.path] }))));
  return failed.length === 0 ? { success: true as const, data: deltas.map((parsed) => parsed.data) } : { success: false as const, error: { issues: failed } };
} };

describe("a person made with no faith said", () => {
  it("is made, the null left out, and the record says what was left out", () => {
    const read = readLeniently(schema, answer(null), () => null);
    expect(read.parsed.success).toBe(true);
    expect(read.parsed.success && read.parsed.data).toHaveLength(1);
    expect(read.dropped[0]).toMatch(/^deltas\.0: faith/);
  });
});
