import "server-only";

import { createAiAdapter, callWithCoinGate, InsufficientCoinsError, AiParseError } from "@chronica/ai";
import {
  createDatabase,
  getCharacterKnowledgebase,
  getOrCreateNpcKnowledgebase,
  findOrOpenSession,
  upsertCharacterKnowledgebase,
} from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  WorldStateSchema,
  type CharacterKnowledgebase,
} from "@chronica/shared";
import { eq, and, isNull } from "drizzle-orm";
import { schema } from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { headers } from "next/headers";

// The fixture demo game uses a plain string ID, not a UUID, so no DB queries
// are valid against it. All service functions return early for this ID.
const DEMO_GAME_ID = "DEMO";

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

type ScenarioContext = Readonly<{
  period: string;
  timelineStartYear: number | null;
  regions: readonly { id: string; name: string }[];
}>;

function astronomicalYear(year: number, era: "BCE" | "CE" | undefined): number {
  return (era ?? "CE") === "BCE" ? 1 - year : year;
}

/** Approximate age at the scenario opening; dates use astronomical years internally. */
export function ageAtScenarioStart(birthYearApprox: number | null, timelineStartYear: number | null): number | null {
  if (birthYearApprox === null || timelineStartYear === null) return null;
  return Math.max(0, timelineStartYear - birthYearApprox);
}

async function getScenarioContext(db: ReturnType<typeof createDatabase>["db"], gameId: string): Promise<ScenarioContext> {
  const [row] = await db
    .select({ period: schema.scenarios.period, initialWorld: schema.scenarioVersions.initialWorld })
    .from(schema.games)
    .innerJoin(schema.scenarios, eq(schema.games.scenarioId, schema.scenarios.id))
    .innerJoin(schema.scenarioVersions, and(eq(schema.scenarioVersions.scenarioId, schema.games.scenarioId), eq(schema.scenarioVersions.version, schema.games.scenarioVersion)))
    .where(eq(schema.games.id, gameId))
    .limit(1);
  const world = WorldStateSchema.safeParse(row?.initialWorld);
  // The clock belongs to the definition, not to the initial state. The built-in
  // scenario period is still used as a fallback if a custom world lacks it.
  const match = /(?:^|\s)(\d{1,4})\s*BCE\b/i.exec(row?.period ?? "");
  const timelineStartYear = match === null ? null : astronomicalYear(Number(match[1]), "BCE");
  return {
    period: row?.period ?? "an unspecified historical period",
    timelineStartYear,
    regions: world.success ? world.data.map.provinces.map(({ id, name }) => ({ id, name })) : [],
  };
}

/** The opening year is intentionally supplied separately from player-facing knowledgebase data. */
export async function getScenarioTimelineStartYear(gameId: string): Promise<number | null> {
  if (gameId === DEMO_GAME_ID) return null;
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    return (await getScenarioContext(db, gameId)).timelineStartYear;
  } finally {
    await close();
  }
}

