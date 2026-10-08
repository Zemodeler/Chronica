import { allOffices, allSuccessionRules, type Character, type Office, type SuccessionRule } from "../characters/character";
import { computeOpinion, opinionLabel } from "../characters/opinion";
import { entityKey, type Linked } from "../knowledge/glossary";
import type { GovernmentInstitution } from "../material-state";
import { readTheRegions } from "../material/regions-view";
import type { Books } from "../material/books";
import { GOVERNMENT_FORM_IN_WORDS, chamberHolds, type ChamberPower } from "../political-parts";
import { SPENDING_YEAR_DAYS } from "../world/act-marks";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import { leverDefinition, readDepartments, type LeverId } from "../world/departments";
import type { WorldState } from "../world/world-state";
import type { Administration } from "./administration";
import { ACT_KINDS, ACT_WORDS, type ActKind, type CompetenceGrade } from "./charge-vocabulary";
import { competenceOf, monthlyTakings, spendingAllowance, type ActCompetence, type Competence } from "./competence";

/**
 * The office as its holder sees it (docs/plans/government.md, "H5 as built"; plan section E).
 *
 * One reading of the state for whichever office a man holds, or none: the charge (what he may do alone, with his colleague, only by a
 * chamber, and what is not his), the bodies he sits in or answers to, the men who hold the charges beside him and beneath him, the
 * accounts of his charge, and the acts open to him written as the orders the desk already takes. Nothing here is stored, and nothing is
 * decided here: it is `competenceOf`, the departments, the seats, the chambers' questions and the log of what the magistrates did, read
 * once more, in the words of the age. A reform, a coup or a vacated seat changes it at once, because they change what it reads.
 *
 * There is no advice in it. It says what is his, what is another's and what the others have lately done; it does not say what he ought to do.
 */

// ── The shapes ──────────────────────────────────────────────────────────────

export type OfficeRole = "head" | "magistrate" | "tribune" | "priest" | "member" | "private";
export type OfficeStyle = "king" | "college" | "republic" | "league" | "tribal" | "temple" | "none";

export interface ActLine {
  readonly act: ActKind;
  /** "Lay the rate of the tribute". */
  readonly deed: string;
  readonly grade: CompetenceGrade;
  /** "Yours alone", "With your colleague", "Laid before the Senate", "Not yours". */
  readonly stand: string;
  readonly within: number | null;
  /** "to 12 in a hundred", "to 2 months of what the state takes in (about 1,200,000 drachmae)". Null where there is no figure. */
  readonly withinWords: string | null;
  readonly beyond: "by_the_body" | "forbidden" | null;
  /** "Past that it is the Senate's." */
  readonly beyondWords: string | null;
  /** The chamber the act is laid before, where one decides it. */
  readonly body: string | null;
  /** Who may stop it once done: "Tribune of the plebs", "your colleague". */
  readonly stoppedBy: readonly string[];
  /** Where the act stands now, for the two that have a rate: "now 10 in a hundred". */
  readonly now: string | null;
  /** The sentence of the age that says it (`competenceOf`). */
  readonly sentence: string;
}

export interface ChargeAllowance {
  readonly amount: number | null;
  readonly spent: number;
  readonly left: number | null;
  readonly body: string | null;
  /** "He may draw 1,200,000 drachmae in a year on his own word; 300,000 is drawn, 900,000 is left." */
  readonly words: string;
}

export interface LeverReading {
  readonly lever: string;
  readonly words: string;
  /** The skill of the men who keep it, 0 to 100. */
  readonly skill: number;
  readonly skillWords: string;
  /** What the man who holds the charge does by himself in it, where there is a routine. */
  readonly byRule: string | null;
}

export interface ChargeView {
  readonly officeId: string;
  readonly label: string;
  readonly kind: "magistracy" | "membership" | "priesthood";
  readonly head: boolean;
  readonly collegial: boolean;
  readonly seats: number;
  /** The others who hold the same office. */
  readonly colleagues: readonly Linked[];
  readonly holding: {
    /** "Elected by the Centuriate Assembly". */
    readonly how: string | null;
    /** "a year", "18 months". */
    readonly term: string | null;
    readonly until: string | null;
    readonly daysLeft: number | null;
    /** The man chosen to follow him, where one is. */
    readonly designate: string | null;
  };
  readonly acts: readonly ActLine[];
  readonly alone: readonly ActLine[];
  readonly withColleague: readonly ActLine[];
  readonly byTheBody: readonly ActLine[];
  readonly forbidden: readonly ActLine[];
  /** What his word stops when another does it: a tribune's. */
  readonly mayStop: readonly string[];
  /** The same, as the acts themselves. */
  readonly stopsActs: readonly ActKind[];
  readonly allowance: ChargeAllowance | null;
  readonly levers: readonly LeverReading[];
  readonly department: { readonly key: string; readonly name: string } | null;
  /** One sentence for the head of the page. */
  readonly summary: string;
}

export type BodyRelation = "sits" | "convenes" | "elects you" | "answers to" | "counsels you" | "lays before" | "citizen";

export interface OpenQuestion {
  readonly key: string;
  readonly label: string;
  readonly deadline: string | null;
  readonly yours: boolean;
  /** "For 12, against 7": only for those who sit in the body or are party to the matter. */
  readonly tally: string | null;
  readonly concerns: readonly string[];
}

export interface BodyView {
  readonly id: string;
  readonly name: string;
  /** "a council", "an assembly of the citizens". */
  readonly kindWords: string;
  readonly advisory: boolean;
  /** What it may decide, in the words of the age. */
  readonly powers: readonly string[];
  readonly relations: readonly BodyRelation[];
  /** "You sit in it as a Roman senator." */
  readonly yourSeat: string | null;
  /** What he must lay before it. */
  readonly holds: readonly { readonly deed: string; readonly when: string }[];
  readonly open: readonly OpenQuestion[];
  readonly openCount: number;
  /** The last few questions it settled, and how. */
  readonly lately: readonly { readonly label: string; readonly outcome: string; readonly when: string | null; readonly why: string | null }[];
  readonly note: string | null;
}

export interface ReachView {
  readonly officeId: string;
  readonly label: string;
  readonly holders: readonly Linked[];
  readonly count: number;
  /** What he may stop of the man's: "the levy, the purse". */
  readonly stops: readonly string[];
  readonly sentence: string;
}

export type NeighbourRelation = "colleague" | "above" | "beside" | "beneath" | "counsel";

export interface NeighbourHolder {
  readonly person: Linked;
  /** How he stands towards you, in a word: "friendly". */
  readonly toYou: string;
  /** How you stand towards him. */
  readonly yours: string;
  /** What he last did in his charge, with the day. */
  readonly lastDone: { readonly text: string; readonly when: string | null } | null;
}

export interface OfficeNeighbour {
  readonly officeId: string;
  readonly label: string;
  readonly relation: NeighbourRelation;
  readonly seats: number;
  readonly holders: readonly NeighbourHolder[];
  /** Holders not listed. */
  readonly more: number;
  /** What the charge keeps by rule, in a sentence each. */
  readonly keeps: readonly string[];
}

export interface AccountsView {
  readonly currency: string;
  readonly chests: readonly { readonly label: string; readonly balance: number }[];
  readonly monthlyIn: number | null;
  readonly monthlyOut: number | null;
  readonly runsOutInDays: number | null;
  readonly departments: readonly {
    readonly key: string;
    readonly name: string;
    readonly issue: string | null;
    readonly works: readonly { readonly label: string; readonly detail: string; readonly stalled: boolean }[];
    readonly spending: readonly string[];
  }[];
  /** Where the books themselves are: the tab of the ledger stand to open. */
  readonly links: readonly { readonly label: string; readonly tab: string; readonly key?: string }[];
}

