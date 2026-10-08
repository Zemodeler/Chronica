import {
  MAX_HOUSES,
  MAX_TRADING_HOUSES,
  boundedId,
  createCanonicalNpc,
  currentAgeYears,
  economyOf,
  hasPort,
  hubOf,
  isLiveProvince,
  isOccupied,
  kmFromAny,
  marketGeography,
  firmCultureOf,
  firmTitle,
  ordoOfRomanName,
  stableHash,
  type Character,
  type FactProposalDraft,
  type HouseKind,
  type MerchantHouse,
  type MoneyTransaction,
  type WorldState,
} from "@chronica/shared";
import { findKinsman, merchantFit, spokenFor } from "./house-succession";
import type { IdFactory } from "./ports";

/**
 * Houses are founded in play (docs/economy.md, "Houses are founded").
 *
 * Seventeen houses were the whole of the world's merchants for as long as it lasted, and a house that was wound up was never
 * replaced. A house is founded now two ways, and both end in the same row of the economy's memory, run afterwards by the rules of
 * `merchant-houses.ts` like any other:
 *
 *  - **By rule**, once a month (`foundHousesByRule`): a rich man with a merchant's mind, in or near a port market, sets up a house.
 *    Cheap (it reads the characters once, with the plain tests first), deterministic (`stableHash` only) and bounded.
 *  - **By order** (`house_found`, `foundHouseByOrder`): a private man puts capital out of his own purse into a house of his own;
 *    a power cannot, having no purse that is not the state's.
 *
 * **Who founds.** A free man of 25 to 66 who is no soldier, not the head or heir of a house already, nor a man the player plays
 * (unless the player orders it), with a purse past a threshold that grows with his years (18,000 at 25, 700 more a year to
 * 40,000: a young man has not put it by), and a mind for the counting-house: the same fit as an heir's (`merchantFit`, 52 or
 * more), a wish for wealth (55), some honesty (30) and some nerve and not too much (risk 25 to 85). Each month a fit man has a
 * chance of founding, from 1.5% to 8%, weighted by how fit he is and how much he wants wealth.
 *
 * **Under whose name.** A man who holds an office, or is a figure of the state (standing past 4,500), does not keep a counting-house
 * himself: at Rome the law that kept senators from sea-going trade was passed in 218 and is later than this age, and nothing barred
 * a senator here, but a magistrate's trade was done through his freedmen and clients all the same. The house is founded under a
 * freedman (at Rome; a factor elsewhere) made for it, tied to the founder as his client with a contract of service and the capital
 * moved into the freedman's purse out of the patron's, 60% of the patron's purse or 120,000, whichever is the less. Any other man
 * is his own head and the purse he has is the house's capital; the heir is looked for as for any house (`house-succession.ts`).
 *
 * **Limits.** At most `MAX_FOUNDINGS_PER_POLITY_YEAR` (2) foundings by rule a power a year and one a month, three a month in all;
 * no more than `MAX_TRADING_HOUSES` (60) houses trading at once; wound-up houses are dropped from the list after two years. One
 * fact for each founding.
 */

/** The day the check came last; a house is looked for once a month. */
const MONTH = 30;
const MIN_AGE = 25;
const MAX_AGE = 66;
/** The least a purse may be to found a house at 25, and what is added for each year past it, to a ceiling. */
const THRESHOLD_BASE = 18_000;
const THRESHOLD_PER_YEAR = 700;
const THRESHOLD_CEILING = 40_000;
/** The share of the patron's purse put into a house under an agent, and the most. */
const AGENT_CAPITAL_SHARE = 0.6;
const CAPITAL_CEILING = 120_000;
/** What a house founded by order must start with at the least. */
export const MIN_ORDERED_CAPITAL = 5_000;
const MIN_FIT = 52;
const MIN_WEALTH = 55;
const MIN_HONESTY = 30;
const RISK_RANGE = [25, 85] as const;
/** A man of more standing than this is a figure of the state: his house is kept by an agent. */
const FIGURE_OF_STATE = 4_500;
export const MAX_FOUNDINGS_PER_POLITY_YEAR = 2;
const MAX_FOUNDINGS_PER_MONTH = 3;
/** A power that answers as one thing (not a name over a dozen peoples) has counting-houses. */
const STATE_COHESION_BPS = 5_000;
/** How far from his own door a port may be for a man to trade from it, in the map's kilometres. */
const PORT_REACH_KM = 260;
/** A house wound up this long ago is forgotten. */
const FORGET_WOUND_UP_AFTER_DAYS = 730;

