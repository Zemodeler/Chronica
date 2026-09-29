import { GOVERNMENT_FORM_IN_WORDS, type GovernmentForm } from "../political-parts";
import { AGREEMENT_KIND_EXPLAINED, AGREEMENT_KIND_IN_WORDS, type PolityAgreementKind } from "../world/agreements";
import { SIEGE_BASE_DAYS, SIEGE_HUNGER_AFTER_DAYS } from "../world/siege";

/**
 * What the game's words mean, said where the word is met.
 *
 * These are fixed texts, written here once, each saying what the engine does
 * and no more, as `AGREEMENT_KIND_EXPLAINED` does for treaties. They are
 * reference, not narration: nothing here says what happened, so the rule
 * that everything happens in the Chronicle is kept.
 *
 * They used to be a codex, a page of their own on the shelf of annals. A
 * reader had to leave the note he was in to read one. Now each is shown in
 * the note, the why or the heading where its word appears: an office's kind
 * in the office note, a power's form in the power note, the tax rule in the
 * why of the tax. How the reader's own power does it now is the seal case's.
 * All of them can also be looked up by name (`lookup.ts`).
 */

export interface Explanation {
  /** "office:magistracy", "form:league", "rule:siege". */
  readonly key: string;
  readonly title: string;
  readonly text: string;
}

const OFFICE_KINDS: readonly Explanation[] = [
  { key: "office:magistracy", title: "A magistracy", text: "An office held for a term, by one man or a few colleagues, with powers the law gives it: to command, to judge, to spend. When the term runs out the office passes as its rule says, and the man goes back to being what he was, with the name of having held it." },
  { key: "office:membership", title: "A seat in a council", text: "A place in a chamber that votes: a senate, an assembly, a council of elders. A seat gives a voice and a vote on what is put to the chamber, and nothing by itself. What the chamber may decide is its own list of powers." },
  { key: "office:priesthood", title: "A priesthood", text: "An office of the gods, often held for life. It carries the right to read the signs and to keep the rites, which in a state that asks the gods before it acts can be a kind of power." },
];

/** What each form of government is, in a sentence or two. */
const FORM_TEXT: Readonly<Record<GovernmentForm, string>> = {
  monarchy: "One ruler, whose word is law within what custom allows. Councils may advise; the ruler decides.",
  oligarchic_republic: "The great houses rule through a council of their own, and the magistrates they elect answer to it. Birth and wealth decide who sits.",
  popular_republic: "The citizens decide in their assemblies, and the magistrates they elect answer to them.",
  tribal_confederation: "Many peoples under one name. Each chief answers for his own, and an agreement struck with one binds only him.",
  soldier_commune: "Men under arms who hold the ground they took, and decide among themselves.",
  league: "Cities bound together for war and trade, each keeping its own laws. The league acts only where its members agree.",
  temple_state: "Ruled from its temple, by those who serve its god.",
};

const RULES: readonly Explanation[] = [
  { key: "rule:promise", title: "A man's word", text: "A promise is held against whoever made it until the day it falls due. Kept, it stands to his credit. Broken, it costs him what was staked on it: his standing, his money or his safety. Both sides remember." },
  { key: "rule:tax", title: "What the land can bear", text: "Every province can give so much a month and no more. Ask less and it is paid without complaint. Ask close to that and it is resented. Ask more and the collectors fall short, the provinces settle into disorder, and what is asked is not what arrives." },
  { key: "rule:pay", title: "Soldiers' pay", text: "Men under arms expect to be paid for every period they serve, and pay owed and not paid sours them. An army paid out of what it takes is paid for as long as it keeps taking." },
  { key: "rule:supply", title: "Supply", text: "An army eats. Its stores are counted to a day, and whether it is fed, short or starving is part of how it fares and how it fights." },
  { key: "rule:siege", title: "Sieges", text: `A city under siege yields when its hunger and its fear are enough. Besiegers three times the garrison bring it to that in about ${SIEGE_BASE_DAYS} days; fewer take longer, and walls with no one on them fall faster. After ${SIEGE_HUNGER_AFTER_DAYS} days its stores are gone and the garrison starts to starve. The siege ends when the besiegers leave, when the war does, or when the gates open.` },
  { key: "rule:letter", title: "Letters", text: "A letter waits for its answer. Some are due by a day, and silence past it is an answer too. A letter unread by whoever it was meant for has not been answered by anybody." },
  { key: "rule:vote", title: "A vote carried", text: "A measure a chamber carries does what it says it enacts: a work paid for, an office made or changed, a law. A measure that says nothing anyone must do changes nothing, however many voted for it." },
];

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

const FORMS: readonly Explanation[] = (Object.keys(GOVERNMENT_FORM_IN_WORDS) as GovernmentForm[]).map((form) => ({
  key: `form:${form}`,
  title: capitalise(GOVERNMENT_FORM_IN_WORDS[form]),
  text: FORM_TEXT[form],
}));

/** The treaty sheet shows these beside each treaty; the lookup finds them by name. */
const TREATY_KINDS: readonly Explanation[] = (Object.keys(AGREEMENT_KIND_EXPLAINED) as PolityAgreementKind[]).map((kind) => ({
  key: `kind:${kind}`,
  title: capitalise(AGREEMENT_KIND_IN_WORDS[kind]),
  text: AGREEMENT_KIND_EXPLAINED[kind],
}));

const BY_KEY: ReadonlyMap<string, Explanation> = new Map([...OFFICE_KINDS, ...FORMS, ...TREATY_KINDS, ...RULES].map((entry) => [entry.key, entry]));

export function explanations(): readonly Explanation[] {
  return [...BY_KEY.values()];
}

/** The text for one word, or null where there is none. */
export function explanationOf(key: string | null | undefined): Explanation | null {
  return key == null ? null : BY_KEY.get(key) ?? null;
}

