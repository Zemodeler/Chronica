import { describe, expect, it } from "vitest";
import { effortOverrideFor, modelOverrideFor } from "./operation-overrides";

describe("per-operation measuring knobs", () => {
  it("name a model for one operation and leave the others alone", () => {
    const env = { CHRONICA_AI_MODEL_SIMULATE_COGNITION: "gpt-5-nano" };
    expect(modelOverrideFor("simulate_cognition", env)).toBe("gpt-5-nano");
    expect(modelOverrideFor("simulate_orchestrate", env)).toBeUndefined();
  });
  it("accept only a real effort level", () => {
    expect(effortOverrideFor("compose_chronicle", { CHRONICA_AI_EFFORT_COMPOSE_CHRONICLE: "medium" })).toBe("medium");
    expect(effortOverrideFor("compose_chronicle", { CHRONICA_AI_EFFORT_COMPOSE_CHRONICLE: "maximal" })).toBeUndefined();
    expect(effortOverrideFor("compose_chronicle", {})).toBeUndefined();
  });
});
