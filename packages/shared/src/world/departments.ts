import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import type { Character } from "../characters/character";
import { aptitude, skillShare, type SubSkill } from "../characters/aptitude";
import { computeOpinion } from "../characters/opinion";
import { honestyOf } from "../characters/mind";
import { leaning } from "../characters/traits";
import { StandingEffectSchema, type EffectBand } from "./standing-effects";

/**
 * Who is in charge of what (docs/plans/departments.md).
 *
 * A power's taxes were gathered as well as its best tax man among all its
 * magistrates could gather them, whoever he was and whatever his colleagues
 * were like, and what an office did was read from what it was called. A king
 * with no ministers counted for nothing, and a new office changed nothing.
 *
 * Now whatever a power does is done as well as whoever is in charge of it can
 * do it. The engine knows a fixed set of things it can compute -- levers. A
 * department is a named bundle of them, staffed by offices. A lever no
 * department holds is held by the ruler himself; a household's estates by
 * their owner. Several officers are averaged, an empty seat runs badly, a man
 * holding too much does all of it worse, and a department gets better at its
 * work the longer it exists.
 */

/** The groups levers fall into: what a man's workload counts, and a ruler's implicit portfolios. */
export const LeverFamilySchema = z.enum(["treasury", "watch", "war", "foreign", "religion", "justice", "provision", "household"]);
export type LeverFamily = z.infer<typeof LeverFamilySchema>;

export const STANDARD_LEVERS = [
  "tax_roll",
  "public_works_cost",
  "audit",
  "watch",
  "covert",
  "supply",
  "levy",
  "foreign_letters",
  "peace_talks",
  "public_rites",
  "courts",
  "grain",
] as const;
export type StandardLever = (typeof STANDARD_LEVERS)[number];
export const StandardLeverSchema = z.enum(STANDARD_LEVERS);

/**
 * A lever: one of the power's, or one of a household's, named for the income
 * source it runs (`estate:<incomeSourceId>`, `venture:<incomeSourceId>`).
 */
export const LeverIdSchema = z.union([StandardLeverSchema, z.string().regex(/^(estate|venture):[A-Za-z0-9_.:-]{1,120}$/)]);
export type LeverId = z.infer<typeof LeverIdSchema>;

/** A skill a lever reads: a finer skill, or stewardship itself for a man's estates. */
export type LeverSkill = SubSkill | "stewardship";

export interface LeverDefinition {
  readonly family: LeverFamily;
  /** Averaged, where there are two. */
  readonly skills: readonly LeverSkill[];
  readonly words: string;
  /** Whether money passes through the hands that hold it, so that some of it can stay there. */
  readonly handlesMoney: boolean;
}

export const LEVERS: Readonly<Record<StandardLever, LeverDefinition>> = {
  tax_roll: { family: "treasury", skills: ["taxation"], words: "gathering the taxes", handlesMoney: true },
  public_works_cost: { family: "treasury", skills: ["stewardship"], words: "what public works cost", handlesMoney: true },
  audit: { family: "treasury", skills: ["taxation", "espionage"], words: "auditing those who handle money", handlesMoney: false },
  watch: { family: "watch", skills: ["espionage"], words: "hearing of plots against the state", handlesMoney: false },
  covert: { family: "watch", skills: ["manipulation"], words: "the state's own plots", handlesMoney: false },
  supply: { family: "war", skills: ["logistics"], words: "feeding and moving the armies", handlesMoney: false },
  levy: { family: "war", skills: ["authority"], words: "raising and holding the levy", handlesMoney: false },
  foreign_letters: { family: "foreign", skills: ["rhetoric"], words: "letters in the state's name", handlesMoney: false },
  peace_talks: { family: "foreign", skills: ["arbitration"], words: "bargaining for peace", handlesMoney: false },
  public_rites: { family: "religion", skills: ["rites"], words: "the public rites", handlesMoney: false },
  courts: { family: "justice", skills: ["arbitration"], words: "the courts", handlesMoney: false },
  grain: { family: "provision", skills: ["logistics", "stewardship"], words: "the grain supply", handlesMoney: true },
};

