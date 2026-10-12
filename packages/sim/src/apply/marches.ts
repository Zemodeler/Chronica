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
 * Where on its road a force is: the last province it has reached, the one it
 * is walking toward and how far along that stretch it is. The road's end only
 * once the road is walked: a march (one stretch, or a strait's shore) is
 * never finished early by being turned.
 *
 * A march of one stretch turned on its fifteenth day of twenty stood where it
 * had set out, the fifteen days thrown away; the first repair put it at the
 * nearest province instead, which past the middle of a stretch was the far
 * end -- an army half way to a place set down in it, and a march of one
 * stretch finished by being called off. The world holds an army at a
 * province, so it stands at the last one it reached, and the part of the
 * stretch it has walked goes with it (`turnOnTheRoad`) into the journey it
 * makes next. A journey that itself began part way along a stretch
 * (`Project.offRoad`) is read from there: on the way on, the walked part
 * counted; on the way back, that much to walk before it is at the province.
 * The start when the way cannot be traced. An army keeps to the land; ships
 * to anything.
 */
export interface RoadProgress {
  /** The last province reached. */
  readonly at: string;
  /** The province it is walking toward from there, when it is part way along a stretch. */
  readonly toward: string | null;
  /** How far along that stretch, in km. */
  readonly kmAlong: number;
  /** The stretch's length. */
  readonly stretchKm: number;
}

export function progressOnTheRoad(world: WorldState, project: Project, from: string, bySea: boolean): RoadProgress {
  const passable = (edge: ProvinceEdge): boolean => bySea || !isWaterCrossing(edge.crossing);
  const stretchOf = (a: string, b: string): number | undefined => adjacentTo(world, a).find((neighbour) => neighbour.provinceId === b && passable(neighbour.edge))?.edge.distance;
  const off = project.offRoad;
  const offStretch = off === undefined ? undefined : stretchOf(from, off.towardProvinceId);
  const standing: RoadProgress = off === undefined || offStretch === undefined || off.km <= 0
    ? { at: from, toward: null, kmAlong: 0, stretchKm: 0 }
    : { at: from, toward: off.towardProvinceId, kmAlong: Math.min(off.km, offStretch), stretchKm: offStretch };
  const to = project.completionOutcome?.provinceId ?? null;
  if (to === null) return standing;
  const days = Math.max(0, ...project.milestones.map((milestone) => milestone.requiredAtElapsedOffset));
  const share = days <= 0 ? 0 : Math.min(1, Math.max(0, (world.elapsedStep - project.startedAtStep) / days));
  const toGo = kmFrom(world, to, { passable });
  const length = toGo.get(from);
  if (length === undefined) return standing;
  // Where it began, read against the road it is on: already that far along its first stretch, or that far to walk back first.
  let walked = share * length;
  let first: string | null = null;
  if (standing.toward !== null) {
    const beyond = toGo.get(standing.toward);
    const onward = beyond !== undefined && Math.abs(standing.stretchKm + beyond - length) < 1e-6;
    if (onward) {
      walked = standing.kmAlong + share * (length - standing.kmAlong);
      first = standing.toward;
    } else {
      const back = share * (standing.kmAlong + length);
      if (back < standing.kmAlong) return { ...standing, kmAlong: standing.kmAlong - back };
      walked = back - standing.kmAlong;
    }
  }
  if (walked <= 0) return { at: from, toward: null, kmAlong: 0, stretchKm: 0 };
  let here = from;
  let done = 0;
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (here === to) return { at: to, toward: null, kmAlong: 0, stretchKm: 0 };
    const left = toGo.get(here)!;
    const next = adjacentTo(world, here).find((neighbour) => passable(neighbour.edge) && toGo.has(neighbour.provinceId)
      && (first === null || here !== from || neighbour.provinceId === first)
      && Math.abs(neighbour.edge.distance + toGo.get(neighbour.provinceId)! - left) < 1e-6);
    if (next === undefined) return { at: here, toward: null, kmAlong: 0, stretchKm: 0 };
    const further = done + next.edge.distance;
    // Short of the next province: it is on the stretch, and has reached only where it set out on it.
    if (further > walked + 1e-9) return { at: here, toward: next.provinceId, kmAlong: walked - done, stretchKm: next.edge.distance };
    here = next.provinceId;
    done = further;
  }
  return { at: here, toward: null, kmAlong: 0, stretchKm: 0 };
}

/** The last province a force on this road has reached (`progressOnTheRoad`). */
export function whereOnTheRoad(world: WorldState, project: Project, from: string, bySea: boolean): string {
  return progressOnTheRoad(world, project, from, bySea).at;
}

/**
 * An army whose march was turned this act, standing at the last province the
 * road had brought it to, with the part of the next stretch it had walked.
 * The force object itself is the mark: the next change to the army replaces
 * it, and the mark with it.
 */
const turned = new WeakSet<Force>();
const partway = new WeakMap<Force, { readonly toward: string; readonly km: number; readonly stretchKm: number }>();

/** The army, moved to the last province the march being called off had brought it to. */
export function turnOnTheRoad(world: WorldState, force: Force, march: Project): Force {
  const progress = progressOnTheRoad(world, march, force.locationId, march.kind === "sailing");
  const moved: Force = progress.at === force.locationId ? { ...force } : { ...force, locationId: progress.at, positionId: null };
  turned.add(moved);
  if (progress.toward !== null && progress.kmAlong > 0) partway.set(moved, { toward: progress.toward, km: progress.kmAlong, stretchKm: progress.stretchKm });
  return moved;
}

/** How far along a stretch an army turned by this order was standing, and toward where; undefined at a province. */
export function partwayOf(force: Force): { readonly toward: string; readonly km: number; readonly stretchKm: number } | undefined {
  return partway.get(force);
}

/** Whether this army was turned on the road by the order now being carried out. */
export function wasTurnedOnTheRoad(force: Force): boolean {
  return turned.has(force);
}
