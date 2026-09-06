import { describe, expect, it } from "vitest";
import { commitmentSafetyNetFired } from "./commitment-safety-net-metrics";

// docs/30/31: same pattern as military-fallback-metrics.test.ts -- the query's
// only real logic is recognizing a fallback firing inside a turn's
// workflow_audit, unit-tested directly since the DB round-trip itself has no
// test harness in this repo.

describe("commitmentSafetyNetFired", () => {
  it("is false for a turn with no workflow_audit", () => {
    expect(commitmentSafetyNetFired(null)).toBe(false);
    expect(commitmentSafetyNetFired(undefined)).toBe(false);
  });

  it("is false for a turn whose audit has no safety-net candidate", () => {
    expect(commitmentSafetyNetFired({ candidates: [{ sourceRef: "game_master", executionOk: true }] })).toBe(false);
  });

  it("is false when the safety net was considered but did not execute", () => {
    expect(commitmentSafetyNetFired({ candidates: [{ sourceRef: "commitment_safety_net", executionOk: false }] })).toBe(false);
  });

  it("is true when a safety-net candidate actually executed", () => {
    expect(commitmentSafetyNetFired({ candidates: [{ sourceRef: "game_master", executionOk: true }, { sourceRef: "commitment_safety_net", executionOk: true }] })).toBe(true);
  });
});
