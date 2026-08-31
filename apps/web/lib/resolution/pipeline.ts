import "server-only";

import { randomUUID } from "node:crypto";
import type {
  OrderBatch,
  OrderDirective,
  WorldState,
  OrderInterpretation,
  OrderAssessment,
  Verdict,
  EventProposal,
  ProposedInvocation,
  CharacterDecision,
  SelectedCharacter,
  StateDelta,
} from "@chronica/shared";
import {
  OrderInterpretationSchema,
  OrderAssessmentSchema,
  VerdictSchema,
  EventProposalSchema,
  CharacterDecisionBatchSchema,
  executeWorkflows,
  buildWorkflowCatalog,
  selectRelevantCharacters,
} from "@chronica/shared";

// The AI does not know the pipeline-assigned directiveId. Strip it from the
// schemas before parse so the AI response doesn't have to include it.
const InterpretParseSchema = OrderInterpretationSchema.omit({ directiveId: true });
const AssessParseSchema = OrderAssessmentSchema.omit({ directiveId: true });
const VerdictParseSchema = VerdictSchema.omit({ directiveId: true });
import type { AiAdapter } from "@chronica/ai";
import type { ChronicaDatabase } from "@chronica/db";
import { commitResolution, failTurn, getOrdersForTurn, claimTurnForResolution, ingestChronicleEntries, getCharacterKnowledgebase, listPendingNpcCommitments, resolveNpcCommitments } from "@chronica/db";
import type { ChronicleEntryInput } from "@chronica/db";
import type { ResolutionProgress, ResolutionStep } from "./types";
import { STEP_LABELS } from "./types";
import {
  buildInterpretSystemPrompt,
  buildAssessSystemPrompt,
  buildAdjudicateSystemPrompt,
  buildNearEventsSystemPrompt,
  buildFarEventsSystemPrompt,
  buildCoarseEventsSystemPrompt,
  buildChronicleNarratorPrompt,
} from "./prompts";
import { buildCharacterDirectorSystemPrompt } from "./character-director-prompt";

export type ProgressCallback = (progress: ResolutionProgress) => void;

// Resolution pipeline — the three-step AI chain plus world simulation.
//
// Designed to be extracted to apps/worker: all dependencies (db, adapter,
// world, onProgress) are parameters. No module-level globals. The only
// web-layer coupling is "server-only" at the top of this file; remove that
// import when moving to the worker.

function emit(onProgress: ProgressCallback, step: ResolutionStep, done = false) {
  onProgress({ step, label: STEP_LABELS[step], done });
}

// Tag every log line with the current turn so they're easy to grep.
let _logTurnId = "";
function tag() { return `[pipeline${_logTurnId ? `:${_logTurnId.slice(0, 8)}` : ""}]`; }

// Extract the first JSON object or array from a string, stripping prose and code fences.
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
    if (result.success && result.data !== undefined) {
      return result.data;
    }
    // Log the Zod error details for debugging.
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

function extractInvocations(
  verdicts: readonly Verdict[],
  events: readonly EventProposal[],
  characterDecisions: readonly CharacterDecision[],
): ProposedInvocation[] {
  const invocations: ProposedInvocation[] = [];
  for (const verdict of verdicts) {
    for (const delta of verdict.deltas) {
      if (delta.kind === "workflow") {
        invocations.push(delta.invocation);
      }
    }
  }
  for (const event of events) {
    for (const action of event.actions) {
      invocations.push(action);
    }
  }
  // Character Director proposals — only from decisions that involve concrete action
  for (const decision of characterDecisions) {
    if (decision.kind === "wait" || decision.kind === "prepare") continue;
    for (const inv of decision.workflowInvocations) {
      invocations.push(inv);
    }
  }
  return invocations;
}

