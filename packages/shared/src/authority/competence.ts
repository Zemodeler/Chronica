import { allOffices, type Office } from "../characters/character";
import type { GovernmentInstitution } from "../material-state";
import type { Department } from "../world/departments";
import { chamberHolds, type ChamberPower } from "../political-parts";
import type { Constitution } from "../world/constitution";
import { CUSTOMARY_TAX_RATE_BPS } from "../material/tax-policy";
import { leversNamedBy } from "../world/departments";
import { SPENDING_YEAR_DAYS, actMarkOf, type ActMark } from "../world/act-marks";
import { leaderOf } from "../world/agreements";
import type { WorldState } from "../world/world-state";
import {
  ACT_KINDS,
  ACT_WORDS,
  type ActKind,
  type Charge,
  type ChargeRule,
  type CompetenceGrade,
} from "./charge-vocabulary";

/**
 * Who may do what with a state's money and treaties, read from its constitution (docs/plans/government.md,
 * "H0 as built").
 *
 * There is no list of who decides. A consul may lay the tribute because the chamber that holds the purse leaves
 * it to him up to the customary rate, and because he holds the highest magistracy the constitution names; the
 * same consul may not coin silver because the Senate holds the mint. Change the chamber's powers by a
 * measure, recast the form by a coup, abolish the office, and the answer changes with them, because it is read
 * again from the parts every time it is asked: the chambers in `material.institutions` and what each may decide
 * (`powers`, `advisory`), the offices and their kind, rank, seats, vetoes and treasury reach, the departments that
 * staff a charge and the levers they hold, and the constitution's own record of who is head of state and which
 * chamber is sovereign.
 *
 * What a form does differently from the common run is data on the office (`Office.charge`), written by the form's
 * template (`sim/constitutions.ts`) or by a scenario; what is not said there is derived, so that a power with no
 * template at all (Rome, written by hand) is still read sensibly. A power with no constitution on record is read
 * as nothing here, and the engine goes on as it always did, on the labels of its offices (`office-powers.ts`).
 */

export type { ActKind, CompetenceGrade };

/** The chamber (or, failing one, the head of state) a matter beyond a man's competence goes to. */
export interface BodyRef {
  readonly id: string;
  readonly name: string;
}

export interface ActCompetence {
  readonly act: ActKind;
  /** How he stands towards the act, as far as `within` goes (or without limit where it is null). */
  readonly grade: CompetenceGrade;
  /** The most he may do on that footing, in the act's own unit (`WITHIN_UNIT`); null where there is no figure to stay within. */
  readonly within: number | null;
  /** What more than `within` becomes. */
  readonly beyond: "by_the_body" | "forbidden";
  /** The chamber that holds the power, where one does. Null: nobody but the ruler does. */
  readonly body: BodyRef | null;
  /** In a sentence of the age: what he may do and who decides the rest. */
  readonly why: string;
  /** The same, for a figure past `within`: what it comes to beyond his competence. */
  readonly whyBeyond: string;
}

export interface Competence {
  readonly officeId: string;
  readonly polityId: string;
  readonly label: string;
  /** Whether the seat is a college of more than one, whose members hold equal power. */
  readonly collegial: boolean;
  readonly isHead: boolean;
  /** The acts he may stop another man's of, by interposing himself: a tribune's. */
  readonly mayStop: readonly ActKind[];
  readonly acts: Readonly<Record<ActKind, ActCompetence>>;
}

/** The chamber power each act belongs to, nearest first. */
const POWER_OF_ACT: Readonly<Record<ActKind, readonly ChamberPower[]>> = {
  tax_rate: ["taxes"],
  customs: ["taxes"],
  coinage: ["coinage"],
  loans: ["finance"],
  grain: ["finance"],
  pacts: ["treaties"],
  embargoes: ["treaties"],
  levy: ["levy"],
  war: ["war"],
  peace: ["treaties", "war"],
  appointment: ["elections", "laws"],
  spending: ["finance"],
};

