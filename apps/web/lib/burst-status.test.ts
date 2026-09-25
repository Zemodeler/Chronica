import { describe, expect, it } from "vitest";
import { ABANDONED_ERROR, BURST_STALE_MS, isStale, toBurstStatus, type BurstRow, type ProgressRow } from "./burst-status";

const at = (ms: number) => new Date(1_700_000_000_000 + ms);
const row = (overrides: Partial<BurstRow> = {}): BurstRow => ({
  id: "burst-1", status: "running", error: null, startedAt: at(0), heartbeatAt: at(0), endedAt: null, ...overrides,
});
const progress = (id: number, stage: string, line: string): ProgressRow => ({ id, kind: "progress", payload: { stage, line }, createdAt: at(id * 1000) });

describe("a running burst is alive while it beats", () => {
  it("is running with a fresh heartbeat, however long ago it started", () => {
    expect(isStale(row({ heartbeatAt: at(10 * 60_000) }), at(10 * 60_000 + BURST_STALE_MS - 1))).toBe(false);
  });
  it("is dead once the heartbeat is stale, and the page is told so", () => {
    const view = toBurstStatus(row({ heartbeatAt: at(0) }), [], 0, at(BURST_STALE_MS + 1));
    expect(view.status).toBe("failed");
    expect(view.error).toBe(ABANDONED_ERROR);
  });
  it("falls back to the start when no beat was ever written", () => {
    expect(isStale(row({ heartbeatAt: null }), at(BURST_STALE_MS + 1))).toBe(true);
  });
  it("never calls a finished burst stale", () => {
    expect(isStale(row({ status: "committed", heartbeatAt: at(0), endedAt: at(1) }), at(60 * 60_000))).toBe(false);
    expect(toBurstStatus(row({ status: "committed", endedAt: at(1) }), [], 0, at(60 * 60_000)).status).toBe("committed");
  });
});

describe("progress is handed over incrementally", () => {
  const rows = [progress(1, "orchestrating", "Your order reaches the palace."), progress(2, "advanced", "The world turns."), { id: 3, kind: "chronicle_entry", payload: { title: "x" }, createdAt: at(3000) }];
  it("returns only the lines after the cursor, and moves the cursor past everything seen", () => {
    const view = toBurstStatus(row(), rows, 1, at(0));
    expect(view.progress.map((line) => line.id)).toEqual([2]);
    expect(view.cursor).toBe(3);
  });
  it("keeps the cursor where it was when nothing is new", () => {
    expect(toBurstStatus(row(), [], 7, at(0)).cursor).toBe(7);
  });
  it("does not pass other kinds off as progress lines", () => {
    expect(toBurstStatus(row(), rows, 0, at(0)).progress).toHaveLength(2);
  });
});

describe("passages written so far travel with the status", () => {
  const rows = [
    progress(1, "orchestrating", "Your order reaches the palace."),
    { id: 2, kind: "chronicle_entry", payload: { window: 0, ordinal: 0, kind: "narrated", title: "The Legions", body: "Raised.", date: "1 March", subjects: [{ kind: "polity", id: "rome" }], tags: [], changes: [], quote: null }, createdAt: at(2000) },
    { id: 3, kind: "chronicle_entry", payload: { title: "no body" }, createdAt: at(3000) },
  ];
  it("shapes each passage as an unpublished entry of this burst", () => {
    const view = toBurstStatus(row(), rows, 0, at(0));
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({ id: "burst-1:2", burstId: "burst-1", title: "The Legions", date: "1 March", published: false, unread: true });
    expect(view.cursor).toBe(3);
  });
  it("hands over only the passages after the cursor", () => {
    expect(toBurstStatus(row(), rows, 2, at(0)).entries).toHaveLength(0);
  });
});
