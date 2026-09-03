import "server-only";

import type {
  OrderBatch,
  WorldState,
  OrderInterpretation,
  OrderAssessment,
  Verdict,
  ProposedInvocation,
  CharacterSuggestion,
  SelectedCharacter,
  StateDelta,
  ReactionProposal,
  SimulatorProposal,
  CharacterKnowledgebase,
  WorkflowAuditBlob,
  ConsolidatedProposalPackage,
  CandidateAction,
  IntentClaim,
  CharacterIntent,
} from "@chronica/shared";
import {
  OrderInterpretationSchema,
  OrderAssessmentSchema,
  VerdictSchema,
  CharacterSuggestionBatchSchema,
  ReactionProposalBatchSchema,
  SimulatorProposalBatchSchema,
  WorldDirectorDecisionBatchSchema,
  executeWorkflows,
  selectRelevantCharacters,
  inferTheatre,
  WORKFLOW_REGISTRY,
  applySocialEvents,
  deriveDefaultMind,
  advancePressureLifecycle,
  derivePressureTriggers,
  createPressure,
  dueCommitments,
  fulfillCommitment,
  deferCommitment,
  breakCommitment,
  generateCandidateActions,
  rankCandidates,
  resolveIntentConflicts,
  resolveDueProcedures,
  netSupportWeight,
  dueLifeReviews,
  rollLifeEvent,
  classifyLifeStage,
  nextReviewStep,
  settleEstate,
  deriveLegacyCauses,
  findPlayerSuccessors,
  currentAgeYears,
  canSponsorProcedure,
  resolveEligibility,
  deriveAuthoritySummary,
  buildCurrentDispatch,
  DEFAULT_MAX_CHRONICLE_ENTRIES_PER_TURN,
  type ScenarioClock,
  type ScenarioLifeRules,
  type ScenarioGovernmentRules,
} from "@chronica/shared";
import { collectCharacterAgencyCandidates, collectPlayerCandidates, collectWorldCandidates, previewPlayerWorkflows, runWorkflowManager } from "./workflow-manager";

const InterpretParseSchema = OrderInterpretationSchema.omit({ directiveId: true });
const AssessParseSchema = OrderAssessmentSchema.omit({ directiveId: true });
const VALID_KNOWLEDGE_VISIBILITIES = new Set(["public", "polity", "private"]);
// Territory, war, and battle outcomes are inherently visible at large scale —
// no adjudication can plausibly keep them private. See the visibility-floor
// repair in the adjudicate step below.
const PUBLICLY_VISIBLE_ACTIONS = new Set([
  "change_province_control", "give_territory", "start_war", "end_war",
  "start_battle", "end_battle", "start_siege", "end_siege", "sign_treaty",
]);
// Player ownership is assigned from the authenticated turn, never trusted from
// a model response. This also prevents a malformed `playerId: null` from
// discarding an otherwise valid adjudication.
const VerdictParseSchema = VerdictSchema.omit({ directiveId: true, playerInvolvement: true });
import { callWithCoinGate, type AiAdapter } from "@chronica/ai";
import type { ChronicaDatabase } from "@chronica/db";
import {
  commitResolution,
  failTurn,
  claimTurnForResolution,
  ingestChronicleEntries,
  getCharacterKnowledgebase,
  getGamePayerUserId,
  listPendingNpcCommitments,
  resolveNpcCommitments,
  listActiveInventedWorkflows,
  listUnappliedCharacterSocialEvents,
  markCharacterSocialEventsApplied,
  markCharacterSocialEventsRejected,
  upsertCharacterProfile,
} from "@chronica/db";
import type { ChronicleEntryInput } from "@chronica/db";
import type { ResolutionProgress, ResolutionStep } from "./types";
import { STEP_LABELS } from "./types";
import {
  buildInterpretSystemPrompt,
  buildAssessSystemPrompt,
  buildAdjudicateSystemPrompt,
  buildChronicleNarratorPrompt,
  type NarratorEntry,
  type ResolutionPlayerContext,
} from "./prompts";
import { buildCharacterDirectorSystemPrompt } from "./character-director-prompt";
import { buildSimulatorSystemPrompt } from "./simulator-prompt";
import { buildReactionDirectorSystemPrompt, shouldRunReactionDirector } from "./reaction-director-prompt";
import { consolidateProposals } from "./consolidator-prompt";
import { buildWorldDirectorSystemPrompt } from "./world-director-prompt";
import { buildCharacterSuggestionInvocation, buildIntentInvocation, buildIntentSocialEvent } from "./character-agency";

export type ProgressCallback = (progress: ResolutionProgress) => void;

export interface WorkflowDeveloperDownload {
  readonly fileName: string;
  readonly content: string;
}

export interface ResolveTurnResult {
  readonly workflowDownloads: readonly WorkflowDeveloperDownload[];
}

function emit(onProgress: ProgressCallback, step: ResolutionStep, done = false) {
  onProgress({ step, label: STEP_LABELS[step], done });
}

let _logTurnId = "";
function tag() { return `[pipeline${_logTurnId ? `:${_logTurnId.slice(0, 8)}` : ""}]`; }

function stripToJson(text: string): string {
  let s = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  if (s.length > 0 && s[0] !== "{" && s[0] !== "[") {
    const objIdx = s.indexOf("{");
    const arrIdx = s.indexOf("[");
    const first = objIdx === -1 ? arrIdx : arrIdx === -1 ? objIdx : Math.min(objIdx, arrIdx);
    if (first !== -1) {
      const isObj = s[first] === "{";
      const last = isObj ? s.lastIndexOf("}") : s.lastIndexOf("]");
      if (last !== -1) s = s.slice(first, last + 1);
    }
  }
  return s;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept the two legacy array forms models have emitted for assessment
 * workflows, then hand the canonical plural form to the schema. Adjudication
 * remains the authority on whether these hints actually become state changes.
 */
function normalizeAssessmentContent(text: string): string {
  const raw = JSON.parse(stripToJson(text)) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw["workflow"])) return JSON.stringify(raw);

  const legacy = raw["workflow"];
  const workflows = Array.isArray(raw["workflows"]) ? raw["workflows"].filter(isRecord) : [];
  if (typeof legacy[0] === "string" && isRecord(legacy[1])) {
    workflows.unshift({ actionId: legacy[0], parameters: legacy[1] });
  } else {
    workflows.push(...legacy.filter(isRecord));
  }
  raw["workflow"] = null;
  raw["workflows"] = workflows.slice(0, 4);
  console.warn(`${tag()} [assess] repaired legacy workflow array into workflows`);
  return JSON.stringify(raw);
}

/**
 * An interpretation with no proposed steps is otherwise complete, and occurs
 * most often for bracketed GM commands. Preserve the model's grounded intent
 * and targets by supplying the required generic execution step instead of
 * discarding the entire interpretation.
 */
function normalizeInterpretationContent(text: string): string {
  const raw = JSON.parse(stripToJson(text)) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw["proposedSteps"]) || raw["proposedSteps"].length > 0) {
    return JSON.stringify(raw);
  }

  raw["proposedSteps"] = ["Execute the order as stated."];
  console.warn(`${tag()} [interpret] supplied a default proposed step for an otherwise valid interpretation`);
  return JSON.stringify(raw);
}

/**
 * Simulator proposals are optional world colour. Remove only malformed
 * workflow invocations, preserving the valid narrative proposals rather than
 * rejecting the entire batch because one model field is unusable.
 */
function sanitizeSimulatorContent(text: string, world: WorldState): string {
  const raw = JSON.parse(stripToJson(text)) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw["proposals"])) return JSON.stringify(raw);

  const characterIds = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
  let removed = 0;
  raw["proposals"] = (raw["proposals"] as unknown[]).map((proposal: unknown) => {
    if (!isRecord(proposal) || !Array.isArray(proposal["proposedWorkflows"])) return proposal;
    const proposedWorkflows = (proposal["proposedWorkflows"] as unknown[]).filter((workflow: unknown) => {
      if (!isRecord(workflow)) {
        removed += 1;
        return false;
      }
      const valid = typeof workflow["actionId"] === "string"
        && WORKFLOW_REGISTRY.has(workflow["actionId"])
        && typeof workflow["actorId"] === "string"
        && characterIds.has(workflow["actorId"])
        && isRecord(workflow["parameters"]);
      if (!valid) removed += 1;
      return valid;
    });
    return { ...proposal, proposedWorkflows };
  });
  if (removed > 0) console.warn(`${tag()} [simulator] discarded ${removed} malformed workflow invocation(s); retaining narrative proposals`);
  return JSON.stringify(raw);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ── Entity resolution ─────────────────────────────────────────────────────────
// Models sometimes emit human-readable names instead of IDs. This resolves
// string parameter values to the nearest real entity ID using case-insensitive
// name matching, so workflow execution doesn't silently fail on a bad reference.

function fuzzyMatchEntityId<T extends { id: string }>(
  value: string,
  candidates: readonly T[],
  getName: (item: T) => string,
): string | null {
  if (candidates.some((c) => c.id === value)) return null; // already a valid ID
  const lower = value.toLowerCase().trim();
  const exact = candidates.find((c) => getName(c).toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = candidates.find((c) => {
    const name = getName(c).toLowerCase();
    return name.includes(lower) || lower.includes(name);
  });
  return partial?.id ?? null;
}

function resolveInvocationEntities(invocation: ProposedInvocation, world: WorldState): ProposedInvocation {
  const params = { ...invocation.parameters } as Record<string, unknown>;
  let changed = false;

  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string") continue;
    const lk = key.toLowerCase();
    let resolved: string | null = null;

    if (lk.endsWith("provinceid") || lk === "locationid" || lk === "destinationid") {
      resolved = fuzzyMatchEntityId(value, world.map.provinces, (p) => p.name);
    } else if (lk.endsWith("polityid")) {
      resolved = fuzzyMatchEntityId(value, world.map.polities, (p) => p.name);
    } else if (lk.endsWith("forceid")) {
      resolved = fuzzyMatchEntityId(value, world.material.forces, (f) => f.name);
    } else if (lk.endsWith("characterid")) {
      resolved = fuzzyMatchEntityId(value, world.characters.filter((c) => c.alive), (c) => c.name);
    } else if (lk.endsWith("accountid")) {
      if (!world.material.accounts.some((a) => a.id === value)) {
        const matchChar = world.characters.find(
          (c) => c.id === value || c.name.toLowerCase() === value.toLowerCase().trim(),
        );
        if (matchChar) {
          const acct = world.material.accounts.find(
            (a) => a.owner.kind === "character" && a.owner.id === matchChar.id && a.status === "active",
          );
          if (acct) resolved = acct.id;
        }
      }
    }

    if (resolved !== null) {
      console.log(`${tag()} [entity-resolve] ${invocation.actionId}.${key}: "${value}" → "${resolved}"`);
      params[key] = resolved;
      changed = true;
    }
  }

  return changed ? { ...invocation, parameters: params } : invocation;
}

const VALID_CAST_ROLES = new Set([
  "supporter", "opponent", "spokesperson", "presiding_official", "witness", "negotiator",
]);

function repairChronicleCastRole(role: string): string {
  if (VALID_CAST_ROLES.has(role)) return role;
  const lower = role.toLowerCase();
  if (lower.includes("presid") || lower.includes("chair") || lower.includes("official")) return "presiding_official";
  if (lower.includes("support") || lower.includes("backer") || lower.includes("ally")) return "supporter";
  if (lower.includes("oppos") || lower.includes("critic") || lower.includes("rival") || lower.includes("enemy")) return "opponent";
  if (lower.includes("negotiat") || lower.includes("envoy") || lower.includes("diplomat")) return "negotiator";
  if (lower.includes("witness") || lower.includes("observer")) return "witness";
  return "spokesperson";
}

/**
 * The World Director occasionally copies a valid proposed workflow but emits
 * actorId: null. Recover its exact source invocation instead of throwing away
 * the entire decision batch and all of its narrative decisions.
 */
function sanitizeWorldDirectorContent(text: string, pkg: ConsolidatedProposalPackage): string {
  const raw = JSON.parse(stripToJson(text)) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw["decisions"])) return JSON.stringify(raw);

  let repaired = 0;
  let removed = 0;
  raw["decisions"] = (raw["decisions"] as unknown[]).map((decision) => {
    if (!isRecord(decision) || typeof decision["proposalId"] !== "string" || !Array.isArray(decision["finalWorkflows"])) return decision;
    const proposed = pkg.proposals.find((proposal) => proposal.id === decision["proposalId"])?.proposedWorkflows ?? [];
    const finalWorkflows = (decision["finalWorkflows"] as unknown[]).flatMap((workflow) => {
      if (!isRecord(workflow) || workflow["actorId"] !== null || typeof workflow["actionId"] !== "string" || !isRecord(workflow["parameters"])) {
        return [workflow];
      }
      const exact = proposed.find((candidate) => candidate.actionId === workflow["actionId"] && stableJson(candidate.parameters) === stableJson(workflow["parameters"]));
      const sameAction = proposed.filter((candidate) => candidate.actionId === workflow["actionId"]);
      const replacement = exact ?? (sameAction.length === 1 ? sameAction[0] : undefined);
      if (!replacement) {
        removed += 1;
        return [];
      }
      repaired += 1;
      return [replacement];
    });
    // Repair invalid chronicleCast.role values — an invalid enum in one decision
    // previously caused the entire batch to fail schema validation.
    let repairedCast = decision["chronicleCast"];
    if (isRecord(repairedCast) && typeof repairedCast["role"] === "string" && !VALID_CAST_ROLES.has(repairedCast["role"])) {
      const fixedRole = repairChronicleCastRole(repairedCast["role"]);
      console.warn(`${tag()} [world_direct] repaired chronicleCast.role "${repairedCast["role"]}" → "${fixedRole}"`);
      repairedCast = { ...repairedCast, role: fixedRole };
      repaired += 1;
    }
    return { ...decision, finalWorkflows, chronicleCast: repairedCast };
  });
  if (repaired > 0 || removed > 0) {
    console.warn(`${tag()} [world_direct] repaired ${repaired} workflow(s)/role(s); discarded ${removed} unmatchable workflow(s)`);
  }
  return JSON.stringify(raw);
}

function assessmentWorkflows(assessment: OrderAssessment) {
  return assessment.workflows.length > 0
    ? assessment.workflows
    : assessment.workflow === null ? [] : [assessment.workflow];
}

