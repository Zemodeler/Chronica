import {
  aNameFor,
  adjustPolityLegitimacy,
  atWar,
  agreementsBetween,
  computeOpinion,
  createCanonicalNpc,
  economyOf,
  isStanding,
  openWar,
  stableHash,
  type EconomyMemory,
  type FactProposalDraft,
  type WorldState,
  isQuietGround,
} from "@chronica/shared";
import { constitutionOf, rulerOf, type GovernmentRules } from "./constitutions";
import type { IdFactory } from "./ports";
import { armyLoyaltyTo } from "./society";
import { RISING_AT_BPS } from "./polity-end";

/**
 * Provinces that rise by themselves, and generals who march on the city.
 *
 * A province could sit in misery for a decade and nothing would come of it
 * unless the narrator happened to draw a revolt; ground taken in war wanted
 * nothing back, because only a treaty or a surrender gave a people something
 * to yearn for; and a state whose government nobody believed in, with a
 * general at the head of an army that answered to him and not to it, had no
 * civil war -- only a coup the general had to think of himself.
 *
 * - **Conquered ground remembers** whose it was, as ceded ground does, only
 *   less: a province lost in war yearns for its old master from the day it is
 *   taken, and `polity-end.ts` grows that yearning and raises the province when
 *   it is full.
 * - **Misery that lasts becomes a rising.** Half a year of order broken down on
 *   top of famine, a tax the land cannot bear, or a foreign master, and the
 *   province rises -- for the power it yearns for if it has one, else as a
 *   power of its own, unless the garrison in it is the stronger.
 * - **A general with an army and a grievance, under a government nobody
 *   believes in, makes a civil war.** Rarely, and only when all of it is true:
 *   his men and the ground they stand on become a rival power at war with the
 *   one they left. It ends as any power ends (`polity-end.ts`), or in
 *   reconciliation, when the two make peace and the party comes home.
 */

/** A province lost in war yearns for its old master this much the day it is taken: half what a surrender leaves. */
export const YEARNING_AT_CONQUEST_BPS = 2_000;
/** Order below this is misery. */
const MISERY_STABILITY_BPS = 2_500;
/** Food below this is famine, for a rising's purposes. */
const RISING_FAMINE_BPS = 3_000;
/** Months of misery before a province rises. */
export const RISING_AFTER_MONTHS = 6;
/** A rising puts up to half its province's men of military age in the field, and no more than this. */
const RISING_MAX_MEN = 3_000;
const RISING_MIN_MEN = 300;

/** Below this a government is not believed in. */
export const CIVIL_WAR_LEGITIMACY_BPS = 2_500;
/** The least an army must be, and the least share of its power's men, to make a civil war. */
const CIVIL_WAR_MIN_MEN = 2_000;
const CIVIL_WAR_MIN_SHARE = 0.3;
/** How far the army must be the general's own. */
const CIVIL_WAR_LOYALTY_BPS = 5_000;
/** How far he must be against the ruler. */
const CIVIL_WAR_HOSTILITY = -20;
/** Of a hundred months when everything is true, how many he acts in. */
const CIVIL_WAR_CHANCE_PER_MONTH = 20;
/** No second civil war in the same power within this. */
const CIVIL_WAR_COOLDOWN_DAYS = 730;

const nameOf = (world: WorldState, polityId: string): string => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
const menIn = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const withMemory = (world: WorldState, change: Partial<EconomyMemory>): WorldState => ({ ...world, economy: { ...economyOf(world), ...change } });

export interface UnrestInput {
  readonly world: WorldState;
  readonly toDay: number;
  /** Months the land was reckoned this pass (`reviewTheLand`): misery is counted in them. */
  readonly months: number;
  readonly ids: IdFactory;
  /** What each power asks of its lands, against what they bear (`taxBurdens`). */
  readonly burdens: ReadonlyMap<string, { readonly stabilityShiftBps: number }>;
  /** Absent, nobody can be told from the ruler, and there is no civil war. */
  readonly government?: GovernmentRules | undefined;
  readonly playerCharacterId: string | null;
}

export function reviewUnrest(input: UnrestInput): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let world = rememberConquest(input.world, input.toDay);
  if (input.months <= 0) return { world, facts };

  const risen = raiseTheMiserable(world, input);
  world = risen.world;
  facts.push(...risen.facts);
  if (input.government !== undefined) {
    const marched = marchOnTheCity(world, input, input.government);
    world = marched.world;
    facts.push(...marched.facts);
  }
  const reconciled = reconcile(world, input.toDay);
  return { world: reconciled.world, facts: [...facts, ...reconciled.facts] };
}

