import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { createCanonicalNpc, linkCanonicalCharacters } from "./canonical-npc";
import { materializePlayerCharacter } from "./player-materialization";

const playerKnowledgebase = {
  version: 1 as const, characterId: "declared-player", gameId: "game", canonicalName: "Aulus Testius", nickname: null,
  birthYearApprox: null, deathYearApprox: null, origin: "invented" as const, period: "test", locationProvinceId: "ita-local-23120603B86473916475875",
  culture: "Roman", faith: null, biography: "A sufficiently detailed invented Roman background for a canonical player materialisation test.", notableEvents: [],
  role: "Citizen", authority: [], socioEconomicClass: "Citizen", startingMoney: 12,
  skills: { martial: 40, intrigue: 40, learning: 40, piety: 40, stewardship: 40, diplomacy: 40, body: 40, subSkills: {} }, skillRationale: {}, relations: [],
  confirmedByPlayer: true, confirmationDraft: null,
};

describe("canonical NPC construction", () => {
  it("creates one complete NPC and canonical reciprocal links without duplicates", () => {
    let world = materializePlayerCharacter(structuredClone(firstPunicWarScenario.initialWorld), "declared-player", playerKnowledgebase, undefined);
    const created = createCanonicalNpc(world, {
      characterId: "npc-relation", name: "Livia Testia", locationProvinceId: playerKnowledgebase.locationProvinceId!, polityId: "rome",
      startingMoney: 0, createdAtStep: world.elapsedStep, creationReason: "Declared sibling.",
    });
    expect(created).not.toBeNull();
    if (created === null) return;
    world = linkCanonicalCharacters(created.world, "declared-player", "npc-relation", "sister", 45, world.elapsedStep);
    world = linkCanonicalCharacters(world, "npc-relation", "declared-player", "brother", 45, world.elapsedStep);
    const npc = world.characters.find((character) => character.id === "npc-relation");
    expect(npc?.mind).toBeDefined();
    expect(npc?.locationProvinceId).toBe(playerKnowledgebase.locationProvinceId);
    expect(world.material.accounts.some((account) => account.id === npc?.personalAccountId)).toBe(true);
    expect(world.characters.find((character) => character.id === "declared-player")?.relations).toHaveLength(1);
    expect(npc?.relations).toHaveLength(1);

    const again = createCanonicalNpc(world, {
      characterId: "npc-relation", name: "Livia Testia", locationProvinceId: playerKnowledgebase.locationProvinceId!, polityId: "rome",
      createdAtStep: world.elapsedStep, creationReason: "Retry.",
    });
    expect(again?.world.characters.filter((character) => character.id === "npc-relation")).toHaveLength(1);
  });

  it("keeps the relation cause id within EntityIdSchema's 120-char cap even when the source ids are long", () => {
    let world = materializePlayerCharacter(structuredClone(firstPunicWarScenario.initialWorld), "declared-player", playerKnowledgebase, undefined);
    const longNpcId = `declared-npc-${"a-very-long-slugified-declared-npc-name".repeat(3)}-11111111-1111-1111-1111-111111111111`;
    const created = createCanonicalNpc(world, {
      characterId: longNpcId, name: "A Character With An Unusually Long Declared Name", locationProvinceId: playerKnowledgebase.locationProvinceId!, polityId: "rome",
      startingMoney: 0, createdAtStep: world.elapsedStep, creationReason: "Declared relation.",
    });
    expect(created).not.toBeNull();
    if (created === null) return;
    world = linkCanonicalCharacters(created.world, "declared-player", longNpcId, "acquaintance", 10, world.elapsedStep);
    world = linkCanonicalCharacters(world, longNpcId, "declared-player", "acquaintance", 10, world.elapsedStep);
    const player = world.characters.find((character) => character.id === "declared-player");
    const npc = world.characters.find((character) => character.id === longNpcId);
    for (const causeId of [...player!.relations, ...npc!.relations].flatMap((relation) => relation.causes.map((cause) => cause.id))) {
      expect(causeId.length).toBeLessThanOrEqual(120);
    }
  });
});
