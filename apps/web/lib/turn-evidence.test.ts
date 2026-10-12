import { describe, expect, it } from "vitest";
import type { SimModelPort } from "@chronica/sim";
import { evidencePort, requestHash, type TurnCallKeyInput, type TurnCallStore } from "./turn-evidence";
import { isTransientInfrastructureError } from "./transient-errors";
import { parseTurnInput, turnInput, TURN_INPUT_VERSION } from "./turn-input";

/** `turn_job_calls` in memory, with the same rules as the queries. */
function memoryStore() {
  const rows: (TurnCallKeyInput & { id: number; status: "started" | "answered" | "failed" | "uncertain"; response: string | null; replayedFrom: number | null })[] = [];
  let next = 1;
  const store: TurnCallStore = {
    findReplayable: async (key) => {
      const found = rows.filter((row) => row.burstId === key.burstId && row.requestHash === key.requestHash && row.occurrence === key.occurrence && row.attempt < key.attempt && row.status === "answered" && row.response !== null).sort((a, b) => b.attempt - a.attempt)[0];
      return found === undefined ? undefined : { id: found.id, response: found.response! };
    },
    recordReplayed: async (key, from) => { rows.push({ ...key, id: next++, status: "answered", response: null, replayedFrom: from }); },
    recordStarted: async (key) => { rows.push({ ...key, id: next, status: "started", response: null, replayedFrom: null }); return next++; },
    recordAnswered: async (id, response) => { Object.assign(rows.find((row) => row.id === id)!, { status: "answered", response }); },
    recordFailed: async (id) => { Object.assign(rows.find((row) => row.id === id)!, { status: "failed" }); },
  };
  /** What the next lease does to an attempt that died: whatever it never heard back from is uncertain. */
  const reclaim = (attempt: number) => { for (const row of rows) if (row.attempt < attempt && row.status === "started") row.status = "uncertain"; };
  return { store, rows, reclaim };
}

/** A provider that answers by counting, and can be made to hang on one request (the worker dies mid-call). */
function provider() {
  let calls = 0;
  const port: SimModelPort & { hangOn?: string } = {
    complete: async (operation, _system, user) => {
      if (port.hangOn === user) return new Promise<string>(() => undefined);
      calls += 1;
      return `${operation}:${user}:#${calls}`;
    },
  };
  return { port, calls: () => calls };
}

describe("an attempt keeps the evidence of what it asked", () => {
  it("writes a call down before the provider is asked, and its answer after", async () => {
    const { store, rows } = memoryStore();
    const { port } = provider();
    const { port: recorded } = evidencePort(store, { burstId: "b", attempt: 1 }, port);
    await recorded.complete("orchestrate", "sys", "order");
    expect(rows).toMatchObject([{ attempt: 1, operation: "orchestrate", occurrence: 0, status: "answered", requestHash: requestHash("orchestrate", "sys", "order") }]);
  });

  it("leaves a call the worker died in as started, which the next lease marks uncertain rather than answered", async () => {
    const { store, rows, reclaim } = memoryStore();
    const first = provider();
    first.port.hangOn = "decide";
    const { port: attemptOne } = evidencePort(store, { burstId: "b", attempt: 1 }, first.port);
    await attemptOne.complete("orchestrate", "sys", "order");
    void attemptOne.complete("cognition", "sys", "decide"); // never answers: the process dies here
    await new Promise((resolve) => setTimeout(resolve, 0));
    reclaim(2);
    expect(rows.map((row) => row.status)).toEqual(["answered", "uncertain"]);
  });

  it("hands a later attempt what an earlier one was answered, without asking the provider again", async () => {
    const { store, rows, reclaim } = memoryStore();
    const first = provider();
    first.port.hangOn = "decide";
    const { port: attemptOne } = evidencePort(store, { burstId: "b", attempt: 1 }, first.port);
    const answered = await attemptOne.complete("orchestrate", "sys", "order");
    void attemptOne.complete("cognition", "sys", "decide");
    await new Promise((resolve) => setTimeout(resolve, 0));
    reclaim(2);

    const second = provider();
    const { port: attemptTwo, counts } = evidencePort(store, { burstId: "b", attempt: 2 }, second.port);
    expect(await attemptTwo.complete("orchestrate", "sys", "order")).toBe(answered);
    // The uncertain one is asked again: whether the provider did it the first time is unknown.
    await attemptTwo.complete("cognition", "sys", "decide");
    expect(second.calls()).toBe(1);
    expect(counts).toMatchObject({ asked: 1, replayed: 1 });
    expect(rows.filter((row) => row.attempt === 2).map((row) => [row.status, row.replayedFrom])).toEqual([["answered", 1], ["answered", null]]);
  });

  it("tells the same request asked twice apart by its place, so a replay never answers the second with the first's answer twice over", async () => {
    const { store } = memoryStore();
    const first = provider();
    const { port: attemptOne } = evidencePort(store, { burstId: "b", attempt: 1 }, first.port);
    const a = await attemptOne.complete("chronicle", "sys", "same");
    const b = await attemptOne.complete("chronicle", "sys", "same");
    const { port: attemptTwo } = evidencePort(store, { burstId: "b", attempt: 2 }, provider().port);
    expect([await attemptTwo.complete("chronicle", "sys", "same"), await attemptTwo.complete("chronicle", "sys", "same")]).toEqual([a, b]);
  });

  it("does not make a call it could not first write down", async () => {
    const { store } = memoryStore();
    const { port, calls } = provider();
    const { port: recorded } = evidencePort({ ...store, recordStarted: async () => { throw new Error("database gone"); } }, { burstId: "b", attempt: 1 }, port);
    await expect(recorded.complete("orchestrate", "sys", "order")).rejects.toThrow("database gone");
    expect(calls()).toBe(0);
  });

  it("keeps an answer it could not write down, and counts it as one a later attempt would ask again", async () => {
    const { store } = memoryStore();
    const { port } = provider();
    const { port: recorded, counts } = evidencePort({ ...store, recordAnswered: async () => { throw new Error("database gone"); } }, { burstId: "b", attempt: 1 }, port);
    expect(await recorded.complete("orchestrate", "sys", "order")).toContain("orchestrate");
    expect(counts.unrecorded).toBe(1);
  });
});

describe("what is worth another attempt", () => {
  it("is the database going away, never the turn's own failure", () => {
    expect(isTransientInfrastructureError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientInfrastructureError({ cause: { code: "57P01" } })).toBe(true);
    expect(isTransientInfrastructureError(Object.assign(new Error("dup"), { code: "23505" }))).toBe(false);
    expect(isTransientInfrastructureError(Object.assign(new Error("no credit"), { status: 429 }))).toBe(false);
    expect(isTransientInfrastructureError(null)).toBe(false);
  });
});

describe("the order as stored on its job", () => {
  it("reads back what was written, and nothing written by another version", () => {
    const stored = JSON.parse(JSON.stringify(turnInput({ userId: "u", playerId: "p", characterId: "c", orderText: "Raise two legions.", spanDays: 14, continuation: false, leg: 1, askedAs: undefined })));
    expect(parseTurnInput(stored, TURN_INPUT_VERSION)).toMatchObject({ orderText: "Raise two legions.", spanDays: 14, leg: 1 });
    expect(parseTurnInput(stored, TURN_INPUT_VERSION + 1)).toBeNull();
    expect(parseTurnInput({ ...stored, userId: 7 }, TURN_INPUT_VERSION)).toBeNull();
  });
});
