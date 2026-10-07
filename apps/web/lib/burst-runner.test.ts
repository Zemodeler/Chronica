import { describe, expect, it } from "vitest";
import { burstDeadlineMs, turnBudgetMs, workNotDone } from "./burst-runner";
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
    expect(burstDeadlineMs({}, true)).toBeNull();
    expect(burstDeadlineMs({ CHRONICA_AI_MODE: "hand" }, false)).toBe(BURST_DEADLINE_MS);
    expect(burstDeadlineMs({ CHRONICA_BURST_DEADLINE_MS: "60000" }, true)).toBe(60_000);
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

describe("the time a turn is given", () => {
  const codex = { CHRONICA_HAND_RESPONDER: "codex" };
  it("is a minute and a quarter for a week and four minutes for a month", () => {
    expect(turnBudgetMs(7, codex)).toBe(75_000);
    expect(turnBudgetMs(30, codex)).toBe(224_500);
    expect(turnBudgetMs(14, codex)).toBe(120_500);
    expect(turnBudgetMs(365, codex)).toBe(240_000);
  });
  it("is unlimited for a provider that answers in its own time, and can be set by hand", () => {
    expect(turnBudgetMs(30, {})).toBeNull();
    expect(turnBudgetMs(30, { CHRONICA_TURN_BUDGET_MS: "60000" })).toBe(60_000);
  });
});
