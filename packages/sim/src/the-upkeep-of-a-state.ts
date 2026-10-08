import {
  allOffices,
  isOccupied,
  type Office,
  type Province,
  type WorldState,
} from "@chronica/shared";

/**
 * What a state pays each month to go on being one (docs/economy.md, "Where the money goes").
 *
 * Two bills, both read off the world as it stands and stored nowhere, both in drachmae a month:
 *
 *  - **Upkeep**, the keeping up of what the power holds: its roads, walls and watch-towers, harbours and docks, granaries, aqueducts, temples
 *    and public halls. It grows with the settled size of its towns (more to keep where more people live), with the development of the
 *    provinces it holds (a richer land has more road, more drain, more stone to keep), with the fortified places and the ports, and, for a
 *    maritime power, with the hulls it keeps at dock.
 *  - **Costs of the state**, the public servants and expenses of government: the lictors, scribes and criers who wait on each magistrate, the
 *    public slaves and clerks of the offices, the house of the council and its keeper, the games and festivals the aediles give, the rites
 *    and the priests' share, the lodging and gifts of the envoys of other powers, and a king's court and his friends' keep. A Roman senator was
 *    unpaid, and so is none paid here: what is counted is the house, the clerks and the guests, never a salary for a seat. The pay of
 *    those who were paid (an officer of the accounts, a department's men) goes through the departments' own pay (`departments.ts`) and is not
 *    counted twice.
 *
 * One walk of the provinces for every power at once, and one of the offices; no pass is made for a province alone.
 */

// ── Upkeep: the unit costs ────────────────────────────────────────────────

/** Roads and bridges: for each whole point of development (10,000 basis points) of each province held. */
export const ROAD_PER_DEVELOPMENT = 620;
/** Streets, drains, granaries, aqueducts, temples and halls: for each unit of a province's settled size, by how developed it is (0.4 + development). */
export const TOWN_PER_SETTLED = 92;
/** A wall, a gate or a watch-tower: for each level of fortification of each settlement. */
export const WALL_PER_LEVEL = 780;
/** A harbour and its docks: a base for each port, and for each unit of its size. */
export const HARBOUR_BASE = 650;
export const HARBOUR_PER_SIZE = 38;
/** The ship-sheds, the rope and the timber of each warship kept at dock. (The crew's pay is the army's, `tick.ts`.) */
export const DOCK_PER_HULL = 70;

// ── Costs of the state: the unit costs ───────────────────────────────────

/** Lictors, scribes and criers: for each seat of a magistracy, more for the higher office. */
export const RETINUE_PER_SEAT = 200;
/** The priests' share and the rites of the year: for each seat of a priesthood. */
export const RITES_PER_SEAT = 150;
/** The house of a council or assembly, and its keeper: a base for each chamber, and for the root of its weight. */
export const HOUSE_BASE = 800;
export const HOUSE_PER_ROOT_WEIGHT = 70;
/** The games and the festivals: for the root of the capital's settled size, more where the form is a republic with aediles. */
export const GAMES_PER_ROOT_SIZE = 340;
/** Public slaves and clerks: a share of what the power takes in each month. */
export const CLERKS_SHARE = 0.011;
/** The lodging and the gifts of an embassy: each envoy of another power who came this month (at most `MOST_ENVOYS`), and the standing hospitality owed each power it has an understanding with. */
export const ENVOY_COST = 640;
export const MOST_ENVOYS = 10;
export const HOSPITALITY_PER_FRIEND = 130;
/** A king's court and the keep of his friends: a share of what the power takes in, and a base for each seat of the king's council. */
export const COURT_SHARE = 0.011;
export const COURT_PER_FRIEND = 420;

export interface Upkeep {
  readonly roads: number;
  readonly towns: number;
  readonly walls: number;
  readonly harbours: number;
  readonly docks: number;
  readonly total: number;
}

export interface Costs {
  readonly retinue: number;
  readonly clerks: number;
  readonly house: number;
  readonly games: number;
  readonly rites: number;
  readonly embassies: number;
  readonly court: number;
  readonly total: number;
}

