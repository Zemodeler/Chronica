import { atWar, deriveRelationDimension, provinceLevel, type MechanicPredicate, type WorldState } from "@chronica/shared";

/**
 * Evaluating what the ruler asked to be woken for (VISION §23's
 * `watch_condition`).
 *
 * `world/watch.ts` defined the language years ago and nothing ever read it, so
 * "wake me when the army reaches Boii country" was prose the world could not
 * act on: each order was one burst with one budget, and a forty-five-day march
 * had to be re-authorised four times to cross. This is the missing half.
 *
 * Deterministic and free, per that module's own reasoning: no model call is made
 * to decide whether a watch has fired, so a burst can test it after every hop
 * without the elastic clock becoming the most expensive thing in the design.
 *
 * **Every condition is about a change, not a state.** A watch is a thing to be
 * woken *for*; a condition that was already true when the order was given has
 * not happened, and waking for it ends the order in the act of giving it. Two
 * arms guarded against that and the rest did not, so "wake me when the north
 * is eight thousand strong" -- said by a ruler who already had eight thousand
 * men -- fired on the first hop, and the order it was attached to carried the
 * world two days and did nothing. That is what the whole watch mechanism
 * exists to prevent: it was built so a forty-five-day march need not be
 * re-authorised four times to cross.
 *
 * So the predicate is evaluated twice -- against the world as it stands and
 * against the world as it stood when the order was given -- and it has fired
 * only if it holds now and did not hold then.
 */

const fitStrength = (force: { readonly personnel: readonly { readonly fit: number }[] }): number =>
  force.personnel.reduce((sum, category) => sum + category.fit, 0);

/**
 * How many letters from one power to the other have had the answer watched
 * for. A count, not a yes: Rome has written to Syracuse before, and the
 * answer to an old letter must not stand in for the one being waited on.
 */
function lettersAnswered(predicate: Extract<MechanicPredicate, { kind: "letter_answered" }>, world: WorldState): number {
  return world.diplomacy.filter((message) => message.status === "answered"
    && message.fromPolityId === predicate.fromPolityId && message.toPolityId === predicate.toPolityId
    && (predicate.answer === undefined
      || (predicate.answer === "accepted" ? message.answer === "accepted" : message.answer === "refused" || message.answer === "ignored"))).length;
}

/**
 * Whether the condition holds of one world, said without reference to any
 * other. Reads the watch's arms and the mechanic's (`world/mechanic.ts`): one
 * language, one evaluator.
 */
