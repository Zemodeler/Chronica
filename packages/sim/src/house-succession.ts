import {
  aNameFor,
  boundedId,
  computeOpinion,
  createCanonicalNpc,
  currentAgeYears,
  economyOf,
  estateWasSoldUp,
  familyLinksOf,
  isLiveProvince,
  ordoOfRomanName,
  stableHash,
  type Character,
  type FactProposalDraft,
  type MerchantHouse,
  type MoneyTransaction,
  type WorldState,
} from "@chronica/shared";
import { hireAtThePlace } from "./apply/hiring-market";
import type { IdFactory } from "./ports";

/**
 * Who follows the head of a merchant house (docs/economy.md, "Who manages the economy", "Who follows the head").
 *
 * A house is a head, a purse and the man named to follow him. Until now the second head of a house had nobody named,
 * and so the house ended with its third head, or with a heir who died young. A house outlived its heads in the age by
 * the means any family firm did, in this order, and each is a rule here, deterministic (`stableHash` only) and with no
 * model call:
 *
 *  1. **A kinsman.** A living man of the head's blood or marriage (his sons, his brothers' sons, his daughters'
 *     husbands, his cousins, to the third degree of the family graph), of full age, of the head's own power and not
 *     barred, who is fit for the counting-house (a wish for wealth, honesty, a head for the books and a care for risk
 *     read off his mind) and with whom the head is not at odds. The nearest in blood who is fit; the head names him.
 *  2. **Adoption.** Rome adopted a nephew, a client, a freedman or the steward who ran the business; a Greek city or
 *     Carthage took a son-in-law, a nephew or a trusted manager. The house asks, in turn, the man who keeps its books
 *     under a service contract (steward or agent), the freedmen and clients of the head, and then the men of its city
 *     who are free of office and children of their own; each who is fit and younger than the head is asked, and
 *     accepts or refuses by his own nature (what he wants of wealth and standing, his duty and his family, what he
 *     thinks of the head, and what he is to the head), the answer fixed by the pair and not drawn afresh. He who
 *     accepts takes the head's name (Rome: his own praenomen with the head's nomen and cognomen; elsewhere "son of"
 *     the head), is made the head's child in the family graph, is linked to him as kin, has a contract of adoption
 *     recorded, and is paid a gift out of the head's purse (3% to 6,000) for leaving what he was; his contract of
 *     service ends. He is then the heir the head has named, and what the head leaves, the purse and the cargoes,
 *     goes to him by the ordinary rules of the estate.
 *  3. **A new man**, only where there is none of either, only after the head has gone half a year unfollowed, and
 *     then not always: one throw a year, weighted by the capital of the house and the head's standing (about three
 *     in ten for an ordinary house). A man found in its market as a factor is taken and adopted, or a young man of
 *     another branch of the family is brought in as nephew. This is the rare branch.
 *  4. **Wound up.** With none of these and the head dead, the estate goes by `settleEstate`: no heir, so the coin to
 *     his power's treasury, the cargoes closed, the house ended.
 *
 * The line is looked to once a month with the house's other business (`merchant-houses.ts`), so an heir who dies is
 * made good at the next look and the new head, who came to it unfollowed, has his own named within the month if any man
 * can be had, or within the year if not.
 */

/** The youngest a man may be to take a house. */
const ADULT_AGE = 18;
/** The oldest a man is chosen at: nobody takes a house to die at once of it. */
const MAX_CHOSEN_AGE = 58;
/** What a kinsman must be worth at the books, out of a hundred, and what a man from outside must be. */
const MIN_FIT_KIN = 36;
const MIN_FIT_ADOPTED = 48;
/** The least honesty a man may have and be given a house's books. */
const MIN_HONESTY = 28;
/** How far through the family graph a kinsman is looked for. */
const KIN_DEPTH = 3;
/** A head without an heir this long has the new-man throw. */
const NEW_MAN_AFTER_DAYS = 180;
/** A man of more standing than this is a figure of the state and not of a counting-house: nobody takes him from it. */
const MAX_PRESTIGE_ADOPTED = 4_500;
/** How many men a house asks, in turn, before it gives up for the month. */
const MAX_ASKED = 8;
/** The gift for leaving one's life to take another's, of the head's purse (basis points), and its bounds. */
const GIFT_BPS = 300;
const GIFT_MAX = 6_000;
const GIFT_MIN = 400;
/** What a young man of another branch is brought in with. */
const KINSMAN_PURSE = 3_000;