const KINDS: readonly HouseKind[] = ["maritime", "maritime", "maritime", "grain", "grain", "banking"];

/** The Greek names the freedmen and factors of the age bore, and the Punic ones. */
const AGENT_NAMES: Record<"roman" | "greek" | "punic", readonly string[]> = {
  roman: ["Philargyros", "Hermeros", "Eutychos", "Zosimos", "Alexander", "Felix", "Eros", "Phileros"],
  greek: ["Nikon", "Pamphilos", "Kerdon", "Menas", "Eubulos", "Sosias", "Timon", "Polyaratos"],
  punic: ["Gerosiris", "Himilkat", "Bodmelqart", "Eshmunhilles", "Malchos", "Shipitbaal", "Abdosir", "Magon"],
};
const FATHERS: Record<"greek" | "punic", readonly string[]> = {
  greek: ["Apollodoros", "Demetrios", "Kleon", "Sosikles", "Diophantos"],
  punic: ["Abdosir", "Magon", "Yatonmilk", "Hannon", "Baalhanno"],
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const isRoman = (person: Pick<Character, "cultureId" | "polityId">): boolean => person.cultureId === "roman" || person.polityId === "rome";

export type FoundingOutcome =
  | { readonly world: WorldState; readonly house: MerchantHouse; readonly fact: FactProposalDraft }
  | { readonly refusal: string; readonly kind: "world" | "reference" };

/** What a man must have in his purse to found a house at his age. */
export function foundingThreshold(ageYears: number): number {
  return clamp(THRESHOLD_BASE + Math.round((ageYears - MIN_AGE) * THRESHOLD_PER_YEAR), THRESHOLD_BASE, THRESHOLD_CEILING);
}

const purseOf = (world: WorldState, person: Character): number => {
  const purse = world.material.accounts.find((account) => account.id === person.personalAccountId);
  return purse === undefined || purse.status !== "active" ? 0 : purse.balance;
};

/** How many houses are trading now. */
export const tradingHouses = (world: WorldState): number => economyOf(world).houses.filter((house) => house.status === "trading").length;

/** The heads and heirs of the houses already trading: they have a house to keep. */
function houseKeepers(world: WorldState): ReadonlySet<string> {
  return spokenFor(world);
}

/** Whether a province is a place a house may be seated: a market, and a port in it or within a short ride. */
function mayBeSeatedAt(world: WorldState, provinceId: string, cache?: Map<string, boolean>, portAtHub = false): boolean {
  const known = cache?.get(provinceId);
  if (known !== undefined) return known;
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  let ok = false;
  if (province !== undefined && province.settlements.length > 0 && !isOccupied(province) && isLiveProvince(world, provinceId)) {
    const hub = hubOf(world, provinceId);
    if (hub !== null) {
      if (hasPort(world, hub)) ok = true;
      else if (!portAtHub) {
        const near = kmFromAny(world, [provinceId], { budgetKm: PORT_REACH_KM });
        ok = marketGeography(world).hubs.some((candidate) => near.has(candidate) && hasPort(world, candidate));
      }
    }
  }
  cache?.set(provinceId, ok);
  return ok;
}

/** A firm's name from the man's and its kind, in its own people's word: "The negotiatores of Quintus Fulvius" at Rome, "The emporoi of Nikon" at a Greek port (`firmNameFor`); told apart from those that trade. */
function houseNameFor(world: WorldState, founder: Character, given: string | null, kind: HouseKind = "maritime"): string {
  const taken = new Set(economyOf(world).houses.map((house) => house.name));
  const words = founder.name.split(" ");
  const culture = firmCultureOf(founder.polityId, founder.cultureId);
  const base = (given !== null && given.trim() !== "" ? given.trim() : null) ?? firmTitle(kind, culture, isRoman(founder) && words.length >= 2 ? words.slice(0, 2).join(" ") : words[0]!);
  for (const candidate of [base, `${base} and sons`, `${base} the younger`, `${base} of the quay`]) if (!taken.has(candidate) && candidate.length <= 120) return candidate;
  return `${base.slice(0, 100)} ${economyOf(world).houses.length + 1}`;
}

/** A freedman (at Rome) or a factor made to keep the books of a house for a man who holds an office. */
function anAgentFor(world: WorldState, patron: Character, toDay: number, ids: IdFactory): { world: WorldState; agent: Character } | null {
  const roman = isRoman(patron);
  const culture = roman ? "roman" : patron.cultureId === "carthaginian" || patron.polityId === "carthage" ? "punic" : "greek";
  const taken = new Set(world.characters.map((character) => character.name));
  const pool = AGENT_NAMES[culture];
  const given = pool[stableHash([patron.id, toDay, "agent-name"]) % pool.length]!;
  const patronWords = patron.name.split(" ");
  const base = roman
    ? `${patronWords.slice(0, 2).join(" ")} ${given}`
    : `${given} son of ${FATHERS[culture === "punic" ? "punic" : "greek"][stableHash([patron.id, toDay, "father"]) % 5]!}`;
  const name = [base, `${base} the younger`, `${base} the elder`].find((candidate) => !taken.has(candidate)) ?? `${base} ${toDay}`;
  const age = clamp(currentAgeYears(patron, toDay) - 8, 30, 46);
  const made = createCanonicalNpc(world, {
    characterId: ids.next("character"), name: name.slice(0, 120), locationProvinceId: patron.locationProvinceId, polityId: patron.polityId, createdAtStep: toDay,
    creationReason: `${roman ? "A freedman" : "A factor"} of ${patron.name}, set to keep the books of a firm of his.`.slice(0, 300),
    ageYearsAtStart: age, cultureId: patron.cultureId, faithId: patron.faithId, prestigeBps: 1_200, startingMoney: 0,
    skills: { martial: 25, intrigue: 40, learning: 45, piety: 35, stewardship: 70, diplomacy: 50, body: 45, subSkills: {} },
  });
  if (made === null) return null;
  const agent: Character = {
    ...made.character,
    legalStatus: roman ? "freed" : "free", ownerCharacterId: roman ? patron.id : null,
    mind: { ...made.character.mind, drives: { ...made.character.mind.drives, wealth: 62, status: 55 }, temperament: { ...made.character.mind.temperament, honesty: 72 }, riskTolerance: 35 },
    ...(roman ? { ordo: ordoOfRomanName(name) } : {}),
  };
  return { world: { ...made.world, characters: made.world.characters.map((character) => (character.id === agent.id ? agent : character)) }, agent };
}

export interface FoundingPlan {
  readonly founder: Character;
  /** Who keeps the books: the founder himself (null), or a man already of his household. */
  readonly head: Character | null;
  readonly heirId: string | null;
  readonly name: string;
  readonly kind: HouseKind;
  readonly homeProvinceId: string;
  /** For a house under an agent: what moves from the founder's purse to the head's. */
  readonly capital: number;
}

/**
 * Found the house: the row, the head's purse made the capital, the tie between patron and head, and one fact. Returns the refusal
 * where it cannot be (the caller has judged the rest).
 */
export function foundTheHouse(start: WorldState, plan: FoundingPlan, toDay: number, ids: IdFactory, agentOf: boolean): FoundingOutcome {
  const { founder } = plan;
  let world = start;
  let head = plan.head ?? founder;
  const houseId = ids.next("house");
  const name = houseNameFor(world, founder, plan.name, plan.kind);
  const patronised = head.id !== founder.id;

  // A house kept by an agent: made for it if the founder has none, and the capital moved into his purse.
  if (agentOf && !patronised) {
    const made = anAgentFor(world, founder, toDay, ids);
    if (made === null) return { refusal: `${founder.name} found nobody to keep the books of a house.`, kind: "world" };
    world = made.world;
    head = made.agent;
  }
  const keepsBooks = head.id !== founder.id;
  const transactions: MoneyTransaction[] = [];
  let accounts = world.material.accounts;
  if (keepsBooks) {
    const from = world.material.accounts.find((account) => account.id === founder.personalAccountId);
    const to = world.material.accounts.find((account) => account.id === head.personalAccountId);
    if (from === undefined || to === undefined || from.status !== "active" || to.status !== "active" || from.balance < plan.capital || plan.capital <= 0) {
      return { refusal: `${founder.name} has not the money for it in his purse.`, kind: "world" };
    }
    accounts = accounts.map((account) => (account.id === from.id ? { ...account, balance: account.balance - plan.capital } : account.id === to.id ? { ...account, balance: account.balance + plan.capital } : account));
    transactions.push({
      id: ids.next("txn"), atStep: toDay, kind: "transfer", amount: plan.capital, sourceAccountId: from.id, destinationAccountId: to.id,
      cause: { kind: "action", id: houseId, explanation: `${founder.name} puts ${plan.capital} into ${name}.`.slice(0, 240) }, visibility: "private",
    });
  }

  const house: MerchantHouse = {
    id: houseId, name, kind: plan.kind, polityId: head.polityId ?? founder.polityId, homeProvinceId: plan.homeProvinceId, headCharacterId: head.id,
    status: "trading", foundedAtStep: toDay, actedAtStep: toDay, toldAtStep: toDay, voyages: 0, losses: 0, lentSinceStep: null,
  };
  const memory = economyOf(world);
  // Houses wound up long ago are forgotten, so the list is the houses that live and the few that have just ended.
  const kept = memory.houses.filter((entry) => entry.status === "trading" || toDay - entry.actedAtStep < FORGET_WOUND_UP_AFTER_DAYS);
  if (kept.length >= MAX_HOUSES) return { refusal: "There are as many houses in the markets as the world can keep.", kind: "world" };
  const patronLinked = keepsBooks && !world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === founder.id && link.targetCharacterId === head.id);
  const contracted = keepsBooks && !world.material.contracts.some((contract) => contract.status === "active" && contract.employeeCharacterId === head.id && contract.employerAccountId === founder.personalAccountId);
  world = {
    ...world,
    characters: world.characters.map((character) => (character.id === head.id && plan.heirId !== null ? { ...character, heirCharacterId: plan.heirId } : character)),
    economy: { ...memory, houses: [...kept, house] },
    socialLinks: patronLinked ? [...world.socialLinks, {
      id: boundedId("social", founder.id, "patron", head.id, toDay), subjectCharacterId: founder.id, targetCharacterId: head.id, kind: "patron" as const,
      sourceEventId: null, createdAtStep: toDay, visibility: "public" as const,
    }] : world.socialLinks,
    material: {
      ...world.material,
      accounts,
      transactions: [...world.material.transactions, ...transactions],
      contracts: contracted ? [...world.material.contracts, {
        id: boundedId("contract", houseId, head.id), role: roman(head) ? "steward" as const : "agent" as const, label: `Keeps the books of ${name}`.slice(0, 160),
        employerAccountId: founder.personalAccountId, employeeCharacterId: head.id, obligationId: null, incomeSourceId: null, grantId: null, advance: 0, monthlyPay: 0,
        duties: "Keeps the books and the factors of the house, and sells its cargoes at the quay.", openedAtStep: toDay, endsAtStep: null,
        forceId: null, forceWas: null, provinceId: plan.homeProvinceId, counterpartPolityId: null, status: "active" as const,
      }] : world.material.contracts,
    },
  };
  const placeName = world.map.provinces.find((province) => province.id === plan.homeProvinceId)?.settlements.find((settlement) => settlement.kind === "port")?.name
    ?? world.map.provinces.find((province) => province.id === plan.homeProvinceId)?.name ?? "the port";
  const fact: FactProposalDraft = {
    localId: `house_founded_${houseId}`.slice(0, 60), kind: "house_founded",
    summary: (keepsBooks
      ? `${founder.name} sets up ${name} at ${placeName}, with ${plan.capital} of his own, and puts ${head.name}, ${isRoman(founder) ? "his freedman" : "his factor"}, at its books.`
      : `${founder.name} sets up ${name} at ${placeName}, with what he has, to carry goods between the ports.`).slice(0, 600),
    affectedRefs: [{ kind: "character", id: founder.id }, ...(keepsBooks ? [{ kind: "character" as const, id: head.id }] : []), { kind: "province", id: plan.homeProvinceId }],
    visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 28,
  };
  return { world, house, fact };
}