export interface StateBill {
  readonly upkeep: Upkeep;
  readonly costs: Costs;
}

const NOTHING_KEPT: Upkeep = { roads: 0, towns: 0, walls: 0, harbours: 0, docks: 0, total: 0 };

interface Tally {
  roads: number;
  towns: number;
  walls: number;
  harbours: number;
  docks: number;
  /** Provinces held, for the sizes a power's costs are counted by. */
  provinces: number;
}

/** What each power's holdings cost to keep, in one walk of the provinces and one of the fleets. */
export function upkeepByPolity(world: WorldState): Map<string, Upkeep> {
  const rows = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const tally = new Map<string, Tally>();
  const portProvinces = new Set<string>();
  for (const province of world.map.provinces) {
    const holder = province.controllerPolityId;
    if (province.settlements.some((settlement) => settlement.kind === "port")) portProvinces.add(province.id);
    // Ground an enemy holds is not kept by its owner, nor by the holder: it falls to ruin by the war's own rules.
    if (holder === null || isOccupied(province)) continue;
    const row = rows.get(province.id);
    const development = (row?.developmentBps ?? 3_000) / 10_000;
    let settled = 0;
    let levels = 0;
    let harbour = 0;
    for (const settlement of province.settlements) {
      settled += settlement.size;
      levels += settlement.fortificationLevel > 0 ? settlement.fortificationLevel : settlement.kind === "fortress" ? 1 : 0;
      if (settlement.kind === "port") harbour += HARBOUR_BASE + HARBOUR_PER_SIZE * settlement.size;
    }
    const kept = tally.get(holder) ?? { roads: 0, towns: 0, walls: 0, harbours: 0, docks: 0, provinces: 0 };
    kept.roads += ROAD_PER_DEVELOPMENT * development;
    kept.towns += TOWN_PER_SETTLED * settled * (0.4 + development);
    kept.walls += WALL_PER_LEVEL * levels;
    kept.harbours += harbour;
    kept.provinces += 1;
    tally.set(holder, kept);
  }
  // A maritime power's hulls at dock: the ships lying in a harbour, not the ones at sea.
  for (const force of world.material.forces) {
    if (force.outlaw === true || force.private === true || !portProvinces.has(force.locationId)) continue;
    const hulls = force.personnel.reduce((sum, category) => sum + (category.categoryId === "warship" ? category.fit : 0), 0);
    if (hulls <= 0) continue;
    const kept = tally.get(force.polityId);
    if (kept !== undefined) kept.docks += DOCK_PER_HULL * hulls;
  }
  const found = new Map<string, Upkeep>();
  for (const [polityId, kept] of tally) {
    const roads = Math.round(kept.roads);
    const towns = Math.round(kept.towns);
    const walls = Math.round(kept.walls);
    const harbours = Math.round(kept.harbours);
    const docks = Math.round(kept.docks);
    found.set(polityId, { roads, towns, walls, harbours, docks, total: roads + towns + walls + harbours + docks });
  }
  return found;
}

/** Whether the office is a magistracy (the default), a seat in a council, or a priesthood. */
const kindOf = (office: Office): "magistracy" | "membership" | "priesthood" => office.kind ?? "magistracy";

/** How many seats an office has: the number the scenario states, else the seats the world has named, else one. */
function seatsOf(office: Office, named: ReadonlyMap<string, number>): number {
  return Math.max(1, office.seatCount ?? named.get(office.id) ?? 1);
}

