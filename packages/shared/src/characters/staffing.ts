import { stableHash } from "../determinism";
import { POOLS, aNameFor, cultureOf } from "./names-by-culture";
import { spreadSubSkills } from "./aptitude";
import type { Office } from "./character";

/**
 * Somebody in every chair (scenario v37).
 *
 * v34 put a ruler in each power's head chair and stopped: Rome's quaestors,
 * tribunes, aediles, praetor, censors and priestly colleges, Carthage's
 * suffetes and judges, every other power's council and generals were offices
 * nobody held, so the popup that lists a state's offices read "Vacant" down the
 * page and an election had nobody to choose between. A chair a person sits in
 * is named here, with the gifts the office asks for, and is kept by the same
 * machinery as every other seat -- elections, deaths, successors.
 *
 * Only named people have seats. A college of eight is its named members out of
 * eight, and a Senate of three hundred a count with a dozen names in it.
 */

/** What a man in the office is chiefly good at. */
export type Focus = "martial" | "piety" | "stewardship" | "diplomacy" | "learning" | "intrigue";

export interface PersonSpec {
  readonly id: string;
  readonly name: string;
  readonly polityId: string;
  readonly cultureId: string;
  readonly faithId: string | null;
  readonly provinceId: string;
  readonly age: number;
  readonly gender?: "male" | "female";
  readonly prestigeBps: number;
  readonly focus: Focus;
  readonly traits?: readonly string[];
  /** The magistracy he holds, which is his reach. Null for a seat in a council or a priesthood. */
  readonly officeId: string | null;
  readonly balance?: number;
  readonly officesHeld?: readonly string[];
}

/** The faith each culture's people keep, where the scenario has one for them. */
const FAITH: Readonly<Record<string, string>> = { roman: "faith-roman", punic: "faith-punic", italic: "faith-italic", etruscan: "faith-italic", greek: "faith-greek", libyan: "faith-punic" };
export const faithOfCulture = (cultureId: string): string | null => FAITH[cultureId] ?? null;

const spread = (seed: string, slot: string, low: number, span: number): number => low + (stableHash([seed, slot]) % span);

/** A person, and the purse that goes with him: skills by the office's focus, the rest spread by hash, so the same chair gets the same man. */
export function personFor(spec: PersonSpec, atStep: number): { character: Record<string, unknown>; account: Record<string, unknown> } {
  const { id } = spec;
  const gifted = (focus: Focus, low = 35, span = 30): number => (spec.focus === focus ? 62 + stableHash([id, focus, "gift"]) % 25 : spread(id, focus, low, span));
  const skills = {
    martial: gifted("martial", 35, 30), intrigue: gifted("intrigue"), learning: gifted("learning", 30, 30), piety: gifted("piety"),
    stewardship: gifted("stewardship", 40, 25), diplomacy: gifted("diplomacy"), body: spread(id, "body", 40, 30),
  };
  const character = {
    id, name: spec.name, cultureId: spec.cultureId, faithId: spec.faithId, dynastyId: null,
    locationProvinceId: spec.provinceId, polityId: spec.polityId, ageYearsAtStart: spec.age,
    // Made on a later day than the opening, he is born that many years before it.
    birthStep: atStep > 0 ? atStep - spec.age * 365 : null,
    officeId: spec.officeId, personalAccountId: `${id}-purse`,
    officesHeld: (spec.officesHeld ?? []).map((officeId) => ({ officeId, lastHeldAtStep: atStep })),
    gender: spec.gender ?? "male",
    skills: { ...skills, subSkills: spreadSubSkills(id, skills, {}) },
    traits: [...(spec.traits ?? [])], healthBps: 8_500 - (spec.age > 55 ? 1_000 : 0), prestigeBps: spec.prestigeBps,
    relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null, disqualifyingStatuses: [],
  };
  const account = { id: `${id}-purse`, owner: { kind: "character", id }, currencyId: "drachma", balance: spec.balance ?? 400 + Math.round(spec.prestigeBps / 10), status: "active", visibility: "private" };
  return { character, account };
}

/**
 * A name nobody in the world bears. A people's stock runs out -- sixteen Greek
 * first names for a hundred Greek chairs -- and `aNameFor` then falls back to a
 * name that repeats, so the rest are given a father: "Menippus son of Eudamidas".
 */
function uniqueName(polityId: string, role: string, used: ReadonlySet<string>): string {
  const plain = aNameFor(polityId, role, used);
  if (!plain.includes(" of the ")) return plain;
  const { first } = POOLS[cultureOf(polityId)];
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const son = first[stableHash([polityId, role, "son", attempt]) % first.length]!;
    const father = first[stableHash([polityId, role, "father", attempt]) % first.length]!;
    const name = `${son} son of ${father}`;
    if (son !== father && !used.has(name)) return name;
  }
  return `${plain} ${stableHash([polityId, role]).toString(36)}`;
}

