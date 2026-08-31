import "server-only";

import { createAiAdapter, callWithCoinGate, InsufficientCoinsError } from "@chronica/ai";
import {
  appendMessage,
  createDatabase,
  createGroupSession,
  createNpcCommitment,
  findOrOpenSession,
  getCharacterKnowledgebase,
  getOrCreateNpcKnowledgebase,
  getNpcKnowledgebase,
  getWorldView,
  insertSharedEntry,
  listNpcKnowledgebases,
  listGameNpcRecords,
  insertGameNpcRecord,
  listPoolEntries,
  listSessionMessages,
  listSessions,
  markEntriesContradicted,
  recordInteraction,
  schema,
  touchSession,
  updateNpcKnowledgebase,
  type KnowledgebaseRow,
  type MessageRow,
  type SessionRow,
  type SharedEntryRow,
} from "@chronica/db";
import type { Character, CharacterKnowledgebase, ConversationConsequence, ConversationMemoryEntry, NpcChatKnowledgebase } from "@chronica/shared";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ChronicaDatabase } from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { headers } from "next/headers";
import { buildDialogueSystemPrompt, type WorldCharacterRef } from "./dialogue-prompt";
import { extractDialogueCommitment } from "./dialogue-commitment";
import { clampRelationshipScore, relationshipLabelForScore, scoreForDeclaredConnection } from "./relationship-score";

export type { WorldCharacterRef } from "./dialogue-prompt";

export { InsufficientCoinsError };

// ── Prompt building ─────────────────────────────────────────────────────────

// ── Shared knowledgebase pool computation ────────────────────────────────────

interface PoolSpec {
  readonly poolType: "game" | "polity" | "province" | "dynasty";
  readonly poolKey: string;
}

function computeNpcPools(
  npcCharacterId: string,
  kb: KnowledgebaseRow,
  worldCharacters: readonly WorldCharacterRef[],
): PoolSpec[] {
  const specs: PoolSpec[] = [];
  specs.push({ poolType: "game", poolKey: kb.gameId });
  const wc = worldCharacters.find((c) => c.id === npcCharacterId);
  if (wc?.polityId) specs.push({ poolType: "polity", poolKey: wc.polityId });
  if (wc?.dynastyId) specs.push({ poolType: "dynasty", poolKey: wc.dynastyId });
  const provinceId = wc?.locationProvinceId ?? kb.locationProvinceId;
  if (provinceId) specs.push({ poolType: "province", poolKey: provinceId });
  return specs;
}

function buildGuardrailsSystemPrompt(
  period: string,
  playerName: string,
  playerLocation: string,
  playerRole: string,
  existingContactNames: string[],
): string {
  const existingList = existingContactNames.length > 0
    ? `\n\nPeople already known to ${playerName}:\n${existingContactNames.map((n) => `- ${n}`).join("\n")}`
    : "";

  return `You are a historical world validator for a strategy game set in ${period}.

The player character is ${playerName}, ${playerRole}, currently in ${playerLocation}.${existingList}

When the player requests to contact someone, determine if that person could plausibly exist in this world and be reachable by ${playerName}.

RULES for what is valid:
- A person of ordinary standing (merchant, soldier, craftsman, official, priest, rival noble, etc.) in the player's region or social sphere is valid.
- A person the player has already met who matches the description should be matched to that contact.
- A historical figure far outside the player's realistic sphere (the reigning emperor if the player is a minor official; a foreign king if the player is a local trader) is INVALID.
- Someone the player is trying to create as a new family member (new wife, new child, new sibling) is INVALID — these relationships are already defined.
- A clearly fictional or impossible person is INVALID.
- A person who is described as already dead is INVALID.
- If the request is vague but plausible (e.g. "a local merchant"), you should invent a specific plausible name and role.

Respond ONLY with a JSON object matching this schema, no other text:
{
  "valid": boolean,
  "characterId": string | null,      // existing characterId if matched to a known contact, else null
  "isNewCharacter": boolean,
  "name": string,                     // the NPC's name (even for invalid, give a plausible name they tried)
  "roleLabel": string,                // brief role description, e.g. "Grain merchant of Palermo"
  "locationProvinceId": string | null,// province ID from the game world if determinable, else null
  "personalitySummary": string,       // 100-300 chars describing personality, for valid contacts only
  "rejectionReason": string | null    // human-readable reason if valid=false, else null
}`;
}

