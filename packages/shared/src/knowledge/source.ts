import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * How the viewer knows a thing, and how long ago they learned it.
 *
 * Every note ends with a line saying where its contents came from: "From his
 * letter of 20 Feb, and talk in the forum." That line also guards against
 * leaks, and the player can see it doing so. A note is built only from what
 * has a source, so a line with no source is a line that was never sent.
 *
 * These are the engine's own records under plain names. A letter
 * (`world.diplomacy`), a belief with its channel (`characterBeliefs`), a fact's
 * discovery (`discoveredBy[].via`), standing in the same place, and the public
 * rolls of office. Nothing here is invented to fill a gap.
 */

export type SourceChannel =
  /** Standing in the same place. */
  | "own_eyes"
  /** It is yours: your own muster roll, your own books. */
  | "roll"
  /** You have dealt with them: relations, orders, promises. */
  | "dealings"
  | "letter"
  /** A report, a dispatch, someone who was there and told you. */
  | "report"
  | "rumour"
  /** Proclaimed, or public by nature. */
  | "public"
  /** Who holds what office: the rolls anyone can read. */
  | "record";

export interface Source {
  readonly channel: SourceChannel;
  /** Whose letter, whose report. Null when the channel names itself. */
  readonly fromLabel: string | null;
  readonly asOfStep: number;
}

/** What the viewer's knowledge is about, which decides how fast it goes stale. */
export type StaleSubject = "field" | "person" | "place" | "power" | "office";

export type Freshness = "fresh" | "aging" | "stale";

/**
 * Days after which knowledge ages, then goes stale. An army in the field has
 * marched on within a week or two. A man's office holds for a year.
 */
const THRESHOLDS: Readonly<Record<StaleSubject, readonly [aging: number, stale: number]>> = {
  field: [7, 30],
  place: [30, 120],
  person: [60, 365],
  power: [60, 180],
  office: [120, 365],
};

/** Knowledge that is always current. The rolls, and your own eyes. */
const ALWAYS_FRESH: ReadonlySet<SourceChannel> = new Set(["own_eyes", "roll", "record"]);

export function freshness(asOfStep: number, nowStep: number, subject: StaleSubject): Freshness {
  const age = Math.max(0, nowStep - asOfStep);
  const [aging, stale] = THRESHOLDS[subject];
  return age > stale ? "stale" : age > aging ? "aging" : "fresh";
}

export interface SourceReading {
  /** "From Hieron's letter, and talk you have heard." */
  readonly text: string;
  /** The date of the newest source, when it is worth saying: only once it is not fresh. */
  readonly asOfLabel: string | null;
  readonly freshness: Freshness;
}

const PHRASE: Readonly<Record<SourceChannel, (from: string | null) => string>> = {
  own_eyes: () => "your own eyes",
  roll: () => "your own muster roll",
  dealings: () => "your own dealings",
  letter: (from) => (from === null ? "a letter" : `${from}'s letter`),
  report: (from) => (from === null ? "a report" : `${from}'s report`),
  rumour: () => "talk you have heard",
  public: () => "what everyone knows",
  record: () => "the rolls of office",
};

/** The channels in the order a reader weighs them: the surest first. */
const ORDER: readonly SourceChannel[] = ["roll", "own_eyes", "dealings", "record", "letter", "report", "public", "rumour"];

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Where the viewer's knowledge came from, as a line of prose.
 *
 * Several sources of one channel are one phrase: two letters are "letters",
 * not a list. At most three phrases. A note that needs more is being read as
 * a dossier, and the dossier is the sheet.
 */
export function sourceLine(
  sources: readonly Source[],
  nowStep: number,
  subject: StaleSubject,
  clock: ScenarioClock | undefined,
): SourceReading | null {
  if (sources.length === 0) return null;
  const byChannel = new Map<SourceChannel, Source[]>();
  for (const source of sources) byChannel.set(source.channel, [...(byChannel.get(source.channel) ?? []), source]);

  const phrases: string[] = [];
  for (const channel of ORDER) {
    const group = byChannel.get(channel);
    if (group === undefined) continue;
    const froms = [...new Set(group.map((source) => source.fromLabel).filter((from): from is string => from !== null))];
    const phrase = channel === "letter" && group.length > 1
      ? froms.length === 1 ? `${froms[0]}'s letters` : "letters"
      : channel === "report" && group.length > 1
        ? "reports"
        : PHRASE[channel](froms.length === 1 ? froms[0]! : null);
    phrases.push(phrase);
    if (phrases.length === 3) break;
  }
  const joined = phrases.length === 1 ? phrases[0]! : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  const text = phrases.length === 1 && phrases[0] === PHRASE.own_eyes(null) ? "Seen with your own eyes." : `From ${joined}.`;

  const current = sources.some((source) => ALWAYS_FRESH.has(source.channel));
  const newest = Math.max(...sources.map((source) => source.asOfStep));
  const fresh: Freshness = current ? "fresh" : freshness(newest, nowStep, subject);
  const asOfLabel = fresh === "fresh" ? null : clock === undefined ? `day ${newest}` : formatWorldDate({ day: newest, minute: 0 }, clock);
  return { text: fresh === "stale" ? `${capitalise(text.replace(/\.$/, ""))}, as of ${asOfLabel}; it may have changed.` : text, asOfLabel, freshness: fresh };
}
