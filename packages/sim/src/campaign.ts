import {
  aptitude,
  boundedId,
  REFERENCE_PROVINCE_KM,
  kmBetween,
  isNavalForce,
  isSummerMonth,
  isWinterMonth,
  mayEnterWithoutLeave,
  sameConfederation,
  atWar,
  skillShare,
  stableHash,
  type FactProposalDraft,
  type Force,
  type ProvinceMaterial,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";

/**
 * An army in the field, fed, sickening and resting, day by day.
 *
 * `provisionStatus` was written by the scenario and by the model and changed
 * by nothing else; `provisionedThroughStep` was a date the glossary read aloud
 * and the world ignored, so a legion could stand in enemy country for a year
 * on the bread it set out with, and a march ate nothing unless the model
 * remembered to write that it did. Morale fell in battle and when pay was
 * late and never came back; fatigue only rose. Disease -- which emptied more
 * camps in this period than battles did -- happened only when a narrator seed
 * asked the model to invent it.
 *
 * All of it is arithmetic, so it is the engine's:
 *
 * - **Bread.** An army is fed where it stands if the ground is its own or a
 *   friend's, if one of its power's depots reaches it, or if its own ships lie
 *   with it; otherwise it forages, which feeds it only while the country has
 *   food enough for its numbers -- half as much in winter -- and strips that
 *   country as it does. Fed, it carries `CARRIED_DAYS` of bread. Unfed, it
 *   eats what it carries (faster in winter), then goes short, then starves:
 *   morale first, then men, dying and walking away.
 * - **Sickness.** A large army that sits still sickens: most in summer, in a
 *   marsh, or in siege lines. The roll is a stable hash of who, where and
 *   when, so a replay sickens the same camp.
 * - **Rest.** An army not marching and not besieging sheds its fatigue; paid
 *   and fed, it recovers its spirit and its order, twice as fast in winter
 *   quarters at home and faster under a commander men will stand for.
 *
 * Ground the world has not reckoned -- a province with nobody counted in it,
 * or no material row at all -- neither feeds nor starves anybody: an older
 * world, or a test's sketch of one, is left as it was.
 */

/** Days of bread an army takes with it when it is fed. */
export const CARRIED_DAYS = 30;
/** Days on short rations before men begin to die of it. */
export const STARVING_AFTER_DAYS = 10;
/**
 * Of the people of a province, how many soldiers' mouths its fields can feed
 * besides their own: one for every forty, now that a province counts its
 * country people as well as its townsfolk (`province-material.ts`).
 */
const FORAGE_MEN_PER_HEAD = 0.025;
/** What an army eats out of a country, per man a day for every head there, in basis points: its own and one it forages. */
const EATEN_AT_HOME_BPS = 1_000;
const EATEN_FORAGING_BPS = 4_000;
/** A province hungrier than this feeds no army, its own included. */
const FAMINE_BPS = 1_500;
/** An army smaller than this is a garrison, and does not sicken as a camp does. */
const CAMP_SIZE = 5_000;
/** What rest brings morale and order back to, and no further. */
const RESTED_BPS = 7_000;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const clampBps = (value: number): number => Math.max(0, Math.min(10_000, Math.round(value)));
/** Days of (a, b] that fall inside (c, d]. */
const overlap = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c));

type Source = "home" | "depot" | "sea" | "forage";

export function provisionStatusOn(provisionedThroughStep: number, day: number): Force["provisionStatus"] {
  const hunger = day - provisionedThroughStep;
  if (hunger <= 0) return "provisioned";
  return hunger <= STARVING_AFTER_DAYS ? "shortage" : "critical";
}

/** Men taken off a force, shared among its groups by strength, and written into its history. */
export function takeMen(force: Force, lost: number, kind: "attrition_death" | "desertion", atStep: number, cause: string): Force {
  const total = fitOf(force);
  const taken = Math.min(Math.max(0, lost), total);
  if (taken <= 0) return force;
  let left = taken;
  const personnel = force.personnel.map((group, index, all) => {
    const share = index === all.length - 1 ? Math.min(left, group.fit) : Math.min(left, group.fit, Math.round((taken * group.fit) / total));
    left -= share;
    return { ...group, fit: group.fit - share };
  });
  const gone = taken - left;
  return {
    ...force,
    personnel,
    authorizedStrength: Math.max(1, force.authorizedStrength - gone),
    history: [...force.history, {
      id: boundedId(force.id, cause, kind, atStep), atStep, kind,
      categoryId: force.personnel[0]?.categoryId ?? "infantry", count: gone, causeId: boundedId(force.id, cause),
    }].slice(-64),
  };
}

export interface KeepTheFieldInput {
  readonly world: WorldState;
  readonly toDay: number;
  /** The calendar month, 1-12; null where the clock is not known, and there are no seasons. */
  readonly month: number | null;
  readonly warfare?: ScenarioWarfareRules | undefined;
}

