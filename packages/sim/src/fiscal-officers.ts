import {
  CUSTOMARY_TAX_RATE_BPS,
  DEFAULT_TAX_RATE_BPS,
  FactProposalSchema,
  MAX_CUSTOMS_RATE_BPS,
  WorldDeltaSchema,
  coinageStock,
  coinagesOf,
  economyOf,
  greedOf,
  isOwnToDo,
  liveProvinceIds,
  mayAct,
  monthlyTakings,
  officeTemper,
  readDepartments,
  stableHash,
  standardOf,
  taxBurdens,
  warsOf,
  type ActKind,
  type BodyRef,
  type Character,
  type FactProposal,
  type Office,
  type PoliticalProcedure,
  type QuestionConcern,
  type StatecraftEntry,
  type TaxBurden,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { convenersOf } from "./apply/asking";
import { purseOfHouse } from "./merchant-houses";
import type { StatecraftDecision, StatecraftInput } from "./statecraft";

/**
 * Who keeps a power's books when nobody is playing it (docs/economy.md, "Who manages the economy").
 *
 * The world AI made wars and peaces and had nothing to say about money: a power's rate of tax stood where
 * the scenario left it for a century, a treasury could run dry in a war without anybody borrowing, a tariff
 * was never touched. Now once a month (the world AI's own pass) every power nobody is playing has its
 * fiscal officer -- the head of the department that holds the tax roll (a quaestor of the Treasury of
 * Saturn, an officer of the Carthaginian Accounts), else any man of it, else the ruler -- read its books
 * and do the few things such a man did:
 *
 *  - **Tax.** Short of money (arrears, or less than two months of its pay in the chest and a deficit), raise
 *    the default rate a step, never past what its provinces can bear, never past the customary rate in
 *    peace nor past a war ceiling in war. Flush (eight months in hand, a surplus, at peace) and long
 *    enough since the last change, ease it back toward the ordinary rate (and lower only for a restless people). A gap between the two (cover two to eight months) is left
 *    alone: that is the hysteresis, and a ninety-day cooldown keeps a rate from flapping.
 *  - **Customs.** Dear grain in a quarter of its hubs: cut the tariff a step to draw bread in; short and
 *    trade strong: raise it a step.
 *  - **Credit.** At war with under a month of pay in the chest and a deficit: borrow from the merchant houses
 *    of its markets at their rate, and from bankers abroad for what they cannot lend.
 *  - **Coin.** Only in extremis -- at war, behind on its debts, a month from empty, the tax already at its
 *    ceiling -- strike the coin with less silver (Rome did in the Second Punic War); and re-strike it better
 *    once peace and a full chest allow.
 *  - **Trade.** Where two powers nobody plays are at peace and their trade runs large each way, and both
 *    tax what comes in, open a pact capping their tariffs; and lift an embargo that has outlived its war.
 *
 * **Through competence (H1).** The man does only what his charge lets him (`mayAct`, docs/plans/government.md): where it is his alone, or his with a
 * colleague's, he does it as above; where the matter is the chamber's (the Senate decrees the tribute past custom, a new tax, a loan, the coin; Carthage's elders the
 * same), he lays it before the chamber, and a consul or a magistrate of those who may convene it puts it (`convenersOf`), once, and waits on the vote; a motion
 * that passes is carried out the next month he looks, as far as it goes and no further, and one that fails is not moved again for a season; where the matter is none
 * of his, he leaves it. A power with no constitution on record, or a man with no office in it, does as before.
 *
 * Every act is an ordinary delta, applied by the burst through the same authority and money rules as any
 * other act (`calls: "none"`); nothing is written here. **The man matters.** His skill and his temper
 * (`officeTemper`) make his *quality*: a good one acts nearly every month, in a clean step; a poor one
 * acts late (some months nothing at all), in coarse steps, and lands a little off the rate he meant. His
 * greed is the existing mechanic's: what passes through a greedy officer's hands is skimmed (`departments.ts`),
 * and an audit finds it; here he is only named in the news, and a man men do not trust is said to be.
 *
 * Bounded: O(powers) a month plus one `taxBurdens` pass and one walk of the obligations, the sources and the
 * hubs; one decision, one fact a power a month, and the fact only for a power with something live in it
 * (`liveProvinceIds`). The log keeps what it did (`STATECRAFT_LOG_MAX`): the cooldowns are read off it.
 */

export const TAX_STEP_BPS = 200;
export const TAX_FLOOR_BPS = 800;
/** In peace a rate is not raised past the customary one; in war to this, and in extremis to the last. */
export const WAR_TAX_CEILING_BPS = 1_800;
export const EXTREMIS_TAX_CEILING_BPS = 2_200;
export const TAX_COOLDOWN_DAYS = 90;
/** Easing waits longer than raising does: a treasury is slow to trust a good year. */
export const TAX_EASE_COOLDOWN_DAYS = 180;
/** The share of what the provinces can bear that a rate may ask in all, after a raise. */
export const PROJECTED_BURDEN_CEILING = 0.8;
export const POOR_COVER_MONTHS = 2;
export const THIN_COVER_MONTHS = 1;
export const RICH_COVER_MONTHS = 8;
export const CUSTOMS_STEP_BPS = 250;
export const CUSTOMS_CEILING_BPS = 1_500;
export const CUSTOMS_COOLDOWN_DAYS = 60;
export const CREDIT_COOLDOWN_DAYS = 150;
export const COINAGE_COOLDOWN_OWN_DAYS = 365;
/** Grain this dear in a quarter of a power's hubs is a shortage that wants bread, not a tariff. */
export const SHORT_GRAIN_BPS = 14_000;
export const SHORT_HUB_SHARE = 0.25;
/** The most a power's debts to its lenders may stand at, in months of what it pays out, before it asks no more. */
export const DEBT_CEILING_MONTHS = 6;
/** What a trade between two powers must come to a month, each way, before they would bind it by a pact. */
export const PACT_FLOW_FLOOR = 25_000;
export const PACT_TARIFF_CAP_BPS = 600;
/** An embargo that has stood this long in peace has done what it will. */
export const EMBARGO_OUTLIVES_DAYS = 540;
/** No new pact opens in the whole world more often than this a month. */
export const NEW_PACTS_PER_MONTH = 1;
/** The opening weeks are the player's. */
const QUIET_OPENING_DAYS = 45;

/** The words an entry's `why` begins each of its parts with, which is how the next month's officer reads what was done and when. */
export type FiscalKind = "tax" | "customs" | "credit" | "coinage" | "pact" | "embargo";
const KINDS: readonly FiscalKind[] = ["tax", "customs", "credit", "coinage", "pact", "embargo"];

/** The day a power's fiscal officer last did each kind of thing, read off the log of what the rules did. */
export function lastFiscalDays(log: readonly StatecraftEntry[], polityId: string): Map<FiscalKind, number> {
  const last = new Map<FiscalKind, number>();
  for (const entry of log) {
    if (entry.act !== "fiscal" || entry.polityId !== polityId) continue;
    for (const kind of KINDS) if (entry.why.includes(`${kind}:`) && entry.day >= (last.get(kind) ?? -Infinity)) last.set(kind, entry.day);
  }
  return last;
}

/** The one line a power's finances read as in the slice, when its officer has done something lately; null otherwise. */
export function fiscalSliceLine(world: Pick<WorldState, "statecraft" | "instant">, polityId: string, withinDays = 60): string | null {
  let latest: StatecraftEntry | undefined;
  for (const entry of world.statecraft.log) if (entry.act === "fiscal" && entry.polityId === polityId && (latest === undefined || entry.day >= latest.day)) latest = entry;
  if (latest === undefined || world.instant.day - latest.day > withinDays) return null;
  return `Its accounts: ${latest.why.replace(/\b(tax|customs|credit|coinage|pact|embargo): /g, "").slice(0, 220)}`;
}

interface Books {
  readonly treasuryId: string;
  readonly balance: number;
  /** What it pays out a month by obligation: army pay, upkeep, salaries, tribute, debts. */
  readonly owed: number;
  readonly arrears: number;
  /** What its sources bring a month, before collection. */
  readonly income: number;
  /** What it still owes its lenders. */
  readonly debt: number;
}

const perMonth = (amount: number, cadenceSteps: number): number => (cadenceSteps <= 0 ? 0 : (amount * 30) / cadenceSteps);

/** Every power's books, in one walk of the obligations, the sources and the loans. */
function readTheBooks(world: WorldState): Map<string, Books> {
  const polityOf = new Map<string, string>();
  const treasuryOf = new Map<string, { id: string; balance: number }>();
  for (const account of world.material.accounts) {
    if (account.owner.kind !== "polity" || account.status !== "active") continue;
    if (!treasuryOf.has(account.owner.id)) treasuryOf.set(account.owner.id, { id: account.id, balance: account.balance });
    polityOf.set(account.id, account.owner.id);
  }
  const owed = new Map<string, number>();
  const arrears = new Map<string, number>();
  const income = new Map<string, number>();
  const debt = new Map<string, number>();
  for (const obligation of world.material.obligations) {
    if (!obligation.active) continue;
    const polityId = polityOf.get(obligation.payerAccountId);
    if (polityId === undefined) continue;
    owed.set(polityId, (owed.get(polityId) ?? 0) + perMonth(obligation.amount, obligation.cadenceSteps));
    arrears.set(polityId, (arrears.get(polityId) ?? 0) + obligation.arrears);
  }
  for (const source of world.material.incomeSources) {
    if (!source.active) continue;
    const polityId = polityOf.get(source.beneficiaryAccountId);
    if (polityId === undefined) continue;
    income.set(polityId, (income.get(polityId) ?? 0) + perMonth((source.amount * source.collectionRateBps) / 10_000, source.cadenceSteps));
  }
  for (const loan of world.material.loans) {
    if (loan.status !== "active") continue;
    const polityId = polityOf.get(loan.borrowerAccountId);
    if (polityId !== undefined) debt.set(polityId, (debt.get(polityId) ?? 0) + loan.outstanding);
  }
  const books = new Map<string, Books>();
  for (const [polityId, chest] of treasuryOf) {
    books.set(polityId, { treasuryId: chest.id, balance: chest.balance, owed: owed.get(polityId) ?? 0, arrears: arrears.get(polityId) ?? 0, income: income.get(polityId) ?? 0, debt: debt.get(polityId) ?? 0 });
  }
  return books;
}

/** How many of a power's hubs it has, and how many of them hold grain at a famine price, in one walk of the markets. */
function grainStress(world: WorldState): Map<string, { hubs: number; short: number }> {
  const holder = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  const stress = new Map<string, { hubs: number; short: number }>();
  for (const hub of economyOf(world).markets) {
    const polityId = holder.get(hub.hubId);
    if (polityId === undefined || polityId === null) continue;
    const grain = hub.goods.find((entry) => entry.good === "grain");
    const kept = stress.get(polityId) ?? { hubs: 0, short: 0 };
    kept.hubs += 1;
    if (grain !== undefined && grain.priceBps >= SHORT_GRAIN_BPS) kept.short += 1;
    stress.set(polityId, kept);
  }
  return stress;
}

const delta = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
const fact = (raw: Record<string, unknown>): FactProposal => FactProposalSchema.parse(raw);
const pct = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
const monthsWord = (months: number): string => (months >= 99 ? "many months" : months < 0.1 ? "next to nothing" : `${months.toFixed(1)} months`);

/** What the man at the books is worth, 5 to 100: his skill at the tax roll and what his temper adds to the work. */
function qualityOf(skill: number, officer: Character): number {
  return Math.max(5, Math.min(100, Math.round(skill + officeTemper(officer))));
}

/** Whose hand it is: the head of the department that holds the tax roll, any man of it, or the ruler. */
function officerOf(world: WorldState, polityId: string, reader: ReturnType<typeof readDepartments>, ruler: Character | undefined): { officer: Character; skill: number } | null {
  const holding = reader.holding({ kind: "polity", id: polityId }, "tax_roll");
  const man = holding.head ?? holding.people.find((person) => person.alive) ?? ruler;
  if (man === undefined) return null;
  return { officer: man, skill: reader.skill({ kind: "polity", id: polityId }, "tax_roll") };
}

// ── What is his to do, and what is the chamber's ──────────────────────────────

/** A season a motion that failed is not moved again in. */
export const MOTION_REST_DAYS = 120;
/** How long a motion that carried waits for the officer to carry it out before it lapses. */
export const DECREE_LAPSES_DAYS = 120;

/** What a man's competence makes of an act of his own: do it, lay it before the chamber, or leave it. */
type Footing = { readonly how: "own" } | { readonly how: "ask"; readonly body: BodyRef } | { readonly how: "no"; readonly why: string };

function footingOf(world: WorldState, officer: Character, act: ActKind, offices: readonly Office[], magnitude: number | undefined): Footing {
  const may = mayAct(world, officer.id, act, { offices, ...(magnitude === undefined ? {} : { magnitude }) });
  // No constitution on record for the power, or no office of it held: as the rules always did.
  if (may === null || isOwnToDo(may.grade)) return { how: "own" };
  if (may.grade === "by_the_body" && may.body !== null) return { how: "ask", body: may.body };
  return { how: "no", why: may.why };
}

/** One thing the officer would do, and how it would be put to the chamber if it is not his to do. */
interface Matter {
  readonly kind: FiscalKind;
  readonly act: ActKind;
  /** In the act's own unit (`WITHIN_UNIT`), where it has a figure. */
  readonly magnitude?: number;
  /** What the motion says, as it follows "that": "the tribute of Rome be laid at 14 in a hundred". The same words the competence gate lays a player's motion in. */
  readonly label: string;
  readonly concerns: readonly QuestionConcern[];
  readonly deltas: readonly WorldDelta[];
  readonly text: string;
  readonly why: string;
}

const inAHundred = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)} in a hundred`;
/** The figure a motion's words end in or begin with, in basis points or silver; null where it has none. */
function figureIn(label: string): number | null {
  const rate = /at ([0-9.]+) in a hundred$/u.exec(label);
  if (rate !== null) return Math.round(Number(rate[1]) * 100);
  const sum = /^([0-9]+) be borrowed/u.exec(label);
  return sum === null ? null : Number(sum[1]);
}
/** What a label says before its figure: two motions about the same thing differ only by it. */
const stemOf = (label: string): string => label.replace(/ at [0-9.]+ in a hundred$/u, "").replace(/^[0-9]+ be borrowed/u, "be borrowed");

/**
 * The motions the officers have put (a deliberation opened by an officer about his own power), by the power: what is waiting on a vote,
 * what carried and is not yet carried out, and what failed lately. Read off the world's own questions, with nothing stored beside them.
 */
function motionsByPower(world: WorldState): Map<string, PoliticalProcedure[]> {
  const found = new Map<string, PoliticalProcedure[]>();
  for (const procedure of world.material.politicalProcedures) {
    if (procedure.type !== "council_deliberation" || procedure.subjectKind !== "polity" || procedure.subjectId === null || !procedure.label.startsWith("Motion of ")) continue;
    const list = found.get(procedure.subjectId);
    if (list === undefined) found.set(procedure.subjectId, [procedure]);
    else list.push(procedure);
  }
  return found;
}

const thatOf = (procedure: PoliticalProcedure): string => procedure.label.slice(procedure.label.indexOf(": that ") + 7);

/** The man who puts a motion to the chamber: himself where his office convenes it, else the best known of those who do, else himself (a chamber nobody is named to convene). */
function sponsorOf(world: WorldState, officer: Character, bodyId: string): Character {
  const chamber = world.material.institutions.find((institution) => institution.id === bodyId);
  if (chamber === undefined) return officer;
  const conveners = convenersOf(world, chamber);
  if (conveners.length === 0 || conveners.includes(officer.id)) return officer;
  const best = conveners
    .map((id) => world.characters.find((character) => character.id === id)!)
    .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
  return best ?? officer;
}

interface Asked { readonly kind: FiscalKind; readonly label: string; readonly text: string; readonly why: string; readonly delta: WorldDelta }

interface Weighing {
  readonly offices: readonly Office[];
  /** The motions already put about this power. */
  readonly mine: readonly PoliticalProcedure[];
  readonly day: number;
  readonly month: string;
  /** The day this kind of thing was last done by the rules, if ever. */
  readonly carriedDay: number | undefined;
  /** What has been laid before a chamber already this month, so that the same matter is not put twice. */
  readonly asked: readonly Asked[];
}

/**
 * A matter weighed against the competence of the man who would do it: `"own"` where it is his to do (or the chamber has decreed it and he is carrying out the
 * decree), the motion to lay before the chamber where it is the chamber's and nothing of it is waiting or lately failed, and null where it is none of his
 * or is already before the chamber.
 */
function weigh(world: WorldState, officer: Character, polity: { readonly id: string; readonly name: string }, matter: Matter, context: Weighing): "own" | Asked | null {
  const { offices, mine, day, month } = context;
  const stand = footingOf(world, officer, matter.act, offices, matter.magnitude);
  if (stand.how === "own") return "own";
  if (stand.how === "no") return null;
  const stem = stemOf(matter.label);
  const figure = figureIn(matter.label);
  // The chamber has decreed it and it is not yet carried out: his to do, as far as the decree goes.
  const decreed = mine.some((procedure) => procedure.outcome === "passed" && stemOf(thatOf(procedure)) === stem
    && (procedure.resolvedAtStep ?? 0) >= day - DECREE_LAPSES_DAYS && (context.carriedDay === undefined || context.carriedDay < (procedure.resolvedAtStep ?? 0))
    && (figure === null || (figureIn(thatOf(procedure)) ?? Infinity) + 10 >= figure));
  if (decreed) return "own";
  const waiting = mine.some((procedure) => procedure.outcome === null && stemOf(thatOf(procedure)) === stem);
  const failed = mine.some((procedure) => procedure.outcome !== null && procedure.outcome !== "passed" && stemOf(thatOf(procedure)) === stem && (procedure.resolvedAtStep ?? 0) > day - MOTION_REST_DAYS);
  if (waiting || failed || context.asked.some((entry) => stemOf(entry.label) === stem)) return null;
  const sponsor = sponsorOf(world, officer, stand.body.id);
  const chamber = stand.body.name.replace(/^the\s+/iu, "");
  return {
    kind: matter.kind, label: matter.label,
    text: `laid it before the ${chamber} that ${matter.label}, for it is not his to decide${sponsor.id === officer.id ? "" : `, and ${sponsor.name} put it`}`,
    why: `asked the ${chamber} that ${matter.label}`,
    delta: WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: `motion_${matter.kind}_${polity.id}_${month}`.slice(0, 60), type: "council_deliberation", institutionRef: stand.body.id,
      sponsorCharacterRef: sponsor.id, subjectKind: "polity", subjectRef: polity.id, label: `Motion of ${officer.name}: that ${matter.label}`.slice(0, 200),
      resolutionMechanism: "vote", deadlineInDays: 10, visibility: "public", enacts: null, concerns: [...matter.concerns],
      reason: `${officer.name} may not decide it alone, and moved it in the ${stand.body.name}.`.slice(0, 240),
    }),
  };
}

/**
 * The fiscal decisions of the month, one at most for each power nobody plays, in power order.
 *
 * Nothing is applied: each decision carries its deltas and one fact, which the burst applies as the
 * rules' own business (`statecraft.ts` runs this with its other passes).
 */
export function decideFiscal(input: Pick<StatecraftInput, "world" | "gameId" | "excludedPolityIds" | "playedByModel" | "playerCharacterId" | "offices">): StatecraftDecision[] {
  const { world } = input;
  const day = world.instant.day;
  if (day < QUIET_OPENING_DAYS) return [];
  const books = readTheBooks(world);
  if (books.size === 0) return [];
  const reader = readDepartments(world);
  const memory = economyOf(world);
  const stress = grainStress(world);
  const burdens = taxBurdens(world, { officeSkill: (polityId) => reader.skill({ kind: "polity", id: polityId }, "tax_roll") });
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const rulerOf = (polityId: string): Character | undefined => reader.rulers(polityId).find((ruler) => ruler.alive && ruler.id !== input.playerCharacterId);
  const month = String(Math.floor(day / 30));
  const offices = input.offices ?? [];
  const motions = motionsByPower(world);

  // Which powers have something live in them: the others make no news (`liveProvinceIds`), however they keep their books.
  let livePowers: Set<string> | undefined;
  const isLivePower = (polityId: string): boolean => {
    if (livePowers === undefined) {
      const live = liveProvinceIds(world);
      livePowers = new Set(world.map.provinces.filter((province) => province.controllerPolityId !== null && live.has(province.id)).map((province) => province.controllerPolityId!));
    }
    return livePowers.has(polityId);
  };
  const inboundOf = new Map<string, number>();
  const flowBetween = new Map<string, number>();
  for (const lane of memory.tradeLanes) {
    inboundOf.set(lane.toPolityId, (inboundOf.get(lane.toPolityId) ?? 0) + lane.value);
    flowBetween.set(`${lane.fromPolityId}>${lane.toPolityId}`, lane.value);
  }
  const decisions: StatecraftDecision[] = [];
  const hasDecision = new Set<string>();

  for (const polity of [...world.map.polities].sort((a, b) => a.id.localeCompare(b.id))) {
    const book = books.get(polity.id);
    if (book === undefined || input.excludedPolityIds.has(polity.id)) continue;
    const ruler = rulerOf(polity.id);
    const hand = officerOf(world, polity.id, reader, ruler);
    if (hand === null) continue;
    const { officer, skill } = hand;
    // A man the model is playing keeps his own books: the king whose own hand they are, or the officer himself. The ruler being played is
    // another matter -- he has his wars and his letters, and the man who keeps the accounts goes on keeping them.
    if (input.playedByModel.has(officer.id)) continue;
    if (!officer.alive || officer.id === input.playerCharacterId) continue;

    const quality = qualityOf(skill, officer);
    const greed = greedOf(officer);
    const burden: TaxBurden | undefined = burdens.get(polity.id);
    const wars = warsOf(world.polityAgreements, polity.id).length;
    const atWar = wars > 0;
    const owed = book.owed;
    const cover = owed <= 0 ? 99 : book.balance / owed;
    const collected = burden?.collectedShare ?? 1;
    const net = book.income * collected - owed;
    const strained = book.arrears > 0 || (cover < POOR_COVER_MONTHS && net < 0);
    const flush = book.arrears === 0 && cover > RICH_COVER_MONTHS && net >= 0;
    const last = lastFiscalDays(world.statecraft.log, polity.id);
    const since = (kind: FiscalKind): number => (last.has(kind) ? day - last.get(kind)! : Infinity);
    const hubs = stress.get(polity.id);
    const shortShare = hubs === undefined || hubs.hubs === 0 ? 0 : hubs.short / hubs.hubs;

    // A poor officer is late: the better the man, the more months he acts at all, and in an emergency a month more often.
    const emergency = strained && (book.arrears > 0 || cover < THIN_COVER_MONTHS);
    const reach = 35 + quality * 0.65 + (emergency ? 25 : 0);
    if (stableHash([input.gameId, "fiscal", polity.id, month, "late"]) % 100 >= reach) continue;
    // And off the mark by as much as he is unskilled, in 50s of a point of rate; steps coarser the poorer he is.
    const step = quality >= 65 ? TAX_STEP_BPS : quality >= 35 ? 250 : 400;
    const noise = quality >= 65 ? 0 : Math.round((((stableHash([input.gameId, "fiscal", polity.id, month, "noise"]) % 201) - 100) / 100) * ((100 - quality) / 100) * 150 / 50) * 50;

    const parts: { kind: FiscalKind; text: string; why: string }[] = [];
    const deltas: WorldDelta[] = [];
    const asked: Asked[] = [];
    const mine = motions.get(polity.id) ?? [];

    /**
     * What he would do, weighed against his charge: done where it is his, laid before the chamber where it is the chamber's (once; not while it waits
     * on a vote, nor for a season after one failed), carried out as far as the chamber decreed where it has, and left where it is none of his.
     */
    const submit = (matter: Matter): void => {
      const weighed = weigh(world, officer, polity, matter, { offices, mine, day, month, carriedDay: last.get(matter.kind), asked });
      if (weighed === "own") {
        deltas.push(...matter.deltas);
        parts.push({ kind: matter.kind, text: matter.text, why: matter.why });
      } else if (weighed !== null) asked.push(weighed);
    };
    const taxPolicy = memory.taxPolicies.find((policy) => policy.polityId === polity.id);
    const rate = taxPolicy?.rateBps ?? DEFAULT_TAX_RATE_BPS;
    const regime = taxPolicy?.regime ?? "land_levy";
    const askedRatio = burden === undefined || !Number.isFinite(burden.bearable) || burden.bearable <= 0 ? 0 : burden.asked / burden.bearable;
    const extremis = atWar && book.arrears > 0 && cover < 0.5;
    const peaceCeiling = Math.max(CUSTOMARY_TAX_RATE_BPS, rate);
    const ceiling = extremis ? EXTREMIS_TAX_CEILING_BPS : atWar ? WAR_TAX_CEILING_BPS : peaceCeiling;
    const taxWait = since("tax");

    // ── Tax ────────────────────────────────────────────────────────────
    let rateAtCeiling = false;
    // A people that owes its men to a leader (`men`) has no rate of silver to move: its levy is its own and its tribute is the foedus's.
    if (regime === "men") {
      // No tax act.
    } else if (strained) {
      const wanted = Math.min(ceiling, Math.max(TAX_FLOOR_BPS, rate + step + noise));
      const projected = askedRatio * (wanted / Math.max(1, rate));
      rateAtCeiling = rate + 100 > ceiling || projected > PROJECTED_BURDEN_CEILING;
      if (taxWait >= TAX_COOLDOWN_DAYS && wanted > rate && projected <= PROJECTED_BURDEN_CEILING) {
        submit({
          kind: "tax", act: "tax_rate", magnitude: wanted, concerns: ["taxes"], label: `the tribute of ${polity.name} be laid at ${inAHundred(wanted)}`,
          deltas: [delta({ op: "tax_policy_set", scope: "polity", polityId: polity.id, provinceId: null, regime, rateBps: wanted, reason: `${officer.name} raises the rate: the chest holds ${monthsWord(cover)} of its pay.`.slice(0, 240) })],
          why: `tax: raised the rate ${pct(rate)} to ${pct(wanted)} (${monthsWord(cover)} in the chest${book.arrears > 0 ? ", pay in arrears" : ""})`,
          text: `raised the rate of tax from ${pct(rate)} to ${pct(wanted)} of what the land can bear, the chest holding ${monthsWord(cover)} of its pay${book.arrears > 0 ? " and the soldiers' pay behind" : ""}`,
        });
      }
    } else if (taxWait >= TAX_EASE_COOLDOWN_DAYS && ((flush && !atWar && rate > DEFAULT_TAX_RATE_BPS) || (rate > TAX_FLOOR_BPS && burden !== undefined && burden.stabilityShiftBps <= -3_000 && cover >= POOR_COVER_MONTHS))) {
      // A surplus undoes what a want did and goes no further: back to the ordinary rate the power began at. Only a restless people takes it lower.
      const wanted = Math.max(flush ? DEFAULT_TAX_RATE_BPS : TAX_FLOOR_BPS, rate - step - Math.max(0, noise));
      if (wanted < rate) {
        const why = flush ? `${monthsWord(cover)} in the chest and a surplus at peace` : "the provinces are restless under what they pay";
        submit({
          kind: "tax", act: "tax_rate", magnitude: 0, concerns: ["taxes"], label: `the tribute of ${polity.name} be laid at ${inAHundred(wanted)}`,
          deltas: [delta({ op: "tax_policy_set", scope: "polity", polityId: polity.id, provinceId: null, regime, rateBps: wanted, reason: `${officer.name} eases the rate: ${why}.`.slice(0, 240) })],
          why: `tax: eased the rate ${pct(rate)} to ${pct(wanted)} (${why})`, text: `eased the rate of tax from ${pct(rate)} to ${pct(wanted)}: ${why}`,
        });
      }
    } else if (taxWait >= TAX_COOLDOWN_DAYS && shortShare >= 0.34 && regime === "land_levy") {
      // A famine year under a steady levy takes the seed-corn: a tithe follows the harvest down.
      // A tax of another kind is a new tax, and no magistrate lays a new tax (the competence gate reads it so too).
      submit({
        kind: "tax", act: "tax_rate", magnitude: Number.POSITIVE_INFINITY, concerns: ["taxes"], label: `the tribute of ${polity.name} be laid anew, as a tithe at ${inAHundred(rate)}`,
        deltas: [delta({ op: "tax_policy_set", scope: "polity", polityId: polity.id, provinceId: null, regime: "tithe", rateBps: rate, reason: `${officer.name} shifts the levy to a tithe: the harvest has failed in ${hubs?.short ?? 0} of its markets.`.slice(0, 240) })],
        why: "tax: changed the levy to a tithe (the harvest has failed)", text: "changed the land levy to a tithe, which follows the harvest down: bread is dear in a quarter of its markets",
      });
    }

    // ── Customs ────────────────────────────────────────────────────────
    const customsRate = memory.customsRates.find((entry) => entry.polityId === polity.id)?.rateBps ?? 0;
    if (since("customs") >= CUSTOMS_COOLDOWN_DAYS) {
      if (shortShare >= SHORT_HUB_SHARE && customsRate > 0) {
        const wanted = Math.max(0, customsRate - CUSTOMS_STEP_BPS);
        submit({
          kind: "customs", act: "customs", magnitude: 0, concerns: ["taxes", "trade"], label: `the customs of ${polity.name} be laid at ${inAHundred(wanted)}`,
          deltas: [delta({ op: "tax_policy_set", scope: "customs", polityId: polity.id, provinceId: null, regime: "land_levy", rateBps: wanted, reason: `${officer.name} lowers the customs to draw bread in.`.slice(0, 240) })],
          why: `customs: lowered the customs ${pct(customsRate)} to ${pct(wanted)} (grain is dear)`, text: `lowered the customs from ${pct(customsRate)} to ${pct(wanted)} to draw grain in`,
        });
      } else if (strained && (inboundOf.get(polity.id) ?? 0) >= 20_000 && customsRate + CUSTOMS_STEP_BPS <= Math.min(CUSTOMS_CEILING_BPS, MAX_CUSTOMS_RATE_BPS) && shortShare < SHORT_HUB_SHARE) {
        const wanted = customsRate + CUSTOMS_STEP_BPS;
        submit({
          kind: "customs", act: "customs", magnitude: wanted, concerns: ["taxes", "trade"], label: `the customs of ${polity.name} be laid at ${inAHundred(wanted)}`,
          deltas: [delta({ op: "tax_policy_set", scope: "customs", polityId: polity.id, provinceId: null, regime: "land_levy", rateBps: wanted, reason: `${officer.name} raises the customs: trade is strong and the chest is short.`.slice(0, 240) })],
          why: `customs: raised the customs ${pct(customsRate)} to ${pct(wanted)} (the chest is short)`, text: `raised the customs from ${pct(customsRate)} to ${pct(wanted)}, for the trade is strong and the chest short`,
        });
      }
    }

    // ── Credit ─────────────────────────────────────────────────────────
    if (atWar && strained && cover < THIN_COVER_MONTHS && net < 0 && since("credit") >= CREDIT_COOLDOWN_DAYS && book.debt < DEBT_CEILING_MONTHS * Math.max(owed, 1)) {
      const wanted = Math.max(20_000, Math.round(Math.max(owed * 2 - book.balance, owed)));
      let remaining = wanted;
      const lenders: { house: string; head: Character; amount: number }[] = [];
      const houses = memory.houses
        .filter((house) => house.status === "trading")
        .map((house) => ({ house, purse: purseOfHouse(world, house) }))
        .filter((entry) => entry.purse !== null && entry.purse.active && entry.purse.balance >= 40_000)
        .filter((entry) => entry.house.polityId === polity.id)
        .sort((a, b) => b.purse!.balance - a.purse!.balance || a.house.id.localeCompare(b.house.id));
      for (const { house, purse } of houses.slice(0, 2)) {
        const head = world.characters.find((character) => character.id === house.headCharacterId);
        if (head === undefined || !head.alive) continue;
        const amount = Math.min(remaining, Math.floor(purse!.balance * 0.3));
        if (amount < 5_000) continue;
        lenders.push({ house: house.name.replace(/^The /, "the "), head, amount });
        remaining -= amount;
      }
      const rateBps = book.arrears > 0 ? 200 : 150;
      const loanDeltas: WorldDelta[] = [];
      let n = 0;
      for (const lender of lenders) {
        n += 1;
        loanDeltas.push(delta({
          op: "loan_open", localId: `fiscal_loan_${polity.id}_${month}_${n}`.slice(0, 60), lenderKind: "character", lenderRef: lender.head.id, borrowerAccountRef: book.treasuryId,
          principal: lender.amount, interestBps: rateBps, cadenceDays: 30, terms: `A loan from ${lender.house} to the treasury of ${polity.name}, at ${pct(rateBps)} a month`.slice(0, 300), collateralHoldingRef: null,
          reason: `${officer.name} borrows from ${lender.house} for the war.`.slice(0, 240),
        }));
      }
      if (remaining >= 10_000) {
        loanDeltas.push(delta({
          op: "loan_open", localId: `fiscal_loan_${polity.id}_${month}_abroad`.slice(0, 60), lenderKind: "foreign", lenderRef: null, borrowerAccountRef: book.treasuryId,
          principal: remaining, interestBps: 250, cadenceDays: 30, terms: `A loan from the bankers abroad to the treasury of ${polity.name}, at 2.5% a month`,
          collateralHoldingRef: null, reason: `${officer.name} borrows abroad for the war.`.slice(0, 240),
        }));
      }
      if (loanDeltas.length > 0) {
        const from = lenders.length === 0 ? "bankers abroad" : lenders.map((lender) => lender.house).join(" and ") + (remaining >= 10_000 ? " and bankers abroad" : "");
        const takings = monthlyTakings(world, polity.id);
        submit({
          kind: "credit", act: "loans", magnitude: takings <= 0 ? Number.POSITIVE_INFINITY : wanted / takings, concerns: ["spending"],
          label: `${wanted} be borrowed in the name of ${polity.name}`, deltas: loanDeltas,
          why: `credit: borrowed ${wanted - Math.max(0, remaining < 10_000 ? remaining : 0)} for the war from ${from}`.slice(0, 160), text: `borrowed ${wanted} for the war from ${from}, with ${monthsWord(cover)} of pay in the chest`,
        });
      }
    }

    // ── Coin ───────────────────────────────────────────────────────────
    const coinage = coinagesOf(world).find((candidate) => candidate.issuerPolityId === polity.id);
    if (coinage !== undefined && since("coinage") >= COINAGE_COOLDOWN_OWN_DAYS) {
      const standard = standardOf(coinage);
      if (extremis && (rateAtCeiling || taxWait < TAX_COOLDOWN_DAYS) && coinage.silverBps >= standard * 0.6) {
        submit({
          kind: "coinage", act: "coinage", magnitude: 1_500, concerns: ["coinage"], label: `${coinage.name} be struck with less silver`,
          deltas: [delta({ op: "coinage_debase", coinageId: coinage.id, targetSilverBps: null, stepBps: -1_500, reason: `${officer.name} has the mint strike lighter coin: the war has emptied the chest.`.slice(0, 240) })],
          why: `coinage: struck ${coinage.name} lighter (the war has emptied the chest)`, text: `had the mint strike ${coinage.name} lighter, for the war has emptied the chest and the soldiers' pay is behind`,
        });
      } else if (!atWar && cover >= 6 && coinage.silverBps < standard * 0.92) {
        const cost = Math.round((coinageStock(world, coinage.id) * 0.3 * 1_000) / 10_000);
        if (book.balance >= 2 * cost) {
          submit({
            kind: "coinage", act: "coinage", magnitude: 1_000, concerns: ["coinage"], label: `${coinage.name} be struck with more silver`,
            deltas: [delta({ op: "coinage_debase", coinageId: coinage.id, targetSilverBps: null, stepBps: 1_000, reason: `${officer.name} has the mint re-strike the coin better, now there is peace and money.`.slice(0, 240) })],
            why: `coinage: re-struck ${coinage.name} with more silver (peace, and a full chest)`, text: `had ${coinage.name} re-struck with more silver, now there is peace and the chest is full`,
          });
        }
      }
    }

    if (parts.length === 0 && asked.length === 0) continue;
    hasDecision.add(polity.id);
    const doing = [...parts.map((part) => part.text), ...asked.map((entry) => entry.text)].join("; and ");
    const trusted = greed >= 60 ? " Men do not trust his hands." : "";
    const summary = `${officer.name}, who keeps the books of ${polity.name}, ${doing}.${trusted}`.slice(0, 400);
    const news = isLivePower(polity.id) && [...parts, ...asked].some((part) => part.kind !== "customs");
    decisions.push({
      polityId: polity.id,
      // The officer's own hand. A quaestor's office holds the proposal and not the rate, so the burst applies these as the power's
      // standing business (`sanctioned`, `burst.ts`): the same rules of money and reach, with the authority taken as given.
      actorCharacterId: officer.id,
      act: "fiscal",
      targetPolityId: null,
      why: [...parts, ...asked].map((part) => part.why).join(" | ").slice(0, 400),
      deltas: [...deltas, ...asked.map((entry) => entry.delta)],
      facts: news
        ? [fact({
          localId: `fiscal_${polity.id}_${month}`.slice(0, 60), kind: "fiscal", summary,
          affectedRefs: [{ kind: "polity", id: polity.id }, { kind: "character", id: officer.id }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: parts.some((part) => part.kind === "coinage") ? 55 : 35,
        })]
        : [],
    });
  }

  decisions.push(...tradeDiplomacy(input, reader, flowBetween, rulerOf, nameOf, hasDecision, motions));
  return decisions;
}

