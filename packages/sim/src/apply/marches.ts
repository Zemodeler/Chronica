import { adjacentTo, isWaterCrossing, kmFrom, landKmBetween, type Force, type ProvinceEdge, type WorldState } from "@chronica/shared";
import type { ApplyContext } from "./context";

/**
 * An army's journeys, as later orders find them.
 *
 * The consul's march to Rhegium was told "set out from Latium ... 87 days"
 * again and again through one play-test, after a battle as before it. Every
 * re-order that was not word for word the first one called the march off and
 * began it again from Latium, at its full length: told to make for Messana
 * while it marched to Rhegium to take ship for Messana, it turned back from
 * Rhegium; told Rhegium while the crossing from Rhegium was arranged, it
 * gave the crossing up. And an army stands where it started until it
 * arrives, so a march that was turned began again from home, the days
 * already walked thrown away.
 */

type Project = WorldState["projects"][number];

/**
 * Days a commander other than the player holds a course he set before he may
 * turn it. The world speaking for the powers holds it too: the orchestrator
 * sent the consul's army one way and then the other in successive bursts, and
 * each turn began the march again.
 */
export const SETTLED_COURSE_DAYS = 14;

/** Whether a province looks across the water at another it cannot walk to: Rhegium, at Messana. */
function facesOver(world: WorldState, shore: string, to: string): boolean {
  return adjacentTo(world, shore).some((neighbour) => neighbour.provinceId === to && isWaterCrossing(neighbour.edge.crossing))
    && landKmBetween(world, shore, to) === null;
}

/**
 * Whether a journey a force is on already carries out an order to go to `to`:
 * it goes there; it is the crossing from `to`, the shore it was sent to; it
 * is the march to the shore a crossing there leaves from; or it is a march to
 * a shore that faces `to` over the water.
 */
export function onTheWayTo(world: WorldState, project: Project, to: string): boolean {
  const outcome = project.completionOutcome;
  if (outcome?.kind !== "force_move" || outcome.provinceId === null) return false;
  if (outcome.provinceId === to || outcome.embarkProvinceId === to) return true;
  // Ships go where they are sent: a fleet sailing for Rhegium is not on its
  // way to Messana.
  if (project.kind === "sailing" || project.kind === "crossing") return false;
  const shore = outcome.provinceId;
  const mover = outcome.forceId;
  const legOfACrossing = mover !== null && world.projects.some((crossing) => crossing.id !== project.id && crossing.status === "in_progress"
    && crossing.completionOutcome?.kind === "force_move" && crossing.completionOutcome.provinceId === to
    && crossing.completionOutcome.embarkProvinceId === shore
    && (crossing.completionOutcome.forceId === mover || (crossing.completionOutcome.fleetIds ?? []).includes(mover)));
  return legOfACrossing || facesOver(world, shore, to);
}

/**
 * The shore facing `to` that this army is already walking to, and how far it
 * is from where the army stands. A crossing arranged for it leaves from
 * there, though the ships might have met it nearer: the legion on the road
 * to Rhegium, told to make for Messana, takes ship at Rhegium.
 */
export function shoreItMakesFor(world: WorldState, army: Force, to: string): { readonly shore: string; readonly marchKm: number } | null {
  const shore = journeysOf(world, army.id).find((project) => project.kind !== "crossing" && project.completionOutcome?.provinceId !== to
    && onTheWayTo(world, project, to))?.completionOutcome?.provinceId ?? null;
  return shore === null ? null : { shore, marchKm: landKmBetween(world, army.locationId, shore) ?? 0 };
}

/** The journeys this force is on now. */
export function journeysOf(world: WorldState, forceId: string): readonly Project[] {
  return world.projects.filter((project) => project.status === "in_progress"
    && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === forceId);
}

/**
 * The course an order may not turn: one this force set out on less than a
 * fortnight ago, going somewhere the order does not. The player turns his
 * own armies as he likes. Anyone else -- a commander turning the march he
 * set, or the world speaking for the powers -- keeps to it, unless the
 * order sends it the way it is already going.
 */
export function settledCourse(world: WorldState, forceId: string, to: string, context: ApplyContext): Project | undefined {
  const player = context.playerCharacterId;
  if (player == null) return undefined;
  const theWorldSpeaks = context.actsForTheWorld === true && context.forTheOrder !== true;
  if (context.actorRef.id === player && !theWorldSpeaks) return undefined;
  const atStep = world.elapsedStep;
  return journeysOf(world, forceId).find((project) => !onTheWayTo(world, project, to)
    && atStep - project.startedAtStep < SETTLED_COURSE_DAYS
    && (theWorldSpeaks || (project.sponsorEntityRef.kind === "character" && project.sponsorEntityRef.id === context.actorRef.id)));
}

/**
 * Where on its road a force has got to: the province on the way nearest the
 * share of the road its days have covered. Never the end of the road -- it
 * has not arrived until the march says it has -- and the start of it when the
 * way cannot be traced. An army keeps to the land; ships to anything.
 */
export function whereOnTheRoad(world: WorldState, project: Project, from: string, bySea: boolean): string {
  const to = project.completionOutcome?.provinceId ?? null;
  if (to === null || to === from) return from;
  const days = Math.max(0, ...project.milestones.map((milestone) => milestone.requiredAtElapsedOffset));
  const share = days <= 0 ? 0 : Math.min(1, Math.max(0, (world.elapsedStep - project.startedAtStep) / days));
  if (share === 0) return from;
  const passable = (edge: ProvinceEdge): boolean => bySea || !isWaterCrossing(edge.crossing);
  const toGo = kmFrom(world, to, { passable });
  const length = toGo.get(from);
  if (length === undefined) return from;
  const walked = share * length;
  let here = from;
  let done = 0;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const left = toGo.get(here)!;
    const next = adjacentTo(world, here).find((neighbour) => passable(neighbour.edge) && toGo.has(neighbour.provinceId)
      && Math.abs(neighbour.edge.distance + toGo.get(neighbour.provinceId)! - left) < 1e-6);
    if (next === undefined || next.provinceId === to) return here;
    const further = done + next.edge.distance;
    if (further >= walked) return walked - done <= further - walked ? here : next.provinceId;
    here = next.provinceId;
    done = further;
  }
  return here;
}

/**
 * An army whose march was turned this act, standing where the road had
 * brought it. The force object itself is the mark: the next change to the
 * army replaces it, and the mark with it.
 */
const turned = new WeakSet<Force>();

/** The army, moved to where the march being called off had brought it. */
export function turnOnTheRoad(world: WorldState, force: Force, march: Project): Force {
  const near = whereOnTheRoad(world, march, force.locationId, march.kind === "sailing");
  const moved: Force = near === force.locationId ? { ...force } : { ...force, locationId: near, positionId: null };
  turned.add(moved);
  return moved;
}

/** Whether this army was turned on the road by the order now being carried out. */
export function wasTurnedOnTheRoad(force: Force): boolean {
  return turned.has(force);
}