export interface ActDraft {
  readonly key: string;
  /** An act of his own, or a word that stops another man's (a tribune's). */
  readonly kind: "act" | "stop";
  readonly act: ActKind;
  readonly deed: string;
  readonly grade: CompetenceGrade;
  /** The chamber it is laid before, where it goes to one (always, or past his figure). */
  readonly body: string | null;
  /** The order as it is written where he may do it himself; null where it can only be laid before the chamber. */
  readonly direct: string | null;
  /** The order as it is written to lay it before the chamber. Null where no chamber holds it. */
  readonly laid: string | null;
  /** The most he may do himself, in the figure's own unit; null where there is no figure to stay within. */
  readonly max: number | null;
  /** What the order wants filled in before it is drafted. */
  readonly needs: { readonly power: boolean; readonly figure: { readonly label: string; readonly unit: string; readonly initial: number; readonly step: number } | null };
  /** One line under the button. */
  readonly note: string;
  /** The order stops at an open phrase, to be finished at the desk. */
  readonly open: boolean;
}

export interface PrivateReading {
  readonly noCharge: string;
  /** What a private man is bound by, in short. */
  readonly boundBy: readonly string[];
  /** The chambers a patron could move, and through whom. */
  readonly movedBy: readonly { readonly body: string; readonly through: string; readonly holders: readonly Linked[] }[];
}

export interface OfficeView {
  readonly characterId: string;
  readonly polityId: string | null;
  readonly polityLabel: string | null;
  /** "a republic of the great houses". */
  readonly form: string | null;
  readonly role: OfficeRole;
  readonly style: OfficeStyle;
  readonly headings: { readonly charge: string; readonly bodies: string; readonly neighbours: string; readonly accounts: string; readonly acts: string };
  /** The charges he holds: a magistracy, a head of state, the head of a temple. */
  readonly charges: readonly ChargeView[];
  /** The seats he holds that are a voice in a body and carry no charge. */
  readonly seats: readonly { readonly officeId: string; readonly label: string; readonly body: string | null }[];
  readonly bodies: readonly BodyView[];
  /** Those whose word stops his: the tribunes, the augurs. */
  readonly reach: readonly ReachView[];
  readonly neighbours: readonly OfficeNeighbour[];
  readonly accounts: AccountsView | null;
  readonly drafts: readonly ActDraft[];
  readonly private: PrivateReading | null;
}

export interface OfficeViewOptions {
  /** The books he keeps for others (`readTheBooks(..., "kept")`), where the caller has them already. */
  readonly books?: Books | undefined;
  /** The departments of his state (`readAdministration`), where the caller has them already. */
  readonly administration?: Administration | undefined;
}

// ── Words ──────────────────────────────────────────────────────────────────

const POWER_WORDS: Readonly<Record<ChamberPower, string>> = {
  laws: "the laws",
  war: "war",
  taxes: "the tribute",
  elections: "the elections",
  constitution: "the ways of the state",
  judgment: "judgment",
  coinage: "the coin",
  treaties: "treaties",
  finance: "the purse",
  levy: "the levy",
};
const POWER_ORDER: readonly ChamberPower[] = ["war", "treaties", "taxes", "finance", "coinage", "levy", "laws", "elections", "judgment", "constitution"];

const FRANCHISE_WORDS: Readonly<Record<string, string>> = {
  council: "a council",
  citizens: "an assembly of the citizens",
  soldiers: "an assembly of soldiers",
  chiefs: "a gathering of chiefs",
  cities: "a gathering of the cities",
  priests: "a college of priests",
};

const STOP_WORDS: Readonly<Partial<Record<ActKind, string>>> = {
  tax_rate: "the tribute",
  customs: "the customs",
  coinage: "the coin",
  loans: "loans",
  grain: "bread",
  levy: "the levy",
  appointment: "the naming of men to office",
  spending: "the purse",
};

/** What the man who holds a lever does by himself, where a routine keeps it (`sim/magistrates.ts`, `sim/fiscal-officers.ts`). */
const BY_RULE: Readonly<Record<string, string>> = {
  tax_roll: "sets the rate of the tribute within custom, and lays a heavier one before the chamber",
  customs: "sets the customs within custom",
  credit: "borrows within his figure when the chest runs low",
  mint: "moves lighter coin before the chamber in extremity",
  grain: "watches the price of grain and gives out bread in a dearth",
  levy: "holds the levy when the host stands thin",
  supply: "buys bread for the armies that have eaten what they carried",
  courts: "brings a case against a man found with his hand in the chest",
  public_rites: "keeps the festival of the year",
  census: "takes the roll of the people every fifth year",
  foreign_letters: "sends letters asking for peace when the war goes ill",
  public_works_cost: "keeps the works of the state in repair",
};

