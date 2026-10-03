import { z } from "zod";
import {
  type OrderPartStatus,
  factsKnownTo,
  newsArrivesAt,
  newsDaysBetween,
  whereItHappened,
  whereTheyHear,
  MAX_NEWS_DAYS,
  formatWorldDate,
  type Fact,
  type NewsWorld,
  type OrderPartyRef,
  type ScenarioClock,
  type WorldChange,
  type WorldInstant,
  type WorldStoryline,
  type Office,
  type WorldState,
  allOffices,
  buildStation,
  holdsPolityStanding,
  warsOf,
} from "@chronica/shared";
import { extractJson } from "./json";
import { claimsItDone } from "./order-outcomes";
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
 *
 * This is the ceiling for a report written in one piece over a whole span.
 * The live record is no longer written that way: it is written window by
 * window as the burst walks forward (`WINDOW_MAX_ENTRIES`), and a burst of
 * four hops that told three things a hop would run to twelve.
 */
const MAX_ENTRIES = 10;

/**
 * How many entries one window of a burst may carry, beyond the answer to the
 * order and any battle, which are never cut.
 *
 * Publishing as you go means you cannot wait to see whether something heavier
 * comes later, so the global top-ten is replaced by a bar per window: what
 * clears it is told now, what does not rolls forward into the next window's
 * candidates and may clear it there, once the matter has grown.
 */
export const WINDOW_MAX_ENTRIES = 3;

/**
 * What the reader's own business must weigh to be told, when it neither
 * answers the order nor holds a battle.
 *
 * Their own business used to be told whatever it weighed. Told window by
 * window that meant an entry for every small thing the moment it happened;
 * the floor is the home band's, low enough that a reign's own doings still
 * outrank the world's, high enough that a routine remittance waits for the
 * matter it belongs to.
 */
export const OWN_BUSINESS_FLOOR = 25;

/** Things that happen to a place or a house whoever gave an order (see `isAmbientElsewhere`). */
const AMBIENT_KINDS: ReadonlySet<string> = new Set(["price_shock", "illness", "family_death"]);

/**
 * What is always told when it is the reader's own: a vote of his own chamber,
 * a turn in a siege his side lays or suffers, a war begun. Each was cut by the
 * per-window cap or declined as "a matter that has only gone on", and a consul
 * whose Senate voted three times in a day read about one vote, and about his
 * two-month siege of Messana nothing at all.
 */
export const MUST_TELL: ReadonlySet<string> = new Set([
  "motion_passed", "motion_failed", "motion_vetoed", "motion_referred", "council_advised", "council_overruled",
  "siege_laid", "siege_progress", "siege_ended", "siege_lifted", "war_declared", "city_taken", "province_control_change", "order_part_unanswered", "political_position_changed",
  // A treaty broken, an ally's call, a province or an army rising: the engine's own turns of fortune (`treaties.ts`, `unrest.ts`).
  "treaty_breached", "call_to_arms", "rising", "civil_war",
  // A promise broken is always told to the two it was between (`promises.ts`).
  "promise_broken",
]);

/**
 * What a thread must weigh before it is written up at all.
 *
 * Deliberately high. Significance is the acting party's own judgment of what it
 * just did, on a hundred-point scale, and the things worth a chronicler's ink
 * -- a city taken, a commander killed, an alliance struck -- score well above
 * this. Recruitment proceeding on schedule does not.
 */
export const DEFAULT_ENTRY_THRESHOLD = 45;

/**
 * What a matter of the reader's own country must weigh, when it is not their own
 * business. Lower than the wider world's: news from your own city reaches you
 * more cheaply than news from Syracuse.
 */
const HOME_THRESHOLD = 25;

/** How many of those one report may carry. */
const MAX_HOME_THREADS = 3;

/** And what a *foreign secret* must weigh before word of it travels at all. */
const DISTANT_NEWS_THRESHOLD = 40;

/** How many threads of distant news one report may carry. The court is not a newspaper. */
const MAX_REPORTED_THREADS = 2;

/**
 * How many matters of the wider world, witnessed but not the reader's, one
 * report may carry. This band had no ceiling at all: a live run answered
 * "start a church" with nine entries about Carthaginian fleets, Balkan road
 * works and a gale somewhere in Romania, and the church somewhere among them.
 * The world should feel alive around the reader's business, not bury it.
 */
const MAX_SEEN_THREADS = 3;

/**
 * How many subjects an entry shows on its face. The rest stay on the record,
 * unshown. Four, not three: a battle is two commanders and two powers, and at
 * three one of them was always missing -- usually the reader's own.
 */
const MAX_TAGS = 4;

/**
 * What the reader's own business must weigh for a headline of its own, when it
 * neither answers the order, holds a battle, nor must be told.
 *
 * Above the floor and under this, a matter is told -- but beside the other
 * small matters of the same days, in one passage, rather than each under its
 * own headline. A live reign read "Titus Genucius Sponsors His Own
 * Nomination" and "Rome Begins Surveying Messana's Defences" as entries of a
 * sentence each; a chronicler gathers those into one paragraph of the
 * month's business.
 */
export const OWN_HEADLINE_FLOOR = DEFAULT_ENTRY_THRESHOLD;

/**
 * How far away the wider world's news may happen and still be told on its
 * ordinary bar, in days by road from the nearest ground the reader's power
 * holds. Beyond it the bar rises, until at `FAR_NEWS_DAYS` only what weighs
 * `FAR_NEWS_WEIGHT` travels: a Roman consul read of a fire consuming the
 * heart of a Carpathian valley, at the weight of a local fire. A king's death
 * or a war far off still reaches him; the fire does not.
 */
const NEAR_NEWS_DAYS = 6;
const FAR_NEWS_DAYS = 14;
const FAR_NEWS_WEIGHT = 70;

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
export const NEVER_PUBLISHED: ReadonlySet<string> = new Set(["engine_rejection", "authority_breach"]);

/** Ids are for the engine. A summary carrying one must not reach the prose. */
const ID_IN_BRACKETS = /\s*\[[A-Za-z0-9][A-Za-z0-9._:-]*\]/g;

export const CHRONICLE_SYSTEM_PROMPT = `You are a historian of the ancient world writing the history of a reign
from the documents that survive: dispatches, letters, the Senate's minutes,
reports from the field. You write for readers who want to know what happened,
who did it, and why -- the way Livy or Polybius would tell it, plainly and
with an eye for the telling detail.

You will be given a date range and one or more numbered THREADS. A thread is a
single matter -- one war, one embassy, one vote -- and each gets its own
passage under its own headline.

THE HEADLINE says who did what, like an index entry: "Legate Refuses Antuvi
Leave to Cross into Samnium", "Etruscan Envoys Sue for Peace After Sutrium",
"Agathocles of Syracuse Assassinated". A person or a body, and the deed.
Capitalised as a title; never a date, never a bare noun phrase.

THE PASSAGE tells the matter in the order it happened, in the past tense.
Its length is the matter's: a single decision is told in two or three
sentences, a battle or an embassy that went back and forth in a paragraph or
two. Say each thing once, and stop when the last thing that happened has been
told -- no summing up, no moral, no word on what it means or what may come.

Tell what people did and why they did it: what they wanted, what they argued,
what it cost them, what they found. Name them in full at first mention, with
their office -- "the consul Gaius Genucius Clepsina" -- and by one name after.
Put arguments into indirect speech rather than inventing dialogue. Where a
thread has several people, give each his part.

Tell what happened, not what did not. The documents are written by clerks who
guard themselves -- "without conceding allegiance", "made no pledge", "no
engagement was ordered", "the order alone did not ensure the walls would fall".
Leave all of that out. A refusal is an event, and so is a decision to wait;
the absence of something is not, and neither is anything a clerk says to
cover himself. Except the ruler's own order: what he ordered that did not come
about is part of what happened to it, and is said plainly, never covered by
what was ordered.

Numbers are for the reader, not the ledger. Round the large ones as a
historian would -- "some seven and a half thousand men", "about six hundred
fell" -- and keep the small ones exact. Give each figure once; never total up
what you have already given.

Write only from what the thread gives you. You may give it the colour of its
time and place -- the season, the ground, the kind of men involved -- but not a
single event, number or motive it does not contain. A thread marked as news
reaching the court is second-hand: tell it as the court heard it ("word came
from Syracuse that"). Keep the threads apart; a passage names nothing that is
not in its own thread.

Write as a historian, never as a clerk: none of "project", "milestone",
"status", "authorized strength", "field force", "recognized", "the two
decisions", nor of writing about the record itself ("was recorded as"). No
headings, lists, advice, or address to the reader.

THE QUOTATION. Where a passage turns on a moment somebody faced -- a death, a
victory, an oath, a refusal, a last stand, a verdict, a bargain struck -- give
it the one line said then, in "quote". Most passages have none; leave it out
rather than force one. The speaker is a person in that thread, named exactly as
the thread names them; the one whose reign this is may speak too, when the
moment is theirs. Words recorded at the time come first. Otherwise write what
the moment made them say:
- under twenty words, in their own voice and of their own age: laconic and
  concrete, with an edge -- a soldier's joke, a threat with no adjectives, a
  cold sum, a plain image. The line men repeated afterwards.
- never a slogan, a modern turn of phrase, a speech about history or the gods'
  plan, or an explanation of what is happening; never a famous saying reused.
The occasion is where and to whom, briefly: "to his guard, as the Numidians
closed on the ford".

Answer with JSON and nothing else:
{"entries":[{"thread":1,"title":"...","body":"...","quote":{"speaker":"...","line":"...","occasion":"..."}}]}
"quote" may be left out.`;

