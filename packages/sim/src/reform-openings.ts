import { isCombatDoctrine, warsOf, type Doctrine, type WorldState } from "@chronica/shared";

/**
 * When a power's armies are ripe for reform (docs/plans/armies-in-detail.md).
 *
 * Reform was never a design document: it was pressure. Rome ran out of men
 * who met the property floor and fought wars that lasted longer than a
 * season, far away; Carthage was beaten by Rome's legions and hired a Spartan
 * to retrain its army; Rome was beaten at sea and copied a Carthaginian ship.
 * The engine watches for those moments and tells the men who could act --
 * a magistrate who could put a law, a general who could change his own
 * army -- what is there to be done. What reform they make is theirs.
 */

export interface ReformOpening {
  readonly moment: string;
  /** Who it is put to: a man who can propose a law, or one who commands an army. */
  readonly to: "councillor" | "general";
  readonly intensity: number;
  readonly label: string;
}

/** Below this share of its men of military age left uncalled, a power's levies are scraping the bottom. */
const SPENT_MANPOWER_SHARE = 0.35;
/** The share of a province's people who are men of military age (`province-material.ts`). */
const MANPOWER_FRACTION = 0.08;
/** A war this long is not a season's campaign. */
const LONG_WAR_DAYS = 540;
/** How far back a defeat, or a rival's victory, is still on men's minds. */
const LESSON_DAYS = 180;

const doctrinesOfForce = (world: WorldState, forceId: string, polityId: string): Doctrine[] => {
  const establishment = world.establishments.find((candidate) => candidate.polityId === polityId);
  return world.doctrines.filter((doctrine) => doctrine.lapsedAtStep === null && isCombatDoctrine(doctrine)
    && (doctrine.forceId === forceId || (doctrine.forceId === null && establishment?.doctrineIds.includes(doctrine.id) === true)));
};

export function reformOpenings(world: WorldState, polityId: string, toDay: number): ReformOpening[] {
  const out: ReformOpening[] = [];
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const establishment = world.establishments.find((candidate) => candidate.polityId === polityId);

  // 1. The men who may be called are running out.
  const own = world.map.provinces.filter((province) => province.controllerPolityId === polityId).map((province) => province.id);
  const rows = world.material.provinceMaterial.filter((row) => own.includes(row.provinceId));
  const could = rows.reduce((sum, row) => sum + row.population * MANPOWER_FRACTION, 0);
  const left = rows.reduce((sum, row) => sum + row.availableManpower, 0);
  if (could > 5_000 && left / could < SPENT_MANPOWER_SHARE) {
    out.push({
      moment: "reform-manpower", to: "councillor", intensity: 55,
      label: `${polityName(polityId)} is running out of men it may levy: he could put a law to call others ("enacts" "military" "recruit", "stateArms")`,
    });
  }

  // 2. A war that has outlasted a citizen's season.
  const longest = world.polityAgreements
    .filter((agreement) => agreement.status === "active" && agreement.kind === "war" && (agreement.polityId === polityId || agreement.otherPolityId === polityId))
    .reduce((max, agreement) => Math.max(max, toDay - agreement.sinceStep), 0);
  if (longest >= LONG_WAR_DAYS && establishment?.recruitment.standing !== true && warsOf(world.polityAgreements, polityId).length > 0) {
    out.push({
      moment: "reform-long-war", to: "councillor", intensity: 45,
      label: `${polityName(polityId)} has fought ${Math.round(longest / 365 * 10) / 10} years with armies raised for a season: he could keep them under the standards ("enacts" "military" "standing")`,
    });
  }

  // 3. Beaten by a better way of fighting, or watching a rival win by one.
  for (const engagement of world.engagements) {
    if (engagement.status !== "ended" || engagement.winner === null || engagement.endedAtStep === null || toDay - engagement.endedAtStep > LESSON_DAYS) continue;
    const winners = engagement.winner === "attacker" ? engagement.attackerForceIds : engagement.defenderForceIds;
    const losers = engagement.winner === "attacker" ? engagement.defenderForceIds : engagement.attackerForceIds;
    const forceOf = (id: string) => world.material.forces.find((force) => force.id === id);
    const lost = losers.some((id) => forceOf(id)?.polityId === polityId);
    if (!lost) continue;
    const ours = new Set(world.material.forces.filter((force) => force.polityId === polityId).flatMap((force) => doctrinesOfForce(world, force.id, polityId).map((doctrine) => doctrine.label)));
    const theirs = winners
      .map(forceOf)
      .flatMap((force) => (force === undefined ? [] : doctrinesOfForce(world, force.id, force.polityId)))
      .filter((doctrine) => !ours.has(doctrine.label));
    const lesson = theirs[0];
    if (lesson === undefined) continue;
    out.push({
      moment: `reform-lesson-${lesson.id}`.slice(0, 60), to: "general", intensity: 60,
      label: `Beaten by ${polityName(lesson.polityId)}, who fight by ${lesson.label}: he could teach his army the like ("force_modify" "doctrine") or ask a law ("enacts" "military")`,
    });
  }
  return out;
}
