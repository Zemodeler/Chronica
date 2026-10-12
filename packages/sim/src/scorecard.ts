import { ORDER_PART_STATUS_LABEL, goalsMet, orderPartStatus, type OrderPart, type OrderPartStatus, type OrderRecord, type WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";
import { CLERK_PHRASES } from "./chronicle-lint";
import { assertsWords, lineOf, orderOfPart } from "./order-outcomes";

/**
 * The scorecard of plan `chronicle-and-order-truth` (phase 0): what a run told
 * the player about its orders against what the world shows, and how the
 * Chronicle read.
 *
 * Order metrics judge the line the player was shown, read back from its
 * words, against evidence read from raw state -- goals against their
 * baseline, the part's own acts and the work they made since the order, acts
 * carried and refused, failed stages -- never against `orderPartStatus` or
 * `lineOf`, so a line that lies cannot also be what passes it. A clause shown
 * no line and no prose is missing: the scorecard never assumes narration it
 * was not handed. Prose metrics are counts over the entries as written.
 * Nothing here calls a model.
 */

export interface PartScore {
  readonly said: string;
  /** What the displayed line tells (read back from its words), or null when no line tells it. */
  readonly status: OrderPartStatus | null;
  /** The engine's own reading, for comparison only. */
  readonly reckoned: OrderPartStatus;
  readonly line: string | null;
  /** Told "done" with no evidence tied to this part (`evidenceOfDone`). */
  readonly doneWithoutEvidence: boolean;
  /** Evidence tied to this part shows it worked and it is not told as so. */
  readonly hiddenSuccess: boolean;
  /** A refusal or failed act is on the record and the part is told as done. */
  readonly erasedFailure: boolean;
  /** An act was carried but nothing the world shows says it took. */
  readonly unverified: boolean;
  /** Waiting on something with no date to look again. */
  readonly waitingWithoutReview: boolean;
  /** No displayed line or passage tells this part at all. */
  readonly missingClause: boolean;
}

export interface OrderScore {
  readonly parts: readonly PartScore[];
  readonly matched: number;
  readonly doneWithoutEvidence: number;
  readonly hiddenSuccesses: number;
  readonly erasedFailures: number;
  readonly unverified: number;
  readonly waitingWithoutReview: number;
  readonly missingClauses: number;
}

const TOLD_DONE: ReadonlySet<OrderPartStatus> = new Set(["achieved"]);
const TOLD_NOT_DONE: ReadonlySet<OrderPartStatus> = new Set(["unanswered", "refused", "failed", "blocked", "pending", "acknowledged", "stalled", "carried_unverified"]);

/** The labels a line can carry, longest first, so "partly done" is never read as "done". */
const LABELS: readonly (readonly [string, OrderPartStatus])[] = [
  ["done, beyond his authority", "achieved"] as const,
  ["waiting until", "awaiting_condition"] as const,
  ["lapsed", "failed"] as const,
  ...(Object.entries(ORDER_PART_STATUS_LABEL) as [OrderPartStatus, string][]).map(([status, label]) => [label, status] as const),
].sort((a, b) => b[0].length - a[0].length);

/**
 * The status a displayed outcome line tells (`"<said>" -- <label>...`), read
 * back from its words, or null when it is not such a line. The scorecard
 * judges what the player was shown, not what a status function says: the
 * line has overridden the status before.
 */
export function toldStatusOfLine(line: string): OrderPartStatus | null {
  const at = line.indexOf("\" -- ");
  if (at < 0) return null;
  const told = line.slice(at + 5);
  return LABELS.find(([label]) => told.startsWith(label))?.[1] ?? null;
}

/** The words a passage uses to say a thing was done, for a one-part order told by its prose alone. */
const PROSE_DONE = /\b(arrived|landed|made landfall|came ashore|crossed over|made the crossing|reached|was completed|were completed|was finished|was carried out|were carried out|was done|was raised|were raised|was levied|was appointed|were appointed|was installed|was paid|were paid|was signed|was concluded|was ratified|was delivered|were delivered|was taken|were taken|was captured|fell to)\b/i;

type Effect = NonNullable<OrderPart["effects"]>[number];

/**
 * The acts the scorecard itself accepts as done by being done, each with how it looks for that in
 * the world. Kept apart from the engine's own list (`DONE_ON_APPLICATION_OPS`) and its readers
 * (`forcesMadeByPart`, `workStatus`) on purpose: a scorecard that used them would agree with any
 * mistake in them. An op the engine counts as done and this table does not know is not evidence
 * here, and a line telling it done is counted as done without evidence -- the disagreement shows.
 */
const SHOWN_BY: Readonly<Record<string, (world: WorldState, effect: Effect, polityId: string) => boolean>> = {
  // Money moved: its own lines are in the books, on the act's day, and add up to the sum it moved.
  money_transfer: (world, effect) => {
    const ids = effect.transactionIds ?? [];
    const lines = world.material.transactions.filter((line) => ids.includes(line.id));
    return ids.length > 0 && lines.length === ids.length && lines.every((line) => line.atStep === effect.atStep)
      && effect.amount !== undefined && effect.amount > 0 && lines.reduce((sum, line) => sum + line.amount, 0) === effect.amount;
  },
  // An army made: it stands, and it is the actor's power's.
  force_create: (world, effect, polityId) => effect.targetId !== undefined && world.material.forces.some((force) => force.id === effect.targetId && force.polityId === polityId),
  force_reinforce: (world, effect, polityId) => effect.refs.some((ref) => ref.kind === "force" && world.material.forces.some((force) => force.id === ref.id && force.polityId === polityId)),
  // A man placed: he holds, now, the post or the place the act gave him, in that army or office.
  force_post_set: (world, effect) => effect.personId !== undefined && effect.role !== undefined
    && world.material.forces.some((force) => force.id === effect.targetId && (force.posts ?? []).some((post) => post.characterId === effect.personId && post.rankId === effect.role)),
  force_membership_set: (world, effect) => effect.personId !== undefined
    && world.material.forces.some((force) => force.id === effect.targetId && force.memberCharacterIds.includes(effect.personId!)),
  office_seat_set: (world, effect) => effect.personId !== undefined
    && world.material.officeSeats.some((seat) => seat.officeId === effect.targetId && seat.status === "held" && seat.holderCharacterId === effect.personId),
};
/** Acts done by being done that leave nothing this table can look up, accepted on the act's own record: by whom, when, for this part. */
const RECORDED_ONLY: ReadonlySet<string> = new Set([
  "income_source_upsert", "obligation_upsert", "holding_create", "holding_improve", "holding_transfer", "trade_venture_open", "trade_venture_close",
  "house_found", "loan_open", "loan_settle", "public_benefaction", "tax_policy_set", "coinage_debase", "family_tie_set", "adopt",
  "service_contract_open", "service_contract_close", "legal_status_set",
]);

/** Whether one applied effect is this part's evidence: its own act, on or after the order's day, by a known hand, and shown. */
function effectShows(world: WorldState, effect: Effect, since: number, polityId: string): boolean {
  if (effect.by === "guess" || effect.atStep < since || effect.actorId === undefined) return false;
  const check = SHOWN_BY[effect.op];
  return check !== undefined ? check(world, effect, polityId) : RECORDED_ONLY.has(effect.op);
}

/**
 * Evidence tied to this part that what it asked for came about, read from raw
 * state by the scorecard's own reading -- never `orderPartStatus`, `lineOf`,
 * or the engine predicates they share:
 *  - where it has goals, the goals hold now and did not when it was given (an
 *    old record with no baseline is read as a change);
 *  - else, with nothing refused and the order's day known: a project its own
 *    act made since the order, finished; an army its own act created since
 *    the order, of the actor's own power, standing; or one applied effect for
 *    every act it carried, each shown (`effectShows`), with any army it names
 *    one it made.
 * A part kept before effects were (an old save's count of acts done) is not
 * evidence: unverified, and nothing is made up for it. Nor is a name, a post,
 * a pre-existing army, or a work found elsewhere in the world.
 */
export function evidenceOfDone(world: WorldState, part: OrderPart, actorId: string, givenAtStep: number | null = orderOfPart(world, part)?.givenAtStep ?? null): boolean {
  if (part.goals.length > 0) return goalsMet(world, part.goals) === "met" && part.metAtOrder !== true;
  if (part.actsRefused > 0 || part.refusal !== null || givenAtStep === null) return false;
  const polityId = world.characters.find((character) => character.id === actorId)?.polityId ?? null;
  if (polityId === null) return false;
  const madeByIt = (ref: OrderPart["workRefs"][number]): boolean => ref.by !== "guess" && ref.madeAtStep !== undefined && ref.madeAtStep >= givenAtStep;
  const armies = new Set([
    ...part.workRefs.filter((ref) => ref.kind === "force" && ref.op === "force_create" && madeByIt(ref)).map((ref) => ref.id),
    ...(part.effects ?? []).filter((effect) => effect.op === "force_create" && effectShows(world, effect, givenAtStep, polityId)).map((effect) => effect.targetId!),
  ].filter((id) => world.material.forces.some((force) => force.id === id && force.polityId === polityId)));
  const finishedWork = part.workRefs.some((ref) => ref.kind === "project" && madeByIt(ref) && world.projects.some((project) => project.id === ref.id && project.status === "completed"));
  const effects = part.effects;
  const appliedActs = effects !== undefined && part.actsCarried > 0
    && effects.length >= part.actsCarried
    && effects.every((effect) => effectShows(world, effect, givenAtStep, polityId))
    && part.workRefs.filter((ref) => ref.kind === "force").every((ref) => armies.has(ref.id));
  return armies.size > 0 || finishedWork || appliedActs;
}

/**
 * One part judged against the line the player was shown for it: the engine's
 * own line when `shown` is omitted, or a line from elsewhere (a Chronicle
 * entry, a fixture's mutation). `null` is a part nobody told.
 */
export function scoreToldPart(world: WorldState, part: OrderPart, actorId: string, shown?: string | null, order: Pick<OrderRecord, "givenAtStep"> | undefined = orderOfPart(world, part)): PartScore {
  const line = shown === undefined ? lineOf(world, part, actorId, undefined, order) : shown;
  const status = line === null ? null : toldStatusOfLine(line);
  const evidence = evidenceOfDone(world, part, actorId, order?.givenAtStep ?? null);
  const failedStage = part.stages.some((stage) => stage.status === "failed");
  const refusedOnRecord = part.refusal !== null || part.actsRefused > 0 || failedStage;
  const toldDone = status !== null && TOLD_DONE.has(status);
  return {
    said: part.said,
    status,
    reckoned: orderPartStatus(world, part),
    line,
    doneWithoutEvidence: toldDone && !evidence,
    hiddenSuccess: evidence && !refusedOnRecord && status !== null && TOLD_NOT_DONE.has(status),
    erasedFailure: refusedOnRecord && toldDone,
    unverified: status === "carried_unverified",
    waitingWithoutReview: part.closedAtStep === null && part.stages.some((stage) => stage.status === "waiting" && (stage as { reviewAtStep?: number | null }).reviewAtStep == null),
    missingClause: line === null,
  };
}

/**
 * Every part of an order judged against what was actually displayed for it:
 * the outcome lines (`orderOutcomeLines`, or the lines under a Chronicle
 * entry) and, for a one-part order shown no line, the prose of the passages
 * handed in. A part with no line and no passage that says it was done is a
 * missing clause: nothing is assumed to have been narrated. A one-part order
 * whose prose says the thing was done is judged as told done, and so held to
 * the evidence like any line.
 */
export function scoreDisplayedOrder(world: WorldState, orderId: string, displayed: readonly string[], prose: readonly string[] = []): OrderScore {
  const order = world.orders.find((candidate) => candidate.id === orderId);
  if (order === undefined) return tally([]);
  return tally(order.parts.map((part) => {
    const line = displayed.find((candidate) => candidate.includes(`"${part.said}" -- `)) ?? null;
    const toldByProse = line === null && order.parts.length === 1 && prose.some((passage) => assertsWords(passage, PROSE_DONE));
    return scoreToldPart(world, part, order.actorCharacterId, toldByProse ? `"${part.said}" -- done` : line, order);
  }));
}

function tally(parts: readonly PartScore[]): OrderScore {
  const count = (pick: (part: PartScore) => boolean): number => parts.filter(pick).length;
  const wrong = count((part) => part.doneWithoutEvidence || part.hiddenSuccess || part.erasedFailure || part.missingClause);
  return {
    parts,
    matched: parts.length - wrong,
    doneWithoutEvidence: count((part) => part.doneWithoutEvidence),
    hiddenSuccesses: count((part) => part.hiddenSuccess),
    erasedFailures: count((part) => part.erasedFailure),
    unverified: count((part) => part.unverified),
    waitingWithoutReview: count((part) => part.waitingWithoutReview),
    missingClauses: count((part) => part.missingClause),
  };
}

export function scoreOrders(world: WorldState, orderIds?: readonly string[]): OrderScore {
  return tally(world.orders
    .filter((order) => orderIds === undefined || orderIds.includes(order.id))
    .flatMap((order) => order.parts.map((part) => scoreToldPart(world, part, order.actorCharacterId, undefined, order))));
}

export { CLERK_PHRASES } from "./chronicle-lint";

/** A last sentence that sums up or forecasts, which the register forbids. */
const MORAL_OR_FORECAST = /\b(?:would (?:soon|later|in time|come to)|was to (?:prove|become|remain)|remained to be seen|time would tell|the future|would not be the last|a lesson|taught (?:him|them|rome|carthage) that|what (?:was|would be) to come)\b/i;

export interface ProseScore {
  readonly entries: number;
  readonly words: number;
  readonly clerkPhrases: number;
  readonly clerkWordsPer1000: number;
  readonly endingsWithMoralOrForecast: number;
  readonly entriesWithQuote: number;
}

/** Outcome lines are the engine's own words, set under a passage; prose metrics skip them. */
function proseOf(entry: ChronicleEntry): string {
  const cut = entry.body.indexOf("What came of the order:");
  return (cut < 0 ? entry.body : entry.body.slice(0, cut)).trim();
}

export function scoreProse(entries: readonly ChronicleEntry[]): ProseScore {
  const bodies = entries.filter((entry) => entry.kind === "narrated").map(proseOf);
  const words = bodies.reduce((total, body) => total + (body.match(/\S+/g)?.length ?? 0), 0);
  const clerkPhrases = bodies.reduce((total, body) => total + CLERK_PHRASES.reduce((sum, pattern) => sum + (body.match(pattern)?.length ?? 0), 0), 0);
  const lastSentence = (body: string): string => body.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "").at(-1) ?? "";
  return {
    entries: bodies.length,
    words,
    clerkPhrases,
    clerkWordsPer1000: words === 0 ? 0 : Math.round((clerkPhrases / words) * 1000 * 10) / 10,
    endingsWithMoralOrForecast: bodies.filter((body) => MORAL_OR_FORECAST.test(lastSentence(body))).length,
    entriesWithQuote: entries.filter((entry) => entry.kind === "narrated" && entry.quote !== null).length,
  };
}