export function leverDefinition(lever: LeverId): LeverDefinition {
  if (lever.startsWith("estate:")) return { family: "household", skills: ["stewardship"], words: "an estate", handlesMoney: true };
  if (lever.startsWith("venture:")) return { family: "household", skills: ["stewardship", "logistics"], words: "a venture", handlesMoney: true };
  return LEVERS[lever as StandardLever];
}

/** How good somebody is at what a lever asks, before anything else is counted. */
export function leverAptitude(character: Pick<Character, "skills">, lever: LeverId): number {
  const skills = leverDefinition(lever).skills;
  const total = skills.reduce((sum, skill) => sum + (skill === "stewardship" ? character.skills.stewardship : aptitude(character, skill)), 0);
  return total / skills.length;
}

/** Whose department it is: a power's, or one man's household. */
export const DepartmentScopeSchema = z
  .object({ kind: z.enum(["polity", "household"]), id: EntityIdSchema })
  .strict();
export type DepartmentScope = z.infer<typeof DepartmentScopeSchema>;

/** What a gate is over: an act of the department's that a chamber must approve. */
export const GateActSchema = z.enum(["spend", "make_war", "make_peace", "assign_command", "receive_embassy", "judge_commander", "create_or_abolish"]);
export type GateAct = z.infer<typeof GateActSchema>;

export const DepartmentGateSchema = z
  .object({ institutionId: EntityIdSchema, act: GateActSchema })
  .strict();
export type DepartmentGate = z.infer<typeof DepartmentGateSchema>;

export const DepartmentOriginSchema = z.enum(["scenario", "order", "pressure", "reform"]);

