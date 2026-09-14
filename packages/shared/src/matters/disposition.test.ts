import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import type { Fact } from "../world/facts";
import type { MoneyObligation, MoneyTransaction } from "../material-state";
import type { WorldMatter } from "./schema";
import { evaluateMatterDisposition } from "./disposition";

const INSTANT = { day: 10, minute: 0 };

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function baseMatter(overrides: Partial<WorldMatter> = {}): WorldMatter {
  return {
    id: "obligation:legio-i-pay:period-1",
    kind: "obligation_due",
    sourceRef: { kind: "obligation", id: "legio-i-pay" },
    status: "due",
    visibility: "public",
    summary: "Legio I's pay is due.",
    urgency: 50,
    createdAt: INSTANT,
    dueAt: INSTANT,
    nextReviewAt: INSTANT,
    lastReviewedAt: null,
    requiredAuthority: [],
    responsibleScopeRefs: [],
    stakeholderRefs: [],
    relevantFactIds: [],
    standingPlanId: null,
    supersedesMatterId: null,
    parentMatterId: null,
    offers: [],
    dispositions: [],
    resolutionFactIds: [],
    provinceId: null,
    intensity: 50,
    reviews: 1,
    pressureId: null,
    createdAtStep: 1,
    lastReviewedStep: 5,
    nextReviewStep: 6,
    ...overrides,
  };
}

function obligation(overrides: Partial<MoneyObligation> = {}): MoneyObligation {
  return {
    id: "legio-i-pay",
    kind: "army_pay",
    label: "Legio I pay",
    payerAccountId: "marcus-purse",
    recipientAccountId: "hanno-purse",
    amount: 500,
    cadenceSteps: 30,
    nextDueStep: 6,
    priority: 100,
    arrears: 0,
    missedPeriods: 0,
    active: true,
    ...overrides,
  };
}

function transaction(overrides: Partial<MoneyTransaction> = {}): MoneyTransaction {
  return {
    id: "txn-1",
    atStep: 6,
    kind: "upkeep",
    amount: 500,
    sourceAccountId: "marcus-purse",
    destinationAccountId: "hanno-purse",
    cause: { kind: "obligation", id: "legio-i-pay", explanation: "Legio I pay" },
    visibility: "public",
    ...overrides,
  };
}

