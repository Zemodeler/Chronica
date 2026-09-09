import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";
import { executeWorldTool } from "./executor";
import { changeControlTool, createProjectTool, reserveResourceTool, transferResourceTool } from "./definitions";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

const ctx = (overrides: Partial<{ actorId: string; atStep: number }> = {}) => ({ actorId: "marcus-atilius", atStep: 1, ...overrides });

describe("executeWorldTool (docs/32, Part C.1)", () => {
  it("dispatches transfer_resource through the real transfer_gold workflow", () => {
    const w = world();
    const [account] = w.material.accounts;
    const other = w.material.accounts.find((a) => a.id !== account?.id);
    if (account === undefined || other === undefined) throw new Error("fixture needs at least two accounts");
    const outcome = executeWorldTool(transferResourceTool, w, {
      sourceAccountId: account.id, destinationAccountId: other.id, amount: 10, reason: "test",
    }, ctx());
    expect(outcome.ok).toBe(true);
  });

  it("refuses invalid parameters before ever touching the workflow", () => {
    const outcome = executeWorldTool(transferResourceTool, world(), { sourceAccountId: "a" }, ctx());
    expect(outcome.ok).toBe(false);
  });

  it("dispatches change_control through the real change_province_control workflow", () => {
    const w = world();
    const [province] = w.map.provinces;
    if (province === undefined) throw new Error("fixture needs a province");
    const outcome = executeWorldTool(changeControlTool, w, {
      provinceId: province.id, newControllerPolityId: w.map.polities[1]?.id ?? null, reason: "test",
    }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.controlRecords.some((r) => r.status === "active" && r.locationId === province.id)).toBe(true);
  });

  it("reserve_resource has no registered workflow and falls through to its own primitive", () => {
    const w = world();
    const [account] = w.material.accounts;
    if (account === undefined) throw new Error("fixture needs an account");
    const outcome = executeWorldTool(reserveResourceTool, w, {
      accountId: account.id, currencyId: account.currencyId, amount: 50, purposeId: "academy", reason: "fund the academy",
    }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.reservations).toHaveLength(1);
  });

  it("reserve_resource refuses to reserve more than is available", () => {
    const w = world();
    const [account] = w.material.accounts;
    if (account === undefined) throw new Error("fixture needs an account");
    const outcome = executeWorldTool(reserveResourceTool, w, {
      accountId: account.id, currencyId: account.currencyId, amount: account.balance + 1_000_000, purposeId: "academy", reason: "test",
    }, ctx());
    expect(outcome.ok).toBe(false);
  });

  it("create_project reserves funding and schedules its milestones", () => {
    const w = world();
    const [account] = w.material.accounts;
    if (account === undefined) throw new Error("fixture needs an account");
    const outcome = executeWorldTool(createProjectTool, w, {
      kind: "academy",
      sponsorEntityRef: { kind: "polity", id: w.map.polities[0]?.id ?? "rome" },
      label: "Found a war academy",
      milestones: [{ id: "m1", label: "Break ground", requiredAtElapsedOffset: 0, costAmount: 50 }],
      fundingAccountId: account.id,
      fundingCurrencyId: account.currencyId,
    }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.projects).toHaveLength(1);
    expect(outcome.world.material.reservations).toHaveLength(1);
    expect(outcome.world.projects[0]?.status).toBe("funded");
  });

  it("create_project without funding starts merely proposed, with no reservation opened", () => {
    const w = world();
    const outcome = executeWorldTool(createProjectTool, w, {
      kind: "academy",
      sponsorEntityRef: { kind: "polity", id: w.map.polities[0]?.id ?? "rome" },
      label: "Propose a war academy",
      milestones: [{ id: "m1", label: "Break ground", requiredAtElapsedOffset: 0, costAmount: 50 }],
    }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.reservations).toHaveLength(0);
    expect(outcome.world.projects[0]?.status).toBe("proposed");
  });

  it("blocks an authority-sensitive call when the authority index says the actor is unauthorized", () => {
    const w = world();
    const [account] = w.material.accounts;
    const other = w.material.accounts.find((a) => a.id !== account?.id);
    if (account === undefined || other === undefined) throw new Error("fixture needs at least two accounts");
    const authorityIndex = buildAuthorityIndex({ officeSeats: [], forces: [] }, [], [], 1);
    const outcome = executeWorldTool(transferResourceTool, w, {
      sourceAccountId: account.id, destinationAccountId: other.id, amount: 10, reason: "test",
    }, { ...ctx(), authorityIndex });
    expect(outcome.ok).toBe(false);
  });
});