function buildChronicleEntries(
  verdicts: readonly Verdict[],
  interpretations: readonly OrderInterpretation[],
  events: readonly EventProposal[],
  characterDecisions: readonly CharacterDecision[],
  workflowLog: readonly { invocation: ProposedInvocation; outcome: { ok: boolean; result?: { summary: string } } }[],
  atStep: number,
  displayPatchByInvocation: Map<string, unknown>,
): ChronicleEntryInput[] {
  interface RawEntry {
    sortKey: number;
    input: Omit<ChronicleEntryInput, "sequence">;
  }
  const raw: RawEntry[] = [];

  // Player action entries — fixed salience of 600, interleaves with near-events (up to 1000)
  // and above far/coarse events (0–600).
  for (const verdict of verdicts) {
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
        materialConsequence: verdict.deltas.length > 0,
        playerInvolvement: verdict.playerInvolvement,
      },
    });
  }

  // World sim event entries — use event.salience as the sort key so near events
  // (salience 0–1000) interleave with player actions and far/coarse events sit below.
  for (const event of events) {
    for (const action of event.actions) {
      const log = workflowLog.find((l) => l.invocation.actionId === action.actionId);
      const body = log?.outcome.result?.summary ?? `World event: ${action.actionId}`;
      raw.push({
        sortKey: event.salience,
        input: {
          scope: "world_event",
          scopeRef: event.triggerId,
          audience: "all_players",
          body,
          atStep,
          materialConsequence: log?.outcome.ok ?? false,
          displayPatch: displayPatchByInvocation.get(action.actionId),
        },
      });
    }
  }

  // Character Director decision entries — respect visibility; private actions without
  // an observable consequence are omitted entirely from the Chronicle.
  for (const decision of characterDecisions) {
    if (decision.kind === "wait" || decision.kind === "prepare") continue;
    if (decision.visibility === "private" && decision.salience === 0) continue;

    // Find any workflow invocations from this decision that succeeded.
    const successfulSummaries = decision.workflowInvocations
      .map((inv) => workflowLog.find((l) => l.invocation.actionId === inv.actionId && l.outcome.ok))
      .filter(Boolean)
      .map((l) => l!.outcome.result?.summary ?? "")
      .filter(Boolean);

    if (successfulSummaries.length === 0 && decision.visibility === "private") continue;

    const bodyParts: string[] = successfulSummaries;
    if (bodyParts.length === 0 && decision.visibility !== "private") {
      // Rumoured / public decision without a concrete outcome — include as a rumour.
      bodyParts.push(`[Rumour] Character action: ${decision.kind}`);
    }
    if (bodyParts.length === 0) continue;

    // polity-only decisions appear as rumours in the all_players chronicle
    const body = decision.visibility === "polity"
      ? `It is rumoured that: ${bodyParts.join(". ")}`
      : bodyParts.join(". ");

    raw.push({
      sortKey: decision.salience * 100, // scale to match 0-1000 range
      input: {
        scope: "world_event",
        scopeRef: `char-decision-${decision.characterId}`,
        audience: decision.visibility === "private" ? "knowledge_scoped" : "all_players",
        body,
        atStep,
        materialConsequence: successfulSummaries.length > 0,
      },
    });
  }

  // Sort descending: most salient/prominent events appear first in the chronicle.
  raw.sort((a, b) => b.sortKey - a.sortKey);

  return raw.map((r, i) => ({ ...r.input, sequence: i }));
}

