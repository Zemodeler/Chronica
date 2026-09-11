import "server-only";

import type { ChronicleEntryInput } from "@chronica/db";
import type { EntityStateDelta, FactualEvent, GameMasterTurnReport, ScenarioClock, WorldState } from "@chronica/shared";
import { chronicleHeadline, deriveChronicleDepth, deriveWorldTime, estimateWorkflowDurationDays, humanizeRefusalReason, isMechanicalFailureReason, stripEngineJargon, RECORD_REFUSAL_AFTERMATH_TOOL, FLAG_AMBIENT_EVENT_TOOL, FLAG_NPC_INITIATED_DIALOGUE_TOOL } from "@chronica/shared";

// Chronicle from facts (GM refactor, requirement 8).
//
// The Chronicle is downstream of the engine, always. An entry's body is built
// from the factual event log -- the executor's own summaries of mutations that
// actually applied. Unsupported capability requests remain in the developer
// audit trail, not the player-facing Chronicle. The Game Master's report contributes framing only: which events
// belong together, who was involved, where it happened, how prominent it is,
// and which player directive it answers.
//
// This is what keeps a completed action from being narrated as an unfinished
// one. `create_force` returns "Legio II (4000 infantry) raised in Panormus for
// Rome." -- so that is the body, and the narrator later restyles that sentence
// rather than inventing a levy that has not finished mustering.

const PLAYER_SCOPE = "directive";
const REFUSAL_SCOPE = "order_refusal";
const WORLD_SCOPE = "world_event";
/**
 * The Game Master never reached an accepted `finish_turn` this turn (a step
 * or tool budget was hit, or the model stopped without reporting). This is
 * not a refusal -- nothing in the world said no -- so it must never be
 * worded like one ("found no ears"). Any real, validated work the session
 * did complete is still recorded separately, in the "facts the report
 * forgot" pass below; this scope only covers directives left with no report
 * to answer them.
 */
const INCOMPLETE_SCOPE = "resolution_incomplete";
/**
 * The order was given, the engine could not carry it out, and nothing in the
 * world declined it -- a guessed id, arguments the call itself rejected, an
 * action the registry does not have. The session already retries these (with
 * an automatic id repair first), so reaching here means the retry failed too.
 *
 * Deliberately not `REFUSAL_SCOPE`. "It found no ears" asserts that the world
 * heard the order and would not act on it, which is a real historical claim
 * and, for this class of failure, a false one. The matter is left open
 * instead, which is what actually happened.
 */
const UNRESOLVED_SCOPE = "order_unresolved";

/** Reasons a directive produced no world change. These stay executor-worded. */
const NON_SUCCESS_OUTCOMES = new Set(["refused", "failed", "unsupported"]);

// These facts drive the resolver but are not events in the world. They must
// never become Chronicle prose just because the Game Master omitted them from
// its report (or failed to finish a report at all). In particular, a pressure
// tells an actor what needs attention; it is not evidence that they acted.
const INTERNAL_FACT_ACTION_IDS = new Set([
  "plan_update",
  "record_entity_note",
  "world_development",
  "world_incursion_pressure",
  "roman_senate_scrutiny",
]);

// A refusal scene and an ambient world beat are intentionally non-material,
// but are authored player-facing records. All other non-material facts need a
// real material action alongside them before the Chronicle may mention them.
const EXPLICIT_NON_MATERIAL_CHRONICLE_FACT_IDS = new Set([
  RECORD_REFUSAL_AFTERMATH_TOOL,
  FLAG_AMBIENT_EVENT_TOOL,
  // Naming an existing leader is a public identity update, even though it
  // changes no material ledger or battlefield state.
  "rename_character",
  // This is a player-facing affordance (not an internal GM prompt). It may
  // appear on a Chronicle entry so the client can offer the conversation.
  FLAG_NPC_INITIATED_DIALOGUE_TOOL,
]);

function isChronicleEligibleFact(event: FactualEvent): boolean {
  if (event.kind !== "action" || event.noOp === true) return false;
  if (INTERNAL_FACT_ACTION_IDS.has(event.actionId)) return false;
  return event.materialConsequence || EXPLICIT_NON_MATERIAL_CHRONICLE_FACT_IDS.has(event.actionId);
}

function factBody(events: readonly FactualEvent[], refs: readonly string[]): string {
  const byId = new Map(events.map((event) => [event.id, event]));
  const summaries = refs
    .map((ref) => byId.get(ref))
    .filter((event): event is FactualEvent => event !== undefined && isChronicleEligibleFact(event))
    .map((event) => stripEngineJargon(event.summary))
    .filter((summary) => summary.trim().length > 0);
  // The same executor sentence cited twice is one fact, not two.
  return [...new Set(summaries)].join(" ");
}

