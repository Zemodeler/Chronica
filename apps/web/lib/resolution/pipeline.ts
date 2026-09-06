import "server-only";

// Turn resolution (Game Master architecture).
//
// The AI part of a turn is one agent with tools, not a committee. Everything
// around it is deterministic and unchanged: dialogue social events and
// pressure lifecycle before, life review and character agency before, political
// procedures and background material society after, then Chronicle and commit.
//
// The agent's only route to state is `runGameMaster`, which stages every
// mutation in memory through the registered workflow executor. Prose changes
// nothing; there is no JSON-patch or invented-workflow path left in the
// executor at all. The committed snapshot is written once, at the end, by
// `commitResolution`.

import type {
  OrderBatch,
  ProposedInvocation,
  SelectedCharacter,
  WorkflowAuditBlob,
  CandidateAction,
  CharacterIntent,
  WorldState,
} from "@chronica/shared";
import {
  executeWorkflows,
  selectRelevantCharacters,
  materializePlayerCharacter,
  applySocialEvents,
  advancePressureLifecycle,
  derivePressureTriggers,
  deriveDiplomaticEscalations,
  createPressure,
  dueCommitments,
  generateCandidateActions,
  rankCandidates,
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
  chronicleHeadline,
  humanizeRefusalReason,
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
  ensurePolityLeadership,
  advanceProvinceMaterial,
  applyWarDamageForExecutedWorkflows,
  deriveChronicleDepth,
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
  insertInventedWorkflows,
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
  upsertCharacterProfile,
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
import { buildIntentInvocation, hasActiveAgencyState, isEligibleForNpcAgency, resolveFormedNpcIntentOutcome } from "./character-agency";
import type { FormedNpcProposal } from "./character-agency";
import { materializeCanvasProvince } from "../canvas-world";
import { advanceWorldDynamics } from "./world-dynamics";
import { selectDevelopmentActors } from "./world-development-scheduler";
import { applyMilitaryEmergencyFallback } from "./military-emergency-fallback";
import { applyCommitmentSafetyNet } from "./commitment-safety-net";

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
    const resolutionContext: ResolutionPlayerContext = { knowledgebase: playerKnowledgebase, pendingCommitments };
    const canvasWorld = materializeCanvasProvince(world, input.mapAssetId ?? null, playerKnowledgebase?.locationProvinceId ?? null);
    const materializedWorld = materializePlayerCharacter(canvasWorld, actorCharacterId, playerKnowledgebase, input.scenarioGovernment);

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
    // A power the player has walked into, written to, or gone to war with
    // needs somebody to be. Scenarios name people only for the powers their
    // author cared about, and every tool in the engine needs an actor -- so
    // without this a march into the Boii met a polity that was mechanically
    // incapable of noticing. Seeded before the Game Master reads the world,
    // so the leader is in its working set the same turn the player provokes
    // them. Idempotent: a power that already has anyone living is untouched.
    const leadership = ensurePolityLeadership(backfilled, materializedWorld.elapsedStep + 1);
    for (const leader of leadership.seeded) {
      console.log(`${tag()} [leadership] seeded "${leader.characterName}" for ${leader.polityName} (${leader.trigger})`);
    }
    // Turn foreign occupations and Roman public business into durable,
    // state-backed pressures before character selection.  The Game Master
    // therefore receives leaders who have something concrete to answer this
    // turn, rather than merely a map that it may choose to ignore.
    const worldDynamics = advanceWorldDynamics(leadership.world, materializedWorld.elapsedStep + 1);
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
    // A leader seeded this turn has no history for the scorer to weigh, so it
    // would rank them nowhere -- and the power the player just provoked would
    // be silent again, for a new reason. They are the most relevant figures on
    // the board this turn by construction, so they are added outright.
    const selectedCharacters: SelectedCharacter[] = [
      ...leadership.seeded
        .filter((leader) => !scoredCharacters.some((selected) => selected.characterId === leader.characterId))
        .map((leader) => ({
          characterId: leader.characterId,
          tier: "important" as const,
          relevanceScore: 700,
          actionAllowance: 5,
          reasons: [
            leader.trigger === "invaded"
              ? `${leader.polityName} has a foreign army on its ground and has just found a voice to answer with`
              : leader.trigger === "addressed"
                ? `${leader.polityName} has been addressed directly and owes an answer`
                : `${leader.polityName} is at war and must conduct it`,
          ],
        })),
      ...scoredCharacters,
    ];
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

    // ── Step 2: Life review — aging, health, incapacity, death (character-sim phase 5) ──
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
    // Seeded from `resolutionWorld`: with a single Game Master, life review
    // and character agency run BEFORE the agent acts rather than after the
    // player's actions were previewed, so a death, an incapacity, or an
    // NPC's own formed intent is part of the world the agent reads and can
    // react to within the same turn.
    let lifeReviewedWorld: WorldState = resolutionWorld;
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

    // ── Step 3: Character agency — goals/plots, commitments, intents ─────
    // Deterministic and unchanged in substance: candidates are generated and
    // scored, conflicts resolved, and a due commitment is kept, deferred, or
    // broken by the rules-backed helpers, not by any model (character-sim
    // phase 3). What changed is where the result goes. An intent that maps to
    // a legal workflow is no longer executed behind the Game Master's back;
    // it is offered to it as a formed intention the agent may act on, ignore,
    // or be overtaken by events. `agencyWorld` is the world the agent stages
    // its turn against.
    emit(onProgress, "character_agency");
    /** Formed NPC intentions offered to the Game Master as concrete, executable proposals -- never executed here. */
    const npcFormedIntentions: FormedNpcProposal[] = [];
    let agencyWorld: WorldState = lifeReviewedWorld;

    const dueThisTurn = dueCommitments(agencyWorld.commitments ?? [], atStep);
    const intents: CharacterIntent[] = [];
    const candidateByIntentId = new Map<string, CandidateAction>();

    // Brennos, freshly named for an invaded or addressed power, has no
    // continuity history yet but is the most relevant actor on the board
    // this turn by construction -- see `isEligibleForNpcAgency`.
    const seededCharacterIds = new Set(leadership.seeded.map((leader) => leader.characterId));

    // Bounded to this turn's already-selected, already-capped working set
    // (`selectRelevantCharacters`, max 8) -- only characters eligible for
    // agency (continuity "principal", newly seeded, or top-tier "persistent"
    // selection) get full candidate generation and up to one primary action;
    // "remembered" characters only advance their existing coarse plan;
    // everyone else (or unselected characters) gets none.
    for (const selected of selectedCharacters) {
      const character = agencyWorld.characters.find((c) => c.id === selected.characterId);
      if (!character || !character.alive) continue;
      const continuityEntry = agencyWorld.continuity.find((c) => c.characterId === character.id);
      if (!isEligibleForNpcAgency(continuityEntry?.tier, seededCharacterIds.has(character.id), selected.tier, hasActiveAgencyState(agencyWorld, character.id))) continue;

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

    // docs/30: nothing below mutates `agencyWorld` any more, and there is no
    // separate deterministic conflict-resolution pass. Every intent -- a due
    // commitment, a pressure-driven social action, or a plot/office/economic
    // move -- is offered to the Game Master as a formed intention through a
    // real registered workflow (`fulfill_commitment`, `defer_commitment`,
    // `break_commitment`, and `record_character_social_action` joined the
    // registry alongside the workflows already offered this way). A second
    // NPC's genuinely conflicting claim on the same resource or office is
    // refused by that workflow's own precondition check when the Game Master
    // actually attempts it, the same way any other command conflict is --
    // not pre-empted by a separate priority pass before anyone gets to try.
    const resolvedIntents: CharacterIntent[] = [];

    for (const intent of intents) {
      const candidate = candidateByIntentId.get(intent.id)!;

      // A formed intention that maps to a legal workflow is offered to the
      // Game Master rather than executed here. The agent is the one authority
      // on what the world does this turn, so an NPC acts when the agent has
      // it act -- and the intent is resolved below against what actually
      // happened, not against what was proposed. The exact invocation
      // `buildIntentInvocation` produced is carried verbatim: the Game
      // Master is handed a concrete, executable proposal, not a paraphrase of
      // one it must reconstruct.
      const invocation = candidate.legalWorkflowIds.length > 0 ? buildIntentInvocation(candidate, agencyWorld) : null;
      if (invocation !== null) {
        npcFormedIntentions.push({
          intentId: intent.id,
          actorCharacterId: intent.actorCharacterId,
          actionType: intent.actionType,
          rationale: intent.rationale,
          workflowIds: candidate.legalWorkflowIds,
          invocation,
        });
        resolvedIntents.push({ ...intent, status: "prepared" });
        continue;
      }

      resolvedIntents.push({ ...intent, status: "executed", resolutionReason: "No mechanical effect modeled for this action; recorded for continuity only." });
    }
    console.log(`${tag()} [character_agency] OUT: formedIntentions=${npcFormedIntentions.length} intents=${intents.length}`);
    emit(onProgress, "character_agency", true);

    // ── Step 4: Game Master ────────────────────────────────────────────────
    //
    // One agent, one staged world. It reads with the inspect tools, attempts
    // the player's orders with the registered workflows, lets the world answer
    // through the same tools, and ends with a structured report. Nothing it
    // writes as prose reaches state, and there is no invented-workflow or
    // JSON-patch path for it to reach state by: `executeWorkflow` resolves
    // registered ids only.
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
    const gameMasterOutcome = await runGameMaster(gameMasterAdapter, {
      world: agencyWorld,
      atStep,
      actorCharacterId,
      directives: gameMasterDirectives,
      selectedCharacters,
      npcProposals: npcFormedIntentions,
      persistentPlans: true,
      playerContext: resolutionContext,
      scenarioGovernment: input.scenarioGovernment,
      scenarioChronicle: input.scenarioChronicle,
      definedActions,
      // Off by default (docs/27): `request_capability` is the supported path
      // for an unanticipated player intent. This is a developer-controlled
      // rollout/testing exception, not a normal-play setting.
      allowInventedActions: process.env.CHRONICA_ALLOW_INVENTED_ACTIONS === "true",
    });
    let newWorld: WorldState = gameMasterOutcome.world;
    let factualEvents = [
      ...gameMasterOutcome.events,
      ...worldDynamics.events.map((event, index) => ({ ...event, id: `fact-${atStep}-${gameMasterOutcome.events.length + index + 1}` })),
    ];
    const capabilityRequests = gameMasterOutcome.capabilityRequests;
    console.log(
      `${tag()} [game_master] OUT: termination=${gameMasterOutcome.termination} actions=${gameMasterOutcome.executedInvocations.length} facts=${factualEvents.length} capabilityGaps=${capabilityRequests.length}`,
    );
    if (gameMasterOutcome.providerError !== null) {
      console.error(`${tag()} [game_master] provider error: ${gameMasterOutcome.providerError}`);
    }
    // A turn the Game Master never got to run is not an uneventful turn.
    // Committing it as one would advance the clock, consume the player's
    // orders, and hand them a Chronicle saying nothing happened — a lie about
    // an outage. Fail the turn instead, which surfaces the error to the player
    // rather than burying it.
    //
    // Only when the agent achieved nothing at all: a provider that dies partway
    // leaves real, validated work on the stage, and that is committed.
    //
    // NOTE: a failed turn is currently terminal — nothing re-dispatches it, so
    // the game cannot proceed until the provider problem is fixed and the turn
    // is retried by hand. That is deliberate for now: silently eating turns is
    // worse than stopping. A retry path is a real gap.
    if (
      gameMasterOutcome.termination === "provider_error"
      && gameMasterOutcome.executedInvocations.length === 0
      && gameMasterOutcome.capabilityRequests.length === 0
    ) {
      throw new Error(
        `The Game Master could not be reached, so nothing was resolved and the turn was not committed. Provider error: ${gameMasterOutcome.providerError ?? "unknown"}`,
      );
    }
    emit(onProgress, "game_master", true);

    // Audit is the session's, verbatim: every refusal carries the exact
    // deterministic reason the policy or the executor produced.
    let finalWorkflowAudit: WorkflowAuditBlob = {
      candidates: [...gameMasterOutcome.auditEntries],
      novelActionProposals: [],
      managerFailed: gameMasterOutcome.termination === "provider_error",
      atStep,
    };
    let allWorkflowLog: { invocation: ProposedInvocation; outcome: { ok: boolean; reason?: string; message?: string; result?: { summary: string } } }[] =
      gameMasterOutcome.auditEntries.map((entry) => ({
        invocation: entry.finalInvocation ?? entry.requestedInvocation,
        outcome: entry.executionOk === true
          ? { ok: true, result: { summary: factualEvents.find((event) => event.actionId === entry.requestedActionId)?.summary ?? entry.requestedActionId } }
          : { ok: false, message: entry.executionReason ?? "Refused." },
      }));

    // A formed NPC intention is resolved against what the Game Master actually
    // did, never against what was proposed for it.
    const npcProposalByIntentId = new Map(npcFormedIntentions.map((proposal) => [proposal.intentId, proposal]));
    for (let i = 0; i < resolvedIntents.length; i++) {
      const intent = resolvedIntents[i]!;
      if (intent.status !== "prepared") continue;
      const proposal = npcProposalByIntentId.get(intent.id);
      if (proposal === undefined) {
        resolvedIntents[i] = { ...intent, status: "deferred", resolutionReason: "Formed but its proposal was lost before the Game Master ran." };
        continue;
      }
      const outcome = resolveFormedNpcIntentOutcome(proposal, gameMasterOutcome.executedInvocations, gameMasterOutcome.auditEntries);
      resolvedIntents[i] = { ...intent, status: outcome.status, resolutionReason: outcome.reason };
    }

    // ── Step 5: Resolve due political procedures ──────────────────────────
    // Deterministic, no AI involved: any procedure at voting_or_deciding (or
    // past its deadline) resolves here by its declared resolutionMechanism,
    // producing at most one authorized workflow invocation per procedure
    // (character-sim phase 4, packages/shared/src/character-agency/political-resolver.ts).
    // It runs after the Game Master so a procedure the agent opened or voted
    // in this turn is included in the same sitting.
    emit(onProgress, "resolve_politics");
    const politicsResolution = resolveDueProcedures({ characters: newWorld.characters, material: newWorld.material }, atStep);
    newWorld = { ...newWorld, material: politicsResolution.material };
    const politicalInvocations: ProposedInvocation[] = politicsResolution.invocations.map((inv) => ({
      actionId: inv.actionId,
      actorId: inv.actorId,
      parameters: inv.parameters,
    }));
    console.log(`${tag()} [resolve_politics] OUT: ${politicalInvocations.length} procedure(s) resolved to an authorized invocation`);
    emit(onProgress, "resolve_politics", true);

    emit(onProgress, "execute_world");
    /** Deterministic procedure resolutions executed after the agent, for the audit. */
    const procedureLog: { invocation: ProposedInvocation; outcome: { ok: boolean; message?: string } }[] = [];
    if (politicalInvocations.length > 0) {
      const politicalExecuted = executeWorkflows(politicalInvocations, newWorld, atStep);
      newWorld = politicalExecuted.world;
      allWorkflowLog = [...allWorkflowLog, ...politicalExecuted.log];
      procedureLog.push(...politicalExecuted.log.map((entry) => ({ invocation: entry.invocation, outcome: entry.outcome.ok ? { ok: true } : { ok: false, message: entry.outcome.message } })));
      for (const entry of politicalExecuted.log) {
        if (entry.outcome.ok) {
          console.log(`${tag()} [execute:ok] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} summary="${entry.outcome.result.summary}"`);
        } else {
          console.error(`${tag()} [execute:fail] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} reason=${entry.outcome.reason}`);
        }
      }
    }

    // ── Step 6: Resolve procedures that became due this same turn ─────────
    // resolve_politics (Step 5, above) only sees procedures that already
    // existed at the START of this turn -- a procedure sponsored just now
    // (e.g. a compound "ask the Senate for X and act on it" order given an
    // immediate deadlineStep) isn't in world state until the execute_world
    // batch above applies it, so it would otherwise sit unresolved until a
    // future turn's resolve_politics pass, forcing the player to wait several
    // real turns for what the fiction treats as one sitting. Re-running the
    // same deterministic resolver against the post-execution world catches
    // exactly that case; it's a no-op for anything already resolved, since
    // dueProcedures excludes "resolved"/"withdrawn"/"blocked" procedures.
    const immediatePoliticsResolution = resolveDueProcedures({ characters: newWorld.characters, material: newWorld.material }, atStep);
    newWorld = { ...newWorld, material: immediatePoliticsResolution.material };
    const immediatePoliticalInvocations: ProposedInvocation[] = immediatePoliticsResolution.invocations.map((inv) => ({
      actionId: inv.actionId,
      actorId: inv.actorId,
      parameters: inv.parameters,
    }));
    if (immediatePoliticalInvocations.length > 0) {
      console.log(`${tag()} [resolve_politics_immediate] OUT: ${immediatePoliticalInvocations.length} same-turn procedure(s) resolved`);
      const immediateExecuted = executeWorkflows(immediatePoliticalInvocations, newWorld, atStep);
      newWorld = immediateExecuted.world;
      allWorkflowLog = [...allWorkflowLog, ...immediateExecuted.log];
      procedureLog.push(...immediateExecuted.log.map((entry) => ({ invocation: entry.invocation, outcome: entry.outcome.ok ? { ok: true } : { ok: false, message: entry.outcome.message } })));
      for (const entry of immediateExecuted.log) {
        if (entry.outcome.ok) {
          console.log(`${tag()} [execute:ok] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} summary="${entry.outcome.result.summary}"`);
        } else {
          console.error(`${tag()} [execute:fail] actionId=${entry.invocation.actionId} actorId=${entry.invocation.actorId} reason=${entry.outcome.reason}`);
        }
      }
    }

    // ── Step 6b: Deterministic military-emergency fallback ────────────────
    //
    // The Game Master is prompted to answer an invasion, but a prompt is not
    // a guarantee: it can spend its budget elsewhere, rank a lower-value
    // action higher, or fail outright (model_stopped / a budget limit /
    // a provider error). An invaded polity with a leader and no response of
    // its own by this point in the turn gets one here, deterministically --
    // never in place of a real response the Game Master or a political
    // procedure already gave it this turn, only in the absence of one.
    const respondedThisTurn: ProposedInvocation[] = [
      ...gameMasterOutcome.executedInvocations,
      ...politicalInvocations,
      ...immediatePoliticalInvocations,
    ];
    const militaryFallback = applyMilitaryEmergencyFallback(newWorld, atStep, respondedThisTurn);
    newWorld = militaryFallback.world;
    if (militaryFallback.events.length > 0) {
      factualEvents = [
        ...factualEvents,
        ...militaryFallback.events.map((event, index) => ({ ...event, id: `fact-${atStep}-fallback-${index + 1}` })),
      ];
    }
    for (const entry of militaryFallback.invocations) {
      allWorkflowLog = [...allWorkflowLog, { invocation: entry.invocation, outcome: entry.ok ? { ok: true, result: { summary: entry.summary } } : { ok: false, message: entry.summary } }];
      finalWorkflowAudit = {
        ...finalWorkflowAudit,
        candidates: [
          ...finalWorkflowAudit.candidates,
          {
            correlationId: `military-fallback-${atStep}-${entry.invocation.actorId}`,
            source: "simulator" as const,
            sourceRef: "military_emergency_fallback",
            requestedActionId: entry.invocation.actionId,
            requestedInvocation: entry.invocation,
            finalInvocation: entry.invocation,
            dryRunOk: entry.ok,
            executionOk: entry.ok,
            ...(entry.ok ? {} : { executionReason: entry.summary }),
          },
        ],
      };
      if (entry.ok) {
        console.log(`${tag()} [military_emergency_fallback] actorId=${entry.invocation.actorId} actionId=${entry.invocation.actionId} summary="${entry.summary}"`);
      } else {
        console.log(`${tag()} [military_emergency_fallback] no legal response available for actorId=${entry.invocation.actorId}: ${entry.summary}`);
      }
    }

    // ── Step 6c: Deterministic commitment safety net ──────────────────────
    //
    // Resolving a due commitment is now the Game Master's own choice
    // (`fulfill_commitment`/`defer_commitment`/`break_commitment`, docs/30),
    // so a commitment it never gets to -- or chooses not to act on -- needs a
    // backstop against sitting unresolved forever. Auto-defers only, and only
    // once a commitment has gone unaddressed for `GRACE_WINDOW_STEPS` past its
    // own review step; see commitment-safety-net.ts for the full rationale.
    const commitmentSafetyNet = applyCommitmentSafetyNet(newWorld, atStep);
    newWorld = commitmentSafetyNet.world;
    if (commitmentSafetyNet.events.length > 0) {
      factualEvents = [
        ...factualEvents,
        ...commitmentSafetyNet.events.map((event, index) => ({ ...event, id: `fact-${atStep}-commitment-safety-net-${index + 1}` })),
      ];
      finalWorkflowAudit = {
        ...finalWorkflowAudit,
        candidates: [
          ...finalWorkflowAudit.candidates,
          ...commitmentSafetyNet.events.map((event) => ({
            correlationId: `commitment-safety-net-${atStep}-${event.actorId}-${event.parameters["commitmentId"]}`,
            source: "simulator" as const,
            sourceRef: "commitment_safety_net",
            requestedActionId: event.actionId,
            requestedInvocation: { actionId: event.actionId, actorId: event.actorId, parameters: event.parameters },
            finalInvocation: { actionId: event.actionId, actorId: event.actorId, parameters: event.parameters },
            dryRunOk: true,
            executionOk: true,
          })),
        ],
      };
      for (const event of commitmentSafetyNet.events) {
        console.log(`${tag()} [commitment_safety_net] actorId=${event.actorId} ${event.summary}`);
      }
    }

    newWorld = autoResolveDecidedStorylines(world, newWorld, atStep);

    // Background material society (docs/14 Phase 2): coarse war damage for
    // exactly the provinces this turn's military workflows touched, then a
    // cheap, bounded recovery tick for every other province -- never a
    // full-world recompute per event.
    const successfulInvocations = allWorkflowLog.filter((entry) => entry.outcome.ok).map((entry) => entry.invocation);
    const warDamageResult = applyWarDamageForExecutedWorkflows(newWorld, successfulInvocations, atStep);
    newWorld = advanceProvinceMaterial(warDamageResult.world, atStep, warDamageResult.affectedProvinceIds);
    // The Game Master session already recorded every one of its own calls with
    // its exact outcome. Only the deterministic procedure resolutions executed
    // after it need appending, so the audit covers the whole turn.
    finalWorkflowAudit = {
      ...finalWorkflowAudit,
      candidates: [
        ...finalWorkflowAudit.candidates,
        ...procedureLog
          .map((entry, index) => ({
            correlationId: `procedure-${atStep}-${index}`,
            source: "game_master" as const,
            sourceRef: "political_procedure",
            requestedActionId: entry.invocation.actionId,
            requestedInvocation: entry.invocation,
            finalInvocation: entry.invocation,
            dryRunOk: entry.outcome.ok,
            executionOk: entry.outcome.ok,
            ...(entry.outcome.ok ? {} : { executionReason: entry.outcome.message ?? "Procedure invocation failed." }),
          })),
      ],
    };

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
      isLongRunningAction: (actionId) => estimateWorkflowDurationDays([{ actionId }]) >= 14,
    });
    // A named refusal aftermath is the richer record of the same failed
    // request. Do not also print the generic engine-only refusal beside it.
    const refusalsWithNamedAftermath = new Set(
      factualEvents
        .filter((event) => event.actionId === "record_refusal_aftermath")
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
      const verb = refusal.kind === "authority" ? "was refused him" : "found no ears";
      return {
        sequence: 0,
        scope: "order_refusal",
        scopeRef: `${refusal.actorId}:${refusal.actionId}:${atStep}`,
        audience: "all_players",
        body: `${actorName} pressed for ${noun}, but it ${verb}: ${humanizeRefusalReason(refusal.reason)}. The matter went no further.`,
        atStep,
        materialConsequence: false,
        simulatedDurationDays: 1,
        title: chronicleHeadline(`${noun.replace(/^the /, "The ")} Refused`),
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
    const politicalChronicle: ChronicleEntryInput[] = [];
    for (const procedure of politicsResolution.material.politicalProcedures) {
      if (procedure.resolvedAtStep !== atStep) continue;
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
    // Read from `newWorld` rather than `politicsResolution`: a procedure a
    // workflow opens during this turn's own execution (e.g.
    // `collect_emergency_taxation`'s automatic opposition motion) is not
    // yet in `politicsResolution`, which only reflects the *pre*-execution
    // political-resolver pass the "resolved" loop above reads from.
    // A procedure the Game Master opened by tool call is already in this
    // turn's factual event log, and buildChronicleFromFacts writes it. Writing
    // it a second time here from the world diff is the same opening told
    // twice, under two different headlines.
    const proceduresOpenedByFact = new Set(
      factualEvents
        .filter((event) => event.actionId === "open_political_procedure" && typeof event.parameters["procedureId"] === "string")
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
      report: gameMasterOutcome.report,
      directiveIds: gameMasterDirectives.map((entry) => entry.id),
    });
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
    // An ultimatum rejected (or left standing unanswered) more than once on
    // the same thread must not just repeat itself: this reads what the
    // message record already says -- never invents a repeat -- and presses
    // the offended sender's own leader toward a real reaction, the same
    // deterministic path every other pressure trigger already takes. It is
    // what makes the sender's leader agency-eligible next turn even at
    // continuity tier "ordinary" (`isEligibleForNpcAgency`'s explicit-
    // relevance path), not merely a flavor note the Game Master might notice.
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

    await commitResolution(db, {
      gameId,
      turnId,
      newWorld: finalWorld,
      elapsedStepEnd: atStep,
      chronicleEntries: chronicleInputs,
      stopReason: "player_decision",
      workflowAudit: finalWorkflowAudit,
      capabilityRequests,
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
      gameMasterAudit: gameMasterOutcome.auditEntries,
    });

    // Written only after the turn itself committed, so a capability the world
    // gained is never persisted for a turn that did not happen. From here on
    // it is part of this campaign: every later turn is handed it back.
    if (gameMasterOutcome.definedActions.length > 0) {
      await insertInventedWorkflows(
        db,
        gameMasterOutcome.definedActions.map((definition) => ({
          id: `defined-${gameId}-${definition.actionId}`,
          gameId,
          definition,
          status: "active" as const,
        })),
        turnId,
      ).catch((err: unknown) => {
        console.error(`${tag()} [defined-actions] could not be persisted; they will not survive the turn`, err);
      });
      console.log(`${tag()} [defined-actions] ${gameMasterOutcome.definedActions.map((definition) => definition.actionId).join(", ")}`);
    }

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
