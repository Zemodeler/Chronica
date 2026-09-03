import "server-only";

import { z } from "zod";
import { createAiAdapter, callWithCoinGate, InsufficientCoinsError } from "@chronica/ai";
import {
  appendMessage,
  createDatabase,
  createGroupSession,
  findOrOpenSession,
  getCharacterKnowledgebase,
  getOrCreateNpcKnowledgebase,
  getWorldView,
  insertCharacterSocialEvent,
  insertSharedEntry,
  listNpcKnowledgebases,
  listUnappliedCharacterSocialEvents,
  listPoolEntries,
  listSessionMessages,
  listSessions,
  markEntriesContradicted,
  recordInteraction,
  schema,
  touchSession,
  updateNpcKnowledgebase,
  upsertCharacterProfile,
  type KnowledgebaseRow,
  type MessageRow,
  type SharedEntryRow,
} from "@chronica/db";
import type {
  Character,
  CharacterBelief,
  CharacterKnowledgebase,
  CharacterPressure,
  CharacterProfile,
  CharacterSocialEvent,
  ConversationMemoryEntry,
  DialogueChannel,
  RelationCauseProposal,
} from "@chronica/shared";
import {
  computeOpinion,
  deriveDefaultMind,
  getActivePressures,
  isCharacterReachable,
  NEUTRAL_MIND,
  opinionLabel,
  queryBeliefs,
} from "@chronica/shared";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ChronicaDatabase } from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { headers } from "next/headers";
import { buildDialogueSystemPrompt, type WorldCharacterRef } from "./dialogue-prompt";
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

// ── Social event proposal (the chat/simulation boundary) ────────────────────
//
// Dialogue never mutates a relationship, and never decides on its own that
// something consequential happened -- it can only propose a CharacterSocialEvent,
// which turn resolution later validates against canonical world state and
// applies (packages/shared/src/characters/apply-social-events.ts). Replaces
// the old regex-based `detectConsequences` and the ad hoc relationship-score
// patch that used to live in the knowledge-extraction call below.

const SOCIAL_EVENT_KIND_VALUES = ["conversation", "promise", "insult", "favour", "deception", "rumour"] as const;

const ProposedRelationCauseSchema = z.object({
  subjectCharacterId: z.string().trim().min(1),
  targetCharacterId: z.string().trim().min(1),
  label: z.string().trim().min(1).max(200),
  score: z.number().int().min(-20).max(20),
  decayPerYearBps: z.number().int().min(0).max(10_000),
});

const BELIEF_KIND_VALUES = ["fact", "rumour", "suspicion", "secret"] as const;
// Channels a single two-party conversation can plausibly ground: the NPC
// speaking from direct experience, or confiding something in the player.
// Broad-grant channels (public_announcement, ordinary_rumour spreading past
// this conversation, intercepted_secret) are not choices dialogue itself may
// make -- those require a world event with real witnesses/reach.
const DIALOGUE_KNOWLEDGE_CHANNEL_VALUES = ["direct_witness", "event_participant", "private_disclosure", "trusted_report"] as const;

const ProposedBeliefSchema = z.object({
  subjectEntityId: z.string().trim().min(1).nullable(),
  claim: z.string().trim().min(1).max(400),
  kind: z.enum(BELIEF_KIND_VALUES),
  channel: z.enum(DIALOGUE_KNOWLEDGE_CHANNEL_VALUES),
  /** Who receives this belief -- must be the NPC, the player, or both; validated below. */
  recipientCharacterIds: z.array(z.string().trim().min(1)).min(1).max(2),
});

const PRESSURE_KIND_VALUES = ["debt", "threat", "grief", "illness", "political_danger", "family_obligation", "opportunity", "humiliation", "military_emergency"] as const;

const ProposedPressureChangeSchema = z.object({
  action: z.enum(["create", "refresh", "resolve"]),
  kind: z.enum(PRESSURE_KIND_VALUES).optional(),
  intensity: z.number().int().min(0).max(100).optional(),
  label: z.string().trim().min(1).max(200).optional(),
});

