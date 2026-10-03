import {
  agreementsBetween,
  alliesLedBy,
  fitStrengthOf,
  isOccupied,
  isStanding,
  kmFromAny,
  leaderOf,
  readDepartments,
  warsOf,
  type PolityAgreement,
  type WorldState,
} from "@chronica/shared";

/**
 * The board: what every power can see of its neighbourhood (docs/plans/a-living-world.md §1).
 *
 * Two hand runs found a world in which no power wanted anything and nobody
 * outside the player's business was ever shown a reason to act. Ptolemy was
 * asked three times in a year and told of grain gluts in Gerrha; nothing in his
 * section named Antiochus, the war over Coele-Syria, or where the Seleucid army
 * stood. This is that reading, worked out from state alone and once per world:
 * each power's strength, its borders, who is across them, how strong they are
 * and where their armies are, what lies between them, and what each has
 * against the other.
 *
 * It decides nothing. The world AI (`statecraft.ts`) weighs it, the cast's
 * options are drawn from it, the narrator chooses its quarrels from it, and a
 * ruler's portrait shows him his share of it.
 *
 * What a ruler is shown of a rival's armies is rough on purpose: merchants,
 * envoys and spies told a king that the Seleucid army was in the north and
 * about fifteen thousand strong, not its muster roll.
 */

/** The share of a power's levy pool it could put in the field within a season. */
export const LEVY_SHARE = 0.05;
/** How much an ally's strength counts for the power it would stand beside. */
export const ALLY_SHARE = 0.5;
/** An army this close to the border is standing on it, for the other side's reckoning. */
export const NEAR_BORDER_KM = 300;
/** A rival this far off, by the shortest road or sea lane, is still within reach. */
export const RIVAL_REACH_KM = 1_200;
/** Trust at or below this is a grievance; at or below the second, an old enmity. */
export const GRIEVANCE_TRUST = -30;
export const ENMITY_TRUST = -60;
/** A province this unsettled is a weakness on the border. */
const DISTRESS_BPS = 3_500;

/** Read from our side: "leads_us" is the power we follow by foedus, "we_protect" the power under our protection. */
export type Relation = "war" | "leads_us" | "follows_us" | "ally" | "protects_us" | "we_protect" | "tributary" | "peace" | "truce" | "none";

export interface ArmyReading {
  readonly forceId: string;
  readonly provinceId: string;
  readonly men: number;
}

export interface NeighbourReading {
  readonly polityId: string;
  readonly name: string;
  /** Shares a province edge with us; a rival may not. */
  readonly bordering: boolean;
  /** What stands between the two, read from our side. */
  readonly relation: Relation;
  /** Our trust toward them (-100 to 100). */
  readonly trust: number;
  /** Their strength, with their allies at `ALLY_SHARE`. */
  readonly strength: number;
  /** Our strength over theirs, both with allies. */
  readonly ratio: number;
  /** Their provinces on our border. */
  readonly theirBorder: readonly string[];
  /** Our provinces on their border. */
  readonly ourBorder: readonly string[];
  /** Their men standing within `NEAR_BORDER_KM` of the border. */
  readonly theirMenNear: number;
  /** Ours, the same. */
  readonly ourMenNear: number;
  /** Shortest road or sea lane between us, in kilometres; 0 when we border. */
  readonly km: number;
  /** What keeps them from answering us, each a clause that reads after "while": "it is at war with Rome", "nobody holds its rule". */
  readonly distractions: readonly string[];
  /** What we hold against them. */
  readonly grievances: readonly string[];
  /** Their provinces we claim. */
  readonly claimed: readonly string[];
  /** The other wars they are in, by power id. */
  readonly theirWars: readonly string[];
}

export interface PowerReading {
  readonly polityId: string;
  readonly name: string;
  readonly rulerId: string | null;
  readonly provinces: number;
  readonly fielded: number;
  readonly levy: number;
  /** Fielded men and the levy it could raise in a season. */
  readonly strength: number;
  readonly armies: readonly ArmyReading[];
  readonly wars: readonly string[];
  /** The leader it follows by foedus, which makes its wars and peaces for it. */
  readonly leaderId: string | null;
  readonly neighbours: readonly NeighbourReading[];
}

export type Board = ReadonlyMap<string, PowerReading>;

const boards = new WeakMap<WorldState, Board>();

/** The board for this world, read once per world object. */
export function readBoard(world: WorldState): Board {
  const known = boards.get(world);
  if (known !== undefined) return known;
  const board = buildBoard(world);
  boards.set(world, board);
  return board;
}

