import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Character, ConversationConsequence, ConversationMemoryEntry, NpcChatKnowledgebase } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { dialogueMessages, dialogueSessions, gameNpcRecords, npcChatKnowledgebases } from "../schema/dialogue";

// ── Session management ──────────────────────────────────────────────────────

export interface SessionRow {
  readonly id: string;
  readonly gameId: string;
  readonly playerId: string;
  readonly npcCharacterId: string | null;
  readonly isGroup: boolean;
  readonly participantIds: string[];
  readonly channel: string;
  readonly isClosed: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Returns the existing 1:1 session or creates one. */
export async function findOrOpenSession(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
  npcCharacterId: string,
  channel = "correspondence",
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(dialogueSessions)
      .where(
        and(
          eq(dialogueSessions.gameId, gameId),
          eq(dialogueSessions.playerId, playerId),
          eq(dialogueSessions.npcCharacterId, npcCharacterId),
        ),
      )
      .limit(1);
    if (existing !== undefined) return existing as SessionRow;

    const [created] = await tx
      .insert(dialogueSessions)
      .values({ gameId, playerId, npcCharacterId, channel, isGroup: false, participantIds: [] })
      .returning();
    if (created === undefined) throw new Error("Failed to create dialogue session.");
    return created as SessionRow;
  });
}

/** Creates a group chat session with multiple NPC participants. */
export async function createGroupSession(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
  participantIds: string[],
  channel = "in_person_private",
): Promise<SessionRow> {
  const [created] = await db
    .insert(dialogueSessions)
    .values({ gameId, playerId, npcCharacterId: null, isGroup: true, participantIds, channel })
    .returning();
  if (created === undefined) throw new Error("Failed to create group session.");
  return created as SessionRow;
}

/** All active sessions for a player in a game, newest first. */
export async function listSessions(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<readonly SessionRow[]> {
  const rows = await db
    .select()
    .from(dialogueSessions)
    .where(and(eq(dialogueSessions.gameId, gameId), eq(dialogueSessions.playerId, playerId), eq(dialogueSessions.isClosed, false)))
    .orderBy(desc(dialogueSessions.updatedAt));
  return rows as SessionRow[];
}

export async function getSession(
  db: ChronicaDatabase,
  sessionId: string,
  playerId: string,
): Promise<SessionRow | undefined> {
  const [row] = await db
    .select()
    .from(dialogueSessions)
    .where(and(eq(dialogueSessions.id, sessionId), eq(dialogueSessions.playerId, playerId)))
    .limit(1);
  return row as SessionRow | undefined;
}

/** Bumps `updatedAt` on a session so it sorts to the top of the contact list. */
export async function touchSession(db: ChronicaDatabase, sessionId: string): Promise<void> {
  await db
    .update(dialogueSessions)
    .set({ updatedAt: new Date() })
    .where(eq(dialogueSessions.id, sessionId));
}

// ── Messages ────────────────────────────────────────────────────────────────

export interface MessageRow {
  readonly id: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly speakerCharacterId: string;
  readonly isPlayerMessage: boolean;
  readonly body: string;
  readonly createdAt: Date;
}

/** Appends a message and returns it. Sequence is auto-incremented within the session. */
export async function appendMessage(
  db: ChronicaDatabase,
  sessionId: string,
  speakerCharacterId: string,
  isPlayerMessage: boolean,
  body: string,
): Promise<MessageRow> {
  return db.transaction(async (tx) => {
    const seqResult = await tx
      .select({ nextSeq: sql<number>`COALESCE(MAX(sequence), -1) + 1` })
      .from(dialogueMessages)
      .where(eq(dialogueMessages.sessionId, sessionId));
    const nextSeq = seqResult[0]?.nextSeq ?? 0;

    const [row] = await tx
      .insert(dialogueMessages)
      .values({ sessionId, sequence: nextSeq, speakerCharacterId, isPlayerMessage, body })
      .returning();
    if (row === undefined) throw new Error("Failed to append message.");
    return row as MessageRow;
  });
}

/** Messages for a session in sequence order, limited to the most recent `limit`. */
export async function listSessionMessages(
  db: ChronicaDatabase,
  sessionId: string,
  limit = 100,
): Promise<readonly MessageRow[]> {
  const rows = await db
    .select()
    .from(dialogueMessages)
    .where(eq(dialogueMessages.sessionId, sessionId))
    .orderBy(dialogueMessages.sequence)
    .limit(limit);
  return rows as MessageRow[];
}

// ── NPC knowledgebase ───────────────────────────────────────────────────────

export interface KnowledgebaseRow {
  readonly id: string;
  readonly gameId: string;
  readonly playerId: string;
  readonly npcCharacterId: string;
  readonly canonicalName: string;
  readonly personalitySummary: string;
  readonly relationshipLabel: string;
  readonly declaredConnection: string;
  readonly declaredConnectionNotes: string;
  readonly relationshipScore: number;
  readonly conversationMemory: ConversationMemoryEntry[];
  readonly significantEvents: string[];
  readonly consequences: ConversationConsequence[];
  readonly relevancyScore: number;
  readonly interactionCount: number;
  readonly locationProvinceId: string | null;
  readonly isAvailable: boolean;
}

export async function getOrCreateNpcKnowledgebase(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
  npcCharacterId: string,
  seed?: {
    canonicalName: string;
    personalitySummary?: string;
    locationProvinceId?: string | null;
    relationshipLabel?: string;
    declaredConnection?: string;
    declaredConnectionNotes?: string;
  },
): Promise<KnowledgebaseRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(npcChatKnowledgebases)
      .where(
        and(
          eq(npcChatKnowledgebases.gameId, gameId),
          eq(npcChatKnowledgebases.playerId, playerId),
          eq(npcChatKnowledgebases.npcCharacterId, npcCharacterId),
        ),
      )
      .limit(1);
    if (existing !== undefined) return existing as KnowledgebaseRow;

    const canonicalName = seed?.canonicalName ?? npcCharacterId;
    const [created] = await tx
      .insert(npcChatKnowledgebases)
      .values({
        gameId,
        playerId,
        npcCharacterId,
        canonicalName,
        personalitySummary: seed?.personalitySummary ?? "",
        locationProvinceId: seed?.locationProvinceId ?? null,
        relationshipLabel: seed?.relationshipLabel ?? "neutral",
        declaredConnection: seed?.declaredConnection ?? "contact",
        declaredConnectionNotes: seed?.declaredConnectionNotes ?? "",
      })
      .returning();
    if (created === undefined) throw new Error("Failed to create NPC knowledgebase.");
    return created as KnowledgebaseRow;
  });
}

