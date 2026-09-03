import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import { deriveDefaultProvinceMaterial } from "../../material/province-material";

const ROMAN_PROVINCE_ID = "ita-72843720b81376294924159-sicily-northeast";

function worldWithMaterial(overrides: Partial<ReturnType<typeof deriveDefaultProvinceMaterial>> = {}) {
  const world = structuredClone(firstPunicWarScenario.initialWorld);
  const province = world.map.provinces.find((p) => p.id === ROMAN_PROVINCE_ID)!;
  const material = { ...deriveDefaultProvinceMaterial(province, 0), ...overrides };
  return { ...world, material: { ...world.material, provinceMaterial: [material] } };
}

describe("recruit_from_province", () => {
  it("reinforces an existing force from the province's own available manpower, at a real treasury cost", () => {
    const world = worldWithMaterial({ availableManpower: 500 });
    const before = world.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    const outcome = executeWorkflow(
      { actionId: "recruit_from_province", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 200, payerAccountId: "marcus-purse" } },
      world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.forces.find((f) => f.id === "legio-i")?.personnel[0]?.fit).toBe(3_200 + 200);
    expect(outcome.world.material.provinceMaterial.find((m) => m.provinceId === ROMAN_PROVINCE_ID)?.availableManpower).toBe(300);
    const after = outcome.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    expect(after).toBe(before - 400);
  });

  it("refuses to recruit beyond the province's available manpower", () => {
    const world = worldWithMaterial({ availableManpower: 50 });
    const outcome = executeWorkflow(
      { actionId: "recruit_from_province", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 200, payerAccountId: "marcus-purse" } },
      world,
      0,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses recruitment for a force outside the actor's own polity", () => {
    const world = worldWithMaterial({ availableManpower: 5_000 });
    const outcome = executeWorkflow(
      // Hanno (Carthaginian) has no standing to recruit for Rome's Legio I.
      { actionId: "recruit_from_province", actorId: "hanno", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 100, payerAccountId: "hanno-purse" } },
      world,
      0,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses recruitment the treasury cannot afford, without touching manpower", () => {
    const world = worldWithMaterial({ availableManpower: 5_000 });
    const outcome = executeWorkflow(
      // 5,000 recruits at 2/head costs far more than marcus-purse's 1,200 balance.
      { actionId: "recruit_from_province", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 5_000, payerAccountId: "marcus-purse" } },
      world,
      0,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses recruitment paid from an account the actor has no spending access to", () => {
    const world = worldWithMaterial({ availableManpower: 5_000 });
    const outcome = executeWorkflow(
      // Marcus has no access to Hanno's purse.
      { actionId: "recruit_from_province", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 10, payerAccountId: "hanno-purse" } },
      world,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("collect_emergency_taxation", () => {
  it("deposits collected taxation into the treasury and reduces stability", () => {
    const world = worldWithMaterial({ taxCapacity: 1_000, stabilityBps: 8_000 });
    const before = world.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "marcus-purse", requestedAmount: 500, reason: "Funding the legion." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = outcome.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    expect(after).toBeGreaterThan(before);
    const material = outcome.world.material.provinceMaterial.find((m) => m.provinceId === ROMAN_PROVINCE_ID)!;
    expect(material.stabilityBps).toBeLessThan(8_000);
  });

  it("costs the collecting polity legitimacy when the levy inflicts meaningful unrest", () => {
    const world = worldWithMaterial({ taxCapacity: 1_000, stabilityBps: 8_000 });
    const romeBefore = world.material.polityLegitimacy.find((l) => l.polityId === "rome")!.legitimacyBps;
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "marcus-purse", requestedAmount: 500, reason: "Funding the legion." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const romeAfter = outcome.world.material.polityLegitimacy.find((l) => l.polityId === "rome")!.legitimacyBps;
    expect(romeAfter).toBeLessThan(romeBefore);
  });

  it("does not touch legitimacy for a token draw that barely moves stability", () => {
    const world = worldWithMaterial({ taxCapacity: 10_000, stabilityBps: 10_000 });
    const romeBefore = world.material.polityLegitimacy.find((l) => l.polityId === "rome")!.legitimacyBps;
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "marcus-purse", requestedAmount: 10, reason: "A token levy." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const romeAfter = outcome.world.material.polityLegitimacy.find((l) => l.polityId === "rome")!.legitimacyBps;
    expect(romeAfter).toBe(romeBefore);
  });

  it("refuses taxation by an actor whose polity does not control the province", () => {
    const world = worldWithMaterial({ taxCapacity: 1_000 });
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "hanno", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "hanno-purse", requestedAmount: 500, reason: "Opportunistic levy." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses taxation with no tax capacity to draw on", () => {
    const world = worldWithMaterial({ taxCapacity: 0 });
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "marcus-purse", requestedAmount: 500, reason: "Funding the legion." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(false);
  });

  it("never blocks the draw itself on low legitimacy -- only opens an opposition motion alongside it", () => {
    const base = worldWithMaterial({ taxCapacity: 1_000, stabilityBps: 8_000 });
    const world = {
      ...base,
      material: {
        ...base.material,
        polityLegitimacy: base.material.polityLegitimacy.map((l) => (l.polityId === "rome" ? { ...l, legitimacyBps: 3_100 } : l)),
      },
    };
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "marcus-purse", requestedAmount: 500, reason: "Funding the legion." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The order itself succeeds -- the treasury/tax-capacity wall above is
    // the only thing that blocks it, never this.
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBeGreaterThan(
      world.material.accounts.find((a) => a.id === "marcus-purse")!.balance,
    );
    const motion = outcome.world.material.politicalProcedures.find((p) => p.type === "opposition_motion" && p.subjectId === "rome");
    expect(motion).toBeDefined();
    expect(motion?.stage).toBe("proposed");
  });

  it("does not open an opposition motion while legitimacy stays comfortably above the threshold", () => {
    const world = worldWithMaterial({ taxCapacity: 1_000, stabilityBps: 8_000 });
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "marcus-purse", requestedAmount: 500, reason: "Funding the legion." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.politicalProcedures.some((p) => p.type === "opposition_motion")).toBe(false);
  });

  it("does not open a second opposition motion while one is already pending", () => {
    const base = worldWithMaterial({ taxCapacity: 1_000, stabilityBps: 8_000 });
    const world = {
      ...base,
      material: {
        ...base.material,
        polityLegitimacy: base.material.polityLegitimacy.map((l) => (l.polityId === "rome" ? { ...l, legitimacyBps: 3_100 } : l)),
        politicalProcedures: [
          ...base.material.politicalProcedures,
          {
            id: "existing-opposition-motion",
            type: "opposition_motion" as const,
            institutionId: null,
            sponsorCharacterId: "system",
            subjectKind: "polity" as const,
            subjectId: "rome",
            linkedWorkflowId: "challenge_legitimacy",
            linkedWorkflowParams: {},
            eligibilityRequirementIds: [],
            eligibleParticipantIds: [],
            stage: "proposed" as const,
            resolutionMechanism: "sponsor_discretion" as const,
            openedAtStep: 0,
            deadlineStep: null,
            resolvedAtStep: null,
            visibility: "public" as const,
            voteRecordId: null,
            outcome: null,
            outcomeReason: null,
            sourceEventIds: [],
            resultingEventIds: [],
          },
        ],
      },
    };
    const outcome = executeWorkflow(
      { actionId: "collect_emergency_taxation", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "marcus-purse", requestedAmount: 500, reason: "Funding the legion." } },
      world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const motions = outcome.world.material.politicalProcedures.filter((p) => p.type === "opposition_motion" && p.subjectId === "rome");
    expect(motions).toHaveLength(1);
  });
});