describe("evaluateMatterDisposition (docs/plans/ai-world-matters-runtime.md, Matter lifecycle §7)", () => {
  it("leaves the matter due when an intent was declared but no MoneyTransaction resulted", () => {
    const w = world();
    w.material.obligations = [obligation()];
    const matter = baseMatter({ offers: [{ actorRef: { kind: "character", id: "marcus-atilius" }, offeredAt: INSTANT, role: "responsible", knowledgeFactIds: [], outcome: "intent_declared", intentIds: ["intent-1"] }] });
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result!.status).toBe("due");
    expect(result!.dispositions).toEqual([]);
    expect(result!.resolutionFactIds).toEqual([]);
  });

  it("marks the matter addressed once a matching obligation transaction covers the full amount", () => {
    const w = world();
    w.material.obligations = [obligation()];
    w.material.transactions = [transaction({ amount: 500 })];
    const matter = baseMatter();
    const facts: Fact[] = [];
    const [result] = evaluateMatterDisposition(w, [matter], facts);
    expect(result!.status).toBe("addressed");
    expect(result!.dispositions.at(-1)!.kind).toBe("addressed");
    expect(result!.resolutionFactIds.length).toBeGreaterThan(0);
  });

  it("marks the matter partially_addressed when only part of the amount was paid, and the remainder stays visible", () => {
    const w = world();
    w.material.obligations = [obligation({ amount: 500 })];
    w.material.transactions = [transaction({ amount: 200 })];
    const matter = baseMatter();
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result!.status).not.toBe("addressed");
    expect(result!.dispositions.at(-1)!.kind).toBe("partially_addressed");
    expect(result!.dispositions.at(-1)!.note).toContain("300");
  });

  it("leaves the matter unchanged after a refusal that produced no transaction and left the account solvent", () => {
    const w = world();
    w.material.obligations = [obligation()];
    const matter = baseMatter();
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result).toEqual(matter);
  });

  it("marks the matter blocked when the payer account has no available balance and nothing was paid", () => {
    const w = world();
    w.material.accounts = w.material.accounts.map((a) => (a.id === "marcus-purse" ? { ...a, balance: 0 } : a));
    w.material.obligations = [obligation()];
    const matter = baseMatter();
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result!.dispositions.at(-1)!.kind).toBe("blocked");
    expect(result!.status).toBe("due");
  });

  it("is idempotent: re-running with identical facts does not duplicate the disposition entry", () => {
    const w = world();
    w.material.obligations = [obligation()];
    w.material.transactions = [transaction({ amount: 500 })];
    const matter = baseMatter();
    const [once] = evaluateMatterDisposition(w, [matter], []);
    const [twice] = evaluateMatterDisposition(w, [once!], []);
    expect(twice!.dispositions).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it("collects income for income_assessment matters once a scheduled_income transaction is recorded", () => {
    const w = world();
    w.material.incomeSources = [{
      id: "sicily-tax", kind: "tax", label: "Sicilian taxation", beneficiaryAccountId: "marcus-purse",
      originKind: "polity", originId: "rome", amount: 300, cadenceSteps: 90, nextDueStep: 6, collectionRateBps: 10_000, active: true,
    }];
    w.material.transactions = [transaction({ id: "txn-income", amount: 300, sourceAccountId: undefined, destinationAccountId: "marcus-purse", cause: { kind: "scheduled_income", id: "sicily-tax", explanation: "Sicilian taxation" } })];
    const matter = baseMatter({ id: "income-assessment:sicily-tax:period-1", kind: "income_assessment", sourceRef: { kind: "income_source", id: "sicily-tax" } });
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result!.status).toBe("addressed");
  });

  it("addresses a treaty_review matter once the underlying diplomatic message is answered", () => {
    const w = world();
    w.diplomacy = [{
      id: "msg-1", kind: "peace_offer", fromPolityId: "carthage", fromCharacterId: "hanno", toPolityId: "rome",
      toCharacterId: "marcus-atilius", subject: "A negotiated peace", terms: "Withdraw from Sicily.",
      sentAtStep: 1, replyDueByStep: 10, status: "answered", answer: "accepted", answerText: "Rome accepts.", answeredAtStep: 3, inReplyToMessageId: null, visibility: "polity",
    }];
    const matter = baseMatter({ id: "treaty-review:msg-1", kind: "treaty_review", sourceRef: { kind: "diplomatic_message", id: "msg-1" } });
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result!.status).toBe("addressed");
    expect(result!.dispositions.at(-1)!.note).toContain("accepted");
  });

  it("leaves a treaty_review matter due while the message still awaits reply", () => {
    const w = world();
    w.diplomacy = [{
      id: "msg-1", kind: "peace_offer", fromPolityId: "carthage", fromCharacterId: "hanno", toPolityId: "rome",
      toCharacterId: "marcus-atilius", subject: "A negotiated peace", terms: "Withdraw from Sicily.",
      sentAtStep: 1, replyDueByStep: 10, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity",
    }];
    const matter = baseMatter({ id: "treaty-review:msg-1", kind: "treaty_review", sourceRef: { kind: "diplomatic_message", id: "msg-1" } });
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result).toEqual(matter);
  });

  it("does not force a completion predicate onto the 5 legacy WorldDevelopment kinds", () => {
    const w = world();
    const matter = baseMatter({ id: "scarcity:some-province", kind: "scarcity", sourceRef: { kind: "province", id: "some-province" } });
    const [result] = evaluateMatterDisposition(w, [matter], []);
    expect(result).toEqual(matter);
  });
});