const ChronicleOutputSchema = z
  .object({
    entries: z
      .array(
        z.object({
          thread: z.number().int().positive(),
          title: z.string().trim().min(1).max(120),
          body: z.string().trim().min(1),
          quote: z
            .object({
              speaker: z.string().trim().min(1).max(120),
              line: z.string().trim().min(1).max(220),
              occasion: z.string().trim().min(1).max(160),
            })
            .nullable()
            .optional()
            // A quotation that does not read is dropped, never the passage with it.
            .catch(null),
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

/** A fight, as the engine actually resolved it. See `battle.ts`'s `BattleAccount`. */
export interface BattleAccountLine {
  readonly factIds: readonly string[];
  readonly provinceName: string;
  readonly sides: readonly { readonly name: string; readonly attacking: boolean; readonly strength: number; readonly unit?: "men" | "ships"; readonly commander: string }[];
  readonly phases: readonly { readonly phase: string; readonly summary: string; readonly attacker: number; readonly defender: number }[];
  readonly tactics: readonly string[];
  readonly refusedTactics: readonly string[];
  readonly losses: readonly { readonly name: string; readonly unit?: "men" | "ships"; readonly dead: number; readonly deserted: number; readonly wounded: number }[];
  readonly commanders: readonly { readonly name: string; readonly outcome: string }[];
  /** Named men in the ranks; absent on accounts written before armies had any. */
  readonly members?: readonly { readonly name: string; readonly force: string; readonly outcome: string; readonly place?: string }[];
  readonly retreats: readonly { readonly name: string; readonly to: string | null; readonly orderly: boolean }[];
  readonly outcome: string;
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
  /**
   * The world the record is written in, for the road: news from Sicily reaches
   * a reader in Rome days after it happened, and is told when it arrives
   * (`newsArrivesAt`). Left out, a fact is known when it happened, or when its
   * own `knowableAtInstant` says.
   */
  readonly world?: (NewsWorld & { readonly projects?: WorldState["projects"]; readonly orders?: WorldState["orders"] }) | undefined;
  /** What the reader's campaign is about (`campaignOf`): news touching it is weighed lightly. */
  readonly campaignIds?: ReadonlySet<string> | undefined;
  /** Where a part of an order stands, by its ref, read from the whole world (`order-outcomes.ts`). */
  readonly orderOutcome?: ((partKey: string) => { readonly line: string; readonly status: OrderPartStatus } | null) | undefined;
  /** What the actors said they were doing, for colour the bare facts lack. */
  readonly narrative: readonly NarrativeLine[];
  readonly frictions: readonly NarrativeLine[];
  /** What people actually said. At most one reaches the record. */
  readonly utterances?: readonly UtteranceLine[];
  /**
   * What happened in any battle, phase by phase.
   *
   * Gated exactly like an account or a quotation -- it travels with its facts,
   * so a battle the reader never heard of cannot be written up for them.
   */
  readonly battleAccounts?: readonly BattleAccountLine[];
  /** Fact id → its author's weight, for ordering threads and for the bar. */
  readonly significanceByFactId?: ReadonlyMap<string, number>;
  /** The threads the world is following, so a passage that continues one can say so. */
  readonly storylines?: readonly WorldStoryline[];
  /** Whose government a character belongs to, for deciding whether a polity-scoped thread is the observer's to know. */
  readonly polityOfCharacter?: (characterId: string) => string | null;
  /** What a subject is called, for the tags a reader sees. Unnamed subjects fall back to their id. */
  readonly nameOf?: (ref: OrderPartyRef) => string | null;
  /** A person in a line: name, station, power, where they are. See `whoIsWho`. */
  readonly describePerson?: (characterId: string) => string | null;
  /**
   * Who the last report was already about: one set of subject ids per entry.
   *
   * Without it, a matter that is merely *continuing* gets a fresh headline
   * every report. A live game produced five consecutive reports led by "Hieron
   * II Tightens the Investment of Messana", "…the Cordon Around Messana",
   * "…Interception of the Mamertine Sortie" -- two of them word for word the
   * same title -- describing one siege in which nothing whatever had changed.
   * A chronicle is a record of what happened, and a siege going on is not a
   * thing that happened.
   */
  readonly recentSubjects?: readonly (readonly string[])[];
  /**
   * What the last reports were headlined, in their own words.
   *
   * The subject-set guard above catches the clear cases and keeps leaking the
   * unclear ones, because "the same matter" drifts by an id at a time and no
   * set comparison survives that for long. This puts the judgment where
   * judgment belongs: the historian is shown what they wrote last time and
   * told not to write it again. The engine still supplies the bookkeeping --
   * it is the one thing a model cannot be asked to remember.
   */
  readonly recentTitles?: readonly string[];
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
  /**
   * What the reader personally touches: their money, their people, their
   * ground, the matters they are party to.
   *
   * Split from `ownEntityIds` rather than replacing it, because that one set
   * was quietly doing two opposed jobs. It is the secrecy shield -- a secret
   * touching our side never travels as distant news -- and it is the weight
   * exemption -- our own business is told whatever it weighs. Narrowing it to
   * a merchant would narrow the shield too, and a secret plot inside the Roman
   * Senate, naming no merchant, would become publishable to him as news
   * reaching the court. That is the exact leak the epistemic layer exists to
   * prevent, arriving through the fix for something else.
   *
   * Absent, this falls back to `ownEntityIds` and the record reads as it did.
   */
  readonly personalEntityIds?: ReadonlySet<string>;
  /**
   * The facts this burst produced in answer to the reader's own order. Always
   * told, whatever they weigh: a ruler who gives an order and reads nothing has
   * been failed by the record. A weight floor under the reign's whole business
   * was tried for this and reverted -- it was a floor under a category, and
   * this is a floor under the answer to the question actually asked.
   */
  readonly orderFactIds?: ReadonlySet<string>;
  /** What moved on the map while this was happening, for the change list. */
  readonly changes?: readonly WorldChange[];
  /** What a thread must weigh to be written up. */
  readonly entryThreshold?: number;
  /**
   * How many entries this call may write beyond the order's answer and any
   * battle. A whole span written at once takes `MAX_ENTRIES`; one window of a
   * burst takes `WINDOW_MAX_ENTRIES`.
   */
  readonly maxEntries?: number;
  /**
   * Whether to write the weightiest thread anyway when nothing clears the bar,
   * so a report is not blank when something happened. On for a whole span;
   * off for a window, whose leftovers roll forward instead of being forced.
   */
  readonly fallback?: boolean;
  /**
   * Handed each entry as soon as it and every entry before it are written,
   * in the report's order, so the first passage reaches the reader while the
   * later ones are still being composed. Awaited in order. The returned
   * entries are the same ones, complete.
   */
  readonly onEntry?: ((entry: ChronicleEntry) => Promise<void>) | undefined;
  /**
   * Told what this call will write about and what it leaves, the moment that
   * is decided and before any passage is written: the choosing is arithmetic,
   * so the next window can choose knowing it, while the writing still runs
   * side by side (C07). Called once, whatever is chosen, and before the
   * historian is asked anything.
   */
  readonly onSelected?: ((selection: { readonly carried: readonly Fact[]; readonly subjects: readonly (readonly string[])[] }) => void) | undefined;
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
  /** The threads of history it belongs to, as the reader could know them. */
  readonly storylineIds?: readonly string[];
  readonly fromInstantSortKey: number;
  readonly toInstantSortKey: number;
}

export interface ChronicleResult {
  readonly entries: readonly ChronicleEntry[];
  readonly calls: number;
  /**
   * The facts this call did not tell: not yet knowable, under the bar, or
   * held as a repeat. The next window of the same burst offers them again,
   * beside its own, so a matter that builds slowly is told once it has built.
   */
  readonly carried: readonly Fact[];
}

interface Thread {
  readonly facts: readonly Fact[];
  readonly narrative: readonly string[];
  readonly frictions: readonly string[];
  /** The longer matter this continues, when the observer may know of one. */
  readonly matter: string | null;
  /** True when nothing in it was witnessed: the court has this at second hand. */
  readonly reported: boolean;
  /** A fight, where this thread holds one. Written at length, and never cut. */
  readonly battle: BattleAccountLine | null;
  readonly weight: number;
  /** The heaviest single fact in it: a pile of small things is still small (`OWN_BUSINESS_FLOOR`). */
  readonly peak: number;
  /** A decision or a turn of a siege on the reader's own side: always told (`MUST_TELL`). */
  readonly mustTell: boolean;
  /** The reader's own business, told for less than the world's (`OWN_BUSINESS_FLOOR`) and never held as a repeat. */
  readonly ours: boolean;
  /** Their country's business, which is told for less than the wider world's. */
  readonly home: boolean;
  /** Holds part of the answer to the order this report follows, and names the reader's side. */
  readonly answersTheOrder: boolean;
  /** How many of the order's own facts it holds: the thread holding most is the answer. */
  readonly orderFacts: number;
  /** Who is who among the people in it, so two of them cannot become one. */
  readonly people: readonly string[];
  /** Several small matters of the reader's own, gathered into one passage (`OWN_HEADLINE_FLOOR`). */
  readonly digest: boolean;
  /** The part of an order it tells, when it tells one (`matterKeys`). Two parts are two passages. */
  readonly partKey: string | null;
  /** Where that part stands, read from the world: what the passage must say and not contradict. */
  readonly outcome: { readonly line: string; readonly status: OrderPartStatus } | null;
  /** Which of its facts came only as word of mouth, in a thread that also holds what was seen (C05). */
  readonly hearsayIds: ReadonlySet<string>;
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
  const storyline = mattersOf(facts, storylines, observer, observerPolityId, polityOf)[0];
  return storyline === undefined ? null : `"${storyline.title}" (${storyline.phase})`;
}

/**
 * Every storyline these facts belong to, as the observer could know it:
 * linked by the engine (`causalFactIds`), or matched by who and where.
 */
function mattersOf(facts: readonly Fact[], storylines: readonly WorldStoryline[], observer: OrderPartyRef, observerPolityId: string | null, polityOf: (characterId: string) => string | null): WorldStoryline[] {
  const named = new Set(facts.flatMap((fact) => fact.affectedEntities.map((entity) => entity.id)));
  const factIds = new Set(facts.map((fact) => fact.id));
  const found: WorldStoryline[] = [];
  for (const storyline of storylines) {
    const knowable =
      storyline.visibility === "public"
      || (storyline.visibility === "polity" && storyline.participantIds.some((id) => observerPolityId !== null && polityOf(id) === observerPolityId))
      || (observer.kind === "character" && storyline.participantIds.includes(observer.id));
    if (!knowable) continue;
    const linked = storyline.causalFactIds.some((id) => factIds.has(id));
    const overlap = storyline.participantIds.filter((id) => named.has(id)).length + (storyline.provinceId !== null && named.has(storyline.provinceId) ? 1 : 0);
    if (linked || (storyline.phase !== "closed" && overlap >= 2)) found.push(storyline);
  }
  return found;
}

const keyOf = (ref: OrderPartyRef): string => `${ref.kind}:${ref.id}`;
const sortKeyOf = (instant: WorldInstant): number => instant.day * 1440 + instant.minute;

/** Strips the engine's own handles out of a line written for a person to read. */
function readable(line: string): string {
  return line.replace(ID_IN_BRACKETS, "").replace(/\s{2,}/g, " ").trim();
}

/** A letter the observer, or their government, wrote: its first person and its first power are the writer's. */
function writtenBy(letter: Fact, observer: OrderPartyRef, observerPolityId: string | null): boolean {
  const writer = letter.affectedEntities.find((entity) => entity.kind === "character");
  const power = letter.affectedEntities.find((entity) => entity.kind === "polity");
  return (observer.kind === "character" && writer?.id === observer.id) || (observerPolityId !== null && power?.id === observerPolityId);
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
  world: NewsWorld | undefined,
  orderFactIds: ReadonlySet<string>,
): { readonly fact: Fact; readonly reported: boolean }[] {
  // The answer to the reader's own order is his own act, and a man does not
  // wait on the road to learn what he did: the rest of the world's news does.
  //
  // Nor does a man wait to learn what he wrote. A letter is on the road until
  // its reader has it, and the engine dates it so; its writer read of his own
  // letter a window after the model's word that he had sent it, and the one
  // act was told twice (`sameLetters`).
  const ownLetters = new Map(facts
    .filter((fact) => fact.kind === "letter_sent" && writtenBy(fact, observer, observerPolityId))
    .map((fact): [Fact, Fact] => [{ ...fact, discovery: { ...fact.discovery, state: fact.visibility, knowableAtInstant: null } }, fact]));
  const known = new Set([
    ...factsKnownTo(facts, observer, observerPolityId, to, world),
    ...factsKnownTo(facts.filter((fact) => orderFactIds.has(fact.id)), observer, observerPolityId, to),
    ...factsKnownTo([...ownLetters.keys()], observer, observerPolityId, to).map((copy) => ownLetters.get(copy)!),
  ]);
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
    // And theirs, and hidden, which this band did not check at all.
    //
    // Distance was doing the whole of the work: anything that touched nothing
    // of the reader's could travel as news. A live game published a
    // Carthaginian's private conspiracy -- `discovery: "private"`, known to
    // the one man who had begun it and to nobody else in the world -- in full,
    // in a Roman consul's Chronicle, because it named nothing Roman.
    //
    // News is a report of something somebody can come to know. `private` is
    // the state that says nobody can: there is no road out of it and no
    // instant at which it becomes knowable, so no distance makes it
    // reportable. Everything else -- rumoured, delayed, intercepted, a
    // government's own business -- is loose in the world, and the travel-time
    // check below decides when it gets here.
    if (fact.discovery.state === "private") continue;
    if (weightOf(fact) < DISTANT_NEWS_THRESHOLD) continue;
    // Word has to get here: the road from where it happened, and never
    // before its own travel time.
    if (newsArrivesAt(world, fact, observer) > toKey) continue;
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
/**
 * A speech told twice is one speech. The engine records every speech in a
 * chamber (`senate_speech`, with the words); the model, answering the same
 * man, often writes its own "publicly supported the fleet budget" beside it.
 * The two landed in different threads and the Chronicle printed Cursor's
 * speech of 27 August twice, and gave Dentatus a speech he never made.
 * A model's fact about a man backing or opposing a question is dropped when the
 * engine recorded him speaking that day.
 */
function withoutEchoes(facts: readonly Fact[]): Fact[] {
  const spoke = new Set(facts
    .filter((fact) => fact.kind === "senate_speech")
    .flatMap((fact) => fact.affectedEntities.filter((entity) => entity.kind === "character").map((entity) => `${entity.id}@${fact.time.day}`)));
  if (spoke.size === 0) return [...facts];
  return facts.filter((fact) => {
    if (fact.kind === "senate_speech" || !/(support|advoca|speech|oppos|spoke)/u.test(fact.kind)) return true;
    const people = fact.affectedEntities.filter((entity) => entity.kind === "character");
    return !(people.length > 0 && people.every((person) => spoke.has(`${person.id}@${fact.time.day}`)));
  });
}

/**
 * A letter told twice is one letter. The engine records every letter sent
 * (`letter_sent`: its writer, its reader, both powers); the model, writing the
 * same act, often records its own "appealed to Hiero for the strait" beside
 * it. The two named different things -- a man and a power, a power and a
 * man -- and became two entries about one letter. Unlike a speech, the
 * model's fact is kept, since it often says why the letter was written; the
 * two are made one matter instead.
 *
 * Pairs, by index: a letter and a fact of the diplomatic kind, within a few
 * days of it, naming its writer and its reader or the reader's power -- not
 * the reader's own power, which every Roman fact names.
 */
function sameLetters(facts: readonly Fact[], observerPolityId: string | null): [number, number][] {
  const pairs: [number, number][] = [];
  facts.forEach((letter, letterIndex) => {
    if (letter.kind !== "letter_sent") return;
    const people = letter.affectedEntities.filter((entity) => entity.kind === "character").map((entity) => entity.id);
    const powers = letter.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id);
    const writer = people[0];
    if (writer === undefined) return;
    // The first power is the writer's, the second the reader's, when there is one.
    const readers = new Set([...people.slice(1), ...powers.slice(1).filter((id) => id !== observerPolityId)]);
    if (readers.size === 0) return;
    facts.forEach((echo, echoIndex) => {
      if (echoIndex === letterIndex || echo.kind === "letter_sent") return;
      if (!LETTER_WORDS.test(echo.kind) && !LETTER_WORDS.test(echo.summary)) return;
      if (Math.abs(echo.time.day - letter.time.day) > SAME_LETTER_DAYS) return;
      const named = new Set(echo.affectedEntities.map((entity) => entity.id));
      if (named.has(writer) && [...readers].some((id) => named.has(id))) pairs.push([letterIndex, echoIndex]);
    });
  });
  return pairs;
}

/** What the model calls writing to somebody. */
/** A diplomatic act as the record names them: told as a matter of substance when it bears on the reader's campaign. */
const DIPLOMATIC_ACT = /(appeal|embass|envoy|dispatch|petition|overture|ultimatum|demand|diplomat|offer|negotiat|safe.conduct|neutrality|mediat|parley|truce|armistice|restrain|protection|undertak)/iu;
/** What a diplomatic act touching the reader's campaign is worth, at least. */
const CAMPAIGN_DIPLOMACY_WEIGHT = 72;
/** What any other news touching it gains. */
const CAMPAIGN_LIFT = 15;
const LETTER_WORDS = /(appeal|letter|embass|envoy|message|dispatch|petition|propos|overture|ultimatum|demand|request|diplomat|offer|negotiat|summon|invit|wrote|writes)/iu;

/** How far apart a letter and the model's word of it may be dated and still be one act. */
const SAME_LETTER_DAYS = 3;

/**
 * What a project belongs to: the army it moves or raises, the man over it, the
 * ground it ends on, what it has made. A project's own facts name the project
 * alone, so "Legio I completes its crossing" and "the squadron arrives" were
 * entries of their own beside the thread of the very army and order they
 * finished. Named through these, they join it.
 */
function projectRelations(world: ChronicleInput["world"], observerPolityId: string | null): (fact: Fact) => string[] {
  const projects = new Map((world?.projects ?? []).map((project) => [project.id, project]));
  if (projects.size === 0) return () => [];
  return (fact) => fact.affectedEntities.flatMap((entity) => {
    const project = entity.kind === "project" ? projects.get(entity.id) : undefined;
    if (project === undefined) return [];
    const outcome = project.completionOutcome;
    return [
      project.overseerCharacterId ?? null,
      project.sponsorEntityRef.id,
      outcome?.forceId ?? null,
      outcome?.provinceId ?? null,
      outcome?.commanderCharacterId ?? null,
      ...project.linkedEntityIds,
    ].filter((id): id is string => id !== null && id !== observerPolityId);
  });
}

/** What a fight day produces (`engagements.ts`, `battle.ts`): told per day, not folded into one entry. */
const FIGHT_DAY_KINDS: ReadonlySet<string> = new Set([
  "battle", "skirmish", "force_withdrew", "camp_taken", "engagement_broken_off", "engagement_turning_point",
  "commander_captured", "commander_wounded", "night_attack", "camp_stormed", "siege_event", "sea_battle",
]);

/**
 * The matter a fact belongs to, where the world knows it: the part of an order
 * it answers (`world.orders`), stamped on it when it was written or reached
 * through the work that part set going. Two facts of one matter are one thread
 * whatever they name; two of different matters are never one, however many
 * people they share. The transport, the accounts inquiry and the ceasefire of
 * a single order all named Clepsina, and were written up as one entry (C01).
 */
export function matterKeys(_world: ChronicleInput["world"]): (fact: Fact) => string | null {
  // By the part it was stamped with when it happened (`stampWorkFacts`), and
  // nothing else: a fact that merely names the consul, or the legion, is not
  // his transport's for naming them (E05).
  return (fact) => fact.sourceActionId ?? null;
}

function splitIntoThreads(
  facts: readonly Fact[],
  observerPolityId: string | null,
  orderFactIds: ReadonlySet<string> = new Set(),
  relatedOf: (fact: Fact) => readonly string[] = () => [],
  matterOfFact: (fact: Fact) => string | null = () => null,
  observerCharacterId: string | null = null,
): Fact[][] {
  // The reader's own power and the reader himself: everything of his names
  // one or the other, and joining by them joined all his business into one.
  const hubKeys = new Set([
    ...(observerPolityId === null ? [] : [`polity:${observerPolityId}`]),
    ...(observerCharacterId === null ? [] : [`character:${observerCharacterId}`]),
  ]);

  const parent = new Map<number, number>();
  const find = (index: number): number => {
    let root = index;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    return root;
  };
  // The matter each group holds, once it holds one. Two groups of different
  // matters are not joined by anything they share.
  const matterOfRoot = new Map<number, string>();
  const union = (a: number, b: number): void => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA === rootB) return;
    const [matterA, matterB] = [matterOfRoot.get(rootA), matterOfRoot.get(rootB)];
    if (matterA !== undefined && matterB !== undefined && matterA !== matterB) return;
    parent.set(rootB, rootA);
    if (matterA === undefined && matterB !== undefined) matterOfRoot.set(rootA, matterB);
  };

  facts.forEach((_, index) => parent.set(index, index));
  // A matter's facts first: they are one thread before anything else is asked.
  const firstOfMatter = new Map<string, number>();
  facts.forEach((fact, index) => {
    const matter = matterOfFact(fact);
    if (matter === null) return;
    matterOfRoot.set(index, matter);
    const seen = firstOfMatter.get(matter);
    if (seen === undefined) firstOfMatter.set(matter, index);
    else union(seen, index);
  });
  const firstSeenBySubject = new Map<string, number>();
  const nameless: number[] = [];
  facts.forEach((fact, index) => {
    // A fact naming nobody came out of answering the ruler's order and has no
    // subject to find its thread by. Left alone each one became an entry of its
    // own, and a single pursuit fragmented into an entry per sentence.
    //
    // But only the order's own. A project finishing and a theft in a far
    // temple name nobody either, and folding every nameless fact into one
    // matter wrote Arvernian roadworks, a stolen temple treasure at Ghadamis
    // and a raid in Lucania up as a single entry. A nameless fact that did not
    // come from the order is its own matter.
    if (fact.affectedEntities.length === 0 && orderFactIds.has(fact.id)) nameless.push(index);
    // A fact about a question before a chamber is about that question, and
    // joins its thread by the question alone. Three votes in one sitting --
    // transports carried, war taxes refused, an emergency declared -- all
    // named their sponsor and were written up as one entry; each is its own
    // decision, and its own entry.
    const question = fact.affectedEntities.find((entity) => entity.kind === "procedure");
    // A fight that lasts is told day by day: the first clash, the day the left
    // gave way, the night they slipped out of the camp. Its facts join only
    // the same day's, so a week at Messana is a week of entries, and the quiet
    // days go to the gathered passage like any other light news.
    const dayBound = FIGHT_DAY_KINDS.has(fact.kind);
    for (const entity of question === undefined ? fact.affectedEntities : [question]) {
      const subject = dayBound ? `${keyOf(entity)}@${fact.time.day}` : keyOf(entity);
      if (hubKeys.has(subject)) continue;
      const seen = firstSeenBySubject.get(subject);
      if (seen === undefined) firstSeenBySubject.set(subject, index);
      else union(seen, index);
    }
  });
  for (const index of nameless) union(nameless[0]!, index);
  // What a fact belongs to without naming it: a project's army and ground.
  const firstSeenById = new Map<string, number>();
  for (const [subject, index] of firstSeenBySubject) {
    const id = subject.slice(subject.indexOf(":") + 1);
    if (!firstSeenById.has(id)) firstSeenById.set(id, index);
  }
  facts.forEach((fact, index) => {
    for (const id of relatedOf(fact)) {
      const seen = firstSeenById.get(id);
      if (seen !== undefined) union(seen, index);
    }
  });
  for (const [letter, echo] of sameLetters(facts, observerPolityId)) union(letter, echo);

  const components = new Map<number, Fact[]>();
  facts.forEach((fact, index) => {
    const root = find(index);
    const bucket = components.get(root);
    if (bucket === undefined) components.set(root, [fact]);
    else bucket.push(fact);
  });
  return [...components.values()];
}

/**
 * A headline for an entry the historian did not write: its first fact's first
 * clause, which says who did what. The period it covered was printed instead,
 * and "21 June 270 BC – 22 June 270 BC" over three votes is a date, not news.
 */
function headlineOf(facts: readonly Fact[]): string | null {
  const first = facts.map((fact) => readable(fact.summary).trim()).find((summary) => summary.length > 0);
  if (first === undefined) return null;
  const clause = first.split(/(?<=[.;:])\s|,\s(?=\d)/)[0]!.replace(/[.;:,\s]+$/, "");
  if (clause.length <= HEADLINE_MAX) return clause.length === 0 ? null : clause;
  // Too long to stand whole: cut where the sentence itself pauses -- a comma,
  // or before "when", "so that", "toward" -- never mid-phrase. "Blasio
  // directed Legio I to prepare successive portions for embarkation toward
  // Messana when the transports" was a headline stopped by a character count.
  const within = clause.slice(0, HEADLINE_MAX + 1);
  const pauses = [...within.matchAll(/,\s|\s(?=(?:when|while|after|before|until|so that|because|once|if|toward|towards|for|to|and|but|with|from|in|at|on)\s)/gu)]
    .map((match) => match.index)
    .filter((index) => index >= 30);
  let title = pauses.length === 0 ? within.slice(0, within.lastIndexOf(" ")) : within.slice(0, pauses[pauses.length - 1]);
  // Nor does a headline end on a word that promises more.
  title = title.replace(/(?:\s+(?:the|a|an|of|to|toward|towards|for|and|or|but|when|with|from|in|at|on|by|his|her|its|their))+$/iu, "").replace(/[,;:\s]+$/u, "");
  return title.length === 0 ? null : title;
}

/** The longest a headline taken from the facts' own words may run. */
const HEADLINE_MAX = 110;

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
 * skip the row. So the ones shown are those that most identify the matter:
 * who led it, then the powers in it, then where, then who else. Ranked by kind
 * before frequency -- ranking by frequency first put an army and a senate
 * motion on an entry whose headline was about the Senate, because the motion
 * happened to be named twice.
 *
 * Who led it comes first because frequency picked the wrong man: a naval
 * battle Hannibal Gisco won was tagged with Decius Vibellius, who was named in
 * more of its facts, and not with him. A battle's commanders lead; elsewhere
 * the one the weightiest fact names first, which is the one who acted.
 *
 * The reader's own power is tagged like any other party. Sorted last, it was
 * the first dropped, and a Roman war read as a Carthaginian one. And a name
 * is shown once: the Boii are a people and a province, and "Boii, Boii" is
 * two tags saying one thing.
 */
function tagsOf(
  facts: readonly Fact[],
  battle: BattleAccountLine | null,
  weightOf: (fact: Fact) => number,
  observerPolityId: string | null,
  nameOf: (ref: OrderPartyRef) => string | null,
): EntryTag[] {
  const mentions = new Map<string, number>();
  const all = new Map<string, OrderPartyRef>();
  for (const fact of facts) {
    for (const entity of fact.affectedEntities) {
      mentions.set(keyOf(entity), (mentions.get(keyOf(entity)) ?? 0) + 1);
      all.set(keyOf(entity), entity);
    }
  }
  const commanders = new Set(battle === null ? [] : [...battle.commanders.map((commander) => commander.name), ...battle.sides.map((side) => side.commander)]);
  const heaviest = [...facts].sort((a, b) => weightOf(b) - weightOf(a))[0];
  const actor = battle !== null ? undefined : heaviest?.affectedEntities.find((entity) => entity.kind === "character");
  const lead = (ref: OrderPartyRef): number =>
    ref.kind === "character" && ((commanders.size > 0 && commanders.has(nameOf(ref) ?? "")) || (actor !== undefined && ref.id === actor.id)) ? 0 : 1;
  const own = (ref: OrderPartyRef): number => (ref.kind === "polity" && ref.id === observerPolityId ? 0 : 1);
  const ranked = [...all.values()]
    .filter((ref) => TAG_RANK[ref.kind] !== undefined)
    // A handle the engine never resolved names nothing. It reached the record
    // through a fact that referred to something its own batch did not create.
    .filter((ref) => !ref.id.startsWith("local:"))
    .sort((a, b) =>
      lead(a) - lead(b)
      || (TAG_RANK[a.kind] ?? 9) - (TAG_RANK[b.kind] ?? 9)
      || own(a) - own(b)
      || (mentions.get(keyOf(b)) ?? 0) - (mentions.get(keyOf(a)) ?? 0)
      || a.id.localeCompare(b.id));
  const tags: EntryTag[] = [];
  const shown = new Set<string>();
  for (const ref of ranked) {
    // Named here rather than in the browser. An id is the engine's handle: the
    // reader was being offered "force-e98084fc-...-4" as a way into the record.
    const label = nameOf(ref) ?? ref.id;
    const same = label.trim().toLowerCase();
    if (shown.has(same)) continue;
    shown.add(same);
    tags.push({ kind: ref.kind, id: ref.id, label });
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

/** The fight itself, in the order it happened, for a passage that has to earn a death. */
function renderBattle(battle: BattleAccountLine): string[] {
  const lines = [
    "This thread holds a battle. Write it at length -- three hundred and fifty to six",
    "hundred words -- and write the fight, not only who won: where the lines met, what",
    "was tried, when it turned, who broke and where they ran to. The detail is the",
    "point even where it changes nothing strategically.",
    `The field: ${battle.provinceName}. It ended in ${battle.outcome.replace(/_/g, " ")}.`,
    "Who fought:",
    ...battle.sides.map((side) => `  - ${side.name}, ${side.attacking ? "attacking" : "defending"}, ${side.strength} ${side.unit ?? "men"} under ${side.commander}`),
    "How it went, in order:",
    ...battle.phases.map((phase) => `  - ${phase.phase}: ${phase.summary} (weight ${phase.attacker} against ${phase.defender})`),
  ];
  if (battle.tactics.length > 0) lines.push("What was tried:", ...battle.tactics.map((tactic) => `  - ${tactic}`));
  if (battle.refusedTactics.length > 0) lines.push("What the ground would not allow:", ...battle.refusedTactics.map((refused) => `  - ${refused}`));
  if (battle.losses.length > 0) {
    lines.push("What it cost:", ...battle.losses.map((loss) => `  - ${loss.name}: ${loss.unit === "ships" ? `${loss.dead} ships sunk or taken, ${loss.deserted} slipped away, ${loss.wounded} damaged and laid up` : `${loss.dead} dead, ${loss.deserted} deserted, ${loss.wounded} wounded`}`));
  }
  if (battle.commanders.length > 0) lines.push("The commanders:", ...battle.commanders.map((commander) => `  - ${commander.name} was ${commander.outcome}`));
  if ((battle.members ?? []).length > 0) {
    lines.push("Named men in the ranks:", ...(battle.members ?? []).map((member) =>
      `  - ${member.name}, with ${member.force}${member.place === undefined ? "" : ` (${member.place})`}: ${member.outcome === "unharmed" ? "came through unhurt" : member.outcome === "killed" ? "was killed" : member.outcome === "wounded" ? "was wounded" : member.outcome}`));
    // A man in the ranks sees his own line, not the battle.
    if ((battle.members ?? []).some((member) => member.place !== undefined)) {
      lines.push("Where a named man stood, write the fight as it reached him there -- his line, his unit, the men beside him -- as well as the battle as a whole.");
    }
  }
  if (battle.retreats.length > 0) {
    lines.push("Who left the field:", ...battle.retreats.map((retreat) => `  - ${retreat.name} fell back ${retreat.orderly ? "in order" : "in rout"}${retreat.to === null ? ", with nowhere to go" : ` to ${retreat.to}`}`));
  }
  return lines;
}

function renderThread(thread: Thread, index: number, said: readonly UtteranceLine[] = []): string {
  const lines = [`THREAD ${index + 1}${thread.reported ? " (news reaching the court; nobody here witnessed it)" : ""}`];
  if (thread.matter !== null) lines.push(`Part of a longer matter: ${thread.matter}.`);
  // Who is who, stated rather than inferred. A historian given "Furius" and
  // "the Mamertine spokesman" in one matter wrote of "Mamertine spokesman
  // Furius", two men made one; a line each keeps them apart.
  if (thread.people.length > 0) lines.push("The people in it -- each a different person:", ...thread.people.map((person) => `  - ${person}`));
  lines.push(
    thread.reported ? "Reported to have happened:" : "Known to have happened:",
    // Where it is known from, fact by fact: one witnessed fact used to make a
    // whole thread firsthand, and a spy's report read as the court's own
    // knowledge (C05, R43).
    ...thread.facts.map((fact) => `- ${fact.kind === "spy_report" ? "(an agent's report: say so, and that it may be wrong) " : !thread.reported && thread.hearsayIds.has(fact.id) ? "(word only, not witnessed) " : ""}${readable(fact.summary)}`),
  );
  if (thread.narrative.length > 0) lines.push("Accounts given at the time:", ...thread.narrative.map((line) => `- ${readable(line)}`));
  if (thread.frictions.length > 0) lines.push("Difficulties reported:", ...thread.frictions.map((line) => `- ${readable(line)}`));
  if (thread.battle !== null) lines.push(...renderBattle(thread.battle));
  // The part of the order this tells, as the world has it: the passage says
  // it, and says nothing that contradicts it.
  if (thread.outcome !== null) lines.push(`Where this part of the order stands (say it; never say more was done): ${thread.outcome.line}`);
  if (said.length > 0) lines.push("Words recorded at the time:", ...said.map((line) => `- ${line.speaker}, ${line.occasion}: ${line.line}`));
  // How to tell it, carried with the matter rather than added to the
  // historian's standing instructions: an order nobody obeyed is comedy, and
  // told in the register of a campaign it reads as one.
  if (thread.digest) {
    lines.push("Register: these are several small matters of the same days, gathered into one passage. Tell each in a sentence or two, in the order they happened; the headline names the chief of them.");
  }
  if (thread.facts.some((fact) => fact.kind === "order_ignored")) {
    lines.push("Register: somebody gave orders to people who did not have to take them. Tell it with a straight face and a dry wit; the joke is in the facts.");
  }
  return lines.join("\n");
}

export async function composeChronicle(input: ChronicleInput): Promise<ChronicleResult> {
  const threshold = input.entryThreshold ?? DEFAULT_ENTRY_THRESHOLD;
  // An unweighted fact cannot be ruled out: where no weight was recorded, the
  // bar is treated as met rather than as failed.
  const recorded = (fact: Fact): number => input.significanceByFactId?.get(fact.id) ?? threshold;
  // News bearing on the reader's own campaign is weighed up. A negotiation
  // over the city they march to relieve scored 55 as distant news and letters
  // 10-15 whatever their terms, and neither reached a consul whose legion was
  // on its way there. A diplomatic act in it counts as a matter of substance;
  // anything else in it gains a little.
  const campaign = input.campaignIds;
  const weightOf = (fact: Fact): number => {
    const base = recorded(fact);
    if (campaign === undefined || campaign.size === 0 || !fact.affectedEntities.some((entity) => campaign.has(entity.id))) return base;
    return DIPLOMATIC_ACT.test(`${fact.kind} ${fact.summary}`) ? Math.max(base, CAMPAIGN_DIPLOMACY_WEIGHT) : Math.min(100, base + CAMPAIGN_LIFT);
  };
  const selected = selectFacts(input.facts, input.observer, input.observerPolityId, input.ownEntityIds ?? null, input.to, weightOf, input.world, input.orderFactIds ?? new Set());
  if (selected.length === 0) {
    input.onSelected?.({ carried: [...input.facts], subjects: [] });
    return { entries: [], calls: 0, carried: [...input.facts] };
  }

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
  // Every fact it is an account of must be one the reader may know, and one of
  // them seen: a line bound to a visible fact and a hidden one carries the
  // hidden one with it (C04).
  const witnessed = (line: { readonly factIds: readonly string[] }): boolean =>
    line.factIds.length > 0
    && line.factIds.every((factId) => visibleFactIds.has(factId))
    && line.factIds.some((factId) => !reportedIds.has(factId));
  const firsthand = (line: { readonly actorRef: OrderPartyRef | null; readonly factIds: readonly string[] }): boolean =>
    witnessed(line) || (line.actorRef !== null && keyOf(line.actorRef) === observerKey);
  const narrative = input.narrative.filter(firsthand);
  const frictions = input.frictions.filter(firsthand);
  const utterances = (input.utterances ?? []).filter((line) => publishable(line) && witnessed(line));

  const matterOfFact = matterKeys(input.world);
  const grouped = splitIntoThreads(
    withoutEchoes(visible), input.observerPolityId, input.orderFactIds, projectRelations(input.world, input.observerPolityId),
    matterOfFact, input.observer.kind === "character" ? input.observer.id : null,
  );
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
  const personal = input.personalEntityIds ?? input.ownEntityIds;
  /**
   * The orchestrator's facts include the world's own weather beside the
   * order's answer. A grain shortage in a far province, counted as the
   * reader's own for riding in the order's burst, was gathered with a friction
   * line into a passage that told the Senate had voted before it had. Ambient
   * news that names none of the reader's side is news, not the order's answer.
   */
  const isAmbientElsewhere = (fact: Fact): boolean =>
    AMBIENT_KINDS.has(fact.kind)
    && fact.affectedEntities.length > 0
    && !fact.affectedEntities.some((entity) => ownKeys.has(keyOf(entity)) || (personal?.has(entity.id) ?? false));
  const isOurs = (facts: readonly Fact[]): boolean =>
    personal === undefined
    || facts.some((fact) =>
      ((input.orderFactIds?.has(fact.id) ?? false) && !isAmbientElsewhere(fact))
      || fact.affectedEntities.length === 0
      || fact.affectedEntities.some((entity) => ownKeys.has(keyOf(entity)) || personal.has(entity.id)));
  /**
   * Their own country's doings, which are not their own affairs.
   *
   * A consul's realm and a consul's business are the same thing, and
   * `personalEntityIds` says so for him. For a merchant they are not: the war
   * is not his to conduct and reaches him as news -- but news from his own city
   * reaches him more cheaply than news from Syracuse, which is why this band
   * sits between the two rather than being folded into either.
   */
  const isHome = (facts: readonly Fact[]): boolean =>
    input.ownEntityIds !== undefined
    && facts.some((fact) => fact.affectedEntities.some((entity) => input.ownEntityIds!.has(entity.id)));

  /** Where a part of an order stands, as the engine says it (`order-outcomes.ts`). */
  const outcomeOf = (partKey: string | null): Thread["outcome"] => (partKey === null ? null : input.orderOutcome?.(partKey) ?? null);
  const threadOf = (facts: readonly Fact[], digest = false): Thread => {
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
      peak: Math.max(...facts.map(weightOf)),
      mustTell: isOurs(facts) && facts.some((fact) => MUST_TELL.has(fact.kind)),
      ours: isOurs(facts),
      home: isHome(facts),
      // Witnessed only. A fight the court heard of at second hand is news of a
      // battle, not an account of one, and writing it up phase by phase would
      // give a rumour the authority of a dispatch.
      battle: (input.battleAccounts ?? []).find(
        (account) => account.factIds.some((factId) => ids.has(factId) && !reportedIds.has(factId)),
      ) ?? null,
      // The order's answer is what the order did, not everything the world did
      // in the same breath: the orchestrator's facts include the world's own
      // business beside the order's, and a landslip in the Apennines is not an
      // answer to "send ten galleys". A thread answers the order when it holds
      // an order fact and names the reader's side, or names nobody at all.
      answersTheOrder: facts.some((fact) => input.orderFactIds?.has(fact.id) ?? false)
        && facts.some((fact) => fact.affectedEntities.length === 0 || fact.affectedEntities.some((entity) => ownKeys.has(keyOf(entity)) || (personal?.has(entity.id) ?? false))),
      orderFacts: facts.filter((fact) => input.orderFactIds?.has(fact.id) ?? false).length,
      people: [...new Set(facts.flatMap((fact) => fact.affectedEntities.filter((entity) => entity.kind === "character").map((entity) => entity.id)))]
        .flatMap((id) => {
          const described = input.describePerson?.(id) ?? null;
          if (described === null) return [];
          // So the historian knows whose reign this is, and that they may be quoted.
          return [input.observer.kind === "character" && input.observer.id === id ? `${described} -- the one whose reign this history is` : described];
        })
        .slice(0, 8),
      digest,
      partKey: facts.map(matterOfFact).find((key): key is string => key !== null) ?? null,
      outcome: outcomeOf(facts.map(matterOfFact).find((key): key is string => key !== null) ?? null),
      hearsayIds: new Set(facts.filter((fact) => reportedIds.has(fact.id)).map((fact) => fact.id)),
    };
  };
  const unfolded = grouped.map((facts) => threadOf(facts));

  /**
   * The reign's small business, told where it belongs.
   *
   * Every thread used to get its own headline, and a matter the reader's side
   * was named in was told whatever it weighed, so the record filled with
   * entries of one sentence: an order's side-effects, a candidate's
   * nomination, a survey begun. Two folds instead, both only of what is
   * slight -- never a battle, never what must be told, never anything heavy
   * enough for a headline of its own:
   *
   * - what the order did, beyond its main answer, joins the answer: it is the
   *   same order, and one passage tells it;
   * - the rest of the reign's small matters in the same window are gathered
   *   into one passage of the month's business, rather than each told alone.
   *
   * What is lighter than `OWN_BUSINESS_FLOOR` is not gathered: it waits, as
   * before, for the matter it belongs to.
   */
  const slight = (thread: Thread): boolean => thread.battle === null && !thread.mustTell && thread.peak < OWN_HEADLINE_FLOOR;
  const byTime = (a: Fact, b: Fact): number => sortKeyOf(a.time) - sortKeyOf(b.time);
  const answerAmong = (threads: readonly Thread[]): Thread | null =>
    threads.filter((thread) => thread.answersTheOrder).reduce<Thread | null>((best, thread) => (best === null || thread.orderFacts > best.orderFacts ? thread : best), null);
  const lead = answerAmong(unfolded);
  // Stages of one part of the order join its answer; another part of the same
  // order is its own passage, however slight (C02).
  const samePart = (thread: Thread): boolean => thread.partKey === null || thread.partKey === lead?.partKey;
  const toOrder = lead === null ? [] : unfolded.filter((thread) => thread !== lead && thread.ours && thread.orderFacts > 0 && slight(thread) && samePart(thread));
  const answered = lead === null || toOrder.length === 0 ? lead : threadOf([...lead.facts, ...toOrder.flatMap((thread) => thread.facts)].sort(byTime));
  const afterOrder = [...(answered === null ? [] : [answered]), ...unfolded.filter((thread) => thread !== lead && !toOrder.includes(thread))];
  const small = afterOrder.filter((thread) => thread !== answered && thread.ours && slight(thread) && thread.peak >= OWN_BUSINESS_FLOOR && thread.partKey === null);
  const built: Thread[] = small.length < 2
    ? afterOrder
    : [...afterOrder.filter((thread) => !small.includes(thread)), threadOf(small.flatMap((thread) => thread.facts).sort(byTime), true)];

  /**
   * How far off a thread happened, in days by road from the nearest place the
   * reader hears things: where they stand, their power's seat, the ground it
   * holds. Null when that cannot be told -- no world, or a matter that happened
   * nowhere in particular -- and then no distance applies.
   */
  const world = input.world;
  const seats = world === undefined ? [] : [...new Set([
    whereTheyHear(world, input.observer),
    ...(input.observerPolityId === null ? [] : [
      whereTheyHear(world, { kind: "polity", id: input.observerPolityId }),
      ...world.map.provinces.filter((province) => province.controllerPolityId === input.observerPolityId).map((province) => province.id),
    ]),
  ].filter((seat): seat is string => seat !== null))];
  const daysOff = (thread: Thread): number | null => {
    if (world === undefined || seats.length === 0) return null;
    const places = [...new Set(thread.facts.flatMap((fact) => whereItHappened(world, fact)))];
    if (places.length === 0) return null;
    // The road measures nothing between places it does not join: those are far.
    const road = (from: string, to: string): number => (from === to ? 0 : newsDaysBetween(world, from, to) || MAX_NEWS_DAYS);
    return Math.min(...places.flatMap((place) => seats.map((seat) => road(place, seat))));
  };
  /** Whether the wider world's matter is weighty enough for how far off it happened. */
  const carriesThisFar = (thread: Thread): boolean => {
    // Distance does not discount the reader's own campaign.
    if (input.campaignIds !== undefined && thread.facts.some((fact) => fact.affectedEntities.some((entity) => input.campaignIds!.has(entity.id)))) return true;
    const days = daysOff(thread);
    if (days === null || days <= NEAR_NEWS_DAYS) return true;
    const share = Math.min(1, (days - NEAR_NEWS_DAYS) / (FAR_NEWS_DAYS - NEAR_NEWS_DAYS));
    return thread.peak >= threshold + (FAR_NEWS_WEIGHT - threshold) * share;
  };

  const byWeight = (a: Thread, b: Thread): number =>
    b.weight - a.weight || sortKeyOf(a.facts[0]!.time) - sortKeyOf(b.facts[0]!.time) || a.facts[0]!.id.localeCompare(b.facts[0]!.id);

  /**
   * The same people, doing the same thing, again.
   *
   * Two signals have to agree, because either alone is wrong.
   *
   * **The same people and powers.** Measured on those, not on every subject:
   * a matter's actors are stable while the forces and provinces it happens to
   * name drift by one from report to report, and a subject-set comparison let
   * "Manius Curius Dentatus Renews His Petition" through twice running for
   * want of a single id. A thread naming neither is compared on everything it
   * names instead.
   *
   * **And nothing moved.** `diffWorlds` already says what actually changed --
   * ground taken, an army raised or marched or bled, somebody dead. A thread
   * carrying one of those is news however familiar its cast; a siege that is
   * merely still going is not. This is the conjunct that keeps the rule from
   * silencing a matter that is genuinely developing.
   *
   * Never applied to the reader's own business, and never to a battle. A ruler
   * is entitled to the whole of his own reign however slowly it goes, and an
   * order must always be answered -- suppressing a repeat there would break
   * the one guarantee the Chronicle makes.
   */
  const alreadyTold = (input.recentSubjects ?? []).map((subjects) => new Set(subjects));
  const everyoneTold = new Set(alreadyTold.flatMap((told) => [...told]));
  const movedIds = new Set((input.changes ?? []).filter((change) => change.routine !== true).map((change) => change.id));
  const echoing = (thread: Thread): boolean => {
    if (thread.battle !== null || alreadyTold.length === 0) return false;
    const subjects = subjectsOf(thread.facts);
    if (subjects.length === 0) return false;
    // A decision is news though nobody moved: a new offer, undertaking or
    // refusal between the same few people is a new turn of the matter, not
    // the old one going on.
    if (thread.peak >= 50 && thread.facts.some((fact) => DIPLOMATIC_ACT.test(`${fact.kind} ${fact.summary}`))) return false;
    // Something in it actually moved, so it happened.
    if (thread.facts.some((fact) => fact.affectedEntities.some((entity) => movedIds.has(entity.id)))) return false;

    // The actors, not the scenery: a matter's people and powers are what
    // identify it, while the forces and provinces it happens to name drift by
    // one from report to report. A new power in it is a new matter.
    const actors = subjects.filter((subject) => subject.kind === "character" || subject.kind === "polity");
    const identifying = actors.length > 0 ? actors : subjects;
    return identifying.every((subject) => everyoneTold.has(keyOf(subject)));
  };

  const ours = built.filter((thread) => thread.ours).sort(byWeight);
  const home = built.filter((thread) => !thread.ours && thread.home && !thread.reported && thread.weight >= HOME_THRESHOLD && !echoing(thread)).sort(byWeight);
  const seen = built.filter((thread) => !thread.ours && !thread.home && !thread.reported && thread.weight >= threshold && carriesThisFar(thread) && !echoing(thread)).sort(byWeight);
  const hearsay = built.filter((thread) => !thread.ours && thread.reported && thread.weight >= threshold && carriesThisFar(thread) && !echoing(thread)).sort(byWeight);

  const banded = [...ours, ...home.slice(0, MAX_HOME_THREADS), ...seen.slice(0, MAX_SEEN_THREADS), ...hearsay.slice(0, MAX_REPORTED_THREADS)];
  // The answer to the order and any battle are never cut: the cap is for the
  // world's business, and neither of those is the world's. The rest fill what
  // room is left, by band and then by weight; the reader's own business among
  // them has to weigh something (`OWN_BUSINESS_FLOOR`), since a record written
  // window by window would otherwise carry every small thing the moment it
  // happened. What is cut is not lost: it is carried into the next window.
  const maxEntries = input.maxEntries ?? MAX_ENTRIES;
  // One thread is the answer: the one holding most of the order's facts. The
  // orchestrator writes the world's own doings beside the order's, and they
  // name the reader's power as readily as the order does, so "holds an order
  // fact" alone made a harvest in Picenum an answer to "send ten galleys".
  // The rest of the order's matters compete on weight like anything else, and
  // are carried into the next window when cut.
  const chosen = answerAmong(banded);
  // Every other part of the order is answered too, and none is cut for room.
  const otherParts = banded.filter((thread) => thread !== chosen && thread.answersTheOrder && thread.partKey !== null && thread.partKey !== chosen?.partKey);
  const answer = chosen === null ? otherParts : [chosen, ...otherParts];
  const fights = banded.filter((thread) => !answer.includes(thread) && (thread.battle !== null || thread.mustTell));
  // The floor is met by one thing worth telling, never by a heap of small ones:
  // three "reviewed the legion's readiness" of ten each were a told entry.
  const rest = banded.filter((thread) => !answer.includes(thread) && !fights.includes(thread) && (!thread.ours || thread.peak >= OWN_BUSINESS_FLOOR));
  let threads = [...answer, ...fights, ...rest.slice(0, Math.max(0, maxEntries - answer.length - fights.length))];
  // A record that goes blank teaches the reader to stop opening it. This fires
  // only when the bands would have produced nothing at all, which is a
  // different thing from the weight floor that was tried and reverted -- that
  // one fired on every report and drowned the record in routine.
  //
  // It will not, however, put back a thread the bands held for being a repeat.
  // A report whose only candidate is the same people doing the same thing is
  // better blank: the floor exists so a reader is not met with nothing when
  // something happened, not so they are met with the same thing twice.
  if (threads.length === 0 && (input.fallback ?? true)) {
    const worthTelling = built.filter((thread) => !echoing(thread)).sort(byWeight);
    if (worthTelling.length > 0) threads = [worthTelling[0]!];
  }
  if (threads.length === 0) {
    input.onSelected?.({ carried: [...input.facts], subjects: [] });
    return { entries: [], calls: 0, carried: [...input.facts] };
  }
  // In the order the reader could have come to know them, never in the order
  // of weight: the record reads forward in time, and a fact that reached the
  // court on the twentieth is told on the twentieth however early it happened.
  // The order's own answer is dated the day it was given, and so comes first
  // without being put first.
  const knowableKey = (fact: Fact): number =>
    newsArrivesAt(input.orderFactIds?.has(fact.id) === true ? undefined : input.world, fact, input.observer);
  const firstKnowable = (thread: Thread): number => Math.min(...thread.facts.map(knowableKey));
  threads.sort((a, b) => firstKnowable(a) - firstKnowable(b) || a.facts[0]!.id.localeCompare(b.facts[0]!.id));
  const toldIds = new Set(threads.flatMap((thread) => thread.facts.map((fact) => fact.id)));
  const carried = input.facts.filter((fact) => !toldIds.has(fact.id));
  input.onSelected?.({ carried, subjects: threads.map((thread) => [...new Set(thread.facts.flatMap((fact) => fact.affectedEntities.map(keyOf)))]) });

  const period = `${formatWorldDate(input.from, input.clock)} – ${formatWorldDate(input.to, input.clock)}`;
  const alreadySaid = (input.recentTitles ?? []).slice(0, 16);
  // Everything the historian is told before the matter itself. Repeated into
  // each call below: the titles are from earlier reports, not from this one,
  // so every passage needs them equally.
  const head = [
    `Period: ${period}.`,
    ...(alreadySaid.length === 0 ? [] : [
      [
        "WHAT THE LAST REPORT ALREADY SAID:",
        ...alreadySaid.map((title) => `  - ${title}`),
        "",
        "Do not write any of these again. A matter that has only gone on is not",
        "news: if a thread below says the same thing one of those said, leave it",
        "out entirely rather than rephrasing it. Write it only when something in",
        "it has actually changed -- ground taken, a man dead, a decision made,",
        "an army broken -- and then write the change, not the situation.",
        "They are listed only so they are not repeated: never bring one of them",
        "into a passage whose own facts do not name it.",
      ].join("\n"),
    ]),
  ];

  const changes = input.changes ?? [];
  /**
   * The provinces that changed hands this window: what a power's count of
   * provinces is about, so an entry that tells one of them may show it.
   */
  const handsChanged = new Set(changes.filter((change) => change.kind === "province").map((change) => change.id));
  /**
   * Whether this entry's own facts made this change.
   *
   * A change the entry's facts do not name is a change the reader was never
   * told about, which is what keeps the change list from being the leak the
   * prose is so carefully prevented from being. But naming was not enough on
   * its own: the treasury is Rome's, and every entry naming Rome carried the
   * month's taxes. So a change with a recorded cause goes to the entry whose
   * facts name that cause -- the project, the force, the procedure -- or,
   * where the cause is a handle no fact names (a battle, a pay obligation), to
   * the entry that names the thing itself on the day it moved. The world's
   * routine goes to nobody. And the reader's own power, which every entry of
   * his names, claims a change only for the answer to his order, or for a
   * province this entry tells changing hands.
   */
  const madeBy = (change: WorldChange, thread: Thread): boolean => {
    if (change.routine === true) return false;
    const named = new Set(thread.facts.flatMap((fact) => fact.affectedEntities.map((entity) => entity.id)));
    const hub = input.observerPolityId;
    const namesIt = [change.id, ...(change.claimedBy ?? [])].some((id) =>
      named.has(id)
      && (id !== hub || answer.includes(thread) || (change.kind === "polity" && [...handsChanged].some((provinceId) => named.has(provinceId)))));
    const causes = change.causes ?? [];
    if (causes.length === 0) return namesIt;
    const handles = new Set([
      ...named,
      ...thread.facts.flatMap((fact) => [fact.id, fact.sourceActionId, fact.sourceEventId].filter((id): id is string => id !== null)),
    ]);
    if (causes.some((cause) => handles.has(cause.id))) return true;
    const days = new Set(thread.facts.flatMap((fact) => [fact.time.day, fact.atStep]));
    return namesIt && causes.some((cause) => days.has(cause.day));
  };
  const entryOf = (thread: Thread, title: string, body: string): ChronicleEntry => {
    const keys = thread.facts.map((fact) => sortKeyOf(fact.time));
    const subjects = subjectsOf(thread.facts);
    return {
      kind: "narrated",
      title,
      body,
      factIds: thread.facts.map((fact) => fact.id),
      subjects,
      tags: tagsOf(thread.facts, thread.battle, weightOf, input.observerPolityId, (ref) => input.nameOf?.(ref) ?? null),
      changes: changes.filter((change) => madeBy(change, thread)),
      quote: null,
      storylineIds: mattersOf(thread.facts, input.storylines ?? [], input.observer, input.observerPolityId, polityOf).map((storyline) => storyline.id),
      fromInstantSortKey: Math.min(...keys, sortKeyOf(input.to)),
      toInstantSortKey: Math.max(...keys, sortKeyOf(input.from)),
    };
  };

  /**
   * A passage that says a part was done when the world says it was not is
   * not published as written: the engine's line and the plain facts stand in
   * its place, so the record never holds both accounts (E05).
   */
  const faithful = (thread: Thread, body: string): string => {
    if (thread.outcome === null || !claimsItDone(body, thread.outcome.status)) return body;
    return [thread.outcome.line, ...thread.facts.map((fact) => readable(fact.summary))].join("\n\n");
  };

  // A failed narration must not cost the player the record itself: fall back to
  // the plain facts, under the period as a title, rather than losing the span.
  const plainly = (thread: Thread): ChronicleEntry =>
    entryOf(thread, headlineOf(thread.facts) ?? period, thread.facts.map((fact) => readable(fact.summary)).join("\n\n"));

  // One matter to a call, and every matter written, the light ones too. A
  // light home thread was once printed in its facts' own words to save its
  // call, and read as a ledger -- "Grain is dearer in Latium" under a headline
  // of the same words. The Chronicle is the part of the game that is read.
  //
  // The selection above -- what is visible, what belongs with what, what
  // weighs enough to tell -- stays a single pass over the whole burst, because
  // every one of those judgements is made across the finished record: threads
  // are unioned over all the facts at once, a thread's weight is the sum of
  // its own, and what the reader knows is settled as of one instant. Only the
  // *writing* is split, and a passage was already required to be written from
  // its own thread and nothing else ("Keep the threads apart"), so a call that
  // holds one thread is being asked for exactly what it was always asked for.
  //
  // What this buys is wall time. One call generating every passage end to end
  // takes as long as the whole report; three at a time take as long as the
  // longest of them. Three because each call holds a coin hold, and the
  // database pool is three connections wide.
  //
  // It also makes a failure local: a thread whose narration cannot be read
  // falls back to its own plain facts, where before one unreadable answer
  // dropped the entire report to plain facts.
  // The one quotation this report may print is decided before the writing,
  // on the threads themselves, so a passage can be handed out the moment it
  // is written rather than held until every passage is in and compared.
  const quoted = chooseQuote(threads, utterances);
  // Every line somebody is recorded saying in this report, by whom: a line the
  // historian puts in one man's mouth that another man said is not a quotation.
  // Cursor's "a fleet built by measure is better than a strait left open"
  // came back as Dentatus's "a measured fleet serves Rome better than an open
  // strait", under a passage about the Anio waterworks.
  const spokenLines: readonly { speaker: string; line: string }[] = [
    ...utterances.map((utterance) => ({ speaker: utterance.speaker, line: utterance.line })),
    ...threads.flatMap((thread) => thread.facts.flatMap((fact) => {
      const speaker = fact.affectedEntities.find((entity) => entity.kind === "character");
      const name = speaker === undefined ? null : input.nameOf?.(speaker) ?? null;
      return name === null ? [] : [...fact.summary.matchAll(/"([^"]{12,})"/gu)].map((match) => ({ speaker: name, line: match[1]! }));
    })),
  ];
  const saidIn = (thread: Thread): UtteranceLine[] => {
    const ids = new Set(thread.facts.map((fact) => fact.id));
    return utterances.filter((utterance) => utterance.factIds.some((factId) => ids.has(factId))).slice(0, 4);
  };
  /** What each person is recorded saying in this matter: speeches and letters bound to its facts, and words quoted in the facts themselves. */
  const linesOf = (thread: Thread): { speaker: string; line: string }[] => {
    const ids = new Set(thread.facts.map((fact) => fact.id));
    return [
      ...saidIn(thread).map((utterance) => ({ speaker: utterance.speaker, line: utterance.line })),
      ...spokenLines.filter((said) => thread.facts.some((fact) => ids.has(fact.id) && fact.summary.includes(said.line))),
    ];
  };
  /** Who may be quoted in a passage: the people in its facts, and anyone recorded speaking in it. */
  const speakersIn = (thread: Thread): Set<string> => new Set([
    ...thread.facts.flatMap((fact) => fact.affectedEntities.filter((entity) => entity.kind === "character").map((entity) => input.nameOf?.(entity) ?? null)),
    ...saidIn(thread).map((utterance) => utterance.speaker),
  ].filter((name): name is string => name !== null));
  const results: (ChronicleEntry | null | undefined)[] = threads.map(() => undefined);
  let quotesGiven = 0;
  let handedOut = 0;
  let handing: Promise<void> = Promise.resolve();
  const handOut = (): void => {
    // Everything written up to the first gap, in order, once.
    while (handedOut < results.length && results[handedOut] !== undefined) {
      let entry = results[handedOut];
      // A report where everybody says something memorable is one where nobody
      // does: the first few, in the order they are read.
      if (entry !== null && entry !== undefined && entry.quote !== null) {
        if (quotesGiven >= MAX_QUOTES_PER_REPORT) {
          entry = { ...entry, quote: null };
          results[handedOut] = entry;
        } else quotesGiven += 1;
      }
      handedOut += 1;
      if (entry !== null && entry !== undefined && input.onEntry !== undefined) {
        const give = input.onEntry;
        handing = handing.then(() => give(entry)).catch(() => undefined);
      }
    }
  };
  await mapWithLimit(threads, CHRONICLE_CONCURRENCY, async (thread, index): Promise<void> => {
    // The answer to the order is news by definition: the player gave it this
    // turn. Shown the last report's titles, the historian judged "Clepsina
    // kept Legio I before Messana" the same thing again and declined it, and
    // with it went the merchants he could not hire and the Legio II he could
    // not merge -- the order left no trace at all.
    const answering = answer.includes(thread) || thread.mustTell;
    const userMessage = [...(answering ? head.slice(0, 1) : head), "", renderThread(thread, 0, saidIn(thread))].join("\n\n");
    let entry: ChronicleEntry | null;
    try {
      const raw = await input.port.complete("compose_chronicle", CHRONICLE_SYSTEM_PROMPT, userMessage);
      const parsed = ChronicleOutputSchema.safeParse(extractJson(raw));
      if (!parsed.success) entry = plainly(thread);
      else {
        const passage = parsed.data.entries.find((candidate) => candidate.thread === 1);
        // An answer that parsed and holds no passage is the historian declining
        // -- told what the last report said, she judged this the same thing.
        // That is a decision, not a failure, and the record honours it: the
        // thread is dropped, not printed as bare facts under a period title.
        entry = passage === undefined
          ? (answering ? plainly(thread) : null)
          : entryOf(thread, passage.title, faithful(thread, passage.body.trim()));
        const own = passage?.quote ?? null;
        // A quotation is somebody's recorded words, or it is not printed. The
        // historian's own line is kept only where it is, near enough, what that
        // same man is recorded saying in this matter -- and then the record's
        // words are printed, not hers. "You are a traitor" was written for a
        // man on record promising the opposite (R24).
        const recorded = own === null || !speakersIn(thread).has(own.speaker) || borrowedLine(own, spokenLines)
          ? null
          : recordedLine(own, linesOf(thread));
        if (entry !== null && own !== null && recorded !== null) {
          entry = { ...entry, quote: { line: recorded, speaker: own.speaker, occasion: own.occasion } };
        }
      }
    } catch {
      entry = plainly(thread);
    }
    // Words somebody actually said, where the historian gave none of her own.
    if (entry !== null && entry.quote === null && quoted !== null && quoted.index === index) {
      entry = { ...entry, quote: { line: quoted.utterance.line, speaker: quoted.utterance.speaker, occasion: quoted.utterance.occasion } };
    }
    results[index] = entry;
    handOut();
  });
  await handing;

  return { entries: results.flatMap((entry) => (entry === null || entry === undefined ? [] : [entry])), calls: threads.length, carried };
}

/**
 * How many passages are written at once. See the note above.
 *
 * Six rather than three: a ten-thread report was four waves of three and is
 * now two of six. The old number was not chosen for the historian's sake, it
 * was the database pool, which has since been widened.
 */
const CHRONICLE_CONCURRENCY = 6;

/** How many passages of one report may carry a quotation. */
const MAX_QUOTES_PER_REPORT = 3;

/** The record adds the quotation marks; a line that brought its own loses them. */
/** Words to compare lines by: lower case, stems of five letters, the small words left out. */
function stemsOf(line: string): Set<string> {
  return new Set(line.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 3).map((word) => word.slice(0, 5)));
}

/** The historian's line is one somebody else was recorded saying, more or less. */
function borrowedLine(quote: { speaker: string; line: string }, spoken: readonly { speaker: string; line: string }[]): boolean {
  const mine = stemsOf(quote.line);
  if (mine.size < 3) return false;
  return spoken.some((said) => {
    if (said.speaker === quote.speaker) return false;
    const theirs = stemsOf(said.line);
    const shared = [...mine].filter((stem) => theirs.has(stem)).length;
    return shared / new Set([...mine, ...theirs]).size >= 0.4;
  });
}

/**
 * The recorded words a historian's quotation stands for: the same speaker's
 * line in the matter that shares most of its words, or that holds it whole.
 * Null when he is recorded saying nothing like it.
 */
function recordedLine(quote: { speaker: string; line: string }, recorded: readonly { speaker: string; line: string }[]): string | null {
  const wanted = unquoted(quote.line);
  const mine = stemsOf(wanted);
  let best: { line: string; score: number } | null = null;
  for (const said of recorded) {
    if (said.speaker !== quote.speaker) continue;
    if (said.line.toLowerCase().includes(wanted.toLowerCase())) return unquoted(said.line);
    const theirs = stemsOf(said.line);
    if (mine.size === 0 || theirs.size === 0) continue;
    const score = [...mine].filter((stem) => theirs.has(stem)).length / new Set([...mine, ...theirs]).size;
    if (best === null || score > best.score) best = { line: unquoted(said.line), score };
  }
  return best !== null && best.score >= RECORDED_QUOTE_OVERLAP ? best.line : null;
}

/** How much of a quotation's wording must be the speaker's own recorded words. */
const RECORDED_QUOTE_OVERLAP = 0.6;

function unquoted(line: string): string {
  return line.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();
}

/**
 * Runs `work` over `items`, at most `limit` at a time, answering in input order.
 *
 * Ordering is the point as much as the limit is: the entries come back in the
 * order the bands put the threads in, whatever order the provider answered in.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await work(items[index]!, index);
      }
    }),
  );
  return results;
}

/**
 * At most one quotation per report, on the matter that earned it.
 *
 * Decided on the threads before any passage is written, so a passage can be
 * handed out the moment it exists. Each thread is judged on its own facts
 * rather than looked up by position, so a declined passage cannot shift the
 * quotation onto somebody else's matter.
 */
function chooseQuote(threads: readonly Thread[], utterances: readonly UtteranceLine[]): { readonly index: number; readonly utterance: UtteranceLine } | null {
  if (utterances.length === 0 || threads.length === 0) return null;
  let best: { index: number; weight: number; utterance: UtteranceLine } | null = null;
  threads.forEach((thread, index) => {
    const ids = new Set(thread.facts.map((fact) => fact.id));
    const spoken = utterances
      .filter((utterance) => utterance.factIds.some((factId) => ids.has(factId)))
      .sort((a, b) => a.actorRef.id.localeCompare(b.actorRef.id))[0];
    if (spoken === undefined) return;
    if (best === null || thread.weight > best.weight) best = { index, weight: thread.weight, utterance: spoken };
  });
  return best;
}

/**
 * How the historian is told who a person is: a name, what they are, whose
 * they are and where. Built from the world the report describes.
 */
export function whoIsWho(world: WorldState, offices: readonly Office[] = []): (characterId: string) => string | null {
  const known = allOffices(world, offices);
  return (characterId) => {
    const person = world.characters.find((character) => character.id === characterId);
    if (person === undefined) return null;
    const office = person.officeId === null ? null : known.find((candidate) => candidate.id === person.officeId)?.label ?? null;
    const polity = person.polityId === null ? null : world.map.polities.find((candidate) => candidate.id === person.polityId)?.name ?? null;
    const where = world.map.provinces.find((province) => province.id === person.locationProvinceId)?.name ?? null;
    return [person.name, office, polity === null ? null : `of ${polity}`, where === null ? null : `in ${where}`].filter((part) => part !== null).join(", ");
  };
}

/**
 * What a subject is called, so a tag reads "Roman Senate" rather than
 * "institution-62af32f4-4cf3-417e-9b0f-f67345bbce84".
 *
 * The Chronicle works in refs because refs are what facts carry and what the
 * record is searched by. Names live in the world, and every caller that hands
 * the composer a world needs the same lookup, so it lives beside the composer.
 */
export function nameOfSubject(world: WorldState, ref: OrderPartyRef): string | null {
  switch (ref.kind) {
    case "polity": return world.map.polities.find((polity) => polity.id === ref.id)?.name ?? null;
    case "province": return world.map.provinces.find((province) => province.id === ref.id)?.name ?? null;
    case "character": return world.characters.find((character) => character.id === ref.id)?.name ?? null;
    case "force": return world.material.forces.find((force) => force.id === ref.id)?.name ?? null;
    case "institution": return world.material.institutions.find((institution) => institution.id === ref.id)?.name ?? null;
    default: return null;
  }
}

/**
 * Everything the reader's own side answers for.
 *
 * The Chronicle's middle tier turns on it: a secret touching any of this stays
 * dark, because a plot against the ruler is not colour, while a secret touching
 * none of it may reach them as distant news. Read from the world after the
 * burst, so a province taken this very span counts as theirs.
 */
export function ownSideOf(world: WorldState, characterId: string, polityId: string | null): Set<string> {
  const own = new Set<string>([characterId]);
  if (polityId === null) return own;
  own.add(polityId);
  for (const character of world.characters) if (character.polityId === polityId) own.add(character.id);
  for (const province of world.map.provinces) if (province.controllerPolityId === polityId) own.add(province.id);
  for (const force of world.material.forces) if (force.polityId === polityId) own.add(force.id);
  return own;
}

/**
 * What the reader's present campaign is about: the powers their side is at
 * war with and those powers' people, and the ground, armies and cities their
 * open orders aim at. News touching any of it bears on what they have set
 * going, and is judged by a lower bar than the world's other business.
 */
export function campaignOf(world: WorldState, characterId: string, polityId: string | null): Set<string> {
  const ids = new Set<string>();
  const enemies = polityId === null ? [] : warsOf(world.polityAgreements, polityId);
  for (const enemy of enemies) {
    ids.add(enemy);
    for (const character of world.characters) if (character.polityId === enemy) ids.add(character.id);
  }
  for (const order of world.orders) {
    if (order.actorCharacterId !== characterId) continue;
    for (const part of order.parts) {
      if (part.closedAtStep !== null) continue;
      for (const goal of part.goals) {
        if (goal.kind === "force_at") { ids.add(goal.forceId); ids.add(goal.provinceId); }
        else if (goal.kind === "control") { ids.add(goal.provinceId); ids.add(goal.polityId); if (goal.settlementId !== null) ids.add(goal.settlementId); }
        else if (goal.kind === "force_strength") ids.add(goal.forceId);
        else if (goal.kind === "agreement_open") { ids.add(goal.polityId); ids.add(goal.withPolityId); }
      }
    }
  }
  if (polityId !== null) ids.delete(polityId);
  return ids;
}

/**
 * What the reader personally touches, as against what their government does.
 *
 * A consul's realm and a consul's business are the same thing, so somebody with
 * standing over their whole power gets the polity-wide set unchanged and their
 * record reads exactly as it did. For everybody else it is their money, their
 * people, their ground and the matters they are party to -- their country's
 * doings still reach them, as news competing on weight like anything else.
 */
export function personallyTouchedBy(world: WorldState, characterId: string, polityId: string | null, offices: readonly Office[]): Set<string> {
  const station = buildStation({ world, characterId, offices });
  if (holdsPolityStanding(station)) return ownSideOf(world, characterId, polityId);
  return new Set<string>([
    characterId,
    ...station.accountIds,
    ...station.forceIds,
    ...station.provinceIds,
    ...station.institutionIds,
    ...station.procedureIds,
    ...station.holdingIds,
    ...station.knownCharacterIds,
    ...station.storylineIds,
  ]);
}
