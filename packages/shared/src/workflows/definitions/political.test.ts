import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import type { WorldState } from "../../world/world-state";

const world = () => structuredClone(firstPunicWarScenario.initialWorld) as WorldState;

describe("rename_polity", () => {
  it("renames a polity", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "rename_polity", actorId: "test-actor", parameters: { polityId: "carthage", newName: "Carthaginian Empire" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.polities.find((p) => p.id === "carthage")?.name).toBe("Carthaginian Empire");
  });

  it("is not applicable to an unknown polity", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "rename_polity", actorId: "test-actor", parameters: { polityId: "atlantis", newName: "Whatever" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("vassalize_polity and revoke_vassalage", () => {
  it("creates a tribute obligation, then deactivates it on revocation", () => {
    const w = world();
    const vassalized = executeWorkflow(
      { actionId: "vassalize_polity", actorId: "test-actor", parameters: { overlordPolityId: "rome", vassalPolityId: "carthage", vassalPayerAccountId: "hanno-purse", tributeObligationId: "carthage-tribute", tributeAmount: 200, cadenceSteps: 4, atStep: 0 } },
      w,
      0,
    );
    expect(vassalized.ok).toBe(true);
    if (!vassalized.ok) return;
    const obligation = vassalized.world.material.obligations.find((o) => o.id === "carthage-tribute");
    expect(obligation?.kind).toBe("tribute");
    expect(obligation?.active).toBe(true);

    const revoked = executeWorkflow(
      { actionId: "revoke_vassalage", actorId: "test-actor", parameters: { tributeObligationId: "carthage-tribute", reason: "Carthage throws off the yoke." } },
      vassalized.world,
      0,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.world.material.obligations.find((o) => o.id === "carthage-tribute")?.active).toBe(false);
  });

  it("vassalize_polity is not applicable when the tribute obligation id is already used", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "vassalize_polity", actorId: "test-actor", parameters: { overlordPolityId: "rome", vassalPolityId: "carthage", vassalPayerAccountId: "hanno-purse", tributeObligationId: "legio-pay", tributeAmount: 200, cadenceSteps: 4, atStep: 0 } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });

  it("revoke_vassalage is not applicable to an unknown obligation", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "revoke_vassalage", actorId: "test-actor", parameters: { tributeObligationId: "nowhere", reason: "n/a" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("arrange_marriage_alliance", () => {
  it("records a marriage alliance between characters of different polities", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "arrange_marriage_alliance", actorId: "test-actor", parameters: { characterAId: "marcus-atilius", characterBId: "hanno", relationId: "rome-carthage-marriage", sourceNote: "A dynastic marriage seals an uneasy truce." } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.politicalRelations?.some((r) => r.id === "rome-carthage-marriage" && r.kind === "alliance")).toBe(true);
  });

  it("is not applicable to an unknown character", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "arrange_marriage_alliance", actorId: "test-actor", parameters: { characterAId: "marcus-atilius", characterBId: "nobody", relationId: "some-relation", sourceNote: "n/a" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});