/** Request counts by operation, from a scripted or live port, for the S2 columns. */
export function countRequests(asked: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const operation of asked) counts[operation] = (counts[operation] ?? 0) + 1;
  return counts;
}

export interface Scorecard {
  readonly label: string;
  readonly orders: OrderScore;
  readonly prose: ProseScore;
  readonly requests: Readonly<Record<string, number>>;
  readonly totalRequests: number;
  readonly wallSeconds: number;
  readonly stopReason: string;
}

/** The scorecard as the markdown row the baseline file keeps. */
export function scorecardRow(card: Scorecard): string {
  const o = card.orders;
  return `| ${card.label} | ${o.parts.length} | ${o.matched} | ${o.doneWithoutEvidence} | ${o.hiddenSuccesses} | ${o.erasedFailures} | ${o.unverified} | ${o.waitingWithoutReview} | ${card.prose.clerkWordsPer1000} | ${card.prose.endingsWithMoralOrForecast} | ${card.prose.entriesWithQuote}/${card.prose.entries} | ${card.totalRequests} | ${card.wallSeconds.toFixed(1)} | ${card.stopReason} |`;
}

export const SCORECARD_HEADER = [
  "| run | order parts | told = state | done, no evidence | hidden successes | erased failures | unverified | waiting, no review | clerk words /1000 | moral/forecast endings | entries with quote | requests | wall s | stop |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
].join("\n");