export type HeirBranch = "kin" | "adoption" | "new_man";

export interface LineKept {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** How well a man would keep a counting-house, out of a hundred, off his mind and his gifts. */
export function merchantFit(person: Pick<Character, "mind" | "skills">): number {
  const { drives, temperament, riskTolerance } = person.mind;
  return Math.round(0.3 * drives.wealth + 0.25 * temperament.honesty + 0.3 * person.skills.stewardship + 0.15 * (100 - riskTolerance));
}

/** Whether a living man may be named heir to this head at all: a free man of full age, of the head's power, not barred. */
function mayFollow(person: Character, head: Character, toDay: number): boolean {
  if (!person.alive || person.id === head.id || person.gender !== "male" || person.legalStatus === "enslaved") return false;
  if (person.disqualifyingStatuses.length > 0) return false;
  if (person.polityId !== null && head.polityId !== null && person.polityId !== head.polityId) return false;
  const age = currentAgeYears(person, toDay);
  return age >= ADULT_AGE && age <= MAX_CHOSEN_AGE;
}

/** Whether the man the head named still stands to follow him: alive, free, not carried off or gone to another power. */
function heirStands(world: WorldState, head: Character): boolean {
  if (head.heirCharacterId === null) return false;
  const heir = world.characters.find((character) => character.id === head.heirCharacterId);
  if (heir === undefined || !heir.alive || heir.legalStatus === "enslaved") return false;
  if (heir.disqualifyingStatuses.includes("captured")) return false;
  if (heir.polityId !== null && head.polityId !== null && heir.polityId !== head.polityId) return false;
  return true;
}

/** The men and women of the house already spoken for: the heads of the houses and the heirs they named. */
export function spokenFor(world: WorldState): Set<string> {
  const taken = new Set<string>();
  for (const house of economyOf(world).houses) {
    if (house.status !== "trading") continue;
    taken.add(house.headCharacterId);
    const head = world.characters.find((character) => character.id === house.headCharacterId);
    if (head?.heirCharacterId != null) taken.add(head.heirCharacterId);
  }
  return taken;
}

/** How near in blood a link makes a man, within its degree: sons before brothers, brothers before the rest. */
const KIND_NEARNESS: Record<string, number> = { child: 0, sibling: 1, parent: 2, other_relative: 3, spouse_or_partner: 4 };

/** The head's kin through the family graph: id and how near (the degree tens, the kind of link units; less is nearer). Spouses carry the line only to the husbands of daughters. */
function kinOf(world: WorldState, head: Character): Map<string, number> {
  const reached = new Map<string, number>([[head.id, 0]]);
  let frontier = [head.id];
  for (let degree = 1; degree <= KIN_DEPTH; degree += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const view of familyLinksOf(world, id)) {
        if (reached.has(view.counterpartCharacterId)) continue;
        const blood = view.kind === "parent" || view.kind === "child" || view.kind === "sibling" || view.kind === "other_relative";
        // A husband is of the family where his wife is the head's own daughter or sister.
        const marriage = view.kind === "spouse_or_partner" && id !== head.id && degree <= 2;
        if (!blood && !marriage) continue;
        reached.set(view.counterpartCharacterId, degree * 10 + (KIND_NEARNESS[view.kind] ?? 5));
        next.push(view.counterpartCharacterId);
      }
    }
    frontier = next;
  }
  reached.delete(head.id);
  return reached;
}

/** The nearest kinsman fit to follow, or null. */
export function findKinsman(world: WorldState, head: Character, toDay: number, spoken: ReadonlySet<string>): Character | null {
  const kin = kinOf(world, head);
  if (kin.size === 0) return null;
  const pool = world.characters
    .filter((person) => kin.has(person.id) && !spoken.has(person.id) && mayFollow(person, head, toDay))
    .filter((person) => merchantFit(person) >= MIN_FIT_KIN && person.mind.temperament.honesty >= MIN_HONESTY && computeOpinion(head, person.id) > -25)
    .sort((a, b) => kin.get(a.id)! - kin.get(b.id)! || merchantFit(b) - merchantFit(a) || currentAgeYears(b, toDay) - currentAgeYears(a, toDay) || a.id.localeCompare(b.id));
  return pool[0] ?? null;
}

