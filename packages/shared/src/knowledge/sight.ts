import { seesForce, type Station } from "../authority/station";
import { bandStrength } from "../material/in-words";
import { asShips, countWord, fitStrengthOf, isNavalForce, isWaterCrossing } from "../warfare/sea";
import type { ScenarioWarfareRules } from "../warfare/battle";
import type { Fact } from "../world/facts";
import { kmFromAny } from "../world/movement";
import { SIGHT_KM } from "../world/travel";
import type { WorldState } from "../world/world-state";
import { strangerStrength } from "./glossary";

/**
 * Which armies a person knows the whereabouts of, and where they think they are.
 *
 * The map drew every army in the world where it actually stood, to anybody:
 * a Roman citizen watched a Carthaginian fleet put out from Utica the hour it
 * sailed. Their own power's armies are on its rolls. Anybody else's is known
 * where it can be seen -- on or beside their power's own ground, or beside
 * where they themselves stand, hold land or have men -- or where a report of
 * it has reached them lately, and then it is shown where the report put it.
 */

/** How long a report of an army's whereabouts is still where it is: a month on, it has marched. */
export const ARMY_REPORT_DAYS = 30;

export interface ArmyInSight {
  readonly forceId: string;
  /** Where the viewer believes it is: where it stands, if seen; where the last report put it, if not. */
  readonly provinceId: string;
  /** "About 9,000 men", "between 8,000 and 10,000 men", or "strength unknown". */
  readonly strengthLabel: string;
}

export function armiesInSight(world: WorldState, station: Station, knownFacts: readonly Fact[], warfare?: ScenarioWarfareRules): ArmyInSight[] {
  const now = world.elapsedStep;
  const watched = new Set<string>([
    ...world.map.provinces.filter((province) => station.polityId !== null && province.controllerPolityId === station.polityId).map((province) => province.id),
    ...station.provinceIds,
  ]);
  // A day's ride out: an army on the frontier is seen from the walls. The far
  // shore of a water crossing counts as near, as a border did.
  const inSight = new Set(kmFromAny(world, watched, { budgetKm: SIGHT_KM, cost: (edge) => (isWaterCrossing(edge.crossing) ? 0 : edge.distance) }).keys());

  return world.material.forces.flatMap((force): ArmyInSight[] => {
    if (station.polityId !== null && force.polityId === station.polityId) {
      // The rolls say how many are fit; only a man whose station sees the
      // army reads the count to the man.
      const men = fitStrengthOf(force);
      const word = countWord(force, warfare, men);
      const strengthLabel = seesForce(station, force.id) ? `${men.toLocaleString("en-GB")} ${word}` : `About ${bandStrength(men).toLocaleString("en-GB")} ${word}`;
      return [{ forceId: force.id, provinceId: force.locationId, strengthLabel }];
    }
    if (station.forceIds.has(force.id) || inSight.has(force.locationId)) {
      const seen = strangerStrength(force, inSight, knownFacts, station.characterId, now);
      return [{ forceId: force.id, provinceId: force.locationId, strengthLabel: capitalise(asShips(seen.label, isNavalForce(force, warfare))) }];
    }
    const report = latestReportOf(knownFacts, force.id, now);
    if (report === null) return [];
    const heard = strangerStrength(force, new Set(), knownFacts, station.characterId, now);
    return [{ forceId: force.id, provinceId: report, strengthLabel: capitalise(asShips(heard.label.replace("unknown to you", "strength unknown"), isNavalForce(force, warfare))) }];
  });
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Where the newest recent report the viewer knows of put this army, or null. */
function latestReportOf(facts: readonly Fact[], forceId: string, now: number): string | null {
  let newest: Fact | null = null;
  for (const fact of facts) {
    if (now - fact.time.day > ARMY_REPORT_DAYS) continue;
    if (!fact.affectedEntities.some((entity) => entity.kind === "force" && entity.id === forceId)) continue;
    if (newest === null || fact.time.day > newest.time.day) newest = fact;
  }
  if (newest === null) return null;
  // A report from before reports kept the place names the army and not where
  // it stood; the fact's own province, if it names one, is where it was heard of.
  return newest.forcesAsReported?.find((entry) => entry.forceId === forceId)?.locationId
    ?? newest.affectedEntities.find((entity) => entity.kind === "province")?.id
    ?? null;
}

