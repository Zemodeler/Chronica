import "server-only";

import {
  createPressure,
  refreshPressure,
  type FactualEvent,
  type WorldState,
} from "@chronica/shared";
import { advanceWorldDevelopments } from "./world-development-scheduler";

/**
 * Deterministic, state-backed pressures which make the political and military
 * situation impossible for the Game Master to overlook.  This is deliberately
 * not a random-event table: every entry below is derived from a force, a
 * province controller, an institution, or an active war that is already in
 * the authoritative snapshot.
 *
 * It runs before the Game Master chooses actions.  That matters: an invaded
 * polity's leader receives an actual military emergency in the same turn, so
 * character agency can form a response instead of discovering the invasion
 * only after the turn has already been narrated.
 */
export interface WorldDynamicsResult {
  readonly world: WorldState;
  readonly events: readonly Omit<FactualEvent, "id">[];
}

function livingLeader(world: WorldState, polityId: string): string | null {
  return world.characters
    .filter((character) => character.alive && character.polityId === polityId)
    .sort((a, b) => a.id.localeCompare(b.id))[0]?.id ?? null;
}

function romanOfficeholder(world: WorldState): string | null {
  const holderId = world.material.officeSeats
    .filter((seat) => seat.status === "held" && seat.holderCharacterId !== null && /^roman-/.test(seat.officeId))
    .sort((a, b) => a.officeId.localeCompare(b.officeId) || a.seatIndex - b.seatIndex)[0]?.holderCharacterId;
  if (holderId !== undefined && world.characters.some((character) => character.id === holderId && character.alive)) return holderId;
  return livingLeader(world, "rome");
}

function refreshOrCreatePressure(
  world: WorldState,
  input: {
    id: string;
    characterId: string;
    kind: "military_emergency" | "political_danger";
    intensity: number;
    label: string;
    atStep: number;
    visibility: "public" | "polity";
  },
): WorldState {
  const existing = world.characterPressures.find((pressure) => pressure.id === input.id && pressure.status === "active");
  const updated = existing
    ? refreshPressure(world, existing.id, input.atStep, Math.max(1, input.intensity - existing.intensity), 2)
    : createPressure(world, {
      ...input,
      sourceEventId: null,
      reviewInSteps: 2,
      expiresInSteps: null,
    });
  return { ...world, characters: [...updated.characters], characterPressures: [...updated.characterPressures] };
}

export function advanceWorldDynamics(world: WorldState, atStep: number): WorldDynamicsResult {
  let next = world;
  const events: Omit<FactualEvent, "id">[] = [];

  // A force on another polity's controlled ground is an actionable incursion,
  // not background decoration.  One pressure per defending polity is enough:
  // it tells its leader exactly which army and province demand an answer,
  // while avoiding a card per unit in a stack.
  const handledDefenders = new Set<string>();
  for (const force of world.material.forces) {
    const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
    const defenderPolityId = province?.controllerPolityId;
    if (!province || defenderPolityId === undefined || defenderPolityId === null || defenderPolityId === force.polityId || handledDefenders.has(defenderPolityId)) continue;
    const leaderId = livingLeader(next, defenderPolityId);
    if (leaderId === null) continue;
    const invader = next.map.polities.find((polity) => polity.id === force.polityId)?.name ?? force.polityId;
    const defender = next.map.polities.find((polity) => polity.id === defenderPolityId)?.name ?? defenderPolityId;
    const leader = next.characters.find((character) => character.id === leaderId)!;
    const pressureId = `world-incursion-${defenderPolityId}-${force.id}`;
    next = refreshOrCreatePressure(next, {
      id: pressureId,
      characterId: leaderId,
      kind: "military_emergency",
      intensity: 75,
      label: `${force.name} of ${invader} stands in ${province.name}, controlled by ${defender}.`,
      atStep,
      visibility: "public",
    });
    events.push({
      atStep,
      kind: "action",
      actionId: "world_incursion_pressure",
      actorId: leaderId,
      parameters: { forceId: force.id, provinceId: province.id, defenderPolityId },
      summary: `${leader.name} faces an immediate military emergency: ${force.name} of ${invader} is on ${defender} ground in ${province.name}.`,
      materialConsequence: true,
    });
    handledDefenders.add(defenderPolityId);
  }

  // Rome is a republic, not a button the player presses.  Every second season
  // its Senate re-evaluates a concrete current burden.  The resulting pressure
  // is persistent state that agency can turn into a procedure, a factional
  // response, or a political choice; it is not a flavour-only notification.
  const senate = next.material.institutions.find((institution) => institution.polityId === "rome" && /senate/i.test(institution.name));
  if (senate && atStep % 2 === 0) {
    const romanLeaderId = romanOfficeholder(next);
    if (romanLeaderId !== null) {
      const romanLeader = next.characters.find((character) => character.id === romanLeaderId)!;
      const romanForceOutsideControlledGround = next.material.forces.find((force) => {
        if (force.polityId !== "rome") return false;
        const province = next.map.provinces.find((candidate) => candidate.id === force.locationId);
        return province !== undefined && province.controllerPolityId !== "rome";
      });
      const atWar = next.conflicts.wars.some((war) => war.polityAId === "rome" || war.polityBId === "rome");
      const subject = romanForceOutsideControlledGround
        ? `${romanForceOutsideControlledGround.name} is operating beyond Roman-controlled ground`
        : atWar
          ? "the Republic is committed to an active war"
          : "Rome's current military and financial readiness";
      const pressureId = "world-roman-senate-scrutiny";
      next = refreshOrCreatePressure(next, {
        id: pressureId,
        characterId: romanLeaderId,
        kind: "political_danger",
        intensity: romanForceOutsideControlledGround || atWar ? 65 : 40,
        label: `The Senate demands an account of ${subject}.`,
        atStep,
        visibility: "polity",
      });
      events.push({
        atStep,
        kind: "action",
        actionId: "roman_senate_scrutiny",
        actorId: romanLeaderId,
        parameters: { institutionId: senate.id, forceId: romanForceOutsideControlledGround?.id ?? null, atWar },
        summary: `The Senate calls ${romanLeader.name} to account for ${subject}.`,
        materialConsequence: true,
      });
    }
  }

  const developments = advanceWorldDevelopments(next, atStep);
  return { world: developments.world, events: [...events, ...developments.events] };
}
