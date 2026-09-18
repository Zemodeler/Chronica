import { z } from "zod";
import {
  factsKnownTo,
  formatWorldDate,
  type Fact,
  type OrderPartyRef,
  type ScenarioClock,
  type WorldInstant,
} from "@chronica/shared";
import { extractJson } from "./json";
import type { SimModelPort } from "./ports";

/**
 * The Chronicle (VISION §25).
 *
 * A historical reconstruction of what happened since the last checkpoint --
 * and, crucially, only of what the player's government could actually have
 * learned. The engine knows the senator is plotting; the Chronicle must not say
 * so until someone discovers it.
 *
 * That constraint is enforced here rather than asked for in the prompt. The
 * model is only ever handed facts that passed `factsVisibleTo`, so it cannot
 * leak what it was never shown -- a prompt instruction not to mention secrets
 * would eventually be disobeyed, and nobody would notice.
 *
 * The same gate now covers the actors' own accounts. Facts were filtered from
 * the start; the narrative lines beside them were not, and every NPC's account
 * of its own reasoning went straight into the player's record. A Roman consul
 * read that a Carthaginian admiral "quietly investigated whether the Roman
 * campaign created an opening" -- true, secret, and none of his business. An
 * account now travels with the facts it describes and is shown only if one of
 * them is.
 *
 * ## Threads
 *
 * A burst covers a span, not a subject. Fusing everything that happened in that
 * span into one passage produced entries where a Roman march on the Boii and a
 * Carthaginian deliberation about Messana shared a paragraph break and nothing
 * else. So the visible facts are split into threads -- one per matter, by who
 * and what they touch -- and each thread becomes its own entry with its own
 * title. The split is deterministic and made here in code; the model is only
 * asked for the prose.
 */

/** How many entries one burst may produce before the remainder is grouped. */
const MAX_ENTRIES = 4;

/** Ids are for the engine. A summary carrying one must not reach the prose. */
const ID_IN_BRACKETS = /\s*\[[A-Za-z0-9][A-Za-z0-9._:-]*\]/g;

export const CHRONICLE_SYSTEM_PROMPT = `You are a historian writing the record of a reign, from surviving documents.

You will be given a date range and one or more numbered THREADS. A thread is a
single matter -- one war, one embassy, one quarrel -- and each gets its own short
passage of one or two paragraphs, under its own title.

A title names the matter in a few words, as a chapter heading would: "The March
into Boii Country", "Carthage Watches the Strait", "The Grain Levy Refused". It is
never a date, never a summary of the whole period, and never a sentence.

Keep the threads apart. A passage may name only what appears in its own thread: if
Carthage is not in thread 2, thread 2 does not mention Carthage.

Write only from what you are given. You have no other sources: if something is not
listed, it is not known to have happened, and you must not imply it, foreshadow it,
or hint that anything is being concealed. Absence of evidence is not something the
passage should gesture at.

Record what happened. Never write that something did not happen, that someone took
no action, that a thing could not yet happen, or that something was merely
scheduled, planned or prepared for -- those are not events, and a chronicle of them
reads like a clerk's ledger.

Write as a historian, not as a machine. Never use the vocabulary of administration:
no "project", "milestone", "status", "state", "recognized", "possessed",
"authorized strength", "field force", "consequential action", "supply position".
Name the people, the places and the deeds instead.

Do not address the reader, do not use headings or lists, and do not offer advice on
what should be done next. You are recording what happened, not advising a ruler.

Answer with JSON and nothing else:
{"entries":[{"thread":1,"title":"...","body":"..."}]}`;

const ChronicleOutputSchema = z
  .object({
    entries: z
      .array(
        z.object({
          thread: z.number().int().positive(),
          title: z.string().trim().min(1).max(120),
          body: z.string().trim().min(1),
        }),
      )
      .max(MAX_ENTRIES),
  })
  .strict();

/**
 * One actor's account of what they were doing, tied to the facts it describes.
 *
 * The facts are what makes it publishable: an account whose facts the observer
 * cannot see is an account of something they never learned about.
 */
export interface NarrativeLine {
  /** Null when nobody said it: the world's own record of what it did. */
  readonly actorRef: OrderPartyRef | null;
  readonly line: string;
  readonly factIds: readonly string[];
}

