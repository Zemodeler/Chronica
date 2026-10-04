import { goalsMet, orderPartStatus, type OrderPart, type OrderPartStatus, type WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";
import { CLERK_PHRASES } from "./chronicle-lint";
import { lineOf } from "./order-outcomes";

/**
 * The scorecard of plan `chronicle-and-order-truth` (phase 0): what a run told
 * the player about its orders against what the world shows, and how the
 * Chronicle read.
 *
 * Order metrics are read from raw state -- goals against the world, acts
 * carried and refused, failed stages -- never from a status function alone,
 * so a status that lies cannot also be what passes it. Prose metrics are
 * counts over the entries as written. Nothing here calls a model.
 */

export interface PartScore {
  readonly said: string;
  readonly status: OrderPartStatus;
  readonly line: string;
  /** Told "done" with nothing in the world named to check it against. */
  readonly doneWithoutEvidence: boolean;
  /** The world shows it worked (goals met, or acts carried with no refusal) and it is not told as so. */
  readonly hiddenSuccess: boolean;
  /** A refusal or failed act is on the record and the part is told as done. */
  readonly erasedFailure: boolean;
  /** An act was carried but nothing the world shows says it took. */
  readonly unverified: boolean;
  /** Waiting on something with no date to look again. */
  readonly waitingWithoutReview: boolean;
}

export interface OrderScore {
  readonly parts: readonly PartScore[];
  readonly matched: number;
  readonly doneWithoutEvidence: number;
  readonly hiddenSuccesses: number;
  readonly erasedFailures: number;
  readonly unverified: number;
  readonly waitingWithoutReview: number;
}

const TOLD_DONE: ReadonlySet<OrderPartStatus> = new Set(["achieved"]);
const TOLD_NOT_DONE: ReadonlySet<OrderPartStatus> = new Set(["unanswered", "refused", "failed", "blocked", "pending", "acknowledged"]);

function scorePart(world: WorldState, part: OrderPart, actorId: string): PartScore {
  const status = orderPartStatus(world, part);
  const goalsAreMet = part.goals.length > 0 && goalsMet(world, part.goals) === "met";
  const hasEvidence = part.goals.length > 0 || part.workRefs.length > 0;
  const failedStage = part.stages.some((stage) => stage.status === "failed");
  const refusedOnRecord = part.refusal !== null || part.actsRefused > 0 || failedStage;
  return {
    said: part.said,
    status,
    line: lineOf(world, part, actorId),
    doneWithoutEvidence: TOLD_DONE.has(status) && !hasEvidence,
    hiddenSuccess: TOLD_NOT_DONE.has(status) && (goalsAreMet || (part.actsCarried > 0 && !refusedOnRecord && part.workRefs.length > 0 && !part.workRefs.some((ref) => ref.kind === "order_attempt"))),
    erasedFailure: refusedOnRecord && TOLD_DONE.has(status),
    unverified: status === "carried_unverified",
    waitingWithoutReview: part.closedAtStep === null && part.stages.some((stage) => stage.status === "waiting" && (stage as { reviewAtStep?: number | null }).reviewAtStep == null),
  };
}

export function scoreOrders(world: WorldState, orderIds?: readonly string[]): OrderScore {
  const parts = world.orders
    .filter((order) => orderIds === undefined || orderIds.includes(order.id))
    .flatMap((order) => order.parts.map((part) => scorePart(world, part, order.actorCharacterId)));
  const count = (pick: (part: PartScore) => boolean): number => parts.filter(pick).length;
  const wrong = count((part) => part.doneWithoutEvidence || part.hiddenSuccess || part.erasedFailure);
  return {
    parts,
    matched: parts.length - wrong,
    doneWithoutEvidence: count((part) => part.doneWithoutEvidence),
    hiddenSuccesses: count((part) => part.hiddenSuccess),
    erasedFailures: count((part) => part.erasedFailure),
    unverified: count((part) => part.unverified),
    waitingWithoutReview: count((part) => part.waitingWithoutReview),
  };
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
