import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { deriveWorldInstant, type WorldState } from "@chronica/shared";
import { advanceWorldMatters } from "../advance";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function at(step: number) {
  return deriveWorldInstant(step);
}

describe("fiscal matter detectors (docs/plans/ai-world-matters-runtime.md, Phase 4)", () => {
  it("detects an income_assessment matter once a source nears its next due step, scoped to its beneficiary account", () => {
    const w = world();
    w.material.incomeSources = [{
      id: "sicily-tax", kind: "tax", label: "Sicilian taxation", beneficiaryAccountId: "marcus-purse",
      originKind: "polity", originId: "rome", amount: 100, cadenceSteps: 8, nextDueStep: 10, collectionRateBps: 10_000, active: true,
    }];
    const result = advanceWorldMatters(w, at(9), 9);
    const matter = result.world.worldMatters!.find((m) => m.kind === "income_assessment")!;
    expect(matter).toBeDefined();
    expect(matter.sourceRef).toEqual({ kind: "income_source", id: "sicily-tax" });
    expect(matter.requiredAuthority).toEqual([{ domain: "fiscal", power: "spend", scope: { kind: "account", id: "marcus-purse" } }]);
    expect(matter.status).toBe("upcoming");
  });

  it("marks the income_assessment matter due once the step actually arrives, and advancing does not duplicate it", () => {
    const w = world();
    w.material.incomeSources = [{
      id: "sicily-tax", kind: "tax", label: "Sicilian taxation", beneficiaryAccountId: "marcus-purse",
      originKind: "polity", originId: "rome", amount: 100, cadenceSteps: 8, nextDueStep: 10, collectionRateBps: 10_000, active: true,
    }];
    const first = advanceWorldMatters(w, at(10), 10);
    const matter = first.world.worldMatters!.find((m) => m.kind === "income_assessment")!;
    expect(matter.status).toBe("due");
    const second = advanceWorldMatters(first.world, at(10), 10);
    expect(second.world.worldMatters!.filter((m) => m.kind === "income_assessment")).toHaveLength(1);
  });

  it("detects an obligation_due matter for legio-pay, scoped to its payer account, and escalates to overdue", () => {
    const w = world();
    // built-in-scenarios.ts already seeds "legio-pay" (payer: marcus-purse, nextDueStep: 1).
    const result = advanceWorldMatters(w, at(1), 1);
    const matter = result.world.worldMatters!.find((m) => m.sourceRef.kind === "obligation" && m.sourceRef.id === "legio-pay" && m.id.startsWith("obligation:"))!;
    expect(matter).toBeDefined();
    expect(matter.status).toBe("overdue");
    expect(matter.requiredAuthority).toEqual([{ domain: "fiscal", power: "spend", scope: { kind: "account", id: "marcus-purse" } }]);
  });

  it("detects a continuous arrears matter once an obligation carries arrears, independent of its period", () => {
    const w = world();
    w.material.obligations = w.material.obligations.map((o) => (o.id === "legio-pay" ? { ...o, arrears: 300, nextDueStep: 100 } : o));
    const result = advanceWorldMatters(w, at(5), 5);
    const arrears = result.world.worldMatters!.find((m) => m.id === "arrears:legio-pay");
    expect(arrears).toBeDefined();
    expect(arrears!.status).toBe("overdue");
    // The arrears matter's own identity is stable across periods -- unlike
    // the period-keyed obligation_due matter, which still surfaces
    // alongside it here because arrears > 0 makes it relevant too, but
    // would carry a DIFFERENT id once nextDueStep's period advances, while
    // "arrears:legio-pay" stays the same id throughout.
    expect(arrears!.id).toBe("arrears:legio-pay");
  });

  it("resolves the arrears matter once the arrears are cleared", () => {
    const w = world();
    const withArrears = w.material.obligations.map((o) => (o.id === "legio-pay" ? { ...o, arrears: 300, nextDueStep: 100 } : o));
    const first = advanceWorldMatters({ ...w, material: { ...w.material, obligations: withArrears } }, at(5), 5);
    expect(first.world.worldMatters!.some((m) => m.id === "arrears:legio-pay" && m.status !== "cancelled")).toBe(true);

    const cleared = first.world.material.obligations.map((o) => (o.id === "legio-pay" ? { ...o, arrears: 0 } : o));
    const second = advanceWorldMatters({ ...first.world, material: { ...first.world.material, obligations: cleared } }, at(6), 6);
    const arrearsMatter = second.world.worldMatters!.find((m) => m.id === "arrears:legio-pay")!;
    expect(arrearsMatter.status).toBe("cancelled");
  });

  it("detects a treasury_risk matter when an account cannot cover its near-term obligations", () => {
    const w = world();
    w.material.accounts = w.material.accounts.map((a) => (a.id === "marcus-purse" ? { ...a, balance: 10 } : a));
    const result = advanceWorldMatters(w, at(1), 1);
    const risk = result.world.worldMatters!.find((m) => m.id === "treasury-risk:marcus-purse");
    expect(risk).toBeDefined();
    expect(risk!.kind).toBe("treasury_risk");
  });

  it("does not detect a treasury_risk matter when the account can cover its obligations", () => {
    const w = world();
    w.material.accounts = w.material.accounts.map((a) => (a.id === "marcus-purse" ? { ...a, balance: 100_000 } : a));
    const result = advanceWorldMatters(w, at(1), 1);
    expect(result.world.worldMatters!.some((m) => m.id === "treasury-risk:marcus-purse")).toBe(false);
  });

  it("never mutates world.material -- detection is pure and produces matters only", () => {
    const w = world();
    const before = structuredClone(w.material);
    advanceWorldMatters(w, at(1), 1);
    expect(w.material).toEqual(before);
  });
});