/** Ground taken in war wants its old master back, from the day it is taken. */
function rememberConquest(world: WorldState, toDay: number): WorldState {
  let changed = false;
  const provinces = world.map.provinces.map((province) => {
    const lost = province.lostBy;
    if (lost == null || province.yearning != null || province.controllerPolityId === null || province.controllerPolityId === lost.polityId) return province;
    if (!world.map.polities.some((polity) => polity.id === lost.polityId)) return province;
    changed = true;
    return { ...province, yearning: { polityId: lost.polityId, bps: YEARNING_AT_CONQUEST_BPS, updatedAtStep: toDay } };
  });
  return changed ? { ...world, map: { ...world.map, provinces } } : world;
}

function raiseTheMiserable(world: WorldState, input: UnrestInput): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  const rows = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const native = new Map(world.society.nativeControllers.map((entry) => [entry.provinceId, entry.polityId]));
  const counts = new Map(economyOf(world).unrest.map((entry) => [entry.provinceId, entry.months]));
  const rising: string[] = [];
  for (const province of [...world.map.provinces].sort((a, b) => a.id.localeCompare(b.id))) {
    const row = rows.get(province.id);
    const holder = province.controllerPolityId;
    // The far edge suffers its misery without history: it does not rise.
    if (row === undefined || holder === null || isQuietGround(province)) { counts.delete(province.id); continue; }
    const pressed = (input.burdens.get(holder)?.stabilityShiftBps ?? 0) < 0;
    const hungry = row.foodSecurityBps < RISING_FAMINE_BPS;
    const foreign = native.has(province.id) && native.get(province.id) !== holder;
    const miserable = row.stabilityBps < MISERY_STABILITY_BPS && (pressed || hungry || foreign);
    const months = miserable ? (counts.get(province.id) ?? 0) + input.months : Math.max(0, (counts.get(province.id) ?? 0) - input.months);
    if (months >= RISING_AFTER_MONTHS) { rising.push(province.id); counts.delete(province.id); continue; }
    if (months === 0) counts.delete(province.id);
    else counts.set(province.id, months);
  }
  let next = withMemory(world, { unrest: [...counts.entries()].map(([provinceId, months]) => ({ provinceId, months })).slice(0, 800) });

  for (const provinceId of rising) {
    const province = next.map.provinces.find((candidate) => candidate.id === provinceId)!;
    const holder = province.controllerPolityId!;
    // A people with somewhere to belong rise for it: the rising itself is
    // `polity-end.ts`'s, which this fills the yearning for -- dated a month
    // back, since its review grows yearning by the months since it was read.
    const wanted = province.yearning?.polityId ?? (native.get(provinceId) !== holder ? native.get(provinceId) : undefined);
    if (wanted !== undefined && wanted !== holder && next.map.polities.some((polity) => polity.id === wanted)) {
      next = { ...next, map: { ...next.map, provinces: next.map.provinces.map((candidate) => (candidate.id === provinceId ? { ...candidate, yearning: { polityId: wanted, bps: RISING_AT_BPS, updatedAtStep: Math.max(0, input.toDay - 30) } } : candidate)) } };
      continue;
    }
    const rose = riseAsItsOwn(next, provinceId, holder, input);
    next = rose.world;
    facts.push(...rose.facts);
  }
  return { world: next, facts };
}

/**
 * A province with nobody else to belong to rises as a power of its own -- unless
 * the garrison standing in it outnumbers the men who would rise, and puts it
 * down.
 */