type Standing = "steward" | "freedman" | "client" | "citizen";

/** How willing a man is to be adopted, out of a hundred, by his own nature and by what he is to the head. */
function willingness(person: Character, head: Character, standing: Standing): number {
  const drives = person.mind.drives;
  const regard = clamp(computeOpinion(person, head.id), -30, 30);
  const bond = standing === "freedman" ? 20 : standing === "steward" ? 15 : standing === "client" ? 10 : 0;
  return Math.round(35 + (drives.wealth - 50) * 0.45 + (drives.status - 50) * 0.35 + (drives.family - 50) * 0.2 + (drives.duty - 50) * 0.15 + regard * 0.5 + bond);
}

/** The men the house may ask to be its heir, the nearest to the books first, each with what he is to the head. */
function candidatesForAdoption(world: WorldState, head: Character, toDay: number, spoken: ReadonlySet<string>): { person: Character; standing: Standing }[] {
  const headAge = currentAgeYears(head, toDay);
  const byId = new Map(world.characters.map((character) => [character.id, character]));
  const seen = new Set<string>();
  const found: { person: Character; standing: Standing }[] = [];
  const kin = kinOf(world, head);
  const consider = (person: Character | undefined, standing: Standing): void => {
    if (person === undefined || seen.has(person.id) || spoken.has(person.id) || kin.has(person.id)) return;
    seen.add(person.id);
    if (!mayFollow(person, head, toDay) || person.officeId !== null) return;
    // He must be the younger, and a man of his own line is not taken from it.
    if (currentAgeYears(person, toDay) >= headAge) return;
    if (merchantFit(person) < MIN_FIT_ADOPTED || person.mind.temperament.honesty < MIN_HONESTY) return;
    if (computeOpinion(head, person.id) <= -20) return;
    found.push({ person, standing });
  };
  const nearer = (person: Character): number => (person.locationProvinceId === head.locationProvinceId ? 0 : 1);
  const rank = (standing: Standing): { person: Character; standing: Standing }[] => found
    .filter((entry) => entry.standing === standing)
    .sort((a, b) => nearer(a.person) - nearer(b.person) || merchantFit(b.person) - merchantFit(a.person) || a.person.id.localeCompare(b.person.id));

  // The man who keeps its books under a contract of service.
  for (const contract of world.material.contracts) {
    if (contract.status === "active" && (contract.role === "steward" || contract.role === "agent") && contract.employerAccountId === head.personalAccountId) {
      consider(byId.get(contract.employeeCharacterId), "steward");
    }
  }
  // His freedmen, and the clients his social links name.
  for (const person of world.characters) if (person.ownerCharacterId === head.id && person.legalStatus === "freed") consider(person, "freedman");
  for (const link of world.socialLinks) {
    if (link.kind === "client" && link.targetCharacterId === head.id) consider(byId.get(link.subjectCharacterId), "client");
    else if (link.kind === "patron" && link.subjectCharacterId === head.id) consider(byId.get(link.targetCharacterId), "client");
  }
  // And the men of his own power, those of his own city first, who are free of office and of the army and have no sons to leave.
  const withChildren = new Set<string>();
  for (const link of world.familyLinks) if (link.endedAtStep === null && link.kind === "parent") withChildren.add(link.characterId);
  const serving = new Set<string>();
  for (const force of world.material.forces) { serving.add(force.commanderCharacterId); for (const member of force.memberCharacterIds) serving.add(member); }
  for (const person of world.characters) {
    if (person.polityId !== head.polityId || person.polityId === null) continue;
    if (person.ownerCharacterId !== null || person.prestigeBps > MAX_PRESTIGE_ADOPTED || withChildren.has(person.id) || serving.has(person.id)) continue;
    consider(person, "citizen");
  }
  return [...rank("steward"), ...rank("freedman"), ...rank("client"), ...rank("citizen")];
}