const upper = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
const withoutThe = (name: string): string => name.replace(/^the\s+/iu, "");
const theBody = (name: string): string => `the ${withoutThe(name)}`;
const money = (amount: number): string => Math.round(amount).toLocaleString("en-GB");
const percent = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)} in a hundred`;
const months = (count: number): string => `${count} ${count === 1 ? "month" : "months"}`;
const listed = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function skillWords(skill: number): string {
  if (skill >= 80) return "very able";
  if (skill >= 65) return "able";
  if (skill >= 45) return "middling";
  if (skill >= 30) return "poor";
  return "ill suited";
}

function termWords(days: number): string {
  if (days % 365 === 0) return days === 365 ? "a year" : `${days / 365} years`;
  if (days >= 330 && days <= 400) return "about a year";
  return days > 60 ? `${Math.round(days / 30)} months` : `${days} days`;
}

const STAND: Readonly<Record<CompetenceGrade, (body: string | null) => string>> = {
  alone: () => "Yours alone",
  with_colleague: () => "With your colleague",
  by_the_body: (body) => (body === null ? "Laid before the chamber" : `Laid before ${theBody(body)}`),
  forbidden: () => "Not yours",
};

const GRADE_ORDER: Readonly<Record<CompetenceGrade, number>> = { alone: 0, with_colleague: 1, by_the_body: 2, forbidden: 3 };

// ── Reading ────────────────────────────────────────────────────────────────

const NO_OFFICES: readonly Office[] = [];

interface Context {
  readonly world: WorldState;
  readonly characterId: string;
  readonly me: Character;
  readonly polityId: string;
  readonly polityName: string;
  readonly offices: readonly Office[];
  readonly office: ReadonlyMap<string, Office>;
  readonly rules: ReadonlyMap<string, SuccessionRule>;
  readonly clock: ScenarioClock | undefined;
  readonly currency: string;
  readonly takings: number;
}

function dateOf(ctx: Pick<Context, "clock">, day: number): string | null {
  return ctx.clock === undefined ? null : formatWorldDate({ day, minute: 0 }, ctx.clock);
}

const personLink = (world: WorldState, id: string): Linked => ({ label: world.characters.find((character) => character.id === id)?.name ?? "someone", key: entityKey("person", id) });

/** The chambers of a power that hold a power in the age's sense, in the order a reader looks for them. */
function chambersOf(world: WorldState, polityId: string): readonly GovernmentInstitution[] {
  return world.material.institutions.filter((institution) => institution.polityId === polityId);
}

const stem = (word: string): string => word.toLowerCase().replace(/[^a-z]/g, "").slice(0, 4);
const STOPWORDS = new Set(["of", "the", "and", "a", "to", "in", "carthaginian", "roman", "syracusan"]);

/** The chamber a membership office is a seat in: by what the two are called, failing that the one council the power has. */
function chamberOfSeat(office: Office, chambers: readonly GovernmentInstitution[], constitutionRuler: boolean): GovernmentInstitution | null {
  if (chambers.length === 0) return null;
  const wanted = new Set(office.label.split(/\s+/u).filter((word) => !STOPWORDS.has(word.toLowerCase())).map(stem).filter((word) => word.length >= 4));
  let best: GovernmentInstitution | null = null;
  let bestScore = 0;
  for (const chamber of chambers) {
    const score = chamber.name.split(/\s+/u).filter((word) => !STOPWORDS.has(word.toLowerCase())).map(stem).filter((word) => wanted.has(word)).length;
    if (score > bestScore) { best = chamber; bestScore = score; }
  }
  if (best !== null) return best;
  const councils = chambers.filter((chamber) => chamber.franchise === "council");
  // A king's friends sit in his council whatever it is called; any other seat goes to the council that decides.
  const preferred = constitutionRuler ? councils.find((chamber) => chamber.advisory === true) : councils.find((chamber) => chamber.advisory !== true && !(chamber.powers?.length === 1 && chamber.powers[0] === "judgment"));
  return preferred ?? councils[0] ?? chambers[0] ?? null;
}

const OPEN_STAGES = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

/** The acts a body decides that his charges must lay before it, with the figure past which it does. */
function holdsFor(charges: readonly ChargeView[], bodyId: string, bodies: ReadonlyMap<string, string>): { readonly deed: string; readonly when: string }[] {
  const found = new Map<ActKind, { deed: string; when: string }>();
  for (const charge of charges) {
    for (const line of charge.acts) {
      if (line.body === null || bodies.get(line.act) !== bodyId) continue;
      if (line.grade === "by_the_body") found.set(line.act, { deed: line.deed, when: "always" });
      else if (line.beyond === "by_the_body" && line.within !== null && !found.has(line.act)) found.set(line.act, { deed: line.deed, when: line.withinWords === null ? "past his figure" : `past what he may do alone (${line.withinWords.replace(/^, /, "")})` });
    }
  }
  return [...found.values()];
}

/**
 * The office a man holds, as he sees it: the charge, the bodies, the men beside and beneath him, the accounts, the acts open to him.
 * A man with no office gets the short view of what binds him (`private`). A power with no constitution on record has no competence to read, and
 * says so; the offices and the bodies are shown as they stand.
 */
export function readOffice(
  world: WorldState,
  characterId: string,
  scenarioOffices: readonly Office[] = NO_OFFICES,
  clock?: ScenarioClock,
  successionRules: readonly SuccessionRule[] = [],
  options: OfficeViewOptions = {},
): OfficeView {
  const me = world.characters.find((character) => character.id === characterId);
  const emptyHeadings = headingsFor("none");
  const none: OfficeView = {
    characterId, polityId: null, polityLabel: null, form: null, role: "private", style: "none", headings: emptyHeadings,
    charges: [], seats: [], bodies: [], reach: [], neighbours: [], accounts: null, drafts: [], private: null,
  };
  if (me === undefined || me.polityId === null) return none;
  const polity = world.map.polities.find((candidate) => candidate.id === me.polityId);
  if (polity === undefined) return none;

  const offices = allOffices(world, scenarioOffices);
  const ctx: Context = {
    world, characterId, me, polityId: polity.id, polityName: polity.name, offices,
    office: new Map(offices.map((office) => [office.id, office])),
    rules: new Map(allSuccessionRules(world, successionRules).map((rule) => [rule.id, rule])),
    clock, currency: world.material.currency.name, takings: monthlyTakings(world, polity.id),
  };
  const constitution = world.constitutions.find((record) => record.polityId === polity.id);
  const style = styleOf(constitution?.form ?? null, constitution?.rulerOfficeId != null && competenceOf(world, constitution.rulerOfficeId, scenarioOffices)?.collegial === true);
  const chambers = chambersOf(world, polity.id);

  // The offices he holds now, the highest first.
  const held = world.material.officeSeats
    .filter((seat) => seat.status === "held" && seat.holderCharacterId === characterId)
    .flatMap((seat) => {
      const office = ctx.office.get(seat.officeId);
      return office === undefined || office.polityId !== polity.id || office.successionRuleId === "abolished" ? [] : [{ office, seat }];
    })
    .sort((a, b) => (b.office.rank ?? 0) - (a.office.rank ?? 0) || a.office.id.localeCompare(b.office.id));

  const rulerId = constitution?.rulerOfficeId ?? null;
  const heldCharges = held.filter(({ office }) => {
    if (office.kind === "membership") return false;
    if (office.kind === "priesthood") return office.id === rulerId || competenceOf(world, office.id, scenarioOffices)?.mayStop.length !== 0;
    return true;
  });
  const charges = heldCharges.map(({ office, seat }) => chargeOf(ctx, office, seat, scenarioOffices, options)).filter((charge): charge is ChargeView => charge !== null);
  const seats = held
    .filter(({ office }) => !heldCharges.some((entry) => entry.office.id === office.id))
    .map(({ office }) => ({ officeId: office.id, label: office.label, body: chamberOfSeat(office, chambers, false)?.name ?? null }));

  const role = roleOf(charges, held.map(({ office }) => office), rulerId);
  const stoppers = reachOf(ctx, charges, scenarioOffices);
  const bodies = bodiesOf(ctx, charges, held.map(({ office }) => office), chambers, constitution?.sovereignInstitutionId ?? null, rulerId, scenarioOffices);
  const neighbours = charges.length === 0 && role !== "member" ? [] : neighboursOf(ctx, charges, held.map(({ office }) => office), chambers, rulerId, scenarioOffices);
  const accounts = charges.length === 0 ? null : accountsOf(ctx, charges, options);
  const drafts = draftsOf(ctx, charges);

  return {
    characterId,
    polityId: polity.id,
    polityLabel: polity.name,
    form: constitution === undefined ? null : GOVERNMENT_FORM_IN_WORDS[constitution.form],
    role,
    style,
    headings: headingsFor(style),
    charges,
    seats,
    bodies,
    reach: stoppers,
    neighbours,
    accounts,
    drafts,
    private: role === "private" || charges.length === 0 && seats.length === 0 ? privateOf(ctx, chambers, scenarioOffices) : null,
  };
}

function styleOf(form: string | null, collegialHead: boolean): OfficeStyle {
  switch (form) {
    case "monarchy": return "king";
    case "oligarchic_republic":
    case "popular_republic": return collegialHead ? "college" : "republic";
    case "league": return "league";
    case "tribal_confederation": return "tribal";
    case "temple_state": return "temple";
    case "soldier_commune": return "republic";
    default: return "none";
  }
}

function headingsFor(style: OfficeStyle): OfficeView["headings"] {
  switch (style) {
    case "king":
      return { charge: "Your charge", bodies: "Your friends and the assemblies", neighbours: "Your friends and your officers", accounts: "The royal chest", acts: "What you may command" };
    case "college":
      return { charge: "Your charge", bodies: "The chambers you sit in and answer to", neighbours: "Your colleague and the magistrates", accounts: "The accounts of your charge", acts: "What you may do, and what you may move" };
    case "league":
      return { charge: "Your charge", bodies: "The assembly and the council", neighbours: "The strategoi and the officers", accounts: "The accounts of your charge", acts: "What you may do, and what you may move" };
    case "tribal":
      return { charge: "Your standing among the chiefs", bodies: "The gathering and the council of elders", neighbours: "The chiefs and your retinue", accounts: "What your retinue keeps", acts: "What you may do" };
    case "temple":
      return { charge: "Your charge", bodies: "The college and the temple's council", neighbours: "Those who serve with you", accounts: "The temple's accounts", acts: "What you may do" };
    default:
      return { charge: "Your charge", bodies: "The chambers you sit in and answer to", neighbours: "Your colleagues and the magistrates", accounts: "The accounts of your charge", acts: "What you may do, and what you may move" };
  }
}

function roleOf(charges: readonly ChargeView[], held: readonly Office[], rulerId: string | null): OfficeRole {
  if (charges.some((charge) => charge.head || charge.officeId === rulerId)) return "head";
  if (held.some((office) => office.tribunician === true)) return "tribune";
  if (charges.some((charge) => charge.kind === "magistracy")) return "magistrate";
  if (charges.some((charge) => charge.kind === "priesthood")) return "priest";
  if (held.length > 0) return "member";
  return "private";
}

// ── The charge ─────────────────────────────────────────────────────────────

function nowOf(ctx: Context, act: ActKind): string | null {
  if (act !== "tax_rate" && act !== "customs") return null;
  const regions = readTheRegions(ctx.world, ctx.polityId, false);
  if (regions === null) return null;
  if (act === "customs") return regions.customsRateBps > 0 ? `now ${percent(regions.customsRateBps)}` : "none laid now";
  return `now ${percent(regions.defaultPolicy.rateBps)}`;
}

function figureWords(ctx: Context, act: ActKind, within: number | null): string | null {
  if (within === null) return null;
  switch (act) {
    case "tax_rate": return `to ${percent(within)}`;
    case "customs": return `to a tariff of ${percent(within)}`;
    case "coinage": return within === 0 ? "but not to change the silver" : `by no more than ${percent(within)} of its silver`;
    case "loans":
    case "grain":
    case "spending": {
      const sum = Math.round(within * ctx.takings);
      return `to ${months(within)} of what the state takes in${sum > 0 ? ` (about ${money(sum)} ${ctx.currency})` : ""}${act === "spending" ? " in a year" : ""}`;
    }
    default: return null;
  }
}

function colleagueOf(competence: Competence): string | null {
  return competence.collegial ? "your colleague" : null;
}

function lineOf(ctx: Context, competence: Competence, act: ActKind, stoppers: ReadonlyMap<ActKind, readonly string[]>): ActLine {
  const line: ActCompetence = competence.acts[act];
  const within = line.within;
  const stopped = [...(line.grade === "forbidden" ? [] : stoppers.get(act) ?? [])];
  const colleague = colleagueOf(competence);
  if (colleague !== null && (line.grade === "alone" || line.grade === "with_colleague")) stopped.unshift(colleague);
  const body = line.body?.name ?? null;
  const beyond = within !== null && (line.grade === "alone" || line.grade === "with_colleague") ? line.beyond : null;
  return {
    act,
    deed: upper(ACT_WORDS[act]),
    grade: line.grade,
    stand: STAND[line.grade](line.grade === "by_the_body" ? body : null),
    within,
    withinWords: line.grade === "forbidden" ? null : figureWords(ctx, act, within),
    beyond,
    beyondWords: beyond === null ? null : beyond === "by_the_body" && body !== null ? `Past that it is laid before ${theBody(body)}.` : "Past that it is not yours.",
    body: line.grade === "forbidden" && line.body === null ? null : body,
    stoppedBy: stopped,
    now: line.grade === "forbidden" ? null : nowOf(ctx, act),
    sentence: line.why,
  };
}

/** The offices of the power that may stop an act of another man's, and what each stops. */
function stoppersOf(ctx: Context, scenarioOffices: readonly Office[]): Map<ActKind, string[]> {
  const found = new Map<ActKind, string[]>();
  for (const office of ctx.offices) {
    if (office.polityId !== ctx.polityId || office.successionRuleId === "abolished") continue;
    const competence = competenceOf(ctx.world, office.id, scenarioOffices);
    if (competence === null) continue;
    for (const act of competence.mayStop) {
      const list = found.get(act) ?? [];
      if (!list.includes(office.label)) list.push(office.label);
      found.set(act, list);
    }
  }
  return found;
}

function chargeOf(ctx: Context, office: Office, seat: WorldState["material"]["officeSeats"][number], scenarioOffices: readonly Office[], options: OfficeViewOptions): ChargeView | null {
  const competence = competenceOf(ctx.world, office.id, scenarioOffices);
  const rule = ctx.rules.get(office.successionRuleId);
  const chambers = chambersOf(ctx.world, ctx.polityId);
  const filler = rule?.institutionId == null ? null : chambers.find((chamber) => chamber.id === rule.institutionId)?.name ?? null;
  const how = rule === undefined ? null : rule.kind === "elective" && filler !== null ? `Elected by ${theBody(filler)}`
    : rule.kind === "primogeniture" ? "By birth, from father to son"
      : rule.kind === "seniority" ? "By seniority"
        : rule.kind === "appointment" ? "By appointment"
          : rule.label;
  const designate = seat.designateCharacterId == null ? null : ctx.world.characters.find((character) => character.id === seat.designateCharacterId)?.name ?? null;
  const daysLeft = seat.termExpiresAtStep === null ? null : Math.max(0, seat.termExpiresAtStep - ctx.world.elapsedStep);
  const seatCount = Math.max(office.seatCount ?? 1, ctx.world.material.officeSeats.filter((entry) => entry.officeId === office.id).length);
  const colleagues = ctx.world.material.officeSeats
    .filter((entry) => entry.officeId === office.id && entry.status === "held" && entry.holderCharacterId !== null && entry.holderCharacterId !== ctx.characterId)
    .map((entry) => personLink(ctx.world, entry.holderCharacterId!));
  const kind = office.kind ?? "magistracy";

  const stoppers = stoppersOf(ctx, scenarioOffices);
  const acts = competence === null ? [] : ACT_KINDS.map((act) => lineOf(ctx, competence, act, stoppers));
  const allowance = competence === null ? null : allowanceOf(ctx, office, scenarioOffices);

  // The levers he works at, from the departments he staffs.
  const departments = ctx.world.departments.filter((department) => department.abolishedAtStep === null && department.formsAtStep <= ctx.world.elapsedStep
    && department.scope.kind === "polity" && department.scope.id === ctx.polityId && (department.officeIds.includes(office.id) || department.headOfficeId === office.id));
  const reader = readDepartments(ctx.world);
  const seenLevers = new Set<string>();
  const levers: LeverReading[] = [];
  for (const department of departments) {
    for (const lever of department.levers) {
      if (seenLevers.has(lever)) continue;
      seenLevers.add(lever);
      const skill = Math.round(reader.skill({ kind: "polity", id: ctx.polityId }, lever as LeverId));
      levers.push({ lever, words: leverDefinition(lever as LeverId).words, skill, skillWords: skillWords(skill), byRule: BY_RULE[lever] ?? null });
    }
  }
  const department = departments[0] === undefined ? null : { key: departments[0].id, name: departments[0].name };
  const head = competence?.isHead ?? false;
  const grouped = (grade: CompetenceGrade): ActLine[] => acts.filter((line) => line.grade === grade);

  const summary = competence === null
    ? `${office.label} is held here, and the ways of ${ctx.polityName} do not say what its charge is.`
    : summaryOf(office.label, head, competence, acts);
  return {
    officeId: office.id,
    label: office.label,
    kind,
    head,
    collegial: competence?.collegial ?? seatCount > 1,
    seats: seatCount,
    colleagues,
    holding: {
      how,
      term: office.termDays == null ? null : termWords(office.termDays),
      until: seat.termExpiresAtStep === null ? null : dateOf(ctx, seat.termExpiresAtStep),
      daysLeft,
      designate,
    },
    acts,
    alone: grouped("alone"),
    withColleague: grouped("with_colleague"),
    byTheBody: grouped("by_the_body"),
    forbidden: grouped("forbidden"),
    mayStop: competence === null ? [] : competence.mayStop.map((act) => STOP_WORDS[act] ?? ACT_WORDS[act]),
    stopsActs: competence === null ? [] : competence.mayStop,
    allowance,
    levers,
    department,
    summary,
  };
}

function summaryOf(label: string, head: boolean, competence: Competence, acts: readonly ActLine[]): string {
  const own = acts.filter((line) => line.grade === "alone" || line.grade === "with_colleague");
  const laid = acts.filter((line) => line.grade === "by_the_body");
  if (competence.mayStop.length > 0 && own.length === 0) return `${label} holds no charge of the purse or the treaties; his word stops what other magistrates do.`;
  if (own.length === acts.length) return `${label} decides everything alone: there is no chamber that holds any of it from him.`;
  if (own.length === 0 && laid.length === 0) return `${label} has no part in the state's money or treaties; the charge is a voice and a seat.`;
  const mine = own.map((line) => line.deed.charAt(0).toLowerCase() + line.deed.slice(1));
  return `${label}${head ? ", at the head of the state," : ""} may ${mine.length === 0 ? "do none of these himself" : `${listed(mine.slice(0, 4))}${mine.length > 4 ? " and more" : ""}`}${laid.length === 0 ? "." : `; he may move ${laid.length} more before the chamber.`}`;
}

