import type { Office } from "../characters/character";
import { promisesOf } from "../characters/promises";
import { enemiesOf } from "../world/agreements";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import type { WorldState } from "../world/world-state";
import { entityKey, type Linked } from "../knowledge/glossary";
import { spanInWords } from "./abroad";
import { lettersAwaitingYou } from "./letters-awaiting";
import { buildStation } from "./station";
import { ordersUnderWay } from "./under-way";

/**
 * Matters in hand: everything open that concerns the player, in one note
 * opened from the date.
 *
 * Each source was already somewhere. Letters sat in the tray, orders on the
 * desk, promises in the mirror, wars in the seal case. None of them showed a
 * measure that was carried and then did nothing, and that was the worst
 * December bug: votes that enacted nothing, with nobody the wiser. Putting
 * them side by side is the point, so a promise made to you shows up next to
 * one you made, and a vote next to the order that should have followed it.
 *
 * Everything here comes from station-filtered readers, or is filtered as
 * `whatComesNext` filters the same records. A row names people and powers as
 * links, and a link without a note in the glossary is plain words, so this
 * cannot say more than the notes would.
 */

export type MattersSection = "wants_your_word" | "voted_not_done" | "promised_to_you" | "promised_by_you" | "under_way" | "wars";

/** A piece of a row: words, or a name that may open a note. */
export type MatterPart = string | Linked;

/** What the Chronicle should be filtered to when a row is followed there. */
export interface MatterFocus {
  readonly kind: "character" | "polity";
  readonly id: string;
  readonly label: string;
}

export interface MatterRow {
  readonly key: string;
  readonly parts: readonly MatterPart[];
  /** A second, quieter line: "due 15 March", "stalled: 300 short". */
  readonly detail: string | null;
  /** It wants the player's word, or it has gone wrong. */
  readonly marked: boolean;
  readonly focus: MatterFocus | null;
}

export interface Matters {
  readonly sections: readonly { readonly section: MattersSection; readonly label: string; readonly rows: readonly MatterRow[] }[];
  /** How many rows want the player's word: the count on the date. */
  readonly wanting: number;
}

const SECTION_LABELS: Readonly<Record<MattersSection, string>> = {
  wants_your_word: "Wants your word",
  voted_not_done: "Voted, not done",
  promised_to_you: "Promised to you",
  promised_by_you: "Promised by you",
  under_way: "Under way",
  wars: "Wars",
};

const ORDER: readonly MattersSection[] = ["wants_your_word", "voted_not_done", "promised_to_you", "promised_by_you", "under_way", "wars"];

/** How far back a kept or broken promise, or a carried vote, still counts as in hand. */
const RECENT_DAYS = 30;
const VOTE_DAYS = 90;
const PER_SECTION = 6;