// Character-sim phase 3: a commitment is only ever proposed by the NPC
// speaking, about the NPC's own resources -- dialogue never promises on the
// player's behalf, and never names an account id itself (the resolver fills
// in the NPC's own personal account for a payment; anything else is a
// resource-free social/informational commitment).
const COMMITMENT_ACTION_KIND_VALUES = [
  "payment", "military_support", "political_support",
  "information_sharing", "protection", "office_favour", "other",
] as const;

const ProposedCommitmentSchema = z.object({
  actionKind: z.enum(COMMITMENT_ACTION_KIND_VALUES),
  promisedResult: z.string().trim().min(1).max(400),
  conditions: z.string().trim().max(400).default(""),
  /** Only meaningful when actionKind is "payment"; the NPC's own funds back it. */
  amount: z.number().int().positive().nullable().default(null),
});

const ProposeSocialEventsResponseSchema = z.object({
  events: z.array(z.object({
    kind: z.enum(SOCIAL_EVENT_KIND_VALUES),
    relationCauses: z.array(ProposedRelationCauseSchema).max(4),
    visibility: z.enum(["public", "polity", "private"]),
    proposedBeliefs: z.array(ProposedBeliefSchema).max(2).default([]),
    /** Only the speaking NPC's own pressure -- never the player's, never a third party's. */
    pressureChange: ProposedPressureChangeSchema.nullable().default(null),
    /** Only a promise the NPC just made to the player -- never on the player's behalf. */
    commitmentProposal: ProposedCommitmentSchema.nullable().default(null),
  })).max(3),
});

function buildSocialEventSystemPrompt(npcCharacterId: string, playerCharacterId: string): string {
  return `You analyze one exchange between an NPC and a player character in a historical strategy game and decide whether it produced a lasting social consequence worth recording in the world's social ledger.

Only propose an event when the exchange gives a concrete, attributable reason: a promise, an insult, a favour, a deception, a rumour, or an otherwise consequential conversation. Do not propose anything for routine pleasantries or small talk.

The only two character ids that exist in this exchange are "${npcCharacterId}" (the NPC) and "${playerCharacterId}" (the player). Never invent or reference any other id.

Respond ONLY with JSON matching this schema:
{
  "events": [
    {
      "kind": "conversation" | "promise" | "insult" | "favour" | "deception" | "rumour",
      "relationCauses": [ { "subjectCharacterId": "who now holds this opinion", "targetCharacterId": "who it is about", "label": "short reason, e.g. 'You publicly insulted him.'", "score": -20 to 20, "decayPerYearBps": 0 to 10000 } ],
      "visibility": "public" | "polity" | "private",
      "proposedBeliefs": [ { "subjectEntityId": "id this is about, or null", "claim": "third-person statement", "kind": "fact"|"rumour"|"suspicion"|"secret", "channel": "direct_witness"|"event_participant"|"private_disclosure"|"trusted_report", "recipientCharacterIds": ["${npcCharacterId}" and/or "${playerCharacterId}" -- only these two ids] } ],
      "pressureChange": { "action": "create"|"refresh"|"resolve", "kind": "debt"|"threat"|"grief"|"illness"|"political_danger"|"family_obligation"|"opportunity"|"humiliation"|"military_emergency", "intensity": 0-100, "label": "short reason" } | null,
      "commitmentProposal": { "actionKind": "payment"|"military_support"|"political_support"|"information_sharing"|"protection"|"office_favour"|"other", "promisedResult": "what was actually promised, in the NPC's own words", "conditions": "any stated condition, or empty string", "amount": integer or null (only for "payment", the exact amount if a specific number was promised) } | null
    }
  ]
}
"pressureChange" may only ever describe a pressure on "${npcCharacterId}" (the NPC speaking), never on "${playerCharacterId}" or anyone else -- omit it (null) unless this exchange concretely changes what the NPC is under pressure from.
"commitmentProposal" may only ever describe a promise "${npcCharacterId}" just made to "${playerCharacterId}" -- never a promise on the player's behalf, and only when the NPC's reply contains an explicit, concrete commitment (not a vague offer of sympathy). Omit it (null) otherwise.
Return { "events": [] } if nothing consequential happened.`;
}

