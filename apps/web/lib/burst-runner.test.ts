import { describe, expect, it } from "vitest";
import { burstDeadlineMs, workNotDone } from "./burst-runner";
import { BURST_DEADLINE_MS } from "./burst-status";
import { SAVE_NEEDS_REPAIR, unopenableSave } from "./save-errors";

describe("what a burst set down is kept with it", () => {
  it("files every skipped call, unreadable answer and salvaged field as a row", () => {
    const rows = workNotDone({
      skipped: [{ stage: "cognition", reason: "hop 3: the call budget is spent; 4 left unasked" }, { stage: "mechanic", reason: "levy: stands without one" }],
      parseFailures: ["fact reconciliation: not JSON"],
      salvaged: ["deltas.2: unknown op"],
    });
    expect(rows).toEqual([
      { stage: "cognition", reason: "hop 3: the call budget is spent; 4 left unasked" },
      { stage: "mechanic", reason: "levy: stands without one" },
      { stage: "unreadable", reason: "fact reconciliation: not JSON" },
      { stage: "salvaged", reason: "deltas.2: unknown op" },
    ]);
  });
});

describe("the burst's deadline", () => {
  it("is the default for a provider, none for a burst answered by hand, and whatever the environment says otherwise", () => {
    expect(burstDeadlineMs({})).toBe(BURST_DEADLINE_MS);
    expect(burstDeadlineMs({ CHRONICA_AI_MODE: "hand" })).toBeNull();
    expect(burstDeadlineMs({ CHRONICA_AI_MODE: "hand", CHRONICA_BURST_DEADLINE_MS: "60000" })).toBe(60_000);
    expect(burstDeadlineMs({ CHRONICA_BURST_DEADLINE_MS: "0" })).toBeNull();
  });
});

describe("a save that will not open", () => {
  it("is told to the player as needing repair, and nothing else is", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(unopenableSave(named("SaveNeedsRepairError"))).toBe(SAVE_NEEDS_REPAIR);
    expect(unopenableSave(named("ScenarioDefinitionUnreadableError"))).toBe(SAVE_NEEDS_REPAIR);
    expect(unopenableSave(new Error("the database is down"))).toBeNull();
    expect(unopenableSave("a string")).toBeNull();
  });
});
