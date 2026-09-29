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

    const { world: after, transfers, beneficiaryIds } = settleEstate(w, "marcus-atilius", 0);
    const material = after.material;
    expect(beneficiaryIds).toEqual(["marcus-atilius-minor"]);
    expect(transfers.some((t) => t.assetKind === "account_balance" && t.beneficiaryCharacterId === "marcus-atilius-minor")).toBe(true);

    const marcusPurse = material.accounts.find((a) => a.id === "marcus-purse")!;
    expect(marcusPurse.status).toBe("locked");
    expect(marcusPurse.balance).toBe(0);
    const minorPurse = material.accounts.find((a) => a.id === "marcus-minor-purse")!;
    expect(minorPurse.balance).toBeGreaterThan(50);

    const estate = material.estates.find((e) => e.id === "marcus-estate")!;
    expect(estate.status).toBe("settled");
    expect(after.characters.find((c) => c.id === "marcus-atilius")!.officeId).toBe("roman-command");
  });

  it("records each transfer once", () => {
    const { world: after, transfers } = settleEstate(world(), "marcus-atilius", 0);
    const ids = after.material.inheritanceTransfers.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(transfers.length).toBeGreaterThan(0);
  });

  it("transfers debts when the rule says so", () => {
    const { world: after } = settleEstate(world(), "marcus-atilius", 0);
    const obligation = after.material.obligations.find((o) => o.id === "legio-pay")!;
    expect(obligation.payerAccountId).toBe("marcus-minor-purse");
    expect(obligation.active).toBe(true);
  });

  it("forgives debts when the rule says not to transfer them", () => {
    const w = world();
    w.material.inheritanceRules = w.material.inheritanceRules.map((r) => (r.id === "marcus-estate-rule" ? { ...r, debtsTransfer: false } : r));
    const { world: after } = settleEstate(w, "marcus-atilius", 0);
    const obligation = after.material.obligations.find((o) => o.id === "legio-pay")!;
    expect(obligation.active).toBe(false);
  });

  it("gathers an estate nobody authored: purse, land and the land's rents go to the children alike", () => {
    const w = world();
    w.material.estates = [];
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, heirCharacterId: null } : c));
    w.familyLinks.push({ id: "marcus:parent:hamilcar-as-child", characterId: "marcus-atilius", relatedCharacterId: "hamilcar", kind: "parent", startedAtStep: 0, endedAtStep: null, visibility: "polity", provenanceEventId: null });
    w.material.accounts = w.material.accounts.map((a) => (a.id === "marcus-purse" ? { ...a, balance: 1_001 } : a));
    w.material.holdings.push({ id: "atilian-farm", title: "The Atilian farm", territoryId: w.map.provinces[0]!.id, legalHolderCharacterId: "marcus-atilius", incomeSourceId: "atilian-yield", successionRuleId: "any", physicalControlBps: 10_000 });
    w.material.incomeSources.push({ id: "atilian-yield", kind: "land", label: "Rents of the Atilian farm", beneficiaryAccountId: "marcus-purse", originKind: "holding", originId: "atilian-farm", amount: 10, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 10_000, counterpartyPolityId: null } as never);
    const minorBefore = w.material.accounts.find((a) => a.id === "marcus-minor-purse")!.balance;

    const settled = settleEstate(w, "marcus-atilius", 0);
    expect(settled.heirless).toBe(false);
    expect([...settled.beneficiaryIds].sort()).toEqual(["hamilcar", "marcus-atilius-minor"]);
    const minorGot = settled.world.material.accounts.find((a) => a.id === "marcus-minor-purse")!.balance - minorBefore;
    const total = settled.portions.reduce((sum, p) => sum + p.coin, 0);
    expect(total).toBe(1_001);
    expect(minorGot === 500 || minorGot === 501).toBe(true);
    const farm = settled.world.material.holdings.find((h) => h.id === "atilian-farm")!;
    expect(farm.legalHolderCharacterId).toBe(settled.beneficiaryIds[0]);
    const rent = settled.world.material.incomeSources.find((i) => i.id === "atilian-yield")!;
    const holder = settled.world.characters.find((c) => c.id === farm.legalHolderCharacterId)!;
    expect(rent.beneficiaryAccountId).toBe(holder.personalAccountId);
  });

  it("follows the will: a named heir takes the house before the children", () => {
    const w = world();
    w.material.estates = [];
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, heirCharacterId: "quintus-fabius" } : c));
    const settled = settleEstate(w, "marcus-atilius", 0);
    expect(settled.beneficiaryIds[0]).toBe("quintus-fabius");
    expect(settled.reason).toContain("named");
  });

  it("escheats to the state when nobody can inherit", () => {
    const w = world();
    const hanno = w.characters.find((c) => c.id === "hanno")!;
    w.material.accounts = w.material.accounts.map((a) => (a.id === hanno.personalAccountId ? { ...a, balance: 300 } : a));
    const treasury = w.material.accounts.find((a) => a.owner.kind === "polity" && a.owner.id === hanno.polityId && a.status === "active");
    const settled = settleEstate({ ...w, characters: w.characters.map((c) => (c.id === "hanno" ? { ...c, heirCharacterId: null } : c)) }, "hanno", 0);
    expect(settled.heirless).toBe(true);
    if (treasury !== undefined) {
      expect(settled.escheatedToAccountId).toBe(treasury.id);
      expect(settled.world.material.accounts.find((a) => a.id === treasury.id)!.balance).toBe(treasury.balance + 300);
    }
    expect(settled.world.material.accounts.find((a) => a.id === hanno.personalAccountId)!.status).toBe("locked");
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
