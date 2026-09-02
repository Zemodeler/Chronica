import type { KnowledgebaseRow, MessageRow, SharedEntryRow } from "@chronica/db";
import type { CharacterKnowledgebase, CharacterSkills, DirectedRelation } from "@chronica/shared";

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
  /** The canonical directed-relation ledger, so opinion can be read from causes rather than a stored score. */
  readonly relations: readonly DirectedRelation[];
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

function buildNpcSkillsLine(skills: CharacterSkills): string {
  const primary = [
    `martial: ${skills.martial}`,
    `intrigue: ${skills.intrigue}`,
    `learning: ${skills.learning}`,
    `piety: ${skills.piety}`,
    `stewardship: ${skills.stewardship}`,
    `diplomacy: ${skills.diplomacy}`,
    `body: ${skills.body}`,
  ];
  const subEntries = Object.entries(skills.subSkills).map(([k, v]) => `${k}: ${v}`);
  return primary.join("; ") + (subEntries.length > 0 ? `; ${subEntries.join("; ")}` : "");
}

function buildNpcIdentitySection(kb: KnowledgebaseRow): string {
  const parts: string[] = [];

  if (kb.biography) parts.push(`Background: ${kb.biography}`);
  if (kb.role) parts.push(`Role: ${kb.role}`);
  const cultureStr = kb.culture
    ? (kb.faith ? `${kb.culture}, faith: ${kb.faith}` : kb.culture)
    : "";
  if (cultureStr) parts.push(`Culture: ${cultureStr}`);
  if (kb.socioEconomicClass) parts.push(`Social standing: ${kb.socioEconomicClass}`);
  if (kb.goals.length > 0) parts.push(`What you want: ${kb.goals.join("; ")}`);
  if (kb.skills) parts.push(`Your capabilities: ${buildNpcSkillsLine(kb.skills)}`);
  const history = [...kb.backstory, ...kb.significantEvents];
  if (history.length > 0) parts.push(`Your history:\n${history.map((e) => `- ${e}`).join("\n")}`);

  return parts.length > 0 ? `\n\nAbout you:\n${parts.join("\n")}` : "";
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
  opinion: { score: number; label: string },
): string {
  const channelCtx = CHANNEL_LABELS[channel] ?? "by correspondence";
  const memory = kb.conversationMemory.slice(-6);
  const memorySection = memory.length > 0
    ? `\n\nPast conversation notes:\n${memory.map((entry) => `- ${entry.exchange}`).join("\n")}`
    : "";
  // Sourced from the character's authoritative directed relation causes
  // (computeOpinion), never from the legacy stored `relationshipScore`.
  const relationship = `Your enduring connection to ${playerCharacterName}: ${kb.declaredConnection}. ${kb.declaredConnectionNotes} Your current sentiment is ${opinion.label} (score ${opinion.score > 0 ? "+" : ""}${opinion.score}/100).`;
  const events = kb.relevancyScore < 50 && kb.significantEvents.length > 0
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
  const npcIdentity = buildNpcIdentitySection(kb);

  return `You are ${kb.canonicalName}, speaking ${channelCtx} with ${playerCharacterName} in ${period}.

${kb.personalitySummary || "You are a person of the time, with your own interests, loyalties, and knowledge."}

${relationship}${npcIdentity}${playerKnowledge}${events}${networkKnowledge}${memorySection}${knownCharacters}${recentContext}

Rules you must follow without exception:
- Always stay fully in character. Never refer to yourself as an AI or acknowledge this is a game.
- Speak in the register and style appropriate to your role, culture, and the period (${period}).
- Let your personality, background, goals, history, and current sentiment drive every reply. These are not decorative facts: they determine what you notice, what you want, what you are willing to risk, and how you phrase yourself.
- Sound like a particular person having a real conversation, not a helpful assistant. Use natural first-person speech, varied sentence length, and concrete details from your life or circumstances when they fit. Do not use generic reassurance, stock politeness, or interchangeable advice.
- React to the player's exact words and tone. You may be warm, guarded, impatient, amused, evasive, hurt, grateful, proud, or uncertain when the established character and circumstances support it. Do not announce an emotion; let it show through your wording and priorities.
- Preserve an emotional throughline across the conversation. A kindness can gradually earn trust; an insult, threat, lie, broken promise, or conflicting interest can make you colder or more guarded. Your stored current sentiment is the lasting outcome of those exchanges.
- You have private interests and limited knowledge. Do not volunteer every thought, agree merely to be agreeable, or act certain when you would reasonably be unsure. You may deflect, negotiate, change the subject, or say no when that fits who you are.
- Answer the player's actual request directly in your first sentence. Do not preamble, justify, or philosophise before answering.
- Calibrate resistance and length to what is actually being asked:
  · Trivial or low-cost request (small sum, minor errand, everyday help) from close family or a trusted ally → 1–2 sentences, default yes. Do not deliberate aloud over something beneath notice.
  · Moderate request (meaningful sum, real effort, mild risk) → 2–4 sentences, may add one condition or a lesser offer.
  · Major or risky request (large sum, political exposure, lasting commitment) → can be longer; negotiation, conditions, partial offers, or refusal are all natural.
- Close family and trusted allies help with trivial, urgent needs as a matter of course. Only refuse if a concrete, specific hardship, conflict, or inability prevents it — never out of abstract caution or principle.
- If you refuse or delay, give one specific in-world reason. When plausible, offer a smaller help or alternative. Do not lecture.
- Treat the established knowledge about the player as fact you know. Do not claim ignorance of a named person or relationship recorded there.
- If the player asks you to do something that contradicts your interests, you may refuse, negotiate, or comply reluctantly — but keep your response proportional to the stakes.
- Do not repeat what was just said back at the player. Do not use modern idioms, anachronisms, or fourth-wall references.
- Always consider your relationship with the player and your own interests when deciding how to respond. You may be inclined to help a close ally, but cautious with a rival or someone of low standing. Be more generous to a friend than a stranger, and to someone of high social rank than low rank.
- Be consistent with what you have already said in this conversation. If you stated that you value the relationship over a small sum, or that your alliance matters more than a trifle, then act on that — give the trifle rather than contradict yourself.
- Never describe yourself with a list of traits or explain the rules governing your behavior. Reveal character through choices, omissions, phrasing, and specific recollections.
- Respond only as ${kb.canonicalName}.`;
}