const roman = (person: Character): boolean => person.legalStatus === "freed" || isRoman(person);

/** Whether a man is a soldier or a captain now, and no man to leave his post for a counting-house. */
function servingSet(world: WorldState): ReadonlySet<string> {
  const serving = new Set<string>();
  for (const force of world.material.forces) { serving.add(force.commanderCharacterId); for (const member of force.memberCharacterIds) serving.add(member); }
  return serving;
}

/**
 * Once a month: the men of the world who might found a house, by rule. At most three foundings a month in all, one a month and two a
 * year for any power, and none past the cap of houses trading. The man the model plays is left alone.
 */
export function foundHousesByRule(start: WorldState, toDay: number, ids: IdFactory, playerCharacterId: string | null): { world: WorldState; facts: FactProposalDraft[] } {
  const memory = economyOf(start);
  if (toDay - (memory.housesLookedToAtStep ?? -MONTH) < MONTH) return { world: start, facts: [] };
  // The month is marked whether or not anybody founds, so a world that has nobody to found is not searched twice.
  let world: WorldState = { ...start, economy: { ...memory, housesLookedToAtStep: toDay } };
  const facts: FactProposalDraft[] = [];
  if (tradingHouses(world) >= MAX_TRADING_HOUSES) return { world, facts };

  const keepers = houseKeepers(world);
  const serving = servingSet(world);
  const purses = new Map(world.material.accounts.filter((account) => account.status === "active").map((account) => [account.id, account.balance]));
  const seats = new Map<string, boolean>();
  const states = new Set(world.map.polities.filter((polity) => polity.cohesionBps >= STATE_COHESION_BPS).map((polity) => polity.id));
  const bucket = Math.floor(toDay / MONTH);
  const candidates: { person: Character; chance: number; score: number }[] = [];
  for (const person of world.characters) {
    if (!person.alive || person.gender !== "male" || person.polityId === null || person.id === playerCharacterId) continue;
    if (person.legalStatus === "enslaved" || person.disqualifyingStatuses.length > 0 || keepers.has(person.id) || serving.has(person.id)) continue;
    const balance = purses.get(person.personalAccountId) ?? 0;
    if (balance < THRESHOLD_BASE) continue;
    const age = currentAgeYears(person, toDay);
    if (age < MIN_AGE || age > MAX_AGE || balance < foundingThreshold(age)) continue;
    const { drives, temperament, riskTolerance } = person.mind;
    const fit = merchantFit(person);
    if (fit < MIN_FIT || drives.wealth < MIN_WEALTH || temperament.honesty < MIN_HONESTY || riskTolerance < RISK_RANGE[0] || riskTolerance > RISK_RANGE[1]) continue;
    const chance = clamp(150 + (fit - MIN_FIT) * 20 + (drives.wealth - MIN_WEALTH) * 10, 150, 800);
    if (stableHash([person.id, "found-a-house", bucket]) % 10_000 >= chance) continue;
    candidates.push({ person, chance, score: fit * 100 + drives.wealth });
  }
  if (candidates.length === 0) return { world, facts };
  candidates.sort((a, b) => b.score - a.score || a.person.id.localeCompare(b.person.id));

  const yearAgo = toDay - 365;
  const foundedThisYear = new Map<string, number>();
  const foundedThisMonth = new Set<string>();
  for (const house of memory.houses) {
    if (house.polityId === null || house.foundedAtStep <= yearAgo || house.foundedAtStep === 0) continue;
    foundedThisYear.set(house.polityId, (foundedThisYear.get(house.polityId) ?? 0) + 1);
    if (house.foundedAtStep > toDay - MONTH) foundedThisMonth.add(house.polityId);
  }
  let founded = 0;
  for (const { person } of candidates) {
    if (founded >= MAX_FOUNDINGS_PER_MONTH || tradingHouses(world) >= MAX_TRADING_HOUSES) break;
    const polityId = person.polityId!;
    if ((foundedThisYear.get(polityId) ?? 0) >= MAX_FOUNDINGS_PER_POLITY_YEAR || foundedThisMonth.has(polityId)) continue;
    // By rule a house is founded by a man who lives in the port town itself, in a power that acts as a state (a tribal confederation has no counting-houses).
    if (!states.has(polityId) || !mayBeSeatedAt(world, person.locationProvinceId, seats, true)) continue;
    const underAnAgent = person.officeId !== null || person.prestigeBps > FIGURE_OF_STATE;
    const balance = purseOf(world, person);
    const capital = underAnAgent ? Math.min(CAPITAL_CEILING, Math.round(balance * AGENT_CAPITAL_SHARE)) : balance;
    // A man who is his own head: his kin are asked to follow him as for any house, at once if there is one.
    let heirId: string | null = null;
    if (!underAnAgent) heirId = findKinsman(world, person, toDay, keepers)?.id ?? null;
    const kind = KINDS[stableHash([person.id, "house-kind"]) % KINDS.length]!;
    const outcome = foundTheHouse(world, { founder: person, head: null, heirId, name: "", kind, homeProvinceId: person.locationProvinceId, capital }, toDay, ids, underAnAgent);
    if ("refusal" in outcome) continue;
    world = outcome.world;
    facts.push(outcome.fact);
    founded += 1;
    foundedThisYear.set(polityId, (foundedThisYear.get(polityId) ?? 0) + 1);
    foundedThisMonth.add(polityId);
  }
  return { world, facts };
}