function safeParseJson<T>(
  text: string,
  schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: unknown } },
  label: string,
): T | null {
  try {
    const raw = JSON.parse(stripToJson(text)) as unknown;
    const result = schema.safeParse(raw);
    if (result.success && result.data !== undefined) return result.data;
    const err = result.error as { message?: string; issues?: { path: unknown[]; message: string }[] } | undefined;
    console.error(`${tag()} [parse-fail:${label}] schema validation failed:`, err?.message ?? "(no message)");
    for (const issue of err?.issues ?? []) {
      console.error(`  path=${JSON.stringify(issue.path)} msg=${issue.message}`);
    }
    console.error(`${tag()} [parse-fail:${label}] raw AI content (first 800 chars):`, text.slice(0, 800));
    return null;
  } catch (parseErr) {
    console.error(`${tag()} [parse-fail:${label}] JSON.parse threw:`, parseErr);
    console.error(`${tag()} [parse-fail:${label}] raw AI content (first 800 chars):`, text.slice(0, 800));
    return null;
  }
}

/**
 * Confirmed declared characters are staged outside the world snapshot until
 * their first turn. Materialize that character here, before any prompt or
 * workflow sees the turn, so an existing NPC can never become the fallback
 * actor for the player's orders.
 */
function materializePlayerCharacter(
  world: WorldState,
  actorCharacterId: string,
  knowledgebase: CharacterKnowledgebase | null,
): WorldState {
  if (world.characters.some((character) => character.id === actorCharacterId)) return world;
  if (!knowledgebase || knowledgebase.characterId !== actorCharacterId) {
    throw new Error("The submitted player's character is not present in world state and has no confirmed knowledgebase.");
  }

  const locationProvinceId = knowledgebase.locationProvinceId;
  const location = locationProvinceId === null
    ? undefined
    : world.map.provinces.find((province) => province.id === locationProvinceId);
  if (!location) throw new Error("The submitted player's character has no valid starting location.");

  const accountId = `account-${actorCharacterId}`;
  const existingAccount = world.material.accounts.find((account) => account.id === accountId);
  const personalAccount = existingAccount ?? {
    id: accountId,
    owner: { kind: "character" as const, id: actorCharacterId },
    currencyId: world.material.currency.id,
    balance: knowledgebase.startingMoney,
    status: "active" as const,
    visibility: "private" as const,
  };
  const playerCharacter: WorldState["characters"][number] = {
    id: actorCharacterId,
    name: knowledgebase.canonicalName,
    cultureId: `culture-${knowledgebase.culture.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "local"}`,
    faithId: null,
    dynastyId: null,
    locationProvinceId: location.id,
    polityId: location.controllerPolityId,
    ageYearsAtStart: 35,
    officeId: null,
    personalAccountId: accountId,
    skills: knowledgebase.skills,
    traits: [],
    mind: deriveDefaultMind({ officeId: null, skills: knowledgebase.skills, ageYears: 35, cultureId: `culture-${knowledgebase.culture.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "local"}` }),
    healthBps: 10_000,
    prestigeBps: 3_000,
    relations: [],
    ambitions: [],
    heirCharacterId: null,
    alive: true,
    diedAtStep: null,
    disqualifyingStatuses: [],
    birthStep: null,
    nextLifeReviewAtStep: null,
  };

  return {
    ...world,
    characters: [...world.characters, playerCharacter],
    material: {
      ...world.material,
      accounts: existingAccount ? world.material.accounts : [...world.material.accounts, personalAccount],
      accountAccess: world.material.accountAccess.some((access) => access.accountId === accountId && access.characterId === actorCharacterId)
        ? world.material.accountAccess
        : [...world.material.accountAccess, {
          id: `access-${actorCharacterId}`,
          characterId: actorCharacterId,
          accountId,
          permissions: ["view", "propose_spending", "spend_without_vote"],
          sourceKind: "ownership",
          sourceId: actorCharacterId,
        }],
    },
  };
}

/** Derive Chronicle consequences from workflows that actually executed. */
function deriveExecutedWorkflowConsequences(
  auditEntries: readonly WorkflowAuditBlob["candidates"][number][],
  workflowLog: readonly { invocation: ProposedInvocation; outcome: { ok: boolean; result?: { summary: string } } }[],
): NonNullable<ChronicleEntryInput["directConsequences"]> {
  const consequences: NonNullable<ChronicleEntryInput["directConsequences"]> = [];
  for (const entry of auditEntries) {
    const invocation = entry.finalInvocation;
    if (!invocation || entry.executionOk !== true) continue;
    const outcome = workflowLog.find((item) => JSON.stringify(item.invocation) === JSON.stringify(invocation))?.outcome;
    if (!outcome?.ok) continue;
    if (invocation.actionId === "add_gold") {
      const amount = invocation.parameters["amount"];
      consequences.push({
        kind: "material",
        label: `+${String(amount)} gold`,
        entityId: null,
        quantified: true,
      });
    } else if (invocation.actionId === "remove_gold") {
      const amount = invocation.parameters["amount"];
      consequences.push({
        kind: "material",
        label: `-${String(amount)} gold`,
        entityId: null,
        quantified: true,
      });
    } else {
      consequences.push({
        kind: "material",
        label: outcome.result?.summary.slice(0, 120) ?? invocation.actionId,
        entityId: invocation.actorId,
        quantified: false,
      });
    }
  }
  return consequences;
}

interface ChronicleCharacterMention {
  readonly characterId: string;
  readonly role: string;
}

type ChronicleCastByProposal = ReadonlyMap<string, ChronicleCharacterMention>;

/** Maps a 0–10 salience score to the same relevancy tier used for display and visibility ranking. */
function salienceTier(salience: number): "high" | "medium" | "low" {
  return salience >= 8 ? "high" : salience >= 5 ? "medium" : "low";
}

function isPoliticalChronicleEvent(body: string): boolean {
  return /\b(senate|senator|council|assembly|debate|motion|vote|voted|decree|faction|political|diplomat|negotiat|treaty|envoy|delegation|spokesperson|office)\b/i.test(body);
}

function roleForPoliticalBody(body: string): string {
  if (/\b(oppose|opposed|critic|denounce|rival|against|resist)\b/i.test(body)) return "opponent";
  if (/\b(support|backed|defend|endorse)\b/i.test(body)) return "supporter";
  if (/\b(presid|chair|convene)\b/i.test(body)) return "presiding_official";
  if (/\b(treaty|envoy|delegat|negotiat)\b/i.test(body)) return "negotiator";
  return "spokesperson";
}

/** Select an established person when the Director did not explicitly cast one. */
function selectFallbackChronicleCast(
  world: WorldState,
  playerCharacterId: string,
  body: string,
): ChronicleCharacterMention | undefined {
  if (!isPoliticalChronicleEvent(body)) return undefined;
  const player = world.characters.find((character) => character.id === playerCharacterId);
  const namedPolity = world.map.polities.find((polity) => new RegExp(`\\b${polity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body));
  const targetPolityId = namedPolity?.id ?? player?.polityId ?? null;
  const candidates = world.characters
    .filter((character) => character.alive && character.id !== playerCharacterId && (targetPolityId === null || character.polityId === targetPolityId))
    .map((character) => {
      const relevance = (world.characterRelevance ?? []).find((entry) => entry.characterId === character.id);
      const nameMentioned = new RegExp(`\\b${character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body);
      return {
        character,
        score: (nameMentioned ? 500 : 0) + (character.officeId ? 100 : 0) + (relevance?.chronicleAppearances.length ?? 0) * 10,
      };
    })
    .sort((left, right) => right.score - left.score || left.character.id.localeCompare(right.character.id));
  const selected = candidates[0]?.character;
  return selected ? { characterId: selected.id, role: roleForPoliticalBody(body) } : undefined;
}

function proposalCast(
  pkg: ConsolidatedProposalPackage,
  casts: ChronicleCastByProposal,
  source: "reaction_director" | "simulator",
  kind: string,
  rationale: string,
): ChronicleCharacterMention | undefined {
  const proposal = pkg.proposals.find((candidate) =>
    candidate.sources.includes(source) && candidate.kind === kind && candidate.mergedRationale === rationale,
  );
  return proposal ? casts.get(proposal.id) : undefined;
}

function applyChronicleCast(
  input: Omit<ChronicleEntryInput, "sequence">,
  world: WorldState,
  cast: ChronicleCharacterMention | undefined,
  playerCharacterId: string,
): Omit<ChronicleEntryInput, "sequence"> {
  const explicitCharacter = cast
    ? world.characters.find((candidate) => candidate.id === cast.characterId && candidate.alive)
    : undefined;
  const selected = explicitCharacter ? cast : selectFallbackChronicleCast(world, playerCharacterId, input.body);
  if (!selected) return input;
  const character = explicitCharacter ?? world.characters.find((candidate) => candidate.id === selected.characterId && candidate.alive);
  if (!character) return input;
  return {
    ...input,
    // This factual line is also the narrator fallback: if the rewrite call
    // fails, the official Chronicle still identifies the human actor.
    body: `${input.body} Featured figure: ${character.name}, ${selected.role.replace(/_/g, " ")}.`,
    characterMentions: [selected],
  };
}

function buildChronicleEntries(
  world: WorldState,
  verdicts: readonly Verdict[],
  interpretations: readonly OrderInterpretation[],
  characterSuggestions: readonly CharacterSuggestion[],
  approvedCharacterIds: ReadonlySet<string>,
  consolidatedPackage: ConsolidatedProposalPackage,
  chronicleCasts: ChronicleCastByProposal,
  reactionProposals: readonly ReactionProposal[],
  simulatorProposals: readonly SimulatorProposal[],
  workflowLog: readonly { invocation: ProposedInvocation; outcome: { ok: boolean; result?: { summary: string } } }[],
  workflowAudit: WorkflowAuditBlob,
  atStep: number,
  displayPatchByInvocation: Map<string, unknown>,
  playerId: string,
): ChronicleEntryInput[] {
  interface RawEntry {
    sortKey: number;
    simulatedDurationDays: number;
    input: Omit<ChronicleEntryInput, "sequence">;
  }
  const raw: RawEntry[] = [];

  // Player action entries
  for (const verdict of verdicts) {
    const executedWorkflowEntries = workflowAudit.candidates.filter(
      (entry) => entry.source === "player_directive" && entry.sourceRef === verdict.directiveId && entry.executionOk === true,
    );
    const hasExecutedWorkflow = executedWorkflowEntries.length > 0;
    const interpretation = interpretations.find((i) => i.directiveId === verdict.directiveId);
    const body = interpretation
      ? `${interpretation.intent} — ${verdict.rationale}`
      : verdict.rationale;
    raw.push({
      sortKey: 600,
      simulatedDurationDays: estimatePlayerEventDurationDays(verdict),
      input: applyChronicleCast({
        scope: "directive",
        scopeRef: verdict.directiveId,
        audience: verdict.knowledgeVisibility === "private" ? "knowledge_scoped" : "all_players",
        body,
        atStep,
        materialConsequence: hasExecutedWorkflow,
        playerInvolvement: verdict.playerInvolvement,
        directConsequences: deriveExecutedWorkflowConsequences(executedWorkflowEntries, workflowLog),
        sourceDirector: "player",
        chainPosition: "root",
        // The player's own actions are always shown in full, exempt from the
        // Chronicle visibility cap -- see capChronicleVisibility.
        playerRelevance: "high",
      }, world, undefined, playerId),
    });
  }

  // Approved Character Director suggestions are events in their own right.
  // Some make durable goal/plot changes through a workflow; others are
  // intentional, non-material developments such as a changed relationship.
  for (const suggestion of characterSuggestions) {
    if (!approvedCharacterIds.has(suggestion.characterId) || suggestion.salience === 0) continue;
    const character = world.characters.find((candidate) => candidate.id === suggestion.characterId);
    const name = character?.name ?? suggestion.characterId;
    raw.push({
      sortKey: suggestion.salience * 70,
      simulatedDurationDays: 1,
      input: {
        scope: "character_event",
        scopeRef: suggestion.characterId,
        audience: suggestion.visibility === "private" ? "knowledge_scoped" : "all_players",
        body: `${name}: ${suggestion.rationale}`,
        atStep,
        materialConsequence: false,
        sourceDirector: "character_director",
        chainPosition: "pressure",
        characterMentions: [{ characterId: suggestion.characterId, role: "participant" }],
        playerRelevance: salienceTier(suggestion.salience),
      },
    });
  }

  // Reaction Director entries (reaction chain position)
  for (const rp of reactionProposals) {
    if (rp.salience < 4) continue; // skip low-salience background reactions
    const logEntries = rp.proposedWorkflows
      .map((wf) => workflowLog.find((l) => l.invocation.actionId === wf.actionId && l.outcome.ok))
      .filter(Boolean);
    const body = logEntries.length > 0
      ? logEntries.map((l) => l!.outcome.result?.summary ?? "").filter(Boolean).join(". ")
      : `[Reaction] ${rp.reactionKind}: ${rp.rationale.slice(0, 120)}`;
    const cast = proposalCast(consolidatedPackage, chronicleCasts, "reaction_director", rp.reactionKind, rp.rationale);
    raw.push({
      sortKey: rp.salience * 80,
      simulatedDurationDays: estimateWorkflowDurationDays(rp.proposedWorkflows),
      input: applyChronicleCast({
        scope: "reaction",
        scopeRef: rp.reactorId,
        audience: rp.visibility === "private" ? "knowledge_scoped" : "all_players",
        body,
        atStep,
        materialConsequence: logEntries.length > 0,
        sourceDirector: "reaction_director",
        chainPosition: "reaction",
        playerRelevance: salienceTier(rp.salience),
      }, world, cast, playerId),
    });
  }

  // Simulator proposal entries
  for (const [simulatorProposalIndex, sp] of simulatorProposals.entries()) {
    if (sp.salience < 4) continue;
    const logEntries = sp.proposedWorkflows
      .map((wf) => workflowLog.find((l) => l.invocation.actionId === wf.actionId && l.outcome.ok))
      .filter(Boolean);
    const body = logEntries.length > 0
      ? logEntries.map((l) => l!.outcome.result?.summary ?? "").filter(Boolean).join(". ")
      : sp.summary;
    const cast = proposalCast(consolidatedPackage, chronicleCasts, "simulator", sp.kind, sp.summary);
    raw.push({
      sortKey: sp.salience * 60,
      simulatedDurationDays: estimateWorkflowDurationDays(sp.proposedWorkflows),
      input: applyChronicleCast({
        scope: "world_event",
        // Deterministic across replay: derived from step + index rather than
        // a random UUID (character-sim phase 1).
        scopeRef: sp.storylineId ?? `sim-${atStep}-${simulatorProposalIndex}`,
        audience: sp.visibility === "private" ? "knowledge_scoped" : "all_players",
        body,
        atStep,
        materialConsequence: logEntries.length > 0,
        sourceDirector: "simulator",
        chainPosition: sp.scopeTag === "star" || sp.scopeTag === "near" ? "spread" : "distant",
        displayPatch: displayPatchByInvocation.get(sp.proposedWorkflows[0]?.actionId ?? ""),
        playerRelevance: salienceTier(sp.salience),
      }, world, cast, playerId),
    });
  }

  // A reaction is caused by the player's own resolved action and can never
  // chronologically precede it, no matter how the reaction's own estimated
  // duration compares to the player's. Anchor every "reaction" entry to sort
  // after every "root" entry before the shared duration sort below runs.
  const rootDurations = raw.filter((r) => r.input.chainPosition === "root").map((r) => r.simulatedDurationDays);
  const maxRootDuration = rootDurations.length > 0 ? Math.max(...rootDurations) : 0;
  for (const entry of raw) {
    if (entry.input.chainPosition === "reaction" && entry.simulatedDurationDays <= maxRootDuration) {
      entry.simulatedDurationDays = maxRootDuration + entry.simulatedDurationDays;
    }
  }

  // Chronicle chronology is a simulated schedule: quick events resolve first,
  // then longer developments. Salience only breaks ties within a duration.
  raw.sort((a, b) => a.simulatedDurationDays - b.simulatedDurationDays || b.sortKey - a.sortKey);

  // No cap here: every event this turn is returned, tagged with its
  // relevancy tier. Visibility is capped once, later, after every other
  // Chronicle-producing stream (life events, politics, commitments, etc.) is
  // merged in -- see capChronicleVisibility.
  return raw.map((r, i) => ({ ...r.input, sequence: i, simulatedDurationDays: r.simulatedDurationDays }));
}