export const DepartmentSchema = z
  .object({
    id: EntityIdSchema,
    scope: DepartmentScopeSchema,
    name: z.string().trim().min(1).max(120),
    levers: z.array(LeverIdSchema).max(12),
    /** The offices that staff it. Their held seats are its officers. */
    officeIds: z.array(EntityIdSchema).max(12),
    /** The head, where it has one. His seat counts among the officers too. */
    headOfficeId: EntityIdSchema.nullable().default(null),
    /** Deputies do the work beneath the officers, and learn from the head; they are not averaged. */
    deputyOfficeIds: z.array(EntityIdSchema).max(12).default([]),
    pay: z.enum(["honorary", "salaried"]).default("honorary"),
    foundedAtStep: ElapsedStepSchema,
    /** Until this day it is still being organised, and whoever held its levers before keeps them. */
    formsAtStep: ElapsedStepSchema,
    /** Days it has existed with somebody in it: what it has learned as an institution. */
    experienceDays: z.number().int().nonnegative().default(0),
    /** The last day its experience was counted to. Null: never, since it formed. */
    countedAtStep: ElapsedStepSchema.nullable().default(null),
    /** A rule of its own, for what no lever says (`write_mechanic`). */
    mechanicRuleId: EntityIdSchema.nullable().default(null),
    /**
     * What it goes on doing that no lever says -- a board of weights and
     * measures, curators of the aqueducts: the arrangement (`genericEntities`)
     * carrying its standing effects, which are as strong as its officers are
     * able, and stop while it stands empty.
     */
    standingEntityId: EntityIdSchema.nullable().default(null),
    /** Those effects as the measure named them; the arrangement carries them at the strength its people manage. */
    effects: z.array(StandingEffectSchema).max(4).default([]),
    /** What passes through its hands in a month, averaged over about three: what its pay is reckoned on. */
    budgetPerMonth: z.number().int().nonnegative().default(0),
    /** When men last said less reached it than should have. */
    rumouredAtStep: ElapsedStepSchema.nullable().default(null),
    gates: z.array(DepartmentGateSchema).max(8).default([]),
    origin: DepartmentOriginSchema,
    abolishedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type Department = z.infer<typeof DepartmentSchema>;

// ── Reading who holds what ──────────────────────────────────────────────────

/** An empty seat still runs its lever, badly, until somebody is put in it. */
export const VACANT_SKILL = 25;
/** A college nobody in it was ever named to is worked by the middling men it implies. */
export const IMPLIED_SKILL = 50;
/** A man can hold this many families of work without doing any of them worse. */
export const WORKLOAD_FREE_FAMILIES = 3;
export const WORKLOAD_PER_FAMILY = 3;
export const WORKLOAD_MAX = 25;
/** A department's experience: a point a year, up to ten. */
export const MEMORY_MAX = 10;
export const FRICTION_PER_PAIR = 5;
export const FRICTION_MAX = 15;
/** What an officer who hates his ruler costs his department's work, and the most all of them can. */
export const SULK_PER_OFFICER = 5;
export const SULK_MAX = 15;
/** Colleagues who think this little of one another work against each other. */
export const RIVAL_OPINION = -25;
/** The most a department's head lifts the work in his field: a seventh, either way. */
export const HEAD_REACH = 0.15;

const DAYS_PER_YEAR = 360;

/** What a reader needs of the world. Narrow, so shared code and the engine can both hand it in. */
export interface DepartmentWorld {
  readonly elapsedStep: number;
  readonly characters: readonly Character[];
  readonly departments?: readonly Department[];
  readonly constitutions?: readonly { readonly polityId: string; readonly rulerOfficeId: string | null }[];
  readonly material: {
    readonly officeSeats: readonly { readonly officeId: string; readonly holderCharacterId: string | null; readonly status: string }[];
    readonly incomeSources?: readonly { readonly id: string; readonly originKind?: string; readonly beneficiaryAccountId: string; readonly active?: boolean }[];
    readonly accounts?: readonly { readonly id: string; readonly owner: { readonly kind: string; readonly id: string } }[];
    /** Stewards and agents are men hired to run another's land and trade (`service_contract_open`). */
    readonly contracts?: readonly { readonly role: string; readonly employerAccountId: string; readonly employeeCharacterId: string; readonly status: string; readonly monthlyPay: number }[];
  };
}

export interface LeverHolding {
  /** The department that holds it, or null where the ruler (or the owner) does. */
  readonly department: Department | null;
  /** Whoever does the work: its officers, or the ruler's seat-holders, or the owner. */
  readonly people: readonly Character[];
  /** The head, where the holder has one. A ruler is his own head. */
  readonly head: Character | null;
}

export interface DepartmentReader {
  readonly holding: (scope: DepartmentScope, lever: LeverId) => LeverHolding;
  /** How good the work on this lever is, 0-100: what `skillShare` is then read on. */
  readonly skill: (scope: DepartmentScope, lever: LeverId) => number;
  /** What the head of this lever's department adds to any mission in its field, as a share (±0.15). */
  readonly headLift: (scope: DepartmentScope, lever: LeverId) => number;
  /** What holding too much costs this man on every lever he holds, as points off his skill (0 or less). */
  readonly workload: (characterId: string) => number;
  /** The families this man holds, for briefings. */
  readonly families: (characterId: string) => ReadonlySet<LeverFamily>;
  readonly rulers: (polityId: string) => readonly Character[];
}

const sameScope = (a: DepartmentScope, b: DepartmentScope): boolean => a.kind === b.kind && a.id === b.id;

/** Departments still standing, formed or not. */
export const activeDepartments = (world: Pick<DepartmentWorld, "departments">): readonly Department[] =>
  (world.departments ?? []).filter((department) => department.abolishedAtStep === null);

/**
 * Reads the world's departments once, and answers who holds what from it.
 * Built again whenever the world it read has changed in a way that matters --
 * in practice once per tick, and once per order applied.
 */
export function readDepartments(world: DepartmentWorld): DepartmentReader {
  const now = world.elapsedStep;
  const living = new Map(world.characters.filter((character) => character.alive).map((character) => [character.id, character]));
  const holdersOf = new Map<string, Character[]>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const holder = living.get(seat.holderCharacterId);
    if (holder === undefined) continue;
    const list = holdersOf.get(seat.officeId) ?? [];
    if (!list.some((known) => known.id === holder.id)) list.push(holder);
    holdersOf.set(seat.officeId, list);
  }
  // Offices with a seat at all. A college whose members the world never named
  // -- eight quaestors, a hundred and four judges -- has no seats, and is
  // worked by the men it implies, who are middling; an office whose seats
  // stand empty is not worked at all.
  const seated = new Set(world.material.officeSeats.map((seat) => seat.officeId));
  const departments = activeDepartments(world);
  const formed = departments.filter((department) => department.formsAtStep <= now);

  const rulerMemo = new Map<string, readonly Character[]>();
  const rulers = (polityId: string): readonly Character[] => {
    const known = rulerMemo.get(polityId);
    if (known !== undefined) return known;
    const officeId = world.constitutions?.find((constitution) => constitution.polityId === polityId)?.rulerOfficeId ?? null;
    const found = officeId === null ? [] : holdersOf.get(officeId) ?? [];
    rulerMemo.set(polityId, found);
    return found;
  };

  const officersOf = (department: Department): Character[] => {
    const ids = department.headOfficeId === null || department.officeIds.includes(department.headOfficeId)
      ? department.officeIds
      : [department.headOfficeId, ...department.officeIds];
    const seen = new Map<string, Character>();
    for (const officeId of ids) for (const holder of holdersOf.get(officeId) ?? []) seen.set(holder.id, holder);
    return [...seen.values()];
  };
  const headOf = (department: Department): Character | null =>
    department.headOfficeId === null ? null : (holdersOf.get(department.headOfficeId) ?? [])[0] ?? null;

  // The newest formed department to take a lever holds it: a lever moved to a
  // new board has left the old one, whether or not anybody struck it off.
  const holderDepartment = (scope: DepartmentScope, lever: LeverId): Department | null => {
    let best: Department | null = null;
    for (const department of formed) {
      if (!sameScope(department.scope, scope) || !department.levers.includes(lever)) continue;
      if (best === null || department.formsAtStep > best.formsAtStep || (department.formsAtStep === best.formsAtStep && department.id > best.id)) best = department;
    }
    return best;
  };

  // Who owns what a household runs: the account an estate pays into.
  const ownerOfAccount = new Map<string, string>();
  for (const account of world.material.accounts ?? []) if (account.owner.kind === "character") ownerOfAccount.set(account.id, account.owner.id);
  const householdLevers = new Map<string, LeverId[]>();
  for (const source of world.material.incomeSources ?? []) {
    if (source.active === false) continue;
    const kind = source.originKind === "venture" ? "venture" : source.originKind === "holding" ? "estate" : null;
    const owner = ownerOfAccount.get(source.beneficiaryAccountId);
    if (kind === null || owner === undefined) continue;
    householdLevers.set(owner, [...(householdLevers.get(owner) ?? []), `${kind}:${source.id}`]);
  }

  // Who runs a man's land and trade for him: the stewards and agents he pays
  // (or keeps -- a slave steward costs his keep, and is hired for nothing).
  const stewardsOf = new Map<string, { estate: Character[]; venture: Character[] }>();
  const stewarding = new Set<string>();
  for (const contract of world.material.contracts ?? []) {
    if (contract.status !== "active" || (contract.role !== "steward" && contract.role !== "agent")) continue;
    const owner = ownerOfAccount.get(contract.employerAccountId);
    const hand = living.get(contract.employeeCharacterId);
    if (owner === undefined || hand === undefined) continue;
    const staff = stewardsOf.get(owner) ?? { estate: [], venture: [] };
    // A steward runs everything; an agent only the trade.
    if (contract.role === "steward") staff.estate.push(hand);
    staff.venture.push(hand);
    stewardsOf.set(owner, staff);
    stewarding.add(hand.id);
  }
  const householdStaff = (ownerId: string, lever: LeverId): Character[] => {
    const staff = stewardsOf.get(ownerId);
    if (staff === undefined) return [];
    if (lever.startsWith("venture:")) {
      // An agent before a steward, where he has both: that is what he hired him for.
      const agents = staff.venture.filter((hand) => !staff.estate.includes(hand));
      return agents.length > 0 ? agents : staff.venture;
    }
    return staff.estate;
  };

  const familyMemo = new Map<string, ReadonlySet<LeverFamily>>();
  const families = (characterId: string): ReadonlySet<LeverFamily> => {
    const known = familyMemo.get(characterId);
    if (known !== undefined) return known;
    const held = new Set<LeverFamily>();
    // Every department he works in -- a power's, or somebody's household.
    for (const department of formed) {
      if (!officersOf(department).some((officer) => officer.id === characterId)) continue;
      for (const lever of department.levers) {
        if (holderDepartment(department.scope, lever)?.id === department.id) held.add(leverDefinition(lever).family);
      }
    }
    // Everything his power has not handed to anybody, if he rules it.
    const character = living.get(characterId);
    if (character !== undefined && character.polityId !== null && rulers(character.polityId).some((ruler) => ruler.id === characterId)) {
      for (const lever of STANDARD_LEVERS) {
        if (holderDepartment({ kind: "polity", id: character.polityId }, lever) === null) held.add(LEVERS[lever].family);
      }
    }
    // His own estates, as long as any of them is still his to run -- and
    // another man's, if he is paid to run them.
    const own = householdLevers.get(characterId) ?? [];
    if (own.some((lever) => holderDepartment({ kind: "household", id: characterId }, lever) === null && householdStaff(characterId, lever).length === 0)) held.add("household");
    if (stewarding.has(characterId)) held.add("household");
    familyMemo.set(characterId, held);
    return held;
  };

  const workload = (characterId: string): number => {
    const count = families(characterId).size;
    return count <= WORKLOAD_FREE_FAMILIES ? 0 : -Math.min(WORKLOAD_MAX, (count - WORKLOAD_FREE_FAMILIES) * WORKLOAD_PER_FAMILY);
  };

  const holding = (scope: DepartmentScope, lever: LeverId): LeverHolding => {
    const department = holderDepartment(scope, lever);
    if (department !== null) return { department, people: officersOf(department), head: headOf(department) };
    if (scope.kind === "household") {
      const staff = householdStaff(scope.id, lever);
      if (staff.length > 0) return { department: null, people: staff, head: staff[0] ?? null };
      const owner = living.get(scope.id);
      return { department: null, people: owner === undefined ? [] : [owner], head: owner ?? null };
    }
    const people = rulers(scope.id);
    return { department: null, people, head: people[0] ?? null };
  };

  const skillOf = (person: Character, lever: LeverId): number => leverAptitude(person, lever) + workload(person.id);

  const friction = (people: readonly Character[]): number => {
    let pairs = 0;
    for (let i = 0; i < people.length; i += 1) {
      for (let j = i + 1; j < people.length; j += 1) {
        const a = people[i]!;
        const b = people[j]!;
        if (Math.min(computeOpinion(a, b.id), computeOpinion(b, a.id)) <= RIVAL_OPINION) pairs += 1;
      }
    }
    return -Math.min(FRICTION_MAX, pairs * FRICTION_PER_PAIR);
  };

  // An officer who hates the man he serves does the work slowly and badly --
  // unless duty holds him to it. Insubordination short of refusal (§8).
  const sulkingIn = (people: readonly Character[], masters: readonly Character[]): number => {
    const sulkers = people.filter((person) => !masters.some((master) => master.id === person.id)
      && masters.some((master) => computeOpinion(person, master.id) <= RIVAL_OPINION)
      && person.mind.drives.duty + leaning(person, "obligation") * 2 < 70).length;
    return -Math.min(SULK_MAX, sulkers * SULK_PER_OFFICER);
  };

  const skill = (scope: DepartmentScope, lever: LeverId): number => {
    const held = holding(scope, lever);
    if (held.people.length === 0) {
      // A department nobody sits in runs badly. A power with no seat at its
      // head at all -- a loose people nobody organised -- gets on as it
      // always has, neither well nor badly.
      if (held.department !== null) {
        const offices = [...held.department.officeIds, ...(held.department.headOfficeId === null ? [] : [held.department.headOfficeId])];
        if (offices.length === 0 || offices.some((officeId) => seated.has(officeId))) return VACANT_SKILL;
        return Math.min(100, IMPLIED_SKILL + Math.min(MEMORY_MAX, Math.floor(held.department.experienceDays / DAYS_PER_YEAR)));
      }
      if (scope.kind === "polity" && (world.constitutions?.find((constitution) => constitution.polityId === scope.id)?.rulerOfficeId ?? null) !== null) return VACANT_SKILL;
      return 50;
    }
    const base = held.people.reduce((sum, person) => sum + skillOf(person, lever), 0) / held.people.length;
    const memory = held.department === null ? 0 : Math.min(MEMORY_MAX, Math.floor(held.department.experienceDays / DAYS_PER_YEAR));
    const sulking = held.department === null || scope.kind !== "polity" ? 0 : sulkingIn(held.people, rulers(scope.id));
    return Math.max(0, Math.min(100, Math.round(base + memory + friction(held.people) + sulking)));
  };

  const headLift = (scope: DepartmentScope, lever: LeverId): number => {
    const head = holding(scope, lever).head;
    return head === null ? 0 : skillShare(Math.max(0, Math.min(100, skillOf(head, lever))), HEAD_REACH);
  };

  return { holding, skill, headLift, workload, families, rulers };
}

/** The power a man serves in an office of, if he holds one there: where a plot against him is the state's business. */
export function officeholderPolity(world: DepartmentWorld, characterId: string, polityId: string | null): string | null {
  if (polityId === null) return null;
  return world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === characterId) ? polityId : null;
}

