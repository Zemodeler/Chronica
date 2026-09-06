import { describe, expect, it } from "vitest";
import { fallbackFired } from "./military-fallback-metrics";

// docs/29: the firing-rate query's only real logic is recognizing a fallback
// firing inside a turn's workflow_audit -- unit-tested directly here, since
// the DB round-trip itself has no test harness in this repo.

describe("fallbackFired", () => {
  it("is false for a turn with no workflow_audit", () => {
    expect(fallbackFired(null)).toBe(false);
    expect(fallbackFired(undefined)).toBe(false);
  });

  it("is false for a turn whose audit has no fallback candidate", () => {
    expect(fallbackFired({ candidates: [{ sourceRef: "game_master", executionOk: true }], novelActionProposals: [], managerFailed: false, atStep: 1 })).toBe(false);
  });

  it("is false when the fallback was considered but did not execute", () => {
    expect(fallbackFired({ candidates: [{ sourceRef: "military_emergency_fallback", executionOk: false }] })).toBe(false);
  });

  it("is true when a fallback candidate actually executed", () => {
    expect(fallbackFired({ candidates: [{ sourceRef: "game_master", executionOk: true }, { sourceRef: "military_emergency_fallback", executionOk: true }] })).toBe(true);
  });
});
