import type { Office } from "../characters/character";
import { entityKey, type Linked } from "../knowledge/glossary";
import { GOVERNMENT_FORM_IN_WORDS } from "../political-parts";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import type { ConstitutionChange } from "../world/constitution";
import type { WorldState } from "../world/world-state";
import { buildStation } from "./station";

/**
 * How the player's state came to be governed as it is.
 *
 * The engine has kept a constitution's history since constitutions were made
 * parts (`world.constitutions[].history`): each change with its date, the form
 * before and after, a sentence, and whoever brought it about. None of it was
 * shown. A citizen can read this without holding any office -- a state's laws
 * and the way it is governed are public to the people who live under them --
 * so nothing here is gated by station beyond which power the person belongs to.
 *
 * What the record does not hold stays unknown, said so, and is never filled in
 * from a guess: a change written before the vote was kept does not say how the
 * vote went; a history that began when these annals did does not say how the
 * constitution it opened with came about; and a history long enough to have
 * lost its oldest entries says that it has.
 */

export interface ConstitutionEntry {
  readonly key: string;
  readonly atStep: number;
  readonly dateLabel: string;
  /** What changed, in a line: "From a monarchy to a republic of the great houses". */
  readonly headline: string;
  /** The line the engine recorded when it happened. */
  readonly what: string;
  /** Whoever brought it about, where somebody did. */
  readonly by: Linked | null;
  /** "By a vote of the Senate", "By force: a coup". */
  readonly how: string;
  readonly detail: {
    readonly fromLabel: string | null;
    readonly toLabel: string;
    readonly body: string | null;
    readonly voteLabel: string | null;
    /** The question that carried it, where one did: for a link to the laws. */
    readonly procedureId: string | null;
    /** What the record does not say, each as a sentence. */
    readonly unknown: readonly string[];
  };
}

export interface ConstitutionReading {
  readonly polityLabel: string | null;
  /** "Set down when these annals open", or the date it was adopted. */
  readonly sinceLabel: string | null;
  /** Newest first. */
  readonly entries: readonly ConstitutionEntry[];
  /** An explicit statement of what lies before the first entry, or null where the record is whole. */
  readonly beforeRecord: string | null;
}

const EMPTY: ConstitutionReading = { polityLabel: null, sinceLabel: null, entries: [], beforeRecord: null };

/** The most the world keeps (`ConstitutionSchema.history`). */
const HISTORY_KEPT = 24;

export function readConstitutionHistory(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): ConstitutionReading {
  if (characterId === null) return EMPTY;
  const polityId = buildStation({ world, characterId, offices }).polityId;
  if (polityId === null) return EMPTY;
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  const constitution = world.constitutions.find((candidate) => candidate.polityId === polityId);
  if (polity === undefined || constitution === undefined) return { ...EMPTY, polityLabel: polity?.name ?? null };

  const date = (day: number): string => (clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock));
  const person = (id: string): Linked => ({ label: world.characters.find((character) => character.id === id)?.name ?? "someone", key: entityKey("person", id) });

  const entries = constitution.history
    .map((change, index): ConstitutionEntry => entryOf(change, index))
    .sort((a, b) => b.atStep - a.atStep || b.key.localeCompare(a.key));

  function entryOf(change: ConstitutionChange, index: number): ConstitutionEntry {
    const unknown: string[] = [];
    const sameForm = change.fromForm === change.toForm;
    const headline = change.fromForm === null
      ? `Governed as ${GOVERNMENT_FORM_IN_WORDS[change.toForm]}`
      : sameForm
        ? `Still ${GOVERNMENT_FORM_IN_WORDS[change.toForm]}, but reformed`
        : `From ${GOVERNMENT_FORM_IN_WORDS[change.fromForm]} to ${GOVERNMENT_FORM_IN_WORDS[change.toForm]}`;

    // Vote and body arrive together with the procedure; a change recorded
    // before they were kept has none of the three and says so.
    const kept = change.procedureId !== undefined;
    const body = change.bodyName ?? null;
    let voteLabel: string | null = null;
    if (change.vote != null) voteLabel = `For ${change.vote.yes}, against ${change.vote.no}`;
    let how: string;
    switch (change.origin) {
      case "reform":
        if (!kept) {
          how = "By a measure carried or a ruler's decree";
          unknown.push("The record does not say whether a council voted on it, or a ruler decreed it.");
        } else if (body !== null) {
          how = `By a vote of ${body.startsWith("The ") || body.startsWith("the ") ? body : `the ${body}`}`;
          if (voteLabel === null) unknown.push("The record does not say how the vote stood.");
        } else {
          how = "By decree of the ruler";
        }
        break;
      case "seizure":
        how = change.route === "revolution" ? "By force: a rising of the people" : change.route === "coup" ? "By force: a coup" : "By force";
        break;
      case "restoration":
        how = "By force: the fallen government taken back";
        break;
      case "imposition":
        how = "Dictated from outside";
        break;
      case "extinction":
        how = "Because the old line of rulers died out";
        break;
      case "scenario":
      case "generated":
        how = "As the annals opened";
        break;
    }
    if (change.byCharacterId === null && (change.origin === "seizure" || change.origin === "restoration" || change.origin === "imposition")) {
      unknown.push("The record does not name who did it.");
    }
    return {
      key: `constitution:${index}:${change.atStep}`,
      atStep: change.atStep,
      dateLabel: date(change.atStep),
      headline,
      what: change.summary,
      by: change.byCharacterId === null ? null : person(change.byCharacterId),
      how,
      detail: {
        fromLabel: change.fromForm === null ? null : GOVERNMENT_FORM_IN_WORDS[change.fromForm],
        toLabel: GOVERNMENT_FORM_IN_WORDS[change.toForm],
        body,
        voteLabel,
        procedureId: change.procedureId ?? null,
        unknown,
      },
    };
  }

  const opened = constitution.origin === "scenario" || constitution.origin === "generated";
  const lostEarlier = constitution.history.length >= HISTORY_KEPT;
  const beforeRecord = lostEarlier
    ? "Earlier changes than these are no longer recorded."
    : entries.length === 0
      ? `${polity.name} was governed as ${GOVERNMENT_FORM_IN_WORDS[constitution.form]} when these annals opened. How it came to be so is not recorded.`
      : `Before the first of these, ${polity.name} was governed as ${GOVERNMENT_FORM_IN_WORDS[constitution.history[0]?.fromForm ?? constitution.form]}. How that came to be is not recorded.`;
  return {
    polityLabel: polity.name,
    sinceLabel: opened ? "Set down when these annals open" : `Adopted ${date(constitution.adoptedAtStep)}`,
    entries,
    beforeRecord,
  };
}
