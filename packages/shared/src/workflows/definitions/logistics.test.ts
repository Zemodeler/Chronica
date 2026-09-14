import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ensureProvinceMaterial } from "../../material/province-material";
import { executeWorkflow } from "../executor";

const world = () => ensureProvinceMaterial(structuredClone(firstPunicWarScenario.initialWorld), 0);

describe("manage_force_supply (docs/plans/ai-world-matters-runtime.md, \"Supply and logistics\")", () => {
  it("purchase: debits the account, extends provisioning, and never mutates province state", () => {
    const w = world();
    w.material.forces = w.material.forces.map((f) => (f.id === "legio-i" ? { ...f, provisionStatus: "shortage" as const, provisionedThroughStep: 1 } : f));
    const before = w.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    const outcome = executeWorkflow(
      { actionId: "manage_force_supply", actorId: "marcus-atilius", parameters: { method: "purchase", forceId: "legio-i", accountId: "marcus-purse", amount: 100, extendBySteps: 10, reason: "buy grain" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(before - 100);
    const force = outcome.world.material.forces.find((f) => f.id === "legio-i")!;
    expect(force.provisionStatus).toBe("provisioned");
    expect(force.provisionedThroughStep).toBe(11);
  });

  it("purchase: never spends more than the account can actually afford, extending proportionally less", () => {
    const w = world();
    w.material.accounts = w.material.accounts.map((a) => (a.id === "marcus-purse" ? { ...a, balance: 40 } : a));
    const outcome = executeWorkflow(
      { actionId: "manage_force_supply", actorId: "marcus-atilius", parameters: { method: "purchase", forceId: "legio-i", accountId: "marcus-purse", amount: 100, extendBySteps: 10, reason: "buy grain" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(0);
    expect(outcome.result.summary).toContain("40 of 100");
  });

  it("requisition: extends provisioning at the cost of the province's own stability and war damage", () => {
    const w = world();
    const province = w.map.provinces.find((p) => p.controllerPolityId === "rome")!;
    const before = w.material.provinceMaterial.find((m) => m.provinceId === province.id)!;
    const outcome = executeWorkflow(
      { actionId: "manage_force_supply", actorId: "marcus-atilius", parameters: { method: "requisition", forceId: "legio-i", provinceId: province.id, extendBySteps: 5, reason: "forced levy" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = outcome.world.material.provinceMaterial.find((m) => m.provinceId === province.id)!;
    expect(after.warDamageBps).toBeGreaterThan(before.warDamageBps);
    expect(after.stabilityBps).toBeLessThan(before.stabilityBps);
  });

  it("forage: extends provisioning by a small amount at no cost", () => {
    const w = world();
    const before = w.material.forces.find((f) => f.id === "legio-i")!.provisionedThroughStep;
    const outcome = executeWorkflow(
      { actionId: "manage_force_supply", actorId: "marcus-atilius", parameters: { method: "forage", forceId: "legio-i", reason: "live off the land" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.accounts).toEqual(w.material.accounts);
    expect(outcome.world.material.forces.find((f) => f.id === "legio-i")?.provisionedThroughStep).toBeGreaterThan(before);
  });

  it("reroute: records the force's supply source and route without touching provisioning", () => {
    const w = world();
    const before = w.material.forces.find((f) => f.id === "legio-i")!.provisionedThroughStep;
    const outcome = executeWorkflow(
      { actionId: "manage_force_supply", actorId: "marcus-atilius", parameters: { method: "reroute", forceId: "legio-i", sourceRef: { kind: "province", id: "sicily" }, routeProvinceIds: ["sicily"], reason: "new supply line" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const force = outcome.world.material.forces.find((f) => f.id === "legio-i")!;
    expect(force.supply?.sourceRef).toEqual({ kind: "province", id: "sicily" });
    expect(force.provisionedThroughStep).toBe(before);
  });

  it("assessment: sets provisionStatus from a cited grounded judgment", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "manage_force_supply", actorId: "quintus-fabius", parameters: { method: "assessment", forceId: "legio-i", provisionStatus: "shortage", reason: "scouts report thinning stores" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.forces.find((f) => f.id === "legio-i")?.provisionStatus).toBe("shortage");
  });

  it("refuses an assessment that restates the force's already-current status", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "manage_force_supply", actorId: "quintus-fabius", parameters: { method: "assessment", forceId: "legio-i", provisionStatus: "provisioned", reason: "no change" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("raid_supply_route", () => {
  it("degrades the target force's provisioning and records the disruption", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "raid_supply_route", actorId: "hanno", parameters: { targetForceId: "legio-i", degradeBySteps: 10, reason: "ambushed the supply convoy" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const force = outcome.world.material.forces.find((f) => f.id === "legio-i")!;
    expect(force.provisionedThroughStep).toBeLessThan(w.material.forces.find((f) => f.id === "legio-i")!.provisionedThroughStep);
    expect(force.supply?.disruptions).toContain("ambushed the supply convoy");
  });
});
