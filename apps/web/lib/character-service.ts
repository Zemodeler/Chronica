import "server-only";

import { createAiAdapter, callWithCoinGate, InsufficientCoinsError, AiParseError } from "@chronica/ai";
import {
  createDatabase,
  getCharacterKnowledgebase,
  getOrCreateNpcKnowledgebase,
  getWorldView,
  persistOpeningWorld,
  findOrOpenSession,
  upsertCharacterKnowledgebase,
} from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  clampWealth,
  createCanonicalNpc,
  describeWealthBands,
  linkCanonicalCharacters,
  materializePlayerCharacter,
  type CharacterKnowledgebase,
  type FamilyLinkKind,
  type ScenarioWealthRules,
  type WorldState,
} from "@chronica/shared";
import { eq, and, isNull } from "drizzle-orm";
import { schema } from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { headers } from "next/headers";
import { relationshipLabelForScore, scoreForDeclaredConnection } from "./relationship-score";
import { canvasRegions, materializeCanvasProvince, type CanvasRegion } from "./canvas-world";
import { regionMenu, resolvePlace, type PlaceResolution } from "./place-resolver";

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
  startingMoney: number;
  currencyName: string;
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
  regions: readonly CanvasRegion[];
  /** Places the model named that could not be settled on, oldest first; read only to word the error. */
  unplaced: Exclude<PlaceResolution, { status: "found" }>[];
  /** What a person of a given standing is worth here (slice 11). */
  wealth: ScenarioWealthRules | undefined;
  /** Who is already in the world: the player may become one of them, and is never handed one by accident. */
  people: readonly { id: string; label: string }[];
  currency: Readonly<{
    name: string;
    unitName: string;
    unitNamePlural: string;
    symbol: string | undefined;
  }>;
}>;

function astronomicalYear(year: number, era: "BCE" | "CE" | undefined): number {
  return (era ?? "CE") === "BCE" ? 1 - year : year;
}

/** Approximate age at the scenario opening; dates use astronomical years internally. */
export function ageAtScenarioStart(birthYearApprox: number | null, timelineStartYear: number | null): number | null {
  if (birthYearApprox === null || timelineStartYear === null) return null;
  return Math.max(0, timelineStartYear - birthYearApprox);
}

/**
 * The people already in the world, named with their office and id.
 *
 * Asked for a consul by a player who called himself Andreus Maximus, the
 * model gave him Gaius Genucius Clepsina, the consul the scenario already
 * seats: the player became a second copy of a man the world was still
 * running. Told who is here, the model can put a player who asked only for a
 * station in that man's place (`becomesCharacterId`), and keeps a player who
 * named himself from becoming anybody in it.
 */
function peopleInTheWorld(world: WorldState, offices: readonly { id: string; label: string }[]): { id: string; label: string }[] {
  const labels = new Map(offices.map((office) => [office.id, office.label]));
  return world.characters
    .filter((character) => character.alive)
    .map((character) => {
      const office = character.officeId === null ? undefined : labels.get(character.officeId) ?? character.officeId;
      return { id: character.id, label: office === undefined ? character.name : `${character.name} (${office})` };
    });
}