/** The name an adopted man bears: Rome gave him the head's nomen and cognomen with his own praenomen; elsewhere he is the head's son. */
function adoptedName(head: Character, own: Character, taken: ReadonlySet<string>): string {
  const roman = head.cultureId === "roman" || head.polityId === "rome";
  const ownFirst = own.name.split(" ")[0]!;
  const headWords = head.name.split(" ");
  const name = roman
    ? (headWords.length >= 3 ? `${ownFirst} ${headWords.slice(1).join(" ")}` : own.name)
    : `${ownFirst} son of ${headWords[0]!}`;
  // Two men of the same name in the world are told apart as the age did: the elder and the younger.
  for (const candidate of [name, `${name} the younger`, `${name} the third`]) if (candidate.length <= 120 && !taken.has(candidate)) return candidate;
  return own.name;
}

/** Put one house back into the economy's list. */
function withHouse(world: WorldState, house: MerchantHouse): WorldState {
  const memory = economyOf(world);
  return { ...world, economy: { ...memory, houses: memory.houses.map((entry) => (entry.id === house.id ? house : entry)) } };
}

/** The head names an heir: the one thing every branch ends in. */
function nameHeir(world: WorldState, headId: string, heirId: string): WorldState {
  return { ...world, characters: world.characters.map((character) => (character.id === headId ? { ...character, heirCharacterId: heirId } : character)) };
}

const noteOf = (world: WorldState, house: MerchantHouse, kind: string, toDay: number, summary: string, significance: number, refs: readonly string[]): FactProposalDraft[] => (
  isLiveProvince(world, house.homeProvinceId)
    ? [{
      localId: `${kind}_${house.id}_${toDay}`.slice(0, 60), kind, summary: summary.slice(0, 600),
      affectedRefs: [...refs.map((id) => ({ kind: "character" as const, id })), { kind: "province" as const, id: house.homeProvinceId }],
      visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance,
    }]
    : []
);

/**
 * The head takes the man as his son: the family graph, the social link, the contract of adoption, the name, the gift from his
 * purse, the end of any service the man was under, and the heir named. Returns the world and the gift's words.
 */
