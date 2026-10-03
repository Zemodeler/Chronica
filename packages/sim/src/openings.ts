import {
  GOVERNMENT_FORM_IN_WORDS,
  allOffices,
  allSuccessionRules,
  createPressure,
  currentAgeYears,
  isStanding,
  type Character,
  type WorldState,
} from "@chronica/shared";
import { chambersOf, constitutionOf, rulerOf, rulerOfficeOf, sovereignChamberOf, type GovernmentRules } from "./constitutions";
import { capitalProvinceOf } from "./regime";
import { armyLoyaltyTo } from "./society";
import { reformOpenings } from "./reform-openings";

/**
 * The moments a government can change, offered to the men who could take them.
 *
 * Elections showed the way: the engine noticed a seat was empty and told the
 * men who could fill it, and they did. A constitution changes the same way. The
 * engine watches for the world to be ripe -- a throne with no heir, a child
 * king, a general whose army is his own and a government nobody respects, a
 * people in unrest, a strong party with no voice in the chamber, a fallen
 * government with its friends still about, a conquered capital -- and tells
 * whoever could act. What they do about it is theirs; whether it works is the
 * engine's (`regime.ts`), and it works better for a man who was offered the
 * moment than for one who made it.
 *
 * Each opening is a pressure whose id says which power and which moment, so
 * `hasOpening` can find it, and so it is offered once a season, not every day.
 */

/** How long an opening stays open, and how often the same one may be offered again. */
export const OPENING_DAYS = 90;
/** Below this legitimacy a government is one a strong man might think of taking. */
const WEAK_GOVERNMENT_BPS = 4_500;
/** Below this stability the capital is a place a crowd might rise in. */
const UNREST_BPS = 4_000;

export interface RaiseOpeningsInput {
  readonly world: WorldState;
  readonly government: GovernmentRules;
  readonly playerCharacterId?: string | null | undefined;
  readonly toDay: number;
}

interface Opening {
  readonly polityId: string;
  readonly moment: string;
  readonly characterId: string;
  readonly intensity: number;
  readonly label: string;
}

const legitimacyOf = (world: WorldState, polityId: string): number => world.material.polityLegitimacy.find((entry) => entry.polityId === polityId)?.legitimacyBps ?? 5_000;
const stabilityOf = (world: WorldState, provinceId: string | null): number => (provinceId === null ? 5_000 : world.material.provinceMaterial.find((entry) => entry.provinceId === provinceId)?.stabilityBps ?? 5_000);
const byStanding = (a: Character, b: Character): number => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id);

