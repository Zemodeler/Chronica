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
} from "@chronica/shared";
import {
  OrderInterpretationSchema,
  OrderAssessmentSchema,
  VerdictSchema,
  executeWorkflows,
  buildWorkflowCatalog,
} from "@chronica/shared";
import type { AiAdapter } from "@chronica/ai";
import type { ChronicaDatabase } from "@chronica/db";
import { commitResolution, failTurn, getOrdersForTurn, claimTurnForResolution, ingestChronicleEntries } from "@chronica/db";
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
} from "./prompts";

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

async function safeParseJson<T>(
  text: string,
  schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { message: string } } },
): Promise<T | null> {
  try {
    const raw = JSON.parse(text) as unknown;
    const result = schema.safeParse(raw);
    return result.success && result.data !== undefined ? result.data : null;
  } catch {
    return null;
  }
}

function extractInvocations(verdicts: readonly Verdict[], events: readonly EventProposal[]): ProposedInvocation[] {
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
  return invocations;
}

function buildChronicleEntries(
  verdicts: readonly Verdict[],
  interpretations: readonly OrderInterpretation[],
  events: readonly EventProposal[],
  workflowLog: readonly { invocation: ProposedInvocation; outcome: { ok: boolean; result?: { summary: string } } }[],
  atStep: number,
  displayPatchByInvocation: Map<string, unknown>,
): ChronicleEntryInput[] {
  const entries: ChronicleEntryInput[] = [];
  let seq = 0;

  // Player action entries from verdicts
  for (const verdict of verdicts) {
    const interpretation = interpretations.find((i) => i.directiveId === verdict.directiveId);
    const body = interpretation
      ? `${interpretation.intent} — ${verdict.rationale}`
      : verdict.rationale;

    entries.push({
      sequence: seq++,
      scope: "directive",
      scopeRef: verdict.directiveId,
      audience: verdict.knowledgeVisibility === "private" ? "knowledge_scoped" : "all_players",
      body,
      atStep,
      materialConsequence: verdict.deltas.length > 0,
      playerInvolvement: verdict.playerInvolvement,
    });
  }

  // World sim event entries
  for (const event of events) {
    for (const action of event.actions) {
      const log = workflowLog.find((l) => l.invocation.actionId === action.actionId);
      const body = log?.outcome.result?.summary ?? `World event: ${action.actionId}`;
      entries.push({
        sequence: seq++,
        scope: "world_event",
        scopeRef: event.triggerId,
        audience: "all_players",
        body,
        atStep,
        materialConsequence: log?.outcome.ok ?? false,
        displayPatch: displayPatchByInvocation.get(action.actionId),
      });
    }
  }

  // Workflow result entries (successful map-changing workflows get a display patch)
  for (const { invocation, outcome } of workflowLog) {
    if (!outcome.ok) continue;
    // territory-changing workflows get a display patch
    if (["change_province_control", "give_territory", "end_siege"].includes(invocation.actionId)) {
      // patch is applied by the chronicle panel client
    }
  }

  return entries;
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
      try {
        const result = await adapter.call("interpret_order", systemPrompt, userMsg);
        const parsed = await safeParseJson(result.content, OrderInterpretationSchema);
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
      } catch {
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
      try {
        const result = await adapter.call("assess_orders", assessSystemPrompt, userMsg);
        const parsed = await safeParseJson(result.content, OrderAssessmentSchema);
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
      } catch {
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
      const interpretation = interpretations.find((i) => i.directiveId === assessment.directiveId);
      const userMsg = `Order: ${assessment.interpretation}\nFeasibility: ${assessment.feasibility}\nWorkflow: ${assessment.workflow ? JSON.stringify(assessment.workflow) : "none"}\nNeeds adjudication: ${assessment.needsAdjudication}`;
      try {
        const result = await adapter.call("adjudicate", adjSystemPrompt, userMsg);
        const parsed = await safeParseJson(result.content, VerdictSchema);
        if (parsed) {
          verdicts.push({ ...parsed, directiveId: assessment.directiveId });
        } else {
          verdicts.push({
            directiveId: assessment.directiveId,
            outcome: "partially_succeeds",
            obstacles: [{ source: "Unknown", weight: "trivial", reason: "Could not fully determine outcome." }],
            deltas: assessment.workflow
              ? [{ kind: "workflow", invocation: { actionId: assessment.workflow.actionId, actorId: actorCharacterId, parameters: assessment.workflow.parameters } }]
              : [],
            tacticalModifiers: [],
            timeCost: assessment.estimatedSteps,
            rationale: assessment.interpretation,
            knowledgeVisibility: "polity",
            playerInvolvement: [{ playerId, characterId: actorCharacterId, role: "actor" }],
          });
        }
      } catch {
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
        const parsed = JSON.parse(result.content) as { events?: unknown[] };
        if (Array.isArray(parsed.events)) {
          for (const event of parsed.events.slice(0, 4)) {
            worldEvents.push(event as EventProposal);
          }
        }
      } catch { /* world sim is best-effort */ }
    }

    // Far events
    for (const polityId of farPolityIds.slice(0, 3)) {
      try {
        const farPrompt = buildFarEventsSystemPrompt(world, polityId);
        const result = await adapter.call("propose_far_events", farPrompt, `Generate events for season ${world.elapsedStep + 1}.`);
        const parsed = JSON.parse(result.content) as { events?: unknown[] };
        if (Array.isArray(parsed.events)) {
          for (const event of parsed.events.slice(0, 2)) {
            worldEvents.push(event as EventProposal);
          }
        }
      } catch { /* world sim is best-effort */ }
    }

    // Coarse events
    if (coarsePolityIds.length > 0) {
      try {
        const coarsePrompt = buildCoarseEventsSystemPrompt(world, coarsePolityIds);
        const result = await adapter.call("propose_coarse_events", coarsePrompt, `Generate background events for season ${world.elapsedStep + 1}.`);
        const parsed = JSON.parse(result.content) as { events?: unknown[] };
        if (Array.isArray(parsed.events)) {
          for (const event of parsed.events.slice(0, 3)) {
            worldEvents.push(event as EventProposal);
          }
        }
      } catch { /* world sim is best-effort */ }
    }

    emit(onProgress, "world_sim", true);

    // ── Step 5: Execute workflows ────────────────────────────────────────────
    emit(onProgress, "execute");
    const allInvocations = extractInvocations(verdicts, worldEvents);
    const atStep = world.elapsedStep + 1;
    const { world: newWorld, log: workflowLog } = executeWorkflows(allInvocations, world, atStep);

    // Build display patches for map-changing workflows
    const displayPatch = buildDisplayPatch(world, newWorld);
    emit(onProgress, "execute", true);

    // ── Step 6: Write chronicle ──────────────────────────────────────────────
    emit(onProgress, "chronicle");
    const displayPatchByInvocation = new Map<string, unknown>();
    const chronicleInputs = buildChronicleEntries(
      verdicts,
      interpretations,
      worldEvents,
      workflowLog as any,
      atStep,
      displayPatchByInvocation,
    );

    // Attach the overall display patch to the last material-consequence entry
    if (displayPatch && chronicleInputs.length > 0) {
      const lastIdx = chronicleInputs.length - 1;
      chronicleInputs[lastIdx] = { ...chronicleInputs[lastIdx]!, displayPatch };
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

    // Ingest chronicle into shared knowledgebase (best-effort, async)
    void ingestChronicleEntries(db, gameId, chronicleInputs.map((e) => {
      const base = { body: e.body, atStep: e.atStep, audience: e.audience } as const;
      return playerPolityId ? { ...base, associatedPolityId: playerPolityId } : base;
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
