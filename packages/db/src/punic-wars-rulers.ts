import { PUNIC_IDS } from "./punic-ids";
import { aNameFor, cultureOf, inferredGovernmentForm, spreadSubSkills, stableHash, type Culture, type GovernmentForm } from "@chronica/shared";

/**
 * Somebody in every chair on the first day (scenario v34).
 *
 * Five powers were written out with their people and a hundred and twenty-seven
 * were not. Each of those grew a constitution with its throne empty, so the
 * first man the world made for it -- named after his title, "Umbrian council
 * chief", "Thames Basin war chief" -- called an election for ruler and another
 * for commander of horse on the same morning, and a consul in Rome read about
 * the Aquitani choosing a First Chief. A power begins with its ruler in his
 * seat, a man with a name, and a league with its commander of horse beside him.
 *
 * Where history names the man who ruled in 270 he is that man. Everywhere else
 * the name is drawn, stably, from what his people called their sons.
 */

interface PolityInput {
  readonly id: string;
  readonly name: string;
  readonly capitalSettlementId: string | null;
  readonly cohesionBps: number;
  readonly governmentForm?: GovernmentForm | null;
}

interface ProvinceInput {
  readonly id: string;
  readonly controllerPolityId: string | null;
  readonly settlements: readonly { readonly id: string }[];
  readonly areaKm2?: number;
}

/** The man history says ruled there in 270 BCE, with his age that year. */
const KNOWN: Readonly<Record<string, { readonly name: string; readonly age: number; readonly martial?: number; readonly diplomacy?: number }>> = {
  // Beat the Gauls at Lysimachia and took Macedon back; patient, and a soldier.
  macedon: { name: "Antigonus Gonatas", age: 49, martial: 72, diplomacy: 65 },
  epirus: { name: "Alexander II of Epirus", age: 25, martial: 58 },
  sparta: { name: "Areus I", age: 39, martial: 60 },
  cyrene: { name: "Magas of Cyrene", age: 47, martial: 55, diplomacy: 60 },
  athens: { name: "Chremonides", age: 40 },
  "illyria-ardiaei": { name: "Pleuratus", age: 45 },
  "numidian-kingdoms": { name: "Zelalsan", age: 50 },
  // Anatolia (docs/anatolia-270-bce.md): the rulers the sources give with confidence.
  "seleucid-empire": { name: "Antiochus I Soter", age: 52, martial: 65, diplomacy: 60 },
  "ptolemaic-egypt": { name: "Ptolemy II Philadelphus", age: 39, diplomacy: 70 },
  pergamon: { name: "Philetaerus", age: 73, diplomacy: 65 },
  bithynia: { name: "Nicomedes I", age: 45, martial: 60 },
  // First king of Kartli (Iberia of the Caucasus), c. 302-237 by the Georgian Chronicles: medium confidence, and a late source.
  "caucasian-iberia": { name: "Pharnavaz I", age: 55, martial: 62 },
  pontus: { name: "Mithridates I Ktistes", age: 55, martial: 60 },
};

/** The faith each culture's people keep, where the scenario has one for them. */
const FAITH: Partial<Record<Culture, string>> = { italic: "faith-italic", etruscan: "faith-italic", greek: "faith-greek", libyan: "faith-punic" };

/** The office a power's head sits in, by the constitution it grows (`sim/constitutions.ts`). */
function headOffice(form: GovernmentForm): string {
  if (form === "oligarchic_republic") return "magistrate";
  if (form === "popular_republic") return "general";
  return "ruler";
}

export interface FoundingPeople {
  readonly characters: readonly Record<string, unknown>[];
  readonly accounts: readonly Record<string, unknown>[];
  readonly officeSeats: readonly Record<string, unknown>[];
}

/**
 * The ruler of every power not written out by hand, and a league's commander of
 * horse, seated in the constitution's own offices (`<polity>:ruler` and so on,
 * the ids `ensureConstitutions` gives them). Their terms start today; the
 * constitution's term runs from there.
 */