/** The highest tariff a magistrate sets on his own: the fiscal officers' own ceiling. */
export const CUSTOMS_OWN_CEILING_BPS = 1_500;
/** The most the mint's silver is moved by a hand that is not the chamber's. */
export const COINAGE_OWN_STEP_BPS = 0;
/** Months of what a power takes in that each rank of office may draw, borrow or spend on bread on its own word in a year. */
export const OWN_MONTHS = { head: 2, officer: 1, loans: 3 } as const;

const GRADE_ORDER: Readonly<Record<CompetenceGrade, number>> = { alone: 0, with_colleague: 1, by_the_body: 2, forbidden: 3 };

const NO_ACTS: Readonly<Record<ActKind, ActCompetence>> = Object.fromEntries(
  ACT_KINDS.map((act) => [act, { act, grade: "forbidden", within: null, beyond: "forbidden", body: null, why: "", whyBeyond: "" } satisfies ActCompetence]),
) as Record<ActKind, ActCompetence>;

// ── The parts ──────────────────────────────────────────────────────────────

/**
 * The parts of a world this reads, indexed once for the world as it stands. A world is replaced and never changed in place, so
 * the index lives as long as the world does, and a pass that asks about a hundred offices builds it once: the chambers of each power,
 * its constitution, the departments that are formed, the offices and the seats each man holds.
 */
interface Parts {
  readonly all: readonly Office[];
  readonly byId: ReadonlyMap<string, Office>;
  readonly chambers: ReadonlyMap<string, readonly GovernmentInstitution[]>;
  readonly constitutions: ReadonlyMap<string, Constitution>;
  readonly seatCount: ReadonlyMap<string, number>;
  readonly departments: ReadonlyMap<string, readonly Department[]>;
  readonly held: ReadonlyMap<string, readonly string[]>;
}

const partsCache = new WeakMap<object, WeakMap<object, Parts>>();

function partsOf(world: WorldState, scenarioOffices: readonly Office[]): Parts {
  let byOffices = partsCache.get(world);
  if (byOffices === undefined) {
    byOffices = new WeakMap();
    partsCache.set(world, byOffices);
  }
  const known = byOffices.get(scenarioOffices);
  if (known !== undefined) return known;
  const all = allOffices(world, scenarioOffices);
  const chambers = new Map<string, GovernmentInstitution[]>();
  for (const institution of world.material.institutions) {
    const list = chambers.get(institution.polityId);
    if (list === undefined) chambers.set(institution.polityId, [institution]);
    else list.push(institution);
  }
  const seatCount = new Map<string, number>();
  const held = new Map<string, string[]>();
  for (const seat of world.material.officeSeats) {
    seatCount.set(seat.officeId, (seatCount.get(seat.officeId) ?? 0) + 1);
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const list = held.get(seat.holderCharacterId);
    if (list === undefined) held.set(seat.holderCharacterId, [seat.officeId]);
    else list.push(seat.officeId);
  }
  const departments = new Map<string, Department[]>();
  for (const department of world.departments) {
    if (department.abolishedAtStep !== null || department.formsAtStep > world.elapsedStep || department.scope.kind !== "polity") continue;
    const list = departments.get(department.scope.id);
    if (list === undefined) departments.set(department.scope.id, [department]);
    else list.push(department);
  }
  const parts: Parts = {
    all,
    byId: new Map(all.map((office) => [office.id, office])),
    chambers,
    constitutions: new Map(world.constitutions.map((record) => [record.polityId, record])),
    seatCount,
    departments,
    held,
  };
  byOffices.set(scenarioOffices, parts);
  return parts;
}

const NO_CHAMBERS: readonly GovernmentInstitution[] = [];

/**
 * The chamber of a power that decides an act: one that binds (not one whose count binds nobody) and holds the power,
 * the one that names it before the one that holds it by the old bundle (`chamberHolds`), and failing every
 * chamber that holds it, the one that may change the constitution itself. Null where nobody but the ruler does.
 */
