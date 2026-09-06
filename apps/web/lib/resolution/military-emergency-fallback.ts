import "server-only";

import type { FactualEvent, ProposedInvocation, WorldState } from "@chronica/shared";
import { executeWorkflows } from "@chronica/shared";

/**
 * Deterministic, non-LLM guarantee for requirement 4: an invaded polity must
 * take one legal, state-backed response in the same turn even if the Game
 * Master never got around to it -- silently ignored the emergency, spent its
 * budget elsewhere, ranked a low-value action higher, or failed outright
 * (model_stopped / step_budget / tool_budget / provider_error).
 *
 * Deliberately narrow, the same way `ensurePolityLeadership` and
 * `advanceWorldDynamics` are: it only ever acts for a polity with a foreign
 * force standing on its own controlled ground (the same condition that seeds
 * its leader and its `military_emergency` pressure in the first place), and
 * only when nothing this turn already answered for it. It never overrides,
 * second-guesses, or duplicates a response the Game Master or a political
 * procedure already made.
 */
export interface MilitaryEmergencyFallbackResult {
  readonly world: WorldState;
  readonly events: readonly Omit<FactualEvent, "id">[];
  readonly invocations: readonly { readonly invocation: ProposedInvocation; readonly ok: boolean; readonly summary: string }[];
}

/** Action ids that count as a real response to an invasion, however produced this turn. */
const RESPONSE_ACTION_IDS = new Set([
  "create_force",
  "move_force",
  "start_siege",
  "start_battle",
  "start_war",
  "send_diplomatic_message",
]);

const FALLBACK_LEVY_SIZE = 1_500;

export function applyMilitaryEmergencyFallback(
  world: WorldState,
  atStep: number,
  respondedThisTurn: readonly ProposedInvocation[],
): MilitaryEmergencyFallbackResult {
  // Which polities already answered for themselves this turn, by any actor
  // belonging to them, through any of the response actions above.
  const alreadyResponded = new Set<string>();
  for (const invocation of respondedThisTurn) {
    if (!RESPONSE_ACTION_IDS.has(invocation.actionId)) continue;
    const actor = world.characters.find((character) => character.id === invocation.actorId);
    if (actor?.polityId) alreadyResponded.add(actor.polityId);
    // start_war/start_siege/start_battle/move_force name the polity or force
    // directly in their own parameters too, independent of who the actor is.
    for (const key of ["polityId", "polityAId", "polityBId", "defendingForceId"] as const) {
      const value = invocation.parameters[key];
      if (typeof value === "string") alreadyResponded.add(value);
    }
    const forceId = invocation.parameters["forceId"] ?? invocation.parameters["invadingForceIds"];
    if (typeof forceId === "string") {
      const force = world.material.forces.find((f) => f.id === forceId);
      if (force) alreadyResponded.add(force.polityId);
    }
  }

  const events: Omit<FactualEvent, "id">[] = [];
  const invocations: { invocation: ProposedInvocation; ok: boolean; summary: string }[] = [];
  let next = world;
  const handledDefenders = new Set<string>();

  for (const force of world.material.forces) {
    const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
    const defenderPolityId = province?.controllerPolityId;
    if (!province || !defenderPolityId || defenderPolityId === force.polityId) continue;
    if (handledDefenders.has(defenderPolityId) || alreadyResponded.has(defenderPolityId)) continue;
    handledDefenders.add(defenderPolityId);

    const leader = next.characters.find((character) => character.alive && character.polityId === defenderPolityId);
    if (!leader) continue;
    const polity = next.map.polities.find((candidate) => candidate.id === defenderPolityId);
    if (!polity) continue;

    const idleForce = next.material.forces.find(
      (candidate) => candidate.polityId === defenderPolityId && candidate.locationId !== province.id,
    );

    const invocation: ProposedInvocation = idleForce
      ? { actionId: "move_force", actorId: leader.id, parameters: { forceId: idleForce.id, destinationProvinceId: province.id } }
      : {
        actionId: "create_force",
        actorId: leader.id,
        parameters: {
          polityId: defenderPolityId,
          locationProvinceId: next.map.provinces.find((candidate) => candidate.controllerPolityId === defenderPolityId)?.id ?? province.id,
          name: `${polity.name} levy`,
          size: FALLBACK_LEVY_SIZE,
          kind: "infantry",
          payerAccountId: leader.personalAccountId,
        },
      };

    const executed = executeWorkflows([invocation], next, atStep);
    const outcome = executed.log[0]!.outcome;
    if (outcome.ok) {
      next = executed.world;
      const invaderName = next.map.polities.find((candidate) => candidate.id === force.polityId)?.name ?? force.polityId;
      // `leader.name` already reads as "<polity> leader" (polity-leadership.ts's
      // placeholder register for an unnamed representative), so naming both
      // the polity and the leader in one sentence repeats it -- name the
      // leader once and let them stand for their polity, the way the rest of
      // the Chronicle already treats a named officeholder.
      const summary = idleForce
        ? `Facing ${invaderName}'s unanswered incursion, ${leader.name} orders ${idleForce.name} to ${province.name} to meet it.`
        : `With no force of its own to answer ${invaderName}'s incursion, ${leader.name} levies ${invocation.parameters["name"]} to meet it.`;
      events.push({
        atStep,
        kind: "action",
        actionId: invocation.actionId,
        actorId: leader.id,
        parameters: invocation.parameters,
        summary,
        materialConsequence: true,
      });
      invocations.push({ invocation, ok: true, summary: outcome.result.summary });
    } else {
      // No legal means this turn (no idle force, and the levy itself was
      // refused -- e.g. an invalid location). Nothing is fabricated; the
      // polity simply has nothing it can lawfully do about it yet.
      invocations.push({ invocation, ok: false, summary: outcome.message ?? "No legal response was available." });
    }
  }

  return { world: next, events, invocations };
}
