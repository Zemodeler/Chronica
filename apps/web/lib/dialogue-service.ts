import "server-only";

import { createAiAdapter, callWithCoinGate, InsufficientCoinsError } from "@chronica/ai";
import {
  appendMessage,
  createDatabase,
  findOrOpenSession,
  getOrCreateNpcKnowledgebase,
  getNpcKnowledgebase,
  getWorldView,
  insertSharedEntry,
  listNpcKnowledgebases,
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
import type { ConversationConsequence, ConversationMemoryEntry, NpcChatKnowledgebase } from "@chronica/shared";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ChronicaDatabase } from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { headers } from "next/headers";

export { InsufficientCoinsError };

// ── Prompt building ─────────────────────────────────────────────────────────

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

// ── Shared knowledgebase pool computation ────────────────────────────────────

interface PoolSpec {
  readonly poolType: "polity" | "province" | "dynasty";
  readonly poolKey: string;
}

function computeNpcPools(
  npcCharacterId: string,
  kb: KnowledgebaseRow,
  worldCharacters: readonly WorldCharacterRef[],
): PoolSpec[] {
  const specs: PoolSpec[] = [];
  const wc = worldCharacters.find((c) => c.id === npcCharacterId);
  if (wc?.polityId) specs.push({ poolType: "polity", poolKey: wc.polityId });
  if (wc?.dynastyId) specs.push({ poolType: "dynasty", poolKey: wc.dynastyId });
  const provinceId = wc?.locationProvinceId ?? kb.locationProvinceId;
  if (provinceId) specs.push({ poolType: "province", poolKey: provinceId });
  return specs;
}

function buildSharedKnowledgeSection(entries: readonly SharedEntryRow[]): string {
  const current = entries.filter((e) => !e.isContradicted);
  const conflicting = entries.filter((e) => e.isContradicted);
  if (current.length === 0 && conflicting.length === 0) return "";
  let section = "";
  if (current.length > 0)
    section += `\n\nThings your network knows:\n${current.map((e) => `- ${e.body}`).join("\n")}`;
  if (conflicting.length > 0)
    section += `\n\nConflicting reports you have heard (accuracy uncertain):\n${conflicting.map((e) => `- ${e.body}`).join("\n")}`;
  return section;
}

function buildKnownCharactersSection(
  npcCharacterId: string,
  playerCharacterId: string,
  worldCharacters: readonly WorldCharacterRef[],
): string {
  const npc = worldCharacters.find((c) => c.id === npcCharacterId);
  if (npc === undefined) return "";

  const relevant = worldCharacters.filter((c) => {
    if (!c.alive) return false;
    if (c.id === npcCharacterId) return false;
    if (c.id === playerCharacterId) return false;
    if (npc.dynastyId !== null && c.dynastyId === npc.dynastyId) return true;
    return false;
  });

  if (relevant.length === 0) return "";
  return `\n\nOther people you personally know:\n${relevant.map((c) => `- ${c.name}`).join("\n")}`;
}