function buildDeclareSystemPrompt(context: ScenarioContext): string {
  const start = context.timelineStartYear === null ? "the scenario opening" : `${context.timelineStartYear <= 0 ? `${1 - context.timelineStartYear} BCE` : context.timelineStartYear}`;
  const regions = context.regions.length === 0 ? "No map regions are available." : context.regions.map((region) => `- ${region.id}: ${region.name}`).join("\n");
  return `You are a historical research assistant for a strategy game set in ${context.period}. The timeline begins at ${start}. Your task is to create or research a character for the player.

The player will describe who they want to play as. You must interpret their intent and produce a character, then ask for confirmation.

Rules:
- If the player names a real historical figure: use them ONLY if they were already born and alive at the scenario opening (${start}). Never select, mention as the player character, or extend a historical person born after that date. If the requested or suggested figure does not yet exist, create an invented period-appropriate character instead and set origin to "invented".
- If the player gives a fictional/ambiguous name or just a role description: invent a culturally authentic character appropriate to the period. If their name is not historically accurate for the period, use it as a nickname and generate an accurate canonical name.
- Be strict about historical authenticity (culture, faith, names, roles).
- For historical and hybrid characters, birthYearApprox and deathYearApprox must be known enough to prove that the person was alive at the scenario opening. Use negative years for BCE. For invented characters, make a plausible adult already alive at the opening.
- Choose locationProvinceId from this exact opening-map list. It must be a region where the character can plausibly be present at the opening:
${regions}
- locationProvinceId is REQUIRED at the scenario opening. Never return null or an unknown region ID.
- Skills are on a 0–100 scale and represent innate talent plus experience. A 50 is average for the era's population. A 75+ is exceptional. Skills: martial, intrigue, learning, piety, stewardship, diplomacy, body.
- Sub-skills are more granular. Only assign sub-skills the character would realistically have.
- Create exactly 4 to 8 key relations. Every relation must be an individually named human being; never include an institution, dynasty, army, navy, office, or other collective. Include at least one family member and at least one significant non-family NPC. Family relations need a familyRole; non-family relations must use null for familyRole.

Output ONLY a valid JSON object matching this schema (no markdown fences, no commentary):
{
  "canonicalName": "string — historically accurate name",
  "nickname": "string | null — player's name if inaccurate, else null",
  "birthYearApprox": "number | null — approximate birth year (negative = BC)",
  "deathYearApprox": "number | null — approximate death year or null if unknown",
  "origin": "historical | invented | hybrid",
  "period": "string — e.g. 'First Punic War, 264–241 BC'",
  "locationProvinceId": "string — required exact opening-map region id",
  "culture": "string — e.g. 'Roman Patrician'",
  "faith": "string | null",
  "biography": "string — 200–500 words, dense prose optimised for AI re-reads",
  "notableEvents": ["array of short strings, key life events"],
  "role": "string — current position/job, using the historically accurate title for the era (e.g. 'Consul of the Roman Republic, commanding the Roman field army' rather than 'General of the Roman Army' in the Republican era)",
  "authority": ["array of concrete offices, commanded forces, and controlled territories; e.g. 'Consul of the Roman Republic', 'Command of the Roman field army in Sicily'. Never use scores, ranks, or abstract influence labels."],
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
    {
      "name": "string — an individually named person, never an institution, army, office, dynasty, or group",
      "relationship": "string",
      "historical": true|false,
      "notes": "string",
      "kind": "person",
      "category": "family | other",
      "familyRole": "parent | partner | sibling | child | other_relative | null"
    }
  ],
  "confirmationDraft": "string — a readable summary shown to the player asking them to confirm. Include: who this character is, their role, a brief teaser of their situation. 150–300 words. Friendly, second-person ('You are...')."
}

CRITICAL for subSkills: only use these EXACT key names (all lowercase, no punctuation):
  Martial: strategist, authority
  Intrigue: espionage, manipulation
  Diplomacy: rhetoric, arbitration
  Stewardship: logistics, taxation
  Learning: theology, scholarship
  Piety: devotion, rites
  Body: endurance, prowess
Include only sub-skills relevant to this character. Any other key name will break validation.`;
}

function buildConfirmSystemPrompt(context: ScenarioContext): string {
  return `${buildDeclareSystemPrompt(context)}

You previously generated a character and the player has provided additional information or corrections. Update the character accordingly and produce a new confirmation draft.

Output ONLY a valid JSON object in the same schema as before. Incorporate the player's feedback faithfully.`;
}

