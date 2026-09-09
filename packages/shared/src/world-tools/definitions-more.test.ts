import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { executeWorldReadTool, executeWorldTool } from "./executor";
import { createEntityTool, createInstitutionTool, createStructureTool, linkEntitiesTool, updateEntityTool } from "./definitions-entities";
import {
  createCommitmentTool, createForceTool, createMapPositionTool, createOrUpdateAuthorityGrantTool,
  createOrUpdateSettlementTool, issueOrderTool, recordFactTool, recordResponseTool,
} from "./definitions-domain";
import { inspectEntityTool, inspectContextTool } from "./read";
import { buildWorldToolCatalog } from "./catalog";
import { buildAuthorityIndex } from "../authority/authority-grant";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

const ctx = (overrides: Partial<{ actorId: string; atStep: number }> = {}) => ({ actorId: "marcus-atilius", atStep: 1, ...overrides });

describe("generic entity tools", () => {
  it("creates, updates, and links a generic entity end to end", () => {
    const w = world();
    const created = executeWorldTool(createEntityTool, w, { kind: "training_program", label: "Siege Engineering Course" }, ctx());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const entity = created.world.genericEntities[0]!;

    const updated = executeWorldTool(updateEntityTool, created.world, { entityId: entity.id, label: "Advanced Siege Engineering", reason: "Curriculum expanded." }, ctx());
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.world.genericEntities[0]?.label).toBe("Advanced Siege Engineering");

    const linked = executeWorldTool(linkEntitiesTool, updated.world, { entityId: entity.id, linkedEntityId: "academy-1", reason: "Runs under the academy." }, ctx());
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.world.genericEntities[0]?.linkedEntityIds).toContain("academy-1");
  });

  it("creating a generic entity always emits a durable developer-review fact describing its composition (docs/32 corrective pass, requirement 5)", () => {
    const w = world();
    const outcome = executeWorldTool(createEntityTool, w, { kind: "training_program", label: "Siege Engineering Course", attributes: { focus: "siegecraft" } }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.factsToPersist).toHaveLength(1);
    const [fact] = outcome.factsToPersist!;
    expect(fact?.kind).toBe("developer_review_generic_entity");
    expect(fact?.summary).toContain("training_program");
    expect(fact?.summary).toContain("siegecraft");
  });
});

describe("create_institution", () => {
  it("founds an institution whose total voting weight matches its blocs", () => {
    const w = world();
    const polityId = w.map.polities[0]!.id;
    const outcome = executeWorldTool(createInstitutionTool, w, {
      polityId,
      name: "War Council",
      votingBlocs: [{ id: "senators", name: "Senators", representedInterest: "the old families", weight: 100 }],
      quorumBps: 5_000,
      passageThresholdBps: 5_000,
    }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const institution = outcome.world.material.institutions.at(-1)!;
    expect(institution.totalVotingWeight).toBe(100);
  });
});

describe("create_structure", () => {
  it("raises a structure at an existing province", () => {
    const w = world();
    const provinceId = w.map.provinces[0]!.id;
    const outcome = executeWorldTool(createStructureTool, w, { kind: "fortress", name: "Citadel", provinceId }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.structures).toHaveLength(1);
  });

  it("refuses a structure at a province that does not exist", () => {
    const outcome = executeWorldTool(createStructureTool, world(), { kind: "fortress", name: "Citadel", provinceId: "no-such-province" }, ctx());
    expect(outcome.ok).toBe(false);
  });
});

describe("create_force (dispatch)", () => {
  it("dispatches through the real create_force workflow", () => {
    const w = world();
    const polityId = w.map.polities[0]!.id;
    const provinceId = w.map.provinces[0]!.id;
    const outcome = executeWorldTool(createForceTool, w, { polityId, locationProvinceId: provinceId, name: "Legio Nova", size: 1000, kind: "infantry" }, ctx());
    expect(outcome.ok).toBe(true);
  });
});

describe("create_map_position", () => {
  it("adds a position to a province and refuses a duplicate id", () => {
    const w = world();
    const provinceId = w.map.provinces[0]!.id;
    const first = executeWorldTool(createMapPositionTool, w, { provinceId, positionId: "narrow-pass", label: "Narrow Pass", type: "pass" }, ctx());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = executeWorldTool(createMapPositionTool, first.world, { provinceId, positionId: "narrow-pass", label: "Narrow Pass", type: "pass" }, ctx());
    expect(second.ok).toBe(false);
  });
});

describe("create_or_update_settlement", () => {
  it("dispatches to found_settlement for a new settlement", () => {
    const w = world();
    const provinceId = w.map.provinces[0]!.id;
    const outcome = executeWorldTool(createOrUpdateSettlementTool, w, { provinceId, settlementId: "new-town", name: "New Town", kind: "town", size: 500 }, ctx());
    expect(outcome.ok).toBe(true);
  });

  it("falls back to a direct field update for an existing settlement", () => {
    const w = world();
    const province = w.map.provinces.find((p) => p.settlements.length > 0)!;
    const settlement = province.settlements[0]!;
    const outcome = executeWorldTool(createOrUpdateSettlementTool, w, { provinceId: province.id, settlementId: settlement.id, name: "Renamed", kind: settlement.kind, size: settlement.size + 10 }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const updatedProvince = outcome.world.map.provinces.find((p) => p.id === province.id)!;
    expect(updatedProvince.settlements.find((s) => s.id === settlement.id)?.name).toBe("Renamed");
  });
});

describe("issue_order / record_response", () => {
  it("issues an order and records a compliant response as accepted when authority checks out", () => {
    const w = world();
    const issued = executeWorldTool(issueOrderTool, w, {
      orderId: "order-1", actionId: "action-1",
      issuerRef: { kind: "character", id: "marcus-atilius" }, recipientRef: { kind: "character", id: "hanno" },
    }, ctx());
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.world.orderAttempts[0]?.authorityCheck.authorized).toBe(true);

    const responded = executeWorldTool(recordResponseTool, issued.world, { orderId: "order-1", decision: "accept", reason: "Willing." }, ctx({ actorId: "hanno" }));
    expect(responded.ok).toBe(true);
    if (!responded.ok) return;
    expect(responded.world.orderAttempts[0]?.status).toBe("accepted");
  });

  it("reclassifies a compliant response as subverted when the authority index says the order is unauthorized", () => {
    const w = world();
    const authorityIndex = buildAuthorityIndex({ officeSeats: [], forces: [] }, [], [], 1);
    const issued = executeWorldTool(issueOrderTool, w, {
      orderId: "order-1", actionId: "action-1",
      issuerRef: { kind: "character", id: "marcus-atilius" }, recipientRef: { kind: "character", id: "hanno" },
      claimedAuthorityGrantId: "nonexistent-grant",
    }, { ...ctx(), authorityIndex });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.world.orderAttempts[0]?.authorityCheck.authorized).toBe(false);

    const responded = executeWorldTool(recordResponseTool, issued.world, { orderId: "order-1", decision: "accept", reason: "Complies anyway." }, ctx({ actorId: "hanno" }));
    expect(responded.ok).toBe(true);
    if (!responded.ok) return;
    expect(responded.world.orderAttempts[0]?.status).toBe("subverted");
  });
});