export interface ChronicleInput {
  readonly port: SimModelPort;
  readonly clock: ScenarioClock;
  readonly observer: OrderPartyRef;
  /** Their polity, so what their own government did counts as known to them. */
  readonly observerPolityId: string | null;
  readonly facts: readonly Fact[];
  readonly from: WorldInstant;
  readonly to: WorldInstant;
  /** What the actors said they were doing, for colour the bare facts lack. */
  readonly narrative: readonly NarrativeLine[];
  readonly frictions: readonly NarrativeLine[];
  /** Fact id → its author's weight, for ordering threads by what mattered most. */
  readonly significanceByFactId?: ReadonlyMap<string, number>;
}

export interface ChronicleEntry {
  readonly title: string;
  readonly body: string;
  /** Exactly the facts this entry was allowed to draw on. */
  readonly factIds: readonly string[];
  /** Who and what the entry is about, so the record can be read by subject. */
  readonly subjects: readonly OrderPartyRef[];
  readonly fromInstantSortKey: number;
  readonly toInstantSortKey: number;
}

export interface ChronicleResult {
  readonly entries: readonly ChronicleEntry[];
  readonly calls: number;
}

interface Thread {
  readonly facts: readonly Fact[];
  readonly narrative: readonly string[];
  readonly frictions: readonly string[];
}

const keyOf = (ref: OrderPartyRef): string => `${ref.kind}:${ref.id}`;
const sortKeyOf = (instant: WorldInstant): number => instant.day * 1440 + instant.minute;