export function mattersInHand(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): Matters {
  if (characterId === null) return { sections: [], wanting: 0 };
  const viewer = world.characters.find((character) => character.id === characterId);
  if (viewer === undefined) return { sections: [], wanting: 0 };
  const station = buildStation({ world, characterId, offices });
  const today = world.elapsedStep;
  const person = (id: string): Linked => ({ label: world.characters.find((character) => character.id === id)?.name ?? "someone", key: entityKey("person", id) });
  const power = (id: string): Linked => ({ label: world.map.polities.find((polity) => polity.id === id)?.name ?? "a power", key: entityKey("power", id) });
  const dateOf = (step: number): string => (clock === undefined ? `day ${step}` : formatWorldDate({ day: step, minute: 0 }, clock));
  const personFocus = (id: string): MatterFocus => ({ kind: "character", id, label: person(id).label });

  const rows = new Map<MattersSection, MatterRow[]>(ORDER.map((section) => [section, []]));
  const add = (section: MattersSection, row: MatterRow) => rows.get(section)!.push(row);

  // Letters waiting on the player's answer, or his government's.
  for (const letter of lettersAwaitingYou(world, characterId, offices, clock)) {
    add("wants_your_word", {
      key: `letter:${letter.id}`,
      parts: [`${letter.kindLabel} from `, person(letter.fromCharacterId), `: ${letter.subject}`],
      detail: letter.replyByLabel === null ? null : `An answer is due by ${letter.replyByLabel}`,
      marked: true,
      focus: personFocus(letter.fromCharacterId),
    });
  }

  // Questions put to a body he sits in, or that he is party to, still undecided.
  const institutionPolity = new Map(world.material.institutions.map((institution) => [institution.id, institution.polityId]));
  const seesProcedure = (procedure: WorldState["material"]["politicalProcedures"][number]): boolean =>
    station.procedureIds.has(procedure.id)
    || (procedure.institutionId !== null && station.institutionIds.has(procedure.institutionId))
    || (procedure.visibility === "public" && procedure.institutionId !== null && institutionPolity.get(procedure.institutionId) === station.polityId);
  for (const procedure of world.material.politicalProcedures) {
    if (!["proposed", "gathering_support", "deliberating", "voting_or_deciding"].includes(procedure.stage)) continue;
    if (!station.procedureIds.has(procedure.id) || procedure.eligibleParticipantIds.length > 0 && !procedure.eligibleParticipantIds.includes(characterId)) continue;
    add("wants_your_word", {
      key: `procedure:${procedure.id}`,
      parts: [procedure.label],
      detail: procedure.deadlineStep === null ? null : `Decided by ${dateOf(procedure.deadlineStep)}`,
      marked: true,
      focus: null,
    });
  }

  // Carried, and then what? A measure that enacts nothing, or whose work
  // never began, is a vote that changed nothing.
  for (const procedure of world.material.politicalProcedures) {
    if (procedure.stage !== "resolved" || procedure.outcome !== "passed" || procedure.resolvedAtStep === null) continue;
    if (today - procedure.resolvedAtStep > VOTE_DAYS || !seesProcedure(procedure)) continue;
    const enactment = world.enactments.find((candidate) => candidate.procedureId === procedure.id);
    const work = enactment?.projectId == null ? undefined : world.projects.find((project) => project.id === enactment.projectId);
    const undone = enactment === undefined
      ? "Carried, but it says nothing that anyone must do"
      : enactment.enactedAtStep === null
        ? "Carried, and not yet carried out"
        : work !== undefined && (work.status === "proposed" || work.status === "failed" || work.status === "cancelled")
          ? `Carried, but the work has ${work.status === "proposed" ? "not begun" : "been given up"}`
          : null;
    if (undone === null) continue;
    add("voted_not_done", {
      key: `carried:${procedure.id}`,
      parts: [procedure.label],
      detail: `${undone}. Voted ${spanInWords(today - procedure.resolvedAtStep)} ago.`,
      marked: procedure.sponsorCharacterId === characterId,
      focus: null,
    });
  }

  // Promises either way, open, and kept or broken lately.
  for (const promise of promisesOf(world, characterId, clock)) {
    const commitment = world.commitments.find((candidate) => candidate.id === promise.id);
    if (commitment === undefined) continue;
    const other = promise.yours ? commitment.beneficiaryCharacterId : commitment.promisorCharacterId;
    const overdue = commitment.reviewAtStep < today;
    add(promise.yours ? "promised_by_you" : "promised_to_you", {
      key: `promise:${promise.id}`,
      parts: promise.yours ? ["To ", person(other), `: ${promise.description}`] : [person(other), `: ${promise.description}`],
      detail: promise.dueLabel === null ? null : overdue ? `It was due on ${promise.dueLabel}` : `Due on ${promise.dueLabel}`,
      marked: promise.pressing || (!promise.yours && overdue),
      focus: personFocus(other),
    });
  }
  for (const resolved of promisesResolvedSince(world, characterId, today - RECENT_DAYS)) {
    const yours = resolved.promisorCharacterId === characterId;
    const other = yours ? resolved.beneficiaryCharacterId : resolved.promisorCharacterId;
    const verdict = resolved.status === "fulfilled" ? "kept" : "broken";
    add(yours ? "promised_by_you" : "promised_to_you", {
      key: `promise:${resolved.id}`,
      parts: yours ? ["To ", person(other), `: ${resolved.description}`] : [person(other), `: ${resolved.description}`],
      detail: `${verdict === "kept" ? "Kept" : "Broken"} on ${dateOf(resolved.resolvedAtStep)}`,
      marked: false,
      focus: personFocus(other),
    });
  }

  // What his orders are doing.
  for (const item of ordersUnderWay(world, characterId, offices, clock)) {
    add("under_way", { key: item.key, parts: [item.label], detail: item.detail, marked: item.stalled, focus: null });
  }

  // Wars his power is in. Nobody can hide a war.
  if (viewer.polityId !== null) {
    for (const enemy of enemiesOf(world.polityAgreements, viewer.polityId)) {
      const war = world.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "war"
        && ((agreement.polityId === enemy && agreement.otherPolityId === viewer.polityId) || (agreement.otherPolityId === enemy && agreement.polityId === viewer.polityId)));
      add("wars", {
        key: `war:${enemy}`,
        parts: ["With ", power(enemy)],
        detail: war === undefined ? "Through your allies" : war.sinceStep <= 0 ? "Since before these annals" : `Since ${dateOf(war.sinceStep)}`,
        marked: false,
        focus: { kind: "polity", id: enemy, label: power(enemy).label },
      });
    }
  }

  const sections = ORDER
    .map((section) => ({ section, label: SECTION_LABELS[section], rows: rows.get(section)!.slice(0, PER_SECTION) }))
    .filter((section) => section.rows.length > 0);
  return { sections, wanting: sections.flatMap((section) => section.rows).filter((row) => row.marked).length };
}

export interface ResolvedPromise {
  readonly id: string;
  readonly promisorCharacterId: string;
  readonly beneficiaryCharacterId: string;
  readonly description: string;
  readonly status: "fulfilled" | "broken";
  readonly resolvedAtStep: number;
}

/**
 * Promises the player made or was made that have been kept or broken since
 * `sinceStep`. `promisesOf` shows only open ones, so a promise vanished the
 * day it was broken, which was the day it mattered most.
 */
export function promisesResolvedSince(world: WorldState, characterId: string, sinceStep: number): readonly ResolvedPromise[] {
  return world.commitments
    .filter((commitment) => commitment.promisorCharacterId === characterId || commitment.beneficiaryCharacterId === characterId)
    .filter((commitment) => commitment.resolvedAtStep !== null && commitment.resolvedAtStep >= sinceStep)
    .filter((commitment) => commitment.status === "fulfilled" || commitment.status === "broken" || commitment.status === "failed")
    .sort((a, b) => (b.resolvedAtStep ?? 0) - (a.resolvedAtStep ?? 0))
    .map((commitment) => ({
      id: commitment.id,
      promisorCharacterId: commitment.promisorCharacterId,
      beneficiaryCharacterId: commitment.beneficiaryCharacterId,
      description: commitment.description,
      status: commitment.status === "fulfilled" ? "fulfilled" : "broken",
      resolvedAtStep: commitment.resolvedAtStep!,
    }));
}
