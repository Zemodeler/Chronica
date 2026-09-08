import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import { CharacterKnowledgebaseSchema } from "../../characters/knowledgebase";

describe("materialize_declared_player", () => {
  it("creates the confirmed player only through the registered workflow", () => {
    const knowledgebase = CharacterKnowledgebaseSchema.parse({
      version: 1, gameId: "test-game", characterId: "declared-player", canonicalName: "Aulus Testius", nickname: null,
      birthYearApprox: -300, deathYearApprox: null, origin: "invented", period: "First Punic War",
      locationProvinceId: "ita-local-23120603B86473916475875", culture: "Roman", faith: null,
      biography: "A sufficiently detailed invented Roman background that validates as a character knowledgebase for this workflow test.",
      notableEvents: [], role: "Roman citizen", authority: [], socioEconomicClass: "Citizen", startingMoney: 25,
      skills: { martial: 40, intrigue: 40, learning: 40, piety: 40, stewardship: 40, diplomacy: 40, body: 40, subSkills: {} },
      skillRationale: {}, relations: [
        { name: "Aulus Senior", relationship: "father", historical: false, notes: "A family tie.", kind: "person", category: "family", familyRole: "parent" },
        { name: "Titia", relationship: "sister", historical: false, notes: "A family tie.", kind: "person", category: "family", familyRole: "sibling" },
        { name: "Gaius", relationship: "friend", historical: false, notes: "A trusted ally.", kind: "person", category: "other", familyRole: null },
        { name: "Decimus", relationship: "rival", historical: false, notes: "A political rival.", kind: "person", category: "other", familyRole: null },
      ], confirmedByPlayer: true, confirmationDraft: null,
    });
    const outcome = executeWorkflow({ actionId: "materialize_declared_player", actorId: "system", parameters: { characterId: "declared-player", knowledgebase } }, structuredClone(firstPunicWarScenario.initialWorld), 1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.world.characters.some((character) => character.id === "declared-player")).toBe(true);
  });
});