/** What each power's government costs, from its offices and chambers, its size and the embassies it has lately lodged. */
export function costsByPolity(
  world: WorldState,
  offices: readonly Office[],
  takings: ReadonlyMap<string, number>,
  toDay: number,
): Map<string, Costs> {
  const named = new Map<string, number>();
  for (const seat of world.material.officeSeats) named.set(seat.officeId, (named.get(seat.officeId) ?? 0) + 1);
  const retinue = new Map<string, number>();
  const rites = new Map<string, number>();
  const aediles = new Set<string>();
  for (const office of allOffices(world, offices)) {
    const seats = seatsOf(office, named);
    switch (kindOf(office)) {
      case "magistracy":
        // A higher office goes with more lictors: the consul twelve, the praetor six, the aedile two.
        retinue.set(office.polityId, (retinue.get(office.polityId) ?? 0) + RETINUE_PER_SEAT * seats * (1 + (office.rank ?? 0) / 4));
        if (/aedile|agoranom/i.test(office.label)) aediles.add(office.polityId);
        break;
      case "priesthood":
        rites.set(office.polityId, (rites.get(office.polityId) ?? 0) + RITES_PER_SEAT * Math.sqrt(seats) * 2);
        break;
      case "membership":
        break;
    }
  }
  const houses = new Map<string, number>();
  const friends = new Map<string, number>();
  for (const chamber of world.material.institutions) {
    houses.set(chamber.polityId, (houses.get(chamber.polityId) ?? 0) + HOUSE_BASE + HOUSE_PER_ROOT_WEIGHT * Math.sqrt(chamber.totalVotingWeight));
    if (chamber.advisory === true) friends.set(chamber.polityId, (friends.get(chamber.polityId) ?? 0) + 1);
  }
  const monarchies = new Set(world.constitutions.filter((constitution) => constitution.form === "monarchy").map((constitution) => constitution.polityId));
  const envoys = new Map<string, number>();
  for (const message of world.diplomacy) {
    if (toDay - message.sentAtStep > 30 || message.fromPolityId === message.toPolityId) continue;
    envoys.set(message.toPolityId, (envoys.get(message.toPolityId) ?? 0) + 1);
  }
  const hosted = new Map<string, number>();
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind === "war" || agreement.kind === "truce") continue;
    hosted.set(agreement.polityId, (hosted.get(agreement.polityId) ?? 0) + 1);
    hosted.set(agreement.otherPolityId, (hosted.get(agreement.otherPolityId) ?? 0) + 1);
  }
  const provinceOfSettlement = new Map<string, Province>();
  for (const province of world.map.provinces) for (const settlement of province.settlements) provinceOfSettlement.set(settlement.id, province);

  const found = new Map<string, Costs>();
  for (const polity of world.map.polities) {
    const taking = takings.get(polity.id) ?? 0;
    const capital = polity.capitalSettlementId === null ? undefined : provinceOfSettlement.get(polity.capitalSettlementId);
    const capitalSize = capital === undefined ? 0 : capital.settlements.reduce((sum, settlement) => sum + settlement.size, 0);
    const retinueCost = Math.round(retinue.get(polity.id) ?? 0);
    const clerks = Math.round(taking * CLERKS_SHARE);
    const house = Math.round(houses.get(polity.id) ?? 0);
    const games = Math.round(GAMES_PER_ROOT_SIZE * Math.sqrt(capitalSize) * (aediles.has(polity.id) ? 1.4 : 0.8));
    const riteCost = Math.round(rites.get(polity.id) ?? 0);
    const embassies = Math.round(ENVOY_COST * Math.min(MOST_ENVOYS, envoys.get(polity.id) ?? 0) + HOSPITALITY_PER_FRIEND * (hosted.get(polity.id) ?? 0));
    const court = monarchies.has(polity.id) ? Math.round(COURT_SHARE * taking + COURT_PER_FRIEND * (friends.get(polity.id) ?? 0)) : 0;
    found.set(polity.id, {
      retinue: retinueCost, clerks, house, games, rites: riteCost, embassies, court,
      total: retinueCost + clerks + house + games + riteCost + embassies + court,
    });
  }
  return found;
}

/** The two bills of a power, or nothing where it holds nothing. */
export function billOf(upkeep: ReadonlyMap<string, Upkeep>, costs: ReadonlyMap<string, Costs>, polityId: string): StateBill | null {
  const kept = upkeep.get(polityId);
  const cost = costs.get(polityId);
  if (kept === undefined && cost === undefined) return null;
  return { upkeep: kept ?? NOTHING_KEPT, costs: cost ?? { retinue: 0, clerks: 0, house: 0, games: 0, rites: 0, embassies: 0, court: 0, total: 0 } };
}
