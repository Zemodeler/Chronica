import { describe, expect, it } from "vitest";
import { buildDialogueSystemPrompt, buildPlayerKnowledgeSection } from "./dialogue-prompt";
import type { CharacterKnowledgebase } from "@chronica/shared";
import { NEUTRAL_MIND } from "@chronica/shared";
import type { KnowledgebaseRow } from "@chronica/db";

const playerKnowledgebase: CharacterKnowledgebase = {
  version: 1,
  characterId: "declared-player-1",
  gameId: "game-1",
  canonicalName: "Lucius Aurelius",
  nickname: null,
  birthYearApprox: -290,
  deathYearApprox: null,
  origin: "invented",
  period: "First Punic War",
  locationProvinceId: "sicily-east",
  culture: "Roman",
  faith: "Roman religion",
  biography: "Lucius is a young Roman merchant from a well-connected household in Syracuse.",
  notableEvents: ["Survived the siege of Messana."],
  role: "Grain merchant",
  authority: ["Controls a small fleet of grain ships."],
  socioEconomicClass: "Equestrian",
  startingMoney: 120,
  skills: { martial: 20, intrigue: 35, learning: 45, piety: 50, stewardship: 70, diplomacy: 55, body: 40, subSkills: {} },
  skillRationale: {},
  relations: [
    {
      name: "Gaius Aurelius",
      relationship: "younger brother",
      historical: false,
      notes: "Gaius is Lucius's younger brother and helps manage the family warehouses.",
      kind: "person",
      category: "family",
      familyRole: "sibling",
    },
    {
      name: "Marcus Tulia",
      relationship: "family friend",
      historical: false,
      notes: "Marcus has known the Aurelius family for many years.",
      kind: "person",
      category: "other",
      familyRole: null,
    },
  ],
  confirmedByPlayer: true,
  confirmationDraft: null,
};

describe("buildPlayerKnowledgeSection", () => {
  it("provides a family friend with the brother's name and established relationship", () => {
    const section = buildPlayerKnowledgeSection(playerKnowledgebase);

    expect(section).toContain("Gaius Aurelius: younger brother");
    expect(section).toContain("helps manage the family warehouses");
    expect(section).toContain("Marcus Tulia: family friend");
  });

  it("omits the section when no declared character knowledgebase exists", () => {
    expect(buildPlayerKnowledgeSection(null)).toBe("");
  });

  it("adds declared relations to the complete NPC dialogue prompt", () => {
    const npcKnowledgebase: KnowledgebaseRow = {
      id: "npc-kb-1",
      gameId: "game-1",
      playerId: "player-1",
      npcCharacterId: "marcus-tulia",
      canonicalName: "Marcus Tulia",
      personalitySummary: "A cautious family friend.",
      biography: null,
      culture: null,
      faith: null,
      socioEconomicClass: null,
      role: null,
      skills: null,
      goals: [],
      backstory: [],
      relationshipLabel: "neutral",
      declaredConnection: "family friend",
      declaredConnectionNotes: "Knows the family well.",
      relationshipScore: 0,
      conversationMemory: [],
      significantEvents: [],
      consequences: [],
      relevancyScore: 0,
      interactionCount: 0,
      locationProvinceId: null,
      isAvailable: true,
    };

    const prompt = buildDialogueSystemPrompt(
      npcKnowledgebase,
      "Lucius Aurelius",
      "declared-player-1",
      playerKnowledgebase,
      "correspondence",
      "First Punic War",
      [],
      [],
      { mind: NEUTRAL_MIND, traits: [], pressures: [], beliefs: [] },
      { score: 0, label: "neutral" },
    );

    expect(prompt).toContain("Gaius Aurelius: younger brother");
    expect(prompt).toContain("Do not claim ignorance of a named person or relationship recorded there.");
  });
});
