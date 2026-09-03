import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { resolveIntentConflicts, type IntentClaim } from "./conflicts";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function claim(overrides: Partial<IntentClaim>): IntentClaim {
  return {
    intentId: "i1", actorCharacterId: "marcus-atilius", actionType: "wait",
    requiredResource: null, requiredOfficeId: null, targetIds: [], score: 0, createdAtStep: 0,
    ...overrides,
  };
}

describe("resolveIntentConflicts", () => {
  it("two NPCs cannot spend more than the shared account holds -- the higher-scored claim wins", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    const claims = [
      claim({ intentId: "low", score: 10, requiredResource: { accountId: account.id, minAmount: account.balance } }),
      claim({ intentId: "high", score: 90, requiredResource: { accountId: account.id, minAmount: account.balance } }),
    ];
    const outcomes = resolveIntentConflicts(w, claims);
    expect(outcomes.get("high")?.accepted).toBe(true);
    expect(outcomes.get("low")?.accepted).toBe(false);
    expect(outcomes.get("low")?.reason).toMatch(/cannot cover/);
  });

  it("two NPCs cannot both receive the same exclusive office", () => {
    const w = world();
    const claims = [
      claim({ intentId: "a", actionType: "seek_office", requiredOfficeId: "consul", score: 50 }),
      claim({ intentId: "b", actionType: "seek_office", requiredOfficeId: "consul", score: 80 }),
    ];
    const outcomes = resolveIntentConflicts(w, claims);
    expect(outcomes.get("b")?.accepted).toBe(true);
    expect(outcomes.get("a")?.accepted).toBe(false);
  });

  it("accepts independent claims with no shared resource, office, or target", () => {
    const w = world();
    const claims = [
      claim({ intentId: "a", score: 10 }),
      claim({ intentId: "b", score: 20 }),
    ];
    const outcomes = resolveIntentConflicts(w, claims);
    expect(outcomes.get("a")?.accepted).toBe(true);
    expect(outcomes.get("b")?.accepted).toBe(true);
  });

  it("is deterministic given the same claims", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    const claims = [
      claim({ intentId: "a", score: 50, createdAtStep: 2, requiredResource: { accountId: account.id, minAmount: account.balance } }),
      claim({ intentId: "b", score: 50, createdAtStep: 1, requiredResource: { accountId: account.id, minAmount: account.balance } }),
    ];
    const first = resolveIntentConflicts(w, claims);
    const second = resolveIntentConflicts(w, claims);
    expect(first.get("a")).toEqual(second.get("a"));
    expect(first.get("b")).toEqual(second.get("b"));
    // Equal score: the earlier-created claim (stable tie-break) wins.
    expect(first.get("b")?.accepted).toBe(true);
    expect(first.get("a")?.accepted).toBe(false);
  });
});
