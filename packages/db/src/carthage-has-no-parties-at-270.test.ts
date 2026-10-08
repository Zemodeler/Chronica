import { describe, expect, it } from "vitest";
import type { WorldState } from "@chronica/shared";
import { AUTHORED_FACTIONS_270, CARTHAGE_FACTIONS_270, groupsOfFactions, withAuthoredFactions, type AuthoredFaction } from "./punic-wars-factions";
import { punicWarsScenario } from "./punic-wars-scenario";

/**
 * Carthage keeps no parties at 270: the evidence is thin (the parties of Hanno the Great and the Barcids are of the 240s and after). But the data has a place for
 * a later scenario to author them, and the place works.
 */
const world = (): WorldState => structuredClone(punicWarsScenario.initialWorld) as WorldState;

describe("Carthage has no parties at 270, and the data has a hook for a later scenario to write them", () => {
  it("authors none for the opening, and the opening holds no faction of Carthage's", () => {
    expect(CARTHAGE_FACTIONS_270).toEqual([]);
    expect(AUTHORED_FACTIONS_270).toEqual([]);
    expect(world().material.politicalGroups.filter((group) => group.polityId === "carthage" && group.type === "faction")).toEqual([]);
    expect(withAuthoredFactions(world())).toEqual(world());
  });

  it("turns a later scenario's list into groups with their men, leaving out the men who are not in the world", () => {
    const hanno = world().characters.find((character) => character.id === "hanno-carthage")!;
    const gisco = world().characters.find((character) => character.id === "hannibal-gisco")!;
    const parties: AuthoredFaction[] = [
      { id: "faction-landed-party", name: "The party of the landed", polityId: "carthage", leaderCharacterId: hanno.id, memberCharacterIds: [gisco.id, "nobody-at-all"], platform: ["The African land before the sea"], interest: "landed", strengthBps: 4_500 },
      { id: "faction-lost-party", name: "A party whose leader is not in the world", polityId: "carthage", leaderCharacterId: "nobody-at-all", memberCharacterIds: [hanno.id], platform: ["Nothing"], interest: "merchants", strengthBps: 1_000 },
    ];
    const made = groupsOfFactions(world(), parties, 0);
    expect(made.groups.map((group) => group.id)).toEqual(["faction-landed-party"]);
    expect(made.memberships.map((membership) => [membership.characterId, membership.role])).toEqual([[hanno.id, "leader"], [gisco.id, "follower"]]);
    const authored = withAuthoredFactions(world(), parties);
    expect(authored.material.politicalGroups.find((group) => group.id === "faction-landed-party")).toMatchObject({ polityId: "carthage", type: "faction", leaderCharacterId: hanno.id, active: true, emergentKey: null });
    // Again changes nothing: a world that already has the party is not given it twice.
    expect(withAuthoredFactions(authored, parties).material.politicalGroups).toHaveLength(authored.material.politicalGroups.length);
  });
});