/**
 * Pacts that bind a great trade, and embargoes that outlived their war, between powers nobody plays.
 *
 * A pact only where both sides gain: both lay customs above the cap, the trade runs both ways at
 * least `PACT_FLOW_FLOOR` a month, neither is at war with anybody the other leads, and neither
 * is the player's. One new pact a month in the whole world. An embargo laid by a power nobody plays is
 * lifted when it has stood `EMBARGO_OUTLIVES_DAYS` and the two are at peace. The agreement's own news is
 * the news: these decisions carry no fact of their own.
 */
function tradeDiplomacy(
  input: Pick<StatecraftInput, "world" | "gameId" | "excludedPolityIds" | "playedByModel" | "playerCharacterId" | "offices">,
  reader: ReturnType<typeof readDepartments>,
  flowBetween: ReadonlyMap<string, number>,
  rulerOf: (polityId: string) => Character | undefined,
  nameOf: (id: string) => string,
  _busy: ReadonlySet<string>,
  motions: ReadonlyMap<string, readonly PoliticalProcedure[]>,
): StatecraftDecision[] {
  void reader;
  const { world } = input;
  const day = world.instant.day;
  const offices = input.offices ?? [];
  const month = String(Math.floor(day / 30));
  /** Whether the chamber has lately carried a motion of these words that nobody has yet carried out: the matter is then his to do whatever the dice say. */
  const decreed = (polityId: string, label: string): boolean => (motions.get(polityId) ?? []).some((procedure) => procedure.outcome === "passed" && thatOf(procedure) === label && (procedure.resolvedAtStep ?? 0) >= day - DECREE_LAPSES_DAYS);
  const memory = economyOf(world);
  const decisions: StatecraftDecision[] = [];
  const free = (polityId: string): Character | undefined => {
    if (input.excludedPolityIds.has(polityId)) return undefined;
    const ruler = rulerOf(polityId);
    return ruler === undefined || input.playedByModel.has(ruler.id) ? undefined : ruler;
  };
  const rateOf = (polityId: string): number => memory.customsRates.find((entry) => entry.polityId === polityId)?.rateBps ?? 0;

  // Embargoes that have done what they will.
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind !== "embargo" || day - agreement.sinceStep < EMBARGO_OUTLIVES_DAYS) continue;
    const layer = free(agreement.polityId);
    if (layer === undefined || warsOf(world.polityAgreements, agreement.polityId).includes(agreement.otherPolityId)) continue;
    const liftLabel = `the embargo on ${nameOf(agreement.otherPolityId)} be lifted`;
    if (!decreed(agreement.polityId, liftLabel) && stableHash([input.gameId, "fiscal-embargo", agreement.id, month]) % 100 >= 30) continue;
    const lifting: Matter = {
      kind: "embargo", act: "embargoes", label: liftLabel, concerns: ["trade"],
      deltas: [delta({ op: "agreement_close", agreementRef: agreement.id, reason: `${layer.name} lifts the embargo: it has outlived its quarrel.`.slice(0, 240) })],
      why: `embargo: lifted the embargo on ${nameOf(agreement.otherPolityId)} (it has stood ${Math.round((day - agreement.sinceStep) / 30)} months in peace)`.slice(0, 400),
      text: "lifted the embargo",
    };
    const weighed = weigh(world, layer, { id: agreement.polityId, name: nameOf(agreement.polityId) }, lifting, { offices, mine: motions.get(agreement.polityId) ?? [], day, month, carriedDay: undefined, asked: [] });
    if (weighed === null) continue;
    decisions.push({
      polityId: agreement.polityId, actorCharacterId: layer.id, act: "fiscal", targetPolityId: agreement.otherPolityId,
      why: weighed === "own" ? lifting.why : weighed.why.slice(0, 400),
      deltas: weighed === "own" ? lifting.deltas : [weighed.delta],
      facts: [],
    });
  }

  // One new pact a month.
  const candidates: { a: string; b: string; flow: number }[] = [];
  for (const [key, value] of flowBetween) {
    const [from, to] = key.split(">") as [string, string];
    if (from > to) continue;
    const back = flowBetween.get(`${to}>${from}`) ?? 0;
    if (value < PACT_FLOW_FLOOR || back < PACT_FLOW_FLOOR) continue;
    candidates.push({ a: from, b: to, flow: value + back });
  }
  candidates.sort((x, y) => y.flow - x.flow || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  let opened = 0;
  for (const candidate of candidates) {
    if (opened >= NEW_PACTS_PER_MONTH) break;
    const ruler = free(candidate.a);
    const other = free(candidate.b);
    if (ruler === undefined || other === undefined) continue;
    if (rateOf(candidate.a) <= PACT_TARIFF_CAP_BPS || rateOf(candidate.b) <= PACT_TARIFF_CAP_BPS) continue;
    const standing = world.polityAgreements.some((agreement) => agreement.status === "active" && (agreement.kind === "trade_pact" || agreement.kind === "embargo" || agreement.kind === "war")
      && ((agreement.polityId === candidate.a && agreement.otherPolityId === candidate.b) || (agreement.polityId === candidate.b && agreement.otherPolityId === candidate.a)));
    if (standing) continue;
    if (warsOf(world.polityAgreements, candidate.a).includes(candidate.b)) continue;
    const pactLabel = `a trade pact be made with ${nameOf(candidate.b)}`;
    if (!decreed(candidate.a, pactLabel) && stableHash([input.gameId, "fiscal-pact", candidate.a, candidate.b, month]) % 100 >= 25) continue;
    const pact: Matter = {
      kind: "pact", act: "pacts", label: pactLabel, concerns: ["peace", "trade"],
      deltas: [delta({
        op: "agreement_open", localId: `fiscal_pact_${candidate.a}_${candidate.b}_${Math.floor(day / 30)}`.slice(0, 60), kind: "trade_pact", polityId: candidate.a, otherPolityId: candidate.b,
        terms: `Their merchants trade on the best terms either gives: neither lays more than ${pct(PACT_TARIFF_CAP_BPS)} on the other's goods.`,
        trade: { tariffCapBps: PACT_TARIFF_CAP_BPS, mostFavoured: false, exempt: [], goods: [] }, visibility: "public",
        reason: `${ruler.name} binds the trade with ${nameOf(candidate.b)} by a pact: both would gain.`.slice(0, 240),
      })],
      why: `pact: opened a trade pact with ${nameOf(candidate.b)}, capping customs at ${pct(PACT_TARIFF_CAP_BPS)} (the trade between them is great)`.slice(0, 400),
      text: "opened a trade pact",
    };
    const weighed = weigh(world, ruler, { id: candidate.a, name: nameOf(candidate.a) }, pact, { offices, mine: motions.get(candidate.a) ?? [], day, month, carriedDay: undefined, asked: [] });
    if (weighed === null) continue;
    decisions.push({
      polityId: candidate.a, actorCharacterId: ruler.id, act: "fiscal", targetPolityId: candidate.b,
      why: weighed === "own" ? pact.why : weighed.why.slice(0, 400),
      deltas: weighed === "own" ? pact.deltas : [weighed.delta],
      facts: [],
    });
    opened += 1;
  }
  return decisions;
}