/**
 * Proposes social events via a structured, Zod-validated AI call and persists
 * each one as a "proposed" row. Never touches `WorldState` directly -- only
 * turn resolution applies them (apps/web/lib/resolution/pipeline.ts).
 */
async function proposeAndPersistSocialEvents(
  db: ChronicaDatabase,
  userId: string,
  gameId: string,
  npcCharacterId: string,
  playerCharacterId: string,
  sessionId: string,
  npcMessageId: string,
  playerMessage: string,
  npcReply: string,
  currentStep: number,
  npcPersonalAccountId: string | null,
): Promise<CharacterSocialEvent[]> {
  const adapter = createAiAdapter();
  let result: Awaited<ReturnType<typeof callWithCoinGate>>;
  try {
    result = await callWithCoinGate(
      db, userId, gameId, "propose_social_events", adapter,
      { system: buildSocialEventSystemPrompt(npcCharacterId, playerCharacterId), user: `Player: ${playerMessage}\nNPC reply: ${npcReply}` },
      (content) => {
        try {
          const parsed: unknown = JSON.parse(content);
          return typeof parsed === "object" && parsed !== null && "events" in parsed;
        } catch {
          return false;
        }
      },
    );
  } catch (error) {
    if (!(error instanceof InsufficientCoinsError)) {
      console.warn("[propose_social_events] unexpected error during social event proposal:", error);
    }
    return [];
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.content);
  } catch {
    return [];
  }
  const parsed = ProposeSocialEventsResponseSchema.safeParse(raw);
  if (!parsed.success) return [];

  const validIds = new Set([npcCharacterId, playerCharacterId]);
  const persisted: CharacterSocialEvent[] = [];
  for (const draft of parsed.data.events) {
    // Reject impossible knowledge: only the two participants in this exchange
    // may be named as a relation cause's subject or target.
    const hasUnknownId = draft.relationCauses.some(
      (cause) => !validIds.has(cause.subjectCharacterId) || !validIds.has(cause.targetCharacterId),
    );
    if (hasUnknownId) continue;

    // Beliefs: reject anything naming a recipient outside this conversation.
    const proposedBeliefs = draft.proposedBeliefs
      .filter((belief) => belief.recipientCharacterIds.every((id) => validIds.has(id)))
      .map((belief) => ({
        subjectEntityId: belief.subjectEntityId,
        claim: belief.claim,
        kind: belief.kind,
        channel: belief.channel,
        explicitRecipientCharacterIds: belief.recipientCharacterIds,
        expiresInSteps: null,
      }));

    // Pressure changes: only ever about the NPC speaking, never the player or a third party.
    const pressureChanges = draft.pressureChange !== null && draft.pressureChange.action === "create"
      && draft.pressureChange.kind !== undefined && draft.pressureChange.intensity !== undefined && draft.pressureChange.label !== undefined
      ? [{
          characterId: npcCharacterId,
          action: draft.pressureChange.action,
          kind: draft.pressureChange.kind,
          intensity: draft.pressureChange.intensity,
          label: draft.pressureChange.label,
          reviewInSteps: 4,
          expiresInSteps: null,
          visibility: "private" as const,
        }]
      : [];

    // Commitments (character-sim phase 3): only ever a promise the NPC just
    // made to the player, about the NPC's own resources. A payment names the
    // NPC's own personal account -- never one the AI supplies -- and is
    // dropped silently (not rejected) if the NPC has no account to name,
    // since `applySocialEvents` would reject an accountless payment anyway.
    const commitmentProposal = draft.commitmentProposal !== null
      && (draft.commitmentProposal.actionKind !== "payment" || (draft.commitmentProposal.amount !== null && npcPersonalAccountId !== null))
      ? {
          actionKind: draft.commitmentProposal.actionKind,
          promisedResult: draft.commitmentProposal.promisedResult,
          conditions: draft.commitmentProposal.conditions,
          rationale: "",
          promisorCharacterId: npcCharacterId,
          beneficiaryCharacterId: playerCharacterId,
          requiredOfficeId: null,
          requiredResource: draft.commitmentProposal.actionKind === "payment" && draft.commitmentProposal.amount !== null && npcPersonalAccountId !== null
            ? { accountId: npcPersonalAccountId, minAmount: draft.commitmentProposal.amount }
            : null,
          reviewInSteps: 6,
        }
      : null;

    const id = randomUUID();
    const event = {
      id,
      gameId,
      sourceTurnId: null,
      sourceSessionId: sessionId,
      sourceMessageId: npcMessageId,
      participantCharacterIds: [npcCharacterId, playerCharacterId],
      kind: draft.kind,
      visibility: draft.visibility,
      knownByCharacterIds: [npcCharacterId, playerCharacterId],
      relationCauses: draft.relationCauses as RelationCauseProposal[],
      knowledgeClaims: [],
      proposedBeliefs,
      pressureChanges,
      commitmentProposal,
      introducedCharacter: null,
      introducedProfile: null,
      createdAtStep: currentStep,
    };
    await insertCharacterSocialEvent(db, id, gameId, event);
    persisted.push({ ...event, appliedAtStep: null, appliedInTurnId: null, status: "proposed", rejectionReason: null });
  }
  return persisted;
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