/**
 * At most `maxVisible` non-player events surface in the Chronicle each turn.
 * Every event already executed and changed world state before this runs --
 * the cap only decides what gets narrated, never what happened. The
 * player's own directive entries are exempt and always shown in full.
 */
// Consequence-free "world color" (diplomatic chatter, background rumor) is
// capped hard regardless of maxVisible, so it can never crowd out the events
// that actually changed something -- it stays in the background, not the
// majority of the turn's Chronicle.
const BACKGROUND_FLAVOR_QUOTA = 3;

function capChronicleVisibility(entries: readonly ChronicleEntryInput[], maxVisible: number): ChronicleEntryInput[] {
  const relevancyWeight = (tier: ChronicleEntryInput["playerRelevance"]): number =>
    tier === "high" ? 3 : tier === "medium" ? 2 : tier === "low" ? 1 : 0;
  const isPlayerAction = (entry: ChronicleEntryInput) => entry.scope === "directive" && entry.sourceDirector === "player";
  const rankByRelevance = (list: readonly ChronicleEntryInput[]) =>
    [...list].sort((a, b) => {
      const weightDiff = relevancyWeight(b.playerRelevance) - relevancyWeight(a.playerRelevance);
      if (weightDiff !== 0) return weightDiff;
      return (a.simulatedDurationDays ?? 1) - (b.simulatedDurationDays ?? 1);
    });

  const alwaysShown = entries.filter(isPlayerAction);
  const rest = entries.filter((entry) => !isPlayerAction(entry));
  // Every entry that actually changed world state earns its place on its own
  // merit -- it is never traded away for background flavor. Only
  // consequence-free color competes for the small remaining quota.
  const material = rankByRelevance(rest.filter((entry) => entry.materialConsequence));
  const flavor = rankByRelevance(rest.filter((entry) => !entry.materialConsequence));
  const flavorBudget = Math.min(BACKGROUND_FLAVOR_QUOTA, Math.max(0, maxVisible - material.length));

  return [...alwaysShown, ...material, ...flavor.slice(0, flavorBudget)];
}

function estimatePlayerEventDurationDays(verdict: Verdict): number {
  return Math.max(1, verdict.timeCost.max * 30);
}

function estimateWorkflowDurationDays(workflows: readonly Pick<ProposedInvocation, "actionId">[]): number {
  const actionDays: Record<string, number> = {
    add_gold: 1,
    remove_gold: 1,
    transfer_gold: 1,
    appoint_to_office: 2,
    remove_from_office: 2,
    raise_morale: 2,
    lower_morale: 2,
    move_character: 4,
    create_force: 7,
    move_force: 14,
    start_battle: 14,
    end_battle: 14,
    sign_treaty: 21,
    start_siege: 30,
    end_siege: 30,
    start_war: 45,
    end_war: 45,
    give_territory: 45,
    change_province_control: 45,
  };
  return Math.max(1, ...workflows.map((workflow) => actionDays[workflow.actionId] ?? 7));
}

function scheduleChronicleEntries(entries: readonly ChronicleEntryInput[]): ChronicleEntryInput[] {
  return [...entries]
    .sort((a, b) => (a.simulatedDurationDays ?? 1) - (b.simulatedDurationDays ?? 1) || a.sequence - b.sequence)
    .map((entry, sequence) => ({ ...entry, sequence }));
}

/**
 * Preserve a bounded factual brief with the world snapshot. Chronicle prose is
 * already derived from committed resolution output, so this is intentionally
 * deterministic rather than a separate AI call that could introduce facts.
 */
function summarizeResolvedTurn(entries: readonly ChronicleEntryInput[], atStep: number): string {
  const header = `Turn ${atStep} resolved:`;
  const remaining = 1_800 - header.length - 1;
  if (entries.length === 0) return `${header} no Chronicle-worthy events occurred.`;

  let used = 0;
  const bullets: string[] = [];
  for (const entry of entries) {
    const body = entry.body.replace(/\s+/g, " ").trim();
    if (body.length === 0 || used >= remaining) continue;
    const available = remaining - used;
    const line = `- ${body.length > available - 2 ? `${body.slice(0, Math.max(0, available - 3)).trimEnd()}…` : body}`;
    if (line.length <= 2) break;
    bullets.push(line);
    used += line.length + 1;
  }

  return bullets.length > 0 ? `${header}\n${bullets.join("\n")}` : `${header} no Chronicle-worthy events occurred.`;
}

/**
 * A storyline about contested control of a province is settled the instant
 * that province's controller changes -- independent of whether any director
 * remembered to call `resolve_storyline`. Leaving it open feeds next turn's
 * Simulator a storyline that still describes an already-decided conflict as
 * live, which is how a captured province keeps getting narrated as contested.
 */
function autoResolveDecidedStorylines(before: WorldState, after: WorldState, atStep: number): WorldState {
  if (!after.storylines || after.storylines.length === 0) return after;

  const changedProvinceControllers = new Map<string, string | null>();
  for (const beforeProvince of before.map.provinces) {
    const afterProvince = after.map.provinces.find((p) => p.id === beforeProvince.id);
    if (afterProvince && afterProvince.controllerPolityId !== beforeProvince.controllerPolityId) {
      changedProvinceControllers.set(beforeProvince.id, afterProvince.controllerPolityId);
    }
  }
  if (changedProvinceControllers.size === 0) return after;

  const polityName = (id: string | null) => id === null ? "no one" : after.map.polities.find((p) => p.id === id)?.name ?? id;
  const provinceName = (id: string) => after.map.provinces.find((p) => p.id === id)?.name ?? id;

  let resolvedAny = false;
  const storylines = after.storylines.map((storyline) => {
    if (storyline.phase === "resolved" || storyline.provinceId === null || !changedProvinceControllers.has(storyline.provinceId)) {
      return storyline;
    }
    resolvedAny = true;
    const newController = changedProvinceControllers.get(storyline.provinceId) ?? null;
    console.log(`${tag()} [storyline:auto-resolve] "${storyline.title}" — ${provinceName(storyline.provinceId)} now controlled by ${polityName(newController)}`);
    return {
      ...storyline,
      phase: "resolved",
      nextDevelopment: "",
      history: [...storyline.history, `Control of ${provinceName(storyline.provinceId)} passed to ${polityName(newController)}, settling this storyline.`].slice(-24),
      updatedAtStep: atStep,
    };
  });
  return resolvedAny ? { ...after, storylines } : after;
}

/** Build a displayPatch from world-state diff for map-relevant changes. */
function buildDisplayPatch(before: WorldState, after: WorldState): unknown {
  const patches: Record<string, unknown>[] = [];
  for (const pBefore of before.map.provinces) {
    const pAfter = after.map.provinces.find((p) => p.id === pBefore.id);
    if (!pAfter) continue;
    if (pBefore.controllerPolityId !== pAfter.controllerPolityId) {
      patches.push({ kind: "province_control", provinceId: pBefore.id, newControllerPolityId: pAfter.controllerPolityId });
    }
  }
  for (const fBefore of before.material.forces) {
    const fAfter = after.material.forces.find((f) => f.id === fBefore.id);
    if (!fAfter) continue;
    if (fBefore.locationId !== fAfter.locationId) {
      patches.push({ kind: "force_moved", forceId: fBefore.id, newLocationId: fAfter.locationId });
    }
  }
  return patches.length > 0 ? patches : undefined;
}

export interface ResolveTurnInput {
  readonly gameId: string;
  readonly turnId: string;
  readonly world: WorldState;
  readonly batch: OrderBatch;
  readonly actorCharacterId: string;
  readonly playerId: string;
  /** Scenario clock/life/government rules (character-sim phase 5), when available. Absent -- no automatic life events. */
  readonly scenarioClock?: ScenarioClock | undefined;
  readonly scenarioLife?: ScenarioLifeRules | undefined;
  readonly scenarioGovernment?: ScenarioGovernmentRules | undefined;
}