export async function updateNpcKnowledgebase(
  db: ChronicaDatabase,
  id: string,
  patch: {
    personalitySummary?: string;
    relationshipLabel?: string;
    declaredConnection?: string;
    declaredConnectionNotes?: string;
    relationshipScore?: number;
    conversationMemory?: ConversationMemoryEntry[];
    significantEvents?: string[];
    consequences?: ConversationConsequence[];
    relevancyScore?: number;
    interactionCount?: number;
    locationProvinceId?: string | null;
    isAvailable?: boolean;
  },
): Promise<void> {
  await db
    .update(npcChatKnowledgebases)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(npcChatKnowledgebases.id, id));
}

export async function getNpcKnowledgebase(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
  npcCharacterId: string,
): Promise<KnowledgebaseRow | undefined> {
  const [row] = await db
    .select()
    .from(npcChatKnowledgebases)
    .where(
      and(
        eq(npcChatKnowledgebases.gameId, gameId),
        eq(npcChatKnowledgebases.playerId, playerId),
        eq(npcChatKnowledgebases.npcCharacterId, npcCharacterId),
      ),
    )
    .limit(1);
  return row as KnowledgebaseRow | undefined;
}

export async function listNpcKnowledgebases(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<readonly KnowledgebaseRow[]> {
  const rows = await db
    .select()
    .from(npcChatKnowledgebases)
    .where(and(eq(npcChatKnowledgebases.gameId, gameId), eq(npcChatKnowledgebases.playerId, playerId)))
    .orderBy(desc(npcChatKnowledgebases.relevancyScore), desc(npcChatKnowledgebases.interactionCount));
  return rows as KnowledgebaseRow[];
}

export function toNpcChatKnowledgebase(row: KnowledgebaseRow): NpcChatKnowledgebase {
  return {
    id: row.id,
    gameId: row.gameId,
    playerId: row.playerId,
    npcCharacterId: row.npcCharacterId,
    canonicalName: row.canonicalName,
    personalitySummary: row.personalitySummary,
    relationshipLabel: row.relationshipLabel as NpcChatKnowledgebase["relationshipLabel"],
    declaredConnection: row.declaredConnection,
    declaredConnectionNotes: row.declaredConnectionNotes,
    relationshipScore: row.relationshipScore,
    conversationMemory: row.conversationMemory,
    significantEvents: row.significantEvents,
    consequences: row.consequences,
    relevancyScore: row.relevancyScore,
    interactionCount: row.interactionCount,
    locationProvinceId: row.locationProvinceId,
    isAvailable: row.isAvailable,
  };
}

export interface GameNpcRecordRow { readonly characterId: string; readonly character: Character; readonly roleLabel: string; }

export async function listGameNpcRecords(db: ChronicaDatabase, gameId: string): Promise<readonly GameNpcRecordRow[]> {
  return (await db.select({ characterId: gameNpcRecords.characterId, character: gameNpcRecords.character, roleLabel: gameNpcRecords.roleLabel })
    .from(gameNpcRecords).where(eq(gameNpcRecords.gameId, gameId))) as GameNpcRecordRow[];
}

export async function insertGameNpcRecord(db: ChronicaDatabase, gameId: string, character: Character, roleLabel: string): Promise<void> {
  await db.insert(gameNpcRecords).values({ gameId, characterId: character.id, character, roleLabel });
}

/** Increments interactionCount and updates relevancyScore by delta. */
export async function recordInteraction(
  db: ChronicaDatabase,
  id: string,
  relevancyDelta: number,
): Promise<void> {
  await db
    .update(npcChatKnowledgebases)
    .set({
      interactionCount: sql`interaction_count + 1`,
      relevancyScore: sql`relevancy_score + ${relevancyDelta}`,
      updatedAt: new Date(),
    })
    .where(eq(npcChatKnowledgebases.id, id));
}
