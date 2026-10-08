import { boundedId, computeOpinion, currentAgeYears, economyOf, familyLinksOf, isLiveProvince, stableHash, type Character, type FactProposalDraft, type MerchantHouse, type MoneyTransaction, type WorldState } from "@chronica/shared";
import { ADULT_AGE, MAX_CHOSEN_AGE, MIN_FIT_ADOPTED, MIN_HONESTY, kinOf, merchantFit } from "./house-succession";
import type { IdFactory } from "./ports";
import { safeLocalId } from "./safe-local-id";

/**
 * A minor heir under a tutor (docs/economy.md, "Who follows the head"; docs/plans/government.md, "Offices and data gaps closed").
 *
 * A boy who has the house from his father is a head in name. At Rome a fatherless child under age was in *tutela*: his father's will named a *tutor*, else the
 * nearest of his father's kin (his agnates) had it by statute, else the praetor gave him one (the *tutor dativus*); at Athens and in the other Greek cities the
 * orphan's property went to his *epitropos*, named in the will or by the kin, and the archon looked to it (Demosthenes' speeches against Aphobus tell what a
 * dishonest one could do with ten years of an orphan's estate). Carthage's custom is not known, and is read as the Greeks'. Confidence: Rome and Athens high; the age
 * a ward comes of age at is a simplification, eighteen for all (Rome ended *tutela* at fourteen for boys and then put a *curator* over a minor's business till twenty-five).
 *
 * So: a house whose head is under `ADULT_AGE` has a tutor. In order: a man who is already guardian to him by the family graph; the nearest of his kin who is of age, honest
 * and in good terms with the dead head (the will's choice, as the age had it); one of the dead head's household (the steward who kept his books, a freedman, a client);
 * and failing all of them a man of the city fit for the work, named by its magistrate. The man is linked to the boy as his guardian (`FamilyLink` kind
 * `guardian`, the ward the other way), and the house is his to keep until the boy comes of age. A tutor who dies, or is lost to the house, is replaced the same way. When the
 * heir comes of age the link ends and the tutor gives account: an honest man's books are clean; one who is greedy and not honest may have made away with a share of the
 * ward's purse (up to eight in a hundred), which he is made to give back, and the books show it.
 *
 * Deterministic: `stableHash` only, no model call.
 */

/** The share of a ward's purse a dishonest tutor has taken by the time the ward comes of age, at most. */
export const TUTOR_SKIM_MAX_BPS = 800;
const SKIM_ODDS_PERCENT = 40;
const MAX_TUTOR_AGE = MAX_CHOSEN_AGE + 12;

/** What the age called the keeper of an orphan's estate, by the head's own people. */
export function tutorWord(head: Pick<Character, "cultureId" | "polityId">): string {
  if (head.cultureId === "roman" || head.polityId === "rome") return "tutor";
  if (head.cultureId === "greek") return "epitropos";
  return "guardian";
}

const free = (person: Character): boolean => person.alive && person.legalStatus !== "enslaved" && person.disqualifyingStatuses.length === 0;

/** Whether a living man may keep a house for a ward: free, a man, of age, not too old to see it through, of the ward's power. */
function mayTutor(person: Character, ward: Character, toDay: number): boolean {
  if (!free(person) || person.id === ward.id || person.gender !== "male") return false;
  if (person.polityId !== null && ward.polityId !== null && person.polityId !== ward.polityId) return false;
  const age = currentAgeYears(person, toDay);
  return age >= ADULT_AGE && age <= MAX_TUTOR_AGE;
}

/** The man already guardian to the ward in the family graph, if one lives and may serve. */
function guardianOf(world: WorldState, ward: Character, toDay: number): Character | undefined {
  for (const view of familyLinksOf(world, ward.id)) {
    if (view.kind !== "ward") continue;
    const person = world.characters.find((character) => character.id === view.counterpartCharacterId);
    if (person !== undefined && mayTutor(person, ward, toDay)) return person;
  }
  return undefined;
}