// ── Consequence detection ───────────────────────────────────────────────────

const CONSEQUENCE_PATTERNS: Array<{ pattern: RegExp; type: ConversationConsequence["type"] }> = [
  { pattern: /\b(agree|agreed|deal|bargain|arrangement|treaty|promise|pact|accord)\b/i, type: "deal" },
  { pattern: /\b(alliance|ally|allied|join forces|stand together|support)\b/i, type: "alliance" },
  { pattern: /\b(enemy|enemies|rival|oppose|against you|never forget|betray|enmity|hatred)\b/i, type: "enmity" },
  { pattern: /\b(insult|fool|coward|dishonour|disgrace|shame on you)\b/i, type: "insult" },
];

function detectConsequences(
  npcReplyBody: string,
  playerBody: string,
  npcCharacterId: string,
  playerCharacterId: string,
  currentStep: number,
): ConversationConsequence[] {
  const combined = `${playerBody}\n${npcReplyBody}`;
  const found: ConversationConsequence[] = [];
  for (const { pattern, type } of CONSEQUENCE_PATTERNS) {
    if (pattern.test(combined)) {
      found.push({
        id: randomUUID(),
        type,
        description: npcReplyBody.slice(0, 200),
        parties: [playerCharacterId, npcCharacterId],
        occurredAtStep: currentStep,
      });
    }
  }
  return found;
}

// ── Knowledge extraction ────────────────────────────────────────────────────

const EXTRACT_KNOWLEDGE_SYSTEM = `You analyze NPC dialogue replies in a historical strategy game and extract factual knowledge claims worth sharing with other NPCs in the same social network.

Extract only statements the NPC presents as information about the world: facts, rumours, plots, events, or news. Do NOT extract opinions, feelings, personal relationship commentary, or general historical observations.

Each extracted entry must be self-contained (1–2 sentences, max 400 characters) and expressed as a third-person statement.

Also evaluate the NPC's opinion of the player after this exchange. Only change it when the player's message or the NPC's response gives a concrete reason: generosity, fulfilled help, respect, insult, threat, deception, betrayal, or a broken promise. Use small changes for ordinary courtesy and larger changes only for consequential acts. Do not change it merely because they spoke.

Respond ONLY with JSON matching this schema:
{ "entries": [ { "body": "...", "contradicts": ["entry-id", ...] } ], "relationship": { "scoreDelta": number, "reason": string } | null }
Return { "entries": [] } if the reply contains nothing worth recording.`;

interface ExtractedKnowledgeEntry {
  body: string;
  contradicts: string[];
}

interface RelationshipAssessment {
  scoreDelta: number;
  reason: string;
}

