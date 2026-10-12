import { ORDER_PART_STATUS_LABEL, goalsMet, orderPartStatus, workStatus, type OrderPart, type OrderPartStatus, type WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";
import { CLERK_PHRASES } from "./chronicle-lint";
import { lineOf } from "./order-outcomes";

/**
 * The scorecard of plan `chronicle-and-order-truth` (phase 0): what a run told
 * the player about its orders against what the world shows, and how the
 * Chronicle read.
 *
 * Order metrics judge the line the player was shown, read back from its
 * words, against evidence read from raw state -- goals against their
 * baseline, the part's own work, acts carried and refused, failed stages --
 * never against `orderPartStatus` or `lineOf`, so a line that lies cannot
 * also be what passes it. Prose metrics are counts over the entries as
 * written. Nothing here calls a model.
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
  /** No displayed line tells this part at all. */
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

/**
 * Evidence tied to this part that what it asked for came about, read from raw
 * state and never from `orderPartStatus` or `lineOf`:
 *  - where it has goals, the goals hold now and did not when it was given (an
 *    old record with no baseline is read as a change);
 *  - else, with nothing refused, its own work finished, or an army it made of
 *    the actor's own power, or every act it wrote is its own evidence (a purse
 *    debited, a holding made).
 * A name, a post or a work found elsewhere in the world is not evidence.
 */
export function evidenceOfDone(world: WorldState, part: OrderPart, actorId: string): boolean {
  if (part.goals.length > 0) return goalsMet(world, part.goals) === "met" && part.metAtOrder !== true;
  if (part.actsRefused > 0 || part.refusal !== null) return false;
  const polityId = world.characters.find((character) => character.id === actorId)?.polityId ?? null;
  const ownForce = (id: string): boolean => world.material.forces.some((force) => force.id === id && force.polityId === polityId);
  const forces = part.workRefs.filter((ref) => ref.kind === "force");
  const finishedWork = part.workRefs.some((ref) => ref.kind !== "force" && ref.kind !== "entity" && workStatus(world, ref) === "achieved");
  const appliedActs = part.actsCarried > 0 && (part.actsDone ?? 0) >= part.actsCarried && forces.every((ref) => ownForce(ref.id));
  return forces.some((ref) => ownForce(ref.id)) || finishedWork || appliedActs;
}

/**
 * One part judged against the line the player was shown for it: the engine's
 * own line when `shown` is omitted, or a line from elsewhere (a Chronicle
 * entry, a fixture's mutation). `null` is a part nobody told.
 */
export function scoreToldPart(world: WorldState, part: OrderPart, actorId: string, shown?: string | null): PartScore {
  const line = shown === undefined ? lineOf(world, part, actorId) : shown;
  const status = line === null ? null : toldStatusOfLine(line);
  const evidence = evidenceOfDone(world, part, actorId);
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
 * Every part of an order judged against the outcome lines displayed for it
 * (`orderOutcomeLines`, or the lines under a Chronicle entry). A part with no
 * line is a missing clause -- except a one-part order shown no lines at all,
 * which `orderOutcomeLines` leaves to its passage when done, and which is then
 * judged as told done.
 */
export function scoreDisplayedOrder(world: WorldState, orderId: string, displayed: readonly string[]): OrderScore {
  const order = world.orders.find((candidate) => candidate.id === orderId);
  if (order === undefined) return tally([]);
  return tally(order.parts.map((part) => {
    const line = displayed.find((candidate) => candidate.includes(`"${part.said}" -- `)) ?? null;
    const toldByPassage = line === null && displayed.length === 0 && order.parts.length === 1;
    return scoreToldPart(world, part, order.actorCharacterId, toldByPassage ? `"${part.said}" -- done` : line);
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
    .flatMap((order) => order.parts.map((part) => scoreToldPart(world, part, order.actorCharacterId))));
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
