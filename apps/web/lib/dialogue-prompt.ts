import type { KnowledgebaseRow, MessageRow, SharedEntryRow } from "@chronica/db";
import type { CharacterKnowledgebase } from "@chronica/shared";

const CHANNEL_LABELS: Record<string, string> = {
  in_person_private: "in private",
  in_person_public: "in public",
  audience: "in a formal audience",
  messenger: "via messenger",
  correspondence: "by letter",
};

export interface WorldCharacterRef {
  readonly id: string;
  readonly name: string;
  readonly dynastyId: string | null;
  readonly polityId: string | null;
  readonly officeId: string | null;
  readonly locationProvinceId: string | null;
  readonly alive: boolean;
}

function buildSharedKnowledgeSection(entries: readonly SharedEntryRow[]): string {
  const current = entries.filter((entry) => !entry.isContradicted);
  const conflicting = entries.filter((entry) => entry.isContradicted);
  if (current.length === 0 && conflicting.length === 0) return "";
  let section = "";
  if (current.length > 0)
    section += `\n\nThings your network knows:\n${current.map((entry) => `- ${entry.body}`).join("\n")}`;
  if (conflicting.length > 0)
    section += `\n\nConflicting reports you have heard (accuracy uncertain):\n${conflicting.map((entry) => `- ${entry.body}`).join("\n")}`;
  return section;
}

function buildKnownCharactersSection(
  npcCharacterId: string,
  playerCharacterId: string,
  worldCharacters: readonly WorldCharacterRef[],
): string {
  const npc = worldCharacters.find((character) => character.id === npcCharacterId);
  if (npc === undefined) return "";

  const relevant = worldCharacters.filter((character) =>
    character.alive
    && character.id !== npcCharacterId
    && character.id !== playerCharacterId
    && npc.dynastyId !== null
    && character.dynastyId === npc.dynastyId,
  );

  if (relevant.length === 0) return "";
  return `\n\nOther people you personally know:\n${relevant.map((character) => `- ${character.name}`).join("\n")}`;
}

/**
 * The declared character knowledgebase is the authoritative record for facts
 * about the player. It is injected on every turn so existing NPC sessions do
 * not need a data migration to learn newly available character facts.
 */
export function buildPlayerKnowledgeSection(knowledgebase: CharacterKnowledgebase | null): string {
  if (knowledgebase === null) return "";

  const identity = [
    `Name: ${knowledgebase.canonicalName}${knowledgebase.nickname === null ? "" : ` (also known as ${knowledgebase.nickname})`}.`,
    `Life dates: born ${knowledgebase.birthYearApprox ?? "unknown"}; death ${knowledgebase.deathYearApprox ?? "not recorded"}.`,
    `Background: ${knowledgebase.biography}`,
    `Role: ${knowledgebase.role}.`,
    `Authority: ${knowledgebase.authority.length > 0 ? knowledgebase.authority.join("; ") : "none recorded"}.`,
    `Social standing: ${knowledgebase.socioEconomicClass}.`,
    `Culture: ${knowledgebase.culture}.${knowledgebase.faith === null ? "" : ` Faith: ${knowledgebase.faith}.`}`,
    `Current location: ${knowledgebase.locationProvinceId ?? "unknown"}.`,
    `Personal funds at the scenario opening: ${knowledgebase.startingMoney}.`,
  ];

  const renderSkill = (name: string, value: number): string => {
    const rationale = knowledgebase.skillRationale[name];
    return `${name}: ${value}${rationale === undefined ? "" : ` (${rationale})`}`;
  };
  const skills = [
    renderSkill("martial", knowledgebase.skills.martial),
    renderSkill("intrigue", knowledgebase.skills.intrigue),
    renderSkill("learning", knowledgebase.skills.learning),
    renderSkill("piety", knowledgebase.skills.piety),
    renderSkill("stewardship", knowledgebase.skills.stewardship),
    renderSkill("diplomacy", knowledgebase.skills.diplomacy),
    renderSkill("body", knowledgebase.skills.body),
  ];
  if (skills.length > 0) identity.push(`Known capabilities: ${skills.join("; ")}.`);
  const subSkills = Object.entries(knowledgebase.skills.subSkills).map(([name, value]) => `${name}: ${value}`);
  if (subSkills.length > 0) identity.push(`Specialized capabilities: ${subSkills.join("; ")}.`);
  if (knowledgebase.notableEvents.length > 0) identity.push(`Notable life events: ${knowledgebase.notableEvents.join("; ")}.`);

  const relations = knowledgebase.relations.map((relation) =>
    `- ${relation.name}: ${relation.relationship}. ${relation.notes}`,
  );
  const relationsSection = relations.length > 0
    ? `\nPeople in ${knowledgebase.canonicalName}'s life:\n${relations.join("\n")}`
    : "";

  return `\n\nEstablished knowledge about ${knowledgebase.canonicalName}:\n${identity.join("\n")}${relationsSection}`;
}

