import type { WorldState } from "../world/world-state";
import { unansweredMessages } from "../world/diplomacy";
import type { FactualEvent } from "./session";
import type { RecordedCapabilityRequest } from "./capability-request";
import type { CampaignTurnMemory } from "./campaign-memory";

// Compact Game Master memory (GM refactor, requirement 6).
//
// Two halves, both derived from structured facts and never from prose:
//
//  - `deriveOpenThreads` reads the committed world for everything still
//    unfinished -- wars, battles, sieges, treaties in force, open causal
//    chains, unresolved commitments, procedures mid-passage, live pressures,
//    operations under standing instructions. This is what the Game Master
//    must not forget between turns.
//  - `summarizeTurnFacts` turns this turn's executed tool results into the
//    exact account that goes into campaign memory. It reads the factual event
//    log, so it can only say what the deterministic engine actually did.

export interface OpenThreads {
  readonly wars: readonly string[];
  readonly battles: readonly string[];
  readonly sieges: readonly string[];
  readonly treaties: readonly string[];
  readonly chronicleChains: readonly { readonly id: string; readonly rootCause: string; readonly openPressure: string | null }[];
  readonly commitments: readonly { readonly id: string; readonly promisorName: string; readonly description: string; readonly reviewAtStep: number }[];
  readonly procedures: readonly { readonly id: string; readonly type: string; readonly stage: string; readonly sponsorName: string; readonly deadlineStep: number | null }[];
  readonly pressures: readonly { readonly characterName: string; readonly kind: string; readonly intensity: number; readonly label: string }[];
  readonly operations: readonly { readonly id: string; readonly objective: string; readonly stage: string }[];
  /**
   * Foreign forces standing on someone else's ground. An army that marches
   * into a neighbour's territory without a war, a battle, or a siege leaves no
   * trace in any of the other threads -- so before this existed, the invaded
   * power had nothing to notice and reliably did nothing at all.
   */
  readonly incursions: readonly string[];
  /**
   * Polities with no living named character. Such a power cannot act at all:
   * every tool needs an actor. It is named here so a power that is being
   * invaded, courted, or provoked gets a leader before it is expected to answer.
   */
  readonly leaderlessPolities: readonly string[];
  /**
   * Diplomatic messages nobody has answered. A letter that sits unanswered
   * forever is the same silence as an invasion nobody notices, so it is a
   * thread like any other and is expected to close.
   */
  readonly unansweredMessages: readonly string[];
}

const MAX_THREADS_PER_KIND = 10;

/** A commitment still owed: not yet kept, broken, cancelled, or written off. */
const UNRESOLVED_COMMITMENT_STATUSES = new Set(["pending", "prepared", "partially_fulfilled", "deferred"]);

function characterName(world: WorldState, id: string): string {
  return world.characters.find((character) => character.id === id)?.name ?? id;
}

function polityName(world: WorldState, id: string | null): string {
  if (id === null) return "an unclaimed power";
  return world.map.polities.find((polity) => polity.id === id)?.name ?? id;
}

/**
 * Everything the campaign has left unfinished, read straight from committed
 * state. Bounded per kind so a long campaign cannot grow the prompt without
 * limit; the Game Master can always read more with the inspect tools.
 */
