import { describe, expect, it } from "vitest";
import { activeControlRecord, seedControlRecordsFromCache, transferControl, type ControlRecord } from "./authority-records";

describe("transferControl (docs/32, Part C.4)", () => {
  it("opens a new active record and leaves no other active record at the same location", () => {
    const after = transferControl([], { id: "c1", locationKind: "province", locationId: "sicily", controllerPolityId: "rome", firmnessBps: 5_000, atStep: 1 });
    expect(after).toHaveLength(1);
    expect(activeControlRecord(after, "province", "sicily")?.controllerPolityId).toBe("rome");
  });

  it("ends the previously active record at the same location when control changes hands", () => {
    const first = transferControl([], { id: "c1", locationKind: "province", locationId: "sicily", controllerPolityId: "carthage", firmnessBps: 5_000, atStep: 1 });
    const second = transferControl(first, { id: "c2", locationKind: "province", locationId: "sicily", controllerPolityId: "rome", firmnessBps: 4_000, atStep: 5 });
    const carthageRecord = second.find((r) => r.id === "c1")!;
    expect(carthageRecord.status).toBe("ended");
    expect(carthageRecord.endedAtStep).toBe(5);
    expect(activeControlRecord(second, "province", "sicily")?.controllerPolityId).toBe("rome");
  });

  it("leaves a different location's control record untouched", () => {
    const first = transferControl([], { id: "c1", locationKind: "province", locationId: "sicily", controllerPolityId: "carthage", firmnessBps: 5_000, atStep: 1 });
    const second = transferControl(first, { id: "c2", locationKind: "province", locationId: "latium", controllerPolityId: "rome", firmnessBps: 5_000, atStep: 2 });
    expect(activeControlRecord(second, "province", "sicily")?.status ?? "active").not.toBe("ended");
    expect(second.find((r) => r.id === "c1")?.status).toBe("active");
  });
});

describe("seedControlRecordsFromCache", () => {
  it("creates one active record per controlled location from the cached field", () => {
    const seeded = seedControlRecordsFromCache(
      [
        { kind: "province", id: "sicily", controllerPolityId: "rome" },
        { kind: "province", id: "unclaimed", controllerPolityId: null },
      ],
      [],
      1,
    );
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.locationId).toBe("sicily");
  });

  it("is idempotent -- a location that already has an active record is not seeded again", () => {
    const existing: ControlRecord[] = [{
      id: "existing", locationKind: "province", locationId: "sicily", controllerPolityId: "carthage",
      firmnessBps: 5_000, startedAtStep: 0, endedAtStep: null, status: "active",
    }];
    const seeded = seedControlRecordsFromCache(
      [{ kind: "province", id: "sicily", controllerPolityId: "rome" }],
      existing,
      1,
    );
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.controllerPolityId).toBe("carthage");
  });
});