function allowanceOf(ctx: Context, office: Office, scenarioOffices: readonly Office[]): ChargeAllowance | null {
  const base = spendingAllowance(ctx.world, office.id, scenarioOffices);
  if (base === null) return null;
  const body = base.body?.name ?? null;
  let words: string;
  if (base.grade === "by_the_body" || base.grade === "forbidden" || base.amount === 0) {
    words = body === null ? "He may draw nothing on his own word." : `He may draw nothing on his own word: every sum is laid before ${theBody(body)}.`;
  } else if (base.amount === null) {
    words = "No chamber limits what he draws; the chest is his to spend.";
  } else {
    words = `He may draw ${money(base.amount)} ${ctx.currency} in a year on his own word (a year is counted from the first draw, ${SPENDING_YEAR_DAYS} days); ${money(base.spent)} is drawn, ${money(base.left ?? 0)} is left.${body === null ? "" : ` More is laid before ${theBody(body)}.`}`;
  }
  return { amount: base.amount, spent: base.spent, left: base.left, body, words };
}

// ── Bodies ─────────────────────────────────────────────────────────────────

function powersOf(chamber: GovernmentInstitution): string[] {
  return POWER_ORDER.filter((power) => chamberHolds(chamber.powers, power)).map((power) => POWER_WORDS[power]);
}