export function deriveOpenThreads(world: WorldState): OpenThreads {
  const forceName = (id: string) => world.material.forces.find((force) => force.id === id)?.name ?? id;

  // Signed peace treaties leave no standing entity of their own (see
  // `sign_treaty`: it ends a war and says so). The durable inter-polity
  // commitments the world does carry are its declared political relations.
  const treaties = (world.map.politicalRelations ?? [])
    .slice(0, MAX_THREADS_PER_KIND)
    .map((relation) => `${relation.kind}: ${polityName(world, relation.leaderPolityId)} and ${polityName(world, relation.memberPolityId)} (${relation.sourceNote})`);

  return {
    wars: world.conflicts.wars
      .slice(0, MAX_THREADS_PER_KIND)
      .map((war) => `${polityName(world, war.polityAId)} at war with ${polityName(world, war.polityBId)}`),
    battles: world.conflicts.battles
      .slice(0, MAX_THREADS_PER_KIND)
      .map((battle) => `${battle.battleId}: ${battle.attackerForceIds.map(forceName).join(", ")} against ${battle.participantForceIds.filter((id) => !battle.attackerForceIds.includes(id)).map(forceName).join(", ")}`),
    sieges: world.conflicts.sieges
      .slice(0, MAX_THREADS_PER_KIND)
      .map((siege) => `${siege.settlementId} besieged by ${siege.invadingForceIds.map(forceName).join(", ")}`),
    treaties,
    chronicleChains: (world.chronicleChains ?? [])
      .filter((chain) => !chain.resolved)
      .slice(0, MAX_THREADS_PER_KIND)
      .map((chain) => ({ id: chain.id, rootCause: chain.rootCause, openPressure: chain.openPressure })),
    commitments: (world.commitments ?? [])
      .filter((commitment) => UNRESOLVED_COMMITMENT_STATUSES.has(commitment.status))
      .slice(0, MAX_THREADS_PER_KIND)
      .map((commitment) => ({
        id: commitment.id,
        promisorName: characterName(world, commitment.promisorCharacterId),
        description: commitment.description,
        reviewAtStep: commitment.reviewAtStep,
      })),
    procedures: world.material.politicalProcedures
      .filter((procedure) => procedure.resolvedAtStep === null && procedure.stage !== "withdrawn" && procedure.stage !== "blocked")
      .slice(0, MAX_THREADS_PER_KIND)
      .map((procedure) => ({
        id: procedure.id,
        type: procedure.type,
        stage: procedure.stage,
        sponsorName: characterName(world, procedure.sponsorCharacterId),
        deadlineStep: procedure.deadlineStep,
      })),
    pressures: (world.characterPressures ?? [])
      .filter((pressure) => pressure.status === "active")
      .sort((left, right) => right.intensity - left.intensity)
      .slice(0, MAX_THREADS_PER_KIND)
      .map((pressure) => ({
        characterName: characterName(world, pressure.characterId),
        kind: pressure.kind,
        intensity: pressure.intensity,
        label: pressure.label,
      })),
    operations: (world.operations ?? [])
      .filter((operation) => operation.status === "active")
      .slice(0, MAX_THREADS_PER_KIND)
      .map((operation) => ({ id: operation.id, objective: operation.objective, stage: operation.stage })),
    incursions: world.material.forces
      .flatMap((force) => {
        const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
        if (province === undefined) return [];
        const host = province.controllerPolityId;
        if (host === null || host === force.polityId) return [];
        return [
          `${force.name} of ${polityName(world, force.polityId)} stands in ${province.name}, which is held by ${polityName(world, host)}`,
        ];
      })
      .slice(0, MAX_THREADS_PER_KIND),
    // Only the leaderless powers that have something to answer. A quiet
    // polity with no named character is not a loose end; one with a foreign
    // army on its soil or a war on its hands is, and cannot act until it has
    // someone to act through.
    leaderlessPolities: world.map.polities
      .filter((polity) => {
        if (world.characters.some((character) => character.alive && character.polityId === polity.id)) return false;
        const invaded = world.material.forces.some((force) => {
          if (force.polityId === polity.id) return false;
          const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
          return province?.controllerPolityId === polity.id;
        });
        const atWar = world.conflicts.wars.some((war) => war.polityAId === polity.id || war.polityBId === polity.id);
        return invaded || atWar;
      })
      .slice(0, MAX_THREADS_PER_KIND)
      .map((polity) => `${polity.name} [id: ${polity.id}]`),
    unansweredMessages: unansweredMessages(world.diplomacy)
      .slice(0, MAX_THREADS_PER_KIND)
      .map((message) => {
        const from = world.characters.find((character) => character.id === message.fromCharacterId)?.name ?? polityName(world, message.fromPolityId);
        const to = message.toCharacterId === null
          ? polityName(world, message.toPolityId)
          : characterName(world, message.toCharacterId);
        return `${message.id}: ${message.kind.replace(/_/g, " ")} from ${from} of ${polityName(world, message.fromPolityId)} to ${to}, sent step ${message.sentAtStep} — "${message.subject}"${message.replyDueByStep === null ? "" : ` (a reply was asked for by step ${message.replyDueByStep})`}`;
      }),
  };
}

export function renderOpenThreads(threads: OpenThreads): string {
  const section = (label: string, items: readonly string[]): string | null =>
    items.length === 0 ? null : `${label}:\n${items.map((item) => `  - ${item}`).join("\n")}`;

  return [
    section("Wars in progress", threads.wars),
    section("Battles under way", threads.battles),
    section("Sieges under way", threads.sieges),
    section("Standing inter-polity relations", threads.treaties),
    section("Open causal chains", threads.chronicleChains.map((chain) => `${chain.id}: ${chain.rootCause}${chain.openPressure ? ` (still pressing: ${chain.openPressure})` : ""}`)),
    section("Unresolved commitments", threads.commitments.map((commitment) => `${commitment.promisorName} owes: ${commitment.description} (due step ${commitment.reviewAtStep})`)),
    section("Political procedures in progress", threads.procedures.map((procedure) => `${procedure.id}: ${procedure.type} sponsored by ${procedure.sponsorName}, stage ${procedure.stage}${procedure.deadlineStep === null ? "" : `, deadline step ${procedure.deadlineStep}`}`)),
    section("Pressures on named characters", threads.pressures.map((pressure) => `${pressure.characterName}: ${pressure.kind} at ${pressure.intensity} (${pressure.label})`)),
    section("Standing operations", threads.operations.map((operation) => `${operation.id}: ${operation.objective} (stage ${operation.stage})`)),
    section("Foreign forces on another power's ground (each of these is being answered by someone)", threads.incursions),
    section(
      "Powers with no living named leader (give one a leader with create_world_character before expecting that power to act)",
      threads.leaderlessPolities,
    ),
    section(
      "Diplomatic messages awaiting an answer (answer_diplomatic_message closes one; the answer is the recipient's own, not the sender's)",
      threads.unansweredMessages,
    ),
  ]
    .filter((part): part is string => part !== null)
    .join("\n") || "Nothing is currently unresolved.";
}

/**
 * This turn's exact account, built from the factual event log.
 *
 * Deliberately not the Game Master's own `turnSummary`: that is a model's
 * prose, and campaign memory is the committed record. The report's summary is
 * appended only as a trailing note, capped, and only when there is room.
 */
export function summarizeTurnFacts(
  atStep: number,
  events: readonly FactualEvent[],
  capabilityRequests: readonly RecordedCapabilityRequest[],
): CampaignTurnMemory {
  const applied = events.filter((event) => event.kind === "action");
  const bullets = events.map((event) => `- ${event.summary.replace(/\s+/g, " ").trim()}`);
  let summary = bullets.join("\n");
  if (summary.length === 0) summary = "No world change occurred this turn.";
  if (summary.length > 1_200) summary = `${summary.slice(0, 1_197).trimEnd()}...`;

  return {
    atStep,
    summary,
    executedActionIds: [...new Set(applied.map((event) => event.actionId))].slice(0, 40),
    unresolvedActionCount: capabilityRequests.length,
  };
}