/**
 * Shares factual, third-person claims into the network's knowledge pools.
 * Informational only -- opinion/relationship deltas are no longer decided
 * here; they flow exclusively through `proposeAndPersistSocialEvents` above.
 */
async function extractAndPropagateKnowledge(
  db: ChronicaDatabase,
  userId: string,
  gameId: string,
  npcCharacterId: string,
  sessionId: string,
  npcMessageId: string,
  npcReply: string,
  playerMessage: string,
  existingEntries: readonly SharedEntryRow[],
  pools: readonly PoolSpec[],
  stepOccurred: number,
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

    // The speaking NPC durably believes what they just said -- a canonical
    // belief, proposed through the same social-event ledger every other
    // canonical mutation uses (character-sim phase 2). Sharing a pool entry
    // is descriptive/performance only and never itself grants knowledge.
    await insertCharacterSocialEvent(db, randomUUID(), gameId, {
      sourceSessionId: sessionId,
      sourceMessageId: npcMessageId,
      participantCharacterIds: [npcCharacterId],
      kind: "conversation",
      visibility: "private",
      knownByCharacterIds: [npcCharacterId],
      relationCauses: [],
      knowledgeClaims: [],
      proposedBeliefs: [{
        subjectEntityId: null,
        claim: body,
        kind: "fact",
        channel: "event_participant",
        explicitRecipientCharacterIds: [npcCharacterId],
        expiresInSteps: null,
      }],
      pressureChanges: [],
      commitmentProposal: null,
      introducedCharacter: null,
      introducedProfile: null,
      createdAtStep: stepOccurred,
    });
  }
}

// ── NPC profile enrichment ──────────────────────────────────────────────────

// Titles that indicate a ruling or senior historical figure worth looking up.
const NOTABLE_TITLE_RE = /\b(king|queen|emperor|empress|pharaoh|consul|praetor|dictator|censor|tribune|legate|tyrant|archon|strategos|satrap|doge|duke|sultan|caliph|khan|tsar|shogun|daimyo)\b/i;

// Returns a Wikipedia extract for the most likely historical figure, or null.
async function lookupHistoricalFigure(name: string, role: string, period: string): Promise<string | null> {
  if (!NOTABLE_TITLE_RE.test(name) && !NOTABLE_TITLE_RE.test(role)) return null;
  const query = `${name} ${role} ${period}`.trim();
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=1`;
    const searchRes = await fetch(searchUrl, { headers: { "User-Agent": "Chronica/1.0 (historical-npc-lookup; contact: support@chronica.app)" } });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as { query?: { search?: Array<{ title: string }> } };
    const topTitle = searchData.query?.search?.[0]?.title;
    if (!topTitle) return null;

    const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`, {
      headers: { "User-Agent": "Chronica/1.0 (historical-npc-lookup; contact: support@chronica.app)" },
    });
    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json() as { extract?: string; title?: string };
    if (!summary.extract) return null;
    return `Wikipedia — ${summary.title ?? topTitle}:\n${summary.extract.slice(0, 900)}`;
  } catch {
    return null;
  }
}

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