export function holdsIn(predicate: MechanicPredicate, world: WorldState, month: number | null = null): boolean {
  switch (predicate.kind) {
    // The season, where the caller knows the calendar; otherwise never.
    case "in_months":
      return month !== null && predicate.months.includes(month);
    case "force_enters_province":
      return world.material.forces.some(
        (force) =>
          force.locationId === predicate.provinceId &&
          (predicate.polityId === undefined ? true : force.polityId === predicate.polityId),
      );
    case "force_enters_position":
      return world.material.forces.some(
        (force) =>
          force.positionId === predicate.positionId &&
          (predicate.polityId === undefined ? true : force.polityId === predicate.polityId),
      );
    case "polity_strength_above": {
      const headcount = world.material.forces
        .filter((force) => force.polityId === predicate.polityId)
        .reduce((sum, force) => sum + fitStrength(force), 0);
      return headcount > predicate.headcount;
    }
    case "force_strength_below": {
      const force = world.material.forces.find((candidate) => candidate.id === predicate.forceId);
      return force !== undefined && fitStrength(force) < predicate.headcount;
    }
    case "account_below": {
      const account = world.material.accounts.find((candidate) => candidate.id === predicate.accountId);
      return account !== undefined && account.balance < predicate.amount;
    }
    case "arrears_reach": {
      const obligation = world.material.obligations.find((candidate) => candidate.id === predicate.obligationId);
      return obligation !== undefined && obligation.missedPeriods >= predicate.periods;
    }
    case "character_dies": {
      const character = world.characters.find((candidate) => candidate.id === predicate.characterId);
      return character !== undefined && !character.alive;
    }
    case "question_decided": {
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === predicate.procedureId);
      return procedure !== undefined && procedure.resolvedAtStep !== null
        && (predicate.outcome === undefined ? procedure.outcome === "passed" || procedure.outcome === "failed" : procedure.outcome === predicate.outcome);
    }
    case "letter_answered":
      return lettersAnswered(predicate, world) > 0;
    case "office_vacant": {
      const seats = world.material.officeSeats.filter((seat) => seat.officeId === predicate.officeId);
      if (seats.length === 0) return false;
      return seats.some((seat) => seat.holderCharacterId === null) === predicate.vacant;
    }
    case "province_level_above": {
      const level = provinceLevel(world, predicate.provinceId, predicate.level);
      return level !== null && level > predicate.bps;
    }
    case "province_level_below": {
      const level = provinceLevel(world, predicate.provinceId, predicate.level);
      return level !== null && level < predicate.bps;
    }
    case "account_above": {
      const account = world.material.accounts.find((candidate) => candidate.id === predicate.accountId);
      return account !== undefined && account.balance > predicate.amount;
    }
    case "relation_above":
    case "relation_below": {
      const subject = world.characters.find((candidate) => candidate.id === predicate.subjectCharacterId);
      if (subject === undefined || !world.characters.some((candidate) => candidate.id === predicate.targetCharacterId)) return false;
      const score = deriveRelationDimension(subject, predicate.targetCharacterId, predicate.dimension);
      return predicate.kind === "relation_above" ? score > predicate.score : score < predicate.score;
    }
    case "polity_trust_above":
    case "polity_trust_below": {
      if (!world.map.polities.some((polity) => polity.id === predicate.polityId) || !world.map.polities.some((polity) => polity.id === predicate.towardPolityId)) return false;
      const trust = world.polityStances.find((stance) => stance.polityId === predicate.polityId && stance.towardPolityId === predicate.towardPolityId)?.trustScore ?? 0;
      return predicate.kind === "polity_trust_above" ? trust > predicate.score : trust < predicate.score;
    }
    case "at_war":
      return atWar(world.polityAgreements, predicate.polityId, predicate.otherPolityId) === predicate.atWar;
    case "force_strength_above": {
      const force = world.material.forces.find((candidate) => candidate.id === predicate.forceId);
      return force !== undefined && fitStrength(force) > predicate.headcount;
    }
    // Not states anybody can hold: they are the comparison itself.
    case "province_control_changes":
    case "settlement_control_changes":
      return false;
    default:
      return false;
  }
}

/**
 * What the predicate reads as, right now, as one stable string.
 *
 * Split out from the comparison because a *durable* watcher cannot hold two
 * worlds. A ruler's watch compares the start of the burst with the end of it,
 * and that is all it ever needs; a contingency is armed in March and springs in
 * August, and the world it was armed against is long gone. So it keeps this
 * reading instead, and fires when the reading changes in the right direction.
 *
 * Two shapes, because the union has two shapes. Most predicates are states a
 * world either holds or does not. Two of them -- who holds a province, who
 * holds a city -- are not states anybody can hold: the event *is* the change,
 * so the reading is the holder itself and any difference is the event. A
 * letter answered is a third: the reading is how many have been, and one more
 * is the event.
 */
export function watchReading(predicate: MechanicPredicate, world: WorldState, month: number | null = null): string {
  if (predicate.kind === "province_control_changes") {
    return world.map.provinces.find((province) => province.id === predicate.provinceId)?.controllerPolityId ?? "none";
  }
  if (predicate.kind === "settlement_control_changes") {
    return world.map.provinces
      .flatMap((province) => province.settlements)
      .find((settlement) => settlement.id === predicate.settlementId)?.controllerPolityId ?? "none";
  }
  // An answer is an event too, and there may have been answers before it.
  if (predicate.kind === "letter_answered") return String(lettersAnswered(predicate, world));
  return holdsIn(predicate, world, month) ? "yes" : "no";
}

/**
 * Whether the thing watched for has happened, between two readings.
 *
 * For a state, it has to have *become* true: a condition already true when the
 * order was given has not happened, and waking for it ends the order in the act
 * of giving it. For a change, any difference is the whole event.
 */
export function firedBetween(predicate: MechanicPredicate, armedReading: string, nowReading: string): boolean {
  if (predicate.kind === "province_control_changes" || predicate.kind === "settlement_control_changes") {
    return nowReading !== armedReading;
  }
  if (predicate.kind === "letter_answered") return (Number(nowReading) || 0) > (Number(armedReading) || 0);
  return nowReading === "yes" && armedReading !== "yes";
}

export function isWatchSatisfied(predicate: MechanicPredicate, opening: WorldState, now: WorldState): boolean {
  return firedBetween(predicate, watchReading(predicate, opening), watchReading(predicate, now));
}
