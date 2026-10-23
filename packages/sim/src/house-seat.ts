import {
  atWar,
  economyOf,
  hasPort,
  hubOf,
  isLiveProvince,
  isOccupied,
  kmFromAny,
  marketGeography,
  treasuryOf,
  type FactProposalDraft,
  type MerchantHouse,
  type MoneyTransaction,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";
import { safeLocalId } from "./safe-local-id";

/**
 * Whose house it is, and where it sits (docs/economy.md, "Who manages the economy", "Where the house sits").
 *
 * A house was given its power and its home market at the seeding and kept them for ever, so a house whose city changed hands went on
 * lending to the power that had lost it. The house is now its head's: its power is the power the head belongs to, read off him every
 * month, and its seat is the market it trades from, which follows the fortunes of the city it sits in.
 *
 *  - **The city is the head's own power's**, or it is held for it by a friend, or by a stranger on sufferance (an ally's garrison in an
 *    occupied city, the owner still the head's): nothing changes.
 *  - **The city is taken by a power at war with the head's.** The head flees with what he can carry. He goes to the nearest port market
 *    of his own power that is not occupied, and his house is seated there (the head and the heir he named with it), and the move costs
 *    him a eighth of his purse (`REMOVAL_BPS`: freight, bribes and the goods left on the quay; it leaves by the door of the men nobody
 *    names). Where his power has no such market the house is plundered and ended: half of what the head had in his purse goes to the
 *    treasury of the power that took the city, his cargoes are lost, and what is left is his own.
 *  - **The city belongs to a power that is not at war with his** (it was ceded, or sold, or a peace left it there; or it is an ally's):
 *    the house stays. The head's allegiance goes with the city, his own and his named heir's, so the house lends to, pays its liturgy to and
 *    is taxed by the new holder. A head who holds more by duty than by trade (a duty of 65 or more) will not change his power and goes,
 *    as the war's exiles did, to a market of his own, where there is one.
 *
 * Lending, the liturgy of a cargo and its customs read the head's power (`fiscal-officers.ts`, `cargoes.ts`), and this keeps the house's
 * own `polityId` equal to it.
 */

/** What moving a house costs, of the head's purse (basis points). */
export const REMOVAL_BPS = 1_250;
/** What a power that takes the city of a house it is at war with takes of the head's purse (basis points). */
export const PLUNDER_BPS = 5_000;
/** A head whose duty is this high keeps to his own power and leaves a city that has changed hands. */
const FAITHFUL_DUTY = 65;
/** How far a house looks for a new seat, in the map's kilometres. */
const SEAT_REACH_KM = 4_000;

export interface SeatsKept {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
}

/** Where the head's power has a market to go to: the nearest port hub it holds and that is not occupied, from where the house is. */
export function nearestSeatOf(world: WorldState, from: string, polityId: string): string | null {
  const reach = kmFromAny(world, [from], { budgetKm: SEAT_REACH_KM });
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const own = (id: string): boolean => {
    const province = provinces.get(id);
    return province !== undefined && province.controllerPolityId === polityId && !isOccupied(province) && id !== from;
  };
  const choose = (ports: boolean): string | null => {
    let best: string | null = null;
    let bestKm = Infinity;
    for (const hub of marketGeography(world).hubs) {
      if (!own(hub) || (ports && !hasPort(world, hub))) continue;
      const km = reach.get(hub);
      if (km === undefined) continue;
      if (km < bestKm || (km === bestKm && best !== null && hub < best)) { best = hub; bestKm = km; }
    }
    return best;
  };
  return choose(true) ?? choose(false);
}

function withHouse(world: WorldState, house: MerchantHouse): WorldState {
  const memory = economyOf(world);
  return { ...world, economy: { ...memory, houses: memory.houses.map((entry) => (entry.id === house.id ? house : entry)) } };
}

/** Look to the power and the seat of each house in `dueIds`. */
export function keepTheSeats(start: WorldState, toDay: number, ids: IdFactory, dueIds: ReadonlySet<string>): SeatsKept {
  const facts: FactProposalDraft[] = [];
  let world = start;
  const told = (house: MerchantHouse, kind: string, summary: string, significance: number, refs: readonly { kind: "character" | "province" | "polity"; id: string }[]): void => {
    if (!isLiveProvince(world, house.homeProvinceId)) return;
    facts.push({ localId: safeLocalId(`${kind}_${house.id}_${toDay}`).slice(0, 60), kind, summary: summary.slice(0, 600), affectedRefs: [...refs], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance });
  };
  for (const first of economyOf(world).houses) {
    if (first.status !== "trading" || !dueIds.has(first.id)) continue;
    let house = economyOf(world).houses.find((entry) => entry.id === first.id)!;
    const head = world.characters.find((character) => character.id === house.headCharacterId);
    if (head === undefined || !head.alive || head.polityId === null) continue;
    const polityId = head.polityId;
    // What the house knew of its city, read before the house is made the head's: a city has changed hands when its holder is not the power it was under.
    const was = house.seatPolityId ?? house.polityId;
    const home = world.map.provinces.find((province) => province.id === house.homeProvinceId);
    const holder = home?.controllerPolityId ?? null;
    const settled = (seatHolder: string | null): void => {
      house = { ...house, polityId: world.characters.find((character) => character.id === house.headCharacterId)?.polityId ?? house.polityId, seatPolityId: seatHolder ?? house.seatPolityId ?? null };
      world = withHouse(world, house);
    };
    if (home === undefined || holder === null || holder === was) { settled(holder); continue; }
    // The head's own power holds it now (a city retaken, or one he went over to): nothing is moved.
    if (holder === polityId) { settled(holder); continue; }
    const enemy = atWar(world.polityAgreements, polityId, holder);
    // An ally's garrison in a city whose owner is still the head's power is no change of allegiance.
    if (!enemy && isOccupied(home) && home.ownerPolityId === polityId) { settled(was); continue; }
    const city = home.settlements.find((settlement) => settlement.kind === "port")?.name ?? home.name;
    const holderName = world.map.polities.find((polity) => polity.id === holder)?.name ?? holder;

    const faithful = head.mind.drives.duty >= FAITHFUL_DUTY;
    const seat = enemy || faithful ? nearestSeatOf(world, hubOf(world, home.id) ?? home.id, polityId) : null;
    const purse = world.material.accounts.find((account) => account.id === head.personalAccountId);

    if (seat !== null) {
      // The flight: the house is seated in the new market, the head and his heir with it, at a cost.
      const cost = purse === undefined || purse.status !== "active" ? 0 : Math.round((purse.balance * REMOVAL_BPS) / 10_000);
      const transactions: MoneyTransaction[] = cost > 0
        ? [{
          id: ids.next("txn"), atStep: toDay, kind: "upkeep", amount: cost, sourceAccountId: purse!.id, external: "the_unnamed",
          cause: { kind: "action", id: house.id, explanation: `${house.name} removes from ${city}: freight, bribes and goods left on the quay`.slice(0, 240) }, visibility: "private",
        }]
        : [];
      const moving = new Set([head.id, ...(head.heirCharacterId === null ? [] : [head.heirCharacterId])]);
      world = {
        ...world,
        characters: world.characters.map((character) => (moving.has(character.id) && character.alive ? { ...character, locationProvinceId: seat } : character)),
        material: {
          ...world.material,
          accounts: cost > 0 ? world.material.accounts.map((account) => (account.id === purse!.id ? { ...account, balance: account.balance - cost } : account)) : world.material.accounts,
          transactions: [...world.material.transactions, ...transactions],
        },
      };
      house = { ...house, homeProvinceId: seat, polityId, seatPolityId: world.map.provinces.find((province) => province.id === seat)?.controllerPolityId ?? polityId };
      world = withHouse(world, house);
      const seatName = world.map.provinces.find((province) => province.id === seat)?.name ?? seat;
      told(house, "house_removes", enemy
        ? `${holderName} has taken ${city}, and ${house.name} leaves it for ${seatName}, to trade under ${world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId}; much is lost in the going.`
        : `${city} is ${holderName}'s now, and ${head.name} will not change his city's power: ${house.name} removes to ${seatName}.`, 38, [{ kind: "character", id: head.id }, { kind: "province", id: seat }]);
      continue;
    }

    if (enemy) {
      // Nowhere to go: the house is plundered and ended.
      const treasury = treasuryOf(world, holder);
      const taken = purse === undefined || purse.status !== "active" || treasury === null ? 0 : Math.round((purse.balance * PLUNDER_BPS) / 10_000);
      const transactions: MoneyTransaction[] = taken > 0
        ? [{
          id: ids.next("txn"), atStep: toDay, kind: "confiscation", amount: taken, sourceAccountId: purse!.id, destinationAccountId: treasury!,
          cause: { kind: "action", id: house.id, explanation: `The plunder of ${house.name} when ${city} fell to ${holderName}`.slice(0, 240) }, visibility: "polity",
        }]
        : [];
      world = {
        ...world,
        material: {
          ...world.material,
          accounts: taken > 0 ? world.material.accounts.map((account) => (account.id === purse!.id ? { ...account, balance: account.balance - taken } : account.id === treasury ? { ...account, balance: account.balance + taken } : account)) : world.material.accounts,
          transactions: [...world.material.transactions, ...transactions],
          ventures: world.material.ventures.map((venture) => (venture.ownerCharacterId === head.id && venture.status === "running" && venture.cargo !== undefined ? { ...venture, status: "closed" as const } : venture)),
        },
      };
      house = { ...house, status: "wound_up", seatPolityId: holder };
      world = withHouse(world, house);
      told(house, "house_ends", `${city} has fallen to ${holderName}, and ${house.name} is plundered and ended: its power has no market left to take it in.`, 40, [{ kind: "character", id: head.id }, { kind: "province", id: home.id }]);
      continue;
    }

    // The city is another power's, not at war with his: the head's allegiance goes with it.
    const follows = new Set([head.id, ...(head.heirCharacterId === null ? [] : [head.heirCharacterId])]);
    world = { ...world, characters: world.characters.map((character) => (follows.has(character.id) && character.alive ? { ...character, polityId: holder } : character)) };
    house = { ...house, polityId: holder, seatPolityId: holder };
    world = withHouse(world, house);
    told(house, "house_changes_power", `${city} is ${holderName}'s now, and ${house.name} stays: ${head.name} will lend, pay his liturgy and his customs to ${holderName}.`, 36, [{ kind: "character", id: head.id }, { kind: "province", id: home.id }]);
  }
  return { world, facts };
}