/**
 * Levers a department's name plainly says, for a measure that named none. A
 * government that founds "a treasury" has founded something that gathers the
 * taxes whether or not whoever wrote the law thought to say so. Nothing here
 * decides anything the name does not.
 */
const LEVERS_BY_WORD: readonly (readonly [RegExp, readonly StandardLever[]])[] = [
  [/treasur|quaest|exchequer|fisc|tax|revenue|aerarium|accountant/i, ["tax_roll", "public_works_cost"]],
  [/censor|audit|inspect|scrutin/i, ["audit"]],
  [/spy|spies|watch|informer|intelligen|secret|frumentar/i, ["watch", "covert"]],
  [/war|army|armies|militar|legion|strateg|general|supply|quartermaster/i, ["supply", "levy"]],
  [/levy|recruit|muster/i, ["levy"]],
  [/embass|foreign|envoy|diplomat|letters|chancer/i, ["foreign_letters", "peace_talks"]],
  [/priest|pontif|augur|rites|temple|relig|sacred|haruspic/i, ["public_rites"]],
  [/court|justice|judge|praetor|law|tribunal/i, ["courts"]],
  [/grain|corn|annona|food|provision|granar|market|aedil/i, ["grain"]],
  [/works|building|aqueduct|road|curator/i, ["public_works_cost"]],
];

