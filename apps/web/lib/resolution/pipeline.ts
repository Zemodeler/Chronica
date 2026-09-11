import "server-only";

// Turn resolution (Game Master architecture).
//
// The AI part of a turn is one agent with tools, not a committee, and it is
// the sole authority on every outcome that used to be decided for it: life,
// death, incapacity, what an NPC does, and how a political procedure
// resolves are all its own judgment calls now, informed by read tools that
// report facts (a scenario's authored life-review rates, a procedure's
// recorded support) rather than a pre-computed decision. What stays
// deterministic around it is bookkeeping and physics, not judgment: dialogue
// social events and pressure lifecycle before; battle/war-damage math,
// storyline auto-resolution, and background material society after; then
// Chronicle and commit.
//
// The agent's route to state is `runGameMaster`, which stages every built-in
// or campaign-defined workflow in memory. Prose changes nothing; a defined
// workflow is a named, validated data operation rather than a free-form patch.
// The committed snapshot is written once, at the end, by `commitResolution`.

import type {
  OrderBatch,
  ProposedInvocation,
  SelectedCharacter,
  WorkflowAuditBlob,
  CharacterIntent,
  WorldState,
} from "@chronica/shared";
import {
  executeWorkflow,
  selectRelevantCharacters,
  applySocialEvents,
  advancePressureLifecycle,
  derivePressureTriggers,
  deriveDiplomaticEscalations,
  createPressure,
  netSupportWeight,
  deriveAuthoritySummary,
  chronicleHeadline,
  humanizeRefusalReason,
  isMechanicalFailureReason,
  orderNounPhrase,
  describePoliticalQuestion,
  stripEngineJargon,
  buildCurrentDispatch,
  foldTurnIntoCampaignMemory,
  summarizeTurnFacts,
  DEFAULT_MAX_CHRONICLE_ENTRIES_PER_TURN,
  projectOrdersAndOperations,
  applyCancellationDirectives,
  applyRevisionDirectives,
  ensureProvinceMaterial,
  ensureCharacterAccounts,
  advanceProvinceMaterial,
  applyWarDamageForExecutedWorkflows,
  deriveChronicleDepth,
  estimateWorkflowDurationDays,
  RECORD_REFUSAL_AFTERMATH_TOOL,
  type OrderRefusalFact,
  type ScenarioChronicleRules,
  type ScenarioClock,
  type ScenarioLifeRules,
  type ScenarioGovernmentRules,
} from "@chronica/shared";

import { callWithCoinGate, callWithToolsAndCoinGate, type AiAdapter } from "@chronica/ai";
import type { ChronicaDatabase } from "@chronica/db";
import {
  commitResolution,
  listActiveInventedWorkflows,
  failTurn,
  claimTurnForResolution,
  ingestChronicleEntries,
  getCharacterKnowledgebase,
  getGamePayerUserId,
  listPendingNpcCommitments,
  resolveNpcCommitments,
  listUnappliedCharacterSocialEvents,
  markCharacterSocialEventsApplied,
  markCharacterSocialEventsRejected,
} from "@chronica/db";
import type { ChronicleEntryInput } from "@chronica/db";
import type { InventedWorkflowDefinition } from "@chronica/shared";
import type { ResolutionProgress, ResolutionStep } from "./types";
import { STEP_LABELS } from "./types";
import {
  buildChronicleNarratorPrompt,
  type NarratorEntry,
  type ResolutionPlayerContext,
} from "./prompts";
import { runGameMaster } from "./game-master";
import {
  NARRATOR_EXEMPT_SCOPES,
  NARRATOR_OUTCOME_LOCKED_SCOPES,
  buildChronicleFromFacts,
  rewriteClaimsUnsupportedWar,
} from "./chronicle-from-facts";
import { materializeCanvasProvince } from "../canvas-world";
import { selectDevelopmentActors } from "./world-development-scheduler";
import { decideElasticStop } from "./elastic-scheduler";
import { advanceEventQueue, createDbEventQueuePort } from "./event-loop";
import { deriveWorldInstant, factualEventToFact } from "@chronica/shared";
import { runMultiAgentTurn } from "./agents/orchestrator";
import { createReactionRunner } from "./agents/reaction-runner";
import { advanceProjectsTick, ensureProjectTicksSeeded } from "./project-tick";

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