export function foundingPeople(
  polities: readonly PolityInput[],
  provinces: readonly ProvinceInput[],
  writtenOut: ReadonlySet<string>,
  formOf: (polityId: string) => GovernmentForm | null,
): FoundingPeople {
  const characters: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  const officeSeats: Record<string, unknown>[] = [];
  const used = new Set<string>();
  const nameFor = (polityId: string, role: string): string => aNameFor(polityId, role, used);

  for (const polity of polities) {
    if (writtenOut.has(polity.id)) continue;
    const held = provinces.filter((province) => province.controllerPolityId === polity.id);
    if (held.length === 0) continue;
    // At the capital's province, else on the largest ground it holds.
    const home = held.find((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId))
      ?? held.reduce((largest, province) => ((province.areaKm2 ?? 0) > (largest.areaKm2 ?? 0) ? province : largest));
    const form = formOf(polity.id) ?? inferredGovernmentForm(polity);
    const culture = cultureOf(polity.id);
    const posts: { key: string; role: string }[] = [{ key: headOffice(form), role: "ruler" }];
    if (form === "league") posts.push({ key: "hipparch", role: "hipparch" });

    for (const post of posts) {
      const known = post.role === "ruler" ? KNOWN[polity.id] : undefined;
      const name = known?.name ?? nameFor(polity.id, post.role);
      used.add(name);
      const id = `${polity.id}-${post.role}-${stableHash([polity.id, post.role, name]).toString(36).slice(0, 6)}`;
      const officeId = `${polity.id}:${post.key}`;
      const age = known?.age ?? 32 + (stableHash([id, "age"]) % 28);
      const martial = known?.martial ?? (post.role === "hipparch" ? 60 + (stableHash([id, "martial"]) % 20) : 40 + (stableHash([id, "martial"]) % 30));
      characters.push({
        id, name, cultureId: culture, faithId: FAITH[culture] ?? null, dynastyId: null,
        locationProvinceId: home.id, polityId: polity.id, ageYearsAtStart: age, officeId, personalAccountId: `${id}-purse`,
        skills: { martial, intrigue: 35 + (stableHash([id, "intrigue"]) % 30), learning: 30 + (stableHash([id, "learning"]) % 30), piety: 35 + (stableHash([id, "piety"]) % 30), stewardship: 40 + (stableHash([id, "stewardship"]) % 25), diplomacy: known?.diplomacy ?? 40 + (stableHash([id, "diplomacy"]) % 30), body: 50 + (stableHash([id, "body"]) % 25), subSkills: {} },
        traits: [], healthBps: 8_500, prestigeBps: post.role === "ruler" ? 6_500 : 5_500,
        relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null,
      });
      accounts.push({ id: `${id}-purse`, owner: { kind: "character", id }, currencyId: "drachma", balance: post.role === "ruler" ? 1_200 : 500, status: "active", visibility: "private" });
      officeSeats.push({
        id: `${officeId}:seat:0`, officeId, seatIndex: 0, holderCharacterId: id, status: "held", vacancyCause: "none",
        termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null,
        eligibilityRequirementIds: ["req-alive", "req-not-disqualified", `req-${polity.id}-polity`],
      });
    }
  }
  return { characters, accounts, officeSeats };
}

/** A man named after his title, the way the world named the people it made in a hurry. */
const PLACEHOLDER = /\b(chief|chieftain|leader|spokesman|headman|war-?king|council)\b/i;

export interface SeatingReport {
  readonly seated: readonly string[];
  readonly renamed: readonly string[];
  readonly created: readonly string[];
}

/**
 * The same seating for a game already under way (the v34 migration of a save).
 *
 * Every power that holds ground has its head of state -- and a league its
 * commander of horse -- in the chair: a seat somebody living holds is left as
 * it is; an empty one goes to the most eminent man the power already has, or to
 * the founding ruler `foundingPeople` names, made for it. Anybody still called
 * by his title is given a name, and keeps his id and everything he has done.
 */
