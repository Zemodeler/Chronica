import "server-only";

import { randomUUID } from "node:crypto";
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
  NovelActionProposal,
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
  applyTemporaryWorkflowPatch,
  selectRelevantCharacters,
  inferTheatre,
} from "@chronica/shared";
import { collectPlayerCandidates, collectWorldCandidates, previewPlayerWorkflows, runWorkflowManager } from "./workflow-manager";

const InterpretParseSchema = OrderInterpretationSchema.omit({ directiveId: true });
const AssessParseSchema = OrderAssessmentSchema.omit({ directiveId: true });
// Player ownership is assigned from the authenticated turn, never trusted from
// a model response. This also prevents a malformed `playerId: null` from
// discarding an otherwise valid adjudication.
const VerdictParseSchema = VerdictSchema.omit({ directiveId: true, playerInvolvement: true });
import type { AiAdapter } from "@chronica/ai";
import type { ChronicaDatabase } from "@chronica/db";
import {
  commitResolution,
  failTurn,
  claimTurnForResolution,
  ingestChronicleEntries,
  getCharacterKnowledgebase,
  listPendingNpcCommitments,
  resolveNpcCommitments,
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

function buildWorkflowDeveloperDownload(proposal: NovelActionProposal): WorkflowDeveloperDownload {
  const id = proposal.intent.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "temporary_workflow";
  return {
    fileName: `${id}_workflow_report.md`,
    content: `# Temporary workflow: ${proposal.intent}\n\n## AI implementation report\n${proposal.implementationReport}\n\n## Applied for this turn\n\`\`\`json\n${JSON.stringify(proposal.temporaryPatch, null, 2)}\n\`\`\`\n\n## Permanent workflow scaffold\n\`\`\`ts\nimport { z } from "zod";\nimport { defineWorkflow } from "../types";\n\nexport const ${id}Workflow = defineWorkflow({\n  id: "${id}",\n  description: "${proposal.intent.replace(/"/g, '\\"').slice(0, 120)}",\n  category: "narrative", // choose the correct category\n  parametersSchema: z.object({ /* derive from the temporary patch */ }).strict(),\n  apply(world, params, context) {\n    // Replace this temporary patch with a permanent, tested implementation.\n    return null;\n  },\n});\n\`\`\`\n`,
  };
}

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

async function safeParseJson<T>(
  text: string,
  schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: unknown } },
  label: string,
): Promise<T | null> {
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
    healthBps: 10_000,
    prestigeBps: 3_000,
    relations: [],
    ambitions: [],
    heirCharacterId: null,
    alive: true,
    diedAtStep: null,
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
        label: `+${amount} gold`,
        entityId: null,
        quantified: true,
      });
    } else if (invocation.actionId === "remove_gold") {
      const amount = invocation.parameters["amount"];
      consequences.push({
        kind: "material",
        label: `-${amount} gold`,
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

function buildChronicleEntries(
  verdicts: readonly Verdict[],
  interpretations: readonly OrderInterpretation[],
  characterSuggestions: readonly CharacterSuggestion[],
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
      input: {
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
    raw.push({
      sortKey: rp.salience * 80,
      input: {
        scope: "reaction",
        scopeRef: rp.reactorId,
        audience: rp.visibility === "private" ? "knowledge_scoped" : "all_players",
        body,
        atStep,
        materialConsequence: logEntries.length > 0,
        sourceDirector: "reaction_director",
        chainPosition: "reaction",
      },
    });
  }

  // Simulator proposal entries
  for (const sp of simulatorProposals) {
    if (sp.salience < 4) continue;
    const logEntries = sp.proposedWorkflows
      .map((wf) => workflowLog.find((l) => l.invocation.actionId === wf.actionId && l.outcome.ok))
      .filter(Boolean);
    const body = logEntries.length > 0
      ? logEntries.map((l) => l!.outcome.result?.summary ?? "").filter(Boolean).join(". ")
      : sp.summary;
    raw.push({
      sortKey: sp.salience * 60,
      input: {
        scope: "world_event",
        scopeRef: sp.storylineId ?? `sim-${randomUUID().slice(0, 8)}`,
        audience: sp.visibility === "private" ? "knowledge_scoped" : "all_players",
        body,
        atStep,
        materialConsequence: logEntries.length > 0,
        sourceDirector: "simulator",
        chainPosition: sp.scopeTag === "star" || sp.scopeTag === "near" ? "spread" : "distant",
        displayPatch: displayPatchByInvocation.get(sp.proposedWorkflows[0]?.actionId ?? ""),
      },
    });
  }

  // Sort descending by sortKey
  raw.sort((a, b) => b.sortKey - a.sortKey);

  // Soft cap at 12 chronicle entries
  return raw.slice(0, 12).map((r, i) => ({ ...r.input, sequence: i }));
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

/** Build a displayPatch from world-state diff for map-relevant changes. */
function buildDisplayPatch(before: WorldState, after: WorldState): unknown | undefined {
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
    const playerKnowledgebase = await getCharacterKnowledgebase(db, gameId, playerId).catch(() => null);
    const pendingCommitments = await listPendingNpcCommitments(db, gameId);
    const resolutionContext: ResolutionPlayerContext = { knowledgebase: playerKnowledgebase, pendingCommitments };
    const resolutionWorld = materializePlayerCharacter(world, actorCharacterId, playerKnowledgebase);
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
        const result = await adapter.call("interpret_order", systemPrompt, userMsg);
        const parsed = await safeParseJson(result.content, InterpretParseSchema, `interpret:directive-${idx}`);
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
    const assessSystemPrompt = buildAssessSystemPrompt(resolutionWorld, actorCharacterId, resolutionContext);

    for (const interpretation of interpretations) {
      const userMsg = `Directive: ${interpretation.intent}\nProposed steps: ${interpretation.proposedSteps.join("; ")}\nRisks: ${interpretation.risks.join("; ")}`;
      try {
        const result = await adapter.call("assess_orders", assessSystemPrompt, userMsg);
        const parsed = await safeParseJson(result.content, AssessParseSchema, `assess:${interpretation.directiveId}`);
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
          needsAdjudication: true,
        });
      }
    }
    console.log(`${tag()} [assess] OUT: ${assessments.length} assessment(s) — ${assessments.map((a) => `${a.directiveId}:${a.feasibility}${a.workflow ? `+wf(${a.workflow.actionId})` : ""}`).join(", ")}`);
    emit(onProgress, "assess", true);

    // ── Step 3: Adjudicate ─────────────────────────────────────────────────
    emit(onProgress, "adjudicate");
    console.log(`${tag()} [adjudicate] IN: ${assessments.length} assessment(s)`);
    const verdicts: Verdict[] = [];
    const adjSystemPrompt = buildAdjudicateSystemPrompt(resolutionWorld, actorCharacterId, resolutionContext);

    for (const assessment of assessments) {
      const userMsg = `Order: ${assessment.interpretation}\nFeasibility: ${assessment.feasibility}\nWorkflow: ${assessment.workflow ? JSON.stringify(assessment.workflow) : "none"}\nNeeds adjudication: ${assessment.needsAdjudication}`;
      try {
        const result = await adapter.call("adjudicate", adjSystemPrompt, userMsg);
        let adjContent = result.content;
        try {
          const raw = JSON.parse(stripToJson(adjContent)) as Record<string, unknown>;
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
            adjContent = JSON.stringify(raw);
          }
        } catch { /* leave adjContent as-is */ }

        const parsed = await safeParseJson(adjContent, VerdictParseSchema, `adjudicate:${assessment.directiveId}`);
        if (parsed) {
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

          verdicts.push({
            ...parsed,
            deltas: finalDeltas,
            directiveId: assessment.directiveId,
            playerInvolvement: [{ playerId, characterId: actorCharacterId, role: "actor" }],
          });
        } else {
          const fallbackDeltas = assessment.workflow
            ? [{ kind: "workflow" as const, invocation: { actionId: assessment.workflow.actionId, actorId: actorCharacterId, parameters: assessment.workflow.parameters } }]
            : [];
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
      } catch (err) {
        console.error(`${tag()} [adjudicate:error] ${assessment.directiveId}:`, err);
        verdicts.push({
          directiveId: assessment.directiveId,
          outcome: "fails",
          obstacles: [{ source: "System", weight: "real", reason: "Resolution failed due to an error." }],
          deltas: [],
          tacticalModifiers: [],
          timeCost: { min: 1, max: 1 },
          rationale: "The action could not be adjudicated.",
          knowledgeVisibility: "private",
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
    const worldAfterPlayer = previewPlayerWorkflows(resolutionWorld, playerCandidates, atStep);
    console.log(`${tag()} [preview_player] OUT: ${playerCandidates.length} candidate(s) previewed without persistence`);
    emit(onProgress, "preview_player", true);

    // ── Steps 5–7: Reaction Director, Simulator, Character Director (parallel) ──
    // These all run on worldAfterPlayer — post player-execution snapshot.

    emit(onProgress, "reaction");
    const reactionProposals: ReactionProposal[] = [];
    const shouldReact = shouldRunReactionDirector(verdicts);
    console.log(`${tag()} [reaction] IN: shouldRun=${shouldReact} verdicts=${verdicts.length}`);
    if (shouldReact) {
      try {
        const reactionPrompt = buildReactionDirectorSystemPrompt(worldAfterPlayer, verdicts, actorCharacterId, resolutionContext);
        const reactionResult = await adapter.call("reaction_director", reactionPrompt, `Step ${atStep}: generate reactions.`);
        const reactionParsed = await safeParseJson(reactionResult.content, ReactionProposalBatchSchema, "reaction_director");
        if (reactionParsed) {
          reactionProposals.push(...reactionParsed.proposals);
        }
      } catch (err) {
        console.error(`${tag()} [reaction:error]`, err);
      }
    }
    console.log(`${tag()} [reaction] OUT: ${reactionProposals.length} proposal(s) — ${reactionProposals.map((p) => `${p.reactionKind}(sal:${p.salience})`).join(", ") || "none"}`);
    emit(onProgress, "reaction", true);

    emit(onProgress, "simulate");
    const simulatorProposals: SimulatorProposal[] = [];
    try {
      const scope = inferTheatre(worldAfterPlayer, actorCharacterId);
      console.log(`${tag()} [simulate] IN: star=${scope.star.size} near=${scope.near.size} far=${scope.far.size} coarse=${scope.coarse.size} storylines=${(worldAfterPlayer.storylines ?? []).length}`);
      const simPrompt = buildSimulatorSystemPrompt(worldAfterPlayer, scope, actorCharacterId, resolutionContext);
      const simResult = await adapter.call("simulator", simPrompt, `Step ${atStep}: simulate the world.`);
      const simParsed = await safeParseJson(simResult.content, SimulatorProposalBatchSchema, "simulator");
      if (simParsed) {
        simulatorProposals.push(...simParsed.proposals);
      }
    } catch (err) {
      console.error(`${tag()} [simulate:error]`, err);
    }
    console.log(`${tag()} [simulate] OUT: ${simulatorProposals.length} proposal(s) — ${simulatorProposals.map((p) => `${p.kind}(scope:${p.scopeTag},sal:${p.salience})`).join(", ") || "none"}`);
    emit(onProgress, "simulate", true);

    emit(onProgress, "character_advise");
    const selectedCharacters: SelectedCharacter[] = selectRelevantCharacters(
      worldAfterPlayer,
      actorCharacterId,
      undefined,
      pendingCommitments.map((commitment) => commitment.npcCharacterId),
    );
    console.log(`${tag()} [character_advise] IN: selectedCharacters=${selectedCharacters.length} — ${selectedCharacters.map((sc) => `${sc.characterId}(tier:${sc.tier})`).join(", ") || "none"}`);
    const characterSuggestions: CharacterSuggestion[] = [];
    if (selectedCharacters.length > 0) {
      try {
        const charPrompt = buildCharacterDirectorSystemPrompt(worldAfterPlayer, selectedCharacters, actorCharacterId, resolutionContext);
        const charResult = await adapter.call("character_director", charPrompt, `Step ${atStep}: advise on ${selectedCharacters.length} character(s).`);
        const charParsed = await safeParseJson(charResult.content, CharacterSuggestionBatchSchema, "character_director");
        if (charParsed) {
          for (const suggestion of charParsed.suggestions) {
            const isSelected = selectedCharacters.some((sc) => sc.characterId === suggestion.characterId);
            const isAlive = worldAfterPlayer.characters.find((c) => c.id === suggestion.characterId)?.alive ?? false;
            if (isSelected && isAlive) characterSuggestions.push(suggestion);
          }
        }
      } catch (err) {
        console.error(`${tag()} [character_advise:error]`, err);
      }
    }
    console.log(`${tag()} [character_advise] OUT: ${characterSuggestions.length} suggestion(s) — ${characterSuggestions.map((s) => `${s.characterId}:${s.suggestionKind}(sal:${s.salience})`).join(", ") || "none"}`);
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
    try {
      const wdPrompt = buildWorldDirectorSystemPrompt(worldAfterPlayer, consolidatedPackage, actorCharacterId, resolutionContext);
      const wdResult = await adapter.call("world_director", wdPrompt, `Step ${atStep}: decide on ${consolidatedPackage.proposals.length} proposal(s).`);
      const wdParsed = await safeParseJson(wdResult.content, WorldDirectorDecisionBatchSchema, "world_director");
      if (wdParsed) {
        const decisions = wdParsed.decisions;
        for (const decision of decisions) {
          const wfs = decision.finalWorkflows.length;
          console.log(`${tag()} [world_direct] proposal=${decision.proposalId} → ${decision.decision} wfs=${wfs}${wfs > 0 ? ` (${decision.finalWorkflows.map((w) => w.actionId).join(",")})` : ""}`);
          if (decision.decision === "approve" || decision.decision === "modify") {
            const proposal = consolidatedPackage.proposals.find((candidate) => candidate.id === decision.proposalId);
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

    // ── Step 10: Final AI workflow review and execution ───────────────────
    emit(onProgress, "manage");
    console.log(`${tag()} [manage] IN: player=${playerCandidates.length} world=${worldDirectorInvocations.length} candidate(s)`);
    const worldCandidates = collectWorldCandidates(worldDirectorInvocations);
    const finalCandidates = [...playerCandidates, ...worldCandidates];
    const managerResult = await runWorkflowManager(adapter, resolutionWorld, finalCandidates, atStep);
    console.log(`${tag()} [manage] OUT: ${managerResult.acceptedInvocations.length}/${finalCandidates.length} workflow(s) accepted`);
    emit(onProgress, "manage", true);

    emit(onProgress, "execute_world");
    const executed = executeWorkflows(
      managerResult.acceptedInvocations,
      resolutionWorld,
      atStep,
    );
    let newWorld = executed.world;
    const allWorkflowLog = executed.log;
    for (const proposal of managerResult.temporaryPatches) {
      const patched = applyTemporaryWorkflowPatch(newWorld, proposal.temporaryPatch, atStep);
      if (patched === null) throw new Error(`Temporary workflow patch could not be applied: ${proposal.intent}`);
      newWorld = patched.world;
      console.log(`${tag()} [temporary-workflow:ok] ${proposal.temporaryPatch.id}: ${patched.summary}`);
    }
    for (const entry of allWorkflowLog) {
      if (entry.outcome.ok) {
        console.log(`${tag()} [execute:ok] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} summary="${entry.outcome.result.summary}"`);
      } else {
        console.error(`${tag()} [execute:fail] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} reason=${entry.outcome.reason}`);
      }
    }
    console.log(`${tag()} [execute_world] OUT: ${allWorkflowLog.filter((e) => e.outcome.ok).length}/${allWorkflowLog.length} workflows applied`);
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

    // Commitment resolution
    const fulfilledCommitmentIds: string[] = [];
    const deferredCommitmentIds: string[] = [];
    const commitmentChronicle: ChronicleEntryInput[] = [];
    for (const commitment of pendingCommitments) {
      const npc = newWorld.characters.find((character) => character.id === commitment.npcCharacterId);
      if (!npc?.alive || commitment.conditions !== "") { deferredCommitmentIds.push(commitment.id); continue; }
      if (commitment.promiseType === "money") {
        const account = newWorld.material.accounts.find((candidate) => candidate.owner.kind === "character" && candidate.owner.id === commitment.playerCharacterId && candidate.status === "active");
        if (account) {
          newWorld.material.accounts = newWorld.material.accounts.map((candidate) => candidate.id === account.id ? { ...candidate, balance: candidate.balance + 25 } : candidate);
          fulfilledCommitmentIds.push(commitment.id);
          commitmentChronicle.push({ sequence: 0, scope: "dialogue_commitment", scopeRef: commitment.id, audience: "all_players", body: `${npc.name} fulfilled a promised financial help.`, atStep, materialConsequence: true });
          continue;
        }
      } else {
        fulfilledCommitmentIds.push(commitment.id);
        commitmentChronicle.push({ sequence: 0, scope: "dialogue_commitment", scopeRef: commitment.id, audience: "all_players", body: `${npc.name} fulfilled a promised ${commitment.promiseType}.`, atStep, materialConsequence: false });
      }
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
      verdicts,
      interpretations,
      characterSuggestions,
      reactionProposals,
      simulatorProposals,
      allWorkflowLog as never,
      finalWorkflowAudit,
      atStep,
      displayPatchByInvocation,
      playerId,
    );
    chronicleInputs = [...chronicleInputs, ...commitmentChronicle].map((entry, sequence) => ({ ...entry, sequence }));

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
      }));
      const narratorSystemPrompt = buildChronicleNarratorPrompt(narratorEntries, resolutionWorld, actorCharacterId, playerKnowledgebase);
      const narratorResult = await adapter.call("chronicle_narrator", narratorSystemPrompt, "Rewrite the events as chronicle prose.");
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

    emit(onProgress, "chronicle", true);

    // ── Step 12: Commit ────────────────────────────────────────────────────
    emit(onProgress, "commit");
    console.log(`${tag()} [commit] IN: step=${atStep} chronicleEntries=${chronicleInputs.length} auditCandidates=${finalWorkflowAudit.candidates.length}`);

    // Update character relevance in newWorld before committing
    const updatedRelevance = updateCharacterRelevance(newWorld.characterRelevance ?? [], chronicleInputs, atStep);
    const finalWorld = {
      ...newWorld,
      elapsedStep: atStep,
      characterRelevance: updatedRelevance,
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
      novelActionProposals: managerResult.temporaryPatches,
    });

    await resolveNpcCommitments(db, fulfilledCommitmentIds, "fulfilled", atStep, "Validated and fulfilled during turn resolution.");
    await resolveNpcCommitments(db, deferredCommitmentIds, "deferred", atStep, "Conditions require a later turn.");

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

    console.log(`${tag()} ══ RESOLUTION COMPLETE ══ step=${atStep} chronicle=${chronicleInputs.length} workflows=${allWorkflowLog.filter((e) => e.outcome.ok).length} temporary=${managerResult.temporaryPatches.length}`);
    emit(onProgress, "commit", true);
    return { workflowDownloads: managerResult.temporaryPatches.map(buildWorkflowDeveloperDownload) };
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
