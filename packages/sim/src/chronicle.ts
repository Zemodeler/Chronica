import { z } from "zod";
import {
  factsKnownTo,
  formatWorldDate,
  type Fact,
  type OrderPartyRef,
  type ScenarioClock,
  type WorldChange,
  type WorldInstant,
  type WorldStoryline,
} from "@chronica/shared";
import { extractJson } from "./json";
import type { SimModelPort } from "./ports";

/**
 * The Chronicle (VISION §25).
 *
 * A historical reconstruction of what happened since the last checkpoint --
 * and, mostly, only of what the player's government could actually have
 * learned. The engine knows the senator is plotting; the Chronicle must not say
 * so until someone discovers it.
 *
 * That constraint is enforced here rather than asked for in the prompt. The
 * model is only ever handed facts that passed the gate below, so it cannot leak
 * what it was never shown -- a prompt instruction not to mention secrets would
 * eventually be disobeyed, and nobody would notice.
 *
 * The same gate covers the actors' own accounts. Facts were filtered from the
 * start; the narrative lines beside them were not, and every NPC's account of
 * its own reasoning went straight into the player's record. A Roman consul read
 * that a Carthaginian admiral "quietly investigated whether the Roman campaign
 * created an opening" -- true, secret, and none of his business. An account now
 * travels with the facts it describes and is shown only if one of them is.
 *
 * ## Three tiers, not two
 *
 * Strict visibility alone produced a record that was correct and parochial. A
 * ruler read about his own frontier and nothing else, because the only way for
 * Syracuse to reach him was for somebody to carry it there, and nobody ever
 * did. A world that is alive is a world where things happen elsewhere and you
 * hear about them.
 *
 * So the test is no longer *who knows this* but *could the reader act on it*:
 *
 * - Facts the observer has actually discovered are theirs, as before.
 * - A secret that touches them or their government stays dark. That is the
 *   whole point of the epistemic layer: a plot against the ruler is not
 *   colour.
 * - A weighty secret that touches neither -- an assassination in Syracuse, a
 *   plague in somebody else's province -- publishes as *news reaching the
 *   court*, second-hand and marked as such, because knowing it changes
 *   nothing they can do and not knowing it makes the world feel empty.
 *
 * ## Threads
 *
 * A burst covers a span, not a subject. Fusing everything that happened in that
 * span into one passage produced entries where a Roman march on the Boii and a
 * Carthaginian deliberation about Messana shared a paragraph break and nothing
 * else. So the facts are split into threads -- one per matter, by who and what
 * they touch -- and each thread becomes its own entry with its own headline.
 * The split is deterministic and made here in code; the model is only asked for
 * the prose.
 *
 * ## The bar
 *
 * A thread earns an entry by weight, not by having occurred. Everything that
 * happened is still on the record as facts; the Chronicle is the part of it
 * worth reading, and a chronicle that reports the collection of a routine tax
 * teaches the player to stop reading it. The observer's own matter is the one
 * exception -- an order must always be answered, however small its outcome.
 */

/**
 * How many entries one report may carry.
 *
 * A reign that had a busy month should read like one. Six was chosen when a
 * single entry swallowed the reader's whole side of the world; now that each
 * matter stands on its own, six is a ceiling an ordinary month hits.
 */
const MAX_ENTRIES = 10;

/**
 * What a thread must weigh before it is written up at all.
 *
 * Deliberately high. Significance is the acting party's own judgment of what it
 * just did, on a hundred-point scale, and the things worth a chronicler's ink
 * -- a city taken, a commander killed, an alliance struck -- score well above
 * this. Recruitment proceeding on schedule does not.
 */
export const DEFAULT_ENTRY_THRESHOLD = 45;

/** And what a *foreign secret* must weigh before word of it travels at all. */
const DISTANT_NEWS_THRESHOLD = 40;

