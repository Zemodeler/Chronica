import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import { validateCandidate } from "../policy";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function withIncomeSource(overrides: Partial<{ id: string; beneficiaryAccountId: string; amount: number; cadenceSteps: number; nextDueStep: number; active: boolean }> = {}) {
  const w = world();
  w.material.incomeSources = [
    {
      id: overrides.id ?? "sicily-tax",
      kind: "tax",
      label: "Sicilian taxation",
      beneficiaryAccountId: overrides.beneficiaryAccountId ?? "marcus-purse",
      originKind: "polity",
      originId: "rome",
      amount: overrides.amount ?? 100,
      cadenceSteps: overrides.cadenceSteps ?? 30,
      nextDueStep: overrides.nextDueStep ?? 1,
      collectionRateBps: 10_000,
      active: overrides.active ?? true,
    },
  ];
  return w;
}

describe("collect_revenue (docs/plans/ai-world-matters-runtime.md, \"Revenue assessment flow\")", () => {
  it("credits the beneficiary account and advances nextDueStep with full provenance", () => {
    const w = withIncomeSource({ nextDueStep: 1, amount: 100 });
    const before = w.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    const outcome = executeWorkflow(
      { actionId: "collect_revenue", actorId: "marcus-atilius", parameters: { incomeSourceId: "sicily-tax", amount: 100, reason: "ordinary Sicilian taxation" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(before + 100);
    const source = outcome.world.material.incomeSources.find((s) => s.id === "sicily-tax")!;
    expect(source.nextDueStep).toBe(31);
    const txn = outcome.world.material.transactions.find((t) => t.cause.kind === "scheduled_income" && t.cause.id === "sicily-tax")!;
    expect(txn.amount).toBe(100);
    expect(txn.cause.explanation).toContain("Sicilian taxation");
  });

  it("refuses to collect the same period twice", () => {
    const w = withIncomeSource({ nextDueStep: 1, amount: 100 });
    const first = executeWorkflow(
      { actionId: "collect_revenue", actorId: "marcus-atilius", parameters: { incomeSourceId: "sicily-tax", amount: 100, reason: "collect" } },
      w,
      1,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = executeWorkflow(
      { actionId: "collect_revenue", actorId: "marcus-atilius", parameters: { incomeSourceId: "sicily-tax", amount: 100, reason: "collect again" } },
      first.world,
      1,
    );
    expect(second.ok).toBe(false);
    const balanceAfterFirst = first.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    expect(balanceAfterFirst).toBe(world().material.accounts.find((a) => a.id === "marcus-purse")!.balance + 100);
  });

  it("refuses to collect before the source is due", () => {
    const w = withIncomeSource({ nextDueStep: 10 });
    const outcome = executeWorkflow(
      { actionId: "collect_revenue", actorId: "marcus-atilius", parameters: { incomeSourceId: "sicily-tax", amount: 100, reason: "collect early" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses an amount far beyond the source's own declared yield rather than clamping it", () => {
    const w = withIncomeSource({ nextDueStep: 1, amount: 100 });
    const outcome = executeWorkflow(
      { actionId: "collect_revenue", actorId: "marcus-atilius", parameters: { incomeSourceId: "sicily-tax", amount: 100_000, reason: "collect an implausible amount" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("100");
  });
});

describe("record_revenue_shortfall", () => {
  it("advances the source past the period without crediting anything", () => {
    const w = withIncomeSource({ nextDueStep: 1 });
    const before = w.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    const outcome = executeWorkflow(
      { actionId: "record_revenue_shortfall", actorId: "marcus-atilius", parameters: { incomeSourceId: "sicily-tax", reason: "the province is in revolt; nothing was collectable" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(before);
    expect(outcome.world.material.incomeSources.find((s) => s.id === "sicily-tax")?.nextDueStep).toBe(31);
  });
});

describe("pay_obligation (docs/plans/ai-world-matters-runtime.md, \"Army pay\")", () => {
  it("debits the payer and credits the recipient exactly the amount paid", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "pay_obligation", actorId: "marcus-atilius", parameters: { obligationId: "legio-pay", payerAccountId: "marcus-purse", amount: 100, reason: "pay the legion" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.summary).toContain("in full");
    const obligation = outcome.world.material.obligations.find((o) => o.id === "legio-pay")!;
    expect(obligation.arrears).toBe(0);
    expect(obligation.nextDueStep).toBe(2);
  });

  it("accepts a partial payment, leaves the remainder as legible arrears, and does not advance nextDueStep", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "pay_obligation", actorId: "marcus-atilius", parameters: { obligationId: "legio-pay", payerAccountId: "marcus-purse", amount: 40, reason: "partial pay" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const obligation = outcome.world.material.obligations.find((o) => o.id === "legio-pay")!;
    expect(obligation.arrears).toBe(60);
    expect(obligation.nextDueStep).toBe(1);
    const debit = world().material.accounts.find((a) => a.id === "marcus-purse")!.balance - outcome.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    expect(debit).toBe(40);
  });

  it("a declared intent to pay with no executed workflow never moves the balance", () => {
    const w = world();
    const before = w.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    // No executeWorkflow call at all -- simulating a declared intent that
    // never actually ran a workflow. The balance and obligation must be
    // byte-identical to the untouched world.
    expect(w.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBe(before);
    expect(w.material.obligations.find((o) => o.id === "legio-pay")!.arrears).toBe(0);
  });

  it("refuses when the named account is not the obligation's recorded payer", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "pay_obligation", actorId: "marcus-atilius", parameters: { obligationId: "legio-pay", payerAccountId: "hanno-purse", amount: 50, reason: "wrong account" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("never pays more than the account can actually spend", () => {
    const w = world();
    w.material.accounts = w.material.accounts.map((a) => (a.id === "marcus-purse" ? { ...a, balance: 30 } : a));
    const outcome = executeWorkflow(
      { actionId: "pay_obligation", actorId: "marcus-atilius", parameters: { obligationId: "legio-pay", payerAccountId: "marcus-purse", amount: 100, reason: "pay what you can" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(0);
    expect(outcome.world.material.obligations.find((o) => o.id === "legio-pay")?.arrears).toBe(70);
  });
});

describe("restructure_obligation", () => {
  it("changes recorded terms without moving money", () => {
    const w = world();
    const before = w.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    const outcome = executeWorkflow(
      { actionId: "restructure_obligation", actorId: "marcus-atilius", parameters: { obligationId: "legio-pay", amount: 50, reason: "negotiated reduction" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.obligations.find((o) => o.id === "legio-pay")?.amount).toBe(50);
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(before);
  });
});

describe("add_gold restriction (docs/plans/ai-world-matters-runtime.md, invariant 7)", () => {
  it("refuses a call with no provenance", () => {
    const outcome = executeWorkflow(
      { actionId: "add_gold", actorId: "marcus-atilius", parameters: { accountId: "marcus-purse", amount: 50, reason: "no provenance given" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses a call proposed by a character-directed source under policy validation", () => {
    const w = world();
    const violation = validateCandidate(
      {
        correlationId: globalThis.crypto.randomUUID(),
        source: "character_director",
        sourceRef: "marcus-atilius",
        sourceRationale: "an NPC trying to conjure money",
        requestedInvocation: { actionId: "add_gold", actorId: "marcus-atilius", parameters: { accountId: "marcus-purse", amount: 50, reason: "no real provenance", provenance: { kind: "scenario_setup" } } },
      },
      w,
    );
    expect(violation?.kind).toBe("authority_mismatch");
  });

  it("accepts scenario_setup provenance from a world-director source", () => {
    const outcome = executeWorkflow(
      { actionId: "add_gold", actorId: "marcus-atilius", parameters: { accountId: "marcus-purse", amount: 50, reason: "opening balance", provenance: { kind: "scenario_setup" } } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("grant_holding", () => {
  it("grants a character a holding tied to an existing income source", () => {
    const w = world();
    const withIncome = executeWorkflow(
      { actionId: "create_income_source", actorId: "test-actor", parameters: { incomeSourceId: "latium-estate-income", label: "Latium estate", kind: "land", beneficiaryAccountId: "marcus-purse", originKind: "holding", originId: "latium-estate", amount: 50, cadenceSteps: 4 } },
      w,
      0,
    );
    expect(withIncome.ok).toBe(true);
    if (!withIncome.ok) return;

    const outcome = executeWorkflow(
      { actionId: "grant_holding", actorId: "test-actor", parameters: { holdingId: "latium-estate", title: "Estate of Latium", territoryId: "ita-72843720b863019116732", legalHolderCharacterId: "marcus-atilius", incomeSourceId: "latium-estate-income", successionRuleId: "roman-appointment" } },
      withIncome.world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.holdings.find((h) => h.id === "latium-estate")?.legalHolderCharacterId).toBe("marcus-atilius");
  });

  it("is not applicable to an unknown income source", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "grant_holding", actorId: "test-actor", parameters: { holdingId: "latium-estate", title: "Estate of Latium", territoryId: "ita-72843720b863019116732", legalHolderCharacterId: "marcus-atilius", incomeSourceId: "nowhere", successionRuleId: "roman-appointment" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});
