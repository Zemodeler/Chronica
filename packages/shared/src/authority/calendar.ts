import { buildStation, CLAIMED_OFFICE_SOURCE_REF, holdsPolityStanding, type Station } from "./station";
import type { Office } from "../characters/character";
import { AGREEMENT_KIND_IN_WORDS } from "../world/agreements";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * What is coming, as this person could know it: the next few dated things
 * in their world, soonest first.
 *
 * The world moves only when the player gives an order, and then leaps to the
 * next moment that matters -- which the player could not see coming, so a
 * month could go by without warning. This is that calendar, as far as it is
 * theirs to read.
 *
 * It is built from world state, not from the event queue. The queue is mostly
 * written by the model, its entries default to public, and one of them was a
 * report on a covert operation: shown as-is it would have told a player about
 * a plot nobody had discovered. Here every source is a fact the player's own
 * station reaches -- their seats, their institutions' business, their own
 * projects, their power's treaties, letters addressed to them -- and every
 * word is written here, not by the model.
 */

export interface CalendarItem {
  /** Stable, for a list key. */
  readonly key: string;
  /** Days from today; zero is today. */
  readonly inDays: number;
  /** What happens: "Your term as consul ends". */
  readonly label: string;
  /** When, in words: "in 12 days", "tomorrow", "on 29 February 269 BC". */
  readonly whenLabel: string;
  /** It wants something of the player: a vote they sit in, a letter to answer. */
  readonly needsYou: boolean;
}

/** Past this many days, a countdown is less useful than the date itself. */
const COUNTDOWN_DAYS = 60;

export function whatComesNext(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
  limit = 4,
): readonly CalendarItem[] {
  if (characterId === null) return [];
  const station: Station = buildStation({ world, characterId, offices });
  const today = world.elapsedStep;
  const governs = holdsPolityStanding(station);
  const polityName = (id: string): string | null => world.map.polities.find((polity) => polity.id === id)?.name ?? null;
  const institutionPolity = new Map(world.material.institutions.map((institution) => [institution.id, institution.polityId]));

  const items: Omit<CalendarItem, "whenLabel">[] = [];
  const add = (key: string, due: number | null, label: string, needsYou: boolean) => {
    if (due === null || due < today) return;
    items.push({ key, inDays: due - today, label, needsYou });
  };

  // Your own terms of office.
  const seatById = new Map(world.material.officeSeats.map((seat) => [seat.id, seat]));
  for (const seat of station.seats) {
    if (seat.seatId.startsWith(CLAIMED_OFFICE_SOURCE_REF)) continue;
    add(`seat:${seat.seatId}`, seatById.get(seat.seatId)?.termExpiresAtStep ?? null, `Your term as ${seat.office.label} ends`, false);
  }

  // The business of bodies you sit in, or that you are party to; and your own
  // power's public business, which any citizen would hear of.
  for (const procedure of world.material.politicalProcedures) {
    if (!["proposed", "gathering_support", "deliberating", "voting_or_deciding"].includes(procedure.stage)) continue;
    const party = station.procedureIds.has(procedure.id);
    const member = procedure.institutionId !== null && station.institutionIds.has(procedure.institutionId);
    const ownPublic = procedure.visibility === "public"
      && procedure.institutionId !== null
      && institutionPolity.get(procedure.institutionId) === station.polityId;
    if (!party && !member && !ownPublic) continue;
    const election = procedure.type === "vote" && procedure.subjectKind === "office_seat";
    const label = election ? `Polling day: ${lowerFirst(procedure.label)}` : `Decided by now: ${lowerFirst(procedure.label)}`;
    add(`procedure:${procedure.id}`, procedure.deadlineStep, clip(label), party);
  }

  // Your own undertakings, and your power's if you govern it.
  for (const project of world.projects) {
    if (project.status === "completed" || project.status === "cancelled" || project.status === "failed") continue;
    const sponsor = project.sponsorEntityRef;
    const yours = (sponsor.kind === "character" && sponsor.id === characterId)
      || (governs && sponsor.kind === "polity" && sponsor.id === station.polityId);
    if (!yours) continue;
    const next = project.milestones
      .filter((milestone) => milestone.status === "pending")
      .map((milestone) => ({ milestone, due: project.startedAtStep + milestone.requiredAtElapsedOffset }))
      .filter(({ due }) => due >= today)
      .sort((a, b) => a.due - b.due)[0];
    if (next !== undefined) add(`project:${project.id}:${next.milestone.id}`, next.due, clip(next.milestone.label), false);
    else add(`project:${project.id}`, project.targetCompletionStep, clip(`${project.label}: due to be finished`), false);
  }

  // Your power's dated treaties: what everyone may know, and the rest if you govern.
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.untilStep === null) continue;
    const other = agreement.polityId === station.polityId ? agreement.otherPolityId
      : agreement.otherPolityId === station.polityId ? agreement.polityId : null;
    if (other === null) continue;
    if (agreement.visibility !== "public" && !governs) continue;
    const otherName = polityName(other);
    add(`agreement:${agreement.id}`, agreement.untilStep,
      `The ${AGREEMENT_KIND_IN_WORDS[agreement.kind]}${otherName === null ? "" : ` with ${otherName}`} ends`, false);
  }

  // Letters waiting on your answer, or on your government's if you speak for it.
  for (const message of world.diplomacy) {
    if (message.status !== "awaiting_reply") continue;
    const toYou = message.toCharacterId === characterId;
    const toYourGovernment = governs && message.toPolityId === station.polityId && message.toCharacterId === null;
    if (!toYou && !toYourGovernment) continue;
    const sender = world.characters.find((character) => character.id === message.fromCharacterId)?.name ?? polityName(message.fromPolityId);
    add(`letter:${message.id}`, message.replyDueByStep, sender === null ? "An answer is due" : `An answer to ${sender} is due`, true);
  }

  const seen = new Set<string>();
  return items
    .sort((a, b) => a.inDays - b.inDays || Number(b.needsYou) - Number(a.needsYou) || a.label.localeCompare(b.label))
    .filter((item) => (seen.has(item.label) ? false : (seen.add(item.label), true)))
    .slice(0, limit)
    .map((item) => ({ ...item, whenLabel: whenInWords(item.inDays, today, clock) }));
}

function whenInWords(inDays: number, today: number, clock: ScenarioClock | undefined): string {
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  if (inDays <= COUNTDOWN_DAYS || clock === undefined) return `in ${inDays} days`;
  return `on ${formatWorldDate({ day: today + inDays, minute: 0 }, clock)}`;
}

const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);
const clip = (text: string): string => (text.length <= 90 ? text : `${text.slice(0, 89).trimEnd()}…`);