/** How many threads of distant news one report may carry. The court is not a newspaper. */
const MAX_REPORTED_THREADS = 3;

/** How many subjects an entry shows on its face. The rest stay on the record, unshown. */
const MAX_TAGS = 3;

/**
 * Bookkeeping the historian must never see, whoever it happened to.
 *
 * A breach is the engine's own note that somebody acted without the authority
 * to: its summary is a sentence about grants and account ids, written for an
 * audit rather than a reader. While every Roman matter was one entry it sank
 * without trace; the moment matters were told separately it surfaced as an
 * entry of its own, headlined "Fiscal Record Grants No Spending Power to the
 * Declared Character". Insubordination belongs in the record -- as something a
 * person did, written by whoever noticed, not as the ledger line that caught it.
 */
const NEVER_PUBLISHED = new Set(["engine_rejection", "authority_breach"]);

/** Ids are for the engine. A summary carrying one must not reach the prose. */
const ID_IN_BRACKETS = /\s*\[[A-Za-z0-9][A-Za-z0-9._:-]*\]/g;

export const CHRONICLE_SYSTEM_PROMPT = `You are a historian writing the record of a reign, from surviving documents.

You will be given a date range and one or more numbered THREADS. A thread is a
single matter -- one war, one embassy, one quarrel -- and each gets its own
passage under its own headline.

THE HEADLINE

A headline says who did what, the way a chronicler's index entry does: "Legate
Refuses Antuvi Leave to Cross into Samnium", "Etruscan Envoys Sue for Peace
After Sutrium", "Agathocles of Syracuse Assassinated". Name a person or a body,
and name the deed. Capitalise it as a title. It is never a date, never a summary
of the whole period, and never a bare noun phrase like "The March North".

THE PASSAGE

Past tense, third person. A thread holding more than one thing that happened
runs to at least a hundred and eighty words, and may run to three hundred and
twenty. A thread holding a single small fact may be shorter, but rarely under
eighty.

The way to fill that room is more of what happened, and never more ways of
saying it. Who was there, what it cost, how long it took, what they argued,
what they carried, what they found when they arrived, who was left behind, what
was said when it was done. You have been given the facts of the matter and the
accounts people gave of it -- work through them rather than summarising them.
An event told in one sentence and then explained in three has been told once and
padded twice.

Three things are padding, and all three are worse than being brief. Do not
restate a paragraph you have already written. Do not reach into another thread
for more to say. And never write about the record itself -- not "was recorded
as", not "the matter stood in the review as", not "was thus recorded not as a
delay but as a destruction", not "his name was attached to the offer". The
record is what you are writing; a chronicler who describes his own filing has
stopped writing history.

Name people in full at first mention, with rank or office -- "Military Tribune
Gaius Julius Antuvi", not "the tribune". Afterwards one name will do.

Use the numbers you are given, exactly as given: seven thousand men, three
riders lost, fifty galleys. Never invent a number you were not given.

Where a thread gives you several people, give each of them their moment: what
they did, and why they thought it would work. A passage that names three men and
follows only one has wasted the other two.

Put what people argued into indirect speech -- "Antuvi argued that the two
garrisons together could force a battle; the legate answered that stripping both
would leave the frontier open" -- rather than inventing dialogue for them.

ONE MATTER TO A PASSAGE

A thread is one matter, and a passage tells that one. A rising in Campania is not
part of an embassy to Syracuse however heavily it weighs on the men who sent it:
if it is not in this thread, it does not appear here. Some other passage has it,
or the record will come to it later.

The exception is a thread marked as part of a longer matter. That matter may be
named, because the record has already told it.

This binds hardest at the end of a passage. Do not close by reaching for another
thread -- "Syracuse had still not answered", "the rising continued to threaten",
"the crisis might lessen sympathy". Those matters have their own passages, and
what they are doing is not this one's business.

SAY IT ONCE

Every sentence carries something the ones before it did not.

Do not end with a sentence that restates the passage. Do not tell the reader
where the matter now stands, what it means, what it threatens, or what it makes
more urgent. Do not sum up, and do not count up ("the two decisions", "both
measures"). A passage stops when the last thing that happened has been written
down, and not one sentence later.

Never write about what is missing. Not that a battle was not reported, that an
answer had not come, that a thing was still awaited, that something remained
unresolved, or that the account says nothing of some other matter. Silence in a
thread is not news in it.

Never write what might happen next. No "could", "might", "was expected to",
"would soon", "leaving him to", "while the authorities could". You are writing
what happened, and what happened next will be written when it has.

WHAT COUNTS AS AN EVENT

A person choosing something is an event, even when nothing moved. A legate
refusing a request, a council failing to agree, a fleet putting to sea for a
shore it has not yet reached -- these happened, and they belong in the record.

An absence is not an event. Never write that nothing of note occurred, that
someone took no action, that a thing could not yet happen, or that a sum was
unchanged. Where a thread holds only such non-events, write about the decision
inside it instead.

WHAT YOU MAY DRAW ON

Write only from what you are given. You have no other sources: if something is
not listed, it is not known to have happened, and you must not imply it,
foreshadow it, or hint that anything is being concealed. Absence of evidence is
not something the passage should gesture at.

A thread marked as news reaching the court is second-hand. Write it as the court
learned it -- "word came from Syracuse that", "merchants out of Massalia
reported" -- and do not give it the certainty of something witnessed.

Keep the threads apart. A passage may name only what appears in its own thread:
if Carthage is not in thread 2, thread 2 does not mention Carthage.

VOICE

Write as a chronicler, not as a clerk. Reach for the concrete: the pass they
crossed, the season they crossed it in, what the men carried, what it cost, what
was said when it was done. One hard detail is worth three sentences about
consequence.

Never use the vocabulary of administration. Not "project", "milestone",
"status", "state", "recognized", "possessed", "authorized strength", "field
force", "consequential action", "supply position", "the two decisions", "adding
weight to", "the precise manner", "still required arrangement", "sought to
govern". Name the people, the places and the deeds instead.

Do not address the reader, do not use headings or lists, and do not offer advice
on what should be done next. You are recording what happened, not advising a
ruler.

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

/** Something a person said, gated by the same rule and printed beside the prose. */
export interface UtteranceLine {
  readonly actorRef: OrderPartyRef;
  /** Their name as the record should print it. */
  readonly speaker: string;
  readonly line: string;
  readonly occasion: string;
  readonly factIds: readonly string[];
}

export interface EntryQuote {
  readonly line: string;
  readonly speaker: string;
  readonly occasion: string;
}

/** A subject printed on the entry's face, carrying the name a reader knows it by. */
export interface EntryTag {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
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
  /** What people actually said. At most one reaches the record. */
  readonly utterances?: readonly UtteranceLine[];
  /** Fact id → its author's weight, for ordering threads and for the bar. */
  readonly significanceByFactId?: ReadonlyMap<string, number>;
  /** The threads the world is following, so a passage that continues one can say so. */
  readonly storylines?: readonly WorldStoryline[];
  /** Whose government a character belongs to, for deciding whether a polity-scoped thread is the observer's to know. */
  readonly polityOfCharacter?: (characterId: string) => string | null;
  /** What a subject is called, for the tags a reader sees. Unnamed subjects fall back to their id. */
  readonly nameOf?: (ref: OrderPartyRef) => string | null;
  /**
   * Everything the observer's own side answers for: their polity, its people,
   * its provinces, themselves. A secret touching any of it stays dark; a secret
   * touching none of it may travel as distant news.
   *
   * Left out, no distant news travels at all. The engine cannot tell near from
   * far without being told where the observer's reach ends, and a wrong guess
   * here publishes a plot against the reader as local colour -- so the absence
   * of the answer is treated as the strict answer rather than as licence.
   */
  readonly ownEntityIds?: ReadonlySet<string>;
  /** What moved on the map while this was happening, for the change list. */
  readonly changes?: readonly WorldChange[];
  /** What a thread must weigh to be written up. */
  readonly entryThreshold?: number;
}

export interface ChronicleEntry {
  /** "narrated" is written by a historian; "recorded" is struck from the books. */
  readonly kind: "narrated" | "recorded";
  readonly title: string;
  readonly body: string;
  /** Exactly the facts this entry was allowed to draw on. */
  readonly factIds: readonly string[];
  /** Who and what the entry is about, so the record can be read by subject. */
  readonly subjects: readonly OrderPartyRef[];
  /** The few of those worth showing on the entry's face, already named. */
  readonly tags: readonly EntryTag[];
  /** What moved on the map, among the things this entry is about. */
  readonly changes: readonly WorldChange[];
  readonly quote: EntryQuote | null;
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
  /** The longer matter this continues, when the observer may know of one. */
  readonly matter: string | null;
  /** True when nothing in it was witnessed: the court has this at second hand. */
  readonly reported: boolean;
  readonly weight: number;
  /** The reign's own business, which is told whatever it weighs. */
  readonly ours: boolean;
}

/**
 * Which storyline a thread continues, if the observer could know of it.
 *
 * Matched by overlap in who and where, not by the engine's own links: two of a
 * storyline's people or its province named in the thread is the same matter.
 * A private storyline is known to its participants alone; a polity-scoped one
 * to a government whose own people are in it.
 */
function matterOf(facts: readonly Fact[], storylines: readonly WorldStoryline[], observer: OrderPartyRef, observerPolityId: string | null, polityOf: (characterId: string) => string | null): string | null {
  const named = new Set(facts.flatMap((fact) => fact.affectedEntities.map((entity) => entity.id)));
  for (const storyline of storylines) {
    if (storyline.phase === "closed") continue;
    const knowable =
      storyline.visibility === "public"
      || (storyline.visibility === "polity" && storyline.participantIds.some((id) => observerPolityId !== null && polityOf(id) === observerPolityId))
      || (observer.kind === "character" && storyline.participantIds.includes(observer.id));
    if (!knowable) continue;
    const overlap = storyline.participantIds.filter((id) => named.has(id)).length + (storyline.provinceId !== null && named.has(storyline.provinceId) ? 1 : 0);
    if (overlap >= 2) return `"${storyline.title}" (${storyline.phase})`;
  }
  return null;
}

const keyOf = (ref: OrderPartyRef): string => `${ref.kind}:${ref.id}`;
const sortKeyOf = (instant: WorldInstant): number => instant.day * 1440 + instant.minute;

/** Strips the engine's own handles out of a line written for a person to read. */
function readable(line: string): string {
  return line.replace(ID_IN_BRACKETS, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Everything the record may draw on, and which of it is only hearsay.
 *
 * The first tier is what the observer has genuinely learned. The second is the
 * world elsewhere: a secret that weighs enough to travel and touches nothing
 * the observer's side answers for. Bookkeeping never publishes at all, and news
 * that has not had time to arrive waits until it has.
 */
function selectFacts(
  facts: readonly Fact[],
  observer: OrderPartyRef,
  observerPolityId: string | null,
  ownEntityIds: ReadonlySet<string> | null,
  to: WorldInstant,
  weightOf: (fact: Fact) => number,
): { readonly fact: Fact; readonly reported: boolean }[] {
  const known = new Set(factsKnownTo(facts, observer, observerPolityId, to));
  const toKey = sortKeyOf(to);
  const selected: { fact: Fact; reported: boolean }[] = [];

  for (const fact of facts) {
    if (NEVER_PUBLISHED.has(fact.kind)) continue;
    if (known.has(fact)) {
      selected.push({ fact, reported: false });
      continue;
    }
    // Nobody told the engine where this observer's reach ends, so nothing can
    // be judged far enough away to be harmless.
    if (ownEntityIds === null) continue;
    // Nobody's business but the engine's: a fact naming no one came out of
    // answering somebody's order, and cannot be judged near or far.
    if (fact.affectedEntities.length === 0) continue;
    // Ours, and hidden. This is the line the whole epistemic layer exists to
    // hold: a plot against the ruler does not become colour by being interesting.
    if (fact.affectedEntities.some((entity) => ownEntityIds.has(entity.id))) continue;
    if (weightOf(fact) < DISTANT_NEWS_THRESHOLD) continue;
    // Word has to get here. A fact with a travel time keeps it.
    const knowableAt = fact.discovery.knowableAtInstant;
    if (knowableAt !== null && sortKeyOf(knowableAt) > toKey) continue;
    selected.push({ fact, reported: true });
  }

  return selected;
}

/**
 * Splits facts into threads: a matter is everything that hangs together by who
 * and what it touches.
 *
 * Connected, not merely shared. Grouping only facts that name the observer put
 * the Boii's defence of their own strongholds in a different entry from the
 * Roman assault on them -- one war, told twice, because the Boii facts named the
 * Boii and the Roman facts named Rome. Following the links instead keeps a war
 * whole while leaving a Carthaginian deliberation nobody else is part of exactly
 * where it belongs: on its own.
 *
 * Two things are deliberately not allowed to connect anything.
 *
 * The reader's own power is the first. Everything their government does names
 * it, so it links every Roman matter to every other: an embassy to Syracuse and
 * a rising in Campania came back as one passage that told the rising for the
 * first time inside a paragraph about the embassy, because both facts said
 * "Rome". A power that appears in all of a reign's business cannot be what
 * distinguishes one piece of it from another. A *foreign* power still connects
 * freely -- "Boii" appears in the war with the Boii and nowhere else, which is
 * exactly what makes it a matter.
 *
 * And nothing the observer is named in is forced together any more. That rule
 * was written so a ruler would not read two chapters about one war; what it
 * actually did was fuse every separate thing their reign was doing into a single
 * entry, which is the same failure one level up.
 */
function splitIntoThreads(facts: readonly Fact[], observerPolityId: string | null): Fact[][] {
  const hubKey = observerPolityId === null ? null : `polity:${observerPolityId}`;

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
  const nameless: number[] = [];
  facts.forEach((fact, index) => {
    // A fact naming nobody came out of answering the ruler's order and has no
    // subject to find its thread by. Left alone each one became an entry of its
    // own, and a single pursuit fragmented into an entry per sentence.
    if (fact.affectedEntities.length === 0) nameless.push(index);
    for (const entity of fact.affectedEntities) {
      const subject = keyOf(entity);
      if (subject === hubKey) continue;
      const seen = firstSeenBySubject.get(subject);
      if (seen === undefined) firstSeenBySubject.set(subject, index);
      else union(seen, index);
    }
  });
  for (const index of nameless) union(nameless[0]!, index);

  const components = new Map<number, Fact[]>();
  facts.forEach((fact, index) => {
    const root = find(index);
    const bucket = components.get(root);
    if (bucket === undefined) components.set(root, [fact]);
    else bucket.push(fact);
  });
  return [...components.values()];
}

/** Everything the entry is about, deterministically ordered. */
function subjectsOf(facts: readonly Fact[]): OrderPartyRef[] {
  const seen = new Map<string, OrderPartyRef>();
  for (const fact of facts) for (const entity of fact.affectedEntities) seen.set(keyOf(entity), entity);
  return [...seen.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .slice(0, 8);
}

/**
 * How prominently a kind of subject identifies a matter, lowest first.
 *
 * Kinds absent from this table are not tagged at all. A procedure id, an
 * account, a project -- these are the engine's own handles for its own
 * bookkeeping, and a reader offered "62af32f4" as a way into the record learns
 * that the row is not for them. They stay among the subjects, which is what the
 * record is actually searched by.
 */
const TAG_RANK: Readonly<Record<string, number>> = { polity: 0, province: 1, character: 2, institution: 3, force: 4 };

/**
 * The few subjects worth printing on the entry's face.
 *
 * Every subject is kept on the record; showing all eight taught the reader to
 * skip the row. So the ones shown are those that most identify the matter: the
 * powers involved, then where, then who. Ranked by kind before frequency --
 * ranking by frequency first put an army and a senate motion on an entry whose
 * headline was about the Senate, because the motion happened to be named twice.
 * The observer's own government goes last among equals; they know who they are.
 */
function tagsOf(
  facts: readonly Fact[],
  subjects: readonly OrderPartyRef[],
  observerPolityId: string | null,
  nameOf: (ref: OrderPartyRef) => string | null,
): EntryTag[] {
  const mentions = new Map<string, number>();
  for (const fact of facts) {
    for (const entity of fact.affectedEntities) mentions.set(keyOf(entity), (mentions.get(keyOf(entity)) ?? 0) + 1);
  }
  const own = (ref: OrderPartyRef): number => (ref.kind === "polity" && ref.id === observerPolityId ? 1 : 0);
  return [...subjects]
    .filter((ref) => TAG_RANK[ref.kind] !== undefined)
    // A handle the engine never resolved names nothing. It reached the record
    // through a fact that referred to something its own batch did not create.
    .filter((ref) => !ref.id.startsWith("local:"))
    .sort((a, b) =>
      own(a) - own(b)
      || (TAG_RANK[a.kind] ?? 9) - (TAG_RANK[b.kind] ?? 9)
      || (mentions.get(keyOf(b)) ?? 0) - (mentions.get(keyOf(a)) ?? 0)
      || a.id.localeCompare(b.id))
    .slice(0, MAX_TAGS)
    // Named here rather than in the browser. An id is the engine's handle: the
    // reader was being offered "force-e98084fc-...-4" as a way into the record.
    .map((ref) => ({ kind: ref.kind, id: ref.id, label: nameOf(ref) ?? ref.id }));
}

function renderThread(thread: Thread, index: number): string {
  const lines = [`THREAD ${index + 1}${thread.reported ? " (news reaching the court; nobody here witnessed it)" : ""}`];
  if (thread.matter !== null) lines.push(`Part of a longer matter: ${thread.matter}.`);
  lines.push(
    thread.reported ? "Reported to have happened:" : "Known to have happened:",
    ...thread.facts.map((fact) => `- ${readable(fact.summary)}`),
  );
  if (thread.narrative.length > 0) lines.push("Accounts given at the time:", ...thread.narrative.map((line) => `- ${readable(line)}`));
  if (thread.frictions.length > 0) lines.push("Difficulties reported:", ...thread.frictions.map((line) => `- ${readable(line)}`));
  return lines.join("\n");
}

export async function composeChronicle(input: ChronicleInput): Promise<ChronicleResult> {
  const threshold = input.entryThreshold ?? DEFAULT_ENTRY_THRESHOLD;
  // An unweighted fact cannot be ruled out: where no weight was recorded, the
  // bar is treated as met rather than as failed.
  const weightOf = (fact: Fact): number => input.significanceByFactId?.get(fact.id) ?? threshold;
  const selected = selectFacts(input.facts, input.observer, input.observerPolityId, input.ownEntityIds ?? null, input.to, weightOf);
  if (selected.length === 0) return { entries: [], calls: 0 };

  const visible = selected.map((entry) => entry.fact);
  const reportedIds = new Set(selected.filter((entry) => entry.reported).map((entry) => entry.fact.id));
  const visibleFactIds = new Set(visible.map((fact) => fact.id));
  const observerKey = keyOf(input.observer);
  /** An account is publishable when the observer can see what it is an account of. */
  const publishable = (line: { readonly actorRef: OrderPartyRef | null; readonly factIds: readonly string[] }): boolean =>
    line.factIds.some((factId) => visibleFactIds.has(factId)) || (line.actorRef !== null && keyOf(line.actorRef) === observerKey);
  /**
   * Second-hand news arrives as news and nothing more. What reached the court
   * is that Agathocles was killed at a banquet -- not his nephew's own account
   * of why he did it, which nobody in this court has ever heard. So an account,
   * a reported difficulty and a quotation all need a *witnessed* fact to hang
   * on, where the bare summary only needs a published one.
   */
  const witnessed = (line: { readonly factIds: readonly string[] }): boolean =>
    line.factIds.some((factId) => visibleFactIds.has(factId) && !reportedIds.has(factId));
  const firsthand = (line: { readonly actorRef: OrderPartyRef | null; readonly factIds: readonly string[] }): boolean =>
    witnessed(line) || (line.actorRef !== null && keyOf(line.actorRef) === observerKey);
  const narrative = input.narrative.filter(firsthand);
  const frictions = input.frictions.filter(firsthand);
  const utterances = (input.utterances ?? []).filter((line) => publishable(line) && witnessed(line));

  const grouped = splitIntoThreads(visible, input.observerPolityId);
  const polityOf = (characterId: string): string | null => input.polityOfCharacter?.(characterId) ?? null;

  /**
   * Whether this is the reign's own business, which is always told.
   *
   * The reader's power is useless for *grouping* -- it appears in everything --
   * and exactly right for this. A matter their own side is named in gets an
   * entry whatever it weighs, because an order must be answered and because a
   * ruler is entitled to the whole of his own reign. The bar exists for the
   * world elsewhere, which is where a chronicle of everything stops being read.
   *
   * "Their own side" is `ownEntityIds` -- the same set the secrecy rule uses,
   * and deliberately the same one. Testing only for the polity ref judged a
   * consul's inspection of his own first legion to be foreign news, because the
   * fact named the legion and not the republic, and culled it at weight ten.
   *
   * Told nothing about where that side ends, nothing is foreign and the bar does
   * not apply. The strict answer belongs to the secrecy rule, where a wrong
   * guess leaks; here a wrong guess silently drops the answer to an order, and
   * the safe direction is the other way.
   */
  const ownKeys = new Set([keyOf(input.observer), ...(input.observerPolityId === null ? [] : [`polity:${input.observerPolityId}`])]);
  const isOurs = (facts: readonly Fact[]): boolean =>
    input.ownEntityIds === undefined
    || facts.some((fact) =>
      fact.affectedEntities.length === 0
      || fact.affectedEntities.some((entity) => ownKeys.has(keyOf(entity)) || input.ownEntityIds!.has(entity.id)));

  const built: Thread[] = grouped.map((facts) => {
    const ids = new Set(facts.map((fact) => fact.id));
    const belongs = (line: { readonly factIds: readonly string[] }): boolean => line.factIds.some((factId) => ids.has(factId));
    return {
      facts,
      narrative: narrative.filter(belongs).map((line) => line.line),
      frictions: frictions.filter(belongs).map((line) => line.line),
      matter: matterOf(facts, input.storylines ?? [], input.observer, input.observerPolityId, polityOf),
      // A thread is hearsay only when every fact in it is. One witnessed fact
      // makes the matter the court's own.
      reported: facts.every((fact) => reportedIds.has(fact.id)),
      weight: facts.reduce((sum, fact) => sum + weightOf(fact), 0),
      ours: isOurs(facts),
    };
  });

  const byWeight = (a: Thread, b: Thread): number =>
    b.weight - a.weight || sortKeyOf(a.facts[0]!.time) - sortKeyOf(b.facts[0]!.time) || a.facts[0]!.id.localeCompare(b.facts[0]!.id);

  const ours = built.filter((thread) => thread.ours).sort(byWeight);
  const seen = built.filter((thread) => !thread.ours && !thread.reported && thread.weight >= threshold).sort(byWeight);
  const hearsay = built.filter((thread) => !thread.ours && thread.reported && thread.weight >= threshold).sort(byWeight);

  const threads = [...ours, ...seen, ...hearsay.slice(0, MAX_REPORTED_THREADS)].slice(0, MAX_ENTRIES);
  if (threads.length === 0) return { entries: [], calls: 0 };

  const period = `${formatWorldDate(input.from, input.clock)} – ${formatWorldDate(input.to, input.clock)}`;
  const userMessage = [`Period: ${period}.`, "", ...threads.map((thread, index) => renderThread(thread, index))].join("\n\n");

  const changes = input.changes ?? [];
  const entryOf = (thread: Thread, title: string, body: string): ChronicleEntry => {
    const keys = thread.facts.map((fact) => sortKeyOf(fact.time));
    const subjects = subjectsOf(thread.facts);
    const named = new Set(thread.facts.flatMap((fact) => fact.affectedEntities.map((entity) => entity.id)));
    return {
      kind: "narrated",
      title,
      body,
      factIds: thread.facts.map((fact) => fact.id),
      subjects,
      tags: tagsOf(thread.facts, subjects, input.observerPolityId, (ref) => input.nameOf?.(ref) ?? null),
      // A change the entry's own facts do not name is a change the reader was
      // never told about. Gating here is what keeps the change list from being
      // the leak the prose is so carefully prevented from being.
      changes: changes.filter((change) => named.has(change.id)),
      quote: null,
      fromInstantSortKey: Math.min(...keys, sortKeyOf(input.to)),
      toInstantSortKey: Math.max(...keys, sortKeyOf(input.from)),
    };
  };

  // A failed narration must not cost the player the record itself: fall back to
  // the plain facts, under the period as a title, rather than losing the span.
  const withQuote = (entries: readonly ChronicleEntry[]): ChronicleEntry[] => attachQuote(entries, utterances, threads);
  const fallback = (): ChronicleResult => ({
    entries: withQuote(threads.map((thread) => entryOf(thread, period, thread.facts.map((fact) => readable(fact.summary)).join("\n\n")))),
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
    return entries.length === 0 ? fallback() : { entries: withQuote(entries), calls: 1 };
  } catch {
    return fallback();
  }
}

/**
 * At most one quotation per report, on the entry that earned it.
 *
 * Rarity is the whole effect. Two epigrams in twelve entries reads as a
 * chronicler preserving what was worth preserving; one per entry reads as a
 * feature. So the heaviest matter with something said in it gets the line, and
 * nothing else does.
 */
function attachQuote(
  entries: readonly ChronicleEntry[],
  utterances: readonly UtteranceLine[],
  threads: readonly Thread[],
): ChronicleEntry[] {
  if (utterances.length === 0 || entries.length === 0) return [...entries];

  let best: { index: number; weight: number; utterance: UtteranceLine } | null = null;
  entries.forEach((entry, index) => {
    const ids = new Set(entry.factIds);
    const spoken = utterances
      .filter((utterance) => utterance.factIds.some((factId) => ids.has(factId)))
      .sort((a, b) => a.actorRef.id.localeCompare(b.actorRef.id))[0];
    if (spoken === undefined) return;
    const weight = threads[index]?.weight ?? 0;
    if (best === null || weight > best.weight) best = { index, weight, utterance: spoken };
  });
  if (best === null) return [...entries];

  const chosen: { index: number; utterance: UtteranceLine } = best;
  return entries.map((entry, index) =>
    index === chosen.index
      ? { ...entry, quote: { line: chosen.utterance.line, speaker: chosen.utterance.speaker, occasion: chosen.utterance.occasion } }
      : entry);
}