export function seatFoundingPeopleInto<W extends {
  readonly elapsedStep: number;
  readonly map: { readonly polities: readonly PolityInput[]; readonly provinces: readonly ProvinceInput[] };
  readonly characters: readonly { readonly id: string; readonly name: string; readonly polityId: string | null; readonly alive: boolean; readonly prestigeBps: number; readonly officeId: string | null }[];
  readonly material: {
    readonly accounts: readonly unknown[];
    readonly officeSeats: readonly { readonly id: string; readonly officeId: string; readonly status: string; readonly holderCharacterId: string | null }[];
  };
}>(world: W, writtenOut: ReadonlySet<string>, formOf: (polityId: string) => GovernmentForm | null): { readonly world: W; readonly report: SeatingReport } {
  const founding = foundingPeople(world.map.polities, world.map.provinces, writtenOut, formOf);
  const seated: string[] = [];
  const renamed: string[] = [];
  const created: string[] = [];
  let characters = [...world.characters] as W["characters"][number][];
  const accounts = [...world.material.accounts];
  let seats = [...world.material.officeSeats] as W["material"]["officeSeats"][number][];
  // Men already in a power's head chair or its commander's -- those `foundingPeople`
  // plans -- are not seated in the other; a makeshift office the world made for
  // a man does not keep him from his real one.
  const posts = new Set((founding.officeSeats as readonly { officeId: string }[]).map((seat) => seat.officeId));
  const taken = new Set(seats.filter((seat) => posts.has(seat.officeId) && seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!));
  const names = new Set(characters.map((character) => character.name));

  for (const seat of founding.officeSeats as readonly { id: string; officeId: string; holderCharacterId: string }[]) {
    const polityId = seat.officeId.split(":")[0]!;
    const planned = (founding.characters as readonly { id: string; name: string }[]).find((character) => character.id === seat.holderCharacterId)!;
    const alive = (id: string | null) => id !== null && characters.some((character) => character.id === id && character.alive);
    const held = seats.find((candidate) => candidate.officeId === seat.officeId && candidate.status === "held" && alive(candidate.holderCharacterId));
    let holderId = held?.holderCharacterId ?? null;
    if (holderId === null) {
      const eminent = characters
        .filter((character) => character.polityId === polityId && character.alive && !taken.has(character.id))
        .sort((a, b) => b.prestigeBps - a.prestigeBps)[0];
      if (eminent !== undefined) {
        holderId = eminent.id;
      } else {
        const made = (founding.characters).find((character) => character.id === planned.id)!;
        characters = [...characters, { ...made, name: names.has(planned.name) ? `${planned.name} of ${polityId}` : planned.name } as unknown as W["characters"][number]];
        accounts.push((founding.accounts as readonly { id: string }[]).find((account) => account.id === `${planned.id}-purse`)!);
        names.add(planned.name);
        holderId = planned.id;
        created.push(`${polityId}: ${planned.name}`);
      }
      const existing = seats.find((candidate) => candidate.officeId === seat.officeId);
      seats = existing === undefined
        ? [...seats, { ...seat, holderCharacterId: holderId, termStartedAtStep: world.elapsedStep } as unknown as W["material"]["officeSeats"][number]]
        : seats.map((candidate) => (candidate === existing
          ? { ...candidate, holderCharacterId: holderId, status: "held", vacancyCause: "none", termStartedAtStep: world.elapsedStep, termExpiresAtStep: null }
          : candidate));
      taken.add(holderId);
      seated.push(`${seat.officeId} <- ${characters.find((character) => character.id === holderId)!.name}`);
    }
    const holder = characters.find((character) => character.id === holderId)!;
    if (PLACEHOLDER.test(holder.name) && !names.has(planned.name)) {
      renamed.push(`${holder.name} -> ${planned.name}`);
      names.add(planned.name);
      characters = characters.map((character) => (character.id === holderId ? { ...character, name: planned.name } : character));
    }
    characters = characters.map((character) => (character.id === holderId ? { ...character, officeId: seat.officeId } : character));
  }

  // Anybody else of a seated power still called by his title.
  for (const character of characters) {
    if (!character.alive || character.polityId === null || writtenOut.has(character.polityId) || !PLACEHOLDER.test(character.name)) continue;
    const name = aNameFor(character.polityId, `renamed-${character.id}`, names);
    renamed.push(`${character.name} -> ${name}`);
    names.add(name);
    characters = characters.map((candidate) => (candidate.id === character.id ? { ...candidate, name } : candidate));
  }

  return {
    world: { ...world, characters, material: { ...world.material, accounts, officeSeats: seats } },
    report: { seated, renamed, created },
  };
}

/**
 * The Senate of 270, as far as it has names (scenario v34).
 *
 * Rome's Senate was the consul, his colleague, Dentatus and Ogulnius: a house
 * of three hundred with four men in it who could speak, one of them sick. So in
 * a whole campaign one senator ever took a side, and no debate had anybody to
 * hold it. These are the consulars and great men of the 270s, with the temper
 * the sources give them, seated in the house.
 */
