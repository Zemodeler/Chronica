import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { diffWorldState } from "./world-diff";

// The generic replacement for a hand-written switch keyed on which workflow
// ran (docs: root-level fix). These tests pin the one property that matters:
// diffWorldState finds a change purely from the world-state shape, never
// from knowing which action produced it -- so the same test that proves a
// province's control change is caught also proves a completely different,
// untouched action id (or an invented one this module has never heard of)
// would be caught identically.

const ROME = "rome";
const CARTHAGE = "carthage";
const LATIUM = "ita-local-23120603B86473916475875";
const SICILY_WEST = "ita-72843720b81376294924159-sicily-west";
const MESSANA_PROVINCE = "ita-72843720b81376294924159-sicily-northeast";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

describe("diffWorldState", () => {
  it("finds nothing between two identical snapshots", () => {
    const w = world();
    expect(diffWorldState(w, structuredClone(w))).toEqual([]);
  });

  it("reports a new force as created, by name, with no knowledge of create_force", () => {
    const before = world();
    const after = world();
    after.material.forces = [
      ...after.material.forces,
      {
        id: "legio-new",
        name: "Legio Nova",
        polityId: ROME,
        commanderCharacterId: "marcus-atilius",
        controllerCharacterId: "marcus-atilius",
        locationId: LATIUM,
        positionId: null,
        authorizedStrength: 4_000,
        personnel: [{ categoryId: "cat-infantry", label: "infantry", fit: 4_000, unavailable: [] }],
        moraleBps: 7_000,
        cohesionBps: 7_000,
        fatigueBps: 0,
        provisionStatus: "provisioned",
        provisionedThroughStep: 8,
        payObligationId: null,
        payArrearsPeriods: 0,
        history: [],
      },
    ];
    const deltas = diffWorldState(before, after);
    const forceDelta = deltas.find((d) => d.entityType === "force" && d.entityId === "legio-new");
    expect(forceDelta).toMatchObject({ change: "created", entityName: "Legio Nova" });
  });

  it("reports a removed force as deleted", () => {
    const before = world();
    const after = world();
    after.material.forces = after.material.forces.filter((force) => force.id !== "legio-i");
    const deltas = diffWorldState(before, after);
    expect(deltas.find((d) => d.entityType === "force" && d.entityId === "legio-i")).toMatchObject({ change: "deleted" });
  });

  it("reports a force's location field changing, whichever workflow moved it", () => {
    const before = world();
    const after = world();
    after.material.forces = after.material.forces.map((force) => (force.id === "legio-i" ? { ...force, locationId: SICILY_WEST } : force));
    const deltas = diffWorldState(before, after);
    const delta = deltas.find((d) => d.entityType === "force" && d.entityId === "legio-i");
    expect(delta?.change).toBe("updated");
    expect(delta?.fields).toContainEqual(expect.objectContaining({ field: "locationId" }));
  });

  it("resolves a force's location field to a place name, not a bare id", () => {
    const before = world();
    const after = world();
    after.material.forces = after.material.forces.map((force) => (force.id === "legio-i" ? { ...force, locationId: SICILY_WEST } : force));
    const delta = diffWorldState(before, after).find((d) => d.entityType === "force" && d.entityId === "legio-i");
    const locationChange = delta?.fields?.find((f) => f.field === "locationId");
    expect(locationChange?.to).toBe("Western Sicily");
  });

  it("finds casualties on a force -- a fitStrength drop -- with no battle-specific logic", () => {
    const before = world();
    const after = world();
    after.material.forces = after.material.forces.map((force) =>
      force.id === "legio-i" ? { ...force, personnel: force.personnel.map((category) => ({ ...category, fit: Math.floor(category.fit / 2) })) } : force,
    );
    const delta = diffWorldState(before, after).find((d) => d.entityType === "force" && d.entityId === "legio-i");
    expect(delta?.fields?.some((f) => f.field === "fitStrength")).toBe(true);
  });

  it("reports a province's control change, resolved to polity names", () => {
    const before = world();
    const after = world();
    after.map.provinces = after.map.provinces.map((province) => (province.id === MESSANA_PROVINCE ? { ...province, controllerPolityId: CARTHAGE } : province));
    const delta = diffWorldState(before, after).find((d) => d.entityType === "province" && d.entityId === MESSANA_PROVINCE);
    expect(delta?.change).toBe("updated");
    expect(delta?.fields).toContainEqual({ field: "controllerPolityId", from: "Roman Republic", to: "Carthage" });
  });

  it("reports a captured settlement the same generic way as a captured province", () => {
    const before = world();
    const after = world();
    after.map.provinces = after.map.provinces.map((province) => ({
      ...province,
      settlements: province.settlements.map((settlement) => (settlement.id === "messana-city" ? { ...settlement, controllerPolityId: CARTHAGE } : settlement)),
    }));
    const delta = diffWorldState(before, after).find((d) => d.entityType === "settlement" && d.entityId === "messana-city");
    expect(delta?.change).toBe("updated");
    expect(delta?.fields).toContainEqual({ field: "controllerPolityId", from: "Roman Republic", to: "Carthage" });
  });

  it("reports a new war as created and an ended one as deleted, keyed on the polity pair regardless of order", () => {
    const before = world();
    const after = world();
    // The fixture already has carthage-vs-rome at war; end it and start a new one.
    after.conflicts = { ...after.conflicts, wars: [{ polityAId: ROME, polityBId: "syracuse" }] };
    const deltas = diffWorldState(before, after);
    expect(deltas.find((d) => d.entityType === "war" && d.change === "deleted")).toMatchObject({ entityName: "Carthage vs Roman Republic" });
    expect(deltas.find((d) => d.entityType === "war" && d.change === "created")).toMatchObject({ entityName: "Roman Republic vs Kingdom of Syracuse" });
  });

  it("reports an account balance change on whichever workflow moved money", () => {
    const before = world();
    const after = world();
    after.material.accounts = after.material.accounts.map((account) => (account.id === "marcus-purse" ? { ...account, balance: account.balance + 500 } : account));
    const delta = diffWorldState(before, after).find((d) => d.entityType === "account" && d.entityId === "marcus-purse");
    expect(delta?.change).toBe("updated");
    expect(delta?.fields).toContainEqual({ field: "balance", from: 1_200, to: 1_700 });
    // Resolved to the owning character's name, not the account's own id.
    expect(delta?.entityName).toBe("Marcus Atilius");
  });

  it("reports a character's office and location changing", () => {
    const before = world();
    const after = world();
    after.characters = after.characters.map((character) => (character.id === "hanno" ? { ...character, locationProvinceId: MESSANA_PROVINCE } : character));
    const delta = diffWorldState(before, after).find((d) => d.entityType === "character" && d.entityId === "hanno");
    expect(delta?.fields).toContainEqual(expect.objectContaining({ field: "locationProvinceId", to: "North-eastern Sicily" }));
  });

  it("reports a diplomatic message's answer, so a treaty's ratification is not invisible to the diff", () => {
    const before = world();
    const after = world();
    after.diplomacy = [
      {
        id: "msg-1",
        kind: "alliance_offer",
        fromPolityId: ROME,
        fromCharacterId: "marcus-atilius",
        toPolityId: "syracuse",
        toCharacterId: null,
        subject: "Alliance against Carthage",
        terms: "Terms.",
        sentAtStep: 1,
        replyDueByStep: null,
        status: "answered",
        answer: "accepted",
        answerText: "Accepted.",
        answeredAtStep: 2,
        inReplyToMessageId: null,
        visibility: "polity",
      },
    ];
    const delta = diffWorldState(before, after).find((d) => d.entityType === "diplomaticMessage" && d.entityId === "msg-1");
    expect(delta?.change).toBe("created");
  });

  it("ignores an entity present in both snapshots with no tracked field different -- untracked bookkeeping fields (fatigue, provisioning) do not fire noise on every turn", () => {
    const before = world();
    const after = world();
    after.material.forces = after.material.forces.map((force) => (force.id === "legio-i" ? { ...force, fatigueBps: force.fatigueBps + 500, provisionedThroughStep: force.provisionedThroughStep + 4 } : force));
    const deltas = diffWorldState(before, after);
    expect(deltas.find((d) => d.entityType === "force" && d.entityId === "legio-i")).toBeUndefined();
  });
});