Match the culture, class, and skills to the period and the stated relationship. Keep biography grounded and specific — avoid vague platitudes.

HISTORICAL ACCURACY: If a "Historical context" section appears in the input, it is a Wikipedia extract for this person. Use it as your primary source of truth for biography, background events, and role. Set skills and relationshipScore to match their historical character. If the extract clearly describes a different person than the NPC, ignore it.`;

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
    historicalContext?: string;
  },
): Promise<NpcProfilePatch | null> {
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const userPrompt = `NPC name: ${input.npcName}
Relationship to player: ${input.declaredConnection}
Notes: ${input.connectionNotes || "none"}
Period: ${input.period}
Player's culture: ${input.playerCulture}${input.historicalContext ? `\n\nHistorical context:\n${input.historicalContext}` : ""}`;

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
  /** Character-sim phase 2: full canonical lists, filtered down to the speaking NPC's own state below. */
  characterPressures: readonly CharacterPressure[];
  characterBeliefs: readonly CharacterBelief[];
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
    worldCharacters, characterPressures, characterBeliefs,
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

  // Reachability is derived from the canonical character record -- alive
  // status and location -- never from the legacy `isAvailable` flag alone.
  // `kb.isAvailable` remains a fallback only for a contact not yet found in
  // canonical state (e.g. mid-migration).
  const npcRef = worldCharacters.find((c) => c.id === npcCharacterId);
  const reachability = npcRef !== undefined
    ? isCharacterReachable(npcRef, channel as DialogueChannel, worldCharacters.find((c) => c.id === playerCharacterId)?.locationProvinceId ?? null)
    : { reachable: kb.isAvailable, reason: kb.isAvailable ? null : `${kb.canonicalName} is not reachable right now.` };

  if (!reachability.reachable) {
    const playerMsg = input.appendPlayerMessage === false ? null : await appendMessage(db, sessionId, playerCharacterId, true, playerMessageBody);
    await touchSession(db, sessionId);
    return {
      playerMessage: playerMsg === null ? { id: "", sessionId, sequence: -1, speakerCharacterId: playerCharacterId, isPlayerMessage: true, body: playerMessageBody } : toMsgShape(playerMsg),
      npcReply: null,
      unavailableReason: reachability.reason ?? `${kb.canonicalName} is not reachable right now.`,
    };
  }

  // Authoritative opinion, folded from the NPC's directed relation causes --
  // never the legacy stored `relationshipScore` (falls back to it only when
  // the NPC has no canonical relation ledger to read yet).
  const opinionScore = npcRef !== undefined ? computeOpinion(npcRef, playerCharacterId) : kb.relationshipScore;
  const opinion = { score: opinionScore, label: opinionLabel(opinionScore) };

  // Resolve shared knowledge pools for this NPC and fetch existing entries
  const pools = computeNpcPools(npcCharacterId, kb, worldCharacters);
  const sharedEntries = await listPoolEntries(db, gameId, pools);

  const recentMessages = await listSessionMessages(db, sessionId, 20);
  // Subjective context (character-sim phase 2): only this NPC's own mind,
  // traits, active pressures, and beliefs -- never another character's.
  const mindContext = {
    mind: npcRef?.mind ?? NEUTRAL_MIND,
    traits: npcRef?.traits ?? [],
    pressures: getActivePressures({ characterPressures }, npcCharacterId),
    beliefs: queryBeliefs({ characterBeliefs }, npcCharacterId),
  };
  const systemPrompt = buildDialogueSystemPrompt(
    kb, playerCharacterName, playerCharacterId, playerKnowledgebase, channel, period, recentMessages, worldCharacters, mindContext, opinion,
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

  // Propose social events (the chat/simulation boundary) and update the
  // per-player conversation memory. Relation deltas are never written here --
  // only turn resolution applies a proposed event to canonical state.
  const proposedEvents = await proposeAndPersistSocialEvents(
    db, userId, gameId, npcCharacterId, playerCharacterId, sessionId, npcMsg.id, playerMessageBody, npcBody, currentStep,
    npcRef?.personalAccountId ?? null,
  );
  const updatedMemory = buildUpdatedMemory(kb.conversationMemory, playerMessageBody, npcBody, currentStep, proposedEvents.length > 0);
  const relevancyDelta = 5 + (proposedEvents.length > 0 ? 10 : 0) + (opinionScore < 0 ? 15 : 0);

  await updateNpcKnowledgebase(db, kb.id, { conversationMemory: updatedMemory });
  await recordInteraction(db, kb.id, relevancyDelta);

  // Keep the request connection alive until extraction has completed. A
  // propagation failure must not discard an otherwise valid dialogue reply.
  try {
    await extractAndPropagateKnowledge(
      db, userId, gameId, npcCharacterId, sessionId, npcMsg.id,
      npcBody, playerMessageBody, sharedEntries, pools, currentStep,
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
  hadSocialEvent: boolean,
): ConversationMemoryEntry[] {
  const summary = `${playerBody.slice(0, 80)}… → ${npcBody.slice(0, 100)}…`;
  const salience: ConversationMemoryEntry["salience"] = hadSocialEvent ? "high" : "low";

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
  // Candidates resolve exclusively from canonical `world.characters`, plus any
  // NPC a discovery event has already introduced but turn resolution has not
  // yet folded into the snapshot -- so a person discovered moments ago in
  // this same session is still contactable before the next turn resolves.
  // `gameNpcRecords` is no longer consulted (character-sim phase 1).
  const pendingDiscoveries = (await listUnappliedCharacterSocialEvents(db, gameId))
    .filter((event): event is typeof event & { introducedCharacter: Character } => event.kind === "discovery" && event.introducedCharacter !== null);
  const candidates = [
    ...worldView.world.characters.map((character) => ({ character, roleLabel: character.officeId ?? "contact" })),
    ...pendingDiscoveries.map((event) => ({ character: event.introducedCharacter, roleLabel: event.introducedProfile?.roleLabel ?? "contact" })),
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
    // Lazily enrich world characters that haven't been profiled yet.
    const existingKb = await getOrCreateNpcKnowledgebase(db, gameId, playerId, match.character.id, {
      canonicalName: match.character.name,
      role: match.roleLabel,
    });
    if (existingKb.biography === null) {
      const historicalContext = await lookupHistoricalFigure(match.character.name, match.roleLabel, period);
      const profile = await enrichNpcProfileViaAi(userId, gameId, {
        npcName: match.character.name,
        declaredConnection: match.roleLabel,
        connectionNotes: existingKb.personalitySummary,
        period,
        playerCulture: "local",
        ...(historicalContext !== null ? { historicalContext } : {}),
      });
      if (profile !== null) await updateNpcKnowledgebase(db, existingKb.id, profile);
    }
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

  // New character — canonical Character + profile, proposed as a "discovery"
  // social event rather than written directly to WorldState.characters. Turn
  // resolution is the sole authority that folds it into the snapshot
  // (apps/web/lib/resolution/pipeline.ts); until then it is only reachable
  // through this same game's pending-discoveries list above.
  const npcCharacterId = `npc:discovered:${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const province = worldView.world.map.provinces.find((p) => p.id === parsed.locationProvinceId)
    ?? worldView.world.map.provinces.find((p) => p.id === playerLocationProvinceId)
    ?? worldView.world.map.provinces[0];
  if (!province) return { status: "unavailable", explanation: "No valid location is available for that contact." };
  const npcSkills = { martial: 35, intrigue: 35, learning: 35, piety: 35, stewardship: 35, diplomacy: 35, body: 50, subSkills: {} };
  const character: Character = {
    id: npcCharacterId, name: parsed.name, cultureId: "local", faithId: null, dynastyId: null,
    locationProvinceId: province.id, polityId: province.controllerPolityId, ageYearsAtStart: 35, officeId: null,
    personalAccountId: `${npcCharacterId}:abstract`, skills: npcSkills,
    traits: [], mind: deriveDefaultMind({ officeId: null, skills: npcSkills, ageYears: 35, cultureId: "local" }),
    healthBps: 8_000, prestigeBps: 3_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null,
    disqualifyingStatuses: [],
  };
  const profile: CharacterProfile = {
    gameId, characterId: npcCharacterId, version: 1, roleLabel: parsed.roleLabel,
    biography: null, voiceSummary: parsed.personalitySummary || null, presentationDetails: {},
    updatedAtStep: worldView.world.elapsedStep,
  };
  await upsertCharacterProfile(db, profile);
  await insertCharacterSocialEvent(db, randomUUID(), gameId, {
    sourceSessionId: null,
    sourceMessageId: null,
    participantCharacterIds: [playerCharacterId, npcCharacterId],
    kind: "discovery",
    visibility: "private",
    knownByCharacterIds: [playerCharacterId, npcCharacterId],
    relationCauses: [],
    knowledgeClaims: [],
    proposedBeliefs: [],
    pressureChanges: [],
    commitmentProposal: null,
    introducedCharacter: character,
    introducedProfile: profile,
    createdAtStep: worldView.world.elapsedStep,
  });

  const newKb = await getOrCreateNpcKnowledgebase(db, gameId, playerId, npcCharacterId, {
    canonicalName: parsed.name,
    personalitySummary: parsed.personalitySummary,
    role: parsed.roleLabel,
    locationProvinceId: parsed.locationProvinceId,
    relationshipLabel: "neutral",
  });
  const session = await findOrOpenSession(db, gameId, playerId, npcCharacterId, "correspondence");

  if (newKb.biography === null) {
    const historicalContext = await lookupHistoricalFigure(parsed.name, parsed.roleLabel, period);
    const enrichedProfile = await enrichNpcProfileViaAi(userId, gameId, {
      npcName: parsed.name,
      declaredConnection: parsed.roleLabel,
      connectionNotes: parsed.personalitySummary,
      period,
      playerCulture: "local",
      ...(historicalContext !== null ? { historicalContext } : {}),
    });
    if (enrichedProfile !== null) {
      await updateNpcKnowledgebase(db, newKb.id, enrichedProfile);
      if (enrichedProfile.biography !== null) {
        await upsertCharacterProfile(db, { ...profile, biography: enrichedProfile.biography, version: 2 });
      }
    }
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
  characterPressures: readonly CharacterPressure[];
  characterBeliefs: readonly CharacterBelief[];
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

    const [worldView, playerKnowledgebase, pendingSocialEvents] = await Promise.all([
      getWorldView(db, gameId),
      getCharacterKnowledgebase(db, gameId, player.id),
      listUnappliedCharacterSocialEvents(db, gameId),
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
    const tier = (continuity?.tier ?? "ordinary");
    const currentStep = world.elapsedStep ?? 0;

    // Canonical characters, plus any NPC a discovery event has already
    // introduced but turn resolution has not yet folded into the snapshot.
    // `gameNpcRecords` is no longer consulted (character-sim phase 1).
    const pendingCharacters = pendingSocialEvents
      .filter((event) => event.kind === "discovery" && event.introducedCharacter !== null)
      .map((event) => event.introducedCharacter!);
    const allCharacters = [...world.characters, ...pendingCharacters];
    const worldCharacters: WorldCharacterRef[] = allCharacters.map((c) => ({
      id: c.id,
      name: c.name,
      dynastyId: c.dynastyId,
      polityId: c.polityId,
      officeId: c.officeId,
      locationProvinceId: c.locationProvinceId,
      alive: c.alive,
      relations: c.relations,
      mind: c.mind,
      traits: c.traits,
      personalAccountId: c.personalAccountId,
    }));

    return {
      db, close, userId, playerId: player.id, characterId, characterName, playerKnowledgebase, locationProvinceId, roleLabel, period, currentStep, continuityTier: tier, worldCharacters,
      characterPressures: world.characterPressures,
      characterBeliefs: world.characterBeliefs,
    };
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
