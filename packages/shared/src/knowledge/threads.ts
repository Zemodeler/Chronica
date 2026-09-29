import type { Office } from "../characters/character";
import { buildStation, holdsPolityStanding } from "../authority/station";
import type { WorldStoryline } from "../world/storylines";
import type { WorldState } from "../world/world-state";
import { entityKey, type Linked } from "./glossary";

/**
 * Threads of history, as the player could know them.
 *
 * The engine follows storylines (`world.storylines`): who is in each, where,
 * how far it has gone, what is at stake. Its own summary of one is written
 * by the model for the model, and carries what nobody in the world has been
 * told, including what the narrator means to happen next. None of that is
 * read here. A thread's history is the Chronicle entries published to the player
 * that belong to it (read or waiting to be), and its people are those named
 * in those entries. So a
 * thread can only ever tell the player what the Chronicle already has.
 *
 * Which threads the viewer may see at all is the storyline's own rule: a
 * public one is anybody's. A polity one is known to its government, when one
 * of that power's people is in it. A private one only to those in it.
 */

export type ThreadPhase = WorldStoryline["phase"];

export const THREAD_PHASES: readonly ThreadPhase[] = ["brewing", "escalating", "crisis", "resolving", "closed"];

export const THREAD_PHASE_IN_WORDS: Readonly<Record<ThreadPhase, string>> = {
  brewing: "brewing",
  escalating: "growing",
  crisis: "at a crisis",
  resolving: "coming to an end",
  closed: "over",
};

/** An entry of the Chronicle, as far as a thread needs one. */
export interface ThreadEntry {
  readonly id: string;
  readonly title: string;
  readonly dateLabel: string | null;
  readonly sortKey: number;
  readonly read: boolean;
  readonly storylineIds: readonly string[];
  readonly subjects: readonly { readonly kind: string; readonly id: string }[];
}

export interface ThreadNote {
  readonly id: string;
  readonly title: string;
  readonly phase: ThreadPhase;
  readonly phaseLabel: string;
  /** What is at stake, only where the thread is public or the viewer is in it. */
  readonly stakes: string | null;
  /** The people and powers its entries name. */
  readonly who: readonly Linked[];
  /** Its entries in the Chronicle, oldest first, the last eight. */
  readonly history: readonly { readonly entryId: string; readonly dateLabel: string | null; readonly title: string }[];
  /** Entries of it the player has not read yet. */
  readonly unread: number;
  readonly followed: boolean;
}

export interface ThreadsInput {
  readonly world: WorldState;
  readonly characterId: string;
  readonly offices?: readonly Office[] | undefined;
  readonly entries: readonly ThreadEntry[];
  readonly followedIds: ReadonlySet<string>;
}

export function knowsStoryline(world: WorldState, characterId: string, storyline: WorldStoryline, governs: boolean, polityId: string | null): boolean {
  if (storyline.participantIds.includes(characterId)) return true;
  if (storyline.visibility === "public") return true;
  if (storyline.visibility === "polity") {
    return governs && polityId !== null
      && storyline.participantIds.some((id) => world.characters.find((character) => character.id === id)?.polityId === polityId);
  }
  return false;
}

export function threadsYouSee(input: ThreadsInput): Readonly<Record<string, ThreadNote>> {
  const { world, characterId, entries } = input;
  const station = buildStation({ world, characterId, offices: input.offices ?? [] });
  const governs = holdsPolityStanding(station);
  const nameOf = (kind: string, id: string): string | null =>
    kind === "character" ? world.characters.find((character) => character.id === id)?.name ?? null
      : kind === "polity" ? world.map.polities.find((polity) => polity.id === id)?.name ?? null
        : null;

  const notes: Record<string, ThreadNote> = {};
  for (const storyline of world.storylines) {
    if (!knowsStoryline(world, characterId, storyline, governs, station.polityId)) continue;
    const own = entries.filter((entry) => entry.storylineIds.includes(storyline.id)).sort((a, b) => a.sortKey - b.sortKey);
    const followed = input.followedIds.has(storyline.id);
    // A thread with nothing told of it is a thread the player has no way to
    // have heard of, unless they are in it or chose to follow it.
    if (own.length === 0 && !followed && !storyline.participantIds.includes(characterId)) continue;

    const who = new Map<string, Linked>();
    for (const entry of own) {
      for (const subject of entry.subjects) {
        if (subject.id === characterId) continue;
        const label = nameOf(subject.kind, subject.id);
        if (label === null) continue;
        const key = subject.kind === "character" ? entityKey("person", subject.id) : entityKey("power", subject.id);
        if (!who.has(key)) who.set(key, { label, key });
      }
    }
    notes[storyline.id] = {
      id: storyline.id,
      title: storyline.title,
      phase: storyline.phase,
      phaseLabel: THREAD_PHASE_IN_WORDS[storyline.phase],
      stakes: storyline.visibility === "public" || storyline.participantIds.includes(characterId) ? storyline.stakes : null,
      who: [...who.values()].slice(0, 8),
      history: own.slice(-8).map((entry) => ({ entryId: entry.id, dateLabel: entry.dateLabel, title: entry.title })),
      unread: own.filter((entry) => !entry.read).length,
      followed,
    };
  }
  return notes;
}
