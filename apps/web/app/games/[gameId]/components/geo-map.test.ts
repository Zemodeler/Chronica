import { describe, expect, it } from "vitest";
import type { DynamicMapOverlay } from "@chronica/shared";
import { deriveForceConflictStatuses } from "./map-conflict-state";

const overlay: DynamicMapOverlay = {
  revision: 1,
  polities: [{ polityId: "carthage", name: "Carthage" }, { polityId: "rome", name: "Rome" }],
  politicalRelations: [],
  provinces: [],
  settlements: [{ settlementId: "fort", provinceId: "sicily", anchorFeatureId: "fort", name: "Fort Agrigentum", kind: "fortress", controllerPolityId: "carthage", capitalPolityId: null, importance: 50, underSiege: false, damaged: false }],
  forces: [
    { forceId: "battle-a", provinceId: "sicily", ownerPolityId: "rome", name: "Legio I", commanderLabel: "Scipio", strengthLabel: "3,000", relation: "friendly", selected: false, movement: null },
    { forceId: "battle-b", provinceId: "sicily", ownerPolityId: "carthage", name: "Carthaginian army", commanderLabel: "Hanno", strengthLabel: "3,000", relation: "hostile", selected: false, movement: null },
    { forceId: "attacker", provinceId: "sicily", ownerPolityId: "rome", name: "Siege army", commanderLabel: "Marcellus", strengthLabel: "1,000", relation: "friendly", selected: false, movement: null },
    { forceId: "defender", provinceId: "sicily", ownerPolityId: "carthage", name: "Garrison", commanderLabel: "Bomilcar", strengthLabel: "800", relation: "hostile", selected: false, movement: null },
  ],
  conflicts: {
    battles: [{ battleId: "battle", participantForceIds: ["battle-a", "battle-b"] }],
    sieges: [{ settlementId: "fort", invadingForceIds: ["attacker"], defendingForceIds: ["defender"] }],
    wars: [{ polityAId: "carthage", polityBId: "rome" }],
  },
};

describe("force conflict map state", () => {
  it("labels battle participants, siege attackers, and siege defenders for outlined rendering and army details", () => {
    const statuses = deriveForceConflictStatuses(overlay);
    expect(statuses.get("battle-a")).toEqual({ conflictClass: "combat", statusLabel: "In combat" });
    expect(statuses.get("attacker")).toEqual({ conflictClass: "siege-attacker", statusLabel: "Besieging Fort Agrigentum" });
    expect(statuses.get("defender")).toEqual({ conflictClass: "siege-defender", statusLabel: "Defending Fort Agrigentum" });
    expect(statuses.get("uncommitted")).toBeUndefined();
  });
});
