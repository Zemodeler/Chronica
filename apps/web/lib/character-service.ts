import "server-only";

import { createAiAdapter, callWithCoinGate, InsufficientCoinsError } from "@chronica/ai";
import {
  createDatabase,
  getCharacterKnowledgebase,
  upsertCharacterKnowledgebase,
} from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  type CharacterKnowledgebase,
} from "@chronica/shared";
import { eq, and } from "drizzle-orm";
import { schema } from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { headers } from "next/headers";

// The fixture demo game uses a plain string ID, not a UUID, so no DB queries
// are valid against it. All service functions return early for this ID.
const DEMO_GAME_ID = "demo-game";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (value === undefined || value === "") throw new Error("DATABASE_URL is required.");
  return value;
}

export { InsufficientCoinsError };

export type CharacterDeclarationDraft = {
  confirmationDraft: string;
  canonicalName: string;
  origin: CharacterKnowledgebase["origin"];
};

export type CharacterDeclarationResult =
  | { status: "draft"; draft: CharacterDeclarationDraft }
  | { status: "confirmed" }
  | { status: "insufficient_coins" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

async function resolveUserId(): Promise<string | null> {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

async function resolvePlayerInGame(db: ReturnType<typeof createDatabase>["db"], gameId: string, userId: string): Promise<string | null> {
  const [player] = await db
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
    .limit(1);
  return player?.id ?? null;
}

async function getScenarioPeriod(db: ReturnType<typeof createDatabase>["db"], gameId: string): Promise<string> {
  const [row] = await db
    .select({ period: schema.scenarios.period })
    .from(schema.games)
    .innerJoin(schema.scenarios, eq(schema.games.scenarioId, schema.scenarios.id))
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return row?.period ?? "an unspecified historical period";
}

function buildDeclareSystemPrompt(period: string): string {
  return `You are a historical research assistant for a strategy game set in ${period}. Your task is to create or research a character for the player.

The player will describe who they want to play as. You must interpret their intent and produce a character, then ask for confirmation.

Rules:
- If the player names a real historical figure: research them from your knowledge. Use what you know about their life, role, culture, and relationships.
- If the player gives a fictional/ambiguous name or just a role description: invent a culturally authentic character appropriate to the period. If their name is not historically accurate for the period, use it as a nickname and generate an accurate canonical name.
- Be strict about historical authenticity (culture, faith, names, roles).
- Skills are on a 0–100 scale and represent innate talent plus experience. A 50 is average for the era's population. A 75+ is exceptional. Skills: martial, intrigue, learning, piety, stewardship, diplomacy, body.
- Sub-skills are more granular. Only assign sub-skills the character would realistically have.

Output ONLY a valid JSON object matching this schema (no markdown fences, no commentary):
{
  "canonicalName": "string — historically accurate name",
  "nickname": "string | null — player's name if inaccurate, else null",
  "birthYearApprox": "number | null — approximate birth year (negative = BC)",
  "deathYearApprox": "number | null — approximate death year or null if unknown",
  "origin": "historical | invented | hybrid",
  "period": "string — e.g. 'First Punic War, 264–241 BC'",
  "culture": "string — e.g. 'Roman Patrician'",
  "faith": "string | null",
  "biography": "string — 200–500 words, dense prose optimised for AI re-reads",
  "notableEvents": ["array of short strings, key life events"],
  "role": "string — current position/job, e.g. 'Consul of Rome, 264 BC'",
  "socioEconomicClass": "string — e.g. 'Senatorial aristocracy'",
  "skills": {
    "martial": 0–100,
    "intrigue": 0–100,
    "learning": 0–100,
    "piety": 0–100,
    "stewardship": 0–100,
    "diplomacy": 0–100,
    "body": 0–100,
    "subSkills": { "strategist?": 0–100, "authority?": 0–100, "espionage?": 0–100, ... }
  },
  "skillRationale": { "martial": "reason", ... },
  "relations": [
    { "name": "string", "relationship": "string", "historical": true|false, "notes": "string" }
  ],
  "confirmationDraft": "string — a readable summary shown to the player asking them to confirm. Include: who this character is, their role, a brief teaser of their situation. 150–300 words. Friendly, second-person ('You are...')."
}`;
}

function buildConfirmSystemPrompt(period: string): string {
  return `You are a historical research assistant for a strategy game set in ${period}. You previously generated a character and the player has provided additional information or corrections. Update the character accordingly and produce a new confirmation draft.

Output ONLY a valid JSON object in the same schema as before. Incorporate the player's feedback faithfully.`;
}

function parseAiKnowledgebase(
  raw: string,
  gameId: string,
  playerId: string,
): CharacterKnowledgebase | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = CharacterKnowledgebaseSchema.safeParse({
    version: 1,
    characterId: `declared-${playerId}`,
    gameId,
    confirmedByPlayer: false,
    ...(parsed as Record<string, unknown>),
  });

  return result.success ? result.data : null;
}

export async function declareCharacter(gameId: string, playerInput: string): Promise<CharacterDeclarationResult> {
  if (gameId === DEMO_GAME_ID) return { status: "error", message: "AI character creation is not available in demo mode." };
  const userId = await resolveUserId();
  if (userId === null) return { status: "unauthenticated" };

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const playerId = await resolvePlayerInGame(db, gameId, userId);
    if (playerId === null) return { status: "error", message: "You are not an active player in this game." };

    const period = await getScenarioPeriod(db, gameId);
    const adapter = createAiAdapter();

    let result;
    try {
      result = await callWithCoinGate(db, userId, gameId, "declare_character", adapter, {
        system: buildDeclareSystemPrompt(period),
        user: playerInput,
      });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) return { status: "insufficient_coins" };
      throw error;
    }

    const knowledgebase = parseAiKnowledgebase(result.content, gameId, playerId);
    if (knowledgebase === null) {
      return { status: "error", message: "The AI returned an unexpected response. Please try again." };
    }

    await upsertCharacterKnowledgebase(db, {
      gameId,
      playerId,
      characterId: `declared-${playerId}`,
      knowledgebase,
    });

    return {
      status: "draft",
      draft: {
        confirmationDraft: knowledgebase.confirmationDraft ?? `You will play as ${knowledgebase.canonicalName}.`,
        canonicalName: knowledgebase.canonicalName,
        origin: knowledgebase.origin,
      },
    };
  } finally {
    await close();
  }
}