export function leversNamedBy(name: string): StandardLever[] {
  const found = new Set<StandardLever>();
  for (const [pattern, levers] of LEVERS_BY_WORD) if (pattern.test(name)) for (const lever of levers) found.add(lever);
  return [...found];
}

/** How long a department takes to organise: a month, or two for a large one or one set up in wartime. */
export function formingDays(leverCount: number, atWar: boolean): number {
  return leverCount > 2 || atWar ? 60 : 30;
}

/** How strongly a department's own effects work, by how able its people are; nothing while it stands empty. */
export function bandForSkill(skill: number | null): EffectBand | null {
  if (skill === null) return null;
  return skill >= 80 ? "great" : skill >= 65 ? "marked" : "slight";
}

// ── Pay and graft (§7b, §9) ─────────────────────────────────────────────────

export type PostRole = "head" | "officer" | "deputy";

/** What each place is paid on its department's monthly budget, and the least it is paid at all. */
export const PAY_RATE: Readonly<Record<PostRole, { readonly rate: number; readonly floor: number }>> = {
  head: { rate: 0.015, floor: 200 },
  officer: { rate: 0.01, floor: 100 },
  deputy: { rate: 0.004, floor: 40 },
};

/** The pay a place expects, whether or not it is paid: an unpaid man is tempted by the difference. */
export function expectedPay(role: PostRole, budgetPerMonth: number): number {
  const { rate, floor } = PAY_RATE[role];
  return Math.max(floor, Math.round(budgetPerMonth * rate));
}

