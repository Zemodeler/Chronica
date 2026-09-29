import { allOffices, type ScenarioGovernmentRules } from "./character";
import { familyLinksOf, reciprocalFamilyLinkKind, type FamilyLinkKind } from "./family";
import { traitsInWords } from "./skills-in-words";
import { TRAIT_CORROBORATION } from "./traits";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * What has happened to the player since the opening, for the mirror.
 *
 * "Notable events" was the declaration's list and nothing else: four lines
 * the model wrote about his life before the game, and never one about the
 * game. Two things the engine already keeps make the rest of it, and no new
 * ledger is needed for either:
 *
 * - **The Chronicle**, which is what the player has actually been told
 *   (VISION §25). Every entry names who it is about and the facts it drew on,
 *   and each fact carries the weight its author gave it. An entry about him,
 *   or about his close family, is a notable event of his life in the
 *   historian's own words. The raw fact store is not read: it holds the
 *   private and the undiscovered, and would tell him what he has not learned.
 *
 * - **Milestones read off the world**, for what matters whether or not a
 *   historian ever wrote a passage about it: offices taken and laid down,
 *   marriages, children born, kin dead, what people have come to say of him,
 *   promises kept and broken. Each already has its day on the record. A man
 *   knows when his own brother dies, so family milestones are his even when
 *   the Chronicle never mentioned them.
 *
 * When an entry and a milestone are the same event -- the same day, the same
 * people -- the entry is kept, because a historian's title says more than a
 * line of code.
 */

/** A subject as a stored entry carries it: an `OrderPartyRef`, read back from JSON. */
export interface StoryRef { readonly kind: string; readonly id: string }

/** One event as the Chronicle has it, reduced to what this reading needs. */
export interface StoryEntry {
  readonly id: string;
  readonly title: string;
  /** When the matter entered the record: `day * 1440 + minute`. */
  readonly sortKey: number;
  readonly subjects: readonly StoryRef[];
  /** The subjects shown on the entry's face. Being among them is being what it is about. */
  readonly tags: readonly StoryRef[];
  /** The sum of its facts' significance. */
  readonly significance: number;
}

export interface NotableEvent {
  readonly key: string;
  readonly sortKey: number;
  readonly whenLabel: string;
  readonly line: string;
  /** His own, or something that befell his close family. */
  readonly whose: "yours" | "family";
  /** Set when the event is a Chronicle entry, so the mirror can open it there. */
  readonly chronicleEntryId: string | null;
}

export interface LifeStoryInput {
  readonly world: WorldState;
  readonly characterId: string;
  readonly government?: ScenarioGovernmentRules | undefined;
  readonly clock?: ScenarioClock | undefined;
  readonly entries: readonly StoryEntry[];
  readonly limit?: number | undefined;
}

/** How many events the mirror lists. The Chronicle, filtered to him, has the rest. */
const EVENTS_SHOWN = 10;
const MINUTES_PER_DAY = 1440;

/** How much each kind of milestone weighs against a Chronicle entry's significance. */
const WEIGHT = { life: 100, office: 90, known: 60, promise: 60, family: 50 } as const;

/** Close family: whose own milestones and entries count as his. */
const CLOSE: ReadonlySet<FamilyLinkKind> = new Set(["parent", "child", "sibling", "spouse_or_partner"]);

interface Candidate extends NotableEvent {
  readonly weight: number;
  /** The people it concerns, for matching a milestone to an entry about the same thing. */
  readonly involves: readonly string[];
}

function kinWord(kind: FamilyLinkKind, gender: "male" | "female"): string {
  const female = gender === "female";
  switch (kind) {
    case "parent": return female ? "mother" : "father";
    case "child": return female ? "daughter" : "son";
    case "sibling": return female ? "sister" : "brother";
    case "spouse_or_partner": return female ? "wife" : "husband";
    default: return "relative";
  }
}