export async function reviseDeclaredCharacter(gameId: string, revision: string): Promise<CharacterDeclarationResult> {
  if (gameId === DEMO_GAME_ID) return { status: "error", message: "AI character creation is not available in demo mode." };
  const userId = await resolveUserId();
  if (userId === null) return { status: "unauthenticated" };

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const playerId = await resolvePlayerInGame(db, gameId, userId);
    if (playerId === null) return { status: "error", message: "You are not an active player in this game." };

    const existing = await getCharacterKnowledgebase(db, gameId, playerId);
    const period = await getScenarioPeriod(db, gameId);
    const adapter = createAiAdapter();

    const context = existing
      ? `Current character draft:\n${JSON.stringify(existing, null, 2)}\n\nPlayer revision: ${revision}`
      : revision;

    let result;
    try {
      result = await callWithCoinGate(db, userId, gameId, "confirm_character", adapter, {
        system: buildConfirmSystemPrompt(period),
        user: context,
      });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) return { status: "insufficient_coins" };
      throw error;
    }

    const knowledgebase = parseAiKnowledgebase(result.content, gameId, playerId);
    if (knowledgebase === null) {
      return { status: "error", message: "The AI returned an unexpected response. Please try again." };
    }

    await upsertCharacterKnowledgebase(db, { gameId, playerId, characterId: `declared-${playerId}`, knowledgebase });

    return {
      status: "draft",
      draft: {
        confirmationDraft: knowledgebase.confirmationDraft ?? `You will play as ${knowledgebase.canonicalName}.`,
        canonicalName: knowledgebase.canonicalName,
        origin: knowledgebase.origin,
      },
    };
  } finally {
    await close();
  }
}

export async function confirmDeclaredCharacter(gameId: string): Promise<CharacterDeclarationResult> {
  if (gameId === DEMO_GAME_ID) return { status: "error", message: "AI character creation is not available in demo mode." };
  const userId = await resolveUserId();
  if (userId === null) return { status: "unauthenticated" };

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const playerId = await resolvePlayerInGame(db, gameId, userId);
    if (playerId === null) return { status: "error", message: "You are not an active player in this game." };

    const existing = await getCharacterKnowledgebase(db, gameId, playerId);
    if (existing === null) return { status: "error", message: "No character draft found. Please declare a character first." };

    const confirmed: CharacterKnowledgebase = { ...existing, confirmedByPlayer: true, confirmationDraft: null };
    await upsertCharacterKnowledgebase(db, { gameId, playerId, characterId: `declared-${playerId}`, knowledgebase: confirmed });

    // Mark the character claim as resolved in the character_claims table.
    await db
      .update(schema.characterClaims)
      .set({
        resolvedRole: { characterName: existing.canonicalName, roleLabel: existing.role },
        resolvedAt: new Date(),
      })
      .where(and(eq(schema.characterClaims.gameId, gameId), eq(schema.characterClaims.playerId, playerId)));

    return { status: "confirmed" };
  } finally {
    await close();
  }
}

export async function getCharacterPanelData(gameId: string): Promise<CharacterKnowledgebase | null> {
  if (gameId === DEMO_GAME_ID) return null;
  const userId = await resolveUserId();
  if (userId === null) return null;

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const playerId = await resolvePlayerInGame(db, gameId, userId);
    if (playerId === null) return null;
    return await getCharacterKnowledgebase(db, gameId, playerId);
  } finally {
    await close();
  }
}