export function keepTheField(input: KeepTheFieldInput): { world: WorldState; facts: FactProposalDraft[] } {
  const { world, toDay, month } = input;
  const facts: FactProposalDraft[] = [];
  const winter = isWinterMonth(month);
  const agreements = world.polityAgreements;
  const marching = new Set(world.projects.flatMap((project) =>
    (project.status === "funded" || project.status === "in_progress") && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId !== null
      ? [project.completionOutcome.forceId]
      : []));
  const besieging = new Set(world.sieges.filter((siege) => siege.status === "active").map((siege) => siege.forceId));
  const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  let provinceMaterial = world.material.provinceMaterial;
  const materialOf = (id: string): ProvinceMaterial | undefined => provinceMaterial.find((row) => row.provinceId === id);
  const strip = (id: string, food: number, productive: number, stability: number, damage: number): void => {
    provinceMaterial = provinceMaterial.map((row) => (row.provinceId !== id ? row : {
      ...row,
      foodSecurityBps: clampBps(row.foodSecurityBps - food),
      productiveCapacityBps: clampBps(row.productiveCapacityBps - productive),
      stabilityBps: clampBps(row.stabilityBps - stability),
      warDamageBps: clampBps(row.warDamageBps + damage),
    }));
  };
  const say = (kind: string, force: Force, summary: string, significance: number): void => {
    facts.push({
      localId: `${kind}_${force.id}_${toDay}`.slice(0, 60),
      kind,
      summary: summary.slice(0, 600),
      affectedRefs: [{ kind: "force", id: force.id }, { kind: "province", id: force.locationId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance,
    });
  };

  const hostile = (force: Force, polityId: string | null): boolean =>
    polityId !== null && polityId !== force.polityId && atWar(agreements, force.polityId, polityId);
  const friendly = (force: Force, polityId: string | null): boolean =>
    polityId !== null && (polityId === force.polityId || sameConfederation(agreements, force.polityId, polityId)
      || (mayEnterWithoutLeave(agreements, force.polityId, polityId) && !atWar(agreements, force.polityId, polityId)));

  /** Where this army's bread comes from today, or null: it eats what it carries. Undefined: ground nobody has reckoned. */
  const sourceOf = (force: Force, men: number): Source | null | undefined => {
    const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
    const material = materialOf(force.locationId);
    if (province === undefined || material === undefined) return undefined;
    const holder = province.controllerPolityId;
    if (friendly(force, holder) && material.foodSecurityBps >= FAMINE_BPS) return "home";
    const depot = world.structures.some((structure) => structure.ownerPolityId === force.polityId && structure.supplyRadius > 0
      && (structure.provinceId === force.locationId || (kmBetween(world, structure.provinceId, force.locationId, structure.supplyRadius * REFERENCE_PROVINCE_KM) ?? Infinity) <= structure.supplyRadius * REFERENCE_PROVINCE_KM));
    if (depot) return "depot";
    const ships = world.material.forces.filter((other) => other.locationId === force.locationId && other.id !== force.id && isNavalForce(other, input.warfare));
    if (ships.some((fleet) => fleet.polityId === force.polityId) && !ships.some((fleet) => hostile(force, fleet.polityId))) return "sea";
    if (material.population <= 0) return undefined;
    const feeds = material.population * FORAGE_MEN_PER_HEAD * (material.foodSecurityBps / 10_000) * (winter ? 0.5 : 1);
    return men <= feeds ? "forage" : null;
  };

  const forces = world.material.forces.map((original) => {
    const since = original.reckonedToStep;
    if (since === undefined || since >= toDay) return since === toDay ? original : { ...original, reckonedToStep: Math.max(since ?? toDay, toDay) };
    const days = toDay - since;
    let force: Force = { ...original, reckonedToStep: toDay };
    const men = fitOf(force);
    if (men === 0) return force;
    const naval = isNavalForce(force, input.warfare);
    const resting = !marching.has(force.id) && !besieging.has(force.id);
    const place = provinceName(force.locationId);

    // ── Bread ──────────────────────────────────────────────────────────
    const source: Source | null | undefined = naval ? undefined : sourceOf(force, men);
    if (source !== undefined) {
      const material = materialOf(force.locationId);
      const people = Math.max(1, material?.population ?? 1);
      // Whatever feeds an army is eaten: its own country a little, a
      // country it forages a great deal, and an enemy's with the burning
      // that foraging in it is.
      if (source === "home" && material !== undefined && material.population > 0) {
        const eaten = Math.min(1_500, Math.round((days * EATEN_AT_HOME_BPS * men) / people));
        if (eaten > 0) strip(force.locationId, eaten, 0, 0, 0);
      } else if (source === "forage") {
        const eaten = Math.min(3_000, Math.round((days * EATEN_FORAGING_BPS * men) / people));
        const holder = world.map.provinces.find((province) => province.id === force.locationId)?.controllerPolityId ?? null;
        if (hostile(force, holder)) strip(force.locationId, eaten, Math.round(eaten / 2), Math.round(eaten / 3), Math.round(eaten / 2));
        else strip(force.locationId, eaten, 0, Math.round(eaten / 4), 0);
      }
      const before = provisionStatusOn(force.provisionedThroughStep, since);
      let through = force.provisionedThroughStep;
      if (source !== null) through = Math.max(through, toDay + CARRIED_DAYS);
      // In the field in winter an army burns through what it carries half as
      // fast again: fires, and bread for the men who fetch the wood.
      else if (winter) through = Math.max(0, through - Math.ceil(days / 2));
      const status = provisionStatusOn(through, toDay);
      const shortDays = overlap(since, toDay, through, through + STARVING_AFTER_DAYS);
      const starvingDays = overlap(since, toDay, through + STARVING_AFTER_DAYS, Number.MAX_SAFE_INTEGER);
      force = {
        ...force,
        provisionedThroughStep: through,
        provisionStatus: status,
        moraleBps: clampBps(force.moraleBps - shortDays * 40 - starvingDays * 120),
        cohesionBps: clampBps(force.cohesionBps - starvingDays * 60),
      };
      if (starvingDays > 0) {
        const lost = Math.min(Math.floor(men * 0.3), Math.floor(men * starvingDays * 0.004));
        const walked = Math.floor(lost * 0.6);
        force = takeMen(takeMen(force, lost - walked, "attrition_death", toDay, "hunger"), walked, "desertion", toDay, "hunger");
        if (lost > 0) say("force_starving", force, `${force.name} is starving in ${place}: ${lost - walked} men have died of hunger and ${walked} have slipped away to find food.`, 65);
      } else if (status !== before && status === "shortage") {
        say("force_short", force, `${force.name} has eaten the bread it carried and is on short rations in ${place}${winter ? ", in the depth of winter" : ""}: nothing feeds it there.`, 45);
      }
      if (status === "provisioned" && before !== "provisioned") {
        say("force_resupplied", force, `${force.name} is fed again in ${place}.`, 30);
      }
    }

    // ── Sickness ───────────────────────────────────────────────────────
    const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
    if (!naval && !marching.has(force.id) && men >= CAMP_SIZE && province !== undefined) {
      const marsh = /marsh|swamp|fen/.test(province.terrainId);
      const perMonth = (isSummerMonth(month) ? 1_200 : 300) + (marsh ? 1_000 : 0) + (besieging.has(force.id) ? 800 : 0) + (force.provisionStatus === "provisioned" ? 0 : 600);
      const chance = Math.min(9_000, Math.round(perMonth * Math.max(0.35, Math.min(2, men / 15_000)) * (days / 30)));
      if (stableHash([force.id, "sickness", since, toDay]) % 10_000 < chance) {
        const sick = Math.floor(men * 0.05);
        const dead = Math.floor(men * 0.01);
        const largest = [...force.personnel].sort((a, b) => b.fit - a.fit)[0];
        force = takeMen(force, dead, "attrition_death", toDay, "sickness");
        if (largest !== undefined && sick > 0) {
          const laidUp = Math.min(sick, force.personnel.find((group) => group.categoryId === largest.categoryId && group.label === largest.label)?.fit ?? 0);
          force = {
            ...force,
            moraleBps: clampBps(force.moraleBps - 600),
            personnel: force.personnel.map((group) => (group.categoryId === largest.categoryId && group.label === largest.label && laidUp > 0
              ? { ...group, fit: group.fit - laidUp, unavailable: [...group.unavailable, { id: boundedId(force.id, "sickness", toDay), count: laidUp, causeKind: "sickness" as const, causeId: boundedId(force.id, "camp-fever"), earliestRecoveryStep: toDay + 21 }] }
              : group)),
            history: laidUp > 0 ? [...force.history, { id: boundedId(force.id, "sick", toDay), atStep: toDay, kind: "unavailable" as const, categoryId: largest.categoryId, count: laidUp, causeId: boundedId(force.id, "camp-fever") }].slice(-64) : force.history,
          };
        }
        const why = besieging.has(force.id) ? "in its siege lines" : marsh ? "in the marshes" : isSummerMonth(month) ? "in the summer heat" : "in camp";
        say("camp_sickness", force, `Sickness has broken out in ${force.name} ${why} at ${place}: ${dead} have died of it and ${sick} are laid up.`, 50);
      }
    }

    // ── Rest ───────────────────────────────────────────────────────────
    if (resting) {
      force = { ...force, fatigueBps: clampBps(force.fatigueBps - days * 150) };
      const owed = force.payObligationId === null ? undefined : world.material.obligations.find((obligation) => obligation.id === force.payObligationId);
      const paid = force.payArrearsPeriods === 0 && (owed === undefined || owed.missedPeriods === 0);
      if (paid && force.provisionStatus === "provisioned") {
        const commander = world.characters.find((character) => character.id === force.commanderCharacterId && character.alive);
        const quarters = winter && source === "home" ? 2 : 1;
        const hand = 1 + (commander === undefined ? 0 : skillShare(aptitude(commander, "authority"), 0.5));
        const back = (value: number, perDay: number): number => (value >= RESTED_BPS ? value : Math.min(RESTED_BPS, value + Math.round(days * perDay * quarters * hand)));
        force = { ...force, moraleBps: back(force.moraleBps, 25), cohesionBps: back(force.cohesionBps, 20) };
      }
    }
    return force;
  });

  return { world: { ...world, material: { ...world.material, forces, provinceMaterial } }, facts };
}