/** Who keeps the house for the ward, and how he came to it; null where there is nobody to be had. */
export function chooseTutor(world: WorldState, house: MerchantHouse, ward: Character, toDay: number): { person: Character; how: "named" | "kin" | "household" | "magistrate" } | null {
  const existing = guardianOf(world, ward, toDay);
  if (existing !== undefined) return { person: existing, how: "named" };
  // The dead head's own blood and household: the man the ward had the house from.
  const former = world.characters.find((character) => character.heirCharacterId === ward.id && character.id !== ward.id && !character.alive);
  const honest = (person: Character): boolean => person.mind.temperament.honesty >= MIN_HONESTY;
  const byFit = (a: Character, b: Character): number => merchantFit(b) - merchantFit(a) || a.id.localeCompare(b.id);
  const taken = new Set(economyOf(world).houses.filter((entry) => entry.status === "trading" && entry.id !== house.id).map((entry) => entry.tutorCharacterId).filter((id): id is string => id != null));
  if (former !== undefined) {
    const kin = kinOf(world, former);
    const near = world.characters
      .filter((person) => kin.has(person.id) && mayTutor(person, ward, toDay) && honest(person) && computeOpinion(former, person.id) > -25 && !taken.has(person.id))
      .sort((a, b) => kin.get(a.id)! - kin.get(b.id)! || byFit(a, b))[0];
    if (near !== undefined) return { person: near, how: "kin" };
    const byId = new Map(world.characters.map((character) => [character.id, character]));
    const household: Character[] = [];
    const consider = (person: Character | undefined): void => { if (person !== undefined && !household.includes(person) && mayTutor(person, ward, toDay) && honest(person) && !taken.has(person.id)) household.push(person); };
    for (const contract of world.material.contracts) {
      if (contract.status === "active" && (contract.role === "steward" || contract.role === "agent") && contract.employerAccountId === former.personalAccountId) consider(byId.get(contract.employeeCharacterId));
    }
    for (const person of world.characters) if (person.ownerCharacterId === former.id && person.legalStatus === "freed") consider(person);
    for (const link of world.socialLinks) {
      if (link.kind === "client" && link.targetCharacterId === former.id) consider(byId.get(link.subjectCharacterId));
      else if (link.kind === "patron" && link.subjectCharacterId === former.id) consider(byId.get(link.targetCharacterId));
    }
    const kept = household.sort(byFit)[0];
    if (kept !== undefined) return { person: kept, how: "household" };
  }
  // The magistrate names a man of the city fit for it: one of the best three, by a throw fixed by the ward.
  const serving = new Set<string>();
  for (const force of world.material.forces) { serving.add(force.commanderCharacterId); for (const member of force.memberCharacterIds) serving.add(member); }
  const pool = world.characters
    .filter((person) => person.polityId !== null && person.polityId === ward.polityId && person.officeId === null && person.ownerCharacterId === null && !serving.has(person.id)
      && mayTutor(person, ward, toDay) && honest(person) && merchantFit(person) >= MIN_FIT_ADOPTED && !taken.has(person.id))
    .sort(byFit).slice(0, 3);
  if (pool.length === 0) return null;
  return { person: pool[stableHash([house.id, ward.id, "tutor"]) % pool.length]!, how: "magistrate" };
}

const noteOf = (world: WorldState, house: MerchantHouse, kind: string, toDay: number, summary: string, significance: number, refs: readonly string[]): FactProposalDraft[] => (
  isLiveProvince(world, house.homeProvinceId)
    ? [{
      localId: safeLocalId(`${kind}_${house.id}_${toDay}`).slice(0, 60), kind, summary: summary.slice(0, 600),
      affectedRefs: [...refs.map((id) => ({ kind: "character" as const, id })), { kind: "province" as const, id: house.homeProvinceId }],
      visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance,
    }]
    : []
);

const withHouse = (world: WorldState, house: MerchantHouse): WorldState => {
  const memory = economyOf(world);
  return { ...world, economy: { ...memory, houses: memory.houses.map((entry) => (entry.id === house.id ? house : entry)) } };
};

/** What a tutor owes a ward at the end: the share he made away with, if he is the kind, and the books say so. */
export function skimOf(house: Pick<MerchantHouse, "id">, tutor: Character, ward: Character, purseBalance: number): number {
  if (tutor.mind.temperament.honesty >= 40 || tutor.mind.drives.wealth < 60) return 0;
  if (stableHash([house.id, tutor.id, ward.id, "tutor-accounts"]) % 100 >= SKIM_ODDS_PERCENT) return 0;
  const share = 200 + (stableHash([house.id, tutor.id, "tutor-share"]) % (TUTOR_SKIM_MAX_BPS - 200 + 1));
  return Math.max(0, Math.round((purseBalance * share) / 10_000));
}

/**
 * Look to the tutelage of each house in `dueIds`: a head under age has a tutor, and one who has come of age has his books given up to him. Returns the world and the facts.
 */
