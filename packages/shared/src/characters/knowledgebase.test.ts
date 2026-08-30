import { describe, expect, it } from "vitest";
import { CharacterKnowledgebaseSchema, KnowledgebaseRelationSchema } from "./knowledgebase";

const family = { name: "Aulus Cornelius", relationship: "Father", historical: true, notes: "A respected senator.", kind: "person" as const, category: "family" as const, familyRole: "parent" as const };
const other = { name: "Hanno Barca", relationship: "Political rival", historical: true, notes: "A rival in Sicily.", kind: "person" as const, category: "other" as const, familyRole: null };

function knowledgebase(relations: unknown[]) {
  return {
    version: 1 as const, characterId: "declared-player", gameId: "game-id", canonicalName: "Lucius Cornelius", nickname: null,
    birthYearApprox: -300, deathYearApprox: -250, origin: "historical" as const, period: "First Punic War", locationProvinceId: "sicily",
    culture: "Roman", faith: null, biography: "A historically grounded Roman aristocrat whose long biography is sufficient for schema validation and repeated AI context.", notableEvents: ["Held office."],
    role: "Roman senator", authority: [], socioEconomicClass: "Senatorial aristocracy",
    skills: { martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: {} },
    skillRationale: { martial: "Experienced officer." }, relations, confirmedByPlayer: false, confirmationDraft: "A confirmation draft that is comfortably longer than the minimum required length for the character declaration workflow.",
  };
}

describe("character knowledgebase key relations", () => {
  it("rejects collective entities masquerading as people", () => {
    expect(KnowledgebaseRelationSchema.safeParse({ ...other, name: "Carthaginian Navy" }).success).toBe(false);
  });

  it("requires family roles only for family members", () => {
    expect(KnowledgebaseRelationSchema.safeParse({ ...family, familyRole: null }).success).toBe(false);
    expect(KnowledgebaseRelationSchema.safeParse({ ...other, familyRole: "sibling" }).success).toBe(false);
  });

  it("requires four to eight human relations with both categories", () => {
    const valid = [family, other, { ...other, name: "Publius Claudius" }, { ...family, name: "Julia Cornelia", relationship: "Sister", familyRole: "sibling" as const }];
    expect(CharacterKnowledgebaseSchema.safeParse(knowledgebase(valid)).success).toBe(true);
    expect(CharacterKnowledgebaseSchema.safeParse(knowledgebase([family, other, { ...other, name: "Publius Claudius" }])).success).toBe(false);
    expect(CharacterKnowledgebaseSchema.safeParse(knowledgebase([family, { ...family, name: "Gaius Cornelius" }, { ...family, name: "Julia Cornelia" }])).success).toBe(false);
    expect(CharacterKnowledgebaseSchema.safeParse(knowledgebase([...valid, { ...other, name: "Marcus Fabius" }, { ...other, name: "Quintus Fabius" }, { ...other, name: "Titus Fabius" }, { ...other, name: "Sextus Fabius" }, { ...other, name: "Gnaeus Fabius" }])).success).toBe(false);
  });
});