function buildBoard(world: WorldState): Board {
  const standing = world.map.polities.filter(isStanding);
  const nameOf = new Map(standing.map((polity) => [polity.id, polity.name]));
  const owner = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  const stability = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row.stabilityBps]));
  const rulers = readDepartments(world);

  // Ground and levy, per power.
  const ground = new Map<string, string[]>();
  for (const province of world.map.provinces) {
    if (province.controllerPolityId === null) continue;
    const list = ground.get(province.controllerPolityId) ?? [];
    list.push(province.id);
    ground.set(province.controllerPolityId, list);
  }
  // Levies come from ground a power owns and holds: occupied ground sends nobody.
  const occupied = new Set(world.map.provinces.filter(isOccupied).map((province) => province.id));
  const levyPool = new Map<string, number>();
  for (const row of world.material.provinceMaterial) {
    const holder = owner.get(row.provinceId);
    if (holder == null || occupied.has(row.provinceId)) continue;
    levyPool.set(holder, (levyPool.get(holder) ?? 0) + row.availableManpower);
  }
  const armiesOf = new Map<string, ArmyReading[]>();
  for (const force of world.material.forces) {
    if (force.outlaw === true) continue;
    const men = fitStrengthOf(force);
    if (men <= 0) continue;
    const list = armiesOf.get(force.polityId) ?? [];
    list.push({ forceId: force.id, provinceId: force.locationId, men });
    armiesOf.set(force.polityId, list);
  }
  // Where each army can be within `NEAR_BORDER_KM`: one search per army,
  // not one per border, which read the whole map in most of a second.
  const reachOfArmy = new Map<string, ReadonlySet<string>>();
  for (const armies of armiesOf.values()) {
    for (const army of armies) {
      if (!reachOfArmy.has(army.provinceId)) reachOfArmy.set(army.provinceId, new Set(kmFromAny(world, [army.provinceId], { budgetKm: NEAR_BORDER_KM }).keys()));
    }
  }
  const fieldedOf = (polityId: string): number => (armiesOf.get(polityId) ?? []).reduce((sum, army) => sum + army.men, 0);
  const levyOf = (polityId: string): number => Math.round((levyPool.get(polityId) ?? 0) * LEVY_SHARE);
  const ownStrength = (polityId: string): number => fieldedOf(polityId) + levyOf(polityId);

  // Who stands beside whom: allies, protectors, and a foedus in either direction.
  const friendsOf = (polityId: string): string[] => {
    const leader = leaderOf(world.polityAgreements, polityId);
    const friends = new Set<string>([...(leader === null ? [] : [leader]), ...alliesLedBy(world.polityAgreements, polityId)]);
    for (const agreement of world.polityAgreements) {
      if (agreement.status !== "active" || (agreement.kind !== "alliance" && agreement.kind !== "protectorate")) continue;
      if (agreement.polityId === polityId) friends.add(agreement.otherPolityId);
      if (agreement.otherPolityId === polityId) friends.add(agreement.polityId);
    }
    friends.delete(polityId);
    return [...friends].filter((id) => nameOf.has(id));
  };
  // A people bound by foedus fights with its whole bloc: attack the Etruscans
  // and Rome comes, and so do the Samnites. The bloc counts in full; allies
  // and protectors by treaty at `ALLY_SHARE`, as men who may or may not come.
  const blocOf = (polityId: string): string[] => {
    const leader = leaderOf(world.polityAgreements, polityId) ?? polityId;
    return [...new Set([leader, ...alliesLedBy(world.polityAgreements, leader)])].filter((id) => nameOf.has(id));
  };
  const withAllies = (polityId: string): number => {
    const bloc = new Set(blocOf(polityId));
    const friends = friendsOf(polityId).filter((id) => !bloc.has(id));
    return [...bloc].reduce((sum, id) => sum + ownStrength(id), 0) + ALLY_SHARE * friends.reduce((sum, id) => sum + ownStrength(id), 0);
  };

  // Every border, by pair, from one pass over the edges.
  const borders = new Map<string, Map<string, { ours: Set<string>; theirs: Set<string> }>>();
  const touch = (a: string, b: string, aProvince: string, bProvince: string): void => {
    const row = borders.get(a) ?? new Map();
    const cell = row.get(b) ?? { ours: new Set<string>(), theirs: new Set<string>() };
    cell.ours.add(aProvince);
    cell.theirs.add(bProvince);
    row.set(b, cell);
    borders.set(a, row);
  };
  for (const edge of world.map.edges) {
    const a = owner.get(edge.from) ?? null;
    const b = owner.get(edge.to) ?? null;
    if (a === null || b === null || a === b || !nameOf.has(a) || !nameOf.has(b)) continue;
    touch(a, b, edge.from, edge.to);
    touch(b, a, edge.to, edge.from);
  }

  const trustOf = (from: string, toward: string): number => trustIndex.get(`${from}>${toward}`) ?? 0;
  const activeClaims = (world.map.claimRecords ?? []).filter((claim) => claim.status === "active" && claim.locationKind === "province");
  const claimsOf = (claimant: string, holder: string): string[] => activeClaims
    .filter((claim) => claim.claimantPolityId === claimant && owner.get(claim.locationId) === holder)
    .map((claim) => claim.locationId);
  const lostProvinces = world.map.provinces.filter((province) => province.lostBy != null && province.controllerPolityId !== null);
  const lostTo = (loser: string, holder: string): string[] => lostProvinces
    .filter((province) => province.lostBy!.polityId === loser && province.controllerPolityId === holder)
    .map((province) => province.id);
  const trustIndex = new Map(world.polityStances.map((stance) => [`${stance.polityId}>${stance.towardPolityId}`, stance.trustScore]));

  // Rivals off the border: powers we distrust deeply, or claim ground from.
  const rivalsOf = (polityId: string): Set<string> => {
    const rivals = new Set<string>();
    for (const stance of world.polityStances) {
      if (stance.polityId === polityId && stance.trustScore <= GRIEVANCE_TRUST && nameOf.has(stance.towardPolityId)) rivals.add(stance.towardPolityId);
    }
    for (const claim of activeClaims) {
      if (claim.claimantPolityId !== polityId) continue;
      const holder = owner.get(claim.locationId);
      if (holder != null && holder !== polityId) rivals.add(holder);
    }
    return rivals;
  };

  const provinceOfSettlement = new Map(world.map.provinces.flatMap((province) => province.settlements.map((settlement) => [settlement.id, province.id] as const)));
  const capitalProvince = (polityId: string): string | null => {
    const capital = standing.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
    return capital === null ? null : provinceOfSettlement.get(capital) ?? null;
  };

  const readings = new Map<string, PowerReading>();
  for (const polity of standing) {
    const own = ground.get(polity.id) ?? [];
    if (own.length === 0) continue;
    const wars = warsOf(world.polityAgreements, polity.id);
    const ourStrength = withAllies(polity.id);
    const bordering = borders.get(polity.id) ?? new Map();
    const others = new Set<string>([...bordering.keys(), ...rivalsOf(polity.id)]);

    // How far off the rivals that do not border us are, from our armies and our capital.
    const offBorder = [...others].filter((id) => !bordering.has(id));
    const reachFrom = [...new Set([...(armiesOf.get(polity.id) ?? []).map((army) => army.provinceId), ...[capitalProvince(polity.id)].filter((id): id is string => id !== null)])];
    const reach = offBorder.length === 0 || reachFrom.length === 0 ? new Map<string, number>() : kmFromAny(world, reachFrom, { budgetKm: RIVAL_REACH_KM });

    const neighbours: NeighbourReading[] = [];
    for (const otherId of others) {
      const otherGround = ground.get(otherId) ?? [];
      if (otherGround.length === 0) continue;
      const cell = bordering.get(otherId);
      let km = 0;
      if (cell === undefined) {
        km = Math.min(Infinity, ...otherGround.map((id) => reach.get(id) ?? Infinity));
        if (!Number.isFinite(km)) continue;
      }
      const theirBorder = cell === undefined ? [] : [...cell.theirs];
      const ourBorder = cell === undefined ? [] : [...cell.ours];

      // Who stands near the border, either side of it.
      const borderIds = [...theirBorder, ...ourBorder];
      const menNear = (polityId: string): number => cell === undefined ? 0 : (armiesOf.get(polityId) ?? [])
        .filter((army) => { const reach = reachOfArmy.get(army.provinceId); return reach !== undefined && borderIds.some((id) => reach.has(id)); })
        .reduce((sum, army) => sum + army.men, 0);
      const theirMenNear = menNear(otherId);
      const theirStrength = withAllies(otherId);
      const theirWars = warsOf(world.polityAgreements, otherId);

      const distractions: string[] = [];
      const elsewhere = theirWars.filter((enemy) => enemy !== polity.id);
      if (elsewhere.length > 0) distractions.push(`it is at war with ${elsewhere.map((id) => nameOf.get(id) ?? id).join(" and ")}`);
      if (rulers.rulers(otherId).length === 0) distractions.push("nobody holds its rule");
      const theirFielded = fieldedOf(otherId);
      if (cell !== undefined && theirFielded > 0 && theirMenNear === 0) distractions.push("its armies are far from this border");
      if (cell !== undefined && theirFielded === 0) distractions.push("it has no army in the field");
      const shaken = theirBorder.filter((id) => (stability.get(id) ?? 10_000) < DISTRESS_BPS).length;
      if (shaken > 0) distractions.push(`${shaken} of its border provinces are in distress`);

      const trust = trustOf(polity.id, otherId);
      const grievances: string[] = [];
      if (trust <= ENMITY_TRUST) grievances.push("an old enmity");
      else if (trust <= GRIEVANCE_TRUST) grievances.push("bad blood");
      const lost = lostTo(polity.id, otherId);
      if (lost.length > 0) grievances.push(`it holds ${lost.length} province${lost.length === 1 ? "" : "s"} taken from us`);
      const claimed = claimsOf(polity.id, otherId);
      if (claimed.length > 0) grievances.push(`it holds ${claimed.length} province${claimed.length === 1 ? "" : "s"} we claim`);

      neighbours.push({
        polityId: otherId,
        name: nameOf.get(otherId) ?? otherId,
        bordering: cell !== undefined,
        relation: relationOf(world.polityAgreements, polity.id, otherId),
        trust,
        strength: Math.round(theirStrength),
        ratio: theirStrength <= 0 ? 10 : ourStrength / theirStrength,
        theirBorder,
        ourBorder,
        theirMenNear,
        ourMenNear: menNear(polity.id),
        km: Math.round(km),
        distractions,
        grievances,
        claimed,
        theirWars,
      });
    }
    neighbours.sort((a, b) => b.strength - a.strength || a.polityId.localeCompare(b.polityId));

    readings.set(polity.id, {
      polityId: polity.id,
      name: polity.name,
      rulerId: rulers.rulers(polity.id)[0]?.id ?? null,
      provinces: own.length,
      fielded: fieldedOf(polity.id),
      levy: levyOf(polity.id),
      strength: ownStrength(polity.id),
      armies: armiesOf.get(polity.id) ?? [],
      wars,
      leaderId: leaderOf(world.polityAgreements, polity.id),
      neighbours,
    });
  }
  return readings;
}

