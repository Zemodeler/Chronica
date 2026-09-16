import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { deriveLegacyCauses, findPlayerSuccessors, resolveBeneficiaries, settleEstate } from "./inheritance";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("resolveBeneficiaries", () => {
  it("primogeniture: the eldest living child inherits", () => {
    const w = world();
    const estate = w.material.estates.find((e) => e.id === "marcus-estate")!;
    const rule = w.material.inheritanceRules.find((r) => r.id === "marcus-estate-rule")!;
    const resolution = resolveBeneficiaries(w, estate, rule, 0);
    expect(resolution.beneficiaryIds).toEqual(["marcus-atilius-minor"]);
    expect(resolution.status).toBe("settled");
  });

  it("primogeniture: disputed when no living child exists", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius-minor" ? { ...c, alive: false, diedAtStep: 0 } : c));
    const estate = w.material.estates.find((e) => e.id === "marcus-estate")!;
    const rule = w.material.inheritanceRules.find((r) => r.id === "marcus-estate-rule")!;
    const resolution = resolveBeneficiaries(w, estate, rule, 0);
    expect(resolution.beneficiaryIds).toEqual([]);
    expect(resolution.status).toBe("disputed");
  });

  it("equal_division: splits among all living children", () => {
    const w = world();
    w.familyLinks.push({ id: "marcus:parent:hamilcar-as-child", characterId: "marcus-atilius", relatedCharacterId: "hamilcar", kind: "parent", startedAtStep: 0, endedAtStep: null, visibility: "polity", provenanceEventId: null });
    const estate = w.material.estates.find((e) => e.id === "marcus-estate")!;
    const rule = { id: "equal-rule", kind: "equal_division" as const, institutionId: null, debtsTransfer: true };
    const resolution = resolveBeneficiaries(w, estate, rule, 0);
    expect([...resolution.beneficiaryIds].sort()).toEqual(["hamilcar", "marcus-atilius-minor"]);
  });

  it("appointment: the first living named testamentary beneficiary inherits", () => {
    const w = world();
    const estate = { ...w.material.estates.find((e) => e.id === "marcus-estate")!, testamentaryBeneficiaryIds: ["hanno", "hamilcar"] };
    const rule = { id: "appointment-rule", kind: "appointment" as const, institutionId: null, debtsTransfer: true };
    const resolution = resolveBeneficiaries(w, estate, rule, 0);
    expect(resolution.beneficiaryIds).toEqual(["hanno"]);
  });

  it("elective: never resolved here -- always disputed, deferring to a Phase 4 procedure", () => {
    const w = world();
    const estate = w.material.estates.find((e) => e.id === "marcus-estate")!;
    const rule = { id: "elective-rule", kind: "elective" as const, institutionId: "roman-senate", debtsTransfer: true };
    const resolution = resolveBeneficiaries(w, estate, rule, 0);
    expect(resolution.beneficiaryIds).toEqual([]);
    expect(resolution.status).toBe("disputed");
  });
});

describe("settleEstate", () => {
  it("transfers the account balance to the heir and locks the deceased's account, never touching the office", () => {
    const w = world();
    const before = w.characters.find((c) => c.id === "marcus-atilius")!;
    expect(before.officeId).toBe("roman-command");

    const { material, transfers, beneficiaryIds } = settleEstate(w, "marcus-atilius", 0);
    expect(beneficiaryIds).toEqual(["marcus-atilius-minor"]);
    expect(transfers.some((t) => t.assetKind === "account_balance" && t.beneficiaryCharacterId === "marcus-atilius-minor")).toBe(true);

    const marcusPurse = material.accounts.find((a) => a.id === "marcus-purse")!;
    expect(marcusPurse.status).toBe("locked");
    expect(marcusPurse.balance).toBe(0);
    const minorPurse = material.accounts.find((a) => a.id === "marcus-minor-purse")!;
    expect(minorPurse.balance).toBeGreaterThan(50);

    const estate = material.estates.find((e) => e.id === "marcus-estate")!;
    expect(estate.status).toBe("settled");
  });

  it("transfers debts when the rule says so", () => {
    const w = world();
    const { material } = settleEstate(w, "marcus-atilius", 0);
    const obligation = material.obligations.find((o) => o.id === "legio-pay")!;
    expect(obligation.payerAccountId).toBe("marcus-minor-purse");
    expect(obligation.active).toBe(true);
  });

  it("forgives debts when the rule says not to transfer them", () => {
    const w = world();
    w.material.inheritanceRules = w.material.inheritanceRules.map((r) => (r.id === "marcus-estate-rule" ? { ...r, debtsTransfer: false } : r));
    const { material } = settleEstate(w, "marcus-atilius", 0);
    const obligation = material.obligations.find((o) => o.id === "legio-pay")!;
    expect(obligation.active).toBe(false);
  });

  it("is a no-op for a character with no open estate", () => {
    const w = world();
    const { material, transfers, beneficiaryIds } = settleEstate(w, "hanno", 0);
    expect(transfers).toEqual([]);
    expect(beneficiaryIds).toEqual([]);
    expect(material).toBe(w.material);
  });
});

describe("deriveLegacyCauses", () => {
  it("is bounded to maxCauses and never touches beliefs or plots", () => {
    const w = world();
    w.characters = w.characters.map((c) =>
      c.id === "quintus-fabius"
        ? { ...c, relations: [{ subjectCharacterId: "marcus-atilius", causes: [{ id: "rivalry", label: "Rivalry", score: -40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
        : c,
    );
    const legacy = deriveLegacyCauses(w, "marcus-atilius", "marcus-atilius-minor", 4, 5);
    expect(legacy.length).toBeLessThanOrEqual(5);
    expect(legacy.every((entry) => entry.predecessorCharacterId === "marcus-atilius" && entry.successorCharacterId === "marcus-atilius-minor")).toBe(true);
  });

  it("returns nothing for an unknown successor", () => {
    expect(deriveLegacyCauses(world(), "marcus-atilius", "nobody", 4)).toEqual([]);
  });
});

describe("findPlayerSuccessors", () => {
  it("prefers the living named heir first", () => {
    const successors = findPlayerSuccessors(world(), "marcus-atilius", 0);
    expect(successors[0]).toBe("marcus-atilius-minor");
  });

  it("returns an empty list for a character with no eligible kin and no heir", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "hanno" ? { ...c, heirCharacterId: null } : c));
    expect(findPlayerSuccessors(w, "hanno", 0)).toEqual([]);
  });

  it("excludes a disqualified heir", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius-minor" ? { ...c, disqualifyingStatuses: ["incapacitated"] } : c));
    expect(findPlayerSuccessors(w, "marcus-atilius", 0)).not.toContain("marcus-atilius-minor");
  });
});