/** The refusal of an order that does not have what a house is founded on, or the house founded. The founder is the actor and the purse his own. */
export function foundHouseByOrder(
  world: WorldState,
  delta: { readonly name: string; readonly kind: HouseKind; readonly founderRef: string | null; readonly headRef: string | null; readonly heirRef: string | null; readonly homeProvinceId: string | null; readonly capital: number },
  actor: { readonly kind: string; readonly id: string },
  resolve: (ref: string) => string | undefined,
  ids: IdFactory,
): FoundingOutcome {
  if (actor.kind !== "character") return { refusal: "A power cannot found a firm: it has no purse of its own that is not the state's. Its men may, out of theirs.", kind: "world" };
  const byId = (ref: string | null): Character | undefined => (ref === null ? undefined : world.characters.find((character) => character.id === (resolve(ref) ?? ref)));
  const founder = delta.founderRef === null ? world.characters.find((character) => character.id === actor.id) : byId(delta.founderRef);
  if (founder === undefined) return { refusal: `No man "${delta.founderRef ?? actor.id}" exists to found a house.`, kind: "reference" };
  if (founder.id !== actor.id) return { refusal: `${founder.name}'s purse is his own: he must found the firm himself.`, kind: "world" };
  if (!founder.alive) return { refusal: `${founder.name} is dead.`, kind: "world" };
  if (founder.legalStatus === "enslaved") return { refusal: `${founder.name} is a slave: a slave's money is his master's.`, kind: "world" };
  if (tradingHouses(world) >= MAX_TRADING_HOUSES) return { refusal: "There are as many houses trading as the markets will bear.", kind: "world" };
  const keepers = houseKeepers(world);
  if (keepers.has(founder.id)) return { refusal: `${founder.name} already keeps a house.`, kind: "world" };

  const head = delta.headRef === null ? null : byId(delta.headRef);
  if (delta.headRef !== null && head === undefined) return { refusal: `No man "${delta.headRef}" exists to keep the books.`, kind: "reference" };
  if (head !== undefined && head !== null) {
    if (!head.alive || head.legalStatus === "enslaved" || keepers.has(head.id)) return { refusal: `${head.name} cannot take the books of a new house.`, kind: "world" };
    if (head.id !== founder.id && head.polityId !== founder.polityId) return { refusal: `${head.name} is of another power: the firm would be his and not the founder's.`, kind: "world" };
  }
  const heir = delta.heirRef === null ? null : byId(delta.heirRef);
  if (delta.heirRef !== null && heir === undefined) return { refusal: `No man "${delta.heirRef}" exists to follow the house.`, kind: "reference" };
  if (heir !== null && heir !== undefined && (!heir.alive || heir.gender !== "male" || heir.legalStatus === "enslaved" || keepers.has(heir.id))) return { refusal: `${heir.name} cannot follow the head of a house.`, kind: "world" };

  const homeId = delta.homeProvinceId === null ? founder.locationProvinceId : delta.homeProvinceId;
  const home = world.map.provinces.find((province) => province.id === homeId);
  if (home === undefined) return { refusal: `No province "${homeId}" exists to seat a firm in.`, kind: "reference" };
  if (!mayBeSeatedAt(world, homeId)) return { refusal: `${home.name} has no market with a port within reach: a firm is seated where goods are bought and shipped.`, kind: "world" };
  if (homeId !== founder.locationProvinceId) {
    const near = kmFromAny(world, [founder.locationProvinceId], { budgetKm: 400 });
    if (!near.has(homeId)) return { refusal: `${founder.name} lives too far from ${home.name} to keep a firm there.`, kind: "world" };
  }
  const balance = purseOf(world, founder);
  const keepsBooks = head !== undefined && head !== null && head.id !== founder.id;
  const capital = Math.min(delta.capital, balance);
  if (capital < MIN_ORDERED_CAPITAL) return { refusal: `${founder.name} has ${balance} in his purse: a firm is not founded on less than ${MIN_ORDERED_CAPITAL}.`, kind: "world" };
  // A man who is his own head puts his whole purse behind it: the head's purse is the house's capital, and what he names is the least he will have in it.
  return foundTheHouse(world, { founder, head: keepsBooks ? head! : null, heirId: heir?.id ?? null, name: delta.name, kind: delta.kind, homeProvinceId: homeId, capital: keepsBooks ? capital : 0 }, world.elapsedStep, ids, false);
}