const SENATORS: readonly {
  readonly id: string; readonly name: string; readonly age: number; readonly prestige: number;
  readonly offices: readonly string[]; readonly skills: Readonly<Record<string, number>>;
  readonly temperament: Readonly<Record<string, number>>; readonly drives: Readonly<Record<string, number>>;
  readonly traits: readonly string[]; readonly values: readonly string[];
}[] = [
  // Consul 282 and 278, censor 275: the incorruptible plebeian who would not take Pyrrhus's gold, and struck a consular off the rolls for owning ten pounds of silver plate.
  { id: "gaius-fabricius", name: "Gaius Fabricius Luscinus", age: 58, prestige: 9_200, offices: ["roman-quaestor", "roman-praetor", "roman-consul", "roman-censor"],
    skills: { martial: 70, intrigue: 20, learning: 45, piety: 60, stewardship: 65, diplomacy: 60, body: 55 }, temperament: { boldness: 55, caution: 55, honesty: 95, sociability: 45, discipline: 85, cruelty: 25 },
    drives: { security: 45, status: 40, wealth: 5, family: 40, faith: 55, duty: 95, revenge: 15 }, traits: ["dutiful", "disciplined"], values: ["dutiful"] },
  // Consul 280; the first plebeian to become pontifex maximus, and the first to teach the law in public.
  { id: "tiberius-coruncanius", name: "Tiberius Coruncanius", age: 50, prestige: 8_600, offices: ["roman-quaestor", "roman-praetor", "roman-consul"],
    skills: { martial: 55, intrigue: 40, learning: 85, piety: 85, stewardship: 60, diplomacy: 65, body: 45 }, temperament: { boldness: 45, caution: 60, honesty: 80, sociability: 60, discipline: 70, cruelty: 20 },
    drives: { security: 50, status: 55, wealth: 25, family: 45, faith: 85, duty: 75, revenge: 10 }, traits: ["cautious", "dutiful"], values: ["pious"] },
  // Consul 293 and 272: took Tarentum's surrender two years ago; a patrician of the old school, and his father's son.
  { id: "lucius-papirius", name: "Lucius Papirius Cursor", age: 52, prestige: 8_800, offices: ["roman-quaestor", "roman-praetor", "roman-consul"],
    skills: { martial: 78, intrigue: 45, learning: 45, piety: 55, stewardship: 55, diplomacy: 50, body: 65 }, temperament: { boldness: 75, caution: 40, honesty: 60, sociability: 40, discipline: 80, cruelty: 50 },
    drives: { security: 40, status: 75, wealth: 40, family: 60, faith: 50, duty: 70, revenge: 35 }, traits: ["bold", "ambitious"], values: ["glory"] },
  // Consul 293 and 272, Papirius's colleague at Tarentum; a plebeian who built a temple to Fors Fortuna from the Samnite spoils.
  { id: "spurius-carvilius", name: "Spurius Carvilius Maximus", age: 56, prestige: 8_400, offices: ["roman-quaestor", "roman-praetor", "roman-consul"],
    skills: { martial: 72, intrigue: 45, learning: 40, piety: 60, stewardship: 60, diplomacy: 55, body: 55 }, temperament: { boldness: 60, caution: 50, honesty: 65, sociability: 60, discipline: 65, cruelty: 30 },
    drives: { security: 50, status: 60, wealth: 50, family: 50, faith: 60, duty: 65, revenge: 20 }, traits: ["sociable", "dutiful"], values: [] },
  // Consul 292 and 276: the Fabius who was nearly disgraced by the Samnites and saved by his father; patrician, and patient.
  { id: "quintus-fabius", name: "Quintus Fabius Maximus Gurges", age: 50, prestige: 8_700, offices: ["roman-quaestor", "roman-praetor", "roman-consul"],
    skills: { martial: 62, intrigue: 55, learning: 50, piety: 60, stewardship: 60, diplomacy: 60, body: 50 }, temperament: { boldness: 45, caution: 65, honesty: 60, sociability: 55, discipline: 70, cruelty: 30 },
    drives: { security: 60, status: 70, wealth: 45, family: 80, faith: 55, duty: 70, revenge: 25 }, traits: ["cautious", "ambitious"], values: ["family"] },
  // Three times consul (305, 294, 291), fined for using his soldiers on his own estate; the proudest patrician in the house, and the most hated.
  { id: "lucius-postumius", name: "Lucius Postumius Megellus", age: 64, prestige: 8_300, offices: ["roman-quaestor", "roman-praetor", "roman-consul"],
    skills: { martial: 70, intrigue: 60, learning: 40, piety: 40, stewardship: 50, diplomacy: 30, body: 45 }, temperament: { boldness: 80, caution: 30, honesty: 35, sociability: 25, discipline: 55, cruelty: 70 },
    drives: { security: 40, status: 90, wealth: 70, family: 55, faith: 35, duty: 40, revenge: 60 }, traits: ["ambitious", "cruel"], values: ["glory"] },
  // Consul 280, beaten by Pyrrhus at Heraclea; he has not been allowed to forget it.
  { id: "publius-valerius", name: "Publius Valerius Laevinus", age: 52, prestige: 7_800, offices: ["roman-quaestor", "roman-praetor", "roman-consul"],
    skills: { martial: 58, intrigue: 45, learning: 50, piety: 55, stewardship: 55, diplomacy: 55, body: 55 }, temperament: { boldness: 55, caution: 55, honesty: 65, sociability: 55, discipline: 60, cruelty: 30 },
    drives: { security: 50, status: 70, wealth: 45, family: 55, faith: 50, duty: 65, revenge: 45 }, traits: ["ambitious"], values: [] },
  // Consul 285 and 273; a Claudius, of the house that built the Appian Way and never let anybody forget it.
  { id: "gaius-claudius", name: "Gaius Claudius Canina", age: 50, prestige: 8_000, offices: ["roman-quaestor", "roman-praetor", "roman-consul"],
    skills: { martial: 60, intrigue: 60, learning: 55, piety: 50, stewardship: 60, diplomacy: 55, body: 50 }, temperament: { boldness: 60, caution: 50, honesty: 50, sociability: 45, discipline: 65, cruelty: 40 },
    drives: { security: 45, status: 80, wealth: 55, family: 75, faith: 45, duty: 55, revenge: 35 }, traits: ["ambitious", "disciplined"], values: ["family"] },
];

