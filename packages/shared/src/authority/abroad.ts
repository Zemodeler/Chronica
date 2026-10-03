import { buildStation, holdsPolityStanding } from "./station";
import { lettersAwaitingYou } from "./letters-awaiting";
import { agreementIsOpen, knowsAgreement, NEVER_SECRET_AGREEMENTS, treatyViewer } from "./treaty-knowledge";
import type { Office } from "../characters/character";
import {
  AGREEMENT_KIND_EXPLAINED,
  AGREEMENT_KIND_IN_WORDS,
  alliesLedBy,
  leaderOf,
  type PolityAgreement,
  type PolityAgreementKind,
} from "../world/agreements";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * Where a power stands with every other, as one of its people could know it.
 *
 * Read by power, not by record. The sheet this replaces listed each agreement
 * as a line and the government's regard as a second list, so a consul read
 * "Foedus with the Umbrians" eight times over, found the Samnites in two
 * places, and could not tell from "tributary arrangement with Carthage"
 * which of the two paid. Here each power is one entry: where you stand with
 * it, what is in force, what came before, what it has written that waits on
 * you, and who fights beside whom.
 *
 * What may be known is `treaty-knowledge.ts`'s to say. How the government
 * regards a power, and why, goes only to those who govern -- in words, never
 * the score.
 */

/** A day in the story, and how far it is from today: negative is past. */
export interface TreatyMoment {
  readonly label: string | null;
  readonly days: number;
  /** Made before the story opens, so its day is not the day it was made. */
  readonly beforeTheStory: boolean;
}

export interface TreatyLetter {
  readonly subject: string;
  readonly fromLabel: string;
  readonly sent: TreatyMoment;
  readonly answerLabel: string | null;
}

export interface TreatyLine {
  readonly key: string;
  readonly kind: PolityAgreementKind;
  readonly kindLabel: string;
  /** Which way round it runs: "The Samnites bound to Rome by foedus", "Tribute from Rome to Carthage". Names are often plural, so no verb. */
  readonly summary: string;
  readonly terms: string;
  readonly since: TreatyMoment;
  readonly until: TreatyMoment | null;
  readonly ended: { readonly at: TreatyMoment; readonly reason: string | null } | null;
  /** Made in private: known to you because you govern, or governed. */
  readonly secret: boolean;
  /** Set when it binds you only through the power you follow by foedus. */
  readonly throughLabel: string | null;
  /** The letter that made it, when there was one and you could have read it. */
  readonly letter: TreatyLetter | null;
}

export type TreatyPosture = "war" | "answer_to" | "bound_to_us" | "equals" | "none" | "ended";

export interface TreatyPower {
  readonly polityId: string;
  readonly label: string;
  readonly posture: TreatyPosture;
  readonly lines: readonly TreatyLine[];
  readonly ended: readonly TreatyLine[];
  /** In a war: the allies drawn into it on each side by foedus. */
  readonly sides: { readonly yours: readonly string[]; readonly theirs: readonly string[] } | null;
  readonly regard: { readonly inWords: string; readonly why: string; readonly at: TreatyMoment } | null;
  readonly letters: readonly { readonly id: string; readonly kindLabel: string; readonly subject: string; readonly replyByLabel: string | null; readonly previousRejection?: { readonly terms: string; readonly reason: string; readonly subject: string } | null }[];
  /** What everybody knows of its dealings with third powers. */
  readonly elsewhere: readonly { readonly key: string; readonly kind: PolityAgreementKind; readonly kindLabel: string; readonly withLabel: string; readonly since: TreatyMoment }[];
}

export interface Abroad {
  readonly polityLabel: string | null;
  /** The power yours follows by foedus, if it follows one. */
  readonly leaderLabel: string | null;
  readonly powers: readonly TreatyPower[];
  /** Wars, peaces and truces between other powers: nobody can hide those. */
  readonly between: readonly { readonly key: string; readonly kind: PolityAgreementKind; readonly kindLabel: string; readonly betweenLabel: string; readonly since: TreatyMoment }[];
  /** What every kind named anywhere above does, so a note on one needs nothing else. */
  readonly glossary: Partial<Record<PolityAgreementKind, { readonly label: string; readonly explained: string }>>;
}

export const EMPTY_ABROAD: Abroad = { polityLabel: null, leaderLabel: null, powers: [], between: [], glossary: {} };

const POSTURE_ORDER: readonly TreatyPosture[] = ["war", "answer_to", "bound_to_us", "equals", "none", "ended"];
/** The kinds whose order is the terms: the lesser, or the one granted, first. */
const ORDERED: ReadonlySet<PolityAgreementKind> = new Set<PolityAgreementKind>(["tributary", "protectorate", "foedus"]);

const ANSWER_WORDS: Readonly<Record<string, string>> = { accepted: "Accepted", countered: "Answered with other terms", refused: "Refused", ignored: "Never answered" };