function adopt(world: WorldState, head: Character, adoptee: Character, standing: Standing, toDay: number, ids: IdFactory): WorldState {
  const names = new Set(world.characters.map((character) => character.name));
  const newName = adoptedName(head, adoptee, names);
  const rome = head.cultureId === "roman" || head.polityId === "rome";
  const purse = world.material.accounts.find((account) => account.id === head.personalAccountId);
  const gift = purse === undefined || purse.status !== "active" || purse.balance < GIFT_MIN * 8
    ? 0
    : clamp(Math.round((purse.balance * GIFT_BPS) / 10_000), GIFT_MIN, GIFT_MAX);
  const adopteePurse = world.material.accounts.find((account) => account.id === adoptee.personalAccountId);
  const paid = gift > 0 && adopteePurse !== undefined && adopteePurse.status === "active" && purse !== undefined;
  const transactions: MoneyTransaction[] = paid
    ? [{
      id: ids.next("txn"), atStep: toDay, kind: "transfer", amount: gift, sourceAccountId: purse!.id, destinationAccountId: adopteePurse!.id,
      cause: { kind: "action", id: boundedId("adoption", head.id, adoptee.id), explanation: `${head.name} gives ${newName} a son's portion on taking him as his heir.`.slice(0, 240) }, visibility: "private",
    }]
    : [];
  const ended = new Set(world.material.contracts
    .filter((contract) => contract.status === "active" && contract.employeeCharacterId === adoptee.id && contract.employerAccountId === head.personalAccountId)
    .map((contract) => contract.id));
  const endedPay = new Set(world.material.contracts.filter((contract) => ended.has(contract.id) && contract.obligationId !== null).map((contract) => contract.obligationId!));
  const alreadyKin = familyLinksOf(world, head.id).some((view) => view.counterpartCharacterId === adoptee.id && view.kind === "parent");
  return {
    ...world,
    characters: world.characters.map((character) => {
      if (character.id === head.id) return { ...character, heirCharacterId: adoptee.id };
      if (character.id !== adoptee.id) return character;
      return {
        ...character, name: newName, dynastyId: head.dynastyId ?? character.dynastyId, locationProvinceId: head.locationProvinceId,
        polityId: head.polityId ?? character.polityId, ownerCharacterId: standing === "freedman" ? null : character.ownerCharacterId,
        ...(rome ? { ordo: ordoOfRomanName(newName) } : {}),
      };
    }),
    familyLinks: alreadyKin ? world.familyLinks : [...world.familyLinks, {
      id: boundedId("family", adoptee.id, "adopted-by", head.id), characterId: head.id, relatedCharacterId: adoptee.id, kind: "parent" as const,
      startedAtStep: toDay, endedAtStep: null, visibility: "public" as const, provenanceEventId: null,
    }],
    socialLinks: [...world.socialLinks, {
      id: boundedId("social", head.id, "kin", adoptee.id, toDay), subjectCharacterId: head.id, targetCharacterId: adoptee.id, kind: "kin" as const,
      sourceEventId: null, createdAtStep: toDay, visibility: "public" as const,
    }],
    lifeContracts: [...world.lifeContracts, {
      id: boundedId("adoption", head.id, adoptee.id, toDay), type: "adoption_or_heir_designation" as const, partyCharacterIds: [head.id, adoptee.id], institutionId: null,
      eligibilityRequirementIds: [], status: "active" as const, visibility: "public" as const, startedAtStep: toDay, endedAtStep: null, sourceEventId: null,
      resolutionReason: `${head.name} adopts ${newName}, once ${standing === "citizen" ? "a man of the city" : `his ${standing}`}, to follow him in the house.`.slice(0, 400),
    }],
    material: {
      ...world.material,
      accounts: paid ? world.material.accounts.map((account) => (account.id === purse!.id ? { ...account, balance: account.balance - gift } : account.id === adopteePurse!.id ? { ...account, balance: account.balance + gift } : account)) : world.material.accounts,
      transactions: [...world.material.transactions, ...transactions],
      contracts: ended.size === 0 ? world.material.contracts : world.material.contracts.map((contract) => (ended.has(contract.id) ? { ...contract, status: "ended" as const, endsAtStep: toDay } : contract)),
      obligations: endedPay.size === 0 ? world.material.obligations : world.material.obligations.map((obligation) => (endedPay.has(obligation.id) ? { ...obligation, active: false } : obligation)),
    },
  };
}

const STANDING_WORDS: Record<Standing, string> = { steward: "who kept its books", freedman: "its freedman", client: "its client", citizen: "a man of the city" };

/** The one throw a year for a new man: in basis points, weighted by the house's capital and the head's standing. */
export function newManChanceBps(capital: number, head: Pick<Character, "prestigeBps">): number {
  return clamp(1_200 + Math.round(capital / 80) + Math.round(head.prestigeBps / 8), 500, 6_000);
}

/** What the house has working: the head's purse and what he has afloat. */
function capitalOf(world: WorldState, head: Character): number {
  const purse = world.material.accounts.find((account) => account.id === head.personalAccountId)?.balance ?? 0;
  const afloat = world.material.ventures.reduce((sum, venture) => (venture.ownerCharacterId === head.id && venture.status === "running" ? sum + (venture.cargo?.cost ?? 0) : sum), 0);
  return Math.max(0, purse) + afloat;
}