export async function resolveTurn(
  db: ChronicaDatabase,
  adapter: AiAdapter,
  input: ResolveTurnInput,
  onProgress: ProgressCallback,
): Promise<ResolveTurnResult> {
  const { gameId, turnId, world, batch, actorCharacterId, playerId } = input;
  _logTurnId = turnId;

  const claimed = await claimTurnForResolution(db, turnId);
  if (!claimed) return { workflowDownloads: [] };

  try {
    const payerUserId = await getGamePayerUserId(db, gameId);
    if (payerUserId === undefined) throw new Error("Game payer not found for resolution.");
    const coinGatedAdapter: AiAdapter = {
      call: (operation, systemPrompt, userMessage) => callWithCoinGate(
        db, payerUserId, gameId, operation, adapter, { system: systemPrompt, user: userMessage },
      ),
    };
    const playerKnowledgebase = await getCharacterKnowledgebase(db, gameId, playerId).catch(() => null);
    const pendingCommitments = await listPendingNpcCommitments(db, gameId);
    const activeInventedWorkflows = await listActiveInventedWorkflows(db, gameId);
    const resolutionContext: ResolutionPlayerContext = { knowledgebase: playerKnowledgebase, pendingCommitments };
    const materializedWorld = materializePlayerCharacter(world, actorCharacterId, playerKnowledgebase);

    // ── Step 0: Apply pending dialogue social events ────────────────────────
    //
    // The chat/simulation boundary (character-sim phase 1): dialogue can only
    // ever propose a CharacterSocialEvent, never mutate a Character directly.
    // Turn resolution is the sole authority that validates every reference
    // against canonical state and applies the deterministic deltas, so a
    // dialogue insult, a promise, or a discovered NPC only ever becomes real
    // through the same committed-turn path every other world mutation uses.
    const pendingSocialEvents = await listUnappliedCharacterSocialEvents(db, gameId);
    const socialEventOutcome = applySocialEvents(
      materializedWorld,
      pendingSocialEvents,
      materializedWorld.elapsedStep + 1,
      turnId,
    );
    // Character-sim phase 2: pressure review/decay/expiry runs before
    // character selection, so a stale or spent pressure never shapes this
    // turn's Character Director context.
    const pressureAdvanced = advancePressureLifecycle(socialEventOutcome.world, materializedWorld.elapsedStep + 1);
    const resolutionWorld: WorldState = {
      ...socialEventOutcome.world,
      characters: [...pressureAdvanced.characters],
      characterPressures: [...pressureAdvanced.characterPressures],
    };
    const actor = resolutionWorld.characters.find((character) => character.id === actorCharacterId)!;
    console.log(
      `${tag()} ══ RESOLUTION START ══ gameId=${gameId} actor="${actor.name}" step=${resolutionWorld.elapsedStep} directives=${batch.directives.length} storylines=${(resolutionWorld.storylines ?? []).length} characters=${resolutionWorld.characters.filter((character) => character.alive).length}`,
    );

    // ── Step 1: Interpret ──────────────────────────────────────────────────
    emit(onProgress, "interpret");
    console.log(`${tag()} [interpret] IN: ${batch.directives.length} directive(s)`);
    const interpretations: OrderInterpretation[] = [];
    const systemPrompt = buildInterpretSystemPrompt(resolutionWorld, actorCharacterId, resolutionContext);

    for (const [idx, directive] of batch.directives.entries()) {
      if (directive.kind !== "new" && directive.kind !== "revise") continue;
      const userMsg = `Order ${idx + 1}: ${directive.text}\nDirective ID: directive-${idx}`;
      try {
        const result = await coinGatedAdapter.call("interpret_order", systemPrompt, userMsg);
        let interpretContent = result.content;
        try {
          interpretContent = normalizeInterpretationContent(interpretContent);
        } catch { /* preserve the original response for normal parse diagnostics */ }
        const parsed = safeParseJson(interpretContent, InterpretParseSchema, `interpret:directive-${idx}`);
        if (parsed) {
          interpretations.push({ ...parsed, directiveId: `directive-${idx}` });
        } else {
          interpretations.push({
            directiveId: `directive-${idx}`,
            intent: directive.text,
            targetIds: [],
            priorities: [],
            conditions: [],
            proposedSteps: ["Execute the order as stated."],
            risks: ["Outcome uncertain — order could not be fully parsed."],
            duration: { min: 1, max: 2 },
          });
        }
      } catch (err) {
        console.error(`${tag()} [interpret:error] directive-${idx}:`, err);
        interpretations.push({
          directiveId: `directive-${idx}`,
          intent: directive.text,
          targetIds: [],
          priorities: [],
          conditions: [],
          proposedSteps: ["Execute the order as stated."],
          risks: ["AI interpretation failed."],
          duration: { min: 1, max: 2 },
        });
      }
    }
    console.log(`${tag()} [interpret] OUT: ${interpretations.length} interpretation(s) — ${interpretations.map((i) => `"${i.intent.slice(0, 60)}"`).join(", ")}`);
    emit(onProgress, "interpret", true);

    // ── Step 2: Assess ─────────────────────────────────────────────────────
    emit(onProgress, "assess");
    console.log(`${tag()} [assess] IN: ${interpretations.length} interpretation(s)`);
    const assessments: OrderAssessment[] = [];
    const assessSystemPrompt = buildAssessSystemPrompt(resolutionWorld, actorCharacterId, resolutionContext, activeInventedWorkflows);

    for (const interpretation of interpretations) {
      const userMsg = `Directive: ${interpretation.intent}\nProposed steps: ${interpretation.proposedSteps.join("; ")}\nRisks: ${interpretation.risks.join("; ")}`;
      try {
        const result = await coinGatedAdapter.call("assess_orders", assessSystemPrompt, userMsg);
        let assessContent = result.content;
        try {
          assessContent = normalizeAssessmentContent(assessContent);
        } catch { /* preserve the original response for normal parse diagnostics */ }
        const parsed = safeParseJson(assessContent, AssessParseSchema, `assess:${interpretation.directiveId}`);
        if (parsed) {
          assessments.push({ ...parsed, directiveId: interpretation.directiveId });
        } else {
          assessments.push({
            directiveId: interpretation.directiveId,
            interpretation: interpretation.intent,
            feasibility: "uncertain",
            obstacleIds: [],
            dependencyActionIds: [],
            estimatedSteps: interpretation.duration,
            workflow: null,
            workflows: [],
            needsAdjudication: true,
          });
        }
      } catch (err) {
        console.error(`${tag()} [assess:error] ${interpretation.directiveId}:`, err);
        assessments.push({
          directiveId: interpretation.directiveId,
          interpretation: interpretation.intent,
          feasibility: "uncertain",
          obstacleIds: [],
          dependencyActionIds: [],
          estimatedSteps: interpretation.duration,
          workflow: null,
          workflows: [],
          needsAdjudication: true,
        });
      }
    }
    console.log(`${tag()} [assess] OUT: ${assessments.length} assessment(s) — ${assessments.map((a) => `${a.directiveId}:${a.feasibility}${assessmentWorkflows(a).length > 0 ? `+wf(${assessmentWorkflows(a).map((workflow) => workflow.actionId).join("+")})` : ""}`).join(", ")}`);
    emit(onProgress, "assess", true);

    // ── Step 3: Adjudicate ─────────────────────────────────────────────────
    emit(onProgress, "adjudicate");
    console.log(`${tag()} [adjudicate] IN: ${assessments.length} assessment(s)`);
    const verdicts: Verdict[] = [];
    const adjSystemPrompt = buildAdjudicateSystemPrompt(resolutionWorld, actorCharacterId, resolutionContext, activeInventedWorkflows);

    // Admin directives are GM commands wrapped in [brackets]. They bypass all
    // feasibility filtering and must always produce a world-state change.
    const adminDirectiveIds = new Set<string>();
    for (const [idx, directive] of batch.directives.entries()) {
      if ((directive.kind === "new" || directive.kind === "revise") && /^\s*\[.*\]\s*$/.test(directive.text)) {
        adminDirectiveIds.add(`directive-${idx}`);
        console.log(`${tag()} [adjudicate] directive-${idx} flagged as admin command`);
      }
    }

    for (const assessment of assessments) {
      const isAdmin = adminDirectiveIds.has(assessment.directiveId);
      const userMsg = `Order: ${assessment.interpretation}\nFeasibility: ${assessment.feasibility}\nWorkflow hints: ${JSON.stringify(assessmentWorkflows(assessment))}\nNeeds adjudication: ${assessment.needsAdjudication}`;

      // Extracted parse-and-repair logic so it can run on both the first attempt
      // and a single retry without duplicating the repair / income-injection code.
      const parseAdjudicationContent = (content: string): Verdict | null => {
        let adjContent = content;
        try {
          const raw = JSON.parse(stripToJson(adjContent)) as Record<string, unknown>;
          if (raw && typeof raw === "object") {
            // Visibility determines who can learn an outcome. A malformed model
            // value must never make an outcome more broadly visible, so repair it
            // to the most restrictive valid value before schema validation.
            if (typeof raw["knowledgeVisibility"] !== "string" || !VALID_KNOWLEDGE_VISIBILITIES.has(raw["knowledgeVisibility"])) {
              console.warn(`${tag()} [adjudicate] invalid knowledgeVisibility; defaulting to private`);
              raw["knowledgeVisibility"] = "private";
            }
          }
          if (raw && typeof raw === "object" && Array.isArray(raw["deltas"])) {
            const VALID_DELTA_KINDS = new Set(["material_effect", "relationship_cause", "knowledge_grant", "workflow"]);
            raw["deltas"] = (raw["deltas"] as Record<string, unknown>[]).filter((delta) => {
              if (typeof delta["kind"] !== "string" || !VALID_DELTA_KINDS.has(delta["kind"])) return false;
              return true;
            });
            for (const delta of raw["deltas"] as Record<string, unknown>[]) {
              if (delta["kind"] === "workflow" && delta["invocation"] && typeof delta["invocation"] === "object") {
                const inv = delta["invocation"] as Record<string, unknown>;
                if (inv["actorId"] === null || inv["actorId"] === undefined) {
                  inv["actorId"] = actorCharacterId;
                }
              }
            }
          }
          if (raw && typeof raw === "object") adjContent = JSON.stringify(raw);
        } catch { /* leave adjContent as-is */ }

        const parsed = safeParseJson(adjContent, VerdictParseSchema, `adjudicate:${assessment.directiveId}`);
        if (!parsed) return null;

        let finalDeltas: StateDelta[] = parsed.deltas;

        // Income repair: inject add_gold when economic order has no workflow delta
        const ECONOMIC_INCOME_RE = /\b(sell|sold|trade|earn|income|profit|wares|goods|cargo|merchandise|revenue|payment|receive|collect|spoils)\b/i;
        const hasWorkflowDelta = finalDeltas.some((d) => d.kind === "workflow");
        const isPositiveOutcome = parsed.outcome === "succeeds" || parsed.outcome === "partially_succeeds";
        if (!hasWorkflowDelta && isPositiveOutcome && ECONOMIC_INCOME_RE.test(assessment.interpretation)) {
          const actorAccount = resolutionWorld.material.accounts.find(
            (a) => a.owner.kind === "character" && a.owner.id === actorCharacterId && a.status === "active",
          );
          if (actorAccount) {
            const hasMeaningful = finalDeltas.some((d) => d.kind === "material_effect" && d.effect.magnitude === "meaningful");
            finalDeltas = [
              ...finalDeltas,
              {
                kind: "workflow",
                invocation: {
                  actionId: "add_gold",
                  actorId: actorCharacterId,
                  parameters: { accountId: actorAccount.id, amount: hasMeaningful ? 200 : 50, reason: assessment.interpretation.slice(0, 240) },
                },
              },
            ];
          }
        }

        // Visibility floor: capturing territory or going to war cannot stay a
        // secret, no matter how "uncertain, so default to private" guidance in
        // the adjudicate prompt was applied. A private verdict here silently
        // disables the Reaction Director (see shouldRunReactionDirector) and
        // Carthage never hears that Messana fell.
        let knowledgeVisibility = parsed.knowledgeVisibility;
        const hasPubliclyVisibleWorkflow = finalDeltas.some(
          (delta) => delta.kind === "workflow" && PUBLICLY_VISIBLE_ACTIONS.has(delta.invocation.actionId),
        );
        if (hasPubliclyVisibleWorkflow && knowledgeVisibility === "private") {
          console.warn(`${tag()} [adjudicate] ${assessment.directiveId}: forcing knowledgeVisibility to public — territory/war/battle outcomes cannot stay private`);
          knowledgeVisibility = "public";
        }

        return {
          ...parsed,
          knowledgeVisibility,
          deltas: finalDeltas,
          directiveId: assessment.directiveId,
          playerInvolvement: [{ playerId, characterId: actorCharacterId, role: "actor" }],
        };
      };

      let verdict: Verdict | null = null;
      let retryReason: string | null = null;

      try {
        const result = await coinGatedAdapter.call("adjudicate", adjSystemPrompt, userMsg);
        verdict = parseAdjudicationContent(result.content);
        if (!verdict) {
          retryReason = "Previous response could not be parsed as a valid verdict. Please return valid JSON.";
        } else {
          const isPositive = verdict.outcome === "succeeds" || verdict.outcome === "partially_succeeds";
          const hasWorkflows = verdict.deltas.some((d) => d.kind === "workflow");
          const hasHints = assessmentWorkflows(assessment).length > 0;
          // Semantic failure A: the model said the order succeeds but produced no
          // workflow to actually implement it. Force a retry with an explicit
          // instruction so the model fills in the missing workflow delta(s).
          // Always retry — even when assess produced no hints, the adjudicator
          // is responsible for selecting the correct workflow from the catalog.
          if (isPositive && !hasWorkflows) {
            console.warn(`${tag()} [adjudicate] ${assessment.directiveId}${isAdmin ? " [ADMIN]" : ""}: positive outcome but no workflow deltas — retrying`);
            const hintSuggestion = hasHints
              ? ` The assess step suggested: ${assessmentWorkflows(assessment).map((w) => w.actionId).join(", ")}.`
              : "";
            const adminNote = isAdmin ? " This is a GM/admin command — it MUST produce at least one workflow delta." : "";
            retryReason = `Your verdict says the order "${assessment.interpretation.slice(0, 120)}" ${verdict.outcome}, but you did not include any workflow delta to implement the change in world state.${hintSuggestion}${adminNote} You MUST include at least one workflow delta (e.g. create_force, add_gold, move_force, change_province_control, start_war) that concretely changes the world. Return the complete verdict JSON again with the workflow delta(s) included.\n\n${userMsg}`;
            verdict = null;
          }

          // Semantic failure B: the model overrode a feasible assessment with
          // "impossible", OR it's an admin command (which can never be impossible).
          // Retry and ask it to reconsider.
          else if (
            verdict.outcome === "impossible" &&
            (isAdmin || (assessment.feasibility === "feasible" || assessment.feasibility === "conditional"))
          ) {
            console.warn(`${tag()} [adjudicate] ${assessment.directiveId}${isAdmin ? " [ADMIN]" : ""}: impossible verdict — retrying`);
            const adminNote = isAdmin
              ? "This is a GM/admin command wrapped in []. Admin commands MUST always succeed. Return \"succeeds\" with the appropriate workflow delta(s)."
              : `The assessment step determined this order is ${assessment.feasibility} and suggested workflow(s): ${assessmentWorkflows(assessment).map((w) => w.actionId).join(", ")}. Please reconsider — only rule an order impossible if there is a concrete, insurmountable world-state constraint.`;
            retryReason = `${adminNote} If the order can be at least partially executed, return "partially_succeeds" with the appropriate workflow delta(s). Return the complete verdict JSON again.\n\n${userMsg}`;
            verdict = null;
          }
        }
      } catch (err) {
        console.error(`${tag()} [adjudicate:error] ${assessment.directiveId}:`, err);
        retryReason = `[RETRY] Previous attempt failed with error: ${String(err).slice(0, 200)}. Please try again.\n\n${userMsg}`;
      }

      if (verdict === null && retryReason !== null) {
        try {
          const retry = await coinGatedAdapter.call("adjudicate", adjSystemPrompt, retryReason);
          verdict = parseAdjudicationContent(retry.content);
        } catch (retryErr) {
          console.error(`${tag()} [adjudicate:retry-error] ${assessment.directiveId}:`, retryErr);
        }
      }

      // Hard fallback after retry: use assessment workflow hints to ensure the
      // order produces some world change, regardless of what the model returned.
      // Admin commands always override impossible verdicts even without hints.
      if (verdict) {
        const hasWorkflowsNow = verdict.deltas.some((d) => d.kind === "workflow");
        const isPositiveNow = verdict.outcome === "succeeds" || verdict.outcome === "partially_succeeds";
        const isImpossibleOverride =
          verdict.outcome === "impossible" &&
          (isAdmin || assessment.feasibility === "feasible" || assessment.feasibility === "conditional");
        const hintDeltas = assessmentWorkflows(assessment).map((wf) => ({
          kind: "workflow" as const,
          invocation: { actionId: wf.actionId, actorId: actorCharacterId, parameters: wf.parameters },
        }));
        if (isPositiveNow && !hasWorkflowsNow && hintDeltas.length > 0) {
          console.warn(`${tag()} [adjudicate] ${assessment.directiveId}: still no workflows after retry — injecting ${hintDeltas.length} assessment hint(s)`);
          verdict = { ...verdict, deltas: [...verdict.deltas, ...hintDeltas] };
        } else if (isImpossibleOverride) {
          if (hintDeltas.length > 0) {
            console.warn(`${tag()} [adjudicate] ${assessment.directiveId}: still impossible after retry — overriding to partially_succeeds with ${hintDeltas.length} hint(s)`);
            verdict = { ...verdict, outcome: "partially_succeeds", deltas: [...verdict.deltas, ...hintDeltas] };
          } else if (isAdmin) {
            // Admin with no assess hints: keep the positive outcome at minimum — a
            // chronicled acknowledgement is better than a silent impossible.
            console.warn(`${tag()} [adjudicate] ${assessment.directiveId} [ADMIN]: impossible with no hints — overriding to partially_succeeds`);
            verdict = { ...verdict, outcome: "partially_succeeds" };
          }
        }
      }

      if (verdict) {
        verdicts.push(verdict);
      } else {
        // Fallback: use whatever workflow hints the assess step provided.
        // This always yields at least an attempt rather than a hard zero-delta fail.
        const fallbackDeltas = assessmentWorkflows(assessment).map((workflow) => ({
          kind: "workflow" as const,
          invocation: { actionId: workflow.actionId, actorId: actorCharacterId, parameters: workflow.parameters },
        }));
        verdicts.push({
          directiveId: assessment.directiveId,
          outcome: assessment.feasibility === "impossible" ? "fails" : "partially_succeeds",
          obstacles: [{ source: "Unknown", weight: "trivial", reason: "Could not fully determine outcome." }],
          deltas: fallbackDeltas,
          tacticalModifiers: [],
          timeCost: assessment.estimatedSteps.min > 0 ? assessment.estimatedSteps : { min: 1, max: 1 },
          rationale: `${assessment.interpretation} — outcome uncertain.`,
          knowledgeVisibility: "polity",
          playerInvolvement: [{ playerId, characterId: actorCharacterId, role: "actor" }],
        });
      }
    }
    for (const v of verdicts) {
      const wfDeltas = v.deltas.filter((d) => d.kind === "workflow");
      console.log(`${tag()} [adjudicate] ${v.directiveId}: outcome=${v.outcome} deltas=${v.deltas.length} workflows=${wfDeltas.length}${wfDeltas.length > 0 ? ` (${wfDeltas.map((d) => d.kind === "workflow" ? d.invocation.actionId : "").join(",")})` : ""}`);
    }
    console.log(`${tag()} [adjudicate] OUT: ${verdicts.length} verdict(s)`);
    emit(onProgress, "adjudicate", true);

    // ── Step 4: Preview player workflows ──────────────────────────────────
    // This world is only director context. No player workflow is committed
    // until the final Workflow Manager reviews the complete turn batch.
    emit(onProgress, "preview_player");
    const atStep = resolutionWorld.elapsedStep + 1;
    console.log(`${tag()} [preview_player] IN: atStep=${atStep}`);
    const playerCandidates = collectPlayerCandidates(verdicts);
    const worldAfterPlayer = previewPlayerWorkflows(resolutionWorld, playerCandidates, atStep, activeInventedWorkflows);
    console.log(`${tag()} [preview_player] OUT: ${playerCandidates.length} candidate(s) previewed without persistence`);
    emit(onProgress, "preview_player", true);

    // ── Steps 5–7: Reaction Director, Simulator, Character Director (parallel) ──
    // These all run on worldAfterPlayer — post player-execution snapshot.

    // Hoisted so the character-agency intent phase (after World Director) can
    // reuse the same bounded, deterministic working set the Character
    // Director advised on -- selection happens once per turn, not twice.
    const selectedCharacters: SelectedCharacter[] = selectRelevantCharacters(
      worldAfterPlayer,
      actorCharacterId,
      undefined,
      pendingCommitments.map((commitment) => commitment.npcCharacterId),
    );

    const runReaction = async (): Promise<ReactionProposal[]> => {
      const proposals: ReactionProposal[] = [];
      const shouldReact = shouldRunReactionDirector(verdicts);
      console.log(`${tag()} [reaction] IN: shouldRun=${shouldReact} verdicts=${verdicts.length}`);
      if (shouldReact) {
        try {
          const reactionPrompt = buildReactionDirectorSystemPrompt(worldAfterPlayer, verdicts, actorCharacterId, resolutionContext, activeInventedWorkflows);
          const reactionResult = await coinGatedAdapter.call("reaction_director", reactionPrompt, `Step ${atStep}: generate reactions.`);
          const reactionParsed = safeParseJson(reactionResult.content, ReactionProposalBatchSchema, "reaction_director");
          if (reactionParsed) proposals.push(...reactionParsed.proposals);
        } catch (err) {
          console.error(`${tag()} [reaction:error]`, err);
        }
      }
      console.log(`${tag()} [reaction] OUT: ${proposals.length} proposal(s) — ${proposals.map((p) => `${p.reactionKind}(sal:${p.salience})`).join(", ") || "none"}`);
      return proposals;
    };

    const runSimulator = async (): Promise<SimulatorProposal[]> => {
      const proposals: SimulatorProposal[] = [];
      try {
        const scope = inferTheatre(worldAfterPlayer, actorCharacterId);
        console.log(`${tag()} [simulate] IN: star=${scope.star.size} near=${scope.near.size} far=${scope.far.size} coarse=${scope.coarse.size} storylines=${(worldAfterPlayer.storylines ?? []).length}`);
        const simPrompt = buildSimulatorSystemPrompt(worldAfterPlayer, scope, actorCharacterId, resolutionContext, activeInventedWorkflows);
        const simResult = await coinGatedAdapter.call("simulator", simPrompt, `Step ${atStep}: simulate the world.`);
        let simContent = simResult.content;
        try {
          simContent = sanitizeSimulatorContent(simContent, worldAfterPlayer);
        } catch { /* preserve the original response for normal parse diagnostics */ }
        const simParsed = safeParseJson(simContent, SimulatorProposalBatchSchema, "simulator");
        if (simParsed) proposals.push(...simParsed.proposals);
      } catch (err) {
        console.error(`${tag()} [simulate:error]`, err);
      }
      console.log(`${tag()} [simulate] OUT: ${proposals.length} proposal(s) — ${proposals.map((p) => `${p.kind}(scope:${p.scopeTag},sal:${p.salience})`).join(", ") || "none"}`);
      return proposals;
    };

    const runCharacterDirector = async (): Promise<CharacterSuggestion[]> => {
      const suggestions: CharacterSuggestion[] = [];
      console.log(`${tag()} [character_advise] IN: selectedCharacters=${selectedCharacters.length} — ${selectedCharacters.map((sc) => `${sc.characterId}(tier:${sc.tier})`).join(", ") || "none"}`);
      if (selectedCharacters.length > 0) {
        try {
          const charPrompt = buildCharacterDirectorSystemPrompt(worldAfterPlayer, selectedCharacters, actorCharacterId, resolutionContext);
          const charResult = await coinGatedAdapter.call("character_director", charPrompt, `Step ${atStep}: advise on ${selectedCharacters.length} character(s).`);
          const charParsed = safeParseJson(charResult.content, CharacterSuggestionBatchSchema, "character_director");
          if (charParsed) {
            for (const suggestion of charParsed.suggestions) {
              const isSelected = selectedCharacters.some((sc) => sc.characterId === suggestion.characterId);
              const isAlive = worldAfterPlayer.characters.find((c) => c.id === suggestion.characterId)?.alive ?? false;
              if (isSelected && isAlive) suggestions.push(suggestion);
            }
          }
        } catch (err) {
          console.error(`${tag()} [character_advise:error]`, err);
        }
      }
      console.log(`${tag()} [character_advise] OUT: ${suggestions.length} suggestion(s) — ${suggestions.map((s) => `${s.characterId}:${s.suggestionKind}(sal:${s.salience})`).join(", ") || "none"}`);
      return suggestions;
    };

    emit(onProgress, "reaction");
    emit(onProgress, "simulate");
    emit(onProgress, "character_advise");
    const [reactionProposals, simulatorProposals, characterSuggestions] = await Promise.all([
      runReaction(),
      runSimulator(),
      runCharacterDirector(),
    ]);
    emit(onProgress, "reaction", true);
    emit(onProgress, "simulate", true);
    emit(onProgress, "character_advise", true);

    // ── Step 8: Consolidate ────────────────────────────────────────────────
    emit(onProgress, "consolidate");
    console.log(`${tag()} [consolidate] IN: reaction=${reactionProposals.length} sim=${simulatorProposals.length} char=${characterSuggestions.length}`);
    const consolidatedPackage = consolidateProposals(characterSuggestions, reactionProposals, simulatorProposals);
    console.log(`${tag()} [consolidate] OUT: ${consolidatedPackage.proposals.length} proposals totalSalience=${consolidatedPackage.totalSalience} conflicts=${consolidatedPackage.conflicts.length}`);
    if (consolidatedPackage.conflicts.length > 0) {
      for (const c of consolidatedPackage.conflicts) {
        console.warn(`${tag()} [consolidate:conflict] ${c.description}`);
      }
    }
    emit(onProgress, "consolidate", true);

    // ── Step 9: World Director ─────────────────────────────────────────────
    emit(onProgress, "world_direct");
    console.log(`${tag()} [world_direct] IN: ${consolidatedPackage.proposals.length} proposals openChains=${(worldAfterPlayer.chronicleChains ?? []).filter((c) => !c.resolved).length}`);
    const worldDirectorInvocations: Array<{ invocation: ProposedInvocation; sourceRef: string; sourceRationale: string }> = [];
    const approvedCharacterIds = new Set<string>();
    const chronicleCasts = new Map<string, ChronicleCharacterMention>();
    try {
      const wdPrompt = buildWorldDirectorSystemPrompt(worldAfterPlayer, consolidatedPackage, actorCharacterId, resolutionContext, activeInventedWorkflows);
      const wdResult = await coinGatedAdapter.call("world_director", wdPrompt, `Step ${atStep}: decide on ${consolidatedPackage.proposals.length} proposal(s).`);
      let wdContent = wdResult.content;
      try {
        wdContent = sanitizeWorldDirectorContent(wdContent, consolidatedPackage);
      } catch { /* retain the original response for normal parse diagnostics */ }
      const wdParsed = safeParseJson(wdContent, WorldDirectorDecisionBatchSchema, "world_director");
      if (wdParsed) {
        const decisions = wdParsed.decisions;
        for (const decision of decisions) {
          const wfs = decision.finalWorkflows.length;
          console.log(`${tag()} [world_direct] proposal=${decision.proposalId} → ${decision.decision} wfs=${wfs}${wfs > 0 ? ` (${decision.finalWorkflows.map((w) => w.actionId).join(",")})` : ""}`);
          if (decision.decision === "approve" || decision.decision === "modify") {
            const proposal = consolidatedPackage.proposals.find((candidate) => candidate.id === decision.proposalId);
            if (proposal?.sources.includes("character_director") && proposal.characterId) {
              approvedCharacterIds.add(proposal.characterId);
            }
            if (proposal && decision.chronicleCast?.characterId) {
              const castCharacter = worldAfterPlayer.characters.find((character) => character.id === decision.chronicleCast?.characterId && character.alive);
              if (castCharacter) {
                chronicleCasts.set(proposal.id, { characterId: castCharacter.id, role: decision.chronicleCast.role });
              }
            } else if (proposal && decision.chronicleCast?.newCharacter) {
              // Deterministic across replay: derived from the proposal id and
              // step rather than a random UUID (character-sim phase 1).
              const createdCharacterId = `char-cast-${atStep}-${proposal.id.slice(0, 12)}`;
              const created = decision.chronicleCast.newCharacter;
              chronicleCasts.set(proposal.id, { characterId: createdCharacterId, role: decision.chronicleCast.role });
              worldDirectorInvocations.push({
                invocation: {
                  actionId: "create_world_character",
                  actorId: actorCharacterId,
                  parameters: {
                    characterId: createdCharacterId,
                    name: created.name,
                    polityId: created.polityId,
                    locationProvinceId: created.locationProvinceId,
                    officeId: created.officeId,
                    provenance: {
                      reason: `Chronicle casting for ${proposal.kind}: ${proposal.mergedRationale}`.slice(0, 320),
                      storylineId: proposal.dedupeGroup ?? null,
                      createdByDirector: true,
                    },
                  },
                },
                sourceRef: proposal.id,
                sourceRationale: `Chronicle casting introduces ${created.name} as ${decision.chronicleCast.role} for a political event.`,
              });
            }
            for (const invocation of decision.finalWorkflows) {
              worldDirectorInvocations.push({
                invocation,
                sourceRef: decision.proposalId,
                sourceRationale: `${proposal?.mergedRationale ?? "World Director proposal"} ${decision.rationale}`.slice(0, 400),
              });
            }
          }
        }
        const approved = decisions.filter((d) => d.decision === "approve" || d.decision === "modify").length;
        const rejected = decisions.filter((d) => d.decision === "reject").length;
        const deferred = decisions.filter((d) => d.decision === "defer").length;
        console.log(`${tag()} [world_direct] OUT: approved=${approved} rejected=${rejected} deferred=${deferred} totalInvocations=${worldDirectorInvocations.length}`);
      }
    } catch (err) {
      console.error(`${tag()} [world_direct:error]`, err);
    }
    emit(onProgress, "world_direct", true);

    // ── Step 9.4: Life review — aging, health, incapacity, death (character-sim phase 5) ──
    //
    // Deterministic and rules-backed, never AI-proposed: a due character's
    // life stage and the scenario's own authored rates (default 0 — no rates
    // authored means no automatic life events) decide the roll
    // (`rollLifeEvent`), and the roll commits through the exact same
    // `kill_character`/`incapacitate_character`/`recover_from_incapacity`
    // workflows any other death/incapacity goes through — office vacancy is
    // therefore always recorded truthfully, in one place. A death then
    // settles its estate and, if a natural claimant exists, opens (not
    // grants) their bid for any vacated office through a real Phase 4
    // procedure — `heirCharacterId`/family seniority only ever nominates a
    // sponsor, never a holder.
    emit(onProgress, "life_review");
    // Seeded from `worldAfterPlayer`, not `resolutionWorld`: life review and
    // the character-agency phase below it must see this turn's player
    // actions already applied, or NPCs choose their goals/plots against a
    // world that doesn't yet reflect what the player just did.
    let lifeReviewedWorld: WorldState = worldAfterPlayer;
    const lifeEventChronicle: ChronicleEntryInput[] = [];
    const lifeStages = input.scenarioLife?.lifeStages ?? [];
    const stepsPerYear = input.scenarioClock?.stepsPerYear ?? 4;
    const reviewIntervalSteps = input.scenarioLife?.reviewIntervalSteps ?? 4;
    let playerSuccessorCandidates: readonly string[] = [];
    let playerCharacterDied = false;

    if (lifeStages.length > 0) {
      for (const character of dueLifeReviews(lifeReviewedWorld.characters, atStep)) {
        const ageYears = currentAgeYears(character, stepsPerYear, atStep);
        const stage = classifyLifeStage(ageYears, lifeStages);
        const roll = rollLifeEvent(character, stage, atStep);

        if (roll !== null) {
          const actionId = roll.kind === "death" ? "kill_character" : roll.kind === "incapacitation" ? "incapacitate_character" : "recover_from_incapacity";
          const parameters = roll.kind === "recovery" ? { characterId: character.id } : { characterId: character.id, cause: roll.cause };
          const rolled = executeWorkflows([{ actionId, actorId: "system", parameters }], lifeReviewedWorld, atStep);
          lifeReviewedWorld = rolled.world;
          console.log(`${tag()} [life_review] ${character.name} (${character.id}): ${roll.kind} — ${roll.cause}`);
          let estateOutcome: string | null = null;
          let vacatedOfficeIds: string[] = [];

          if (roll.kind === "death") {
            const settlement = settleEstate(lifeReviewedWorld, character.id, stepsPerYear, atStep);
            lifeReviewedWorld = { ...lifeReviewedWorld, material: settlement.material };
            const successorId = settlement.beneficiaryIds[0];
            if (settlement.transfers.length > 0) {
              estateOutcome = successorId !== undefined
                ? `${lifeReviewedWorld.characters.find((c) => c.id === successorId)?.name ?? successorId} inherits the estate.`
                : "The estate is escheated for lack of a valid heir.";
            }
            vacatedOfficeIds = lifeReviewedWorld.material.officeSeats
              .filter((seat) => seat.status === "vacant" && seat.vacancyCause === "death" && seat.termExpiresAtStep === atStep)
              .map((seat) => seat.officeId);

            if (successorId !== undefined) {
              const legacy = deriveLegacyCauses(lifeReviewedWorld, character.id, successorId, atStep);
              if (legacy.length > 0) {
                lifeReviewedWorld = {
                  ...lifeReviewedWorld,
                  legacyCauses: [...lifeReviewedWorld.legacyCauses, ...legacy],
                  characters: lifeReviewedWorld.characters.map((c) => {
                    const entry = legacy.find((l) => l.holderCharacterId === c.id);
                    if (!entry) return c;
                    const existing = c.relations.find((r) => r.subjectCharacterId === successorId);
                    return existing
                      ? { ...c, relations: c.relations.map((r) => (r.subjectCharacterId === successorId ? { ...r, causes: [...r.causes, entry.cause] } : r)) }
                      : { ...c, relations: [...c.relations, { subjectCharacterId: successorId, causes: [entry.cause] }] };
                  }),
                };
              }

              // Open (never grant) the natural claimant's bid for any office this death vacated.
              const vacatedSeats = lifeReviewedWorld.material.officeSeats.filter(
                (seat) => seat.status === "vacant" && seat.vacancyCause === "death" && seat.termExpiresAtStep === atStep,
              );
              for (const seat of vacatedSeats) {
                const office = input.scenarioGovernment?.offices.find((o) => o.id === seat.officeId);
                const rule = office ? input.scenarioGovernment?.successionRules.find((r) => r.id === office.successionRuleId) : undefined;
                if (office === undefined || rule === undefined) continue;
                const eligibility = resolveEligibility(lifeReviewedWorld, successorId, office.eligibilityRequirementIds);
                const sponsorship = canSponsorProcedure(lifeReviewedWorld, successorId, "appointment", rule.institutionId);
                if (!eligibility.eligible || !sponsorship.eligible) continue;
                const resolutionMechanism = rule.kind === "elective" ? "vote" : rule.kind === "appointment" ? "appointment_authority" : "seniority";
                if (resolutionMechanism === "vote" && rule.institutionId === null) continue;
                const sponsorProcedureResult = executeWorkflows(
                  [{
                    actionId: "sponsor_procedure",
                    actorId: successorId,
                    parameters: {
                      procedureId: `succession:${seat.officeId}:${successorId}:${atStep}`,
                      type: "appointment",
                      institutionId: rule.institutionId,
                      sponsorCharacterId: successorId,
                      subjectKind: "office_seat",
                      subjectId: seat.officeId,
                      linkedWorkflowId: "appoint_to_office",
                      linkedWorkflowParams: { characterId: successorId, officeId: seat.officeId },
                      eligibilityRequirementIds: office.eligibilityRequirementIds,
                      eligibleParticipantIds: [successorId],
                      resolutionMechanism,
                      visibility: "polity",
                    },
                  }],
                  lifeReviewedWorld,
                  atStep,
                );
                lifeReviewedWorld = sponsorProcedureResult.world;
              }
            }

            if (character.id === actorCharacterId) {
              playerCharacterDied = true;
              playerSuccessorCandidates = findPlayerSuccessors(lifeReviewedWorld, character.id, stepsPerYear, atStep);
            }
          }

          lifeEventChronicle.push({
            sequence: 0,
            scope: "life_event",
            scopeRef: character.id,
            audience: "all_players",
            body: `${character.name} ${roll.kind === "death" ? "dies" : roll.kind === "incapacitation" ? "is incapacitated" : "recovers"}. ${roll.cause}`,
            atStep,
            materialConsequence: roll.kind === "death",
            simulatedDurationDays: 1,
            title: `${character.name}: ${roll.kind === "death" ? "Death" : roll.kind === "incapacitation" ? "Incapacitated" : "Recovery"}`,
            knowledgeStatus: "confirmed",
            participants: [{ name: character.name, role: "subject" }],
            playerRelevance: character.id === actorCharacterId ? "high" : "medium",
            lifeEvent: {
              characterId: character.id,
              characterName: character.name,
              kind: roll.kind,
              cause: roll.cause,
              estateOutcome,
              vacatedOfficeIds,
            },
          });
        }

        lifeReviewedWorld = {
          ...lifeReviewedWorld,
          characters: lifeReviewedWorld.characters.map((c) =>
            c.id === character.id ? { ...c, nextLifeReviewAtStep: nextReviewStep(atStep, reviewIntervalSteps) } : c,
          ),
        };
      }
    }
    if (playerCharacterDied) {
      console.log(`${tag()} [life_review] player character died; ${playerSuccessorCandidates.length} successor candidate(s) found`);
    }
    emit(onProgress, "life_review", true);

    // ── Step 9.5: Character agency — goals/plots, commitments, intents ─────
    // The Character Director only advises; this is the one place an approved
    // suggestion or a scored, conflict-resolved intent becomes either a real
    // workflow invocation (fed into the same manager/executor as every other
    // action this turn) or a canonical commitment/relation-cause change
    // (character-sim phase 3). `agencyWorld` becomes the base every
    // subsequent step executes against, replacing `resolutionWorld`.
    emit(onProgress, "character_agency");
    const characterAgencyInvocations: Array<{ invocation: ProposedInvocation; sourceRef: string; sourceRationale: string }> = [];
    let agencyWorld: WorldState = lifeReviewedWorld;

    for (const suggestion of characterSuggestions) {
      if (!approvedCharacterIds.has(suggestion.characterId)) continue;
      const invocation = buildCharacterSuggestionInvocation(suggestion, suggestion.characterId);
      if (invocation) {
        characterAgencyInvocations.push({ invocation, sourceRef: suggestion.characterId, sourceRationale: suggestion.rationale });
      }
    }

    const dueThisTurn = dueCommitments(agencyWorld.commitments ?? [], atStep);
    const intents: CharacterIntent[] = [];
    const claims: IntentClaim[] = [];
    const candidateByIntentId = new Map<string, CandidateAction>();

    // Bounded to this turn's already-selected, already-capped working set
    // (`selectRelevantCharacters`, max 8) -- only characters at continuity
    // tier "principal" get full candidate generation and up to one primary
    // action; "remembered" characters only advance their existing coarse
    // plan; "ordinary" characters (or unselected characters) get none.
    for (const selected of selectedCharacters) {
      const character = agencyWorld.characters.find((c) => c.id === selected.characterId);
      if (!character || !character.alive) continue;
      const continuityEntry = agencyWorld.continuity.find((c) => c.characterId === character.id);
      const tier = continuityEntry?.tier ?? "ordinary";
      if (tier !== "principal") continue;

      const owed = dueThisTurn.filter((c) => c.promisorCharacterId === character.id);
      const candidates = generateCandidateActions({ world: agencyWorld, character, atStep, commitments: owed });
      const top = rankCandidates(agencyWorld, character, candidates, atStep)[0];
      if (!top) continue;

      const intentId = `intent-${character.id}-${atStep}`;
      candidateByIntentId.set(intentId, top.candidate);
      intents.push({
        id: intentId, actorCharacterId: character.id,
        sourceGoalId: top.candidate.sourceGoalId, sourcePlotId: top.candidate.sourcePlotId,
        sourceCommitmentId: top.candidate.sourceCommitmentId,
        actionType: top.candidate.actionType, targetIds: [...top.candidate.targetIds],
        rationale: top.candidate.rationale, prerequisites: [],
        intendedWorkflowIds: [...top.candidate.legalWorkflowIds],
        priority: Math.max(0, Math.min(100, Math.round(top.score.total + 50))),
        status: "proposed", createdAtStep: atStep, reviewedAtStep: null, expiresAtStep: null,
        visibility: "private", sourceEventIds: [], resolutionReason: null,
      });
      claims.push({
        intentId, actorCharacterId: character.id, actionType: top.candidate.actionType,
        requiredResource: top.candidate.requiredResource, requiredOfficeId: top.candidate.requiredOfficeId,
        targetIds: top.candidate.targetIds, score: top.score.total, createdAtStep: atStep,
      });
    }

    // "remembered" characters advance their existing coarse plan by one step
    // -- no candidate generation, no scoring, never a rewritten history.
    let continuityAfterCoarseAdvance = agencyWorld.continuity;
    for (const selected of selectedCharacters) {
      const continuityEntry = continuityAfterCoarseAdvance.find((c) => c.characterId === selected.characterId);
      if (continuityEntry?.tier !== "remembered" || continuityEntry.plan === null) continue;
      continuityAfterCoarseAdvance = continuityAfterCoarseAdvance.map((c) =>
        c.characterId === selected.characterId && c.plan !== null
          ? { ...c, plan: { ...c.plan, progressSteps: c.plan.progressSteps + 1 } }
          : c,
      );
    }
    agencyWorld = { ...agencyWorld, continuity: continuityAfterCoarseAdvance };

    const conflictOutcomes = resolveIntentConflicts(agencyWorld, claims);
    const resolvedIntents: CharacterIntent[] = [];
    const intentAuditBySourceRef = new Map<string, string>(); // intentId -> workflow invocation's sourceRef, for post-execution status lookup

    for (const intent of intents) {
      const candidate = candidateByIntentId.get(intent.id)!;
      const conflict = conflictOutcomes.get(intent.id);
      if (conflict && !conflict.accepted) {
        resolvedIntents.push({ ...intent, status: "blocked", resolutionReason: conflict.reason });
        continue;
      }

      const commitment = intent.sourceCommitmentId !== null
        ? dueThisTurn.find((c) => c.id === intent.sourceCommitmentId)
        : undefined;
      if (commitment && (intent.actionType === "fulfill_commitment" || intent.actionType === "defer_commitment" || intent.actionType === "break_commitment")) {
        const result = intent.actionType === "fulfill_commitment"
          ? fulfillCommitment(agencyWorld, commitment.id, atStep)
          : intent.actionType === "break_commitment"
            ? breakCommitment(agencyWorld, commitment.id, atStep, intent.rationale)
            : deferCommitment(agencyWorld, commitment.id, atStep, intent.rationale);
        agencyWorld = {
          ...agencyWorld,
          characters: [...result.characters],
          commitments: [...result.commitments],
          characterPressures: [...result.characterPressures],
          material: result.material,
        };
        resolvedIntents.push({ ...intent, status: "executed", resolutionReason: `Commitment ${intent.actionType.replace("_commitment", "")}ed.` });
        continue;
      }

      if (candidate.legalWorkflowIds.length > 0) {
        const invocation = buildIntentInvocation(candidate, agencyWorld);
        if (invocation) {
          characterAgencyInvocations.push({ invocation, sourceRef: intent.id, sourceRationale: intent.rationale });
          intentAuditBySourceRef.set(intent.id, intent.id);
          resolvedIntents.push({ ...intent, status: "prepared" });
          continue;
        }
      }

      const socialEvent = buildIntentSocialEvent(candidate, atStep, gameId);
      if (socialEvent) {
        const applied = applySocialEvents(agencyWorld, [socialEvent], atStep, "in-progress-turn");
        agencyWorld = applied.world;
        const failed = applied.rejectedIds[0];
        resolvedIntents.push({
          ...intent,
          status: failed ? "failed" : "executed",
          resolutionReason: failed?.reason ?? "Applied as a direct social consequence.",
        });
        continue;
      }

      resolvedIntents.push({ ...intent, status: "executed", resolutionReason: "No mechanical effect modeled for this action; recorded for continuity only." });
    }
    console.log(`${tag()} [character_agency] OUT: goalPlotInvocations=${characterAgencyInvocations.length - intentAuditBySourceRef.size} intents=${intents.length} blocked=${resolvedIntents.filter((i) => i.status === "blocked").length}`);
    emit(onProgress, "character_agency", true);

    // ── Step 10: Final AI workflow review and execution ───────────────────
    emit(onProgress, "manage");
    console.log(`${tag()} [manage] IN: player=${playerCandidates.length} world=${worldDirectorInvocations.length} character_agency=${characterAgencyInvocations.length} candidate(s)`);
    const worldCandidates = collectWorldCandidates(worldDirectorInvocations);
    const characterAgencyCandidates = collectCharacterAgencyCandidates(characterAgencyInvocations);
    // Resolve entity name references to IDs before the Manager sees them.
    // Models occasionally emit readable names ("Panormus") instead of UUID-style
    // IDs; resolving here ensures both the Manager's dry-run and final execution
    // see valid references.
    const resolvedPlayerCandidates = playerCandidates.map((c) => ({
      ...c,
      requestedInvocation: resolveInvocationEntities(c.requestedInvocation, agencyWorld),
    }));
    const resolvedWorldCandidates = worldCandidates.map((c) => ({
      ...c,
      requestedInvocation: resolveInvocationEntities(c.requestedInvocation, agencyWorld),
    }));
    const resolvedCharacterAgencyCandidates = characterAgencyCandidates.map((c) => ({
      ...c,
      requestedInvocation: resolveInvocationEntities(c.requestedInvocation, agencyWorld),
    }));
    const finalCandidates = [...resolvedPlayerCandidates, ...resolvedWorldCandidates, ...resolvedCharacterAgencyCandidates];
    const managerResult = await runWorkflowManager(
      coinGatedAdapter, agencyWorld, finalCandidates, atStep, gameId, activeInventedWorkflows,
    );
    console.log(`${tag()} [manage] OUT: ${managerResult.acceptedInvocations.length}/${finalCandidates.length} workflow(s) accepted`);
    emit(onProgress, "manage", true);

    // ── Step 10.5: Resolve due political procedures ───────────────────────
    // Deterministic, no AI involved: any procedure at voting_or_deciding (or
    // past its deadline) resolves here by its declared resolutionMechanism,
    // producing at most one authorized workflow invocation per procedure
    // (character-sim phase 4, packages/shared/src/character-agency/political-resolver.ts).
    emit(onProgress, "resolve_politics");
    const politicsResolution = resolveDueProcedures({ characters: agencyWorld.characters, material: agencyWorld.material }, atStep);
    agencyWorld = { ...agencyWorld, material: politicsResolution.material };
    const politicalInvocations: ProposedInvocation[] = politicsResolution.invocations.map((inv) => ({
      actionId: inv.actionId,
      actorId: inv.actorId,
      parameters: inv.parameters,
    }));
    console.log(`${tag()} [resolve_politics] OUT: ${politicalInvocations.length} procedure(s) resolved to an authorized invocation`);
    emit(onProgress, "resolve_politics", true);

    emit(onProgress, "execute_world");

    // Battle proximity: if start_battle is in the accepted invocations and the
    // two forces are currently in different provinces, prepend a move_force so
    // both appear co-located on the map when the battle begins.
    const invocationsToExecute = [...managerResult.acceptedInvocations, ...politicalInvocations];
    for (const inv of managerResult.acceptedInvocations) {
      if (inv.actionId !== "start_battle") continue;
      const params = inv.parameters;
      const atkId = params["attackingForceId"] as string | undefined;
      const defId = params["defendingForceId"] as string | undefined;
      if (!atkId || !defId) continue;
      const atk = agencyWorld.material.forces.find((f) => f.id === atkId);
      const def = agencyWorld.material.forces.find((f) => f.id === defId);
      if (!atk || !def || atk.locationId === def.locationId) continue;
      // Move attacker to defender's province before the battle starts.
      const moveInvocation: ProposedInvocation = {
        actionId: "move_force",
        actorId: actorCharacterId,
        parameters: { forceId: atkId, destinationProvinceId: def.locationId },
      };
      const insertIdx = invocationsToExecute.indexOf(inv);
      invocationsToExecute.splice(insertIdx, 0, moveInvocation);
      console.log(`${tag()} [battle-proximity] auto-prepended move_force(${atkId} → ${def.locationId}) before start_battle`);
    }

    const executed = executeWorkflows(invocationsToExecute, agencyWorld, atStep, managerResult.runtimeInventedWorkflows);
    let newWorld = executed.world;
    let allWorkflowLog = [...executed.log];
    for (const entry of allWorkflowLog) {
      if (entry.outcome.ok) {
        console.log(`${tag()} [execute:ok] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} summary="${entry.outcome.result.summary}"`);
      } else {
        console.error(`${tag()} [execute:fail] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} reason=${entry.outcome.reason}`);
      }
    }

    // Retry failed workflows with fresh entity resolution against the updated world.
    // Entities created this turn (e.g. a newly raised force) may now resolve
    // correctly when matched against the post-execution world state.
    const failedEntries = allWorkflowLog.filter((e) => !e.outcome.ok);
    if (failedEntries.length > 0) {
      const retryInvocations: ProposedInvocation[] = [];
      for (const entry of failedEntries) {
        const reresolvedInv = resolveInvocationEntities(entry.invocation, newWorld);
        if (JSON.stringify(reresolvedInv.parameters) !== JSON.stringify(entry.invocation.parameters)) {
          console.log(`${tag()} [execute:retry-enqueue] ${entry.invocation.actionId} re-resolved — queuing retry`);
          retryInvocations.push(reresolvedInv);
        }
      }
      if (retryInvocations.length > 0) {
        const retryExecuted = executeWorkflows(retryInvocations, newWorld, atStep, managerResult.runtimeInventedWorkflows);
        newWorld = retryExecuted.world;
        allWorkflowLog = [...allWorkflowLog, ...retryExecuted.log];
        console.log(`${tag()} [execute:retry] ${retryExecuted.log.filter((e) => e.outcome.ok).length}/${retryInvocations.length} corrected workflow(s) applied`);
      }
    }

    console.log(`${tag()} [execute_world] OUT: ${allWorkflowLog.filter((e) => e.outcome.ok).length}/${allWorkflowLog.length} workflows applied`);
    newWorld = autoResolveDecidedStorylines(world, newWorld, atStep);
    const executionByInvocation = new Map(
      allWorkflowLog.map((entry) => [JSON.stringify(entry.invocation), entry.outcome]),
    );
    const finalWorkflowAudit: WorkflowAuditBlob = {
      ...managerResult.auditBlob,
      candidates: managerResult.auditBlob.candidates.map((entry) => {
        if (!entry.finalInvocation) return entry;
        const outcome = executionByInvocation.get(JSON.stringify(entry.finalInvocation));
        return outcome
          ? { ...entry, executionOk: outcome.ok, ...(outcome.ok ? {} : { executionReason: outcome.message }) }
          : { ...entry, executionOk: false, executionReason: "Approved invocation was not sent to the executor." };
      }),
    };
    // A "prepared" intent's real fate is only known once the workflow
    // manager and executor have actually run -- resolve it now, by the
    // intent id carried through as the candidate's sourceRef.
    for (let i = 0; i < resolvedIntents.length; i++) {
      const intent = resolvedIntents[i]!;
      if (intent.status !== "prepared") continue;
      const auditEntry = finalWorkflowAudit.candidates.find((entry) => entry.sourceRef === intent.id);
      if (auditEntry === undefined) {
        resolvedIntents[i] = { ...intent, status: "blocked", resolutionReason: "Never reached the workflow manager." };
      } else if (auditEntry.managerDecision === "reject" || auditEntry.managerDecision === "no_action") {
        resolvedIntents[i] = { ...intent, status: "blocked", resolutionReason: auditEntry.managerReason ?? "Rejected by the workflow manager." };
      } else if (auditEntry.executionOk === false) {
        resolvedIntents[i] = { ...intent, status: "failed", resolutionReason: auditEntry.executionReason ?? "Execution failed." };
      } else if (auditEntry.executionOk === true) {
        resolvedIntents[i] = { ...intent, status: "executed", resolutionReason: "Executed through the workflow manager." };
      } else {
        resolvedIntents[i] = { ...intent, status: "deferred", resolutionReason: "Approved but not yet executed this turn." };
      }
    }

    const inventedByActionId = new Map(managerResult.runtimeInventedWorkflows.map((workflow) => [workflow.definition.actionId, workflow]));
    const inventedWorkflowUses = allWorkflowLog.flatMap((entry) => {
      const workflow = inventedByActionId.get(entry.invocation.actionId);
      if (!workflow) return [];
      return [{
        workflowId: workflow.id,
        parameters: entry.invocation.parameters,
        success: entry.outcome.ok,
        ...(entry.outcome.ok && entry.outcome.resolvedInventedPatch ? { resolvedPatch: entry.outcome.resolvedInventedPatch } : {}),
        ...(!entry.outcome.ok ? { failureReason: entry.outcome.message } : {}),
      }];
    });

    // Commitment resolution
    const fulfilledCommitmentIds: string[] = [];
    const deferredCommitmentIds: string[] = [];
    // A commitment deferred because its promiser died can never be fulfilled
    // -- a broken promise, distinct from one merely awaiting its conditions.
    const brokenCommitments: { id: string; npcCharacterId: string; playerCharacterId: string }[] = [];
    const commitmentChronicle: ChronicleEntryInput[] = [];
    for (const commitment of pendingCommitments) {
      const npc = newWorld.characters.find((character) => character.id === commitment.npcCharacterId);
      if (!npc?.alive || commitment.conditions !== "") {
        deferredCommitmentIds.push(commitment.id);
        if (!npc?.alive) brokenCommitments.push({ id: commitment.id, npcCharacterId: commitment.npcCharacterId, playerCharacterId: commitment.playerCharacterId });
        continue;
      }
      if (commitment.promiseType === "money") {
        const account = newWorld.material.accounts.find((candidate) => candidate.owner.kind === "character" && candidate.owner.id === commitment.playerCharacterId && candidate.status === "active");
        if (account) {
          newWorld.material.accounts = newWorld.material.accounts.map((candidate) => candidate.id === account.id ? { ...candidate, balance: candidate.balance + 25 } : candidate);
          fulfilledCommitmentIds.push(commitment.id);
          commitmentChronicle.push({ sequence: 0, scope: "dialogue_commitment", scopeRef: commitment.id, audience: "all_players", body: `${npc.name} fulfilled a promised financial help.`, atStep, materialConsequence: true, simulatedDurationDays: 1, playerRelevance: "medium" });
          continue;
        }
      } else {
        fulfilledCommitmentIds.push(commitment.id);
        commitmentChronicle.push({ sequence: 0, scope: "dialogue_commitment", scopeRef: commitment.id, audience: "all_players", body: `${npc.name} fulfilled a promised ${commitment.promiseType}.`, atStep, materialConsequence: false, simulatedDurationDays: 1, playerRelevance: "medium" });
      }
    }

    // Player-visible, provenance-carrying account of every political procedure
    // resolved this turn -- institution, sponsor, net support/opposition,
    // outcome and public reason only. Never the per-supporter reasons or
    // undisclosed positions the admin political inspector shows
    // (packages/shared/src/characters/political-inspector.ts).
    const politicalChronicle: ChronicleEntryInput[] = [];
    for (const procedure of politicsResolution.material.politicalProcedures) {
      if (procedure.resolvedAtStep !== atStep) continue;
      const sponsor = newWorld.characters.find((c) => c.id === procedure.sponsorCharacterId);
      const institution = procedure.institutionId
        ? newWorld.material.institutions.find((i) => i.id === procedure.institutionId)
        : undefined;
      const outcome = procedure.outcome ?? "failed";
      const weights = netSupportWeight({ characters: newWorld.characters, material: newWorld.material }, procedure);
      const readableType = procedure.type.replace(/_/g, " ");
      const outcomeVerb = outcome === "passed" ? "succeeds" : outcome === "blocked" ? "is blocked" : outcome === "withdrawn" ? "is withdrawn" : "fails";
      politicalChronicle.push({
        sequence: 0,
        scope: "political_procedure",
        scopeRef: procedure.id,
        audience: procedure.visibility === "private" ? "knowledge_scoped" : "all_players",
        body: `${sponsor?.name ?? "A sponsor"}'s ${readableType} ${outcomeVerb}${institution ? ` before the ${institution.name}` : ""}. ${procedure.outcomeReason ?? ""}`.trim(),
        atStep,
        materialConsequence: outcome === "passed",
        simulatedDurationDays: 1,
        title: `${sponsor?.name ?? "A sponsor"}: ${readableType} ${outcomeVerb}`,
        knowledgeStatus: "confirmed",
        participants: sponsor ? [{ name: sponsor.name, role: "sponsor" }] : [],
        institutions: institution ? [{ name: institution.name }] : [],
        playerRelevance: procedure.sponsorCharacterId === actorCharacterId || procedure.eligibleParticipantIds.includes(actorCharacterId) ? "high" : "medium",
        politicalOutcome: {
          procedureId: procedure.id,
          procedureType: procedure.type,
          institutionName: institution?.name ?? null,
          sponsorName: sponsor?.name ?? "Unknown",
          outcome,
          publicReason: procedure.outcomeReason ?? "",
          netSupportWeight: weights.support,
          netOppositionWeight: weights.oppose,
        },
      });
    }

    // Player-visible account of any force that changed commander this turn
    // (character-sim phase 6), derived by diff rather than a workflow hook so
    // every commander-changing path -- `assign_command`, or any future one --
    // is covered without duplicating chronicle-writing logic per workflow.
    const commandChangeChronicle: ChronicleEntryInput[] = [];
    for (const forceAfter of newWorld.material.forces) {
      const forceBefore = resolutionWorld.material.forces.find((f) => f.id === forceAfter.id);
      if (forceBefore === undefined || forceBefore.commanderCharacterId === forceAfter.commanderCharacterId) continue;
      const previousCommander = newWorld.characters.find((c) => c.id === forceBefore.commanderCharacterId);
      const newCommander = newWorld.characters.find((c) => c.id === forceAfter.commanderCharacterId);
      commandChangeChronicle.push({
        sequence: 0,
        scope: "command_change",
        scopeRef: forceAfter.id,
        audience: "all_players",
        body: `Command of the ${forceAfter.name} passes${previousCommander ? ` from ${previousCommander.name}` : ""}${newCommander ? ` to ${newCommander.name}` : ""}.`,
        atStep,
        materialConsequence: true,
        simulatedDurationDays: 1,
        title: `Command changes: ${forceAfter.name}`,
        knowledgeStatus: "confirmed",
        participants: [previousCommander, newCommander].filter((c): c is NonNullable<typeof c> => c !== undefined).map((c) => ({ name: c.name })),
        playerRelevance: [forceBefore.commanderCharacterId, forceAfter.commanderCharacterId].includes(actorCharacterId) ? "high" : "low",
        commandChange: {
          forceName: forceAfter.name,
          previousCommanderName: previousCommander?.name ?? null,
          newCommanderName: newCommander?.name ?? null,
          reason: "Reassigned by institutional procedure.",
        },
      });
    }

    // Player-visible account of any public/polity-visible marriage,
    // partnership, or guardianship formed/dissolved this turn.
    const familyEventChronicle: ChronicleEntryInput[] = [];
    for (const contractAfter of newWorld.lifeContracts) {
      const contractBefore = resolutionWorld.lifeContracts.find((c) => c.id === contractAfter.id);
      if (contractBefore?.status === contractAfter.status) continue;
      if (contractAfter.visibility === "private") continue;
      const partyNames = contractAfter.partyCharacterIds
        .map((id) => newWorld.characters.find((c) => c.id === id)?.name)
        .filter((name): name is string => name !== undefined);
      const readableType = contractAfter.type.replace(/_/g, " ");
      familyEventChronicle.push({
        sequence: 0,
        scope: "family_event",
        scopeRef: contractAfter.id,
        audience: contractAfter.visibility === "polity" ? "knowledge_scoped" : "all_players",
        body: `${partyNames.join(" and ") || "The parties"} ${contractAfter.status === "active" ? `form a ${readableType}` : `end their ${readableType} (${contractAfter.status})`}.`,
        atStep,
        materialConsequence: false,
        simulatedDurationDays: 1,
        title: `${readableType[0]!.toUpperCase()}${readableType.slice(1)}: ${partyNames.join(" & ")}`,
        knowledgeStatus: "confirmed",
        participants: partyNames.map((name) => ({ name })),
        playerRelevance: contractAfter.partyCharacterIds.includes(actorCharacterId) ? "high" : "low",
        familyEvent: {
          contractId: contractAfter.id,
          type: contractAfter.type,
          partyNames,
          outcome: contractAfter.status,
        },
      });
    }

    const displayPatch = buildDisplayPatch(resolutionWorld, newWorld);
    const displayPatchByInvocation = new Map<string, unknown>();
    for (const entry of allWorkflowLog) {
      if (entry.outcome.ok) {
        const beforeForce = resolutionWorld.material.forces.find((f) => f.id === entry.invocation.parameters["forceId"] as string);
        const afterForce = newWorld.material.forces.find((f) => f.id === entry.invocation.parameters["forceId"] as string);
        if (beforeForce && afterForce && beforeForce.locationId !== afterForce.locationId) {
          displayPatchByInvocation.set(entry.invocation.actionId, { kind: "force_moved", forceId: beforeForce.id, newLocationId: afterForce.locationId });
        }
      }
    }

    emit(onProgress, "execute_world", true);

    // ── Step 11: Chronicle ─────────────────────────────────────────────────
    emit(onProgress, "chronicle");
    let chronicleInputs = buildChronicleEntries(
      newWorld,
      verdicts,
      interpretations,
      characterSuggestions,
      approvedCharacterIds,
      consolidatedPackage,
      chronicleCasts,
      reactionProposals,
      simulatorProposals,
      allWorkflowLog,
      finalWorkflowAudit,
      atStep,
      displayPatchByInvocation,
      playerId,
    );
    chronicleInputs = scheduleChronicleEntries(capChronicleVisibility([
      ...chronicleInputs,
      ...commitmentChronicle,
      ...politicalChronicle,
      ...lifeEventChronicle,
      ...commandChangeChronicle,
      ...familyEventChronicle,
    ], DEFAULT_MAX_CHRONICLE_ENTRIES_PER_TURN));

    if (displayPatch && chronicleInputs.length > 0) {
      const lastIdx = chronicleInputs.length - 1;
      chronicleInputs[lastIdx] = { ...chronicleInputs[lastIdx]!, displayPatch };
    }

    console.log(`${tag()} [chronicle] IN: ${chronicleInputs.length} raw entries — ${chronicleInputs.map((e) => `${e.scope}(src:${e.sourceDirector ?? "?"},pos:${e.chainPosition ?? "?"})`).join(", ")}`);

    // Narrator pass
    let narratorOk = false;
    try {
      const narratorEntries: NarratorEntry[] = chronicleInputs.map((e) => ({
        body: e.body,
        isPlayerAction: e.scope === "directive",
        chainPosition: e.chainPosition ?? null,
        chainId: e.chainId ?? null,
        sourceDirector: e.sourceDirector,
        knowledgeStatus: e.knowledgeStatus,
        characterMentions: e.characterMentions
          ?.map((mention) => {
            const character = newWorld.characters.find((candidate) => candidate.id === mention.characterId && candidate.alive);
            return character ? { name: character.name, role: mention.role } : null;
          })
          .filter((mention): mention is { name: string; role: string } => mention !== null),
      }));
      const narratorSystemPrompt = buildChronicleNarratorPrompt(narratorEntries, resolutionWorld, actorCharacterId, playerKnowledgebase);
      const narratorResult = await coinGatedAdapter.call("chronicle_narrator", narratorSystemPrompt, "Rewrite the events as chronicle prose.");
      const narratorParsed = JSON.parse(stripToJson(narratorResult.content)) as { entries?: { body: string; isPlayerAction: boolean }[] };
      if (Array.isArray(narratorParsed.entries) && narratorParsed.entries.length === chronicleInputs.length) {
        for (let i = 0; i < chronicleInputs.length; i++) {
          const rewritten = narratorParsed.entries[i]?.body;
          if (rewritten && typeof rewritten === "string") {
            chronicleInputs[i] = { ...chronicleInputs[i]!, body: rewritten };
          }
        }
        narratorOk = true;
      } else {
        console.warn(`${tag()} [chronicle:narrator] length mismatch — expected ${chronicleInputs.length}, got ${narratorParsed.entries?.length ?? "?"}; using raw bodies`);
      }
    } catch (err) {
      console.error(`${tag()} [chronicle:narrator] failed, keeping raw bodies:`, err);
    }
    console.log(`${tag()} [chronicle] OUT: ${chronicleInputs.length} entries narrator=${narratorOk ? "ok" : "skipped"}`);

    // Current Chronicle dispatch (character-sim phase 6): a compact,
    // knowledge-safe per-turn header built deterministically from this turn's
    // already-classified entries plus the player's own canonical Authority
    // change -- no separate AI call, modeled on the existing
    // (player-invisible) `summarizeResolvedTurn`.
    const authorityBefore = deriveAuthoritySummary(resolutionWorld, actorCharacterId, input.scenarioGovernment);
    const authorityAfter = deriveAuthoritySummary(newWorld, actorCharacterId, input.scenarioGovernment);
    const authorityChangesForPlayer = [
      ...authorityAfter.filter((label) => !authorityBefore.includes(label)).map((label) => `Now: ${label}`),
      ...authorityBefore.filter((label) => !authorityAfter.includes(label)).map((label) => `No longer: ${label}`),
    ];
    const dispatch = buildCurrentDispatch({
      entriesThisTurn: chronicleInputs.map((e) => ({
        title: e.title ?? e.body.slice(0, 60),
        body: e.body,
        playerRelevance: e.playerRelevance ?? "none",
        knowledgeStatus: e.knowledgeStatus ?? "confirmed",
        consequences: (e.directConsequences ?? []).map((c) => c.label),
      })),
      authorityChangesForPlayer,
    });
    chronicleInputs = scheduleChronicleEntries([
      {
        sequence: 0,
        scope: "dispatch",
        audience: "all_players",
        body: dispatch.headline,
        atStep,
        materialConsequence: false,
        simulatedDurationDays: 0,
        title: "Current dispatch",
        knowledgeStatus: dispatch.uncertaintyNote !== null ? "report" : "confirmed",
        playerRelevance: "high",
        dispatch: { items: dispatch.items, uncertaintyNote: dispatch.uncertaintyNote },
      },
      ...chronicleInputs,
    ]);

    emit(onProgress, "chronicle", true);

    // ── Step 12: Commit ────────────────────────────────────────────────────
    emit(onProgress, "commit");
    console.log(`${tag()} [commit] IN: step=${atStep} chronicleEntries=${chronicleInputs.length} auditCandidates=${finalWorkflowAudit.candidates.length}`);

    // Update character relevance in newWorld before committing
    const updatedRelevance = updateCharacterRelevance(newWorld.characterRelevance ?? [], chronicleInputs, atStep);

    // Character-sim phase 2: derive this turn's own pressure triggers (an
    // injury, a debt, a broken commitment, a war, an insult, a vacated
    // office) from outcomes already validated and applied this same turn.
    // These become visible to *next* turn's character selection and
    // director context -- the same committed-then-consumed-next pattern
    // `characterRelevance`/`chronicleChains` already use.
    const accountBalance = (characters: WorldState["characters"], accounts: WorldState["material"]["accounts"]) => {
      const map = new Map<string, number>();
      for (const character of characters) {
        const account = accounts.find((a) => a.id === character.personalAccountId);
        if (account !== undefined) map.set(character.id, account.balance);
      }
      return map;
    };
    const appliedSocialEventSummaries = pendingSocialEvents
      .filter((event) => socialEventOutcome.appliedIds.includes(event.id))
      .map((event) => ({ id: event.id, kind: event.kind, participantCharacterIds: event.participantCharacterIds }));
    const warringPolityIds = new Set(newWorld.conflicts.wars.flatMap((w) => [w.polityAId, w.polityBId]));
    const pressureTriggers = derivePressureTriggers({
      atStep,
      charactersBefore: resolutionWorld.characters,
      charactersAfter: newWorld.characters,
      accountBalanceBefore: accountBalance(resolutionWorld.characters, resolutionWorld.material.accounts),
      accountBalanceAfter: accountBalance(newWorld.characters, newWorld.material.accounts),
      appliedSocialEvents: appliedSocialEventSummaries,
      failedOrCancelledCommitments: brokenCommitments,
      warringPolityIds,
    });
    let worldWithTriggeredPressures: WorldState = newWorld;
    for (const trigger of pressureTriggers) {
      const result = createPressure(worldWithTriggeredPressures, trigger);
      worldWithTriggeredPressures = {
        ...worldWithTriggeredPressures,
        characters: [...result.characters],
        characterPressures: [...result.characterPressures],
      };
    }

    const finalWorld = {
      ...worldWithTriggeredPressures,
      elapsedStep: atStep,
      characterRelevance: updatedRelevance,
      // Character-sim phase 3: this turn's resolved intents (executed,
      // blocked, deferred, failed, abandoned), each carrying the reason it
      // ended up where it did, appended to recent history and capped so this
      // never grows into a whole-population log. Bounded to this turn's
      // principal working set (at most `MAX_CHARACTERS_PER_TURN`), so the cap
      // covers many turns of real history, not just one.
      characterIntents: [...(worldWithTriggeredPressures.characterIntents ?? []), ...resolvedIntents].slice(-200),
      lastTurnSummary: summarizeResolvedTurn(chronicleInputs, atStep),
    };

    await commitResolution(db, {
      gameId,
      turnId,
      newWorld: finalWorld,
      elapsedStepEnd: atStep,
      chronicleEntries: chronicleInputs,
      stopReason: "player_decision",
      workflowAudit: finalWorkflowAudit,
      inventedWorkflows: managerResult.createdInventedWorkflows,
      inventedWorkflowUses,
    });

    await resolveNpcCommitments(db, fulfilledCommitmentIds, "fulfilled", atStep, "Validated and fulfilled during turn resolution.");
    await resolveNpcCommitments(db, deferredCommitmentIds, "deferred", atStep, "Conditions require a later turn.");

    // Guarded by `WHERE status = 'proposed'` inside the query itself, so this
    // can never re-apply an event a concurrent resolution already committed.
    for (const profile of socialEventOutcome.introducedProfiles) {
      await upsertCharacterProfile(db, profile);
    }
    await markCharacterSocialEventsApplied(db, socialEventOutcome.appliedIds, atStep, turnId);
    await markCharacterSocialEventsRejected(db, socialEventOutcome.rejectedIds);

    const playerProvinceId = resolutionWorld.characters.find((c) => c.id === actorCharacterId)?.locationProvinceId;
    const playerPolityId = resolutionWorld.characters.find((c) => c.id === actorCharacterId)?.polityId;
    await ingestChronicleEntries(db, gameId, chronicleInputs.map((e) => {
      const base = { body: e.body, atStep: e.atStep, audience: e.audience } as const;
      return e.audience === "knowledge_scoped"
        ? { ...base, ...(playerPolityId ? { associatedPolityId: playerPolityId } : {}), ...(playerProvinceId ? { associatedProvinceId: playerProvinceId } : {}) }
        : base;
    })).catch((err: unknown) => {
      console.error("[resolution] ingestChronicleEntries failed", err);
    });

    console.log(`${tag()} ══ RESOLUTION COMPLETE ══ step=${atStep} chronicle=${chronicleInputs.length} workflows=${allWorkflowLog.filter((e) => e.outcome.ok).length} invented=${managerResult.createdInventedWorkflows.length}`);
    emit(onProgress, "commit", true);
    return { workflowDownloads: [] };
  } catch (error) {
    console.error("[resolution] pipeline failed", error);
    await failTurn(db, turnId, String(error));
    throw error;
  }
}