function buildDialogueSystemPrompt(
  kb: KnowledgebaseRow,
  playerCharacterName: string,
  playerCharacterId: string,
  channel: string,
  period: string,
  recentMessages: readonly MessageRow[],
  worldCharacters: readonly WorldCharacterRef[],
  sharedEntries: readonly SharedEntryRow[],
): string {
  const channelCtx = CHANNEL_LABELS[channel] ?? "by correspondence";
  const memory = kb.conversationMemory.slice(-6);
  const memorySection = memory.length > 0
    ? `\n\nPast conversation notes:\n${memory.map((m) => `- ${m.exchange}`).join("\n")}`
    : "";
  const relationship = `Your relationship with ${playerCharacterName}: ${kb.relationshipLabel} (score ${kb.relationshipScore > 0 ? "+" : ""}${kb.relationshipScore}/100).`;
  const events = kb.significantEvents.length > 0
    ? `\n\nSignificant events you know of:\n${kb.significantEvents.map((e) => `- ${e}`).join("\n")}`
    : "";

  const recentCtx = recentMessages.length > 0
    ? `\n\nRecent messages in this conversation:\n${recentMessages.slice(-10).map(
        (m) => `${m.isPlayerMessage ? playerCharacterName : kb.canonicalName}: ${m.body}`,
      ).join("\n")}`
    : "";

  const knownCharacters = buildKnownCharactersSection(kb.npcCharacterId, playerCharacterId, worldCharacters);
  const networkKnowledge = buildSharedKnowledgeSection(sharedEntries);

  return `You are ${kb.canonicalName}, speaking ${channelCtx} with ${playerCharacterName} in ${period}.

${kb.personalitySummary || `You are a person of the time, with your own interests, loyalties, and knowledge.`}

${relationship}${events}${networkKnowledge}${memorySection}${knownCharacters}${recentCtx}

Rules you must follow without exception:
- Always stay fully in character. Never refer to yourself as an AI or acknowledge this is a game.
- Speak in the register and style appropriate to your role, culture, and the period (${period}).
- Your replies should reflect your personality, relationship, and interests — allies are warm, rivals are guarded, neutral contacts are professional.
- If the player asks you to do something that contradicts your interests, you may refuse, negotiate, or comply reluctantly.
- Keep replies to 1–4 paragraphs. Do not repeat what was just said back at the player.
- Do not use modern idioms, anachronisms, or fourth-wall references.
- Respond only as ${kb.canonicalName}.`;
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

Respond ONLY with JSON matching this schema:
{ "entries": [ { "body": "...", "contradicts": ["entry-id", ...] } ] }
Return { "entries": [] } if the reply contains nothing worth recording.`;

interface ExtractedKnowledgeEntry {
  body: string;
  contradicts: string[];
}

async function extractAndPropagateKnowledge(
  db: ChronicaDatabase,
  userId: string,
  gameId: string,
  npcCharacterId: string,
  sessionId: string,
  npcReply: string,
  existingEntries: readonly SharedEntryRow[],
  pools: readonly PoolSpec[],
  stepOccurred: number,
): Promise<void> {
  if (pools.length === 0 || npcReply.length < 40) return;

  const entriesContext = existingEntries.length > 0
    ? `\n\nExisting pool entries (check for contradictions):\n${existingEntries.map((e) => `[${e.id}] ${e.body}`).join("\n")}`
    : "";

  const adapter = createAiAdapter();
  let result: Awaited<ReturnType<typeof callWithCoinGate>>;
  try {
    result = await callWithCoinGate(
      db, userId, gameId, "extract_knowledge", adapter,
      { system: EXTRACT_KNOWLEDGE_SYSTEM, user: `NPC reply: ${npcReply}${entriesContext}` },
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

  let parsed: { entries: ExtractedKnowledgeEntry[] };
  try {
    parsed = JSON.parse(result.content) as typeof parsed;
  } catch {
    return;
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

// ── Main dialogue call ──────────────────────────────────────────────────────

interface DialogueCallInput {
  db: ChronicaDatabase;
  userId: string;
  gameId: string;
  playerId: string;
  playerCharacterId: string;
  playerCharacterName: string;
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

export async function generateDialogueReply(input: DialogueCallInput): Promise<DialogueCallResult> {
  const {
    db, userId, gameId, playerId, playerCharacterId, playerCharacterName,
    npcCharacterId, sessionId, channel, playerMessageBody, period, currentStep, continuityTier,
    worldCharacters,
  } = input;

  const kb = await getOrCreateNpcKnowledgebase(db, gameId, playerId, npcCharacterId);

  if (!kb.isAvailable) {
    const playerMsg = await appendMessage(db, sessionId, playerCharacterId, true, playerMessageBody);
    await touchSession(db, sessionId);
    return {
      playerMessage: toMsgShape(playerMsg),
      npcReply: null,
      unavailableReason: `${kb.canonicalName} is not reachable right now.`,
    };
  }

  // Resolve shared knowledge pools for this NPC and fetch existing entries
  const pools = computeNpcPools(npcCharacterId, kb, worldCharacters);
  const sharedEntries = await listPoolEntries(db, gameId, pools);

  const recentMessages = await listSessionMessages(db, sessionId, 20);
  const systemPrompt = buildDialogueSystemPrompt(
    kb, playerCharacterName, playerCharacterId, channel, period, recentMessages, worldCharacters, sharedEntries,
  );
  const operation = continuityTier === "ordinary" ? "dialogue_ordinary" : "dialogue_principal";

  const adapter = createAiAdapter();
  const result = await callWithCoinGate(
    db, userId, gameId, operation, adapter,
    { system: systemPrompt, user: playerMessageBody },
  );

  const npcBody = result.content.trim();
  const playerMsg = await appendMessage(db, sessionId, playerCharacterId, true, playerMessageBody);
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

  // Extract and propagate shared knowledge in the background — does not block the response
  void extractAndPropagateKnowledge(
    db, userId, gameId, npcCharacterId, sessionId,
    npcBody, sharedEntries, pools, currentStep,
  );

  return {
    playerMessage: toMsgShape(playerMsg),
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
}

interface DiscoverContactOutput {
  status: "found" | "unavailable";
  sessionId?: string;
  knownName?: string;
  explanation?: string;
}

export async function discoverContact(input: DiscoverContactInput): Promise<DiscoverContactOutput> {
  const {
    db, userId, gameId, playerId, playerCharacterId, playerCharacterName,
    playerLocationProvinceId, playerRoleLabel, period, query,
  } = input;

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
    const existingSession = await findOrOpenSession(db, gameId, playerId, parsed.characterId);
    return { status: "found", sessionId: existingSession.id, knownName: parsed.name };
  }

  // New character — generate an ID and seed their knowledgebase
  const npcCharacterId = `npc:discovered:${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await getOrCreateNpcKnowledgebase(db, gameId, playerId, npcCharacterId, {
    canonicalName: parsed.name,
    personalitySummary: parsed.personalitySummary,
    locationProvinceId: parsed.locationProvinceId,
    relationshipLabel: "neutral",
  });
  const session = await findOrOpenSession(db, gameId, playerId, npcCharacterId, "correspondence");

  return { status: "found", sessionId: session.id, knownName: parsed.name };
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

    const worldView = await getWorldView(db, gameId);
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

    const worldCharacters: WorldCharacterRef[] = world.characters.map((c) => ({
      id: c.id,
      name: c.name,
      dynastyId: c.dynastyId,
      polityId: c.polityId,
      officeId: c.officeId,
      locationProvinceId: c.locationProvinceId,
      alive: c.alive,
    }));

    return { db, close, userId, playerId: player.id, characterId, characterName, locationProvinceId, roleLabel, period, currentStep, continuityTier: tier, worldCharacters };
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