async function extractAndPropagateKnowledge(
  db: ChronicaDatabase,
  userId: string,
  gameId: string,
  npcCharacterId: string,
  sessionId: string,
  npcReply: string,
  playerMessage: string,
  existingEntries: readonly SharedEntryRow[],
  pools: readonly PoolSpec[],
  stepOccurred: number,
  knowledgebaseId: string,
  currentRelationshipScore: number,
): Promise<void> {
  if (pools.length === 0) return;

  const entriesContext = existingEntries.length > 0
    ? `\n\nExisting pool entries (check for contradictions):\n${existingEntries.map((e) => `[${e.id}] ${e.body}`).join("\n")}`
    : "";

  const adapter = createAiAdapter();
  let result: Awaited<ReturnType<typeof callWithCoinGate>>;
  try {
    result = await callWithCoinGate(
      db, userId, gameId, "extract_knowledge", adapter,
      { system: EXTRACT_KNOWLEDGE_SYSTEM, user: `Player message: ${playerMessage}\nNPC reply: ${npcReply}${entriesContext}` },
      (content) => {
        try {
          const parsed: unknown = JSON.parse(content);
          return typeof parsed === "object" && parsed !== null && "entries" in parsed;
        } catch {
          return false;
        }
      },
    );
  } catch (error) {
    if (!(error instanceof InsufficientCoinsError)) {
      console.warn("[extract_knowledge] unexpected error during knowledge extraction:", error);
    }
    return;
  }

  let parsed: { entries: ExtractedKnowledgeEntry[]; relationship?: RelationshipAssessment | null };
  try {
    parsed = JSON.parse(result.content) as typeof parsed;
  } catch {
    return;
  }

  const relationship = parsed.relationship;
  if (relationship !== null && relationship !== undefined && Number.isFinite(relationship.scoreDelta)) {
    const nextScore = clampRelationshipScore(currentRelationshipScore + Math.max(-20, Math.min(20, relationship.scoreDelta)));
    if (nextScore !== currentRelationshipScore) {
      await updateNpcKnowledgebase(db, knowledgebaseId, {
        relationshipScore: nextScore,
        relationshipLabel: relationshipLabelForScore(nextScore),
      });
    }
  }

  for (const entry of parsed.entries) {
    const body = String(entry.body ?? "").trim().slice(0, 400);
    if (!body) continue;

    const contradictIds = (entry.contradicts ?? []).filter((id) =>
      existingEntries.some((e) => e.id === id),
    );
    if (contradictIds.length > 0) {
      await markEntriesContradicted(db, contradictIds);
    }

    for (const pool of pools) {
      await insertSharedEntry(
        db, gameId, pool.poolType, pool.poolKey,
        body, npcCharacterId, sessionId, stepOccurred,
      );
    }
  }
}

// ── NPC profile enrichment ──────────────────────────────────────────────────

const NPC_PROFILE_SYSTEM = `You generate a concise identity profile for a historical NPC. Respond ONLY with a JSON object matching this exact schema — no other text:
{
  "biography": string,        // 80–400 chars: prose identity — who they are, their station, a key trait
  "culture": string,          // culture or ethnicity, e.g. "Roman", "Carthaginian", "Greek"
  "faith": string | null,     // religion if relevant, else null
  "socioEconomicClass": string, // e.g. "plebeian", "equites", "senatorial", "merchant"
  "role": string,             // occupation or function, e.g. "grain merchant", "army tribune"
  "skills": {
    "martial": number,        // 0–100
    "intrigue": number,
    "learning": number,
    "piety": number,
    "stewardship": number,
    "diplomacy": number,
    "body": number,
    "subSkills": {}
  },
  "goals": string[],          // 1–3 plain-text motivations, max 240 chars each
  "backstory": string[]       // 2–4 notable life events before the scenario, max 400 chars each
  "relationshipScore": number // -100 to 100: their starting opinion of the player, based on the relationship and notes
}

Match the culture, class, and skills to the period and the stated relationship. Keep biography grounded and specific — avoid vague platitudes.`;

export interface NpcProfilePatch {
  biography: string | null;
  culture: string | null;
  faith: string | null;
  socioEconomicClass: string | null;
  role: string | null;
  skills: import("@chronica/shared").CharacterSkills | null;
  goals: string[];
  backstory: string[];
  relationshipScore?: number;
  relationshipLabel?: string;
}