function riseAsItsOwn(world: WorldState, provinceId: string, holder: string, input: UnrestInput): { world: WorldState; facts: FactProposalDraft[] } {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId)!;
  const row = world.material.provinceMaterial.find((candidate) => candidate.provinceId === provinceId)!;
  const men = Math.min(RISING_MAX_MEN, Math.floor(row.availableManpower / 2));
  if (men < RISING_MIN_MEN) return { world, facts: [] };
  const garrison = world.material.forces.filter((force) => force.polityId === holder && force.locationId === provinceId).reduce((sum, force) => sum + menIn(force), 0);
  if (garrison >= men) {
    const dead = Math.floor(row.population * 0.02);
    return {
      world: {
        ...world,
        material: {
          ...world.material,
          provinceMaterial: world.material.provinceMaterial.map((candidate) => (candidate.provinceId === provinceId
            ? { ...candidate, population: Math.max(0, candidate.population - dead), availableManpower: Math.max(0, candidate.availableManpower - men), stabilityBps: Math.min(10_000, candidate.stabilityBps + 1_000) }
            : candidate)),
        },
      },
      facts: [{
        localId: `rising_crushed_${provinceId}_${input.toDay}`.slice(0, 60),
        kind: "rising_crushed",
        summary: `${province.name} rose against ${nameOf(world, holder)} after months of misery, and the garrison put it down; some ${dead} died.`,
        affectedRefs: [{ kind: "province", id: provinceId }, { kind: "polity", id: holder }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 60,
      }],
    };
  }
  const name = `The Free People of ${province.name}`.slice(0, 120);
  if (world.map.polities.some((polity) => polity.name.toLowerCase() === name.toLowerCase() && isStanding(polity))) return { world, facts: [] };
  const parent = world.map.polities.find((polity) => polity.id === holder);
  const polityId = input.ids.next("polity");
  let next: WorldState = {
    ...world,
    map: {
      ...world.map,
      polities: [...world.map.polities, {
        id: polityId, name, capitalSettlementId: province.settlements[0]?.id ?? null,
        cohesionBps: Math.min(4_000, parent?.cohesionBps ?? 4_000), soldierPayPerThousand: null,
        governmentForm: constitutionOf(world, holder)?.form ?? parent?.governmentForm ?? null,
      }],
      provinces: world.map.provinces.map((candidate) => (candidate.id === provinceId
        ? { ...candidate, controllerPolityId: polityId, controlFirmnessBps: 2_000, yearning: null, lostBy: { polityId: holder, atStep: input.toDay },
          settlements: candidate.settlements.map((city) => (city.controllerPolityId === holder ? { ...city, controllerPolityId: polityId } : city)) }
        : candidate)),
    },
  };
  const made = createCanonicalNpc(next, {
    characterId: input.ids.next("character"),
    name: aNameFor(holder, `rising-${provinceId}`, new Set(next.characters.map((character) => character.name))),
    locationProvinceId: provinceId, polityId, createdAtStep: input.toDay, creationReason: `Led the rising of ${province.name}.`,
    ageYearsAtStart: 40, prestigeBps: 5_500,
  });
  if (made === null) return { world, facts: [] };
  next = made.world;
  const leader = made.character;
  next = {
    ...next,
    polityAgreements: openWar(next.polityAgreements, { id: input.ids.next("agreement"), polityId: holder, otherPolityId: polityId, terms: `The rising of ${province.name}.`, atStep: input.toDay, sourceMessageId: null, reason: `${province.name} rose against ${nameOf(world, holder)}.` }),
    material: {
      ...next.material,
      provinceMaterial: next.material.provinceMaterial.map((candidate) => (candidate.provinceId === provinceId ? { ...candidate, availableManpower: Math.max(0, candidate.availableManpower - men) } : candidate)),
      forces: [...next.material.forces, {
        id: input.ids.next("force"), name: `The rising of ${province.name}`.slice(0, 120), polityId, commanderCharacterId: leader.id, controllerCharacterId: leader.id,
        locationId: provinceId, positionId: null, authorizedStrength: men,
        personnel: [{ categoryId: "infantry", label: "Men of the rising", fit: men, unavailable: [] }],
        moraleBps: 7_000, cohesionBps: 4_000, fatigueBps: 0, provisionStatus: "provisioned", provisionedThroughStep: input.toDay + 30,
        payObligationId: null, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
      }],
    },
  };
  return {
    world: next,
    facts: [{
      localId: `rising_${provinceId}_${input.toDay}`.slice(0, 60),
      kind: "rising",
      summary: `After months of misery ${province.name} rose against ${nameOf(world, holder)} under ${leader.name}, and holds itself as ${name}, with ${men} men in arms.`.slice(0, 600),
      affectedRefs: [{ kind: "province", id: provinceId }, { kind: "polity", id: polityId }, { kind: "polity", id: holder }, { kind: "character", id: leader.id }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 85,
    }],
  };
}

/**
 * A general whose army is his own, who is against the ruler, in a power nobody
 * believes in, makes his army and the ground it stands on a rival power.
 */
function marchOnTheCity(world: WorldState, input: UnrestInput, government: GovernmentRules): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let next = world;
  const memory = economyOf(world);
  for (const polity of [...world.map.polities].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!isStanding(polity)) continue;
    // A power of the far edge alone makes no civil war: its generals are nobody's history.
    if (!next.map.provinces.some((province) => province.controllerPolityId === polity.id && !isQuietGround(province))) continue;
    const legitimacy = next.material.polityLegitimacy.find((entry) => entry.polityId === polity.id)?.legitimacyBps ?? 5_000;
    if (legitimacy >= CIVIL_WAR_LEGITIMACY_BPS) continue;
    if (memory.civilWars.some((war) => (war.fromPolityId === polity.id || war.rebelPolityId === polity.id) && input.toDay - war.sinceStep < CIVIL_WAR_COOLDOWN_DAYS)) continue;
    const ruler = rulerOf(next, polity.id, government);
    if (ruler === null) continue;
    const total = next.material.forces.filter((force) => force.polityId === polity.id).reduce((sum, force) => sum + menIn(force), 0);
    const generals = next.characters
      .filter((character) => character.alive && character.polityId === polity.id && character.id !== ruler.id && character.id !== input.playerCharacterId)
      .map((character) => {
        // Only the armies that are his own go over with him; the rest stay the state's.
        const armies = next.material.forces.filter((force) => force.polityId === polity.id && (force.commanderCharacterId === character.id || force.controllerCharacterId === character.id)
          && force.outlaw !== true && armyLoyaltyTo(next, force.id, character.id) >= CIVIL_WAR_LOYALTY_BPS);
        return { character, armies, men: armies.reduce((sum, force) => sum + menIn(force), 0) };
      })
      .filter((entry) => entry.men >= Math.max(CIVIL_WAR_MIN_MEN, total * CIVIL_WAR_MIN_SHARE) && computeOpinion(entry.character, ruler.id) <= CIVIL_WAR_HOSTILITY)
      .sort((a, b) => b.men - a.men || a.character.id.localeCompare(b.character.id));
    const general = generals[0];
    if (general === undefined) continue;
    if (stableHash(["civil-war", polity.id, general.character.id, Math.floor(input.toDay / 30)]) % 100 >= CIVIL_WAR_CHANCE_PER_MONTH) continue;

    const rebelId = input.ids.next("polity");
    const rebelName = `The Party of ${general.character.name}`.slice(0, 120);
    const armyIds = new Set(general.armies.map((force) => force.id));
    const held = new Set(general.armies.map((force) => force.locationId).filter((provinceId) => next.map.provinces.some((province) => province.id === provinceId && province.controllerPolityId === polity.id)));
    const capital = next.map.provinces.find((province) => held.has(province.id))?.settlements[0]?.id ?? null;
    next = {
      ...next,
      characters: next.characters.map((character) => (character.id === general.character.id || general.armies.some((force) => force.memberCharacterIds.includes(character.id) && character.polityId === polity.id)
        ? { ...character, polityId: rebelId, officeId: character.id === general.character.id ? null : character.officeId } : character)),
      map: {
        ...next.map,
        polities: [...next.map.polities, {
          id: rebelId, name: rebelName, capitalSettlementId: capital, cohesionBps: Math.min(5_000, polity.cohesionBps), soldierPayPerThousand: polity.soldierPayPerThousand,
          governmentForm: constitutionOf(next, polity.id)?.form ?? polity.governmentForm ?? null,
        }],
        provinces: next.map.provinces.map((province) => (held.has(province.id)
          ? { ...province, controllerPolityId: rebelId, controlFirmnessBps: 3_000, lostBy: { polityId: polity.id, atStep: input.toDay },
            settlements: province.settlements.map((city) => (city.controllerPolityId === polity.id ? { ...city, controllerPolityId: rebelId } : city)) }
          : province)),
      },
      material: {
        ...next.material,
        // His men, and no longer the state's to pay.
        forces: next.material.forces.map((force) => (armyIds.has(force.id) ? { ...force, polityId: rebelId, payObligationId: null, payArrearsPeriods: 0 } : force)),
        polityLegitimacy: adjustPolityLegitimacy(next.material.polityLegitimacy, polity.id, -500, `${general.character.name} took up arms against the government`, `civil-war-${rebelId}`),
      },
      polityAgreements: openWar(next.polityAgreements, {
        id: input.ids.next("agreement"), polityId: rebelId, otherPolityId: polity.id, terms: `${general.character.name} against ${ruler.name} for the rule of ${polity.name}.`.slice(0, 600),
        atStep: input.toDay, sourceMessageId: null, reason: `${general.character.name} marched against ${ruler.name}.`,
      }),
    };
    next = withMemory(next, { civilWars: [...economyOf(next).civilWars, { rebelPolityId: rebelId, fromPolityId: polity.id, leaderCharacterId: general.character.id, sinceStep: input.toDay }].slice(-60) });
    facts.push({
      localId: `civil_war_${rebelId}`.slice(0, 60),
      kind: "civil_war",
      summary: `Civil war in ${polity.name}: ${general.character.name}, at the head of ${general.men} men who answer to him, has taken up arms against ${ruler.name} and a government nobody believes in${held.size > 0 ? `, and holds the ground his army stands on` : ""}.`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: polity.id }, { kind: "polity", id: rebelId }, { kind: "character", id: general.character.id }, { kind: "character", id: ruler.id }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 90,
    });
  }
  return { world: next, facts };
}