function bodiesOf(
  ctx: Context,
  charges: readonly ChargeView[],
  held: readonly Office[],
  chambers: readonly GovernmentInstitution[],
  sovereignId: string | null,
  rulerId: string | null,
  scenarioOffices: readonly Office[],
): BodyView[] {
  const { world } = ctx;
  const heldIds = new Set(held.map((office) => office.id));
  const isRuler = rulerId !== null && heldIds.has(rulerId);
  const judgmentOnly = (chamber: GovernmentInstitution): boolean => chamber.powers !== undefined && chamber.powers.length > 0 && chamber.powers.every((power) => power === "judgment");
  const anyJudges = chambers.some(judgmentOnly);
  const relations = new Map<string, Set<BodyRelation>>();
  const seatNotes = new Map<string, string>();
  const add = (chamberId: string, relation: BodyRelation): void => {
    const known = relations.get(chamberId);
    if (known === undefined) relations.set(chamberId, new Set([relation]));
    else known.add(relation);
  };
  for (const office of held) {
    if (office.kind === "membership") {
      const chamber = chamberOfSeat(office, chambers, isRuler);
      if (chamber !== null) { add(chamber.id, "sits"); seatNotes.set(chamber.id, `You sit in it as ${withArticle(office.label)}.`); }
    }
    const rule = ctx.rules.get(office.successionRuleId);
    if (rule?.kind === "elective" && rule.institutionId !== null && chambers.some((chamber) => chamber.id === rule.institutionId)) add(rule.institutionId, "elects you");
    for (const chamber of chambers) if (chamber.convenedByOfficeIds?.includes(office.id) === true) add(chamber.id, "convenes");
  }
  if (held.length > 0) {
    // He answers to the court that tries men of his rank, or where there is none to the chamber that rules the state.
    for (const chamber of chambers) {
      if (judgmentOnly(chamber)) add(chamber.id, "answers to");
      else if (!anyJudges && chamber.id === sovereignId && chamber.advisory !== true) add(chamber.id, "answers to");
    }
  }
  if (isRuler) for (const chamber of chambers) if (chamber.advisory === true && chamber.franchise === "council") add(chamber.id, "counsels you");
  if (held.length === 0) {
    for (const chamber of chambers) if (chamber.franchise === "citizens" && chamber.advisory !== true && ctx.me.legalStatus === "free") add(chamber.id, "citizen");
  }
  if (relations.size === 0) return [];

  // The chamber each act is laid before, for his own `holds` list.
  const bodyOfAct = new Map<ActKind, string>();
  for (const charge of charges) for (const line of charge.acts) if (line.body !== null && !bodyOfAct.has(line.act)) {
    const competence = competenceOf(world, charge.officeId, scenarioOffices);
    const id = competence?.acts[line.act].body?.id;
    if (id !== undefined) bodyOfAct.set(line.act, id);
  }
  // A chamber that holds an act of his charge is one he lays matters before, whether or not he sits in it.
  if (held.length > 0) for (const id of new Set(bodyOfAct.values())) add(id, "lays before");
  const heldQuestionAccess = new Set([...relations].filter(([, kinds]) => kinds.has("sits") || kinds.has("convenes")).map(([id]) => id));

  const resolvedStages = new Set(["resolved", "blocked", "withdrawn"]);
  const out: BodyView[] = [];
  for (const chamber of chambers) {
    const kinds = relations.get(chamber.id);
    if (kinds === undefined) continue;
    const open = world.material.politicalProcedures
      .filter((procedure) => procedure.institutionId === chamber.id && OPEN_STAGES.has(procedure.stage))
      .sort((a, b) => a.openedAtStep - b.openedAtStep || a.id.localeCompare(b.id));
    const knowsTally = heldQuestionAccess.has(chamber.id);
    const questions: OpenQuestion[] = open.slice(0, 6).map((procedure) => {
      const yours = procedure.sponsorCharacterId === ctx.characterId;
      let tally: string | null = null;
      if (knowsTally || yours) {
        const positions = world.material.supportPositions.filter((position) => position.procedureId === procedure.id);
        const weigh = (choice: string): number => positions.filter((position) => position.position === choice).reduce((sum, position) => sum + position.influenceWeight, 0);
        const forIt = weigh("support");
        const against = weigh("oppose");
        tally = forIt + against === 0 ? "Nobody has declared yet." : `For ${forIt}, against ${against}.`;
      }
      return { key: procedure.id, label: procedure.label, deadline: procedure.deadlineStep === null ? null : dateOf(ctx, procedure.deadlineStep), yours, tally, concerns: (procedure.concerns ?? []).map((concern) => concern.replace(/_/g, " ")) };
    });
    const lately = world.material.politicalProcedures
      .filter((procedure) => procedure.institutionId === chamber.id && resolvedStages.has(procedure.stage) && procedure.resolvedAtStep !== null)
      .sort((a, b) => b.resolvedAtStep! - a.resolvedAtStep! || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((procedure) => ({
        label: procedure.label,
        outcome: procedure.outcome === "passed" ? "carried" : procedure.outcome === "failed" ? "refused" : procedure.stage === "withdrawn" ? "withdrawn" : "stopped",
        when: dateOf(ctx, procedure.resolvedAtStep!),
        why: procedure.outcomeReason,
      }));
    const advisory = chamber.advisory === true;
    out.push({
      id: chamber.id,
      name: chamber.name,
      kindWords: FRANCHISE_WORDS[chamber.franchise ?? ""] ?? "a chamber",
      advisory,
      powers: powersOf(chamber),
      relations: [...kinds].sort(),
      yourSeat: seatNotes.get(chamber.id) ?? null,
      holds: holdsFor(charges, chamber.id, bodyOfAct),
      open: questions,
      openCount: open.length,
      lately,
      note: advisory
        ? (kinds.has("counsels you") ? "Its word is counsel. You decide; one who overrules his friends against their counsel pays for it in the trust of his people." : "Its word is counsel and binds nobody.")
        : judgmentOnly(chamber) ? "It tries the magistrates and the generals when their charge is done."
          : chamber.refersFailuresTo != null ? `A question it refuses goes on to ${theBody(chambers.find((other) => other.id === chamber.refersFailuresTo)?.name ?? "the people")}.` : null,
    });
  }
  return out.sort((a, b) => bodyRank(b) - bodyRank(a) || a.name.localeCompare(b.name));
}

const bodyRank = (body: BodyView): number => body.relations.length * 10 + (body.holds.length > 0 ? 5 : 0) + (body.advisory ? 0 : 1);

const withArticle = (label: string): string => (/^[aeiou]/iu.test(label) ? `an ${label}` : `a ${label}`);

function reachOf(ctx: Context, charges: readonly ChargeView[], scenarioOffices: readonly Office[]): ReachView[] {
  const mine = new Set<ActKind>();
  for (const charge of charges) for (const line of charge.acts) if (line.grade !== "forbidden") mine.add(line.act);
  if (mine.size === 0) return [];
  const out: ReachView[] = [];
  for (const office of ctx.offices) {
    if (office.polityId !== ctx.polityId || office.successionRuleId === "abolished") continue;
    if (charges.some((charge) => charge.officeId === office.id)) continue;
    const competence = competenceOf(ctx.world, office.id, scenarioOffices);
    if (competence === null) continue;
    const stops = competence.mayStop.filter((act) => mine.has(act));
    if (stops.length === 0) continue;
    const holders = ctx.world.material.officeSeats
      .filter((seat) => seat.officeId === office.id && seat.status === "held" && seat.holderCharacterId !== null && seat.holderCharacterId !== ctx.characterId)
      .map((seat) => personLink(ctx.world, seat.holderCharacterId!));
    const words = stops.map((act) => STOP_WORDS[act] ?? ACT_WORDS[act]);
    out.push({
      officeId: office.id,
      label: office.label,
      holders: holders.slice(0, 4),
      count: holders.length,
      stops: words,
      sentence: office.tribunician === true
        ? `A ${office.label.toLowerCase()} may step between you and the act, and stop ${listed(words)}; his person is sacred.`
        : `${upper(withArticle(office.label))} may put off the business of the people, and so ${listed(words)}.`,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ── Colleagues and neighbours ──────────────────────────────────────────────

function keepsOf(world: WorldState, polityId: string, office: Office, competence: Competence | null): string[] {
  const keeps: string[] = [];
  for (const department of world.departments) {
    if (department.abolishedAtStep !== null || department.scope.kind !== "polity" || department.scope.id !== polityId) continue;
    if (!department.officeIds.includes(office.id) && department.headOfficeId !== office.id) continue;
    for (const lever of department.levers) {
      const line = BY_RULE[lever];
      if (line !== undefined && !keeps.includes(line)) keeps.push(line);
    }
  }
  if (competence !== null && competence.mayStop.length > 0 && office.tribunician === true) keeps.push(`may stop ${listed(competence.mayStop.map((act) => STOP_WORDS[act] ?? ACT_WORDS[act]))}`);
  if (competence !== null && competence.isHead && keeps.length === 0) keeps.push("holds the head of the state");
  return keeps.slice(0, 4);
}

function neighboursOf(
  ctx: Context,
  charges: readonly ChargeView[],
  held: readonly Office[],
  chambers: readonly GovernmentInstitution[],
  rulerId: string | null,
  scenarioOffices: readonly Office[],
): OfficeNeighbour[] {
  const { world } = ctx;
  const heldIds = new Set(held.map((office) => office.id));
  const myRank = Math.max(0, ...held.filter((office) => office.kind !== "membership" && office.kind !== "priesthood").map((office) => office.rank ?? 0));
  const isRuler = rulerId !== null && heldIds.has(rulerId);
  const iAmTribune = held.some((office) => office.tribunician === true);
  const holdsMagistracy = held.some((office) => (office.kind ?? "magistracy") === "magistracy");
  // What each man last did in his charge: the newest entry of the log for him.
  const last = new Map<string, { day: number; why: string }>();
  for (const entry of world.statecraft.log) {
    if (entry.actorCharacterId === null || entry.polityId !== ctx.polityId) continue;
    if (entry.act !== "magistrate" && entry.act !== "fiscal" && entry.act !== "raise_levy") continue;
    const known = last.get(entry.actorCharacterId);
    if (known === undefined || entry.day >= known.day) last.set(entry.actorCharacterId, { day: entry.day, why: entry.why });
  }
  const advisoryIds = new Set(chambers.filter((chamber) => chamber.advisory === true).map((chamber) => chamber.id));
  const living = new Map(world.characters.filter((character) => character.alive).map((character) => [character.id, character]));
  const out: (OfficeNeighbour & { readonly order: number; readonly rank: number })[] = [];

  for (const office of ctx.offices) {
    if (office.polityId !== ctx.polityId || office.successionRuleId === "abolished") continue;
    const kind = office.kind ?? "magistracy";
    const own = heldIds.has(office.id);
    let relation: NeighbourRelation;
    let order: number;
    if (own && kind === "membership") continue;
    if (own) { relation = "colleague"; order = 0; }
    else if (kind === "membership") {
      // A king's friends, and only his: a council's other members sit with him in the chamber, which is shown above.
      if (!(isRuler && chamberOfSeat(office, chambers, true) !== null && advisoryIds.has(chamberOfSeat(office, chambers, true)!.id))) continue;
      relation = "counsel"; order = 1;
    } else if (kind === "priesthood") {
      const competence = competenceOf(world, office.id, scenarioOffices);
      if (competence === null || competence.mayStop.length === 0) continue;
      relation = "beside"; order = 3;
    } else {
      const rank = office.rank ?? 0;
      const theirs = office.id === rulerId;
      // A tribune stands beside every magistrate and under none; the head of the state has none above him; a man who holds no magistracy ranks himself with none.
      relation = office.tribunician === true || iAmTribune || !holdsMagistracy ? "beside"
        : theirs && !isRuler ? "above"
          : isRuler ? (rank >= myRank ? "beside" : "beneath")
            : rank > myRank ? "above" : rank === myRank ? "beside" : "beneath";
      order = relation === "above" ? 2 : relation === "beside" ? 3 : 4;
    }
    const competence = competenceOf(world, office.id, scenarioOffices);
    const seatRows = world.material.officeSeats.filter((seat) => seat.officeId === office.id && seat.status === "held" && seat.holderCharacterId !== null && seat.holderCharacterId !== ctx.characterId);
    if (seatRows.length === 0 && !own) continue;
    const people = [...new Set(seatRows.map((seat) => seat.holderCharacterId!))].filter((id) => living.has(id));
    if (people.length === 0) continue;
    const holders: NeighbourHolder[] = people.slice(0, 5).map((id) => {
      const them = living.get(id)!;
      const done = last.get(id);
      return {
        person: personLink(world, id),
        toYou: opinionLabel(computeOpinion(them, ctx.characterId)),
        yours: opinionLabel(computeOpinion(ctx.me, id)),
        lastDone: done === undefined ? null : { text: upper(done.why), when: dateOf(ctx, done.day) },
      };
    });
    out.push({
      officeId: office.id, label: office.label, relation, seats: Math.max(office.seatCount ?? 1, world.material.officeSeats.filter((seat) => seat.officeId === office.id).length),
      holders, more: Math.max(0, people.length - holders.length), keeps: keepsOf(world, ctx.polityId, office, competence), order, rank: office.rank ?? 0,
    });
  }
  void charges;
  return out
    .sort((a, b) => a.order - b.order || b.rank - a.rank || a.label.localeCompare(b.label))
    .slice(0, 14)
    .map(({ order: _order, rank: _rank, ...neighbour }) => neighbour);
}

// ── Accounts ───────────────────────────────────────────────────────────────

function accountsOf(ctx: Context, charges: readonly ChargeView[], options: OfficeViewOptions): AccountsView {
  const books = options.books;
  const chests = (books?.accounts ?? [])
    .filter((account) => ctx.world.material.accounts.some((candidate) => candidate.id === account.id && candidate.owner.kind === "polity" && candidate.owner.id === ctx.polityId))
    .map((account) => ({ label: account.label, balance: account.balance }));
  const mine = new Set(charges.map((charge) => charge.officeId));
  const headsState = charges.some((charge) => charge.head);
  const departments = (options.administration?.departments ?? [])
    .filter((department) => !department.household && (headsState || department.posts.some((post) => mine.has(post.key))))
    .slice(0, 6)
    .map((department) => ({
      key: department.key,
      name: department.name,
      issue: department.issue?.text ?? null,
      works: department.work.slice(0, 4).map((work) => ({ label: work.label, detail: work.detail, stalled: work.stalled })),
      spending: department.spending.slice(0, 3),
    }));
  const links: { label: string; tab: string; key?: string }[] = [{ label: "The accounts", tab: "accounts" }];
  if (books?.regions != null) links.push({ label: "The lands and how they are taxed", tab: "regions" });
  if (books?.trade != null) links.push({ label: "The markets and trade", tab: "trade" });
  if (departments.length > 0) links.push({ label: "How the work of the state is divided", tab: "administration" });
  return {
    currency: ctx.currency,
    chests,
    monthlyIn: books === undefined ? null : Math.round(books.totalIncome),
    monthlyOut: books === undefined ? null : Math.round(books.totalExpenditure),
    runsOutInDays: books?.runsOutInDays ?? null,
    departments,
    links,
  };
}

// ── The acts open to him ───────────────────────────────────────────────────

interface DraftSpec {
  readonly key: string;
  readonly act: ActKind;
  readonly direct: string | null;
  readonly laid: string;
  readonly power: boolean;
  readonly figure: { label: string; unit: string; initial: number; step: number; maxOf: (line: ActLine, ctx: Context) => number | null } | null;
  readonly open?: boolean;
}

const perHundred = (line: ActLine): number | null => (line.within === null ? null : line.within / 100);
const inSilver = (line: ActLine, ctx: Context): number | null => (line.within === null ? null : Math.round(line.within * ctx.takings));

function specsOf(ctx: Context): DraftSpec[] {
  const polity = ctx.polityName;
  const coin = ctx.currency;
  return [
    {
      key: "tax_rate", act: "tax_rate", power: false,
      direct: `Let every province of ${polity} that has no tax of its own be taxed by a land levy at {figure} in a hundred.`,
      laid: `Lay before {body} that the tribute of ${polity} be laid at {figure} in a hundred.`,
      figure: { label: "The rate", unit: "in a hundred", initial: 10, step: 0.5, maxOf: (line) => perHundred(line) },
    },
    {
      key: "customs", act: "customs", power: false,
      direct: `Lay customs of {figure} in a hundred on goods entering the markets of ${polity} from other powers.`,
      laid: `Lay before {body} that customs of {figure} in a hundred be laid on goods entering the markets of ${polity} from other powers.`,
      figure: { label: "The tariff", unit: "in a hundred", initial: 5, step: 0.5, maxOf: (line) => perHundred(line) },
    },
    {
      key: "coinage", act: "coinage", power: false,
      direct: `Have the coin of ${polity} struck lighter by {figure} in a hundred of its silver.`,
      laid: `Lay before {body} that the coin of ${polity} be struck lighter by {figure} in a hundred of its silver.`,
      figure: { label: "Less silver", unit: "in a hundred", initial: 5, step: 1, maxOf: (line) => perHundred(line) },
    },
    {
      key: "loans", act: "loans", power: false,
      direct: `Borrow {figure} ${coin} in the name of ${polity}.`,
      laid: `Lay before {body} that ${polity} borrow {figure} ${coin}.`,
      figure: { label: "The sum", unit: coin, initial: Math.max(1_000, Math.round(ctx.takings / 2 / 1_000) * 1_000), step: 1_000, maxOf: inSilver },
    },
    {
      key: "grain", act: "grain", power: false,
      direct: `Buy grain and give out bread to the hungriest province of ${polity}, out of the treasury, to the value of {figure} ${coin}.`,
      laid: `Lay before {body} that bread be bought and given out to the hungriest province of ${polity}, to the value of {figure} ${coin}.`,
      figure: { label: "The sum", unit: coin, initial: Math.max(1_000, Math.round(ctx.takings / 4 / 1_000) * 1_000), step: 1_000, maxOf: inSilver },
    },
    {
      key: "pacts:trade", act: "pacts", power: true,
      direct: "Offer {power} a pact of trade between the two.",
      laid: "Lay before {body} that a pact of trade be made with {power}.",
      figure: null,
    },
    {
      key: "pacts:alliance", act: "pacts", power: true,
      direct: "Offer {power} an alliance.",
      laid: "Lay before {body} that an alliance be made with {power}.",
      figure: null,
    },
    {
      key: "embargoes", act: "embargoes", power: true,
      direct: `Close the markets of ${polity} to {power}.`,
      laid: `Lay before {body} that the markets of ${polity} be closed to {power}.`,
      figure: null,
    },
    {
      key: "levy", act: "levy", power: false,
      direct: `Hold the levy of ${polity}.`,
      laid: `Lay before {body} that the levy of ${polity} be held.`,
      figure: null,
    },
    {
      key: "war", act: "war", power: true,
      direct: "Make war on {power}.",
      laid: "Lay before {body} that war be made on {power}.",
      figure: null,
    },
    {
      key: "peace", act: "peace", power: true,
      direct: "Make peace with {power}.",
      laid: "Lay before {body} that peace be made with {power}.",
      figure: null,
    },
    {
      key: "spending", act: "spending", power: false, open: true,
      direct: `Draw {figure} ${coin} from the treasury of ${polity} for `,
      laid: `Lay before {body} that {figure} ${coin} be drawn from the treasury of ${polity} for `,
      figure: { label: "The sum", unit: coin, initial: Math.max(1_000, Math.round(ctx.takings / 4 / 1_000) * 1_000), step: 1_000, maxOf: inSilver },
    },
    {
      key: "appointment", act: "appointment", power: false, open: true,
      direct: "Name  to the office of ",
      laid: "Lay before {body} that  be named to the office of ",
      figure: null,
    },
  ];
}

/** The best footing any of his charges gives him for an act, the higher office first among equals. */
function bestLine(charges: readonly ChargeView[], act: ActKind): ActLine | null {
  let best: ActLine | null = null;
  for (const charge of charges) {
    const line = charge.acts.find((candidate) => candidate.act === act);
    if (line === undefined) continue;
    if (best === null || GRADE_ORDER[line.grade] < GRADE_ORDER[best.grade]) best = line;
  }
  return best;
}

function draftsOf(ctx: Context, charges: readonly ChargeView[]): ActDraft[] {
  const out: ActDraft[] = [];
  for (const spec of specsOf(ctx)) {
    const line = bestLine(charges, spec.act);
    if (line === null || line.grade === "forbidden") continue;
    const body = line.body;
    const ownIt = line.grade === "alone" || line.grade === "with_colleague";
    // Where nobody holds the act from him there is no chamber to lay it before, and only the direct order stands.
    const laid = body === null ? null : spec.laid.replace("{body}", theBody(body));
    if (!ownIt && laid === null) continue;
    const max = ownIt && spec.figure !== null ? spec.figure.maxOf(line, ctx) : null;
    const note = line.grade === "by_the_body"
      ? `Not yours to do: it is laid before ${theBody(body ?? "the chamber")}, and done the day it carries.`
      : line.grade === "with_colleague"
        ? `${line.withinWords === null ? "" : `${upper(line.withinWords)}. `}${body === null || line.beyond !== "by_the_body" ? "" : `Past that, ${theBody(body)} decides. `}Your colleague may stop it.`.trim()
        : `${line.withinWords === null ? "Yours to do." : `${upper(line.withinWords)}.`}${body === null || line.beyond !== "by_the_body" ? "" : ` Past that, ${theBody(body)} decides.`}`;
    out.push({
      key: spec.key,
      kind: "act",
      act: spec.act,
      deed: line.deed,
      grade: line.grade,
      body,
      direct: ownIt ? spec.direct : null,
      laid,
      max,
      needs: { power: spec.power, figure: spec.figure === null ? null : { label: spec.figure.label, unit: spec.figure.unit, initial: spec.figure.initial, step: spec.figure.step } },
      note,
      open: spec.open === true,
    });
  }
  // A man whose word stops what another does: the order is the one that steps between.
  const stopped = new Set<ActKind>();
  for (const charge of charges) for (const act of charge.stopsActs) stopped.add(act);
  for (const act of ACT_KINDS) {
    if (!stopped.has(act) || act === "appointment") continue;
    const what = STOP_WORDS[act] ?? ACT_WORDS[act];
    out.push({
      key: `stop:${act}`,
      kind: "stop",
      act,
      deed: upper(`forbid ${what}`),
      grade: "forbidden",
      body: null,
      direct: `I forbid ${what} of ${ctx.polityName}, and step between the magistrate and the act.`,
      laid: null,
      max: null,
      needs: { power: false, figure: null },
      note: "Your word stops it: what a magistrate would do against it is not done.",
      open: false,
    });
  }
  return out;
}

/**
 * The words of an order, once the power and the figure are named. Past his figure the order is the one that lays the matter before the chamber
 * (the engine does it the same way, `competence-gate.ts`), so the draft and the gate agree.
 */
export function draftText(draft: ActDraft, input: { readonly power?: string | undefined; readonly figure?: number | undefined } = {}): { readonly text: string; readonly laid: string | null } {
  const figure = input.figure ?? draft.needs.figure?.initial ?? 0;
  const past = draft.max !== null && figure > draft.max;
  const useLaid = draft.direct === null || (past && draft.laid !== null);
  const template = useLaid ? draft.laid ?? draft.direct ?? "" : draft.direct ?? "";
  const shown = Number.isInteger(figure) ? (figure >= 1_000 ? figure.toLocaleString("en-GB") : String(figure)) : String(figure);
  const text = template.replaceAll("{figure}", shown).replaceAll("{power}", input.power ?? "the other power");
  return { text, laid: useLaid ? draft.body : null };
}

// ── A man with no charge ───────────────────────────────────────────────────

function privateOf(ctx: Context, chambers: readonly GovernmentInstitution[], scenarioOffices: readonly Office[]): PrivateReading {
  const { world } = ctx;
  const boundBy: string[] = [];
  const free = ctx.me.legalStatus === "free";
  boundBy.push(free
    ? `You hold no office of ${ctx.polityName}: its money, its treaties and its levy are not yours to touch.`
    : `You are not a free man, and the law of ${ctx.polityName} gives you no part in its affairs.`);
  boundBy.push(`The laws of ${ctx.polityName} bind you as they bind any man, and its magistrates may call you before them.`);
  const movedBy: { body: string; through: string; holders: Linked[] }[] = [];
  for (const chamber of chambers) {
    if (chamber.advisory === true || chamber.convenedByOfficeIds === undefined || chamber.convenedByOfficeIds.length === 0) continue;
    const through = chamber.convenedByOfficeIds.map((id) => ctx.office.get(id)).find((office) => office !== undefined && world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.status === "held" && seat.holderCharacterId !== null));
    if (through === undefined) continue;
    const holders = world.material.officeSeats
      .filter((seat) => seat.officeId === through.id && seat.status === "held" && seat.holderCharacterId !== null)
      .slice(0, 3)
      .map((seat) => personLink(world, seat.holderCharacterId!));
    movedBy.push({ body: chamber.name, through: through.label, holders });
  }
  // A power whose head sits alone has no chamber to move: the man to move is the head himself.
  if (movedBy.length === 0) {
    const constitution = world.constitutions.find((record) => record.polityId === ctx.polityId);
    const ruler = constitution?.rulerOfficeId == null ? undefined : ctx.office.get(constitution.rulerOfficeId);
    if (ruler !== undefined) {
      const holders = world.material.officeSeats.filter((seat) => seat.officeId === ruler.id && seat.status === "held" && seat.holderCharacterId !== null).slice(0, 2).map((seat) => personLink(world, seat.holderCharacterId!));
      movedBy.push({ body: "the court", through: ruler.label, holders });
    }
  }
  void scenarioOffices;
  return {
    noCharge: `You hold no charge in ${ctx.polityName}. What you can do there you do as a private man: by your purse, your friends and your name.`,
    boundBy,
    movedBy: movedBy.slice(0, 4),
  };
}