export function trustInWords(score: number): string {
  if (score >= 50) return "trusted";
  if (score >= 15) return "well regarded";
  if (score > -15) return "watched";
  if (score > -50) return "distrusted";
  return "regarded as an enemy";
}

/** A stretch of days as a person would say it: "three weeks", "about a year". */
export function spanInWords(days: number): string {
  const n = Math.abs(Math.round(days));
  if (n === 0) return "today";
  if (n === 1) return "a day";
  if (n < 14) return `${n} days`;
  if (n < 60) return `${Math.round(n / 7)} weeks`;
  if (n < 330) return Math.round(n / 30) === 1 ? "a month" : `${Math.round(n / 30)} months`;
  if (n < 548) return "a year";
  return `${Math.round(n / 365)} years`;
}

function summaryOf(agreement: PolityAgreement, name: (id: string) => string): string {
  const first = name(agreement.polityId);
  const second = name(agreement.otherPolityId);
  switch (agreement.kind) {
    case "tributary": return `Tribute from ${first} to ${second}`;
    case "protectorate": return `${second}'s protection over ${first}`;
    case "foedus": return `${first} bound to ${second} by foedus`;
    case "military_access": return `Passage for ${first}'s armies through ${second}'s land`;
    default: {
      const kind = AGREEMENT_KIND_IN_WORDS[agreement.kind];
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} between ${first} and ${second}`;
    }
  }
}

export function readAbroad(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): Abroad {
  if (characterId === null) return EMPTY_ABROAD;
  const station = buildStation({ world, characterId, offices });
  const polityId = station.polityId;
  if (polityId === null) return EMPTY_ABROAD;
  const governs = holdsPolityStanding(station);
  const viewer = treatyViewer(world, characterId, offices);
  const today = world.elapsedStep;
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? "another power";
  const moment = (day: number): TreatyMoment => ({
    label: clock === undefined ? `day ${day}` : formatWorldDate({ day: Math.max(day, 0), minute: 0 }, clock),
    days: day - today,
    beforeTheStory: day <= 0,
  });

  const known = world.polityAgreements.filter((agreement) => knowsAgreement(viewer, agreement));
  const active = known.filter((agreement) => agreement.status === "active");
  const leader = leaderOf(active, polityId);

  // The letter that made a treaty: its government's correspondence goes to
  // whoever governs, and a private man reads only what he wrote or was sent.
  const letterOf = (agreement: PolityAgreement): TreatyLetter | null => {
    if (agreement.sourceMessageId === null) return null;
    const message = world.diplomacy.find((candidate) => candidate.id === agreement.sourceMessageId);
    if (message === undefined) return null;
    const ours = message.fromPolityId === polityId || message.toPolityId === polityId;
    const readable = (governs && ours) || message.fromCharacterId === characterId || message.toCharacterId === characterId;
    if (!readable) return null;
    const sender = world.characters.find((character) => character.id === message.fromCharacterId)?.name;
    return {
      subject: message.subject,
      fromLabel: sender === undefined ? polityName(message.fromPolityId) : `${sender}, for ${polityName(message.fromPolityId)}`,
      sent: moment(message.sentAtStep),
      answerLabel: message.answer === null ? null : ANSWER_WORDS[message.answer] ?? null,
    };
  };

  const lineOf = (agreement: PolityAgreement, throughLabel: string | null): TreatyLine => ({
    key: agreement.id,
    kind: agreement.kind,
    kindLabel: AGREEMENT_KIND_IN_WORDS[agreement.kind],
    summary: summaryOf(agreement, polityName),
    terms: agreement.terms,
    since: moment(agreement.sinceStep),
    until: agreement.untilStep === null ? null : moment(agreement.untilStep),
    ended: agreement.status === "ended" ? { at: moment(agreement.endedAtStep ?? agreement.sinceStep), reason: agreement.endedReason } : null,
    secret: !agreementIsOpen(agreement),
    throughLabel,
    letter: letterOf(agreement),
  });

  const otherOf = (agreement: PolityAgreement, side: string): string | null =>
    agreement.polityId === side ? agreement.otherPolityId : agreement.otherPolityId === side ? agreement.polityId : null;

  const powers = new Map<string, { lines: TreatyLine[]; ended: TreatyLine[]; direct: PolityAgreement[]; warSide: string | null }>();
  const entry = (id: string) => {
    const found = powers.get(id) ?? { lines: [], ended: [], direct: [], warSide: null };
    powers.set(id, found);
    return found;
  };

  for (const agreement of known) {
    const other = otherOf(agreement, polityId);
    if (other === null) continue;
    const power = entry(other);
    if (agreement.status === "ended") power.ended.push(lineOf(agreement, null));
    else {
      power.lines.push(lineOf(agreement, null));
      power.direct.push(agreement);
      if (agreement.kind === "war") power.warSide = polityId;
    }
  }

  // A foedus ally makes no war or peace of its own: its leader's are its own.
  const through = new Set<string>();
  if (leader !== null) {
    for (const agreement of active) {
      if (!NEVER_SECRET_AGREEMENTS.has(agreement.kind)) continue;
      const other = otherOf(agreement, leader);
      if (other === null || other === polityId) continue;
      const power = entry(other);
      if (power.direct.some((direct) => direct.kind === agreement.kind)) continue;
      power.lines.push(lineOf(agreement, polityName(leader)));
      if (agreement.kind === "war" && power.warSide === null) power.warSide = leader;
      through.add(agreement.id);
    }
  }

  const regardOf = new Map(
    (governs ? world.polityStances : [])
      .filter((stance) => stance.polityId === polityId && stance.towardPolityId !== polityId)
      .map((stance) => [stance.towardPolityId, { inWords: trustInWords(stance.trustScore), why: stance.lastShiftReason, at: moment(stance.lastShiftAtStep) }]),
  );
  for (const id of regardOf.keys()) entry(id);

  const letters = lettersAwaitingYou(world, characterId, offices, clock);
  for (const letter of letters) if (letter.fromPolityId !== polityId) entry(letter.fromPolityId);

  const postureOf = (id: string, power: { lines: TreatyLine[]; ended: TreatyLine[]; direct: PolityAgreement[] }): TreatyPosture => {
    if (power.lines.some((line) => line.kind === "war")) return "war";
    if (power.direct.some((agreement) => ORDERED.has(agreement.kind) && agreement.polityId === polityId)) return "answer_to";
    if (power.direct.some((agreement) => ORDERED.has(agreement.kind) && agreement.polityId === id)) return "bound_to_us";
    if (power.lines.length > 0) return "equals";
    if (power.ended.length > 0 && !regardOf.has(id) && !letters.some((letter) => letter.fromPolityId === id)) return "ended";
    return "none";
  };

  const byNewest = (a: TreatyLine, b: TreatyLine) => b.since.days - a.since.days;
  const list: TreatyPower[] = [...powers].map(([id, power]) => {
    const warSide = power.warSide;
    const sides = warSide === null ? null : {
      yours: [...(warSide === polityId ? [] : [warSide]), ...alliesLedBy(active, warSide)].filter((ally) => ally !== polityId).map(polityName),
      theirs: alliesLedBy(active, id).map(polityName),
    };
    return {
      polityId: id,
      label: polityName(id),
      posture: postureOf(id, power),
      lines: [...power.lines].sort((a, b) => Number(b.kind === "war") - Number(a.kind === "war") || byNewest(a, b)),
      ended: [...power.ended].sort((a, b) => (b.ended?.at.days ?? 0) - (a.ended?.at.days ?? 0)),
      sides,
      regard: regardOf.get(id) ?? null,
      letters: letters.filter((letter) => letter.fromPolityId === id).map((letter) => ({ id: letter.id, kindLabel: letter.kindLabel, subject: letter.subject, replyByLabel: letter.replyByLabel, previousRejection: letter.previousRejection ?? null })),
      elsewhere: active
        .filter((agreement) => agreementIsOpen(agreement))
        .flatMap((agreement) => {
          const third = otherOf(agreement, id);
          return third === null || third === polityId
            ? []
            : [{ key: agreement.id, kind: agreement.kind, kindLabel: AGREEMENT_KIND_IN_WORDS[agreement.kind], withLabel: polityName(third), since: moment(agreement.sinceStep) }];
        }),
    };
  }).sort((a, b) =>
    POSTURE_ORDER.indexOf(a.posture) - POSTURE_ORDER.indexOf(b.posture)
    || b.letters.length - a.letters.length
    || a.label.localeCompare(b.label));

  const between = active
    .filter((agreement) => NEVER_SECRET_AGREEMENTS.has(agreement.kind))
    .filter((agreement) => agreement.polityId !== polityId && agreement.otherPolityId !== polityId && !through.has(agreement.id))
    .map((agreement) => ({
      key: agreement.id,
      kind: agreement.kind,
      kindLabel: AGREEMENT_KIND_IN_WORDS[agreement.kind],
      betweenLabel: `${polityName(agreement.polityId)} and ${polityName(agreement.otherPolityId)}`,
      since: moment(agreement.sinceStep),
    }))
    .sort((a, b) => Number(b.kind === "war") - Number(a.kind === "war") || a.betweenLabel.localeCompare(b.betweenLabel));

  const kinds = new Set<PolityAgreementKind>([
    ...list.flatMap((power) => [...power.lines, ...power.ended, ...power.elsewhere].map((item) => item.kind)),
    ...between.map((item) => item.kind),
  ]);
  const glossary = Object.fromEntries([...kinds].map((kind) => [kind, { label: AGREEMENT_KIND_IN_WORDS[kind], explained: AGREEMENT_KIND_EXPLAINED[kind] }]));

  return { polityLabel: polityName(polityId), leaderLabel: leader === null ? null : polityName(leader), powers: list, between, glossary };
}