/**
 * A civil war that ends in peace ends in reconciliation: the party comes home,
 * its ground and its men with it. One whose party or state is gone is over.
 */
function reconcile(world: WorldState, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  const wars = economyOf(world).civilWars;
  if (wars.length === 0) return { world, facts: [] };
  const facts: FactProposalDraft[] = [];
  let next = world;
  const still: EconomyMemory["civilWars"] = [];
  for (const war of wars) {
    const rebel = next.map.polities.find((polity) => polity.id === war.rebelPolityId);
    const parent = next.map.polities.find((polity) => polity.id === war.fromPolityId);
    // Over, one way or another: remembered only as long as it keeps the next one off.
    const remembered = toDay - war.sinceStep < CIVIL_WAR_COOLDOWN_DAYS;
    if (rebel === undefined || parent === undefined || !isStanding(rebel) || !isStanding(parent)) { if (remembered) still.push(war); continue; }
    const made = !atWar(next.polityAgreements, rebel.id, parent.id) && agreementsBetween(next.polityAgreements, rebel.id, parent.id).some((agreement) => agreement.kind === "peace" || agreement.kind === "truce");
    // A war made up keeps the next one off for as long from the making up.
    if (!made) { still.push(war); continue; }
    still.push({ ...war, sinceStep: toDay });
    const reason = `${rebel.name} is reconciled with ${parent.name}.`;
    next = {
      ...next,
      characters: next.characters.map((character) => (character.polityId === rebel.id ? { ...character, polityId: parent.id } : character)),
      map: {
        ...next.map,
        polities: next.map.polities.map((polity) => (polity.id === rebel.id ? { ...polity, endedAtStep: toDay, endedHow: "absorbed" as const, absorbedByPolityId: parent.id, capitalSettlementId: null } : polity)),
        provinces: next.map.provinces.map((province) => (province.controllerPolityId === rebel.id || province.settlements.some((city) => city.controllerPolityId === rebel.id)
          ? { ...province, controllerPolityId: province.controllerPolityId === rebel.id ? parent.id : province.controllerPolityId, lostBy: null, yearning: province.yearning?.polityId === rebel.id ? null : province.yearning ?? null,
            settlements: province.settlements.map((city) => (city.controllerPolityId === rebel.id ? { ...city, controllerPolityId: parent.id } : city)) }
          : province)),
      },
      material: { ...next.material, forces: next.material.forces.map((force) => (force.polityId === rebel.id ? { ...force, polityId: parent.id } : force)) },
      polityAgreements: next.polityAgreements.map((agreement) => (agreement.status === "active" && (agreement.polityId === rebel.id || agreement.otherPolityId === rebel.id)
        ? { ...agreement, status: "ended" as const, endedAtStep: toDay, endedReason: reason } : agreement)),
    };
    facts.push({
      localId: `reconciled_${rebel.id}`.slice(0, 60),
      kind: "civil_war_ended",
      summary: `The civil war in ${parent.name} is over: ${rebel.name} has made its peace and come home, its men and its ground with it.`,
      affectedRefs: [{ kind: "polity", id: parent.id }, { kind: "polity", id: rebel.id }, { kind: "character", id: war.leaderCharacterId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 75,
    });
  }
  return { world: withMemory(next, { civilWars: still }), facts };
}