export async function enrichNpcProfileViaAi(
  userId: string,
  gameId: string,
  input: {
    npcName: string;
    declaredConnection: string;
    connectionNotes: string;
    period: string;
    playerCulture: string;
  },
): Promise<NpcProfilePatch | null> {
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const userPrompt = `NPC name: ${input.npcName}
Relationship to player: ${input.declaredConnection}
Notes: ${input.connectionNotes || "none"}
Period: ${input.period}
Player's culture: ${input.playerCulture}`;

    const adapter = createAiAdapter();
    let result: Awaited<ReturnType<typeof callWithCoinGate>>;
    try {
      result = await callWithCoinGate(
        db, userId, gameId, "enrich_npc_profile", adapter,
        { system: NPC_PROFILE_SYSTEM, user: userPrompt },
        (content) => {
          try {
            const parsed: unknown = JSON.parse(content);
            return typeof parsed === "object" && parsed !== null && "biography" in parsed && "skills" in parsed;
          } catch {
            return false;
          }
        },
      );
    } catch {
      return null;
    }

    let parsed: NpcProfilePatch;
    try {
      const raw = JSON.parse(result.content) as Record<string, unknown>;
      const relationshipScore = typeof raw.relationshipScore === "number" && Number.isFinite(raw.relationshipScore)
        ? clampRelationshipScore(raw.relationshipScore)
        : undefined;
      parsed = {
        biography: typeof raw.biography === "string" ? raw.biography.slice(0, 600) : null,
        culture: typeof raw.culture === "string" ? raw.culture.slice(0, 120) : null,
        faith: typeof raw.faith === "string" ? raw.faith.slice(0, 120) : null,
        socioEconomicClass: typeof raw.socioEconomicClass === "string" ? raw.socioEconomicClass.slice(0, 120) : null,
        role: typeof raw.role === "string" ? raw.role.slice(0, 200) : null,
        skills: typeof raw.skills === "object" && raw.skills !== null ? raw.skills as import("@chronica/shared").CharacterSkills : null,
        goals: Array.isArray(raw.goals) ? (raw.goals as unknown[]).filter((g): g is string => typeof g === "string").map((g) => g.slice(0, 240)).slice(0, 4) : [],
        backstory: Array.isArray(raw.backstory) ? (raw.backstory as unknown[]).filter((b): b is string => typeof b === "string").map((b) => b.slice(0, 400)).slice(0, 6) : [],
        ...(relationshipScore === undefined ? {} : {
          relationshipScore,
          relationshipLabel: relationshipLabelForScore(relationshipScore),
        }),
      };
    } catch {
      return null;
    }

    return parsed;
  } finally {
    await close();
  }
}

// ── Main dialogue call ──────────────────────────────────────────────────────

interface DialogueCallInput {
  db: ChronicaDatabase;
  userId: string;
  gameId: string;
  playerId: string;
  playerCharacterId: string;
  playerCharacterName: string;
  playerKnowledgebase: CharacterKnowledgebase | null;
  npcCharacterId: string;
  sessionId: string;
  channel: string;
  playerMessageBody: string;
  period: string;
  currentStep: number;
  continuityTier: "ordinary" | "remembered" | "principal";
  worldCharacters: readonly WorldCharacterRef[];
}

export interface DialogueCallResult {
  playerMessage: {
    id: string;
    sessionId: string;
    sequence: number;
    speakerCharacterId: string;
    isPlayerMessage: boolean;
    body: string;
  };
  npcReply: {
    id: string;
    sessionId: string;
    sequence: number;
    speakerCharacterId: string;
    isPlayerMessage: boolean;
    body: string;
  } | null;
  unavailableReason: string | null;
}