export function bodyFor(world: WorldState, polityId: string, act: ActKind, constitution?: Constitution, scenarioOffices: readonly Office[] = NO_OFFICES): BodyRef | null {
  const binding = (partsOf(world, scenarioOffices).chambers.get(polityId) ?? NO_CHAMBERS).filter((institution) => institution.advisory !== true);
  const powers = POWER_OF_ACT[act];
  const holding = binding.filter((institution) => powers.some((candidate) => chamberHolds(institution.powers, candidate)));
  // The first power the act names takes precedence: the people elect (`elections`) though the Senate also holds the laws.
  let found: GovernmentInstitution | undefined;
  for (const candidate of powers) {
    found = holding.find((institution) => institution.powers?.includes(candidate) === true);
    if (found !== undefined) break;
  }
  found ??= holding[0];
  if (found !== undefined) return { id: found.id, name: found.name };
  const sovereignId = constitution?.sovereignInstitutionId ?? null;
  const sovereign = sovereignId === null ? undefined : binding.find((institution) => institution.id === sovereignId);
  return sovereign === undefined ? null : { id: sovereign.id, name: sovereign.name };
}

/** The levers an office works at: those of the departments it staffs, or failing any, what its name says. */
function leversOfOffice(parts: Parts, office: Office): ReadonlySet<string> {
  const held = new Set<string>();
  for (const department of parts.departments.get(office.polityId) ?? []) {
    if (!department.officeIds.includes(office.id) && department.headOfficeId !== office.id) continue;
    for (const lever of department.levers) held.add(lever);
  }
  if (held.size === 0) for (const lever of namedLevers(office.label)) held.add(lever);
  return held;
}

const leversByLabel = new Map<string, readonly string[]>();
/** What an office's name says its levers are, remembered: the same few hundred labels are read every month. */
function namedLevers(label: string): readonly string[] {
  let known = leversByLabel.get(label);
  if (known === undefined) {
    known = leversNamedBy(label);
    if (leversByLabel.size < 4_000) leversByLabel.set(label, known);
  }
  return known;
}

/** The chamber a department staffed by this office needs a decree of to spend, if it has such a gate. */
function spendGateOf(parts: Parts, office: Office): BodyRef | null {
  for (const department of parts.departments.get(office.polityId) ?? []) {
    if (!department.officeIds.includes(office.id) && department.headOfficeId !== office.id) continue;
    const gate = department.gates.find((candidate) => candidate.act === "spend");
    if (gate === undefined) continue;
    const chamber = (parts.chambers.get(office.polityId) ?? NO_CHAMBERS).find((institution) => institution.id === gate.institutionId);
    if (chamber !== undefined) return { id: chamber.id, name: chamber.name };
  }
  return null;
}

// ── Saying it ──────────────────────────────────────────────────────────────