/** What stands between two powers, read from the first one's side. The strongest tie wins. */
export function relationOf(agreements: readonly PolityAgreement[], polityId: string, otherId: string): Relation {
  const between = agreementsBetween(agreements, polityId, otherId);
  const has = (kind: PolityAgreement["kind"]): PolityAgreement | undefined => between.find((agreement) => agreement.kind === kind);
  if (warsOf(agreements, polityId).includes(otherId)) return "war";
  const foedus = has("foedus");
  // The ally is named first in a foedus and the protected first in a protectorate.
  if (foedus !== undefined) return foedus.polityId === polityId ? "leads_us" : "follows_us";
  const protectorate = has("protectorate");
  if (protectorate !== undefined) return protectorate.polityId === polityId ? "protects_us" : "we_protect";
  if (has("alliance") !== undefined) return "ally";
  if (has("tributary") !== undefined) return "tributary";
  if (has("truce") !== undefined) return "truce";
  if (has("peace") !== undefined || has("non_aggression") !== undefined) return "peace";
  return "none";
}

/** "about 15 000": rough on purpose, as a king would hear it. */
export function roughMen(men: number): string {
  if (men < 100) return "a handful";
  if (men < 1_000) return `a few hundred`;
  const step = men < 10_000 ? 1_000 : 5_000;
  const rounded = Math.max(step, Math.round(men / step) * step);
  return `about ${rounded.toLocaleString("en-GB").replace(/,/g, " ")}`;
}