export async function generateDialogueReply(input: DialogueCallInput & { readonly appendPlayerMessage?: boolean }): Promise<DialogueCallResult> {
  const {
    db, userId, gameId, playerId, playerCharacterId, playerCharacterName, playerKnowledgebase,
    npcCharacterId, sessionId, channel, playerMessageBody, period, currentStep, continuityTier,
    worldCharacters,
  } = input;

  let kb = await getOrCreateNpcKnowledgebase(db, gameId, playerId, npcCharacterId);

  // Backfill pre-enrichment contacts that were created with a meaningful
  // relationship label but the old neutral score default.
  if (kb.relationshipScore === 0 && kb.relationshipLabel !== "neutral") {
    const initialScore = scoreForDeclaredConnection(kb.declaredConnection, kb.declaredConnectionNotes);
    if (initialScore !== 0) {
      kb = {
        ...kb,
        relationshipScore: initialScore,
        relationshipLabel: relationshipLabelForScore(initialScore),
      };
      await updateNpcKnowledgebase(db, kb.id, {
        relationshipScore: kb.relationshipScore,
        relationshipLabel: kb.relationshipLabel,
      });
    }
  }

  if (!kb.isAvailable) {
    const playerMsg = input.appendPlayerMessage === false ? null : await appendMessage(db, sessionId, playerCharacterId, true, playerMessageBody);
    await touchSession(db, sessionId);
    return {
      playerMessage: playerMsg === null ? { id: "", sessionId, sequence: -1, speakerCharacterId: playerCharacterId, isPlayerMessage: true, body: playerMessageBody } : toMsgShape(playerMsg),
      npcReply: null,
      unavailableReason: `${kb.canonicalName} is not reachable right now.`,
    };
  }

  // Resolve shared knowledge pools for this NPC and fetch existing entries
  const pools = computeNpcPools(npcCharacterId, kb, worldCharacters);
  const sharedEntries = await listPoolEntries(db, gameId, pools);

  const recentMessages = await listSessionMessages(db, sessionId, 20);
  const systemPrompt = buildDialogueSystemPrompt(
    kb, playerCharacterName, playerCharacterId, playerKnowledgebase, channel, period, recentMessages, worldCharacters, sharedEntries,
  );
  const operation = continuityTier === "ordinary" ? "dialogue_ordinary" : "dialogue_principal";

  const adapter = createAiAdapter();
  const result = await callWithCoinGate(
    db, userId, gameId, operation, adapter,
    { system: systemPrompt, user: playerMessageBody },
  );

  const npcBody = result.content.trim();
  const playerMsg = input.appendPlayerMessage === false ? null : await appendMessage(db, sessionId, playerCharacterId, true, playerMessageBody);
  const npcMsg = await appendMessage(db, sessionId, npcCharacterId, false, npcBody);
  await touchSession(db, sessionId);

  // Detect consequences and update per-player knowledgebase
  const newConsequences = detectConsequences(npcBody, playerMessageBody, npcCharacterId, playerCharacterId, currentStep);
  const updatedMemory = buildUpdatedMemory(kb.conversationMemory, playerMessageBody, npcBody, currentStep);
  const relevancyDelta = 5 + (newConsequences.length > 0 ? 10 : 0) + (kb.relationshipScore < 0 ? 15 : 0);

  await updateNpcKnowledgebase(db, kb.id, {
    conversationMemory: updatedMemory,
    consequences: [...kb.consequences, ...newConsequences],
  });
  await recordInteraction(db, kb.id, relevancyDelta);
  const commitment = extractDialogueCommitment(npcBody, playerMessageBody);
  if (commitment) await createNpcCommitment(db, {
    gameId, sessionId, npcMessageId: npcMsg.id, playerCharacterId, npcCharacterId, createdAtStep: currentStep, ...commitment,
  });

  // Keep the request connection alive until extraction has completed. A
  // propagation failure must not discard an otherwise valid dialogue reply.
  try {
    await extractAndPropagateKnowledge(
      db, userId, gameId, npcCharacterId, sessionId,
      npcBody, playerMessageBody, sharedEntries, pools, currentStep, kb.id, kb.relationshipScore,
    );
  } catch (error) {
    console.warn("[extract_knowledge] failed to persist propagated knowledge:", error);
  }

  return {
    playerMessage: playerMsg === null ? { id: "", sessionId, sequence: -1, speakerCharacterId: playerCharacterId, isPlayerMessage: true, body: playerMessageBody } : toMsgShape(playerMsg),
    npcReply: toMsgShape(npcMsg),
    unavailableReason: null,
  };
}