/** The named senators of 270, with purses and seats in the house from `firstSeatIndex` on. */
export function romanSenators(firstSeatIndex: number): FoundingPeople {
  return {
    characters: SENATORS.map((senator) => ({
      id: senator.id, name: senator.name, cultureId: "roman", faithId: "faith-roman", dynastyId: null,
      locationProvinceId: PUNIC_IDS.rome, polityId: "rome", ageYearsAtStart: senator.age, officeId: null, personalAccountId: `${senator.id}-purse`,
      officesHeld: senator.offices.map((officeId) => ({ officeId, lastHeldAtStep: 0 })),
      skills: { ...senator.skills, subSkills: {} }, traits: [...senator.traits],
      mind: { drives: senator.drives, temperament: senator.temperament, riskTolerance: senator.temperament.boldness ?? 50, values: [...senator.values], taboos: [], currentPressures: [] },
      healthBps: 8_000, prestigeBps: senator.prestige, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null,
    })),
    accounts: SENATORS.map((senator) => ({ id: `${senator.id}-purse`, owner: { kind: "character", id: senator.id }, currencyId: "drachma", balance: 800, status: "active", visibility: "private" })),
    officeSeats: SENATORS.map((senator, index) => ({
      id: `roman-senator:seat:${firstSeatIndex + index}`, officeId: "roman-senator", seatIndex: firstSeatIndex + index, holderCharacterId: senator.id,
      status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
    })),
  };
}

/**
 * What the sources say each man was good at, finer than his skills. Everybody
 * else is given a spread around his skills (`spreadSubSkills`).
 */
export const GIFTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "gnaeus-cornelius": { logistics: 70, arbitration: 65 },
  "manius-curius": { strategist: 85, authority: 88, endurance: 75, devotion: 70, manipulation: 20 },
  "quintus-ogulnius": { taxation: 72, scholarship: 60 },
  "hieron-ii": { arbitration: 82, taxation: 80, strategist: 70, manipulation: 60 },
  "leptines-syracuse": { logistics: 70, taxation: 65 },
  "hanno-carthage": { logistics: 72, strategist: 55, arbitration: 40 },
  "hannibal-gisco": { strategist: 70, logistics: 65 },
  "mamertine-spokesman": { authority: 72, rhetoric: 60, prowess: 70 },
  "decius-vibellius": { authority: 70, manipulation: 60, prowess: 72 },
  "gaius-fabricius": { arbitration: 85, rhetoric: 70, authority: 80, manipulation: 15 },
  "tiberius-coruncanius": { theology: 92, scholarship: 85, rhetoric: 75, rites: 85 },
  "lucius-papirius": { strategist: 80, authority: 82, rhetoric: 45 },
  "spurius-carvilius": { devotion: 75, logistics: 65 },
  "quintus-fabius": { strategist: 60, manipulation: 65, arbitration: 70 },
  "lucius-postumius": { authority: 85, rhetoric: 30, arbitration: 20, manipulation: 70 },
  "publius-valerius": { rhetoric: 55, strategist: 40 },
  "gaius-claudius": { rhetoric: 75, scholarship: 65 },
};

/** Everyone's finer skills: the gifts the sources give, and a spread for the rest. */
export function withFinerSkills<C extends { readonly id: string; readonly name: string; readonly skills: Record<string, unknown> }>(character: C): C {
  const skills = character.skills as unknown as Parameters<typeof spreadSubSkills>[1] & { subSkills?: Record<string, number> };
  const known = character.name === "Antigonus Gonatas" ? { strategist: 80, arbitration: 75 } : GIFTS[character.id] ?? {};
  return { ...character, skills: { ...character.skills, subSkills: spreadSubSkills(character.id, skills, { ...known, ...(skills.subSkills ?? {}) }) } };
}