const nameOfPower = (world: WorldState, polityId: string): string => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
const percent = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)} in a hundred`;

/** What a limit comes to in words. */
function withinWords(act: ActKind, within: number | null): string {
  if (within === null) return "";
  switch (act) {
    case "tax_rate": return `, to a rate of ${percent(within)}`;
    case "customs": return `, to a tariff of ${percent(within)}`;
    case "coinage": return within === 0 ? ", but not to change the silver" : `, by no more than ${percent(within)} of its silver`;
    case "loans": return `, to ${within} ${within === 1 ? "month" : "months"} of what the power takes in`;
    case "grain":
    case "spending": return `, to ${within} ${within === 1 ? "month" : "months"} of what the power takes in in a year`;
    default: return "";
  }
}

function sentence(label: string, act: ActKind, grade: CompetenceGrade, within: number | null, body: BodyRef | null, rulerLabel: string | null): string {
  const deed = ACT_WORDS[act];
  const decider = body !== null ? `that is for the ${body.name.replace(/^the\s+/iu, "")}` : rulerLabel !== null ? `that is for the ${rulerLabel}` : "it is nobody's charge";
  switch (grade) {
    case "alone": return `${label} may ${deed} on his own authority${withinWords(act, within)}.`;
    case "with_colleague": return `${label} may ${deed}${withinWords(act, within)}; his colleague holds the same power, and either may act and the other may stop it.`;
    case "by_the_body": return `${label} may not ${deed} himself: it is laid before the ${(body?.name ?? "chamber").replace(/^the\s+/iu, "")}, and he may move it there.`;
    case "forbidden": return `${label} may not ${deed}: ${decider}.`;
  }
}

// ── Deriving it ────────────────────────────────────────────────────────────

interface Reading {
  readonly world: WorldState;
  readonly parts: Parts;
  readonly scenarioOffices: readonly Office[];
  readonly office: Office;
  readonly constitution: Constitution;
  readonly isHead: boolean;
  readonly collegial: boolean;
  readonly levers: ReadonlySet<string>;
  readonly rulerLabel: string | null;
  /** The power whose foedus this one follows, where it does: its leader makes its war and peace. */
  readonly leader: string | null;
}

type Line = { readonly grade: CompetenceGrade; readonly within?: number | undefined; readonly beyond?: "by_the_body" | "forbidden" | undefined };

/** The line an office has for an act when its form says nothing: the common run, from what the parts say. */
function derive(read: Reading, act: ActKind, body: BodyRef | null): Line {
  const { office, isHead, collegial, levers } = read;
  const together: CompetenceGrade = collegial ? "with_colleague" : "alone";
  const beyond = body === null ? "forbidden" as const : "by_the_body" as const;
  const treasurer = levers.has("tax_roll") || levers.has("customs") || levers.has("credit");
  const grainWork = levers.has("grain") || levers.has("markets");
  const holdsCustoms = levers.has("customs");
  const foreign = levers.has("foreign_letters") || levers.has("peace_talks");
  const commands = office.authorisedActionIds.includes("force_create") || levers.has("levy") || levers.has("supply");
  // A man set above every chamber (a dictator) is not bound to any of them.
  const supreme = !isHead && office.authorisedActionIds.includes("capital_set");

  if (office.kind === "membership" || office.kind === "priesthood") {
    // A seat in a council or a college is a voice in it, and no charge of its own: the head of a temple is the one exception.
    if (!(isHead && office.kind === "priesthood")) return { grade: "forbidden" };
  }
  if (office.tribunician === true) return { grade: "forbidden" };
  if (supreme || (isHead && body === null)) return { grade: "alone" };

  if (isHead) {
    switch (act) {
      case "war":
      case "peace":
      case "pacts":
      case "embargoes":
      case "coinage":
        return { grade: "by_the_body" };
      case "tax_rate": return { grade: together, within: CUSTOMARY_TAX_RATE_BPS, beyond: "by_the_body" };
      case "customs": return { grade: together, within: CUSTOMS_OWN_CEILING_BPS, beyond: "by_the_body" };
      case "loans": return { grade: together, within: OWN_MONTHS.loans, beyond: "by_the_body" };
      case "grain": return { grade: together, within: OWN_MONTHS.head, beyond: "by_the_body" };
      case "levy":
      case "appointment":
        return { grade: together };
      case "spending": return spendingLine(read, body, OWN_MONTHS.head);
    }
  }

  switch (act) {
    case "tax_rate":
      return treasurer ? { grade: together, within: CUSTOMARY_TAX_RATE_BPS, beyond } : { grade: "forbidden" };
    case "customs":
      return holdsCustoms ? { grade: together, within: CUSTOMS_OWN_CEILING_BPS, beyond } : treasurer ? { grade: together, within: 1_000, beyond } : { grade: "forbidden" };
    case "loans":
      return treasurer ? { grade: together, within: OWN_MONTHS.officer, beyond } : { grade: "forbidden" };
    case "coinage":
      // The moneyers strike what the chamber orders; they do not choose the silver.
      return levers.has("mint") ? { grade: together, within: COINAGE_OWN_STEP_BPS, beyond } : { grade: "forbidden" };
    case "grain":
      return grainWork ? { grade: together, within: OWN_MONTHS.officer, beyond } : { grade: "forbidden" };
    case "pacts":
    case "embargoes":
      return foreign || holdsCustoms ? { grade: body === null ? "alone" : "by_the_body" } : { grade: "forbidden" };
    case "levy":
      return commands ? { grade: together } : { grade: "forbidden" };
    case "spending":
      return spendingLine(read, body, OWN_MONTHS.officer);
    default:
      return { grade: "forbidden" };
  }
}

/** Spending: from the chest an office has reach to. `spend_without_vote` is an allowance; a proposal alone is the chamber's to carry. */
function spendingLine(read: Reading, body: BodyRef | null, months: number): Line {
  const { office, collegial, isHead } = read;
  if (office.treasuryAccountId === null) return { grade: "forbidden" };
  // A department the chamber keeps the purse of: nothing is paid out that it has not voted.
  if (spendGateOf(read.parts, office) !== null) return { grade: "by_the_body" };
  if (office.treasuryPermissions.includes("spend_without_vote")) {
    return { grade: collegial && isHead ? "with_colleague" : "alone", within: months, beyond: body === null ? "forbidden" : "by_the_body" };
  }
  return office.treasuryPermissions.includes("propose_spending") ? { grade: "by_the_body" } : { grade: "forbidden" };
}

function line(read: Reading, act: ActKind): ActCompetence {
  const { world, office, constitution } = read;
  const body = bodyFor(world, office.polityId, act, constitution, read.scenarioOffices);
  const written: ChargeRule | undefined = (office.charge as Charge | undefined)?.[act];
  // An ally bound by foedus makes no war or peace but its leader's (apply-deltas holds it to it too): not its head, nor any magistrate of it.
  const bound = read.leader !== null && (act === "war" || act === "peace");
  const base: Line = bound ? { grade: "forbidden" } : written ?? derive(read, act, body);
  let grade = base.grade;
  let within = base.within ?? null;
  let beyond: "by_the_body" | "forbidden" = base.beyond ?? (body === null ? "forbidden" : "by_the_body");
  let spendBody = body;
  if (act === "spending") {
    const gate = spendGateOf(read.parts, office);
    if (gate !== null && grade !== "forbidden") { grade = "by_the_body"; spendBody = gate; within = null; }
  }
  // A matter that goes to a chamber that does not exist goes to nobody: the head of state alone decides it, and
  // anybody else's act is not his to do.
  if (grade === "by_the_body" && spendBody === null) grade = read.isHead ? "alone" : "forbidden";
  if (beyond === "by_the_body" && spendBody === null) beyond = "forbidden";
  const shown = spendBody ?? body;
  const whoDecides = shown !== null ? `the ${shown.name.replace(/^thes+/iu, "")}` : read.rulerLabel !== null ? `the ${read.rulerLabel}` : "nobody";
  const whyBeyond = within === null ? "" : `${office.label} may ${ACT_WORDS[act]}${withinWords(act, within)}, and no further: more than that is ${beyond === "by_the_body" ? `laid before ${whoDecides}, and he may move it there` : `for ${whoDecides}`}.`;
  const why = bound ? `${office.label} may not ${ACT_WORDS[act]}: ${nameOfPower(world, read.leader!)} makes the war and the peace of those bound to it by the foedus.` : sentence(office.label, act, grade, within, shown, read.rulerLabel);
  return { act, grade, within, beyond, body: shown, why, whyBeyond };
}

// ── The reading ────────────────────────────────────────────────────────────

const cache = new WeakMap<object, WeakMap<object, Map<string, Competence | null>>>();
const NO_OFFICES: readonly Office[] = [];

/**
 * What an office may do, per act, read from the constitution of its power as the world stands now; null where
 * the power has no constitution on record (the engine then reads the office's label, as it always did).
 *
 * An abolished office has none of it: it is forbidden everything. Cached per world, because a world is replaced,
 * never changed in place, and a month asks the same office the same thing for every act it weighs.
 */
export function competenceOf(world: WorldState, officeId: string, offices: readonly Office[] = NO_OFFICES): Competence | null {
  let byOffices = cache.get(world);
  if (byOffices === undefined) {
    byOffices = new WeakMap();
    cache.set(world, byOffices);
  }
  let known = byOffices.get(offices);
  if (known === undefined) {
    known = new Map();
    byOffices.set(offices, known);
  }
  if (known.has(officeId)) return known.get(officeId) ?? null;
  const reading = read(world, officeId, offices);
  known.set(officeId, reading);
  return reading;
}

function read(world: WorldState, officeId: string, scenarioOffices: readonly Office[]): Competence | null {
  const parts = partsOf(world, scenarioOffices);
  const office = parts.byId.get(officeId);
  if (office === undefined) return null;
  const constitution = parts.constitutions.get(office.polityId);
  if (constitution === undefined) return null;
  if (office.successionRuleId === "abolished") {
    const acts = Object.fromEntries(ACT_KINDS.map((act) => [act, { ...NO_ACTS[act], why: `${office.label} has been abolished, and carries no charge.` }])) as Record<ActKind, ActCompetence>;
    return { officeId, polityId: office.polityId, label: office.label, collegial: false, isHead: false, mayStop: [], acts };
  }
  const rulerOffice = constitution.rulerOfficeId === null ? undefined : parts.byId.get(constitution.rulerOfficeId);
  const reading: Reading = {
    world,
    parts,
    scenarioOffices,
    office,
    constitution,
    isHead: constitution.rulerOfficeId === office.id,
    // A college of more than one: by its seat count, or by the seats the world has written down for it (Rome's consuls name two).
    collegial: (office.seatCount ?? parts.seatCount.get(office.id) ?? 0) > 1,
    levers: leversOfOffice(parts, office),
    rulerLabel: rulerOffice?.label ?? null,
    leader: leaderOf(world.polityAgreements, office.polityId),
  };
  const acts = Object.fromEntries(ACT_KINDS.map((act) => [act, line(reading, act)])) as Record<ActKind, ActCompetence>;
  // A tribune stops a magistrate's act in the city; an augur who has seen a bad omen stops the assembly that day, which is the elections (and so the naming of men to office).
  const mayStop: ActKind[] = office.tribunician === true
    ? ["tax_rate", "customs", "coinage", "loans", "grain", "levy", "appointment", "spending"]
    : office.vetoes === true && office.kind === "priesthood" ? ["appointment"] : [];
  return { officeId, polityId: office.polityId, label: office.label, collegial: reading.collegial, isHead: reading.isHead, mayStop, acts };
}

/** The grade an act comes to for a figure: his own as far as `within` goes, and what lies beyond it past that. */
export function gradeAt(competence: ActCompetence, magnitude?: number): CompetenceGrade {
  return magnitude !== undefined && competence.within !== null && magnitude > competence.within ? competence.beyond : competence.grade;
}

// ── The man ────────────────────────────────────────────────────────────────

export interface MayAct {
  readonly grade: CompetenceGrade;
  readonly officeId: string;
  readonly officeLabel: string;
  readonly body: BodyRef | null;
  readonly within: number | null;
  readonly why: string;
  /** He holds an office whose word stops this act where another man does it. */
  readonly stops: boolean;
}

/**
 * What a man may do, of all the offices he holds: the best footing any of them gives him (alone, then with a
 * colleague, then by the body), the higher office first among equals. Null where his power has no constitution
 * on record, or he holds no office of it: the fiscal officers and the engine's own passes use it as the
 * competence they act within, and fall back to what they did before where it is null.
 */
export function mayAct(world: WorldState, characterId: string, act: ActKind, options: { readonly offices?: readonly Office[]; readonly magnitude?: number } = {}): MayAct | null {
  const offices = options.offices ?? NO_OFFICES;
  const parts = partsOf(world, offices);
  let best: { readonly office: Office; readonly competence: Competence; readonly grade: CompetenceGrade } | null = null;
  let stops = false;
  for (const heldOfficeId of parts.held.get(characterId) ?? []) {
    const office = parts.byId.get(heldOfficeId);
    if (office === undefined) continue;
    const competence = competenceOf(world, office.id, offices);
    if (competence === null) continue;
    if (competence.mayStop.includes(act)) stops = true;
    const grade = gradeAt(competence.acts[act], options.magnitude);
    if (best === null || GRADE_ORDER[grade] < GRADE_ORDER[best.grade] || (grade === best.grade && (office.rank ?? 0) > (best.office.rank ?? 0))) best = { office, competence, grade };
  }
  if (best === null) return null;
  const line = best.competence.acts[act];
  return { grade: best.grade, officeId: best.office.id, officeLabel: best.office.label, body: line.body, within: line.within, why: best.grade === line.grade ? line.why : line.whyBeyond, stops };
}

/** Whether an act is, on this footing, a man's own to carry out (alone, or with a colleague who does not stop it). */
export const isOwnToDo = (grade: CompetenceGrade): boolean => grade === "alone" || grade === "with_colleague";

// ── Who holds a charge ─────────────────────────────────────────────────────

export interface ChargeHolder {
  readonly characterId: string;
  readonly officeId: string;
  readonly officeLabel: string;
  readonly grade: CompetenceGrade;
  /** He sits at the head of the department that keeps the work (a lever the act belongs to), or at the head of the state. */
  readonly basis: "lever" | "head" | "other";
}

/** The levers whose holders an act is the charge of, for finding the man to write to. */
const LEVERS_OF_ACT: Readonly<Partial<Record<ActKind, readonly string[]>>> = {
  pacts: ["customs", "foreign_letters"],
  embargoes: ["customs", "foreign_letters"],
  customs: ["customs", "tax_roll"],
  tax_rate: ["tax_roll"],
  coinage: ["mint"],
  loans: ["credit", "tax_roll"],
  grain: ["grain", "markets"],
};

/**
 * The men of a power who may take an act in hand, in the order a letter ought to reach them: first those who hold
 * the charge by a lever (the customs, the letters of the state), then the head of state, then the rest. A man
 * whose office forbids him the act is not named; one who may only move it before the chamber is, because he is
 * who answers for it until it is laid. Empty where the power has no constitution on record.
 */
export function chargeHolders(world: WorldState, polityId: string, act: ActKind, offices: readonly Office[] = NO_OFFICES): ChargeHolder[] {
  const parts = partsOf(world, offices);
  if (!parts.constitutions.has(polityId)) return [];
  const wanted = LEVERS_OF_ACT[act] ?? [];
  const found: (ChargeHolder & { readonly rank: number; readonly order: number })[] = [];
  const seen = new Set<string>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const office = parts.byId.get(seat.officeId);
    if (office === undefined || office.polityId !== polityId) continue;
    const competence = competenceOf(world, office.id, offices);
    if (competence === null) continue;
    const grade = competence.acts[act].grade;
    if (grade === "forbidden") continue;
    const key = `${seat.holderCharacterId}|${office.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const byLever = wanted.length > 0 && (parts.departments.get(polityId) ?? []).some((department) =>
      (department.officeIds.includes(office.id) || department.headOfficeId === office.id) && department.levers.some((lever) => wanted.includes(lever)));
    const basis: ChargeHolder["basis"] = byLever ? "lever" : competence.isHead ? "head" : "other";
    found.push({ characterId: seat.holderCharacterId, officeId: office.id, officeLabel: office.label, grade, basis, rank: office.rank ?? 0, order: basis === "lever" ? 0 : basis === "head" ? 1 : 2 });
  }
  return found
    .sort((a, b) => a.order - b.order || GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] || b.rank - a.rank || a.characterId.localeCompare(b.characterId))
    .map(({ rank: _rank, order: _order, ...holder }) => holder);
}