const RELATION_WORDS: Record<Relation, string> = {
  war: "at war with us",
  leads_us: "leads us by foedus",
  follows_us: "follows us by foedus",
  ally: "our ally",
  protects_us: "our protector",
  we_protect: "under our protection",
  tributary: "bound to us by tribute",
  peace: "at peace with us by treaty",
  truce: "under truce with us",
  none: "nothing agreed between us",
};

/**
 * A ruler's neighbourhood, in lines for his portrait: who is across his
 * borders and the rivals within reach, how strong, where their armies stand,
 * and what is between them. Strongest first, so a long border with the hill
 * tribes does not crowd out the empire next door.
 */
export function describeNeighbourhood(world: WorldState, polityId: string, max = 6): string[] {
  const reading = readBoard(world).get(polityId);
  if (reading === undefined || reading.neighbours.length === 0) return [];
  const lines = [`Their power has ${roughMen(reading.fielded)} men in the field and could raise ${roughMen(reading.levy)} more in a season. Around it:`];
  for (const neighbour of reading.neighbours.slice(0, max)) {
    const where = neighbour.bordering ? "across the border" : `about ${Math.round(neighbour.km / 10) * 10} km off`;
    const near = neighbour.bordering && neighbour.theirMenNear > 0 ? `, ${roughMen(neighbour.theirMenNear)} of them near this border` : "";
    const busy = neighbour.distractions.length === 0 ? "" : `; ${neighbour.distractions.join("; ")}`;
    const against = neighbour.grievances.length === 0 ? "" : `; between you: ${neighbour.grievances.join(", ")}`;
    lines.push(`  - ${neighbour.name} [${neighbour.polityId}], ${where}: ${RELATION_WORDS[neighbour.relation]}; ${roughMen(neighbour.strength)} under arms with its friends${near}${busy}${against}.`);
  }
  return lines;
}