/** Strips the engine's own handles out of a line written for a person to read. */
function readable(line: string): string {
  return line.replace(ID_IN_BRACKETS, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Splits facts into threads: a matter is everything that hangs together by who
 * and what it touches, and the observer's own thread is the matter they are in.
 *
 * Connected, not merely shared. Grouping only facts that name the observer put
 * the Boii's defence of their own strongholds in a different entry from the
 * Roman assault on them -- one war, told twice, because the Boii facts named the
 * Boii and the Roman facts named Rome. Following the links instead keeps a war
 * whole while leaving a Carthaginian deliberation nobody else is part of exactly
 * where it belongs: on its own.
 */
function splitIntoThreads(
  facts: readonly Fact[],
  observer: OrderPartyRef,
  observerPolityId: string | null,
): Fact[][] {
  const ownKeys = new Set([keyOf(observer), ...(observerPolityId === null ? [] : [`polity:${observerPolityId}`])]);

  const parent = new Map<number, number>();
  const find = (index: number): number => {
    let root = index;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: number, b: number): void => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  facts.forEach((_, index) => parent.set(index, index));
  const firstSeenBySubject = new Map<string, number>();
  const ownIndices: number[] = [];
  facts.forEach((fact, index) => {
    // A fact naming nobody is nobody else's: it came out of answering this
    // ruler's order. Left to find its own thread it shares a subject with
    // nothing, and one pursuit fragmented into an entry per sentence.
    if (fact.affectedEntities.length === 0) ownIndices.push(index);
    for (const entity of fact.affectedEntities) {
      const subject = keyOf(entity);
      if (ownKeys.has(subject)) ownIndices.push(index);
      const seen = firstSeenBySubject.get(subject);
      if (seen === undefined) firstSeenBySubject.set(subject, index);
      else union(seen, index);
    }
  });
  // Everything the observer is named in is one matter, however many ways it
  // reaches them: a ruler does not read two chapters about one war.
  for (const index of ownIndices) union(ownIndices[0]!, index);

  const components = new Map<number, Fact[]>();
  facts.forEach((fact, index) => {
    const root = find(index);
    const bucket = components.get(root);
    if (bucket === undefined) components.set(root, [fact]);
    else bucket.push(fact);
  });

  const ownRoot = ownIndices.length === 0 ? undefined : find(ownIndices[0]!);
  const own = ownRoot === undefined ? [] : [components.get(ownRoot)!];
  return [...own, ...[...components.entries()].filter(([root]) => root !== ownRoot).map(([, bucket]) => bucket)];
}

/** Everything the entry is about, deterministically ordered. */
function subjectsOf(facts: readonly Fact[]): OrderPartyRef[] {
  const seen = new Map<string, OrderPartyRef>();
  for (const fact of facts) for (const entity of fact.affectedEntities) seen.set(keyOf(entity), entity);
  return [...seen.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .slice(0, 8);
}

function renderThread(thread: Thread, index: number): string {
  const lines = [`THREAD ${index + 1}`, "Known to have happened:", ...thread.facts.map((fact) => `- ${readable(fact.summary)}`)];
  if (thread.narrative.length > 0) lines.push("Accounts given at the time:", ...thread.narrative.map((line) => `- ${readable(line)}`));
  if (thread.frictions.length > 0) lines.push("Difficulties reported:", ...thread.frictions.map((line) => `- ${readable(line)}`));
  return lines.join("\n");
}

export async function composeChronicle(input: ChronicleInput): Promise<ChronicleResult> {
  const visible = factsKnownTo(input.facts, input.observer, input.observerPolityId, input.to);
  if (visible.length === 0) return { entries: [], calls: 0 };

  const visibleFactIds = new Set(visible.map((fact) => fact.id));
  const observerKey = keyOf(input.observer);
  /** An account is publishable when the observer can see what it is an account of. */
  const publishable = (line: NarrativeLine): boolean =>
    line.factIds.some((factId) => visibleFactIds.has(factId)) || (line.actorRef !== null && keyOf(line.actorRef) === observerKey);
  const narrative = input.narrative.filter(publishable);
  const frictions = input.frictions.filter(publishable);

  const weightOf = (fact: Fact): number => input.significanceByFactId?.get(fact.id) ?? 1;
  const grouped = splitIntoThreads(visible, input.observer, input.observerPolityId);
  // The observer's own thread stays first; the rest are ranked by what actually
  // mattered, so the entry that gets dropped into the grouped tail is the least
  // important one rather than whichever the map happened to yield last.
  const [own, ...others] = grouped;
  const ownThreads = own === undefined ? [] : [own];
  others.sort((a, b) => {
    const weight = b.reduce((sum, fact) => sum + weightOf(fact), 0) - a.reduce((sum, fact) => sum + weightOf(fact), 0);
    return weight !== 0 ? weight : sortKeyOf(a[0]!.time) - sortKeyOf(b[0]!.time) || a[0]!.id.localeCompare(b[0]!.id);
  });
  const ranked = [...ownThreads, ...others];
  // Everything past the cap becomes one last entry rather than vanishing: the
  // record is allowed to be brief about minor matters, not silent.
  const kept = ranked.length <= MAX_ENTRIES ? ranked : [...ranked.slice(0, MAX_ENTRIES - 1), ranked.slice(MAX_ENTRIES - 1).flat()];

  const threads: Thread[] = kept.map((facts) => {
    const ids = new Set(facts.map((fact) => fact.id));
    const belongs = (line: NarrativeLine): boolean => line.factIds.some((factId) => ids.has(factId));
    return {
      facts,
      narrative: narrative.filter(belongs).map((line) => line.line),
      frictions: frictions.filter(belongs).map((line) => line.line),
    };
  });

  const period = `${formatWorldDate(input.from, input.clock)} – ${formatWorldDate(input.to, input.clock)}`;
  const userMessage = [`Period: ${period}.`, "", ...threads.map((thread, index) => renderThread(thread, index))].join("\n\n");

  const entryOf = (thread: Thread, title: string, body: string): ChronicleEntry => {
    const keys = thread.facts.map((fact) => sortKeyOf(fact.time));
    return {
      title,
      body,
      factIds: thread.facts.map((fact) => fact.id),
      subjects: subjectsOf(thread.facts),
      fromInstantSortKey: Math.min(...keys, sortKeyOf(input.to)),
      toInstantSortKey: Math.max(...keys, sortKeyOf(input.from)),
    };
  };

  // A failed narration must not cost the player the record itself: fall back to
  // the plain facts, under the period as a title, rather than losing the span.
  const fallback = (): ChronicleResult => ({
    entries: threads.map((thread) => entryOf(thread, period, thread.facts.map((fact) => readable(fact.summary)).join("\n\n"))),
    calls: 1,
  });

  try {
    const raw = await input.port.complete("compose_chronicle", CHRONICLE_SYSTEM_PROMPT, userMessage);
    const parsed = ChronicleOutputSchema.safeParse(extractJson(raw));
    if (!parsed.success) return fallback();

    const entries = threads.flatMap((thread, index) => {
      const written = parsed.data.entries.find((entry) => entry.thread === index + 1);
      return written === undefined ? [] : [entryOf(thread, written.title, written.body.trim())];
    });
    return entries.length === 0 ? fallback() : { entries, calls: 1 };
  } catch {
    return fallback();
  }
}