async function getScenarioContext(db: ReturnType<typeof createDatabase>["db"], gameId: string): Promise<ScenarioContext> {
  const [row] = await db
    .select({ period: schema.scenarios.period, initialWorld: schema.scenarioVersions.initialWorld, mapAssetId: schema.scenarioVersions.mapAssetId, definition: schema.scenarioVersions.definition })
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
  const currency = world.success
    ? {
        name: world.data.material.currency.name,
        unitName: world.data.material.currency.unitName,
        unitNamePlural: world.data.material.currency.unitNamePlural,
        symbol: world.data.material.currency.symbol,
      }
    : { name: "Money", unitName: "unit", unitNamePlural: "units", symbol: undefined };
  const definition = ScenarioDefinitionSchema.safeParse(row?.definition);
  return {
    period: row?.period ?? "an unspecified historical period",
    timelineStartYear,
    regions: world.success ? canvasRegions(row?.mapAssetId ?? null, world.data) : [],
    unplaced: [],
    wealth: definition.success ? definition.data.wealth : undefined,
    people: world.success ? peopleInTheWorld(world.data, definition.success ? definition.data.government.offices : []) : [],
    currency,
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
  const regions = regionMenu(context.regions);
  const currency = `${context.currency.name} (${context.currency.unitName}/${context.currency.unitNamePlural}${context.currency.symbol === undefined ? "" : `, symbol ${context.currency.symbol}`})`;
  return `You are a historical research assistant for a strategy game set in ${context.period}. The timeline begins at ${start}. Your task is to create or research a character for the player.

The player will describe who they want to play as. You must interpret their intent and produce a character, then ask for confirmation.

Rules:
- A station and no name — "a consul", "a Carthaginian shipowner", "a soldier on the Sicilian frontier" — is a request to be a real person: somebody who actually held that station at the opening and is attested well enough to place and date. Set origin to "historical" and say who they were in the confirmation. A real person is not automatically a famous one: a minor attested figure who fits beats a great name the player did not ask for, and an officer is not handed a consulship.
- If the person who fits is one of the people already in the world (listed below), the player becomes that person: set becomesCharacterId to their id, and canonicalName to their name. Otherwise set becomesCharacterId to null.
- A real historical figure named by the player is that figure, if they were already born and alive at the scenario opening (${start}), and becomesCharacterId is their id if they are listed below. Never select, mention as the player character, or extend a historical person born after that date; if the named figure does not yet exist, invent a period-appropriate character instead and set origin to "invented".
- A name of the player's own, that is no real person's — "Andreus Maximus", "Hanno the Younger" — is somebody new: origin "invented", canonicalName exactly as the player gave it, nickname null, becomesCharacterId null. Never swap it for a better-attested name and never turn it into a real person. Give them the station they asked for, whole: a player who asked to be consul is consul, even where history knew the year's consuls and even where that puts one of the people below out of the office.
- A player who asks to be rich — "rich", "wealthy", "a fortune" — gets startingMoney at the top of the range for their standing, not the middle. One who asks to be poor gets the bottom.
- The people already in the world, as id: name (office):
${context.people.length === 0 ? "  (none listed)" : context.people.map((person) => `  · ${person.id}: ${person.label}`).join("\n")}
  Unless the player is becoming one of them, the character is somebody else, with another name. They may be among the character's relations under the same name.
- Be strict about historical authenticity of culture, faith, family and manner of life. It never outranks the player's own name or the station they asked for.
- For historical and hybrid characters, birthYearApprox and deathYearApprox must be known enough to prove that the person was alive at the scenario opening. Use negative years for BCE. For invented characters, make a plausible adult already alive at the opening.
- Choose locationPlace: the town, city or district (by the name it bore at the opening) where the character can plausibly be present at the opening, followed by its region from this list, as "Place, Region". The map is far finer than this list; name the real place, not the region alone:
${regions}
- locationPlace is REQUIRED at the scenario opening. Never return null or a place that did not exist then.
- Skills are on a 0–100 scale and represent innate talent plus experience. A 50 is average for the era's population. A 75+ is exceptional. Skills: martial, intrigue, learning, piety, stewardship, diplomacy, body.
- Sub-skills are more granular. Only assign sub-skills the character would realistically have.
- Decide the character's startingMoney in the scenario currency: ${currency}. It must be a non-negative whole number representing liquid personal funds at the opening, appropriate to the character's role, social class, culture, period, and circumstances. Do not include a state treasury, institutional funds, land, ships, equipment, or other non-cash assets.
- What somebody of that standing is actually worth here, so a soldier is not handed a senator's fortune and a merchant is not left with nothing to trade on. Say the standing in socioEconomicClass in words that include one of these, and keep startingMoney inside the matching range:
${describeWealthBands(context.wealth).map((band) => `  · ${band}`).join("\n")}
- Create exactly 4 to 8 key relations. Every relation must be an individually named human being; never include an institution, dynasty, army, navy, office, or other collective. Include at least one family member and at least one significant non-family NPC. Family relations need a familyRole; non-family relations must use null for familyRole.

Output ONLY a valid JSON object matching this schema (no markdown fences, no commentary):
{
  "canonicalName": "string — the character's name: the player's own, exactly as given, when they gave one",
  "nickname": "string | null — a byname, if the character has one; else null",
  "birthYearApprox": "number | null — approximate birth year (negative = BC)",
  "deathYearApprox": "number | null — approximate death year or null if unknown",
  "origin": "historical | invented | hybrid",
  "becomesCharacterId": "string | null — the id of the person already in the world whom the player becomes, else null",
  "period": "string — e.g. 'First Punic War, 264–241 BC'",
  "locationPlace": "string — required, 'Place, Region' as above",
  "culture": "string — e.g. 'Roman Patrician'",
  "faith": "string | null",
  "gender": "male | female",
  "legalStatus": "free | freed | enslaved — what the law says they are",
  "biography": "string — 200–500 words, dense prose optimised for AI re-reads",
  "notableEvents": ["array of short strings, key life events"],
  "role": "string — current position/job, using the historically accurate title for the era (e.g. 'Consul of the Roman Republic, commanding the Roman field army' rather than 'General of the Roman Army' in the Republican era)",
  "authority": ["array of concrete offices, commanded forces, and controlled territories; e.g. 'Consul of the Roman Republic', 'Command of the Roman field army in Sicily'. Never use scores, ranks, or abstract influence labels."],
  "socioEconomicClass": "string — e.g. 'Senatorial aristocracy'",
  "startingMoney": 1200,
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
  "skillRationale": {
    "martial": "Direct plain-text reason for this skill score",
    "intrigue": "Direct plain-text reason for this skill score"
  },
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
  "confirmationDraft": "string — a readable summary shown to the player asking them to confirm. Include: who this character is, their role, their startingMoney with the currency name, and a brief teaser of their situation. 150–300 words. Friendly, second-person ('You are...')."
}

CRITICAL for skillRationale: it must be one JSON object whose values are DIRECT JSON STRINGS. Never nest an object, array, score, label, or "reason" field inside a skill rationale.
Correct: "skillRationale": { "martial": "Veteran field commander.", "learning": "Classically educated." }
Incorrect: "skillRationale": { "martial": { "reason": "Veteran field commander." } }

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

function extractJson(raw: string): unknown {
  // Strip markdown code fences if the model wrapped the JSON.
  const text = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
  // Try a direct parse first.
  try { return JSON.parse(text) as unknown; } catch { /* fall through */ }
  // If the model added prose before/after, extract the first top-level {...} block.
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try { return JSON.parse(match[0]) as unknown; } catch { return null; }
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
  return (relations as unknown[]).map((rel: unknown) => {
    if (rel === null || typeof rel !== "object") return rel;
    const r = rel as Record<string, unknown>;
    return { ...r, familyRole: normalizeFamilyRole(r["familyRole"]) };
  });
}

const SKILL_RATIONALE_TEXT_KEYS = ["reason", "rationale", "explanation", "description", "text"] as const;

/**
 * Models occasionally wrap an otherwise-valid rationale in a named object,
 * such as { reason: "Veteran field commander." }. The stored schema uses the
 * compact string form, so safely unwrap only known text fields. Unknown shapes
 * are deliberately preserved and rejected by schema validation.
 */
function preprocessAiSkillRationale(skillRationale: unknown): unknown {
  if (skillRationale === null || typeof skillRationale !== "object" || Array.isArray(skillRationale)) return skillRationale;

  return Object.fromEntries(Object.entries(skillRationale as Record<string, unknown>).map(([skill, rationale]) => {
    if (rationale === null || typeof rationale !== "object" || Array.isArray(rationale)) return [skill, rationale];
    const wrapped = rationale as Record<string, unknown>;
    const text = SKILL_RATIONALE_TEXT_KEYS.map((key) => wrapped[key]).find((value) => typeof value === "string");
    return [skill, text ?? rationale];
  }));
}

/**
 * The model names a place in words; a province id is only accepted when the
 * model copied one back from a draft it was shown or the place matches no
 * name at all.
 */
function resolveDeclaredPlace(base: Record<string, unknown>, context: ScenarioContext): PlaceResolution {
  const place = typeof base["locationPlace"] === "string" ? base["locationPlace"] : typeof base["locationProvinceId"] === "string" ? base["locationProvinceId"] : "";
  return place.trim() === "" ? { status: "unknown" } : resolvePlace(context.regions, place);
}

/** What to tell the player when no place could be settled on, so they can name a nearer town. */
function unplacedMessage(context: ScenarioContext): string {
  const last = context.unplaced[context.unplaced.length - 1];
  if (last?.status === "ambiguous") return `Several places on the map fit that description (${last.candidates.slice(0, 4).join("; ")}). Please say which town or region you mean.`;
  if (last?.status === "unknown") return "That place could not be found on the map. Please name a nearby town or region as it was known at the opening.";
  return "The AI returned an unexpected response. Please try again.";
}

function parseAiKnowledgebase(
  raw: string,
  gameId: string,
  playerId: string,
  context: ScenarioContext,
): CharacterKnowledgebase | null {
  context.unplaced.length = 0;
  const parsed = extractJson(raw);
  if (parsed === null) return null;

  const base = parsed as Record<string, unknown>;
  const place = resolveDeclaredPlace(base, context);
  if (place.status !== "found") {
    context.unplaced.push(place);
    return null;
  }
  const preprocessed = {
    ...base,
    locationProvinceId: place.provinceId,
    relations: preprocessAiRelations(base["relations"]),
    skillRationale: preprocessAiSkillRationale(base["skillRationale"]),
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

  // How old they are on the opening day, worked out once here, so every later
  // reading of the declaration puts the same man in the world.
  const openingAge = ageAtScenarioStart(result.data.birthYearApprox, context.timelineStartYear);
  const knowledgebase = openingAge === null ? result.data : { ...result.data, ageYearsAtOpening: Math.min(120, openingAge) };

  if (knowledgebase.origin !== "invented") {
    // Birth year must be known and before the scenario start.
    if (knowledgebase.birthYearApprox === null) return null;
    if (context.timelineStartYear !== null && knowledgebase.birthYearApprox > context.timelineStartYear) return null;
    // If a death year is known, the character must not have died before the scenario start.
    if (context.timelineStartYear !== null && knowledgebase.deathYearApprox !== null && knowledgebase.deathYearApprox < context.timelineStartYear) return null;
  }

  // Only somebody actually here can be become; an id the model made up means
  // a new person, not nobody.
  const becomesCharacterId = context.people.some((person) => person.id === knowledgebase.becomesCharacterId) ? knowledgebase.becomesCharacterId! : null;

  // Clamp, never reject. The prompt names the bands and this holds them: a
  // player who declared a common soldier does not open with a senator's
  // fortune, and one who declared a merchant is not left with nothing to
  // trade on. Throwing the whole declaration away over a number would cost
  // the player their character for the engine's convenience, and the model's
  // judgment *inside* a band is worth keeping.
  const purse = clampWealth(knowledgebase.startingMoney, knowledgebase.socioEconomicClass, context.wealth);
  return { ...knowledgebase, startingMoney: purse, becomesCharacterId };
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
      if (error instanceof AiParseError) return { status: "error", message: unplacedMessage(context) };
      throw error;
    }

    const knowledgebase = parseAiKnowledgebase(result.content, gameId, playerId, context);
    if (knowledgebase === null) {
      return { status: "error", message: unplacedMessage(context) };
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
        startingMoney: knowledgebase.startingMoney,
        currencyName: context.currency.name,
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

    // The draft is shown with its place in words: an opaque province id means nothing to the model.
    const home = existing === null || existing === undefined ? undefined : context.regions.find((region) => region.id === existing.locationProvinceId);
    const shown = existing && { ...existing, locationProvinceId: undefined, locationPlace: home === undefined ? null : `${home.name}, ${home.region}` };
    const revisionContext = shown
      ? `Current character draft:\n${JSON.stringify(shown, null, 2)}\n\nPlayer revision: ${revision}`
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
      if (error instanceof AiParseError) return { status: "error", message: unplacedMessage(context) };
      throw error;
    }

    const knowledgebase = parseAiKnowledgebase(result.content, gameId, playerId, context);
    if (knowledgebase === null) {
      return { status: "error", message: unplacedMessage(context) };
    }

    await upsertCharacterKnowledgebase(db, { gameId, playerId, characterId: `declared-${playerId}`, knowledgebase });

    return {
      status: "draft",
      draft: {
        confirmationDraft: knowledgebase.confirmationDraft ?? `You will play as ${knowledgebase.canonicalName}.`,
        canonicalName: knowledgebase.canonicalName,
        origin: knowledgebase.origin,
        startingMoney: knowledgebase.startingMoney,
        currencyName: context.currency.name,
      },
    };
  } finally {
    await close();
  }
}

interface NpcProfileInput {
  npcName: string;
  declaredConnection: string;
  connectionNotes: string;
  period: string;
  playerCulture: string;
}

async function enrichNpcProfile(
  db: ReturnType<typeof createDatabase>["db"],
  userId: string,
  gameId: string,
  kbId: string,
  input: NpcProfileInput,
): Promise<void> {
  const { updateNpcKnowledgebase } = await import("@chronica/db");
  const { enrichNpcProfileViaAi } = await import("./dialogue-service");
  const profile = await enrichNpcProfileViaAi(userId, gameId, input);
  if (profile === null) return;
  await updateNpcKnowledgebase(db, kbId, profile);
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

    // Confirmation is the moment declared relations become real people.  Do
    // not leave behind a chat profile for someone absent from WorldState.
    const scenarioCtx = await getScenarioContext(db, gameId);
    const period = scenarioCtx.period;
    const playerCulture = existing.culture ?? "local";
    const view = await getWorldView(db, gameId);
    if (view === undefined) return { status: "error", message: "This world's canonical state is unavailable." };
    let canonicalWorld = materializePlayerCharacter(
      materializeCanvasProvince(view.world, view.mapAssetId, existing.locationProvinceId),
      characterId,
      confirmed,
      view.scenarioGovernment,
    );
    for (const relation of existing.relations) {
      if (relation.kind !== "person") continue;
      const relationScore = scoreForDeclaredConnection(relation.relationship, relation.notes);
      const player = canonicalWorld.characters.find((candidate) => candidate.id === characterId);
      if (player === undefined) return { status: "error", message: "The confirmed player could not enter canonical world state." };
      // Somebody the world already has -- the other consul, a rival senator --
      // is that man, not a namesake made beside him.
      const known = canonicalWorld.characters.find((candidate) => candidate.alive && candidate.id !== characterId
        && candidate.name.trim().toLowerCase() === relation.name.trim().toLowerCase());
      const npcId = known?.id ?? `declared-npc-${relation.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${playerId}`;
      const kin = known !== undefined || relation.familyRole === null ? null : FAMILY_LINK_BY_ROLE[relation.familyRole] ?? null;
      const created = known !== undefined ? { world: canonicalWorld } : createCanonicalNpc(canonicalWorld, {
        characterId: npcId,
        name: relation.name,
        polityId: player.polityId,
        locationProvinceId: player.locationProvinceId,
        startingMoney: 0,
        createdAtStep: canonicalWorld.elapsedStep,
        creationReason: `Declared ${relation.relationship} of ${existing.canonicalName}.`,
        // A father a generation older, a son a generation younger. Everybody
        // was thirty-five, so the player's parents were his own age.
        ageYearsAtStart: kin === null ? player.ageYearsAtStart : Math.max(1, player.ageYearsAtStart + (KIN_AGE_OFFSET[kin] ?? 0)),
        gender: declaredGender(kin, relation.relationship, player.gender),
      });
      if (created === null) return { status: "error", message: `Could not materialise ${relation.name} in canonical world state.` };
      canonicalWorld = linkCanonicalCharacters(created.world, characterId, npcId, relation.relationship, relationScore, canonicalWorld.elapsedStep);
      canonicalWorld = linkCanonicalCharacters(canonicalWorld, npcId, characterId, relation.relationship, relationScore, canonicalWorld.elapsedStep);
      // Kin as the family graph records it, and not only as a feeling. The
      // declared wife and son were made, and liked him, and were nobody's
      // wife and son: succession reads family links, found none, and offered
      // the dead man's heirs from among strangers of standing.
      if (kin !== null) {
        canonicalWorld = {
          ...canonicalWorld,
          familyLinks: [...canonicalWorld.familyLinks, {
            id: `family-${npcId}`,
            characterId: npcId,
            relatedCharacterId: characterId,
            kind: kin,
            startedAtStep: canonicalWorld.elapsedStep,
            endedAtStep: null,
            visibility: "public",
            provenanceEventId: null,
          }],
        };
      }
      const kb = await getOrCreateNpcKnowledgebase(db, gameId, playerId, npcId, {
        canonicalName: relation.name,
        personalitySummary: relation.notes ?? "",
        biography: relation.notes ?? `${relation.name} is ${existing.canonicalName}'s ${relation.relationship}.`,
        relationshipLabel: relationshipLabelForScore(relationScore),
        relationshipScore: relationScore,
        declaredConnection: relation.relationship,
        declaredConnectionNotes: `${relation.familyRole === null ? "" : `${relation.familyRole}. `}${relation.notes ?? ""}`.trim(),
      });
      await findOrOpenSession(db, gameId, playerId, npcId);
      if (kb.biography === null) {
        await enrichNpcProfile(db, userId, gameId, kb.id, {
          npcName: relation.name,
          declaredConnection: relation.relationship,
          connectionNotes: relation.notes ?? "",
          period,
          playerCulture,
        });
      }
    }
    // This is deliberately last: a contact/knowledgebase failure cannot leave
    // a world-only NPC behind.  Once it succeeds all ordinary readers see the
    // same persisted canonical player and relations before any order can run.
    await persistOpeningWorld(db, gameId, canonicalWorld);

    return { status: "confirmed" };
  } finally {
    await close();
  }
}

/** A declared relative's role, read from the relative's side: a declared "parent" is the player's parent. */
const FAMILY_LINK_BY_ROLE: Readonly<Record<string, FamilyLinkKind>> = {
  parent: "parent",
  partner: "spouse_or_partner",
  sibling: "sibling",
  child: "child",
  other_relative: "other_relative",
};

/** Roughly how much older than the player each kind of kin is. */
/**
 * A declared wife was made a man, like everybody, and so could never bear the
 * player a child. A partner is taken to be of the other sex; anyone else is a
 * woman where the relationship says so in as many words.
 */
function declaredGender(kin: FamilyLinkKind | null, relationship: string, playerGender: "male" | "female"): "male" | "female" {
  if (kin === "spouse_or_partner") return playerGender === "male" ? "female" : "male";
  return /\b(mother|sister|wife|daughter|aunt|niece|grandmother|widow|matron|mistress|concubine|consort|queen|priestess)\b/i.test(relationship) ? "female" : "male";
}

const KIN_AGE_OFFSET: Readonly<Partial<Record<FamilyLinkKind, number>>> = {
  parent: 25,
  child: -25,
  sibling: -2,
  spouse_or_partner: -5,
};

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