function capChronicleVisibility(entries: readonly ChronicleEntryInput[], maxVisible: number): ChronicleEntryInput[] {
  const relevancyWeight = (tier: ChronicleEntryInput["playerRelevance"]): number =>
    tier === "high" ? 3 : tier === "medium" ? 2 : tier === "low" ? 1 : 0;
  const isPlayerAction = (entry: ChronicleEntryInput) => entry.scope === "directive" && entry.sourceDirector === "player";
  // The reader sees one deliberately edited page of history, not every event
  // the simulation produced. Player and world entries compete for the same
  // twelve slots; a player entry wins a tie, but a low-stakes player action
  // can still yield to a more relevant war, death, or political upheaval.
  return [...entries]
    .sort((a, b) => {
      const relevanceDiff = relevancyWeight(b.playerRelevance) - relevancyWeight(a.playerRelevance);
      if (relevanceDiff !== 0) return relevanceDiff;
      const playerDiff = Number(isPlayerAction(b)) - Number(isPlayerAction(a));
      if (playerDiff !== 0) return playerDiff;
      const materialDiff = Number(b.materialConsequence) - Number(a.materialConsequence);
      if (materialDiff !== 0) return materialDiff;
      return (a.simulatedDurationDays ?? 1) - (b.simulatedDurationDays ?? 1) || a.sequence - b.sequence;
    })
    .slice(0, maxVisible);
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
      nextDevelopment: `Settled: control passed to ${polityName(newController)}.`,
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
  /** Opening context, tensions, and terminology the Game Master treats as the scenario constitution. */
  readonly scenarioChronicle?: ScenarioChronicleRules | undefined;
  /** The immutable canvas whose province IDs the opening world may materialize on demand. */
  readonly mapAssetId?: string | null;
  /** 1 (default) = today's single-GM path. 2 = the multi-agent dispatcher (docs/32, Part B.7). */
  readonly agentArchitectureVersion?: number;
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
    // Every model call this turn is metered, single-shot and tool loop alike:
    // the Game Master is charged per step, so a wallet that empties mid-turn
    // stops the loop at the next step instead of after the whole turn.
    const coinGatedAdapter: AiAdapter = {
      call: (operation, systemPrompt, userMessage) => callWithCoinGate(
        db, payerUserId, gameId, operation, adapter, { system: systemPrompt, user: userMessage },
      ),
      callWithTools: (operation, systemPrompt, messages, tools) => callWithToolsAndCoinGate(
        db, payerUserId, gameId, operation, adapter, systemPrompt, messages, tools,
      ),
    };
    const gameMasterAdapter = coinGatedAdapter;
    const playerKnowledgebase = await getCharacterKnowledgebase(db, gameId, playerId).catch(() => null);
    const pendingCommitments = await listPendingNpcCommitments(db, gameId);
    const canvasWorld = materializeCanvasProvince(world, input.mapAssetId ?? null, playerKnowledgebase?.locationProvinceId ?? null);
    if (playerKnowledgebase === null) throw new Error("The submitted player has no confirmed character knowledgebase.");
    const playerMaterialization = executeWorkflow({
      actionId: "materialize_declared_player",
      actorId: "system",
      parameters: { characterId: actorCharacterId, knowledgebase: playerKnowledgebase, ...(input.scenarioGovernment === undefined ? {} : { scenarioGovernment: input.scenarioGovernment }) },
    }, canvasWorld, canvasWorld.elapsedStep + 1);
    if (!playerMaterialization.ok) throw new Error(`The submitted player could not enter the world: ${playerMaterialization.message}`);
    const materializedWorld = playerMaterialization.world;

    // ── Step 0: Apply pending dialogue social events ────────────────────────
    //
    // The chat/simulation boundary (character-sim phase 1): dialogue can only
    // ever propose a CharacterSocialEvent, never mutate a Character directly.
    // Turn resolution is the sole authority that validates every reference
    // against canonical state and applies the deterministic deltas, so a
    // dialogue insult, a promise, or a discovered NPC only ever becomes real
    // through the same committed-turn path every other world mutation uses.
    const pendingSocialEvents = await listUnappliedCharacterSocialEvents(db, gameId);
    // Discovery is a request for the Game Master to use create_world_character,
    // not an implicit character mutation. Keep it pending until that tool has
    // created the reserved id on the staged world.
    const pendingContactEvents = pendingSocialEvents.filter((event) => event.kind === "discovery" && event.introducedCharacter !== null);
    const pendingContactDiscoveries = pendingContactEvents.map((event) => ({
      characterId: event.introducedCharacter!.id,
      name: event.introducedCharacter!.name,
      polityId: event.introducedCharacter!.polityId,
      locationProvinceId: event.introducedCharacter!.locationProvinceId,
      roleLabel: event.introducedProfile?.roleLabel ?? "contact",
    }));
    const pendingContactIds = new Set(pendingContactDiscoveries.map((contact) => contact.characterId));
    const resolutionContext: ResolutionPlayerContext = { knowledgebase: playerKnowledgebase, pendingCommitments, pendingContactDiscoveries };
    const socialEventOutcome = applySocialEvents(
      materializedWorld,
      pendingSocialEvents.filter((event) =>
        (event.kind !== "discovery" || event.introducedCharacter === null)
        && !event.participantCharacterIds.some((characterId) => pendingContactIds.has(characterId)),
      ),
      materializedWorld.elapsedStep + 1,
      turnId,
    );
    // Character-sim phase 2: pressure review/decay/expiry runs before
    // character selection, so a stale or spent pressure never shapes this
    // turn's working set.
    const pressureAdvanced = advancePressureLifecycle(socialEventOutcome.world, materializedWorld.elapsedStep + 1);
    // Two backfills for snapshots older than the systems that need them: a
    // material record per province, and a purse for any character created by
    // a runtime workflow back when those workflows named an account without
    // opening it. Both are no-ops once a game is current.
    const backfilled: WorldState = ensureCharacterAccounts(ensureProvinceMaterial({
      ...socialEventOutcome.world,
      characters: [...pressureAdvanced.characters],
      characterPressures: [...pressureAdvanced.characterPressures],
    }, materializedWorld.elapsedStep + 1));
    // Turn foreign occupations and Roman public business into durable,
    // state-backed pressures before character selection.  A power without a
    // living representative stays visible as a real problem for the Game
    // Master to solve with create_world_character; the pipeline never casts
    // one on the model's behalf.
    //
    // docs/32 Phase 7: routed through the persistent event queue instead of
    // an unconditional per-turn call. `advanceEventQueue` seeds and resolves
    // exactly one `midnight_tick` (whose handler is `advanceWorldDynamics`,
    // unchanged) for this turn's day, preserving today's "once per turn"
    // cadence -- windowEnd equals the tick's own day, and the queue's
    // self-scheduling of the *next* day's tick is what carries the daily
    // cadence forward turn over turn. Widening one turn to resolve every day
    // in its window is later, separately reviewed work.
    const preEventQueueDay = deriveWorldInstant(materializedWorld.elapsedStep + 1, input.scenarioClock).day;
    // docs/32, Part C.6: `advance_project` rides the same queue -- a project
    // with a due milestone gets its own pending `world_process_tick` event,
    // seeded here exactly like `midnight_tick` is, and resolved by
    // `advanceProjectsTick` when the queue picks it up.
    await ensureProjectTicksSeeded(createDbEventQueuePort(db, gameId), backfilled, materializedWorld.elapsedStep + 1);
    // docs/32 corrective pass, requirement 3: only `agentArchitectureVersion
    // === 2` gets the real selector/runner and a queue bounded to more than
    // one event per call -- an in-flight v1 campaign's resolution model
    // never changes mid-play, so it keeps exactly today's "one midnight
    // tick, no agent dispatch from the queue" behavior.
    const worldDynamics = await advanceEventQueue(
      db,
      backfilled,
      { day: preEventQueueDay, minute: 0 },
      materializedWorld.elapsedStep + 1,
      {
        gameId,
        maxEventsPerCall: input.agentArchitectureVersion === 2 ? 20 : 1,
        handlers: { world_process_tick: advanceProjectsTick },
        ...(input.agentArchitectureVersion === 2 ? { agentRunner: createReactionRunner(gameMasterAdapter) } : {}),
      },
    );
    const resolutionWorld: WorldState = worldDynamics.world;
    const actor = resolutionWorld.characters.find((character) => character.id === actorCharacterId)!;
    console.log(
      `${tag()} ══ RESOLUTION START ══ gameId=${gameId} actor="${actor.name}" step=${resolutionWorld.elapsedStep} directives=${batch.directives.length} storylines=${(resolutionWorld.storylines ?? []).length} characters=${resolutionWorld.characters.filter((character) => character.alive).length}`,
    );

    // ── Step 1: Prepare the Game Master's working set ─────────────────────
    //
    // What used to be nine AI steps -- interpret, assess, adjudicate, preview,
    // three directors, consolidation, and a workflow manager -- is now one
    // agent with tools. The deterministic work those steps sat between is
    // untouched and still runs here: player materialisation and dialogue
    // social events above, life review and character agency below, political
    // procedures and material society after the agent has acted.
    const atStep = resolutionWorld.elapsedStep + 1;

    // Directive ids are assigned here, not by any model, and every one of them
    // must come back accounted for in the Game Master's turn report.
    const gameMasterDirectives = batch.directives.map((directive, index) => ({
      id: `directive-${index}`,
      directive,
    }));
    // One bounded working set for the whole turn: the characters agency
    // scores and the ones the Game Master is told about are the same people,
    // chosen once by the deterministic selector rather than twice by two
    // different callers.
    const scoredCharacters: SelectedCharacter[] = selectRelevantCharacters(
      resolutionWorld,
      actorCharacterId,
      undefined,
      pendingCommitments.map((commitment) => commitment.npcCharacterId),
    );
    const selectedCharacters: SelectedCharacter[] = [...scoredCharacters];
    // Background reviews have their own small allocation; player activity cannot displace them.
    const developmentActors = selectDevelopmentActors(resolutionWorld, atStep, actorCharacterId);
    for (const selected of developmentActors) {
      const index = selectedCharacters.findIndex(c => c.characterId === selected.characterId);
      if (index < 0) selectedCharacters.unshift(selected);
      else {
        const existing = selectedCharacters[index]!;
        selectedCharacters.splice(index, 1);
        selectedCharacters.unshift({ ...existing, actionAllowance: Math.max(existing.actionAllowance, selected.actionAllowance), reasons: [...selected.reasons, ...existing.reasons] });
      }
    }
    console.log(`${tag()} [game_master] IN: atStep=${atStep} directives=${gameMasterDirectives.length} relevantCharacters=${selectedCharacters.length}`);

    // ── Step 2: Life review — aging, health, incapacity, death ────────────
    //
    // No longer a deterministic roll: the Game Master itself decides, via
    // the list_due_life_reviews read tool (which reports the scenario's own
    // authored rates as information, not a rolled outcome) and the
    // kill_character/incapacitate_character/recover_from_incapacity/
    // settle_estate action tools. This step now only carries the world
    // forward unchanged into the agent's turn.
    emit(onProgress, "life_review");
    const lifeReviewedWorld: WorldState = resolutionWorld;
    const lifeEventChronicle: ChronicleEntryInput[] = [];
    emit(onProgress, "life_review", true);

    // ── Step 3: Character agency ───────────────────────────────────────────
    // No longer a deterministic candidate-generation/ranking pass: the Game
    // Master reads each relevant NPC's goals, plots, pressures, and
    // commitments directly via inspect_actor_memory and decides and executes
    // any NPC action itself through the normal action tools -- no pre-ranked
    // candidate or pre-built proposal is offered on its behalf.
    emit(onProgress, "character_agency");
    const agencyWorld: WorldState = lifeReviewedWorld;
    const resolvedIntents: CharacterIntent[] = [];
    emit(onProgress, "character_agency", true);

    // ── Step 4: Game Master ────────────────────────────────────────────────
    //
    // One agent, one staged world. It reads with the inspect tools, uses
    // built-in or campaign-defined workflows to interact with the data, lets
    // the world answer through those validated tools, and ends with a
    // structured report. Prose never reaches state directly.
    //
    // The staged world is discarded wholesale if anything below throws -- the
    // committed snapshot is only written by `commitResolution` at the very
    // end, so a turn either commits everything or changes nothing.
    emit(onProgress, "game_master");
    // Capabilities this campaign has already given itself. A world that once
    // learned how to send a gift or swear an oath does not have to relearn it
    // every turn -- the definition is persisted and handed back here.
    const definedActions = await listActiveInventedWorkflows(db, gameId)
      .then((rows) => rows.map((row) => row.definition))
      .catch((err: unknown) => {
        console.error(`${tag()} [defined-actions] could not be loaded; this turn runs with built-ins only`, err);
        return [] as InventedWorkflowDefinition[];
      });
    const gameMasterInput = {
      world: agencyWorld,
      atStep,
      actorCharacterId,
      directives: gameMasterDirectives,
      selectedCharacters,
      persistentPlans: true,
      playerContext: resolutionContext,
      scenarioGovernment: input.scenarioGovernment,
      scenarioChronicle: input.scenarioChronicle,
      scenarioLife: input.scenarioLife,
      scenarioClock: input.scenarioClock,
      definedActions,
      // Campaign-defined workflows are available in normal play. A caller can
      // opt out only for a deliberately constrained environment.
      allowInventedActions: process.env.CHRONICA_DISABLE_DEFINED_ACTIONS !== "true",
    };
    // An in-flight campaign's resolution model never changes mid-play, so this
    // branches once per turn on the game's own pinned version rather than a
    // global setting. Version 2 -- the sequenced player/NPC/star-context/
    // closing agents (`agents/orchestrator.ts`) against one staged session --
    // is the architecture, and what every new campaign is created with.
    //
    // Version 1 is deprecated: the single centralized Game Master call
    // (`game-master.ts`), kept only so campaigns that began under it can
    // finish under it. Nothing new should be built against it, and it can be
    // removed once no active game pins version 1.
    const runGameMasterAttempt = () => (input.agentArchitectureVersion === 2
      ? runMultiAgentTurn(gameMasterAdapter, {
        db,
        gameId,
        world: agencyWorld,
        atStep,
        atInstant: deriveWorldInstant(atStep, input.scenarioClock),
        actorCharacterId,
        directives: gameMasterDirectives,
        scenarioGovernment: input.scenarioGovernment,
        scenarioChronicle: input.scenarioChronicle,
        scenarioLife: input.scenarioLife,
        scenarioClock: input.scenarioClock,
        definedActions,
        allowInventedActions: gameMasterInput.allowInventedActions,
        persistentPlans: true,
      })
      : runGameMaster(gameMasterAdapter, gameMasterInput));
    let gameMasterOutcome = await runGameMasterAttempt();

    // A session that did not submit an accepted finish_turn report is not a
    // player-facing outcome. Its staged mutations have not been committed, so
    // start one clean retry from the same pre-GM world rather than carrying
    // partial work forward or writing an "incomplete" Chronicle entry.
    //
    // This is deliberately one retry: repeating a deterministic provider or
    // budget failure forever would hold the turn lock indefinitely.
    const initialGameMasterTermination = gameMasterOutcome.termination;
    if (gameMasterOutcome.report === null) {
      console.warn(
        `${tag()} [game_master] retrying unreported session: termination=${initialGameMasterTermination}; `
        + `discarding ${gameMasterOutcome.executedInvocations.length} staged action(s) and restarting from the pre-GM world`,
      );
      gameMasterOutcome = await runGameMasterAttempt();
      console.warn(
        `${tag()} [game_master] retry finished: initialTermination=${initialGameMasterTermination} `
        + `retryTermination=${gameMasterOutcome.termination} reported=${gameMasterOutcome.report !== null}`,
      );
    }
    const gameMasterCompleted = gameMasterOutcome.report !== null;
    if (!gameMasterCompleted) {
      console.warn(
        `${tag()} [game_master] discarding retry output: termination=${gameMasterOutcome.termination}; `
        + `${gameMasterOutcome.executedInvocations.length} staged action(s) will neither commit nor enter the Chronicle`,
      );
    }
    // docs/32, Part C.1/C.6: a world tool's own facts (e.g. record_fact)
    // never fold into the committed snapshot -- they belong in the fact
    // ledger (Part A's `worldFacts` table), same as the event queue's own
    // handler-produced facts. Discarded along with everything else when the
    // session never reported.
    //
    // docs/32 corrective pass, requirement 4: staged here, not written --
    // every fact this turn produced (world-tool, event-queue, and every
    // successful workflow's own fact below) is inserted inside
    // `commitResolution`'s single transaction, never before it.
    const worldToolFacts = gameMasterCompleted ? gameMasterOutcome.worldToolFacts : [];
    // A second unreported session is no more authoritative than the first.
    // Preserve only deterministic pre-GM work (social events, pressure
    // maintenance, and world setup); otherwise partial actions would both
    // alter the world and leak through the Chronicle's forgotten-facts pass.
    let newWorld: WorldState = gameMasterCompleted ? gameMasterOutcome.world : agencyWorld;
    // Now that the Game Master has had the pending discovery requests, fold
    // only those whose reserved id it created into the social-event ledger.
    // Uncalled requests remain proposed for the next turn; they cannot add a
    // character merely because a prior AI response mentioned one.
    const materializedContactEvents = pendingContactEvents.filter((event) =>
      newWorld.characters.some((character) => character.id === event.introducedCharacter!.id),
    );
    const contactSocialOutcome = applySocialEvents(newWorld, materializedContactEvents, atStep, turnId);
    newWorld = contactSocialOutcome.world;
    // Dialogue with a just-discovered person may already be queued. Apply it
    // only after the Game Master actually created that person; otherwise it
    // remains pending instead of being rejected for an absent participant.
    const readyContactDialogueEvents = pendingSocialEvents.filter((event) =>
      event.kind !== "discovery"
      && event.participantCharacterIds.some((characterId) => pendingContactIds.has(characterId))
      && event.participantCharacterIds.every((characterId) => newWorld.characters.some((character) => character.id === characterId)),
    );
    const contactDialogueOutcome = applySocialEvents(newWorld, readyContactDialogueEvents, atStep, turnId);
    newWorld = contactDialogueOutcome.world;
    const committedGameMasterEvents = gameMasterCompleted ? gameMasterOutcome.events : [];
    const factualEvents = [
      ...committedGameMasterEvents,
      ...worldDynamics.handlerEvents.map((event, index) => ({ ...event, id: `fact-${atStep}-${committedGameMasterEvents.length + index + 1}` })),
    ];
    const capabilityRequests = gameMasterCompleted ? gameMasterOutcome.capabilityRequests : [];
    // docs/32 corrective pass, requirement 4/5: every successful
    // state-changing workflow this turn also emits one durable Fact into the
    // canonical ledger -- not just Chronicle prose (`chronicleInputs`, built
    // separately from the same `factualEvents`) that a later agent has no
    // way to query back. Stamped with the turn's real `WorldInstant`, the
    // same one the Game Master's own world tools use.
    const turnInstant = deriveWorldInstant(atStep, input.scenarioClock);
    const canonicalWorkflowFacts = committedGameMasterEvents
      .filter((event) => event.materialConsequence)
      .map((event) => factualEventToFact(event, turnInstant));
    const allWorldFacts = [...worldDynamics.facts, ...worldToolFacts, ...canonicalWorkflowFacts];
    console.log(
      `${tag()} [game_master] OUT: termination=${gameMasterOutcome.termination} committed=${gameMasterCompleted} `
      + `actions=${gameMasterOutcome.executedInvocations.length} facts=${factualEvents.length} capabilityGaps=${capabilityRequests.length}`,
    );
    if (gameMasterOutcome.providerError !== null) {
      console.error(`${tag()} [game_master] provider error: ${gameMasterOutcome.providerError}`);
    }
    // Once the clean retry also ends without a report, its work has already
    // been discarded above. Keep the deterministic part of the turn instead
    // of manufacturing an error card or committing partial GM state. The
    // termination remains in the persisted diagnostic record and logs.
    if (!gameMasterCompleted && gameMasterOutcome.termination === "provider_error") {
      console.warn(
        `${tag()} [game_master] provider remained unavailable after retry; committing no Game Master actions. `
        + `reason=${gameMasterOutcome.providerError ?? "unknown"}`,
      );
    }
    emit(onProgress, "game_master", true);

    // Audit is the session's, verbatim: every refusal carries the exact
    // deterministic reason the policy or the executor produced.
    const finalWorkflowAudit: WorkflowAuditBlob = {
      candidates: gameMasterCompleted ? [...gameMasterOutcome.auditEntries] : [],
      novelActionProposals: [],
      managerFailed: gameMasterOutcome.termination === "provider_error",
      atStep,
    };
    const allWorkflowLog: { invocation: ProposedInvocation; outcome: { ok: boolean; reason?: string; message?: string; result?: { summary: string } } }[] =
      (gameMasterCompleted ? gameMasterOutcome.auditEntries : []).map((entry) => ({
        invocation: entry.finalInvocation ?? entry.requestedInvocation,
        outcome: entry.executionOk === true
          ? { ok: true, result: { summary: factualEvents.find((event) => event.actionId === entry.requestedActionId)?.summary ?? entry.requestedActionId } }
          : { ok: false, message: entry.executionReason ?? "Refused." },
      }));

    // ── Step 5/6: Political procedures ─────────────────────────────────────
    // No longer auto-resolved by the pipeline: the Game Master decides when
    // and how a due procedure resolves, via the list_due_political_procedures
    // read tool and the resolve_procedure action tool -- both already
    // captured in gameMasterOutcome.auditEntries/events like any other tool
    // call, so there is nothing further to execute or audit here.
    emit(onProgress, "resolve_politics");
    emit(onProgress, "resolve_politics", true);

    emit(onProgress, "execute_world");

    newWorld = autoResolveDecidedStorylines(world, newWorld, atStep);

    // Background material society (docs/14 Phase 2): coarse war damage for
    // exactly the provinces this turn's military workflows touched, then a
    // cheap, bounded recovery tick for every other province -- never a
    // full-world recompute per event.
    const successfulInvocations = allWorkflowLog.filter((entry) => entry.outcome.ok).map((entry) => entry.invocation);
    const warDamageResult = applyWarDamageForExecutedWorkflows(newWorld, successfulInvocations, atStep);
    newWorld = advanceProvinceMaterial(warDamageResult.world, atStep, warDamageResult.affectedProvinceIds);

    // Explicit cancellation (docs/14 Phase 6): a "cancel" directive names an
    // existing OngoingAction id directly, so it needs no AI interpretation --
    // applied deterministically here, before this turn's own new actions are
    // projected, so a cancelled operation stops without touching what
    // already happened to it.
    const cancelledIds = batch.directives.filter((directive) => directive.kind === "cancel").map((directive) => directive.actionId);
    const cancelActionIds = [...cancelledIds, ...resolutionWorld.actions.filter(a => cancelledIds.includes(a.sourceIntentId)).map(a => a.id)];
    const cancellation = applyCancellationDirectives(resolutionWorld.actions ?? [], resolutionWorld.operations ?? [], cancelActionIds, atStep);

    // Explicit revision (docs/14 Phase 6 follow-on): a "revise" directive
    // also names an existing action directly, so -- like cancellation -- it
    // needs no AI interpretation, and is applied deterministically here,
    // right after cancellation and before this turn's new actions are
    // projected.
    const reviseDirectives = batch.directives
      .filter((directive) => directive.kind === "revise")
      .map((directive) => ({ actionId: directive.actionId, text: directive.text }));
    const revision = applyRevisionDirectives(cancellation.actions, cancellation.operations, reviseDirectives, atStep, atStep);
    const revisionChronicle: ChronicleEntryInput[] = revision.revised.map((revised) => {
      const actor = newWorld.characters.find((character) => character.id === revised.actorId);
      const actorName = actor?.name ?? revised.actorId;
      return {
        sequence: 0,
        scope: "order_revision",
        scopeRef: `${revised.actionId}:${atStep}`,
        audience: "all_players",
        body: `${actorName} revises an order already under way: ${revised.text}`,
        atStep,
        materialConsequence: false,
        simulatedDurationDays: 1,
        title: `${actorName} Revises an Order`,
        knowledgeStatus: "confirmed",
        participants: actor ? [{ name: actor.name }] : [],
        playerRelevance: revised.actorId === actorCharacterId ? "high" : "low",
        depth: deriveChronicleDepth({ playerRelevance: revised.actorId === actorCharacterId ? "high" : "low", materialConsequence: false, isPlayerAction: revised.actorId === actorCharacterId }),
        ...(revised.chronicleChainId ? { chainId: revised.chronicleChainId } : {}),
      };
    });
    const cancellationChronicle: ChronicleEntryInput[] = cancellation.cancelled.map((cancelled) => {
      const actor = newWorld.characters.find((character) => character.id === cancelled.actorId);
      const actorName = actor?.name ?? cancelled.actorId;
      return {
        sequence: 0,
        scope: "order_cancellation",
        scopeRef: `${cancelled.actionId}:${atStep}`,
        audience: "all_players",
        body: `${actorName} calls off an order already under way.`,
        atStep,
        materialConsequence: false,
        simulatedDurationDays: 1,
        title: `${actorName} Calls Off an Order`,
        knowledgeStatus: "confirmed",
        participants: actor ? [{ name: actor.name }] : [],
        playerRelevance: cancelled.actorId === actorCharacterId ? "high" : "low",
        depth: deriveChronicleDepth({ playerRelevance: cancelled.actorId === actorCharacterId ? "high" : "low", materialConsequence: false, isPlayerAction: cancelled.actorId === actorCharacterId }),
        ...(cancelled.chronicleChainId ? { chainId: cancelled.chronicleChainId } : {}),
      };
    });

    // Universal order/operation model (docs/14, Phase 1): project this
    // turn's complete audit trail -- player, NPC, and world-director
    // candidates alike, already resolved above through the single Workflow
    // Manager gate -- into persisted `OngoingAction`/`PersistentOperation`
    // records. An authority/policy rejection becomes a grounded refusal fact
    // instead of vanishing from the audit blob unseen.
    const orderProjection = projectOrdersAndOperations({
      previousActions: revision.actions,
      previousOperations: revision.operations,
      candidates: finalWorkflowAudit.candidates,
      turnIndex: atStep,
      atStep,
      isLongRunningAction: (actionId) => estimateWorkflowDurationDays([actionId]) >= 14,
    });
    // A named refusal aftermath is the richer record of the same failed
    // request. Do not also print the generic engine-only refusal beside it.
    const refusalsWithNamedAftermath = new Set(
      factualEvents
        .filter((event) => event.actionId === RECORD_REFUSAL_AFTERMATH_TOOL)
        .map((event) => [String(event.parameters["requesterCharacterId"]), String(event.parameters["rejectedActionId"])].join("::")),
    );
    const orderRefusalChronicle: ChronicleEntryInput[] = orderProjection.refusals
      .filter((refusal: OrderRefusalFact) => !refusalsWithNamedAftermath.has([refusal.actorId, refusal.actionId].join("::")))
      .map((refusal: OrderRefusalFact) => {
      const actor = newWorld.characters.find((character) => character.id === refusal.actorId);
      const actorName = actor?.name ?? refusal.actorId;
      // A refusal is history too, and is written as history: about the deed
      // that did not happen rather than about the order that named it. The
      // fact that nothing followed is exact; the reason is the engine's own,
      // restated in plain words rather than in the executor's.
      const noun = orderNounPhrase(refusal.actionId);
      // A dry-run or execution failure whose reason is about the call rather
      // than the world is not a refusal, and must not be written as one: no
      // one heard this, so no one can have turned it down. Same distinction
      // `buildChronicleFromFacts` draws for a player directive.
      const mechanical = refusal.kind !== "authority" && isMechanicalFailureReason(refusal.reason);
      const verb = refusal.kind === "authority" ? "was refused him"
        : mechanical ? "could not be carried through as it was given"
        : "found no ears";
      const closing = mechanical ? "No one refused it, and the matter remains open." : "The matter went no further.";
      return {
        sequence: 0,
        scope: mechanical ? "order_unresolved" : "order_refusal",
        scopeRef: `${refusal.actorId}:${refusal.actionId}:${atStep}`,
        audience: "all_players",
        body: `${actorName} pressed for ${noun}, but it ${verb}: ${humanizeRefusalReason(refusal.reason)}. ${closing}`,
        atStep,
        materialConsequence: false,
        simulatedDurationDays: 1,
        title: chronicleHeadline(`${noun.replace(/^the /, "The ")} ${mechanical ? "Left Unresolved" : "Refused"}`),
        knowledgeStatus: "confirmed",
        participants: actor ? [{ name: actor.name }] : [],
        playerRelevance: refusal.actorId === actorCharacterId ? "high" : "low",
        depth: deriveChronicleDepth({ playerRelevance: refusal.actorId === actorCharacterId ? "high" : "low", materialConsequence: false, isPlayerAction: refusal.actorId === actorCharacterId }),
      };
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
    // A procedure the Game Master resolved by calling resolve_procedure is
    // already in this turn's factual event log, and buildChronicleFromFacts
    // writes it -- the same dedup this file already applies to a procedure's
    // opening, just for its resolution.
    const proceduresResolvedByFact = new Set(
      factualEvents
        .filter((event) => event.actionId === "resolve_procedure" && typeof event.parameters["procedureId"] === "string")
        .map((event) => event.parameters["procedureId"] as string),
    );
    const politicalChronicle: ChronicleEntryInput[] = [];
    for (const procedure of newWorld.material.politicalProcedures) {
      if (procedure.resolvedAtStep !== atStep) continue;
      if (proceduresResolvedByFact.has(procedure.id)) continue;
      const sponsor = newWorld.characters.find((c) => c.id === procedure.sponsorCharacterId);
      const institution = procedure.institutionId
        ? newWorld.material.institutions.find((i) => i.id === procedure.institutionId)
        : undefined;
      const outcome = procedure.outcome ?? "failed";
      const weights = netSupportWeight({ characters: newWorld.characters, material: newWorld.material }, procedure);
      const question = describePoliticalQuestion(newWorld, procedure);
      const outcomeVerb = outcome === "passed" ? "approves" : outcome === "blocked" ? "sets aside" : outcome === "withdrawn" ? "withdraws" : "rejects";
      politicalChronicle.push({
        sequence: 0,
        scope: "political_procedure",
        scopeRef: procedure.id,
        audience: procedure.visibility === "private" ? "knowledge_scoped" : "all_players",
        body: stripEngineJargon(`${institution?.name ?? "The authority"} ${outcomeVerb} the question of ${question}, brought forward by ${sponsor?.name ?? "a sponsor"}. ${procedure.outcomeReason ?? ""}`.trim()),
        atStep,
        materialConsequence: outcome === "passed",
        simulatedDurationDays: 1,
        title: chronicleHeadline(`${institution?.name ?? "The authority"} ${outcomeVerb} the question of ${question}`),
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

    // A procedure's *opening* otherwise has no Chronicle entry at all --
    // only its resolution does, above (docs/18 Phase 2 follow-on: "taxation
    // ... never opens a real political procedure", now that one can).
    // A procedure the Game Master opened by tool call is already in this
    // turn's factual event log, and buildChronicleFromFacts writes it. Writing
    // it a second time here from the world diff is the same opening told
    // twice, under two different headlines.
    const proceduresOpenedByFact = new Set(
      factualEvents
        .filter((event) => event.actionId === "sponsor_procedure" && typeof event.parameters["procedureId"] === "string")
        .map((event) => event.parameters["procedureId"] as string),
    );
    for (const procedure of newWorld.material.politicalProcedures) {
      if (procedure.openedAtStep !== atStep || procedure.resolvedAtStep === atStep) continue;
      if (proceduresOpenedByFact.has(procedure.id)) continue;
      const institution = procedure.institutionId
        ? newWorld.material.institutions.find((i) => i.id === procedure.institutionId)
        : undefined;
      const polity = procedure.subjectKind === "polity" && procedure.subjectId
        ? newWorld.map.polities.find((p) => p.id === procedure.subjectId)
        : undefined;
      const question = describePoliticalQuestion(newWorld, procedure);
      const against = polity?.name ?? institution?.name ?? "the ruling authority";
      politicalChronicle.push({
        sequence: 0,
        scope: "political_procedure_opened",
        scopeRef: procedure.id,
        audience: procedure.visibility === "private" ? "knowledge_scoped" : "all_players",
        body: procedure.sponsorCharacterId === "system"
          ? `Opposition rises against ${against}: ${question}${institution ? ` is put before the ${institution.name}` : " is now under consideration"}.`
          : `${newWorld.characters.find((c) => c.id === procedure.sponsorCharacterId)?.name ?? "A sponsor"} brings ${question}${institution ? ` before the ${institution.name}` : ""}.`,
        atStep,
        materialConsequence: false,
        simulatedDurationDays: 1,
        title: procedure.sponsorCharacterId === "system" ? `Opposition Rises Against ${against}` : chronicleHeadline(`A Decision on ${question}`),
        knowledgeStatus: "confirmed",
        institutions: institution ? [{ name: institution.name }] : [],
        playerRelevance: procedure.eligibleParticipantIds.includes(actorCharacterId) ? "high" : "medium",
        depth: deriveChronicleDepth({ playerRelevance: "medium", materialConsequence: false, isPlayerAction: false }),
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

    // A resolved battle needs no separate Chronicle stream any more: the
    // deterministic resolver runs inside the Game Master session, and the
    // session derives the battle brief (casualties, retreats, outcome) from
    // the staged world either side of it. buildChronicleFromFacts carries
    // that brief straight onto the entry.

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

    emit(onProgress, "execute_world", true);

    // ── Step 7: Chronicle ──────────────────────────────────────────────────
    emit(onProgress, "chronicle");
    // Downstream of the engine, always: every body here is an executor
    // summary or the exact limitation text of an unsupported attempt.
    let chronicleInputs = buildChronicleFromFacts({
      world: newWorld,
      atStep,
      actorCharacterId,
      events: factualEvents,
      report: gameMasterCompleted ? gameMasterOutcome.report : null,
      directiveIds: gameMasterDirectives.map((entry) => entry.id),
      scenarioClock: input.scenarioClock,
    });
    if (gameMasterOutcome.report === null) {
      const incompleteEntries = chronicleInputs.filter((entry) => entry.scope === "resolution_incomplete");
      if (incompleteEntries.length > 0) {
        chronicleInputs = chronicleInputs.filter((entry) => entry.scope !== "resolution_incomplete");
        console.warn(
          `${tag()} [chronicle] filtered ${incompleteEntries.length} resolution_incomplete placeholder(s): `
          + `Game Master did not submit finish_turn after retry (initialTermination=${initialGameMasterTermination}, retryTermination=${gameMasterOutcome.termination})`,
        );
      }
    }
    chronicleInputs = scheduleChronicleEntries(capChronicleVisibility([
      ...chronicleInputs,
      ...commitmentChronicle,
      ...politicalChronicle,
      ...lifeEventChronicle,
      ...commandChangeChronicle,
      ...familyEventChronicle,
      ...orderRefusalChronicle,
      ...cancellationChronicle,
      ...revisionChronicle,
    // Reserve one of the twelve visible Chronicle slots for the dispatch
    // header appended below. Player and world events therefore share the
    // remaining eleven slots rather than quietly producing a thirteenth row.
    ], Math.max(0, DEFAULT_MAX_CHRONICLE_ENTRIES_PER_TURN - 1)));

    if (displayPatch && chronicleInputs.length > 0) {
      const lastIdx = chronicleInputs.length - 1;
      chronicleInputs[lastIdx] = { ...chronicleInputs[lastIdx]!, displayPatch };
    }

    console.log(`${tag()} [chronicle] IN: ${chronicleInputs.length} raw entries — ${chronicleInputs.map((e) => `${e.scope}(src:${e.sourceDirector ?? "?"},pos:${e.chainPosition ?? "?"})`).join(", ")}`);

    // Narrator pass
    let narratorOk = false;
    try {
        // Rule refusals and incomplete attempts are
      // already exact, executor-derived records. Keeping them out of the
      // free-form narrator prevents a rejected action from acquiring an
      // invented institutional explanation, a completed action from being
      // recast as an unfinished process, and an unsupported attempt from
      // being narrated as though it had an effect.
      const narratorTargets = chronicleInputs
        .map((entry, index) => ({ entry, index }))
        // Naming a pre-existing leader is an identity update, not an event in
        // which that person comes into being. Its deterministic wording is
        // already reader-facing, so keep it out of free-form narration where
        // it could turn into a fictional "emergence" or new actor.
        .filter(({ entry }) => !NARRATOR_EXEMPT_SCOPES.has(entry.scope)
          && !(entry.factActionIds?.length === 1 && entry.factActionIds[0] === "rename_character"));
      const narratorEntries: NarratorEntry[] = narratorTargets.map(({ entry: e }) => ({
        body: e.body,
        isPlayerAction: e.scope === "directive",
        // A carried-out order is narrated -- that is what a chronicle is for --
        // but under a lock: its facts are already settled, so the rewrite adds
        // voice and consequence and can never make it pending or uncertain.
        outcomeLocked: NARRATOR_OUTCOME_LOCKED_SCOPES.has(e.scope),
        chainPosition: e.chainPosition ?? null,
        chainId: e.chainId ?? null,
        sourceDirector: e.sourceDirector,
        knowledgeStatus: e.knowledgeStatus,
        depth: e.depth,
        battleBrief: e.battleBrief,
        characterMentions: e.characterMentions
          ?.map((mention) => {
            const character = newWorld.characters.find((candidate) => candidate.id === mention.characterId && candidate.alive);
            return character ? { name: character.name, role: mention.role } : null;
          })
          .filter((mention): mention is { name: string; role: string } => mention !== null),
      }));
      if (narratorEntries.length > 0) {
        const narratorSystemPrompt = buildChronicleNarratorPrompt(narratorEntries, resolutionWorld, actorCharacterId, playerKnowledgebase);
        const narratorResult = await coinGatedAdapter.call("chronicle_narrator", narratorSystemPrompt, "Rewrite the events as chronicle prose.");
        const narratorParsed = JSON.parse(stripToJson(narratorResult.content)) as { entries?: { body: string; headline?: string; isPlayerAction: boolean }[] };
        if (Array.isArray(narratorParsed.entries) && narratorParsed.entries.length === narratorTargets.length) {
          for (let i = 0; i < narratorTargets.length; i++) {
            const rewritten = narratorParsed.entries[i]?.body;
            const headline = narratorParsed.entries[i]?.headline;
            const chronicleIndex = narratorTargets[i]!.index;
            if (rewritten && typeof rewritten === "string") {
              const originalEntry = chronicleInputs[chronicleIndex]!;
              // The narrator is free to add voice, but never a material
              // outcome the engine never recorded: a `start_war` claim -- "X
              // declares war" -- must be backed by an actual, successful
              // `start_war` fact. A character merely created, renamed, or
              // selected as a polity's new voice must never be rewritten as
              // having declared war on anyone. Reject the rewrite and keep
              // the factual body when it isn't.
              if (rewriteClaimsUnsupportedWar(rewritten, originalEntry.factActionIds)) {
                console.warn(`${tag()} [chronicle:narrator] rejected rewrite for entry ${chronicleIndex} (scope=${originalEntry.scope}) -- claims war without a successful start_war fact`);
                continue;
              }
              // A headline the chronicler wrote is a title; anything else is
              // put through the same deterministic scrub as the rest, so no
              // identifier or half-word ever reaches the panel as a heading.
              const title = typeof headline === "string" && headline.trim().length > 0
                ? chronicleHeadline(headline)
                : originalEntry.title;
              chronicleInputs[chronicleIndex] = {
                ...originalEntry,
                body: stripEngineJargon(rewritten),
                ...(title ? { title } : {}),
              };
            }
          }
          narratorOk = true;
        } else {
          console.warn(`${tag()} [chronicle:narrator] length mismatch — expected ${narratorTargets.length}, got ${narratorParsed.entries?.length ?? "?"}; using raw bodies`);
        }
      } else {
        narratorOk = true;
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
        consequences: (e.directConsequences ?? []).filter((c) => c.quantified).map((c) => c.label),
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

    // ── Step 8: Commit ─────────────────────────────────────────────────────
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
    const appliedSocialEventIds = [...socialEventOutcome.appliedIds, ...contactSocialOutcome.appliedIds, ...contactDialogueOutcome.appliedIds];
    const appliedSocialEventSummaries = pendingSocialEvents
      .filter((event) => appliedSocialEventIds.includes(event.id))
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
    // An ultimatum rejected (or left standing unanswered) more than once on
    // the same thread must not just repeat itself: this reads what the
    // message record already says -- never invents a repeat -- and presses
    // the offended sender's own leader toward a real reaction, the same
    // deterministic path every other pressure trigger already takes. It is a
    // real pressure record the sender's leader carries into next turn's
    // inspect_actor_memory, not merely a flavor note the Game Master might notice.
    const diplomaticEscalations = deriveDiplomaticEscalations(newWorld.diplomacy, atStep);
    const diplomaticEscalationTriggers = diplomaticEscalations
      .filter((escalation) => newWorld.characters.some((character) => character.id === escalation.senderCharacterId && character.alive))
      .map((escalation) => {
        const recipientName = newWorld.map.polities.find((polity) => polity.id === escalation.recipientPolityId)?.name ?? escalation.recipientPolityId;
        return {
          id: `pressure-diplomatic-escalation-${escalation.messageId}-${atStep}`,
          characterId: escalation.senderCharacterId,
          kind: "political_danger" as const,
          intensity: Math.min(100, 50 + escalation.refusalCount * 15),
          label: `${recipientName} has rebuffed the same demand over "${escalation.subject}" ${escalation.refusalCount} time${escalation.refusalCount === 1 ? "" : "s"} running; repeating it again settles nothing.`,
          sourceEventId: escalation.messageId,
          atStep,
          reviewInSteps: 3,
          expiresInSteps: 16,
          visibility: "polity" as const,
        };
      });
    let worldWithTriggeredPressures: WorldState = newWorld;
    for (const trigger of [...pressureTriggers, ...diplomaticEscalationTriggers]) {
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
      // Universal order/operation model (docs/14, Phase 1): this turn's
      // complete order history plus every still-open persistent operation,
      // carried forward from prior turns and extended above.
      actions: orderProjection.actions,
      operations: orderProjection.operations,
      // Character-sim phase 3: this turn's resolved intents (executed,
      // blocked, deferred, failed, abandoned), each carrying the reason it
      // ended up where it did, appended to recent history and capped so this
      // never grows into a whole-population log. Bounded to this turn's
      // principal working set (at most `MAX_CHARACTERS_PER_TURN`), so the cap
      // covers many turns of real history, not just one.
      characterIntents: [...(worldWithTriggeredPressures.characterIntents ?? []), ...resolvedIntents].slice(-200),
      lastTurnSummary: summarizeResolvedTurn(chronicleInputs, atStep),
      // Compact campaign memory (GM refactor, requirement 6): built from
      // this turn's factual event log, not from the Chronicle prose the
      // narrator just rewrote, and compacted deterministically so a long
      // campaign keeps a bounded, honest record of itself.
      campaignMemory: foldTurnIntoCampaignMemory(
        worldWithTriggeredPressures.campaignMemory,
        summarizeTurnFacts(atStep, factualEvents, capabilityRequests),
      ),
    };

    // Shadow-mode only (docs/32, Phase 7): computes what an elastic scheduler
    // would have decided, purely for later comparison. `elapsedStepEnd`/
    // `stopReason` below remain exactly what they were before this phase --
    // the live pipeline still resolves one turn per call and always returns
    // control to the player, regardless of this decision.
    const elasticShadowDecision = decideElasticStop({
      elapsedStepStart: resolutionWorld.elapsedStep,
      scenarioClock: input.scenarioClock,
      factualEvents,
      plans: finalWorld.playerPlans ?? [],
    });

    const definedWorkflows = gameMasterCompleted
      ? gameMasterOutcome.definedActions.map((definition) => ({
        id: `defined-${gameId}-${definition.actionId}`,
        gameId,
        definition,
        status: "active" as const,
      }))
      : [];
    const definedWorkflowUses = gameMasterCompleted
      ? gameMasterOutcome.definedActionUses.map((use) => ({
        workflowId: `defined-${gameId}-${use.actionId}`,
        parameters: use.parameters,
        resolvedPatch: use.resolvedPatch,
        success: true,
      }))
      : [];

    await commitResolution(db, {
      gameId,
      turnId,
      newWorld: finalWorld,
      elapsedStepEnd: atStep,
      chronicleEntries: chronicleInputs,
      stopReason: "player_decision",
      elapsedDayEnd: elasticShadowDecision.elapsedDayEnd,
      stoppingFactIds: elasticShadowDecision.stoppingFactIds,
      requestedPlayerDecision: elasticShadowDecision.requestedPlayerDecision,
      workflowAudit: finalWorkflowAudit,
      inventedWorkflows: definedWorkflows,
      inventedWorkflowUses: definedWorkflowUses,
      capabilityRequests,
      worldFacts: allWorldFacts,
      pendingWorldEvents: worldDynamics.pendingEventInserts,
      pendingEventResolutions: worldDynamics.pendingResolutions,
      gameMasterReport: {
        atStep,
        termination: gameMasterOutcome.termination,
        modelSteps: gameMasterOutcome.modelSteps,
        report: gameMasterOutcome.report,
        events: factualEvents.map((event) => ({
          id: event.id,
          kind: event.kind,
          actionId: event.actionId,
          actorId: event.actorId,
          summary: event.summary,
          materialConsequence: event.materialConsequence,
        })),
        capabilityRequestIds: capabilityRequests.map((request) => request.id),
      },
      gameMasterAudit: gameMasterCompleted ? gameMasterOutcome.auditEntries : [],
    });

    // Defined workflows and their use records now commit with the staged
    // world. A later turn can therefore rely on every workflow it receives.
    if (definedWorkflows.length > 0) {
      console.log(`${tag()} [defined-actions] ${gameMasterOutcome.definedActions.map((definition) => definition.actionId).join(", ")}`);
    }

    await resolveNpcCommitments(db, fulfilledCommitmentIds, "fulfilled", atStep, "Validated and fulfilled during turn resolution.");
    await resolveNpcCommitments(db, deferredCommitmentIds, "deferred", atStep, "Conditions require a later turn.");

    // Guarded by `WHERE status = 'proposed'` inside the query itself, so this
    // can never re-apply an event a concurrent resolution already committed.
    // character_profiles is a legacy UI projection.  Rich NPC information is
    // kept in the required NPC knowledgebase; no resolution path writes an
    // independent biography, role, or voice record.
    await markCharacterSocialEventsApplied(db, appliedSocialEventIds, atStep, turnId);
    await markCharacterSocialEventsRejected(db, [...socialEventOutcome.rejectedIds, ...contactSocialOutcome.rejectedIds, ...contactDialogueOutcome.rejectedIds]);

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

    console.log(`${tag()} ══ RESOLUTION COMPLETE ══ step=${atStep} chronicle=${chronicleInputs.length} workflows=${allWorkflowLog.filter((e) => e.outcome.ok).length} capabilityGaps=${capabilityRequests.length}`);
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
      const role: RelevanceRole = mention.role === "opponent" || mention.role === "commander"
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