describe("record_fact", () => {
  it("does not mutate world state and returns the fact to persist separately", () => {
    const w = world();
    const outcome = executeWorldTool(recordFactTool, w, { kind: "test_event", summary: "Something worth recording happened." }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world).toBe(w);
    expect(outcome.factsToPersist).toHaveLength(1);
    expect(outcome.factsToPersist?.[0]?.summary).toBe("Something worth recording happened.");
  });
});

describe("create_or_update_authority_grant", () => {
  it("creates a persisted delegation grant and can revoke it again", () => {
    const w = world();
    const created = executeWorldTool(createOrUpdateAuthorityGrantTool, w, {
      grantId: "grant-1", holder: { kind: "character", id: "hanno" }, source: "delegation", domain: "military",
      scope: { kind: "force", id: "carthaginian-army" }, powers: ["command"], standing: "delegated",
    }, ctx());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.world.authorityGrants).toHaveLength(1);

    const revoked = executeWorldTool(createOrUpdateAuthorityGrantTool, created.world, {
      grantId: "grant-1", holder: { kind: "character", id: "hanno" }, source: "delegation", domain: "military",
      scope: { kind: "force", id: "carthaginian-army" }, powers: ["command"], standing: "delegated",
      revokeExisting: true, revocationReason: "No longer needed.",
    }, ctx({ atStep: 2 }));
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.world.authorityGrants[0]?.revokedAtStep).toBe(2);
  });
});

describe("create_commitment", () => {
  it("dispatches to the real createCommitment resolver", () => {
    const w = world();
    const outcome = executeWorldTool(createCommitmentTool, w, {
      commitmentId: "commitment-1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
      actionKind: "protection", description: "Marcus promises safe passage.", visibility: "public",
    }, ctx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.commitments).toHaveLength(1);
  });
});

describe("inspect_entity / inspect_context", () => {
  it("finds a known character by id", () => {
    const outcome = executeWorldReadTool(inspectEntityTool, world(), { entityId: "marcus-atilius" }, ctx());
    expect(outcome.ok).toBe(true);
  });

  it("refuses an unknown entity id", () => {
    const outcome = executeWorldReadTool(inspectEntityTool, world(), { entityId: "no-such-entity" }, ctx());
    expect(outcome.ok).toBe(false);
  });

  it("reads a polity-level institutional context", () => {
    const w = world();
    const polityId = w.map.polities[0]!.id;
    const outcome = executeWorldReadTool(inspectContextTool, w, { level: "polity", scopeRefId: polityId }, ctx());
    expect(outcome.ok).toBe(true);
  });
});

describe("buildWorldToolCatalog", () => {
  it("lists every tool exactly once, reads and actions both", () => {
    const catalog = buildWorldToolCatalog();
    const names = catalog.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(catalog.some((entry) => entry.kind === "read")).toBe(true);
    expect(catalog.some((entry) => entry.kind === "action")).toBe(true);
    expect(names).toContain("create_project");
    expect(names).toContain("inspect_entity");
  });
});