/** Bring in a new man: a factor found at the market, or a young man of another branch of the family. */
function aNewMan(world: WorldState, house: MerchantHouse, head: Character, toDay: number, ids: IdFactory): { world: WorldState; person: Character; kinsman: boolean } | null {
  const kinsman = stableHash([house.id, head.id, "new-man-kind", Math.floor(toDay / 365)]) % 100 >= 55;
  if (!kinsman) {
    const hired = hireAtThePlace(world, house.homeProvinceId, "factor", toDay, ids);
    if (hired === null) return null;
    const made = hired.world.characters.find((character) => character.id === hired.characterId)!;
    // Younger than the man who takes him, as an adopted son must be.
    const age = clamp(currentAgeYears(head, toDay) - 14, 21, 40);
    const fitted = { ...made, ageYearsAtStart: age, birthStep: toDay > 0 ? toDay - age * 365 : null, cultureId: head.cultureId, faithId: head.faithId, polityId: head.polityId ?? made.polityId, skills: { ...made.skills, stewardship: Math.max(made.skills.stewardship, 55) } };
    return { world: { ...hired.world, characters: hired.world.characters.map((character) => (character.id === made.id ? fitted : character)) }, person: fitted, kinsman: false };
  }
  const taken = new Set(world.characters.map((character) => character.name));
  const first = aNameFor(head.polityId ?? head.locationProvinceId, `kin-${house.id}-${toDay}`, taken).split(" ")[0]!;
  const roman = head.cultureId === "roman" || head.polityId === "rome";
  const headWords = head.name.split(" ");
  const name = roman && headWords.length >= 3 ? `${first} ${headWords.slice(1).join(" ")}` : `${first} son of ${headWords[0]!}`;
  const spread = (part: string, low: number, span: number): number => low + (stableHash([house.id, toDay, part]) % span);
  const made = createCanonicalNpc(world, {
    characterId: ids.next("character"), name: taken.has(name) ? `${name} the younger` : name.slice(0, 120), locationProvinceId: head.locationProvinceId, polityId: head.polityId,
    createdAtStep: toDay, creationReason: `A young man of another branch of the firm of ${head.name}, brought in to follow him.`.slice(0, 300),
    ageYearsAtStart: spread("age", 19, 6), cultureId: head.cultureId, faithId: head.faithId, dynastyId: head.dynastyId, prestigeBps: 1_800, startingMoney: KINSMAN_PURSE,
    skills: { martial: spread("martial", 25, 15), intrigue: spread("intrigue", 30, 20), learning: spread("learning", 40, 20), piety: spread("piety", 35, 20), stewardship: spread("stewardship", 55, 20), diplomacy: spread("diplomacy", 45, 20), body: spread("body", 45, 20), subSkills: {} },
  });
  if (made === null) return null;
  const person = made.character;
  return {
    world: {
      ...made.world,
      familyLinks: [...made.world.familyLinks, {
        id: boundedId("family", person.id, "other-branch", head.id), characterId: head.id, relatedCharacterId: person.id, kind: "other_relative" as const,
        startedAtStep: toDay, endedAtStep: null, visibility: "public" as const, provenanceEventId: null,
      }],
      characters: made.world.characters.map((character) => (character.id === person.id && roman ? { ...character, ordo: ordoOfRomanName(person.name) } : character)),
    },
    person,
    kinsman: true,
  };
}

/**
 * Look to the line of each house in `dueIds`: a head who has died is followed (by the heir he named, else the man the
 * estate went to, else the house is wound up), and a head with nobody named to follow him has one named (the order in the
 * header). Returns the world with the heirs named and the facts to tell.
 */