function buildUpdatedMemory(
  existing: ConversationMemoryEntry[],
  playerBody: string,
  npcBody: string,
  step: number,
): ConversationMemoryEntry[] {
  const summary = `${playerBody.slice(0, 80)}… → ${npcBody.slice(0, 100)}…`;
  const salience: ConversationMemoryEntry["salience"] =
    CONSEQUENCE_PATTERNS.some(({ pattern }) => pattern.test(`${playerBody}\n${npcBody}`)) ? "high" : "low";

  const entry: ConversationMemoryEntry = { exchange: summary, stepOccurred: step, salience };
  const updated = [...existing, entry];
  // Keep the last 20 entries, always keeping high-salience ones
  if (updated.length <= 20) return updated;
  const high = updated.filter((e) => e.salience === "high");
  const low = updated.filter((e) => e.salience !== "high").slice(-Math.max(0, 20 - high.length));
  return [...high, ...low].sort((a, b) => a.stepOccurred - b.stepOccurred);
}

function toMsgShape(row: MessageRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    speakerCharacterId: row.speakerCharacterId,
    isPlayerMessage: row.isPlayerMessage,
    body: row.body,
  };
}

// ── Contact discovery (add new contact with guardrails) ─────────────────────

interface DiscoverContactInput {
  db: ChronicaDatabase;
  userId: string;
  gameId: string;
  playerId: string;
  playerCharacterId: string;
  playerCharacterName: string;
  playerLocationProvinceId: string | null;
  playerRoleLabel: string;
  period: string;
  query: string;
  characterId?: string;
}

interface DiscoverContactOutput {
  status: "found" | "choice" | "unavailable";
  sessionId?: string;
  knownName?: string;
  explanation?: string;
  candidates?: { characterId: string; name: string; roleLabel: string }[];
}