const seatIndexes = new WeakMap<object, { living: Set<string>; seats: Map<string, WorldState["material"]["officeSeats"][number][]> }>();
/** The living men and the held seats of every power, grouped once for a world. */
function seatIndex(world: WorldState): { living: Set<string>; seats: Map<string, WorldState["material"]["officeSeats"][number][]> } {
  let known = seatIndexes.get(world);
  if (known === undefined) {
    const polityOf = new Map<string, string | null>();
    const living = new Set<string>();
    for (const character of world.characters) {
      if (!character.alive) continue;
      living.add(character.id);
      polityOf.set(character.id, character.polityId);
    }
    const seats = new Map<string, WorldState["material"]["officeSeats"][number][]>();
    for (const seat of world.material.officeSeats) {
      if (seat.status !== "held" || seat.holderCharacterId === null) continue;
      const polity = polityOf.get(seat.holderCharacterId);
      if (polity === undefined || polity === null) continue;
      const list = seats.get(polity);
      if (list === undefined) seats.set(polity, [seat]);
      else list.push(seat);
    }
    known = { living, seats };
    seatIndexes.set(world, known);
  }
  return known;
}

/**
 * The men of a power who work a lever, in the order a charge is looked for: those of the department that holds it
 * (the head first), then any who hold an office whose name says it (an aedile for the markets, a censor for the roll).
 * Living men seated in office only, one entry a man. Empty where nobody has been given it: it is then the ruler's own.
 */