function extractJson(raw: string): unknown | null {
  // Strip markdown code fences if the model wrapped the JSON.
  let text = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
  // Try a direct parse first.
  try { return JSON.parse(text); } catch { /* fall through */ }
  // If the model added prose before/after, extract the first top-level {...} block.
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

const FAMILY_ROLE_MAP: Record<string, string> = {
  spouse: "partner", wife: "partner", husband: "partner",
  father: "parent", mother: "parent",
  brother: "sibling", sister: "sibling",
  son: "child", daughter: "child",
  uncle: "other_relative", aunt: "other_relative",
  nephew: "other_relative", niece: "other_relative",
  cousin: "other_relative", grandfather: "other_relative",
  grandmother: "other_relative", grandson: "other_relative",
  granddaughter: "other_relative", stepfather: "other_relative",
  stepmother: "other_relative", stepbrother: "other_relative",
  stepsister: "other_relative", stepson: "other_relative",
  stepdaughter: "other_relative",
};

function normalizeFamilyRole(role: unknown): unknown {
  if (role === null || role === undefined) return null;
  if (typeof role !== "string") return role;
  const lower = role.toLowerCase().trim();
  return FAMILY_ROLE_MAP[lower] ?? role;
}

function preprocessAiRelations(relations: unknown): unknown {
  if (!Array.isArray(relations)) return relations;
  return relations.map((rel) => {
    if (rel === null || typeof rel !== "object") return rel;
    const r = rel as Record<string, unknown>;
    return { ...r, familyRole: normalizeFamilyRole(r["familyRole"]) };
  });
}

function parseAiKnowledgebase(
  raw: string,
  gameId: string,
  playerId: string,
  context: ScenarioContext,
): CharacterKnowledgebase | null {
  const parsed = extractJson(raw);
  if (parsed === null) return null;

  const base = parsed as Record<string, unknown>;
  const preprocessed = {
    ...base,
    relations: preprocessAiRelations(base["relations"]),
  };

  // Spread AI values first so our programmatic fields always win.
  const result = CharacterKnowledgebaseSchema.safeParse({
    ...preprocessed,
    version: 1,
    characterId: `declared-${playerId}`,
    gameId,
    confirmedByPlayer: false,
  });

  if (!result.success) {
    console.warn("[ai] knowledgebase schema validation failed:", result.error.flatten());
    return null;
  }

  const knowledgebase = result.data;

  if (knowledgebase.origin !== "invented") {
    // Birth year must be known and before the scenario start.
    if (knowledgebase.birthYearApprox === null) return null;
    if (context.timelineStartYear !== null && knowledgebase.birthYearApprox > context.timelineStartYear) return null;
    // If a death year is known, the character must not have died before the scenario start.
    if (context.timelineStartYear !== null && knowledgebase.deathYearApprox !== null && knowledgebase.deathYearApprox < context.timelineStartYear) return null;
  }

  if (knowledgebase.locationProvinceId === null || !context.regions.some((region) => region.id === knowledgebase.locationProvinceId)) return null;
  return knowledgebase;
}

export async function declareCharacter(gameId: string, playerInput: string): Promise<CharacterDeclarationResult> {
  if (gameId === DEMO_GAME_ID) return { status: "error", message: "AI character creation is not available in demo mode." };
  const userId = await resolveUserId();
  if (userId === null) return { status: "unauthenticated" };

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const playerId = await resolvePlayerInGame(db, gameId, userId);
    if (playerId === null) return { status: "error", message: "You are not an active player in this game." };

    const context = await getScenarioContext(db, gameId);
    const adapter = createAiAdapter();

    let result;
    try {
      result = await callWithCoinGate(
        db, userId, gameId, "declare_character", adapter,
        { system: buildDeclareSystemPrompt(context), user: playerInput },
        (content) => parseAiKnowledgebase(content, gameId, playerId, context) !== null,
      );
    } catch (error) {
      if (error instanceof InsufficientCoinsError) return { status: "insufficient_coins" };
      if (error instanceof AiParseError) return { status: "error", message: "The AI returned an unexpected response. Please try again." };
      throw error;
    }

    const knowledgebase = parseAiKnowledgebase(result.content, gameId, playerId, context);
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
    const context = await getScenarioContext(db, gameId);
    const adapter = createAiAdapter();

    const revisionContext = existing
      ? `Current character draft:\n${JSON.stringify(existing, null, 2)}\n\nPlayer revision: ${revision}`
      : revision;

    let result;
    try {
      result = await callWithCoinGate(
        db, userId, gameId, "confirm_character", adapter,
        { system: buildConfirmSystemPrompt(context), user: revisionContext },
        (content) => parseAiKnowledgebase(content, gameId, playerId, context) !== null,
      );
    } catch (error) {
      if (error instanceof InsufficientCoinsError) return { status: "insufficient_coins" };
      if (error instanceof AiParseError) return { status: "error", message: "The AI returned an unexpected response. Please try again." };
      throw error;
    }

    const knowledgebase = parseAiKnowledgebase(result.content, gameId, playerId, context);
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

    const characterId = `declared-${playerId}`;
    const resolvedRole = { characterName: existing.canonicalName, roleLabel: existing.role };
    const [claim] = await db
      .select({ id: schema.characterClaims.id })
      .from(schema.characterClaims)
      .where(and(
        eq(schema.characterClaims.gameId, gameId),
        eq(schema.characterClaims.playerId, playerId),
        isNull(schema.characterClaims.releasedAt),
      ))
      .limit(1);

    // Drafting stores the profile but does not create a claim. Confirmation
    // resolves that claim and replaces the provisional seat id, letting the
    // game page render the scenario map instead of routing back here.
    if (claim === undefined) {
      await db.insert(schema.characterClaims).values({
        gameId,
        playerId,
        characterId,
        origin: "declared",
        declaration: existing.canonicalName,
        resolvedRole,
        resolvedAt: new Date(),
      });
    } else {
      await db.update(schema.characterClaims).set({ resolvedRole, resolvedAt: new Date() }).where(eq(schema.characterClaims.id, claim.id));
    }
    await db.update(schema.players).set({ characterId }).where(and(eq(schema.players.id, playerId), eq(schema.players.gameId, gameId)));

    // Seed NPC knowledgebases for each person relation from the character declaration.
    for (const relation of existing.relations) {
      if (relation.kind !== "person") continue;
      const npcId = `declared-npc-${relation.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${playerId}`;
      const relationshipLabel = relation.category === "family" ? "neutral" : "neutral";
      await getOrCreateNpcKnowledgebase(db, gameId, playerId, npcId, {
        canonicalName: relation.name,
        personalitySummary: relation.notes ?? "",
        relationshipLabel,
      });
      await findOrOpenSession(db, gameId, playerId, npcId);
    }

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
