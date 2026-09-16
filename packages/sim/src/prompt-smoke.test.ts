import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrate";

describe("orchestrator prompt", () => {
  it("renders the contract's JSON schema without throwing", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("money_transfer");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("localId");
  });

  it("stays small enough to send on every call", () => {
    // Roughly 4 characters per token. The system prompt is sent every burst
    // iteration, so a schema that balloons is a per-call tax forever.
    console.log("system prompt chars:", ORCHESTRATOR_SYSTEM_PROMPT.length, "~tokens:", Math.round(ORCHESTRATOR_SYSTEM_PROMPT.length / 4));
    expect(ORCHESTRATOR_SYSTEM_PROMPT.length).toBeLessThan(40_000);
  });
});
