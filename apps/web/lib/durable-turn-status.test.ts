import { describe, expect, it, vi } from "vitest";
import { BURST_STALE_MS, toBurstStatus, type BurstRow, type ProgressRow } from "./burst-status";

vi.mock("@chronica/ai", () => ({ getSelectedLocalAiProvider: () => "openai" }));

const at = (ms: number) => new Date(1_700_000_000_000 + ms);
const row = (overrides: Partial<BurstRow> = {}): BurstRow => ({
  id: "burst-1", status: "running", error: null, startedAt: at(0), heartbeatAt: at(0), endedAt: null, ...overrides,
});
const passage = (id: number, attempt: number | undefined, ordinal: number, title: string): ProgressRow => ({
  id, kind: "chronicle_entry", createdAt: at(id),
  payload: { ordinal, title, body: "…", kind: "narrated", ...(attempt === undefined ? {} : { attempt }) },
});

describe("a durable turn is judged by its lease, not the row's heartbeat", () => {
  it("stays running while its job is queued, however long since the burst beat", () => {
    const view = toBurstStatus(row({ jobStatus: "queued", attempt: 0, maxAttempts: 3 }), [], 0, at(BURST_STALE_MS * 10));
    expect(view.status).toBe("running");
    expect(view.phase).toBe("queued");
  });

  it("says it is being taken up again once a second attempt holds it", () => {
    const view = toBurstStatus(row({ jobStatus: "leased", attempt: 2, maxAttempts: 3 }), [], 0, at(BURST_STALE_MS * 10));
    expect(view).toMatchObject({ status: "running", phase: "retrying", attempt: 2, maxAttempts: 3 });
  });

  it("still reaps an in-process burst that fell silent", () => {
    expect(toBurstStatus(row(), [], 0, at(BURST_STALE_MS + 1)).status).toBe("failed");
  });
});

describe("provisional passages of an interrupted attempt", () => {
  const rows = [passage(1, 1, 1, "first, attempt one"), passage(2, 1, 2, "second, attempt one"), passage(3, 2, 1, "first, attempt two")];

  it("are not shown once a later attempt holds the turn", () => {
    const view = toBurstStatus(row({ jobStatus: "leased", attempt: 2, maxAttempts: 3 }), rows, 0, at(0));
    expect(view.entries.map((entry) => entry.title)).toEqual(["first, attempt two"]);
    expect(view.entries[0]).toMatchObject({ published: false, attempt: 2 });
  });

  it("carry ids stable for the passage, so asking again never shows one twice", () => {
    const leased = row({ jobStatus: "leased", attempt: 1, maxAttempts: 3 });
    const first = toBurstStatus(leased, rows.slice(0, 2), 0, at(0)).entries.map((entry) => entry.id);
    const again = toBurstStatus(leased, rows.slice(0, 2), 0, at(0)).entries.map((entry) => entry.id);
    expect(first).toEqual(["burst-1:1:1", "burst-1:1:2"]);
    expect(again).toEqual(first);
  });

  it("are all shown for a burst with no job, as before", () => {
    expect(toBurstStatus(row(), rows, 0, at(0)).entries).toHaveLength(3);
  });
});