export function notableEventsSince(input: LifeStoryInput): readonly NotableEvent[] {
  const { world, characterId } = input;
  const me = world.characters.find((character) => character.id === characterId);
  if (me === undefined) return [];
  const byId = new Map(world.characters.map((character) => [character.id, character]));
  const officeLabel = new Map(allOffices(world, input.government?.offices ?? []).map((office) => [office.id, office.label]));
  const dayLabel = (day: number): string => (input.clock === undefined ? `Day ${day}` : formatWorldDate({ day, minute: 0 }, input.clock));
  const candidates: Candidate[] = [];
  const milestone = (day: number | null, line: string, whose: NotableEvent["whose"], weight: number, involves: readonly string[], key: string): void => {
    // Only what happened in play: a seat or a marriage the scenario opened
    // with is the backstory's to tell.
    if (day === null || day <= 0) return;
    candidates.push({ key, sortKey: day * MINUTES_PER_DAY, whenLabel: dayLabel(day), line, whose, chronicleEntryId: null, weight, involves });
  };

  // --- Close family, as the family graph has it, including those who have died ---
  // `familyLinksOf` gives his own part in each link; the relative's is its reciprocal.
  const kin = new Map<string, FamilyLinkKind>();
  for (const link of world.familyLinks) {
    const mine = link.characterId === characterId ? link.kind : link.relatedCharacterId === characterId ? reciprocalFamilyLinkKind(link.kind) : null;
    if (mine === null) continue;
    const theirs = reciprocalFamilyLinkKind(mine);
    if (!CLOSE.has(theirs)) continue;
    const otherId = link.characterId === characterId ? link.relatedCharacterId : link.characterId;
    const other = byId.get(otherId);
    if (other === undefined) continue;
    kin.set(otherId, theirs);
    const word = kinWord(theirs, other.gender);
    if (theirs === "spouse_or_partner") {
      milestone(link.startedAtStep, `Married ${other.name}`, "yours", WEIGHT.life, [otherId], `married:${link.id}`);
      milestone(link.endedAtStep, `Parted from ${other.name}`, "yours", WEIGHT.life, [otherId], `parted:${link.id}`);
    }
    if (theirs === "child") {
      milestone(other.birthStep ?? link.startedAtStep, other.birthStep === null ? `Took ${other.name} as your ${word}` : `A ${word}, ${other.name}, born`, "yours", WEIGHT.life, [otherId], `child:${link.id}`);
    }
    if (!other.alive) milestone(other.diedAtStep, `Your ${word} ${other.name} died`, "family", WEIGHT.life, [otherId], `died:${otherId}`);
  }
  // Their own lives count as his too: a son elected, a brother married.
  for (const [kinId, kind] of kin) {
    const relative = byId.get(kinId)!;
    const who = `Your ${kinWord(kind, relative.gender)} ${relative.name}`;
    for (const seat of world.material.officeSeats) {
      if (seat.status !== "held" || seat.holderCharacterId !== kinId) continue;
      const label = officeLabel.get(seat.officeId);
      if (label !== undefined) milestone(seat.termStartedAtStep, `${who} took office as ${label}`, "family", WEIGHT.family, [kinId], `kin-office:${seat.id}`);
    }
    if (kind === "child" || kind === "sibling") {
      for (const view of familyLinksOf(world, kinId)) {
        if (view.counterpartCharacterId === characterId || kin.has(view.counterpartCharacterId)) continue;
        const partner = byId.get(view.counterpartCharacterId);
        if (partner === undefined) continue;
        const theirs = reciprocalFamilyLinkKind(view.kind);
        if (theirs === "spouse_or_partner") milestone(view.link.startedAtStep, `${who} married ${partner.name}`, "family", WEIGHT.family, [kinId, partner.id], `kin-married:${view.link.id}`);
        if (theirs === "child" && kind === "child") milestone(partner.birthStep ?? view.link.startedAtStep, `A grandchild, ${partner.name}, born to ${relative.name}`, "family", WEIGHT.family, [kinId, partner.id], `grandchild:${view.link.id}`);
      }
    }
  }

  // --- His own offices ---
  const holding = new Set<string>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId !== characterId) continue;
    holding.add(seat.officeId);
    const label = officeLabel.get(seat.officeId);
    if (label !== undefined) milestone(seat.termStartedAtStep, `Took office as ${label}`, "yours", WEIGHT.office, [], `office:${seat.id}`);
  }
  for (const past of me.officesHeld) {
    const label = officeLabel.get(past.officeId);
    if (label !== undefined && !holding.has(past.officeId)) milestone(past.lastHeldAtStep, `Laid down the office of ${label}`, "yours", WEIGHT.office, [], `left:${past.officeId}`);
  }

  // --- What people have come to say of him ---
  // A trait sticks on the day its second independent observer names it.
  for (const traitId of me.traits) {
    const seen = new Map<string, number>();
    for (const observation of world.traitObservations) {
      if (observation.characterId !== characterId || observation.traitId !== traitId) continue;
      const earlier = seen.get(observation.observerCharacterId);
      if (earlier === undefined || observation.atStep < earlier) seen.set(observation.observerCharacterId, observation.atStep);
    }
    const days = [...seen.values()].sort((a, b) => a - b);
    const settled = days[TRAIT_CORROBORATION - 1];
    if (settled !== undefined) milestone(settled, `Became known as ${traitsInWords([traitId])[0]!.toLowerCase()}`, "yours", WEIGHT.known, [], `known:${traitId}`);
  }

  // --- Promises he kept and broke ---
  for (const promise of world.commitments) {
    if (promise.promisorCharacterId !== characterId || promise.resolvedAtStep === null) continue;
    const to = byId.get(promise.beneficiaryCharacterId)?.name ?? "someone";
    const kept = promise.status === "fulfilled" || promise.status === "partially_fulfilled";
    const broken = promise.status === "broken" || promise.status === "failed";
    if (kept || broken) {
      milestone(promise.resolvedAtStep, `${kept ? "Kept" : "Broke"} your promise to ${to}: ${promise.description}`, "yours", WEIGHT.promise, [promise.beneficiaryCharacterId], `promise:${promise.id}`);
    }
  }

  if (!me.alive) milestone(me.diedAtStep, "Died", "yours", WEIGHT.life * 2, [], "died:self");

  // --- The Chronicle entries about him, or about his close family ---
  const isCharacter = (ref: StoryRef, id: string): boolean => ref.kind === "character" && ref.id === id;
  const chronicled: Candidate[] = [];
  for (const entry of input.entries) {
    const aboutMe = entry.subjects.some((ref) => isCharacter(ref, characterId));
    const aboutKin = [...kin.keys()].filter((id) => entry.subjects.some((ref) => isCharacter(ref, id)));
    if (!aboutMe && aboutKin.length === 0) continue;
    // On the entry's face is what it is about; among its subjects, only what it touches.
    const onFace = entry.tags.some((ref) => isCharacter(ref, characterId));
    chronicled.push({
      key: `entry:${entry.id}`,
      sortKey: entry.sortKey,
      whenLabel: dayLabel(Math.floor(entry.sortKey / MINUTES_PER_DAY)),
      line: entry.title,
      whose: aboutMe ? "yours" : "family",
      chronicleEntryId: entry.id,
      weight: entry.significance + (onFace ? 50 : 0) + (aboutMe ? 0 : -20),
      involves: [...(aboutMe ? [characterId] : []), ...aboutKin],
    });
  }

  // The same event twice: an entry within a day of a milestone, about the
  // people the milestone concerns (or about him, for his own).
  const sameEvent = (entry: Candidate, stone: Candidate): boolean => {
    if (Math.abs(entry.sortKey - stone.sortKey) > MINUTES_PER_DAY) return false;
    const people = stone.involves.length === 0 ? [characterId] : stone.involves;
    return people.some((id) => entry.involves.includes(id)) || (stone.involves.length === 0 && entry.whose === "yours");
  };
  const milestones = candidates.filter((stone) => !chronicled.some((entry) => sameEvent(entry, stone)));

  const limit = input.limit ?? EVENTS_SHOWN;
  const pool = [...milestones, ...chronicled].sort((a, b) => b.weight - a.weight || b.sortKey - a.sortKey);
  const chosen = pool.slice(0, limit);
  // Always the latest thing the record says about him, however slight: the
  // mirror should never be behind the Chronicle.
  const latest = chronicled.filter((entry) => entry.whose === "yours").sort((a, b) => b.sortKey - a.sortKey)[0];
  if (latest !== undefined && !chosen.includes(latest)) chosen.splice(chosen.length - 1, 1, latest);

  return chosen
    .sort((a, b) => b.sortKey - a.sortKey || a.key.localeCompare(b.key))
    .map(({ key, sortKey, whenLabel, line, whose, chronicleEntryId }) => ({ key, sortKey, whenLabel, line, whose, chronicleEntryId }));
}