/** Build a displayPatch from the world-state diff for map-relevant changes. */
function buildDisplayPatch(before: WorldState, after: WorldState): unknown | undefined {
  const patches: Record<string, unknown>[] = [];

  // Detect province control changes
  for (const pBefore of before.map.provinces) {
    const pAfter = after.map.provinces.find((p) => p.id === pBefore.id);
    if (!pAfter) continue;
    if (pBefore.controllerPolityId !== pAfter.controllerPolityId) {
      patches.push({ kind: "province_control", provinceId: pBefore.id, newControllerPolityId: pAfter.controllerPolityId });
    }
  }

  // Detect force position changes
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
): Promise<void> {
  const { gameId, turnId, world, batch, actorCharacterId, playerId } = input;
  _logTurnId = turnId;
  console.log(`${tag()} starting resolution — gameId=${gameId} actor=${actorCharacterId} directives=${batch.directives.length}`);

  // Claim the turn for resolution
  const claimed = await claimTurnForResolution(db, turnId);
  if (!claimed) {
    // Already being resolved or wrong status
    return;
  }

  try {
    // ── Step 1: Interpret ────────────────────────────────────────────────────
    emit(onProgress, "interpret");
    const interpretations: OrderInterpretation[] = [];
    const systemPrompt = buildInterpretSystemPrompt(world, actorCharacterId);

    for (const [idx, directive] of batch.directives.entries()) {
      if (directive.kind !== "new" && directive.kind !== "revise") continue;
      const userMsg = `Order ${idx + 1}: ${directive.text}\nDirective ID: directive-${idx}`;
      console.log(`${tag()} [interpret] directive-${idx}: ${directive.text.slice(0, 120)}`);
      try {
        const result = await adapter.call("interpret_order", systemPrompt, userMsg);
        console.log(`${tag()} [interpret:raw] directive-${idx}:`, result.content.slice(0, 600));
        const parsed = await safeParseJson(result.content, InterpretParseSchema, `interpret:directive-${idx}`);
        if (parsed) {
          console.log(`${tag()} [interpret:ok] directive-${idx}: intent="${parsed.intent.slice(0, 100)}" steps=${parsed.proposedSteps.length}`);
          interpretations.push({ ...parsed, directiveId: `directive-${idx}` });
        } else {
          console.warn(`${tag()} [interpret:fallback] directive-${idx} — using raw text as intent`);
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
    emit(onProgress, "interpret", true);

    // ── Step 2: Assess ───────────────────────────────────────────────────────
    emit(onProgress, "assess");
    const assessments: OrderAssessment[] = [];
    const assessSystemPrompt = buildAssessSystemPrompt(world, actorCharacterId);

    for (const interpretation of interpretations) {
      const userMsg = `Directive: ${interpretation.intent}\nProposed steps: ${interpretation.proposedSteps.join("; ")}\nRisks: ${interpretation.risks.join("; ")}`;
      console.log(`${tag()} [assess] ${interpretation.directiveId}: "${interpretation.intent.slice(0, 100)}"`);
      try {
        const result = await adapter.call("assess_orders", assessSystemPrompt, userMsg);
        console.log(`${tag()} [assess:raw] ${interpretation.directiveId}:`, result.content.slice(0, 600));
        const parsed = await safeParseJson(result.content, AssessParseSchema, `assess:${interpretation.directiveId}`);
        if (parsed) {
          console.log(`${tag()} [assess:ok] ${interpretation.directiveId}: feasibility=${parsed.feasibility} workflow=${parsed.workflow ? JSON.stringify(parsed.workflow) : "null"}`);
          assessments.push({ ...parsed, directiveId: interpretation.directiveId });
        } else {
          console.warn(`${tag()} [assess:fallback] ${interpretation.directiveId} — no workflow, needsAdjudication=true`);
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
    emit(onProgress, "assess", true);

    // ── Step 3: Adjudicate ───────────────────────────────────────────────────
    emit(onProgress, "adjudicate");
    const verdicts: Verdict[] = [];
    const adjSystemPrompt = buildAdjudicateSystemPrompt(world, actorCharacterId);

    for (const assessment of assessments) {
      const userMsg = `Order: ${assessment.interpretation}\nFeasibility: ${assessment.feasibility}\nWorkflow: ${assessment.workflow ? JSON.stringify(assessment.workflow) : "none"}\nNeeds adjudication: ${assessment.needsAdjudication}`;
      console.log(`${tag()} [adjudicate] ${assessment.directiveId}: feasibility=${assessment.feasibility} workflow=${assessment.workflow?.actionId ?? "none"}`);
      try {
        const result = await adapter.call("adjudicate", adjSystemPrompt, userMsg);
        console.log(`${tag()} [adjudicate:raw] ${assessment.directiveId}:`, result.content.slice(0, 800));
        // Coerce null actorId to the actor character — the AI sometimes outputs null
        // when it doesn't know the ID, but actorId is required (EntityId = string).
        let adjContent = result.content;
        try {
          const raw = JSON.parse(stripToJson(adjContent)) as Record<string, unknown>;
          if (raw && typeof raw === "object" && Array.isArray(raw["deltas"])) {
            const VALID_DELTA_KINDS = new Set(["material_effect", "relationship_cause", "knowledge_grant", "workflow"]);
            raw["deltas"] = (raw["deltas"] as Record<string, unknown>[]).filter((delta) => {
              if (typeof delta["kind"] !== "string" || !VALID_DELTA_KINDS.has(delta["kind"])) {
                console.warn(`${tag()} [adjudicate:delta-strip] removing delta with invalid kind:`, delta["kind"]);
                return false;
              }
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
        } catch { /* leave adjContent as-is if preprocessing fails */ }
        const parsed = await safeParseJson(adjContent, VerdictParseSchema, `adjudicate:${assessment.directiveId}`);
        if (parsed) {
          let finalDeltas: StateDelta[] = parsed.deltas;

          // Safety net: if an economic income order got material_effect instead of add_gold,
          // inject an add_gold workflow delta so money is actually applied.
          const ECONOMIC_INCOME_RE = /\b(sell|sold|trade|earn|income|profit|wares|goods|cargo|merchandise|revenue|payment|receive|collect|spoils)\b/i;
          const hasWorkflowDelta = finalDeltas.some((d) => d.kind === "workflow");
          const isPositiveOutcome = parsed.outcome === "succeeds" || parsed.outcome === "partially_succeeds";
          if (!hasWorkflowDelta && isPositiveOutcome && ECONOMIC_INCOME_RE.test(assessment.interpretation)) {
            const actorAccount = world.material.accounts.find(
              (a) => a.owner.kind === "character" && a.owner.id === actorCharacterId && a.status === "active",
            );
            if (actorAccount) {
              const hasMeaningful = finalDeltas.some((d) => d.kind === "material_effect" && d.effect.magnitude === "meaningful");
              const amount = hasMeaningful ? 200 : 50;
              console.log(`${tag()} [adjudicate:income-repair] injecting add_gold — accountId=${actorAccount.id} amount=${amount}`);
              finalDeltas = [
                ...finalDeltas,
                {
                  kind: "workflow",
                  invocation: {
                    actionId: "add_gold",
                    actorId: actorCharacterId,
                    parameters: { accountId: actorAccount.id, amount, reason: assessment.interpretation.slice(0, 240) },
                  },
                },
              ];
            }
          }

          const workflowDeltas = finalDeltas.filter((d) => d.kind === "workflow");
          const otherDeltas = finalDeltas.filter((d) => d.kind !== "workflow");
          console.log(`${tag()} [adjudicate:ok] ${assessment.directiveId}: outcome=${parsed.outcome} deltas=${finalDeltas.length} (workflows=${workflowDeltas.length} other=${otherDeltas.length})`);
          for (const d of workflowDeltas) {
            if (d.kind === "workflow") {
              console.log(`${tag()} [adjudicate:delta:workflow] actionId=${d.invocation.actionId} actorId=${d.invocation.actorId} params=${JSON.stringify(d.invocation.parameters)}`);
            }
          }
          verdicts.push({ ...parsed, deltas: finalDeltas, directiveId: assessment.directiveId });
        } else {
          const fallbackDeltas = assessment.workflow
            ? [{ kind: "workflow" as const, invocation: { actionId: assessment.workflow.actionId, actorId: actorCharacterId, parameters: assessment.workflow.parameters } }]
            : [];
          console.warn(`${tag()} [adjudicate:fallback] ${assessment.directiveId} — verdict parse failed, using fallback with ${fallbackDeltas.length} delta(s)`);
          verdicts.push({
            directiveId: assessment.directiveId,
            outcome: assessment.feasibility === "impossible" ? "fails" : "partially_succeeds",
            obstacles: [{ source: "Unknown", weight: "trivial", reason: "Could not fully determine outcome." }],
            deltas: fallbackDeltas,
            tacticalModifiers: [],
            timeCost: assessment.estimatedSteps.min > 0 ? assessment.estimatedSteps : { min: 1, max: 1 },
            rationale: `${assessment.interpretation} — outcome uncertain, action partially carried out.`,
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
    emit(onProgress, "adjudicate", true);

    // ── Step 4: World simulation ─────────────────────────────────────────────
    emit(onProgress, "world_sim");
    const worldEvents: EventProposal[] = [];

    // Determine polity tiers
    const playerPolityId = world.characters.find((c) => c.id === actorCharacterId)?.polityId ?? "";
    const allPolityIds = world.map.polities.map((p) => p.id);
    const nearPolityIds = [playerPolityId];

    // Far = polities that share a province border with the player's polity
    const playerProvinces = new Set(world.map.provinces.filter((p) => p.controllerPolityId === playerPolityId).map((p) => p.id));
    const adjacentPolityIds = new Set<string>();
    for (const edge of world.map.edges) {
      const fromProv = world.map.provinces.find((p) => p.id === edge.from);
      const toProv = world.map.provinces.find((p) => p.id === edge.to);
      if (fromProv && toProv) {
        if (playerProvinces.has(fromProv.id) && toProv.controllerPolityId && toProv.controllerPolityId !== playerPolityId) {
          adjacentPolityIds.add(toProv.controllerPolityId);
        }
        if (playerProvinces.has(toProv.id) && fromProv.controllerPolityId && fromProv.controllerPolityId !== playerPolityId) {
          adjacentPolityIds.add(fromProv.controllerPolityId);
        }
      }
    }
    const farPolityIds = [...adjacentPolityIds];
    const coarsePolityIds = allPolityIds.filter((id) => !nearPolityIds.includes(id) && !farPolityIds.includes(id));

    // Near events
    if (playerPolityId) {
      try {
        const nearPrompt = buildNearEventsSystemPrompt(world, playerPolityId);
        const result = await adapter.call("propose_near_events", nearPrompt, `Generate events for season ${world.elapsedStep + 1}.`);
        const parsed = JSON.parse(stripToJson(result.content)) as { events?: unknown[] };
        if (Array.isArray(parsed.events)) {
          for (const raw of parsed.events.slice(0, 6)) {
            const validated = EventProposalSchema.safeParse(raw);
            if (validated.success) worldEvents.push(validated.data);
          }
        }
      } catch { /* world sim is best-effort */ }
    }

    // Far events
    for (const polityId of farPolityIds.slice(0, 3)) {
      try {
        const farPrompt = buildFarEventsSystemPrompt(world, polityId);
        const result = await adapter.call("propose_far_events", farPrompt, `Generate events for season ${world.elapsedStep + 1}.`);
        const parsed = JSON.parse(stripToJson(result.content)) as { events?: unknown[] };
        if (Array.isArray(parsed.events)) {
          for (const raw of parsed.events.slice(0, 3)) {
            const validated = EventProposalSchema.safeParse(raw);
            if (validated.success) worldEvents.push(validated.data);
          }
        }
      } catch { /* world sim is best-effort */ }
    }

    // Coarse events
    if (coarsePolityIds.length > 0) {
      try {
        const coarsePrompt = buildCoarseEventsSystemPrompt(world, coarsePolityIds);
        const result = await adapter.call("propose_coarse_events", coarsePrompt, `Generate background events for season ${world.elapsedStep + 1}.`);
        const parsed = JSON.parse(stripToJson(result.content)) as { events?: unknown[] };
        if (Array.isArray(parsed.events)) {
          for (const raw of parsed.events.slice(0, 3)) {
            const validated = EventProposalSchema.safeParse(raw);
            if (validated.success) worldEvents.push(validated.data);
          }
        }
      } catch { /* world sim is best-effort */ }
    }

    emit(onProgress, "world_sim", true);

    // ── Step 4a: Select relevant characters (deterministic, no AI) ───────────
    const selectedCharacters: SelectedCharacter[] = selectRelevantCharacters(world, actorCharacterId);

    // ── Step 4b: Character Director ──────────────────────────────────────────
    const characterDecisions: CharacterDecision[] = [];
    if (selectedCharacters.length > 0) {
      try {
        const charSystemPrompt = buildCharacterDirectorSystemPrompt(world, selectedCharacters, actorCharacterId);
        const charResult = await adapter.call(
          "character_director",
          charSystemPrompt,
          `Generate decisions for ${selectedCharacters.length} character(s) at step ${world.elapsedStep + 1}.`,
        );
        const charParsed = JSON.parse(stripToJson(charResult.content)) as unknown;
        const charBatch = CharacterDecisionBatchSchema.safeParse(charParsed);
        if (charBatch.success) {
          for (const decision of charBatch.data.decisions) {
            // Validate: character must be alive and in the selected list.
            const isSelected = selectedCharacters.some((sc) => sc.characterId === decision.characterId);
            const isAlive = world.characters.find((c) => c.id === decision.characterId)?.alive ?? false;
            if (isSelected && isAlive) {
              characterDecisions.push(decision);
            }
          }
        } else {
          console.warn("[resolution] Character Director output failed schema validation:", charBatch.error.message.slice(0, 200));
        }
      } catch (err) {
        // Character Director failure must not abort the turn.
        console.error("[resolution] Character Director call failed (continuing):", err);
      }
    }

    // ── Step 5: Execute workflows ────────────────────────────────────────────
    emit(onProgress, "execute");
    const allInvocations = extractInvocations(verdicts, worldEvents, characterDecisions);
    const atStep = world.elapsedStep + 1;
    console.log(`${tag()} [execute] ${allInvocations.length} total invocation(s) queued`);
    for (const inv of allInvocations) {
      console.log(`${tag()} [execute:queued] actionId=${inv.actionId} actorId=${inv.actorId} params=${JSON.stringify(inv.parameters)}`);
    }
    const { world: newWorld, log: workflowLog } = executeWorkflows(allInvocations, world, atStep);
    // Dialogue promises become pending inputs, never immediate chat effects. Resolution applies only bounded, valid outcomes.
    const pendingCommitments = await listPendingNpcCommitments(db, gameId);
    const fulfilledCommitmentIds: string[] = [];
    const deferredCommitmentIds: string[] = [];
    const commitmentChronicle: ChronicleEntryInput[] = [];
    for (const commitment of pendingCommitments) {
      const npc = newWorld.characters.find((character) => character.id === commitment.npcCharacterId);
      if (!npc?.alive || commitment.conditions !== "") { deferredCommitmentIds.push(commitment.id); continue; }
      if (commitment.promiseType === "money") {
        const account = newWorld.material.accounts.find((candidate) => candidate.owner.kind === "character" && candidate.owner.id === commitment.playerCharacterId && candidate.status === "active");
        if (account) {
          const boundedAmount = 25;
          newWorld.material.accounts = newWorld.material.accounts.map((candidate) => candidate.id === account.id ? { ...candidate, balance: candidate.balance + boundedAmount } : candidate);
          fulfilledCommitmentIds.push(commitment.id);
          commitmentChronicle.push({ sequence: 0, scope: "dialogue_commitment", scopeRef: commitment.id, audience: "all_players", body: `${npc.name} fulfilled a promised, modest financial help.`, atStep, materialConsequence: true });
          continue;
        }
      } else {
        fulfilledCommitmentIds.push(commitment.id);
        commitmentChronicle.push({ sequence: 0, scope: "dialogue_commitment", scopeRef: commitment.id, audience: "all_players", body: `${npc.name} fulfilled a promised ${commitment.promiseType}.`, atStep, materialConsequence: false });
      }
    }
    for (const entry of workflowLog) {
      if (entry.outcome.ok) {
        console.log(`${tag()} [execute:ok] actionId=${entry.invocation.actionId} summary="${entry.outcome.result.summary}"`);
      } else {
        console.error(`${tag()} [execute:fail] actionId=${entry.invocation.actionId} reason=${entry.outcome.reason} message="${entry.outcome.message}"`);
      }
    }

    // Build display patches for map-changing workflows.
    const displayPatch = buildDisplayPatch(world, newWorld);

    // Populate per-invocation display patches from successful workflow log entries.
    const displayPatchByInvocation = new Map<string, unknown>();
    for (const entry of workflowLog) {
      if (entry.outcome.ok) {
        const beforeForce = world.material.forces.find((f) => f.id === entry.invocation.parameters["forceId"] as string);
        const afterForce = newWorld.material.forces.find((f) => f.id === entry.invocation.parameters["forceId"] as string);
        if (beforeForce && afterForce && beforeForce.locationId !== afterForce.locationId) {
          displayPatchByInvocation.set(entry.invocation.actionId, {
            kind: "force_moved",
            forceId: beforeForce.id,
            newLocationId: afterForce.locationId,
          });
        }
      }
    }

    emit(onProgress, "execute", true);

    // ── Step 6: Write chronicle ──────────────────────────────────────────────
    emit(onProgress, "chronicle");
    let chronicleInputs = buildChronicleEntries(
      verdicts,
      interpretations,
      worldEvents,
      characterDecisions,
      workflowLog as any,
      atStep,
      displayPatchByInvocation,
    );
    chronicleInputs = [...chronicleInputs, ...commitmentChronicle].map((entry, sequence) => ({ ...entry, sequence }));

    // Attach the overall display patch to the last material-consequence entry
    if (displayPatch && chronicleInputs.length > 0) {
      const lastIdx = chronicleInputs.length - 1;
      chronicleInputs[lastIdx] = { ...chronicleInputs[lastIdx]!, displayPatch };
    }

    // Narrator pass: rewrite raw workflow summaries as vivid historical prose.
    // Best-effort — failures fall back to the original bodies without interrupting resolution.
    try {
      const narratorEntries = chronicleInputs.map((e) => ({
        body: e.body,
        isPlayerAction: e.scope === "directive",
      }));
      const knowledgebase = await getCharacterKnowledgebase(db, gameId, playerId).catch(() => null);
      const narratorSystemPrompt = buildChronicleNarratorPrompt(narratorEntries, world, actorCharacterId, knowledgebase);
      const narratorResult = await adapter.call("chronicle_narrator", narratorSystemPrompt, "Rewrite the events as chronicle prose.");
      const narratorParsed = JSON.parse(stripToJson(narratorResult.content)) as { entries?: { body: string; isPlayerAction: boolean }[] };
      if (Array.isArray(narratorParsed.entries) && narratorParsed.entries.length === chronicleInputs.length) {
        for (let i = 0; i < chronicleInputs.length; i++) {
          const rewritten = narratorParsed.entries[i]?.body;
          if (rewritten && typeof rewritten === "string") {
            chronicleInputs[i] = { ...chronicleInputs[i]!, body: rewritten };
          }
        }
      }
    } catch {
      // Keep original bodies if narrator pass fails.
    }

    emit(onProgress, "chronicle", true);

    // ── Step 7: Commit ───────────────────────────────────────────────────────
    emit(onProgress, "commit");
    await commitResolution(db, {
      gameId,
      turnId,
      newWorld: { ...newWorld, elapsedStep: atStep },
      elapsedStepEnd: atStep,
      chronicleEntries: chronicleInputs,
      stopReason: "player_decision",
    });
    await resolveNpcCommitments(db, fulfilledCommitmentIds, "fulfilled", atStep, "Validated and fulfilled during turn resolution.");
    await resolveNpcCommitments(db, deferredCommitmentIds, "deferred", atStep, "Conditions, availability, or reachability require a later turn.");

    // Ingest chronicle into shared knowledgebase (best-effort).
    // Must be awaited here so the DB connection is still open; the route closes
    // it immediately after resolveTurn returns.
    const playerProvinceId = world.characters.find((c) => c.id === actorCharacterId)?.locationProvinceId;
    await ingestChronicleEntries(db, gameId, chronicleInputs.map((e) => {
      const base = { body: e.body, atStep: e.atStep, audience: e.audience } as const;
      return e.audience === "knowledge_scoped"
        ? { ...base, ...(playerPolityId ? { associatedPolityId: playerPolityId } : {}), ...(playerProvinceId ? { associatedProvinceId: playerProvinceId } : {}) }
        : base;
    })).catch((err: unknown) => {
      console.error("[resolution] ingestChronicleEntries failed", err);
    });

    emit(onProgress, "commit", true);
  } catch (error) {
    console.error("[resolution] pipeline failed", error);
    await failTurn(db, turnId, String(error));
    throw error;
  }
}