type RelevanceRole = "protagonist" | "antagonist" | "participant" | "mentioned";

/** Update character relevance entries from this turn's chronicle entries. */
function updateCharacterRelevance(
  existing: Array<{ characterId: string; chronicleAppearances: Array<{ atStep: number; role: RelevanceRole }>; lastAppearanceStep: number | null }>,
  entries: readonly ChronicleEntryInput[],
  atStep: number,
): typeof existing {
  const mentioned = new Map<string, RelevanceRole>();

  for (const entry of entries) {
    for (const mention of entry.characterMentions ?? []) {
      const role: RelevanceRole = mention.role === "opponent"
        ? "antagonist"
        : mention.role === "supporter" || mention.role === "spokesperson" || mention.role === "presiding_official" || mention.role === "negotiator"
          ? "participant"
          : "mentioned";
      mentioned.set(mention.characterId, role);
    }
    if (entry.scope === "reaction" && entry.scopeRef) {
      mentioned.set(entry.scopeRef, "participant");
    }
    if (entry.scope === "directive" && entry.sourceDirector === "player") {
      for (const inv of (entry.playerInvolvement ?? []) as Array<{ characterId?: string; role?: string }>) {
        if (inv.characterId && inv.role) {
          const mapped: RelevanceRole = inv.role === "actor" ? "protagonist" : inv.role === "target" ? "antagonist" : "participant";
          mentioned.set(inv.characterId, mapped);
        }
      }
    }
  }

  if (mentioned.size === 0) return existing;

  const map = new Map(existing.map((e) => [e.characterId, { ...e, chronicleAppearances: [...e.chronicleAppearances] }]));
  for (const [charId, role] of mentioned) {
    const entry = map.get(charId) ?? { characterId: charId, chronicleAppearances: [] as Array<{ atStep: number; role: RelevanceRole }>, lastAppearanceStep: null as number | null };
    entry.chronicleAppearances = [...entry.chronicleAppearances.slice(-19), { atStep, role }];
    entry.lastAppearanceStep = atStep;
    map.set(charId, entry);
  }

  return [...map.values()];
}