export function holdersOfLever(world: WorldState, polityId: string, lever: string, offices: readonly Office[] = NO_OFFICES): { readonly characterId: string; readonly officeId: string; readonly officeLabel: string; readonly head: boolean }[] {
  const parts = partsOf(world, offices);
  const found: { characterId: string; officeId: string; officeLabel: string; head: boolean; order: number; rank: number }[] = [];
  const seen = new Set<string>();
  const departments = parts.departments.get(polityId) ?? [];
  const taken = departments.some((department) => (department.levers as readonly string[]).includes(lever));
  const { living, seats } = seatIndex(world);
  for (const seat of seats.get(polityId) ?? []) {
    const holder = seat.holderCharacterId!;
    if (seen.has(holder) || !living.has(holder)) continue;
    const office = parts.byId.get(seat.officeId);
    if (office === undefined || office.polityId !== polityId || office.successionRuleId === "abolished") continue;
    const inDepartment = departments.find((department) => (department.levers as readonly string[]).includes(lever) && (department.officeIds.includes(office.id) || department.headOfficeId === office.id));
    const byName = !taken && namedLevers(office.label).includes(lever);
    if (inDepartment === undefined && !byName) continue;
    seen.add(holder);
    found.push({ characterId: holder, officeId: office.id, officeLabel: office.label, head: inDepartment?.headOfficeId === office.id, order: inDepartment === undefined ? 1 : 0, rank: office.rank ?? 0 });
  }
  return found
    .sort((a, b) => a.order - b.order || Number(b.head) - Number(a.head) || b.rank - a.rank || a.characterId.localeCompare(b.characterId))
    .map(({ order: _order, rank: _rank, ...entry }) => entry);
}