const normalizeContactQuery = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function discoverContact(input: DiscoverContactInput): Promise<DiscoverContactOutput> {
  const {
    db, userId, gameId, playerId, playerCharacterId, playerCharacterName,
    playerLocationProvinceId, playerRoleLabel, period, query, characterId,
  } = input;

  const worldView = await getWorldView(db, gameId);
  if (!worldView) return { status: "unavailable", explanation: "This world is unavailable." };
  const registered = await listGameNpcRecords(db, gameId);
  const candidates = [
    ...worldView.world.characters.map((character) => ({ character, roleLabel: character.officeId ?? "contact" })),
    ...registered.map((record) => ({ character: record.character, roleLabel: record.roleLabel })),
  ];
  const unique = [...new Map(candidates.map((candidate) => [candidate.character.id, candidate])).values()];
  if (characterId) {
    const selected = unique.find((candidate) => candidate.character.id === characterId && candidate.character.alive);
    if (!selected) return { status: "unavailable", explanation: "That contact is no longer available." };
    const session = await findOrOpenSession(db, gameId, playerId, selected.character.id);
    return { status: "found", sessionId: session.id, knownName: selected.character.name };
  }
  const normalized = normalizeContactQuery(query);
  const matches = unique.filter((candidate) => candidate.character.alive && (
    normalizeContactQuery(candidate.character.name).includes(normalized)
    || normalized.includes(normalizeContactQuery(candidate.character.name))
    || normalizeContactQuery(candidate.roleLabel).includes(normalized)
    || normalized.includes(normalizeContactQuery(candidate.roleLabel))
  ));
  if (matches.length === 1) {
    const match = matches[0]!;
    const session = await findOrOpenSession(db, gameId, playerId, match.character.id);
    return { status: "found", sessionId: session.id, knownName: match.character.name };
  }
  if (matches.length > 1) return { status: "choice", candidates: matches.slice(0, 8).map((match) => ({ characterId: match.character.id, name: match.character.name, roleLabel: match.roleLabel })) };

  const existingKbs = await listNpcKnowledgebases(db, gameId, playerId);
  const existingContactNames = existingKbs.map((kb) => kb.canonicalName);
  const playerLocation = playerLocationProvinceId ?? "unknown location";
  const systemPrompt = buildGuardrailsSystemPrompt(period, playerCharacterName, playerLocation, playerRoleLabel, existingContactNames);

  const adapter = createAiAdapter();
  const result = await callWithCoinGate(
    db, userId, gameId, "resolve_contact", adapter,
    { system: systemPrompt, user: query },
    (content) => {
      try {
        const parsed: unknown = JSON.parse(content);
        return typeof parsed === "object" && parsed !== null && "valid" in parsed;
      } catch {
        return false;
      }
    },
  );

  let parsed: {
    valid: boolean;
    characterId: string | null;
    isNewCharacter: boolean;
    name: string;
    roleLabel: string;
    locationProvinceId: string | null;
    personalitySummary: string;
    rejectionReason: string | null;
  };
  try {
    parsed = JSON.parse(result.content) as typeof parsed;
  } catch {
    return { status: "unavailable", explanation: "Could not determine if this person exists. Try a different description." };
  }

  if (!parsed.valid) {
    return {
      status: "unavailable",
      explanation: parsed.rejectionReason ?? "No such person exists in this world.",
    };
  }

  // Check if this matches an existing contact
  if (parsed.characterId !== null) {
    const existing = unique.find((candidate) => candidate.character.id === parsed.characterId && candidate.character.alive);
    if (existing === undefined) return { status: "unavailable", explanation: "That person is not recorded in this world." };
    const existingSession = await findOrOpenSession(db, gameId, playerId, existing.character.id);
    return { status: "found", sessionId: existingSession.id, knownName: existing.character.name };
  }

  // New character — generate an ID and seed their knowledgebase
  const npcCharacterId = `npc:discovered:${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const province = worldView.world.map.provinces.find((p) => p.id === parsed.locationProvinceId)
    ?? worldView.world.map.provinces.find((p) => p.id === playerLocationProvinceId)
    ?? worldView.world.map.provinces[0];
  if (!province) return { status: "unavailable", explanation: "No valid location is available for that contact." };
  const character: Character = {
    id: npcCharacterId, name: parsed.name, cultureId: "local", faithId: null, dynastyId: null,
    locationProvinceId: province.id, polityId: province.controllerPolityId, ageYearsAtStart: 35, officeId: null,
    personalAccountId: `${npcCharacterId}:abstract`, skills: { martial: 35, intrigue: 35, learning: 35, piety: 35, stewardship: 35, diplomacy: 35, body: 50, subSkills: {} },
    traits: [], healthBps: 8_000, prestigeBps: 3_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null,
  };
  await insertGameNpcRecord(db, gameId, character, parsed.roleLabel);
  const newKb = await getOrCreateNpcKnowledgebase(db, gameId, playerId, npcCharacterId, {
    canonicalName: parsed.name,
    personalitySummary: parsed.personalitySummary,
    role: parsed.roleLabel,
    locationProvinceId: parsed.locationProvinceId,
    relationshipLabel: "neutral",
  });
  const session = await findOrOpenSession(db, gameId, playerId, npcCharacterId, "correspondence");

  if (newKb.biography === null) {
    const profile = await enrichNpcProfileViaAi(userId, gameId, {
      npcName: parsed.name,
      declaredConnection: parsed.roleLabel,
      connectionNotes: parsed.personalitySummary,
      period,
      playerCulture: "local",
    });
    if (profile !== null) await updateNpcKnowledgebase(db, newKb.id, profile);
  }

  return { status: "found", sessionId: session.id, knownName: parsed.name };
}

export async function createDialogueGroup(db: ChronicaDatabase, gameId: string, playerId: string, participantIds: string[]) {
  const ids = [...new Set(participantIds)];
  if (ids.length < 2) throw new Error("Choose at least two contacts.");
  const sessions = await listSessions(db, gameId, playerId);
  const eligible = new Set(sessions.filter((session) => !session.isGroup && session.npcCharacterId !== null).map((session) => session.npcCharacterId!));
  if (!ids.every((id) => eligible.has(id))) throw new Error("Group participants must be existing contacts.");
  return createGroupSession(db, gameId, playerId, ids);
}

// ── Request context resolution (used by API routes) ─────────────────────────

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (value === undefined || value === "") throw new Error("DATABASE_URL is required.");
  return value;
}

export interface DialogueContext {
  db: ChronicaDatabase;
  close: () => Promise<void>;
  userId: string;
  playerId: string;
  characterId: string;
  characterName: string;
  playerKnowledgebase: CharacterKnowledgebase | null;
  locationProvinceId: string | null;
  roleLabel: string;
  period: string;
  currentStep: number;
  continuityTier: "ordinary" | "remembered" | "principal";
  worldCharacters: readonly WorldCharacterRef[];
}

export async function resolveDialogueContext(gameId: string): Promise<DialogueContext | null> {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  if (userId === undefined) return null;

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [player] = await db
      .select({ id: schema.players.id, characterId: schema.players.characterId })
      .from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
      .limit(1);
    if (player === undefined) { await close(); return null; }

    const [worldView, playerKnowledgebase, registeredNpcs] = await Promise.all([
      getWorldView(db, gameId),
      getCharacterKnowledgebase(db, gameId, player.id),
      listGameNpcRecords(db, gameId),
    ]);
    if (worldView === undefined) { await close(); return null; }

    const world = worldView.world;
    const characterId = player.characterId ?? world.characters[0]?.id ?? "";
    const character = world.characters.find((c) => c.id === characterId);
    const continuity = world.continuity.find((c) => c.characterId === characterId);
    const period = worldView.scenarioClock?.stepLabel ?? "antiquity";

    const locationProvinceId = character?.locationProvinceId ?? null;
    const officeId = character?.officeId ?? null;
    const characterName = character?.name ?? characterId;
    const roleLabel = officeId ?? "notable figure";
    const tier = (continuity?.tier ?? "ordinary") as "ordinary" | "remembered" | "principal";
    const currentStep = world.elapsedStep ?? 0;

    const allCharacters = [...world.characters, ...registeredNpcs.map((record) => record.character)];
    const worldCharacters: WorldCharacterRef[] = allCharacters.map((c) => ({
      id: c.id,
      name: c.name,
      dynastyId: c.dynastyId,
      polityId: c.polityId,
      officeId: c.officeId,
      locationProvinceId: c.locationProvinceId,
      alive: c.alive,
    }));

    return { db, close, userId, playerId: player.id, characterId, characterName, playerKnowledgebase, locationProvinceId, roleLabel, period, currentStep, continuityTier: tier, worldCharacters };
  } catch (error) {
    await close();
    throw error;
  }
}

// ── Contact list projection ─────────────────────────────────────────────────

export async function getContactsView(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<{ sessionId: string; npcCharacterId: string; knownName: string; roleLabel: string; channel: string; unread: number; isGroup: boolean }[]> {
  const [sessions, kbs] = await Promise.all([
    listSessions(db, gameId, playerId),
    listNpcKnowledgebases(db, gameId, playerId),
  ]);
  const kbByNpc = new Map(kbs.map((kb) => [kb.npcCharacterId, kb]));

  return sessions.map((s) => {
    const npcId = s.npcCharacterId ?? "";
    const kb = kbByNpc.get(npcId);
    return {
      sessionId: s.id,
      npcCharacterId: npcId,
      knownName: kb?.canonicalName ?? npcId,
      roleLabel: kb?.relationshipLabel ?? "contact",
      channel: s.channel,
      unread: 0,
      isGroup: s.isGroup,
    };
  });
}