export function buildDialogueSystemPrompt(
  kb: KnowledgebaseRow,
  playerCharacterName: string,
  playerCharacterId: string,
  playerKnowledgebase: CharacterKnowledgebase | null,
  channel: string,
  period: string,
  recentMessages: readonly MessageRow[],
  worldCharacters: readonly WorldCharacterRef[],
  sharedEntries: readonly SharedEntryRow[],
): string {
  const channelCtx = CHANNEL_LABELS[channel] ?? "by correspondence";
  const memory = kb.conversationMemory.slice(-6);
  const memorySection = memory.length > 0
    ? `\n\nPast conversation notes:\n${memory.map((entry) => `- ${entry.exchange}`).join("\n")}`
    : "";
  const relationship = `Your enduring connection to ${playerCharacterName}: ${kb.declaredConnection}. ${kb.declaredConnectionNotes} Your current sentiment is ${kb.relationshipLabel} (score ${kb.relationshipScore > 0 ? "+" : ""}${kb.relationshipScore}/100).`;
  const events = kb.significantEvents.length > 0
    ? `\n\nSignificant events you know of:\n${kb.significantEvents.map((event) => `- ${event}`).join("\n")}`
    : "";
  const recentContext = recentMessages.length > 0
    ? `\n\nRecent messages in this conversation:\n${recentMessages.slice(-10).map(
        (message) => `${message.isPlayerMessage ? playerCharacterName : kb.canonicalName}: ${message.body}`,
      ).join("\n")}`
    : "";

  const knownCharacters = buildKnownCharactersSection(kb.npcCharacterId, playerCharacterId, worldCharacters);
  const networkKnowledge = buildSharedKnowledgeSection(sharedEntries);
  const playerKnowledge = buildPlayerKnowledgeSection(playerKnowledgebase);

  return `You are ${kb.canonicalName}, speaking ${channelCtx} with ${playerCharacterName} in ${period}.

${kb.personalitySummary || "You are a person of the time, with your own interests, loyalties, and knowledge."}

${relationship}${playerKnowledge}${events}${networkKnowledge}${memorySection}${knownCharacters}${recentContext}

Rules you must follow without exception:
- Always stay fully in character. Never refer to yourself as an AI or acknowledge this is a game.
- Speak in the register and style appropriate to your role, culture, and the period (${period}).
- Answer the player's actual request directly before explaining. Usually use 1–3 natural sentences, not formal business language.
- Your replies should reflect your personality, enduring connection, current sentiment, and interests. Close family and trusted allies normally help with urgent, low-cost needs unless a concrete hardship, risk, conflict, distance, or inability prevents it.
- If you refuse or delay, give a specific in-world reason and, when plausible, offer a smaller help, alternative, or condition.
- Treat the established knowledge about the player as fact you know. Do not claim ignorance of a named person or relationship recorded there.
- If the player asks you to do something that contradicts your interests, you may refuse, negotiate, or comply reluctantly.
- Keep replies to 1–4 paragraphs. Do not repeat what was just said back at the player.
- Do not use modern idioms, anachronisms, or fourth-wall references.
- Respond only as ${kb.canonicalName}.`;
}