// ── Money ──────────────────────────────────────────────────────────────────

/**
 * What a power takes in a month, for the figures that are counted in months of it: its income sources paying into
 * its own chests, at the rate they are collected, over their cadence. A reading, not a ledger.
 */
export function monthlyTakings(world: WorldState, polityId: string): number {
  const chests = new Set(world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polityId).map((account) => account.id));
  let total = 0;
  for (const source of world.material.incomeSources) {
    if (!source.active || !chests.has(source.beneficiaryAccountId) || source.cadenceSteps <= 0) continue;
    total += (source.amount * source.collectionRateBps * 30) / (10_000 * source.cadenceSteps);
  }
  return Math.round(total);
}

export interface Allowance {
  /** What he may draw in a year on his own word, in silver; null where there is no limit (a ruler no chamber holds the purse of). */
  readonly amount: number | null;
  /** What he has drawn this year. */
  readonly spent: number;
  /** What is left of it, or null for no limit. */
  readonly left: number | null;
  readonly grade: CompetenceGrade;
  readonly body: BodyRef | null;
}

/**
 * An office's allowance for spending from its power's chest: its competence for the act, in months of the power's
 * takings, less what the office has drawn in the year (`ActMark`). Beyond it, the chamber's decree is needed.
 */
export function spendingAllowance(world: WorldState, officeId: string, offices: readonly Office[] = NO_OFFICES, marks: readonly ActMark[] = world.actMarks): Allowance | null {
  const competence = competenceOf(world, officeId, offices);
  if (competence === null) return null;
  const line = competence.acts.spending;
  const mark = actMarkOf(marks, competence.polityId, "spending", officeId);
  const spent = mark === undefined || world.elapsedStep - mark.sinceStep >= SPENDING_YEAR_DAYS ? 0 : mark.total;
  if (line.grade === "alone" || line.grade === "with_colleague") {
    if (line.within === null) return { amount: null, spent, left: null, grade: line.grade, body: line.body };
    const amount = Math.round(line.within * monthlyTakings(world, competence.polityId));
    return { amount, spent, left: Math.max(0, amount - spent), grade: line.grade, body: line.body };
  }
  return { amount: 0, spent, left: 0, grade: line.grade, body: line.body };
}