export function raiseOpenings(input: RaiseOpeningsInput): WorldState {
  const { toDay, government } = input;
  let world = input.world;
  const player = input.playerCharacterId ?? null;
  const season = Math.floor(toDay / OPENING_DAYS);
  const openings: Opening[] = [];

  for (const polity of world.map.polities) {
    const people = world.characters.filter((character) => character.alive && character.polityId === polity.id && character.id !== player);
    if (people.length === 0) continue;
    const ruler = rulerOf(world, polity.id, government);
    const office = rulerOfficeOf(world, polity.id, government);
    const polityOffices = new Set(allOffices(world, government.offices).filter((candidate) => candidate.polityId === polity.id).map((candidate) => candidate.id));
    const seated = (character: Character): boolean => world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held" && polityOffices.has(seat.officeId));
    const generals = people
      .map((character) => ({ character, men: world.material.forces.filter((force) => force.polityId === polity.id && force.outlaw !== true && force.commanderCharacterId === character.id).reduce((sum, force) => sum + force.personnel.reduce((inner, category) => inner + category.fit, 0), 0) }))
      .filter((entry) => entry.men >= 1_000)
      .sort((a, b) => b.men - a.men || byStanding(a.character, b.character));
    const councillors = people.filter(seated).sort(byStanding);
    const capital = capitalProvinceOf(world, polity.id);
    const weak = legitimacyOf(world, polity.id) < WEAK_GOVERNMENT_BPS;
    const add = (moment: string, character: Character | undefined, intensity: number, label: string): void => {
      if (character === undefined || character.id === ruler?.id) return;
      openings.push({ polityId: polity.id, moment, characterId: character.id, intensity, label: label.slice(0, 200) });
    };

    // 1. A throne with nobody on it.
    const hereditary = office !== null && ["primogeniture", "seniority"].includes(allSuccessionRules(world, government.successionRules).find((rule) => rule.id === office.successionRuleId)?.kind ?? "");
    const emptyThrone = office !== null && ruler === null && hereditary
      && world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.status === "vacant" && seat.vacancyCause !== "never_filled");
    if (emptyThrone) {
      for (const candidate of [...councillors.slice(0, 2), ...generals.slice(0, 1).map((entry) => entry.character)]) {
        add("empty-throne", candidate, 70, `The seat of ${office.label} stands empty and no heir has come: he could claim it, by force ("regime_change") or by winning the council`);
      }
    }

    // 2. A child reigns.
    if (ruler !== null && currentAgeYears(ruler, toDay) < 16) {
      add("regency", generals[0]?.character, 60, `A child, ${ruler.name}, reigns in ${polity.name}: whoever holds the regency holds the state -- or could take it outright`);
      add("regency", councillors.find((character) => character.id !== generals[0]?.character.id), 55, `A child, ${ruler.name}, reigns in ${polity.name}: the council could govern in his name, or make itself the government`);
    }

    // 3. A general whose army is his own, near a government nobody respects.
    if (weak && capital !== null) {
      for (const { character } of generals) {
        const own = world.material.forces.find((force) => force.commanderCharacterId === character.id && force.polityId === polity.id && armyLoyaltyTo(world, force.id, character.id) >= 3_000);
        if (own === undefined) continue;
        const near = own.locationId === capital || world.map.edges.some((edge) => (edge.from === own.locationId && edge.to === capital) || (edge.to === own.locationId && edge.from === capital));
        add("strong-man", character, near ? 70 : 50, `${own.name} is his more than ${polity.name}'s, and its government is weak: he could take the state ("regime_change", a coup)${near ? "" : " -- once his army stands at the capital"}`);
      }
    }

    // 4. A people in unrest behind a grievance.
    const grievance = world.material.politicalGroups
      .filter((group) => group.active && group.polityId === polity.id && ["debtors", "veterans", "cult"].includes(group.type) && (group.strengthBps ?? 0) >= 5_000)
      .sort((a, b) => (b.strengthBps ?? 0) - (a.strengthBps ?? 0))[0];
    if (grievance !== undefined && (weak || stabilityOf(world, capital) < UNREST_BPS)) {
      const leader = people.find((character) => character.id === grievance.leaderCharacterId)
        ?? people.filter((character) => !seated(character) && character.prestigeBps >= 4_000).sort(byStanding)[0];
      add("unrest", leader, 65, `${grievance.name} [${grievance.id}] will follow a man who promises them what they want: he could lead them to remake the state ("regime_change", a revolution), or take their cause to the chamber`);
    }

    // 5. A strong party with no voice where the constitution is made.
    const sovereign = sovereignChamberOf(world, polity.id);
    if (sovereign !== null) {
      for (const group of world.material.politicalGroups.filter((candidate) => candidate.active && candidate.polityId === polity.id && (candidate.strengthBps ?? 0) >= 6_000 && ["merchant_interest", "debtors", "veterans", "landholder_interest"].includes(candidate.type))) {
        if (sovereign.votingBlocs.some((bloc) => bloc.groupId === group.id)) continue;
        const leader = people.find((character) => character.id === group.leaderCharacterId) ?? councillors[0];
        add(`reform-${group.type}`, leader, 50, `${group.name} [${group.id}] have no voice in the ${sovereign.name}: he could put a measure to widen it ("enacts" a "constitution" change) and win them`);
      }
    }

    // 6. The fallen, with the new government still unsure of itself.
    const chambers = chambersOf(world, polity.id);
    const young = chambers.length === 0 ? 0 : chambers.reduce((sum, chamber) => sum + (world.material.institutionLegitimacy.find((entry) => entry.institutionId === chamber.id)?.legitimacyBps ?? 5_000), 0) / chambers.length;
    for (const party of world.material.politicalGroups.filter((group) => group.active && group.type === "deposed_party" && group.polityId === polity.id && (group.strengthBps ?? 0) >= 3_000)) {
      if (young >= 4_500 && !weak) continue;
      const former = [...(constitutionOf(world, polity.id)?.history ?? [])].reverse().find((change) => change.origin === "seizure" || change.origin === "imposition")?.fromForm;
      add("restoration", people.find((character) => character.id === party.leaderCharacterId), 65, `The new government of ${polity.name} is unsure of itself: ${party.name} could restore ${former == null ? "the old order" : GOVERNMENT_FORM_IN_WORDS[former]} ("regime_change", a restoration)`);
    }
  }

  // 7½. Armies ripe for reform (`reform-openings.ts`): levies running dry, a
  // war longer than a season, a defeat by a better way of fighting. Put to a
  // man who could carry a law, or to the general who could change his army.
  for (const polity of world.map.polities) {
    const people = world.characters.filter((character) => character.alive && character.polityId === polity.id && character.id !== player);
    if (people.length === 0) continue;
    const reforms = reformOpenings(world, polity.id, toDay);
    if (reforms.length === 0) continue;
    const polityOffices = new Set(allOffices(world, government.offices).filter((candidate) => candidate.polityId === polity.id).map((candidate) => candidate.id));
    const councillor = people.filter((character) => world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held" && polityOffices.has(seat.officeId))).sort(byStanding)[0];
    const general = world.material.forces
      .filter((force) => force.polityId === polity.id && force.outlaw !== true)
      .sort((a, b) => b.personnel.reduce((sum, row) => sum + row.fit, 0) - a.personnel.reduce((sum, row) => sum + row.fit, 0))
      .map((force) => people.find((character) => character.id === force.commanderCharacterId))
      .find((character): character is Character => character !== undefined);
    for (const reform of reforms) {
      const to = reform.to === "general" ? general ?? councillor : councillor ?? general;
      if (to === undefined) continue;
      openings.push({ polityId: polity.id, moment: reform.moment, characterId: to.id, intensity: reform.intensity, label: reform.label.slice(0, 200) });
    }
  }

  // 7. A conqueror in another power's capital, or a senior ally over a failing one.
  for (const target of world.map.polities) {
    if (!isStanding(target)) continue;
    const capital = capitalProvinceOf(world, target.id);
    const holder = capital === null ? null : world.map.provinces.find((province) => province.id === capital)?.controllerPolityId ?? null;
    const senior = world.polityAgreements.find((agreement) => agreement.status === "active" && (agreement.kind === "foedus" || agreement.kind === "protectorate") && agreement.polityId === target.id && legitimacyOf(world, target.id) < 3_500)?.otherPolityId ?? null;
    const over = holder !== null && holder !== target.id ? holder : senior;
    if (over === null || !world.map.polities.some((polity) => polity.id === over && isStanding(polity))) continue;
    const master = rulerOf(world, over, government);
    if (master === null || master.id === player) continue;
    openings.push({
      polityId: target.id, moment: "conquest", characterId: master.id, intensity: 55,
      label: `${target.name} lies in ${world.map.polities.find((polity) => polity.id === over)?.name ?? over}'s hands: he could dictate its government ("regime_change", an imposition)`.slice(0, 200),
    });
  }

  for (const opening of openings) {
    const id = `opening:${opening.polityId}:${opening.moment}:${season}:${opening.characterId}`.slice(0, 120);
    if (world.characterPressures.some((pressure) => pressure.id === id)) continue;
    const pressured = createPressure(world, {
      id, characterId: opening.characterId, kind: "opportunity", intensity: opening.intensity, label: opening.label,
      sourceEventId: null, atStep: toDay, reviewInSteps: 7, expiresInSteps: OPENING_DAYS, visibility: "private",
    });
    world = { ...world, characters: [...pressured.characters], characterPressures: [...pressured.characterPressures] };
  }
  return world;
}