export function keepTheLine(start: WorldState, toDay: number, ids: IdFactory, dueIds: ReadonlySet<string>): LineKept {
  const facts: FactProposalDraft[] = [];
  let world = start;
  const houses = economyOf(world).houses.filter((house) => house.status === "trading" && dueIds.has(house.id));
  for (const first of houses) {
    let house = economyOf(world).houses.find((entry) => entry.id === first.id)!;
    let head = world.characters.find((character) => character.id === house.headCharacterId);

    // ── The head is dead: the heir he named, else whoever the estate went to, else the house is ended ──
    if (head === undefined || !head.alive) {
      const dead = head;
      const named = dead?.heirCharacterId == null ? undefined : world.characters.find((character) => character.id === dead.heirCharacterId);
      const inherited = dead === undefined ? undefined : (() => {
        const transfer = [...world.material.inheritanceTransfers].reverse().find((entry) => entry.deceasedCharacterId === dead.id && entry.beneficiaryCharacterId !== null && entry.assetKind === "account_balance");
        return transfer === undefined ? undefined : world.characters.find((character) => character.id === transfer.beneficiaryCharacterId);
      })();
      // An estate sold up to the creditors leaves no house to take: the heir who refused it takes the name and nothing else.
      const next = dead !== undefined && estateWasSoldUp(world, dead.id) ? undefined : [named, inherited].find((person) => person !== undefined && person.alive && person.legalStatus !== "enslaved");
      if (next === undefined) {
        house = { ...house, status: "wound_up" };
        world = withHouse(world, house);
        facts.push(...noteOf(world, house, "house_ends", toDay, `${house.name} is wound up: ${dead?.name ?? "its head"} is dead, and nobody of his line or his household takes the books; what he left goes to the treasury.`, 35, []));
        continue;
      }
      house = { ...house, headCharacterId: next.id, heirSoughtAtStep: null };
      world = withHouse(world, house);
      facts.push(...noteOf(world, house, "house_succeeds", toDay, `${next.name} takes up ${house.name} after ${dead?.name ?? "its head"}; the cargoes sail on.`, 32, [next.id]));
      head = next;
    }

    // ── The head lives: has he an heir who stands? ──
    if (heirStands(world, head)) {
      if (house.heirSoughtAtStep != null) world = withHouse(world, { ...house, heirSoughtAtStep: null });
      continue;
    }
    const spoken = spokenFor(world);
    const lost = head.heirCharacterId === null ? null : world.characters.find((character) => character.id === head!.heirCharacterId);
    const lament = lost === undefined || lost === null ? "" : ` ${lost.name}, whom he had named, ${lost.alive ? "is lost to him" : "is dead"}.`;

    // 1. a kinsman
    const kinsman = findKinsman(world, head, toDay, spoken);
    if (kinsman !== null) {
      world = nameHeir(world, head.id, kinsman.id);
      world = withHouse(world, { ...house, heirSoughtAtStep: null });
      facts.push(...noteOf(world, house, "house_heir_kin", toDay, `${head.name} names his kinsman ${kinsman.name} to follow him in ${house.name}.${lament}`, 30, [head.id, kinsman.id]));
      continue;
    }

    // 2. adoption: ask in turn, and each answers by his own nature
    const asked = candidatesForAdoption(world, head, toDay, spoken).slice(0, MAX_ASKED);
    const takers = asked.find(({ person, standing }) => stableHash([house.id, head!.id, person.id, "adopts"]) % 100 < clamp(willingness(person, head!, standing), 0, 100));
    if (takers !== undefined) {
      const oldName = takers.person.name;
      world = adopt(world, head, takers.person, takers.standing, toDay, ids);
      world = withHouse(world, { ...house, heirSoughtAtStep: null });
      const adopted = world.characters.find((character) => character.id === takers.person.id)!;
      facts.push(...noteOf(world, house, "house_heir_adopted", toDay, `${head.name} has no son to follow him, and adopts ${oldName} (${STANDING_WORDS[takers.standing]}), who is now ${adopted.name}, heir of ${house.name}.${lament}`, 32, [head.id, adopted.id]));
      continue;
    }

    // 3. a new man, rarely, and only once the head has gone a while unfollowed
    const since = house.heirSoughtAtStep ?? toDay;
    if (house.heirSoughtAtStep == null) {
      house = { ...house, heirSoughtAtStep: toDay };
      world = withHouse(world, house);
    }
    if (toDay - since < NEW_MAN_AFTER_DAYS) continue;
    const chance = newManChanceBps(capitalOf(world, head), head);
    if (stableHash([house.id, head.id, "new-man", Math.floor(toDay / 365)]) % 10_000 >= chance) continue;
    const made = aNewMan(world, house, head, toDay, ids);
    if (made === null) continue;
    world = made.world;
    if (made.kinsman) world = nameHeir(world, head.id, made.person.id);
    else world = adopt(world, head, made.person, "citizen", toDay, ids);
    world = withHouse(world, { ...house, heirSoughtAtStep: null });
    const heir = world.characters.find((character) => character.id === made.person.id)!;
    facts.push(...noteOf(world, house, "house_heir_found", toDay, made.kinsman
      ? `${head.name} has nobody of his line near, and sends for ${heir.name}, a young man of another branch of the family, to follow him in ${house.name}.`
      : `${head.name} has nobody of his line or household, and takes up ${heir.name}, a factor found in the market, as his son and heir in ${house.name}.`, 34, [head.id, heir.id]));
  }
  return { world, facts };
}