/** Below this, a man keeps his hands out of the chest. */
export const HONEST_GREED = 25;
/** The most of his share an officer can divert in a month without it being plain to anybody. */
export const MAX_DIVERSION_SHARE = 0.12;

/**
 * How much a man would take given the chance, 0-100: low honesty, a love of
 * money, and no sense of duty to stop him.
 */
export function greedOf(character: Pick<Character, "id" | "mind" | "skills" | "traits">): number {
  const honesty = honestyOf(character);
  // What his name says of him: a deceitful man ten more, a dutiful one ten less.
  const raw = (100 - honesty) * 0.5 + character.mind.drives.wealth * 0.3 - character.mind.drives.duty * 0.2
    - Math.round(leaning(character, "honesty") * (10 / 12)) - leaning(character, "obligation");
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * The share of what passes through his hands a man diverts, 0 to 0.12.
 * Unpaid, he takes more; well paid, less; far from anybody who could check, more.
 */
export function diversionShare(greed: number, paidShareOfExpected: number, hopsFromCapital: number): number {
  if (greed < HONEST_GREED) return 0;
  const pay = 1.3 - 0.3 * Math.min(1.5, Math.max(0, paidShareOfExpected));
  const distance = Math.min(1.6, 1 + 0.1 * Math.max(0, hopsFromCapital));
  return Math.min(MAX_DIVERSION_SHARE, MAX_DIVERSION_SHARE * (greed / 100) * pay * distance);
}

/**
 * What went missing, and who took it: the evidence an audit finds. One row a
 * man and a department, adding up as he goes on taking.
 */
export const DiversionSchema = z
  .object({
    id: EntityIdSchema,
    byCharacterId: EntityIdSchema,
    scope: DepartmentScopeSchema,
    /** The department it went missing from; null for a household's steward. */
    departmentId: EntityIdSchema.nullable(),
    amount: z.number().int().positive(),
    /** Where it went: his own purse, or his patron's. */
    toAccountId: EntityIdSchema,
    firstAtStep: ElapsedStepSchema,
    lastAtStep: ElapsedStepSchema,
    /** When an audit found it. Found once, it is evidence anybody who knows may use. */
    foundAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type Diversion = z.infer<typeof DiversionSchema>;

/**
 * An audit: a man sent to go through a department's books, or a household's.
 * It finds what was taken as well as he can look and as well as the thief
 * hid it; what it finds is evidence (`Diversion.foundAtStep`).
 */
export const AuditSchema = z
  .object({
    id: EntityIdSchema,
    orderedByCharacterId: EntityIdSchema,
    auditorCharacterId: EntityIdSchema,
    scope: DepartmentScopeSchema,
    /** The department gone through; null for a household's whole business. */
    departmentId: EntityIdSchema.nullable(),
    startedAtStep: ElapsedStepSchema,
    dueAtStep: ElapsedStepSchema,
    status: z.enum(["under_way", "found", "cleared"]),
  })
  .strict();
export type Audit = z.infer<typeof AuditSchema>;

/** How long going through the books takes: two months. */
export const AUDIT_DAYS = 60;