/**
 * A resolved battle carries the resolver's own derived brief, so the narrator
 * writes from casualties and retreats rather than from a flattened sentence.
 */
function battleBriefOf(events: readonly FactualEvent[]): { battleBrief?: NonNullable<ChronicleEntryInput["battleBrief"]> } {
  const brief = events.find((event) => event.battleBrief !== undefined)?.battleBrief;
  return brief === undefined ? {} : { battleBrief: brief };
}

function participantsOf(world: WorldState, characterIds: readonly string[]): { name: string }[] {
  return characterIds
    .map((id) => world.characters.find((character) => character.id === id)?.name)
    .filter((name): name is string => name !== undefined)
    .map((name) => ({ name }));
}

function salienceTier(salience: number): "high" | "medium" | "low" {
  return salience >= 8 ? "high" : salience >= 5 ? "medium" : "low";
}

/**
 * "controllerPolityId" reads as "controller polity"; "moraleBps" as "morale".
 * Purely cosmetic, and generic across every tracked field on every tracked
 * entity type -- never a lookup keyed on which workflow produced the change.
 */
function humanizeFieldName(field: string): string {
  return field.replace(/Id$/, "").replace(/Bps$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * One entity's change, in plain words, straight from the generic diff --
 * never from knowing which workflow produced it. "Created"/"deleted" speak
 * for themselves; "updated" lists exactly the fields that changed, which is
 * everything from a province's controller to a force's location to a
 * character's office, all through the same formatting.
 */
function labelForDelta(delta: EntityStateDelta): string {
  if (delta.change === "created") return `${delta.entityName} created`;
  if (delta.change === "deleted") return `${delta.entityName} removed`;
  const parts = (delta.fields ?? []).map((change) => `${humanizeFieldName(change.field)} ${String(change.from)} → ${String(change.to)}`);
  return `${delta.entityName}: ${parts.join("; ")}`;
}

function directConsequencesOf(events: readonly FactualEvent[]): NonNullable<ChronicleEntryInput["directConsequences"]> {
  const seen = new Set<string>();
  const consequences: NonNullable<ChronicleEntryInput["directConsequences"]> = [];
  for (const event of events) {
    if (event.kind !== "action" || event.noOp === true || !event.materialConsequence) continue;
    // The generic diff already found every tracked entity this call
    // actually changed -- battle casualties, a captured settlement, a
    // ratified treaty's war/alliance state, an office changing hands, the
    // same as a force being raised or moved. Nothing here inspects which
    // workflow ran.
    const deltas = event.stateDeltas ?? [];
    if (deltas.length > 0) {
      for (const delta of deltas) {
        const label = labelForDelta(delta);
        if (seen.has(label)) continue;
        seen.add(label);
        consequences.push({
          kind: "material",
          label,
          entityId: delta.entityId,
          entityName: delta.entityName,
          quantified: true,
          changeKind: delta.change,
          ...(delta.fields && delta.fields.length > 0 ? { fields: [...delta.fields] } : {}),
        });
      }
      continue;
    }
    // A call that touched nothing the registry tracks (a character's goal,
    // a plot, a pledge of support) still belongs in the record -- just as
    // plain text, never silently dropped.
    const label = stripEngineJargon(event.summary).split(/(?<=[.;])\s/)[0]?.trim().slice(0, 120) ?? "";
    if (label.length === 0 || seen.has(label)) continue;
    seen.add(label);
    consequences.push({ kind: "material", label, entityId: event.actorId, quantified: false });
  }
  return consequences;
}

/**
 * A player's own action entry is titled by what it did, not by what it was
 * for. A raised force names itself, so the Chronicle headline and the body
 * agree that it exists.
 */
/**
 * A named character asked to open a conversation this turn carries the
 * player-facing "Initiated Chat" affordance -- topic and opening line, both
 * exactly as the Game Master gave them, resolved against a real living
 * character so the entry can never point at someone who does not exist.
 */
function initiatedDialogueOf(events: readonly FactualEvent[], world: WorldState): NonNullable<ChronicleEntryInput["initiatedDialogue"]> | undefined {
  const event = events.find((candidate) => candidate.kind === "action" && candidate.actionId === FLAG_NPC_INITIATED_DIALOGUE_TOOL);
  if (event === undefined) return undefined;
  const characterId = event.parameters["characterId"];
  const topic = event.parameters["topic"];
  const openingLine = event.parameters["openingLine"];
  if (typeof characterId !== "string" || typeof topic !== "string" || typeof openingLine !== "string") return undefined;
  const character = world.characters.find((candidate) => candidate.id === characterId && candidate.alive);
  if (!character) return undefined;
  return { characterId, characterName: character.name, topic, openingLine };
}

function playerTitle(events: readonly FactualEvent[], world: WorldState, actorCharacterId: string): string {
  const created = events.find((event) => event.actionId === "create_force" && event.kind === "action");
  const forceName = created?.parameters["name"];
  if (typeof forceName === "string" && forceName.trim().length > 0) return `The Raising of ${forceName}`;
  // Otherwise the headline names what was done, not merely who did it: "The
  // Order of Barbula" tells a reader nothing a chronicle entry should withhold.
  const principal = events.find((event) => event.kind === "action" && event.noOp !== true);
  if (principal !== undefined) return chronicleHeadline(principal.summary);
  const actorName = world.characters.find((character) => character.id === actorCharacterId)?.name;
  return actorName ? `The Order of ${actorName}` : "The Recorded Order";
}

/** A seeded polity leader pre-dates the turn; only their identity was added to the record. */
function worldEventTitle(events: readonly FactualEvent[], world: WorldState, fallback: string): string {
  const identityEvent = events.find((event) => event.actionId === "rename_character");
  const characterId = identityEvent?.parameters["characterId"];
  if (typeof characterId === "string") {
    const character = world.characters.find((candidate) => candidate.id === characterId);
    if (character?.createdByDirector === true) return `${character.name} of ${world.map.polities.find((polity) => polity.id === character.polityId)?.name ?? "their people"}`;
  }
  return chronicleHeadline(fallback);
}

export interface ChronicleFromFactsInput {
  readonly world: WorldState;
  readonly atStep: number;
  readonly actorCharacterId: string;
  readonly events: readonly FactualEvent[];
  readonly report: GameMasterTurnReport | null;
  /** Directive ids submitted this turn, so an unaccounted one is still recorded. */
  readonly directiveIds: readonly string[];
  /** For day-level Chronicle timing (docs/32, Phase 11). Absent falls back to the engine default (`deriveWorldTime`'s own fallback). */
  readonly scenarioClock?: ScenarioClock | undefined;
}

export function buildChronicleFromFacts(input: ChronicleFromFactsInput): ChronicleEntryInput[] {
  const { world, atStep, events, report } = input;
  const byId = new Map(events.map((event) => [event.id, event]));
  const entries: Omit<ChronicleEntryInput, "sequence">[] = [];
  const consumed = new Set<string>();
  // Docs/32 Phase 11: every fact this turn is still atomic (no ActionPlan
  // stage lifecycle is wired into the live GM tool loop yet, Phase 8/9), so
  // occurredAtDay and finalizedAtDay are identical for every entry below.
  // Once a stage can genuinely span turns, the entry that commences it and
  // the one that finishes it will carry different values for each.
  const { elapsedDay } = deriveWorldTime(atStep, input.scenarioClock);
  const dayFields = { occurredAtDay: elapsedDay, finalizedAtDay: elapsedDay };

  // -- the player's own directives ------------------------------------------
  for (const directiveId of input.directiveIds) {
    const outcome = report?.directiveOutcomes.find((candidate) => candidate.directiveId === directiveId);
    const allRefs = outcome?.factRefs ?? [];
    // A Game Master that cites the same tool result under two directives has
    // reported one event, not two. The first directive to claim a fact owns
    // it; a later directive left with nothing of its own is not a separate
    // entry in the record and is dropped below.
    const refs = allRefs.filter((ref) => !consumed.has(ref));
    for (const ref of allRefs) consumed.add(ref);
    const refEvents = refs.map((ref) => byId.get(ref)).filter((event): event is FactualEvent => event !== undefined);
    const applied = refEvents.filter(isChronicleEligibleFact);
    const namedRefusal = refEvents.find((event) => event.actionId === RECORD_REFUSAL_AFTERMATH_TOOL);

    const succeeded = outcome !== undefined && !NON_SUCCESS_OUTCOMES.has(outcome.outcome) && applied.length > 0;
    // Capability requests are internal audit records, never history.  Do not
    // turn a failed attempt into a player-blocking "unresolved" Chronicle item.
    if (refEvents.some((event) => event.kind === "capability_gap") && applied.length === 0) continue;
    // A successful directive whose every fact was already recorded under an
    // earlier one would be the same paragraph told twice.
    if ((!succeeded && refs.length === 0 && allRefs.length > 0 && outcome !== undefined && !NON_SUCCESS_OUTCOMES.has(outcome.outcome))
      || (outcome !== undefined && !NON_SUCCESS_OUTCOMES.has(outcome.outcome) && applied.length === 0)) continue;
    // A refusal or a failure is an executor-derived fact and stays worded that
    // way; it is deliberately kept out of the narrator pass downstream so no
    // invented institutional explanation can attach to it.
    const actorName = world.characters.find((character) => character.id === input.actorCharacterId)?.name ?? "The order's author";
    // Nothing in the world refused this one; it could not be carried out as
    // written. It is reported as still open rather than as rejected.
    const failureReason = outcome?.reason;
    const mechanicalReason = !succeeded && namedRefusal === undefined && report !== null
      && failureReason !== undefined && isMechanicalFailureReason(failureReason)
      ? failureReason
      : null;
    const body = succeeded
      ? factBody(events, refs)
      : namedRefusal !== undefined
          ? factBody(events, refs)
        : report === null
          ? `${actorName}'s order was still being carried through when this turn's resolution stopped short. What became of it is not yet known.`
        : mechanicalReason !== null
          ? `${actorName}'s order could not be carried out as it was given: ${humanizeRefusalReason(mechanicalReason)}. No one refused it, and the matter remains open.`
        : failureReason !== undefined
          ? `${actorName} gave the order, but it found no ears: ${humanizeRefusalReason(failureReason)}. The matter went no further.`
          : "The order was given, but it found no ears. The matter went no further.";
    const directiveDialogue = initiatedDialogueOf(refEvents, world);
    const directiveInitiatedDialogue = directiveDialogue === undefined ? {} : { initiatedDialogue: directiveDialogue };

    entries.push({
      scope: succeeded ? PLAYER_SCOPE : report === null ? INCOMPLETE_SCOPE : mechanicalReason !== null ? UNRESOLVED_SCOPE : REFUSAL_SCOPE,
      scopeRef: directiveId,
      audience: "all_players",
      body,
      atStep,
      ...dayFields,
      materialConsequence: succeeded,
      simulatedDurationDays: estimateWorkflowDurationDays(applied.map((event) => event.actionId)),
      factActionIds: [...new Set(applied.map((event) => event.actionId))],
      title: succeeded ? playerTitle(applied, world, input.actorCharacterId)
        : namedRefusal !== undefined ? "The Refusal Answered"
        : report === null ? "Resolution Incomplete"
        : mechanicalReason !== null ? "The Order Left Unresolved"
        : "The Unheard Order",
      knowledgeStatus: "confirmed",
      sourceDirector: "player",
      chainPosition: "root",
      playerRelevance: "high",
      depth: "scene",
      directConsequences: directConsequencesOf(applied),
      ...directiveInitiatedDialogue,
    });
  }

  // -- everything else the world did ----------------------------------------
  for (const event of report?.events ?? []) {
    const refs = event.factRefs.filter((ref) => !consumed.has(ref));
    if (refs.length === 0) continue;
    for (const ref of refs) consumed.add(ref);
    const citedEvents = refs
      .map((ref) => byId.get(ref))
      .filter((candidate): candidate is FactualEvent => candidate !== undefined);
    const refEvents = citedEvents.filter(isChronicleEligibleFact);
    if (refEvents.length === 0) continue;
    const material = refEvents.some((candidate) => candidate.materialConsequence);
    const worldDialogue = initiatedDialogueOf(citedEvents, world);
    const worldInitiatedDialogue = worldDialogue === undefined ? {} : { initiatedDialogue: worldDialogue };
    entries.push({
      scope: WORLD_SCOPE,
      scopeRef: refs[0] ?? `${atStep}`,
      audience: event.visibility === "private" ? "knowledge_scoped" : "all_players",
      body: factBody(events, refs),
      atStep,
      ...dayFields,
      materialConsequence: material,
      simulatedDurationDays: estimateWorkflowDurationDays(refEvents.map((candidate) => candidate.actionId)),
      // The narrator's own outcome lock (below): the exact set of successful
      // action ids this entry's facts are actually drawn from, so a rewrite
      // that claims a material outcome none of them recorded -- a war
      // declared with no successful `start_war` among them -- can be caught
      // and rejected deterministically rather than trusted on the model's word.
      factActionIds: [...new Set(refEvents.filter((candidate) => candidate.kind === "action").map((candidate) => candidate.actionId))],
      // The report may name the event; it may never state its outcome, which
      // is why the title is a headline drawn from it and the body comes from
      // the engine. A headline is cut on a word, never mid-word, and never
      // carries an engine identifier into the record.
      title: worldEventTitle(refEvents, world, event.summary),
      knowledgeStatus: "confirmed",
      sourceDirector: "game_master",
      chainPosition: event.chainPosition,
      participants: participantsOf(world, event.participantCharacterIds),
      characterMentions: event.participantCharacterIds
        .filter((id) => world.characters.some((character) => character.id === id && character.alive))
        .slice(0, 4)
        .map((id) => ({ characterId: id, role: "participant" })),
      playerRelevance: salienceTier(event.salience),
      depth: deriveChronicleDepth({ playerRelevance: salienceTier(event.salience), materialConsequence: material, isPlayerAction: false }),
      directConsequences: directConsequencesOf(refEvents),
      ...battleBriefOf(refEvents),
      ...worldInitiatedDialogue,
    });
  }

  // -- facts the report forgot ----------------------------------------------
  // Anything the engine actually did is recorded whether or not the Game
  // Master remembered to report it. A silent mutation would be a lie by
  // omission in a Chronicle that claims to be the record.
  for (const event of events) {
    if (consumed.has(event.id)) continue;
    // ...except a call that changed nothing, including an internal capability
    // request. There is no omission in staying silent about a world that did
    // not move.
    if (!isChronicleEligibleFact(event)) continue;
    const forgottenDialogue = initiatedDialogueOf([event], world);
    const forgottenInitiatedDialogue = forgottenDialogue === undefined ? {} : { initiatedDialogue: forgottenDialogue };
    entries.push({
      scope: WORLD_SCOPE,
      scopeRef: event.id,
      audience: "all_players",
      body: stripEngineJargon(event.summary),
      atStep,
      ...dayFields,
      materialConsequence: event.materialConsequence,
      simulatedDurationDays: estimateWorkflowDurationDays([event.actionId]),
      factActionIds: [event.actionId],
      title: chronicleHeadline(event.summary),
      knowledgeStatus: "confirmed",
      sourceDirector: "game_master",
      chainPosition: "spread",
      playerRelevance: "low",
      depth: deriveChronicleDepth({ playerRelevance: "low", materialConsequence: event.materialConsequence, isPlayerAction: false }),
      directConsequences: directConsequencesOf([event]),
      ...battleBriefOf([event]),
      ...forgottenInitiatedDialogue,
    });
  }

  return entries.map((entry, sequence) => ({ ...entry, sequence }));
}

/**
 * Scopes whose wording is executor-derived and must never reach the narrator.
 * A refusal says exactly why nothing happened; a free-form rewrite could only
 * add an institutional cause the engine never gave, so it is left alone.
 */
export const NARRATOR_EXEMPT_SCOPES: ReadonlySet<string> = new Set([REFUSAL_SCOPE, INCOMPLETE_SCOPE, UNRESOLVED_SCOPE]);

/**
 * Scopes the narrator may write, but only under a hard outcome lock: the
 * facts in the body are complete and final, and the rewrite may add voice and
 * consequence, never doubt, delay, or a different result. The player's own
 * carried-out orders belong here -- they are the entries a chronicle exists to
 * tell, and leaving them as raw executor sentences is what made the record
 * read as a receipt rather than as history.
 */
export const NARRATOR_OUTCOME_LOCKED_SCOPES: ReadonlySet<string> = new Set([PLAYER_SCOPE]);

/**
 * A rewrite claiming a power declared or went to war reads as history the
 * instant it is printed, so it must be true history: backed by an actual,
 * successful `start_war` fact. Without this a world-event entry about a
 * polity's newly named leader, or any character being created, renamed, or
 * selected, could be restyled by the narrator into "X declares war on Y" with
 * nothing in the factual record to support it -- the exact failure mode a
 * chronicle exists to prevent.
 */
const WAR_DECLARATION_PATTERN =
  /\bdeclares?\s+war\b|\bdeclared\s+war\b|\bgoes?\s+to\s+war\b|\bgone\s+to\s+war\b|\bwar\s+(?:is|was)\s+declared\b|\btakes?\s+up\s+arms\s+against\b|\bopens?\s+hostilities\b/i;

/**
 * True when a narrator rewrite claims a war was declared but the entry's own
 * factual basis -- the exact successful action ids it was built from --
 * contains no successful `start_war`. The caller should reject the rewrite and
 * keep the factual body in that case.
 */
export function rewriteClaimsUnsupportedWar(rewrittenBody: string, factActionIds: readonly string[] | undefined): boolean {
  if (!WAR_DECLARATION_PATTERN.test(rewrittenBody)) return false;
  return !(factActionIds ?? []).includes("start_war");
}