export function keepTheTutelage(start: WorldState, toDay: number, ids: IdFactory, dueIds: ReadonlySet<string>): { world: WorldState; facts: FactProposalDraft[] } {
  let world = start;
  const facts: FactProposalDraft[] = [];
  for (const first of economyOf(world).houses.filter((house) => house.status === "trading" && dueIds.has(house.id))) {
    const house = economyOf(world).houses.find((entry) => entry.id === first.id)!;
    const head = world.characters.find((character) => character.id === house.headCharacterId);
    if (head === undefined || !head.alive) continue;
    const tutorId = house.tutorCharacterId ?? null;
    const tutor = tutorId === null ? undefined : world.characters.find((character) => character.id === tutorId);

    // ── The head is of age: a tutor's books are given up, and the link ends ──
    if (currentAgeYears(head, toDay) >= ADULT_AGE) {
      if (tutorId === null) continue;
      world = withHouse(world, { ...house, tutorCharacterId: null });
      world = { ...world, familyLinks: world.familyLinks.map((link) => (link.kind === "guardian" && link.characterId === tutorId && link.relatedCharacterId === head.id && link.endedAtStep === null ? { ...link, endedAtStep: toDay } : link)) };
      const word = tutorWord(head);
      let said = `${head.name} comes of age and takes up ${house.name} from his ${word}${tutor === undefined ? "" : ` ${tutor.name}`}; the books are given up.`;
      const purse = world.material.accounts.find((account) => account.id === head.personalAccountId);
      const tutorPurse = tutor === undefined ? undefined : world.material.accounts.find((account) => account.id === tutor.personalAccountId);
      const owed = tutor === undefined || purse === undefined || tutorPurse === undefined || purse.status !== "active" || tutorPurse.status !== "active" ? 0 : Math.min(tutorPurse.balance, skimOf(house, tutor, head, purse.balance));
      if (owed > 0 && purse !== undefined && tutorPurse !== undefined && tutor !== undefined) {
        const repayment: MoneyTransaction = {
          id: ids.next("txn"), atStep: toDay, kind: "transfer", amount: owed, sourceAccountId: tutorPurse.id, destinationAccountId: purse.id,
          cause: { kind: "action", id: boundedId("tutelage", house.id, head.id), explanation: `${tutor.name} makes good what he took from his ward ${head.name}'s estate when the books are given up.`.slice(0, 240) }, visibility: "private",
        };
        world = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === tutorPurse.id ? { ...account, balance: account.balance - owed } : account.id === purse.id ? { ...account, balance: account.balance + owed } : account)), transactions: [...world.material.transactions, repayment] } };
        said = `${head.name} comes of age and takes up ${house.name} from his ${word} ${tutor.name}; the books show ${owed} made away with, and the ${word} makes it good.`;
      }
      facts.push(...noteOf(world, house, "house_comes_of_age", toDay, said, 32, tutor === undefined ? [head.id] : [head.id, tutor.id]));
      continue;
    }

    // ── The head is under age: he has a tutor who lives and may serve, or one is found ──
    if (tutor !== undefined && mayTutor(tutor, head, toDay)) continue;
    const chosen = chooseTutor(world, house, head, toDay);
    if (chosen === null) {
      if (tutorId !== null) world = withHouse(world, { ...house, tutorCharacterId: null });
      continue;
    }
    const word = tutorWord(head);
    const alreadyLinked = world.familyLinks.some((link) => link.kind === "guardian" && link.characterId === chosen.person.id && link.relatedCharacterId === head.id && link.endedAtStep === null);
    world = withHouse(world, { ...house, tutorCharacterId: chosen.person.id });
    if (!alreadyLinked) {
      world = { ...world, familyLinks: [...world.familyLinks, { id: boundedId("family", chosen.person.id, "guardian-of", head.id), characterId: chosen.person.id, relatedCharacterId: head.id, kind: "guardian" as const, startedAtStep: toDay, endedAtStep: null, visibility: "public" as const, provenanceEventId: null }] };
    }
    const how = chosen.how === "named" ? "who was already his guardian" : chosen.how === "kin" ? "the nearest of his kin" : chosen.how === "household" ? "of the dead man's household" : "named by the magistrate";
    facts.push(...noteOf(world, house, "house_tutor_named", toDay, `${head.name} is under age, and ${chosen.person.name} (${how}) keeps ${house.name} for him as his ${word} until he comes of age.`, 31, [head.id, chosen.person.id]));
  }
  return { world, facts };
}
