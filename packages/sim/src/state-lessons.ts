import { readDepartments, warStanding, type LessonKind, type WorldState } from "@chronica/shared";
import { teach } from "./grievances";

/**
 * What a state's life teaches the man who rules it (mind-drift.ts).
 *
 * A mind used to move only by what happened to him in person: a plot against
 * him, an order he defied. A king who lost his capital, won a long war, or broke
 * his sworn word was exactly the man he had been, so the world AI weighed
 * his next war the same way. Here the events of a state are written as lessons
 * on whoever rules it, and his next life review moves him by them -- a little,
 * never more than the review's limit -- so the personality the AI reads
 * changes with what he has been through. All deterministic; no model.
 */

/** Everybody who rules this power, alive. */
function rulersOf(world: WorldState, polityId: string): readonly string[] {
  return readDepartments(world).rulers(polityId).filter((ruler) => ruler.alive).map((ruler) => ruler.id);
}

export function teachRulers(world: WorldState, polityId: string, kind: LessonKind, atStep: number): WorldState {
  return rulersOf(world, polityId).reduce((next, id) => teach(next, id, kind, atStep), world);
}

/** A war ends by treaty: whoever was clearly winning it learns one thing and whoever was clearly losing it another. */
export function lessonsOfPeace(world: WorldState, a: string, b: string, atStep: number): WorldState {
  const atWar = world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "war"
    && ((agreement.polityId === a && agreement.otherPolityId === b) || (agreement.polityId === b && agreement.otherPolityId === a)));
  if (!atWar) return world;
  const ours = warStanding(world, a, b);
  if (ours.dictates || ours.score >= 25) return teachRulers(teachRulers(world, a, "war_won", atStep), b, "war_lost", atStep);
  const theirs = warStanding(world, b, a);
  if (theirs.dictates || theirs.score >= 25) return teachRulers(teachRulers(world, b, "war_won", atStep), a, "war_lost", atStep);
  return world;
}

/** Cities that fell today: the power that lost one, and the man who took it, learn from it. */
export function lessonsOfSieges(world: WorldState, toDay: number, sackedProvinceIds: ReadonlySet<string>): WorldState {
  let next = world;
  for (const siege of world.sieges) {
    if (siege.status !== "taken" || siege.endedAtStep !== toDay) continue;
    next = teachRulers(next, siege.defenderPolityId, "city_lost", toDay);
    if (!sackedProvinceIds.has(siege.provinceId)) continue;
    const taker = world.material.forces.find((force) => force.id === siege.forceId)?.commanderCharacterId;
    if (taker !== undefined) next = teach(next, taker, "sacked_a_city", toDay);
  }
  return next;
}

/** A peace broken to make a war: the man who broke it, and the man he broke it against. */
export function lessonsOfBreach(world: WorldState, breaker: string, victim: string, atStep: number): WorldState {
  return teachRulers(teachRulers(world, breaker, "oath_broken", atStep), victim, "betrayed", atStep);
}
