import { describe, expect, it } from "vitest";
import { GenericEntitySchema, type WorldState } from "@chronica/shared";
import { decideAudits, SHORT_CHEST_SHARE } from "./close-of-office";
import { applyDecision, atDay, input as fiscalInput, opening as fiscalOpening } from "./fiscal-test-kit";
import { holderOf, withTheft } from "./accounts-test-kit";

/**
 * The censors go through the books.
 *
 * At the lustrum the censors open the books of the Treasury of Saturn for two months, and on suspicion (the chest short of what the roll promised) too; never
 * twice in the season, never while the same books are being read, never of their own. What the audit finds the praetor brings as a case (`a-praetor-hears-the-case`).
 */
const audits = (world: WorldState, day: number) => decideAudits({ ...fiscalInput(atDay(world, day), "carthage"), warfare: undefined as never }).filter((d) => d.polityId === "rome");
const census = (world: WorldState, at: number): WorldState => ({
  ...world, genericEntities: [...world.genericEntities, GenericEntitySchema.parse({ id: "census-rome-test", kind: "census", label: "The census of Rome", ownerRef: { kind: "polity", id: "rome" }, attributes: { atStep: at, counted: 1_100_000, by: "manius-curius" }, createdAtStep: at })],
});

describe("the censors go through the books", () => {
  const base = fiscalOpening(300);

  it("opens the Treasury's books at the lustrum, by a censor", () => {
    const world = census(base, 280);
    const [decision] = audits(world, 300);
    expect(decision).toBeDefined();
    expect(decision!.why).toMatch(/^audit: .*the lustrum/);
    const censors = world.material.officeSeats.filter((s) => s.officeId === "roman-censor").map((s) => s.holderCharacterId);
    expect(censors).toContain(decision!.actorCharacterId);
    expect(decision!.deltas[0]).toMatchObject({ op: "audit_open", departmentRef: "rome-aerarium" });
    const done = applyDecision(world, decision!, 300);
    expect(done.rejected).toEqual([]);
    expect(done.world.audits.at(-1)).toMatchObject({ status: "under_way", departmentId: "rome-aerarium", dueAtStep: 360 });
    // The same books are not gone through twice at once.
    expect(audits(done.world, 330)).toEqual([]);
  });

  it("leaves the books alone when no lustrum is near and nothing is spoken of", () => {
    expect(audits(base, 300)).toEqual([]);
    expect(audits(census(base, 100), 300)).toEqual([]);
  });

  it("opens them on suspicion when the chest is short of what the roll promised", () => {
    const quaestor = holderOf(base, "roman-quaestor");
    const short = withTheft(base, quaestor.id, "rome", 8, 400_000);
    expect(SHORT_CHEST_SHARE).toBeGreaterThan(0);
    const days = Array.from({ length: 12 }, (_, n) => 300 + n * 30);
    const opened = days.find((day) => audits(short, day).length > 0);
    expect(opened).toBeDefined();
  });

  it("never lets a censor go through his own books", () => {
    const world = census(base, 280);
    const [decision] = audits(world, 300);
    const target = world.departments.find((d) => d.id === (decision!.deltas[0] as { departmentRef: string }).departmentRef)!;
    const own = world.material.officeSeats.filter((s) => target.officeIds.includes(s.officeId) && s.status === "held").map((s) => s.holderCharacterId);
    expect(own).not.toContain(decision!.actorCharacterId);
  });
});