export interface SeatDraft {
  readonly id: string;
  readonly officeId: string;
  readonly seatIndex: number;
  readonly holderCharacterId: string;
  readonly status: "held";
  readonly vacancyCause: "none";
  readonly termStartedAtStep: number;
  readonly termExpiresAtStep: number | null;
  readonly appointmentProcedureId: null;
  readonly removalProcedureId: null;
  readonly eligibilityRequirementIds: readonly string[];
}

/** A held seat. A term runs from the day the man sat, and an election refills the seat when it ends. */
export function seatFor(office: Pick<Office, "id" | "termDays" | "eligibilityRequirementIds">, seatIndex: number, holderCharacterId: string, atStep: number): SeatDraft {
  return {
    id: `${office.id}:seat:${seatIndex}`.slice(0, 120), officeId: office.id, seatIndex, holderCharacterId, status: "held", vacancyCause: "none",
    termStartedAtStep: atStep, termExpiresAtStep: office.termDays == null ? null : atStep + office.termDays,
    appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [...office.eligibilityRequirementIds],
  };
}

/** The powers that get a named college, council and set of officers. Every other power keeps its ruler and an implied crowd. */
export const MAJOR_NATIONS: ReadonlySet<string> = new Set([
  "macedon", "epirus", "sparta", "athens", "cyrene", "pergamon", "bithynia", "pontus", "cappadocia", "armenia", "atropatene",
  "seleucid-empire", "ptolemaic-egypt", "numidian-kingdoms", "mauretanian-peoples", "kush", "illyria-ardiaei", "caucasian-iberia",
  "etruscan-cities", "aetolian-league", "achaean-league", "rhodes", "massalia", "samnites", "judea",
]);

/** How many of an office's seats are named. A magistracy is named whole up to four; a council or a college gives its leading few. */
export function namedSeats(office: Pick<Office, "kind" | "seatCount">): number {
  const seats = office.seatCount ?? 1;
  return Math.min(seats, (office.kind ?? "magistracy") === "magistracy" ? 4 : (office.kind === "priesthood" ? 3 : 5));
}

const focusOf = (office: Pick<Office, "kind" | "id" | "label" | "authorisedActionIds">): Focus => {
  if (office.kind === "priesthood") return "piety";
  if (office.authorisedActionIds.includes("force_engage") || /general|hipparch|strategos|commander/i.test(office.label)) return "martial";
  if (/treasur|account|quaestor|steward/i.test(office.label)) return "stewardship";
  if (office.kind === "membership") return "diplomacy";
  return "learning";
};

export interface StaffableWorld {
  readonly characters: readonly { readonly id: string; readonly name: string; readonly polityId: string | null; readonly locationProvinceId: string }[];
  readonly map: { readonly provinces: readonly { readonly id: string; readonly controllerPolityId: string | null }[] };
  readonly material: {
    readonly accounts: readonly unknown[];
    readonly officeSeats: readonly { readonly officeId: string; readonly seatIndex: number; readonly status: string; readonly holderCharacterId: string | null }[];
  };
}

/**
 * Name the people in a power's offices: every office it has, less those
 * somebody already holds. Returns what to add; the caller puts it in the world.
 */
export function staffOffices(world: StaffableWorld, polityId: string, offices: readonly Office[], atStep: number): {
  characters: Record<string, unknown>[]; accounts: Record<string, unknown>[]; seats: SeatDraft[];
} {
  const characters: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  const seats: SeatDraft[] = [];
  const used = new Set(world.characters.map((character) => character.name));
  const home = world.characters.find((character) => character.polityId === polityId)?.locationProvinceId
    ?? world.map.provinces.find((province) => province.controllerPolityId === polityId)?.id;
  if (home === undefined) return { characters, accounts, seats };
  const cultureId = cultureOf(polityId);

  for (const office of offices) {
    const held = world.material.officeSeats.filter((seat) => seat.officeId === office.id && seat.status === "held" && seat.holderCharacterId !== null);
    const first = Math.max(-1, ...world.material.officeSeats.filter((seat) => seat.officeId === office.id).map((seat) => seat.seatIndex)) + 1;
    const want = namedSeats(office) - held.length;
    const magistracy = (office.kind ?? "magistracy") === "magistracy";
    for (let n = 0; n < want; n += 1) {
      const role = `${office.id}#${first + n}`;
      const name = uniqueName(polityId, role, used);
      used.add(name);
      const id = `${polityId}-${office.id.split(/[:-]/).pop()}-${stableHash([polityId, role, name]).toString(36).slice(0, 6)}`.slice(0, 100);
      const age = office.kind === "priesthood" ? 45 + (stableHash([id, "age"]) % 20) : office.kind === "membership" ? 42 + (stableHash([id, "age"]) % 22) : 32 + (stableHash([id, "age"]) % 22);
      const { character, account } = personFor({
        id, name, polityId, cultureId, faithId: faithOfCulture(cultureId), provinceId: home, age,
        prestigeBps: 4_500 + (office.rank ?? 0) * 400 + (stableHash([id, "prestige"]) % 1_200), focus: focusOf(office),
        officeId: magistracy ? office.id : null,
      }, atStep);
      characters.push(character);
      accounts.push(account);
      seats.push(seatFor(office, first + n, id, atStep));
    }
  }
  return { characters, accounts, seats };
}
