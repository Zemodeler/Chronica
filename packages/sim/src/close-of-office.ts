import {
  FactProposalSchema,
  WorldDeltaSchema,
  actMarkOf,
  allOffices,
  aptitude,
  boundedId,
  computeOpinion,
  holdersOfLever,
  isMagistracy,
  monthlyTakings,
  readDepartments,
  shiftStanding,
  SPENDING_YEAR_DAYS,
  spendingAllowance,
  stableHash,
  STATECRAFT_LOG_MAX,
  type Character,
  type Department,
  type FactProposalDraft,
  type Office,
  type PoliticalProcedure,
  type StatecraftEntry,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";
import { constitutionOf } from "./constitutions";
import { courtForTheft, type MagistrateInput } from "./magistrates";
import { armiesLedBy } from "./command-tenure";
import { sentenceByOutcome } from "./trials";
import type { StatecraftDecision } from "./statecraft";

/**
 * Accountability, as each people had it (docs/plans/government.md, "H4 as built").
 *
 * No power here asks a man for a tally of his quarter; each asks for what its people asked. Rome's quaestors and the magistrates who handled the chest laid their *rationes*
 * before the Senate when the year was out, the censors went through the books at the lustrum or when a man was spoken ill of, and a case that came of it was
 * brought to the people (*iudicium populi*), not to a standing court: those are a hundred years later. A Greek city or a league took the *euthynai*, the audit
 * of the man who has laid down his office. Carthage's Hundred and Four examined its magistrates and its generals when they came home, and a general who had
 * failed could be crucified. A king asks nobody for accounts: his *dioiketes* goes through the books of his officers, and the friends who dislike the man
 * say so. A tribal chief is not asked at all.
 *
 * What a man's accounts are compared with, at the close of his office: what he drew (`ActMark`: the year's draws against his allowance, works and bread and
 * the army's among them), the gap between what his charge ought to have brought in and what reached the chest (the `Diversion` rows the skim leaves, which the
 * accounts may or may not find), and the examiner's eye against the man's care (the same odds as an audit). A gap found is a finding: the row is marked found,
 * the man loses standing, a mark is made against him (`answerable`), and the praetor brings the case (`magistrates.ts`, `thePraetor`) before the people or
 * the court the power has. A man who drew more than his allowance is told of it and loses a little standing, nothing more.
 *
 * Nothing here asks a decision of the player; every finding is a fact the news tells, at most one a power in a month. Deterministic: stableHash only; no model.
 */

export type AccountStyle = "rationes" | "euthynai" | "examination" | "none";

/** What a power asks of the man who lays down an office. */
export function accountStyleOf(world: WorldState, polityId: string): AccountStyle {
  const record = constitutionOf(world, polityId);
  const form = record?.form ?? world.map.polities.find((polity) => polity.id === polityId)?.governmentForm ?? "monarchy";
  if (form === "monarchy" || form === "temple_state" || form === "tribal_confederation" || form === "soldier_commune") return "none";
  const departments = world.departments.filter((department) => department.abolishedAtStep === null && department.scope.kind === "polity" && department.scope.id === polityId);
  if (departments.some((department) => department.gates.some((gate) => gate.act === "judge_commander"))) return "examination";
  if (departments.some((department) => department.levers.includes("audit"))) return "rationes";
  return "euthynai";
}

/** How the finding is worded. */
const ACCOUNTS_IN_WORDS: Record<AccountStyle, string> = {
  rationes: "laid his accounts before the Senate",
  euthynai: "gave the account the city asks of a man who has laid down his office",
  examination: "was examined by the Hundred and Four",
  none: "",
};

const MONTH = 30;
/** The share the examiner's eye is worth against a man of his own order: a Senate that knew the quaestor and the aerarium's habits. */
const STYLE_LIFT: Record<AccountStyle, number> = { rationes: 0.9, euthynai: 1, examination: 1.1, none: 0 };
/** What a finding costs a man in standing: the gap found; the draw beyond his allowance. */
export const FOUND_STANDING_BPS = -700;
export const OVERDRAWN_STANDING_BPS = -250;
/** The weight a finding puts on a man's marks (`answerable`): below the weight that prosecutes by itself, since the praetor brings the case of a found theft. */
export const FINDING_WEIGHT = 2;
export const OVERDRAWN_WEIGHT = 1;
/** Examination: the weight of defeats at which a failed general is asked for his life, and the standing a clean examination gives. */
export const CAPITAL_AT = 5;
export const CLEARED_STANDING_BPS = 150;
/** The most findings a power's accounts make in a month, and the log's marks. */
export const FINDINGS_A_MONTH = 1;

const fact = (raw: Record<string, unknown>): FactProposalDraft => FactProposalSchema.parse(raw) as unknown as FactProposalDraft;

const monthOf = (day: number): number => Math.floor(day / MONTH);

/** The log entry of a finding, kept so that a month holds one, and so the sanity run can count them. */
function logged(world: WorldState, entry: StatecraftEntry): WorldState {
  return { ...world, statecraft: { ...world.statecraft, log: [...world.statecraft.log, entry].slice(-STATECRAFT_LOG_MAX) } };
}

const toldThisMonth = (world: WorldState, polityId: string, day: number, kind: string): boolean =>
  world.statecraft.log.some((entry) => entry.polityId === polityId && entry.act === "magistrate" && entry.why.startsWith(`${kind}:`) && monthOf(entry.day) === monthOf(day) && entry.day <= day);

/** The odds an examiner finds a hidden gap, as an audit's are. */
function oddsOf(examiner: Character | undefined, thief: Character, lift: number): number {
  const eye = examiner === undefined ? 40 : (aptitude(examiner, "taxation") + aptitude(examiner, "espionage")) / 2;
  const care = (thief.skills.intrigue + aptitude(thief, "manipulation")) / 2;
  return Math.max(0.08, Math.min(0.92, (0.5 + (eye - care) / 100) * lift));
}

/** Who looks at his books: the man who keeps the roll of the chest (the quaestor's department), else the head of state, else any other man of the power in office. */
function examinerOf(world: WorldState, polityId: string, not: string, offices: readonly Office[]): Character | undefined {
  const reader = readDepartments(world);
  const scope = { kind: "polity" as const, id: polityId };
  const roll = reader.holding(scope, "tax_roll");
  const choices = [roll.head, ...roll.people, ...reader.rulers(polityId)].filter((man): man is Character => man !== null && man.id !== not && man.alive);
  if (choices.length > 0) return choices[0];
  const held = holdersOfLever(world, polityId, "audit", offices).map((holder) => world.characters.find((character) => character.id === holder.characterId)).find((man) => man !== undefined && man.id !== not && man.alive);
  return held;
}

export interface AccountsInput {
  readonly world: WorldState;
  readonly offices: readonly Office[];
  readonly toDay: number;
  readonly ids: IdFactory;
  readonly playerCharacterId?: string | null | undefined;
  /** Terms that ran out this tick (`tick.ts`). */
  readonly endedTerms: readonly { readonly characterId: string; readonly officeId: string; readonly seatId: string; readonly endedAtStep: number }[];
}

/** What one man's accounts came to at the close of his office. */
export interface Rendering {
  readonly manId: string;
  readonly officeId: string;
  readonly polityId: string;
  readonly style: AccountStyle;
  readonly drew: number;
  readonly allowance: number | null;
  readonly overdrawn: number;
  readonly gap: number;
  readonly found: number;
}

/**
 * The accounts of every magistrate whose term ran out today. Returns the world after (rows marked found, standing and marks laid on the man, a log entry for each
 * finding) and the facts: one a power in a month, whatever the findings.
 */
export function renderTheAccounts(input: AccountsInput): { world: WorldState; facts: FactProposalDraft[]; renderings: Rendering[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const renderings: Rendering[] = [];
  const every = allOffices(world, input.offices);
  const day = input.toDay;
  const spoke = new Set<string>();
  for (const ended of input.endedTerms) {
    const office = every.find((candidate) => candidate.id === ended.officeId);
    const man = world.characters.find((character) => character.id === ended.characterId && character.alive);
    if (office === undefined || man === undefined || !isMagistracy(office)) continue;
    const polityId = office.polityId;
    const style = accountStyleOf(world, polityId);
    if (style === "none") continue;
    const started = ended.endedAtStep - (office.termDays ?? 365);
    const allowance = spendingAllowance(world, office.id, input.offices);
    const mark = actMarkOf(world.actMarks, polityId, "spending", office.id);
    const drew = mark === undefined || ended.endedAtStep - mark.sinceStep > SPENDING_YEAR_DAYS + MONTH ? 0 : mark.total;
    // Only a draw a man made on his own word is counted against his allowance: what the chamber decreed (the quaestor pays out on a decree) is the chamber's.
    const allowed = allowance !== null && (allowance.grade === "alone" || allowance.grade === "with_colleague") ? allowance.amount : null;
    const overdrawn = allowed === null ? 0 : Math.max(0, drew - allowed);
    const rows = world.diversions.filter((row) => row.byCharacterId === man.id && row.scope.kind === "polity" && row.scope.id === polityId && row.foundAtStep === null && row.lastAtStep >= started);
    const gap = rows.reduce((sum, row) => sum + row.amount, 0);
    const handles = drew > 0 || gap > 0 || readDepartments(world).holding({ kind: "polity", id: polityId }, "tax_roll").people.some((person) => person.id === man.id)
      || world.departments.some((department) => department.abolishedAtStep === null && department.scope.kind === "polity" && department.scope.id === polityId && department.officeIds.includes(office.id));
    if (!handles) continue;
    const examiner = examinerOf(world, polityId, man.id, input.offices);
    const takenUp = new Set<string>();
    for (const row of rows) {
      const thief = world.characters.find((character) => character.id === row.byCharacterId);
      if (thief === undefined) continue;
      const roll = (stableHash([ended.seatId, row.id, "rationes", String(ended.endedAtStep)]) % 10_000) / 10_000;
      if (roll < oddsOf(examiner, thief, STYLE_LIFT[style])) takenUp.add(row.id);
    }
    const foundGap = rows.filter((row) => takenUp.has(row.id)).reduce((sum, row) => sum + row.amount, 0);
    renderings.push({ manId: man.id, officeId: office.id, polityId, style, drew, allowance: allowed, overdrawn, gap, found: foundGap });
    const polityName = world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
    let words: string;
    let significance = 25;
    let found = false;
    if (takenUp.size > 0) {
      found = true;
      world = { ...world, diversions: world.diversions.map((row) => (takenUp.has(row.id) ? { ...row, foundAtStep: day } : row)) };
      world = shiftStanding(world, man.id, FOUND_STANDING_BPS, "scandal");
      world = {
        ...world,
        answerable: [...world.answerable, {
          characterId: man.id, polityId, kind: "breach" as const, label: `his accounts as ${office.label} did not square: ${foundGap} unexplained`.slice(0, 240), atStep: day, weight: FINDING_WEIGHT,
        }].slice(-400),
      };
      words = `${man.name} ${ACCOUNTS_IN_WORDS[style]} at the close of his office as ${office.label}, and ${foundGap} of what ${gap > foundGap ? "he had drawn" : "was due"} could not be explained`;
      significance = 55;
    } else if (overdrawn > 0) {
      found = true;
      world = shiftStanding(world, man.id, OVERDRAWN_STANDING_BPS, "scandal");
      world = {
        ...world,
        answerable: [...world.answerable, {
          characterId: man.id, polityId, kind: "breach" as const, label: `he drew ${overdrawn} past his allowance as ${office.label}`.slice(0, 240), atStep: day, weight: OVERDRAWN_WEIGHT,
        }].slice(-400),
      };
      words = `${man.name} ${ACCOUNTS_IN_WORDS[style]}: he had drawn ${overdrawn} more than his office allowed`;
      significance = 40;
    } else {
      words = `${man.name} ${ACCOUNTS_IN_WORDS[style]}, and they squared`;
    }
    if (!toldThisMonth(world, polityId, day, "accounts")) {
      world = logged(world, { day, polityId, actorCharacterId: man.id, act: "magistrate", targetPolityId: null, why: `accounts: ${words} [${man.id}]`.slice(0, 400) });
      if (!spoke.has(polityId) && (found || stableHash([man.id, "accounts-told", String(day)]) % 100 < 40)) {
        spoke.add(polityId);
        facts.push(fact({
          localId: `accounts_${polityId}_${monthOf(day)}`.slice(0, 60), kind: found ? "accounts_found" : "accounts_rendered", summary: `${words} in ${polityName}.`.slice(0, 400),
          affectedRefs: [{ kind: "character", id: man.id }, { kind: "polity", id: polityId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance,
        }));
      }
    }
    // A power that tries by the euthynai or by examination brings the case at once; Rome's praetor brings it in his month (`thePraetor`).
    if (takenUp.size > 0 && style !== "rationes") {
      const brought = bringTheCase(world, { accusedId: man.id, polityId, label: `The examination of ${man.name} at the close of his office as ${office.label}: ${foundGap} unexplained`, day, sentence: "fine", sponsor: examiner });
      world = brought.world;
    }
  }
  return { world, facts, renderings };
}

/** A case laid before the court of the power by the man who found it, once for a man in a year. */
export function bringTheCase(world: WorldState, input: { readonly accusedId: string; readonly polityId: string; readonly label: string; readonly day: number; readonly sentence: "fine" | "exile" | "death"; readonly sponsor: Character | null | undefined }): { world: WorldState; procedure: PoliticalProcedure | null } {
  const court = courtForTheft(world, input.polityId);
  const accused = world.characters.find((character) => character.id === input.accusedId && character.alive);
  if (court === null || accused === null || accused === undefined) return { world, procedure: null };
  const already = world.material.politicalProcedures.some((procedure) => procedure.type === "denunciation" && procedure.subjectId === input.accusedId && input.day - procedure.openedAtStep < 365);
  if (already) return { world, procedure: null };
  const sponsor = input.sponsor != null && input.sponsor.id !== accused.id ? input.sponsor : world.characters.find((character) => character.alive && character.polityId === input.polityId && character.id !== accused.id);
  if (sponsor === undefined) return { world, procedure: null };
  const procedure = {
    id: boundedId("examination", input.accusedId, input.day), type: "denunciation", institutionId: court.id, sponsorCharacterId: sponsor.id, subjectKind: "character", subjectId: accused.id,
    label: input.label.slice(0, 200), eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote", openedAtStep: input.day,
    deadlineStep: input.day + 30, resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [],
    concerns: ["punishment"], sentence: input.sentence,
  } as PoliticalProcedure;
  return { world: { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } }, procedure };
}

// ── Carthage: the Hundred and Four examine the men who come home ────────────

/**
 * A general or a magistrate of a power that examines (`accountStyleOf`) who has come home: no army in the field and he stands at the capital's province. He is
 * examined once in a year, before the court: a clean record is approved (a little standing), marks against him (a defeat, a breach, what an audit found) are
 * the case, and a general who lost an army (the weight of the marks at `CAPITAL_AT`) answers with his life. A man already summoned this year (`trials.ts`,
 * after a battle) is not examined twice.
 */
export function examineTheReturned(input: AccountsInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const day = input.toDay;
  const every = allOffices(world, input.offices);
  for (const polity of world.map.polities) {
    if (accountStyleOf(world, polity.id) !== "examination") continue;
    const court = courtForTheft(world, polity.id);
    if (court === null) continue;
    const capital = polity.capitalSettlementId;
    const home = capital === null ? undefined : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id;
    if (home === undefined) continue;
    const generals = new Set(every.filter((office) => office.polityId === polity.id && /strategos|general/iu.test(office.id)).map((office) => office.id));
    let examined = 0;
    for (const man of world.characters.filter((character) => character.alive && character.polityId === polity.id && character.locationProvinceId === home).sort((a, b) => a.id.localeCompare(b.id))) {
      if (examined >= FINDINGS_A_MONTH || man.id === input.playerCharacterId) continue;
      const marks = world.answerable.filter((entry) => entry.characterId === man.id && entry.polityId === polity.id);
      const commanded = man.officesHeld.some((tenure) => generals.has(tenure.officeId)) || world.material.officeSeats.some((seat) => seat.holderCharacterId === man.id && seat.status === "held" && generals.has(seat.officeId)) || marks.some((entry) => entry.kind === "defeat");
      if (!commanded || armiesLedBy(world, man.id, polity.id).length > 0) continue;
      const lately = world.material.politicalProcedures.some((procedure) => procedure.type === "denunciation" && procedure.subjectId === man.id && day - procedure.openedAtStep < 365);
      const examinedLately = world.statecraft.log.some((entry) => entry.why.startsWith("examination:") && entry.why.includes(`[${man.id}]`) && day - entry.day < 365);
      if (lately || examinedLately) continue;
      const weight = marks.reduce((sum, entry) => sum + entry.weight, 0);
      const proven = world.diversions.filter((row) => row.byCharacterId === man.id && row.foundAtStep !== null);
      examined += 1;
      world = { ...world, answerable: world.answerable.filter((entry) => entry.characterId !== man.id) };
      if (weight === 0 && proven.length === 0) {
        world = shiftStanding(world, man.id, CLEARED_STANDING_BPS, "office");
        world = logged(world, { day, polityId: polity.id, actorCharacterId: man.id, act: "magistrate", targetPolityId: null, why: `examination: ${man.name} home, and the ${court.name.replace(/^the\s+/iu, "")} found nothing against him [${man.id}]`.slice(0, 400) });
        continue;
      }
      const sentence = weight >= CAPITAL_AT ? "death" as const : "fine" as const;
      const what = marks.slice(0, 2).map((entry) => entry.label).join("; ") || "what an audit found";
      const brought = bringTheCase(world, { accusedId: man.id, polityId: polity.id, label: `The examination of ${man.name} on his return: ${what}`, day, sentence, sponsor: examinerOf(world, polity.id, man.id, input.offices) });
      world = brought.world;
      if (brought.procedure === null) continue;
      world = logged(world, { day, polityId: polity.id, actorCharacterId: man.id, act: "magistrate", targetPolityId: null, why: `examination: ${man.name} home, called before the ${court.name.replace(/^the\s+/iu, "")}${sentence === "death" ? " for his life" : ""} [${man.id}]`.slice(0, 400) });
      facts.push(fact({
        localId: `examined_${man.id}`.slice(0, 60), kind: "examination", visibility: "public", discoveryState: "public", knowableInDays: 0, significance: sentence === "death" ? 65 : 45,
        summary: `${man.name} is home, and the ${court.name} examines him: ${what}.${sentence === "death" ? " It is his life they will vote on." : " It is a fine they will vote on."}`.slice(0, 400),
        affectedRefs: [{ kind: "character", id: man.id }, { kind: "polity", id: polity.id }, { kind: "procedure", id: brought.procedure.id }],
      }));
    }
  }
  return { world, facts };
}

// ── The king's audit ────────────────────────────────────────────────────────

/** A king's officers whose books an audit opened by his order found short, in the month: he dismisses them and has them pay back (the king's justice, `sentenceByOutcome`). The friends who think ill of the man are those who spoke. */
export function theKingsJustice(input: AccountsInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const day = input.toDay;
  const reader = readDepartments(world);
  const handled = new Set<string>();
  for (const row of [...world.diversions].sort((a, b) => (a.foundAtStep ?? 0) - (b.foundAtStep ?? 0) || a.id.localeCompare(b.id))) {
    if (row.foundAtStep === null || day - row.foundAtStep > 35 || row.scope.kind !== "polity" || handled.has(row.byCharacterId)) continue;
    const polityId = row.scope.id;
    if (accountStyleOf(world, polityId) !== "none") continue;
    const form = constitutionOf(world, polityId)?.form;
    if (form !== "monarchy" && form !== "temple_state") continue;
    const man = world.characters.find((character) => character.id === row.byCharacterId && character.alive);
    const king = reader.rulers(polityId)[0];
    if (man === undefined || king === undefined || man.id === king.id || man.id === input.playerCharacterId) continue;
    const judged = world.material.politicalProcedures.some((procedure) => procedure.type === "denunciation" && procedure.subjectId === man.id && day - procedure.openedAtStep < 365);
    if (judged) continue;
    handled.add(man.id);
    // Who speaks against him: the friend of the king who likes him least, else the officer who keeps the king's revenues.
    const friends = world.characters.filter((character) => character.alive && character.polityId === polityId && character.id !== man.id && character.id !== king.id
      && world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held" && /friend|councillor/iu.test(seat.officeId)));
    const rival = [...friends].filter((friend) => computeOpinion(friend, man.id) <= -20).sort((a, b) => computeOpinion(a, man.id) - computeOpinion(b, man.id) || a.id.localeCompare(b.id))[0];
    const accuser = rival ?? examinerOf(world, polityId, man.id, input.offices) ?? king;
    const procedure = {
      id: boundedId("royal-audit", man.id, day), type: "denunciation", institutionId: null, sponsorCharacterId: accuser.id, subjectKind: "character", subjectId: man.id,
      label: `The king's audit of ${man.name}: ${row.amount} kept back`.slice(0, 200), eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "sponsor_discretion",
      openedAtStep: day, deadlineStep: day, resolvedAtStep: day, visibility: "polity", voteRecordId: null, outcome: "passed", outcomeReason: "The king had his officer's books gone through, and judged him.", sourceEventIds: [], resultingEventIds: [],
      concerns: ["punishment"], sentence: "fine",
    } as unknown as PoliticalProcedure;
    world = sentenceByOutcome(world, procedure, day);
    world = { ...world, answerable: world.answerable.filter((entry) => entry.characterId !== man.id) };
    world = logged(world, { day, polityId, actorCharacterId: king.id, act: "magistrate", targetPolityId: null, why: `royal audit: ${man.name} dismissed and made to pay back what he kept [${man.id}]`.slice(0, 400) });
    if (!toldThisMonth(world, polityId, day, "royal-audit-told")) {
      world = logged(world, { day, polityId, actorCharacterId: king.id, act: "magistrate", targetPolityId: null, why: `royal-audit-told: ${man.name} [${man.id}]`.slice(0, 400) });
      facts.push(fact({
        localId: `royal_audit_${man.id}`.slice(0, 60), kind: "royal_audit", visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 45,
        summary: `${king.name} had the books of ${man.name} gone through, and ${row.amount} was found kept back; ${man.name} is put out of his charge and must pay it back${rival === undefined ? "" : `, on the word of ${rival.name}, who is no friend of his`}.`.slice(0, 400),
        affectedRefs: [{ kind: "character", id: man.id }, { kind: "character", id: accuser.id }, { kind: "polity", id: polityId }],
      }));
    }
  }
  return { world, facts };
}

/** The tick's whole accountability pass, in the order it must run (before a commander's year-end reads the marks). */
export function keepTheAccounts(input: AccountsInput): { world: WorldState; facts: FactProposalDraft[] } {
  const accounts = input.endedTerms.length === 0 ? { world: input.world, facts: [] as FactProposalDraft[] } : renderTheAccounts(input);
  // Once a month, on the days the society is reviewed (`society.ts`: thirty days from the last review).
  const last = input.world.society.lastReviewStep;
  const monthly = last === null || input.toDay - last >= MONTH;
  const examined = monthly ? examineTheReturned({ ...input, world: accounts.world }) : { world: accounts.world, facts: [] as FactProposalDraft[] };
  const royal = monthly ? theKingsJustice({ ...input, world: examined.world }) : { world: examined.world, facts: [] as FactProposalDraft[] };
  return { world: royal.world, facts: [...accounts.facts, ...examined.facts, ...royal.facts] };
}

// ── The audits by rule ──────────────────────────────────────────────────────

/** How long after the last audit of a power the next may be opened, scheduled or on suspicion. */
export const AUDIT_REST_DAYS = 150;
/** The share of a month's takings in unfound gaps at which the chest is spoken of as short. */
export const SHORT_CHEST_SHARE = 0.1;
/** How many days after the lustrum the censors open the books. */
export const LUSTRUM_AUDIT_DAYS = 90;

const AUDITING = "audit";

/** The men of a power who are wanted out of their charge by somebody (`grumbling.ts`): the target of an active `replace-` want. */
function suspectsOf(world: WorldState, polityId: string): Set<string> {
  const out = new Set<string>();
  for (const character of world.characters) {
    if (!character.alive || character.polityId !== polityId) continue;
    for (const ambition of character.ambitions) if (ambition.status === "active" && ambition.targetId != null && ambition.id === `replace-${ambition.targetId}`.slice(0, 120)) out.add(ambition.targetId);
  }
  return out;
}

/**
 * The audits a power opens by rule, as `audit_open` (the mission of two months): the censors at the lustrum and when the chest is spoken of as short or somebody
 * wants a man out for his charge's sake; a king's *dioiketes* (or the friend who has most of a steward in him) once a year and on the same suspicion; Carthage's
 * judges once a year; a city only on suspicion (it takes the *euthynai* at the close of office). Never twice in `AUDIT_REST_DAYS`, never while the same books
 * are being gone through, never by a man the player or the model plays or of the books he keeps himself.
 */
export function decideAudits(input: MagistrateInput): StatecraftDecision[] {
  const { world } = input;
  const day = world.instant.day;
  if (day < 45) return [];
  const offices = input.offices ?? [];
  const reader = readDepartments(world);
  const decisions: StatecraftDecision[] = [];
  const lastAudit = new Map<string, number>();
  for (const entry of world.statecraft.log) if (entry.act === "magistrate" && entry.why.startsWith(`${AUDITING}:`)) lastAudit.set(entry.polityId, Math.max(lastAudit.get(entry.polityId) ?? -Infinity, entry.day));
  const free = (man: Character | null | undefined): man is Character => man != null && man.alive && man.id !== input.playerCharacterId && !input.playedByModel.has(man.id);
  for (const polity of [...world.map.polities].sort((a, b) => a.id.localeCompare(b.id))) {
    if (input.excludedPolityIds.has(polity.id) || polity.endedAtStep != null) continue;
    if (day - (lastAudit.get(polity.id) ?? -Infinity) < AUDIT_REST_DAYS) continue;
    const scope = { kind: "polity" as const, id: polity.id };
    const style = accountStyleOf(world, polity.id);
    const departments = world.departments.filter((department) => department.abolishedAtStep === null && department.scope.kind === "polity" && department.scope.id === polity.id && department.formsAtStep <= day);
    const takings = monthlyTakings(world, polity.id);
    const unfound = world.diversions.filter((row) => row.foundAtStep === null && row.scope.kind === "polity" && row.scope.id === polity.id);
    const short = takings > 0 && unfound.reduce((sum, row) => sum + row.amount, 0) >= takings * SHORT_CHEST_SHARE;
    const suspects = suspectsOf(world, polity.id);
    const censusDay = world.genericEntities.filter((entity) => entity.kind === "census" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === polity.id)
      .map((entity) => Number(entity.attributes?.["atStep"] ?? entity.createdAtStep ?? -Infinity)).reduce((best, at) => Math.max(best, at), -Infinity);
    const lustrum = style === "rationes" && day - censusDay >= 0 && day - censusDay <= LUSTRUM_AUDIT_DAYS;
    const yearly = (style === "none" || style === "examination") && monthOf(day) % 12 === stableHash([polity.id, "audit-month"]) % 12;
    const roll = stableHash([input.gameId, "audit", polity.id, String(monthOf(day))]) % 100;
    const onSuspicion = (short || suspects.size > 0) && roll < 45;
    if (!lustrum && !(yearly && roll < 70) && !onSuspicion) continue;
    // Who goes through the books.
    const form = constitutionOf(world, polity.id)?.form;
    const king = form === "monarchy" || form === "temple_state";
    const auditors: Character[] = [];
    const add = (men: readonly (Character | null | undefined)[]): void => { for (const man of men) if (free(man) && !auditors.some((known) => known.id === man.id)) auditors.push(man); };
    if (style === "rationes") add(holdersOfLever(world, polity.id, "audit", offices).map((holder) => world.characters.find((character) => character.id === holder.characterId)));
    if (king || style === "euthynai" || style === "examination") {
      const roll2 = reader.holding(scope, "tax_roll");
      add([roll2.head, ...roll2.people]);
      const friends = world.characters.filter((character) => free(character) && character.polityId === polity.id
        && world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held" && /friend|councillor|elder|suffete/iu.test(seat.officeId)))
        .sort((a, b) => b.skills.stewardship - a.skills.stewardship || a.id.localeCompare(b.id));
      add(friends.slice(0, 2));
    }
    add(reader.rulers(polity.id));
    if (auditors.length === 0) continue;
    // Whose books: the charge of a man spoken ill of, else the one with most unfound gap, else the chest's own.
    const own = (department: Department, man: Character): boolean => department.officeIds.some((officeId) => world.material.officeSeats.some((seat) => seat.officeId === officeId && seat.holderCharacterId === man.id && seat.status === "held"));
    const gapOf = (department: Department): number => unfound.filter((row) => row.departmentId === department.id).reduce((sum, row) => sum + row.amount, 0);
    const suspected = (department: Department): boolean => [...suspects].some((id) => { const man = world.characters.find((character) => character.id === id); return man !== undefined && own(department, man); });
    const target = [...departments].filter((department) => department.levers.length > 0)
      .sort((a, b) => Number(suspected(b)) - Number(suspected(a)) || gapOf(b) - gapOf(a) || Number(b.levers.includes("tax_roll")) - Number(a.levers.includes("tax_roll")) || a.id.localeCompare(b.id))[0];
    const auditing = auditors.find((man) => target === undefined || !own(target, man)) ?? auditors[0]!;
    // Nobody goes through his own books.
    if (target !== undefined && own(target, auditing)) continue;
    if (target !== undefined && world.audits.some((audit) => audit.status === "under_way" && audit.departmentId === target.id)) continue;
    const suspectMan = [...suspects].map((id) => world.characters.find((character) => character.id === id)).find((man) => man !== undefined && man.id !== auditing.id);
    // A king with no department to look at has his officer's household gone through.
    if (target === undefined && suspectMan === undefined) continue;
    const why = lustrum ? "the lustrum" : onSuspicion ? (short ? "the chest is short of what the roll promised" : `${suspectMan?.name ?? "a man"} is spoken ill of`) : "the year's accounting";
    const subject = target?.name ?? `the estates of ${suspectMan!.name}`;
    const maker = auditing.id;
    const deltas = [WorldDeltaSchema.parse({
      op: "audit_open", localId: `audit_${polity.id}_${monthOf(day)}`.slice(0, 60), auditorCharacterRef: maker,
      ...(target === undefined ? { householdOwnerRef: suspectMan!.id } : { departmentRef: target.id }),
      reason: `${auditing.name} goes through the books of ${subject}: ${why}.`.slice(0, 240),
    })];
    decisions.push({
      polityId: polity.id, actorCharacterId: auditing.id, act: "magistrate", targetPolityId: null,
      why: `audit: ${auditing.name} has the books of ${subject} gone through (${why}) [${target?.id ?? suspectMan!.id}]`.slice(0, 400), deltas, facts: [],
    });
  }
  return decisions;
}

