import { peopleYouKnow, type PersonReading } from "./acquaintance";
import { whoMayBeReached } from "./access";
import { inTheSameRegion } from "./reachability";
import { allOffices, type Office } from "./character";
import { buildStation } from "../authority/station";
import type { WorldState } from "../world/world-state";
import type { ScenarioClock } from "../world/clock";

/**
 * The letter tray's list of people: everyone the player knows of, and the
 * public figures anyone would -- grouped, and each with whether they can be
 * reached and what it would take.
 *
 * The tray used to list only people already spoken to, so the first thing a
 * player met was an empty column and a free-text box. The engine already
 * knew whom the player had dealt with, written to or heard of
 * (`peopleYouKnow`), and every sitting officeholder is public by nature: a
 * consul knows who reigns in Syracuse. Nobody else is listed. A conspirator
 * nobody has discovered does not turn up in a letter tray.
 */

export type DirectoryHow = "speaking" | PersonReading["how"] | "public";
export type DirectoryReach = "here" | "letter";

export interface DirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly officeLabel: string | null;
  readonly polityLabel: string | null;
  readonly whereLabel: string | null;
  readonly how: DirectoryHow;
  readonly reach: DirectoryReach;
  /** "Here in Latium" or "By letter". */
  readonly reachLabel: string;
  /**
   * What it would take to be heard in person, when a letter is all there is
   * yet. Never the writing itself: the tray is where that is done.
   */
  readonly ladder: readonly string[];
  /** What the player knows of them, for the dossier. Empty for a public figure only. */
  readonly knownFor: readonly string[];
  readonly standingLabel: string | null;
  readonly opinionLabel: string | null;
  readonly ties: readonly string[];
}

export interface DirectoryGroup {
  readonly key: string;
  readonly label: string;
  readonly people: readonly DirectoryEntry[];
}

export interface DirectoryInput {
  readonly world: WorldState;
  readonly viewerId: string;
  readonly conversationPartnerIds?: readonly string[] | undefined;
  readonly offices?: readonly Office[] | undefined;
  readonly clock?: ScenarioClock | undefined;
}

const FAMILY: ReadonlySet<string> = new Set(["kin", "spouse"]);

export function lettersDirectory(input: DirectoryInput): readonly DirectoryGroup[] {
  const { world, viewerId } = input;
  const offices = input.offices ?? [];
  const viewer = world.characters.find((character) => character.id === viewerId);
  if (viewer === undefined) return [];
  const station = buildStation({ world, characterId: viewerId, offices });
  const speaking = new Set(input.conversationPartnerIds ?? []);
  const known = new Map(peopleYouKnow({ ...input, offices }).map((person) => [person.id, person]));

  const officeById = new Map(allOffices(world, offices).map((office) => [office.id, office]));
  const heldOffice = new Map<string, string>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const office = officeById.get(seat.officeId);
    if (office !== undefined && !heldOffice.has(seat.holderCharacterId)) heldOffice.set(seat.holderCharacterId, office.label);
  }
  const polityName = (id: string | null): string | null => (id === null ? null : world.map.polities.find((polity) => polity.id === id)?.name ?? null);
  const provinceName = (id: string | null): string | null => (id === null ? null : world.map.provinces.find((province) => province.id === id)?.name ?? null);
  const commanders = new Set(world.material.forces.filter((force) => station.forceIds.has(force.id)).map((force) => force.commanderCharacterId));

  const listed = world.characters.filter((character) =>
    character.id !== viewerId && character.alive && (known.has(character.id) || heldOffice.has(character.id) || speaking.has(character.id)));

  const entries = listed.map((character): DirectoryEntry & { group: string; order: number } => {
    const person = known.get(character.id);
    const verdict = whoMayBeReached({
      world, offices, reacherId: viewerId, targetId: character.id, channel: "correspondence", orderAttempts: world.orderAttempts,
    });
    // Somebody in the same region who will give you a hearing is spoken
    // with. Anybody else is written to -- you may always write to anybody --
    // and answers, or does not, when the world next moves.
    const reach: DirectoryReach = verdict.reachable && inTheSameRegion(character, viewer) ? "here" : "letter";
    const here = provinceName(character.locationProvinceId);
    const family = person?.ties.some((tie) => FAMILY.has(tie.kind)) ?? false;

    let group: string;
    let order: number;
    if (speaking.has(character.id)) { group = "speaking"; order = 0; }
    else if (family) { group = "family"; order = 1; }
    else if (commanders.has(character.id)) { group = "yours"; order = 2; }
    else if (character.polityId !== null && character.polityId === viewer.polityId) { group = `polity:${character.polityId}`; order = 3; }
    else if (character.polityId !== null) { group = `polity:${character.polityId}`; order = 4; }
    else { group = "unaligned"; order = 5; }

    return {
      id: character.id,
      name: character.name,
      officeLabel: heldOffice.get(character.id) ?? person?.officeLabel ?? null,
      polityLabel: polityName(character.polityId),
      whereLabel: person?.whereLabel ?? null,
      how: speaking.has(character.id) ? "speaking" : person?.how ?? "public",
      reach,
      reachLabel: reach === "here" ? `Here${here === null ? "" : ` in ${here}`}` : "By letter",
      ladder: verdict.reachable ? [] : verdict.ladder.filter((step) => step.rung !== "write").map((step) => step.label),
      knownFor: person?.knownForLabels ?? [],
      standingLabel: person?.standingLabel ?? null,
      opinionLabel: person?.yourOpinionLabel ?? null,
      ties: person?.ties.map((tie) => tie.label) ?? [],
      group,
      order,
    };
  });

  const labelFor = (group: string): string => {
    if (group === "speaking") return "Speaking with";
    if (group === "family") return "Family";
    if (group === "yours") return "Those who answer to you";
    if (group === "unaligned") return "Of no power";
    return polityName(group.slice("polity:".length)) ?? "Another power";
  };

  const groups = new Map<string, { order: number; people: DirectoryEntry[] }>();
  for (const { group, order, ...entry } of entries) {
    const held = groups.get(group) ?? { order, people: [] };
    held.people.push(entry);
    groups.set(group, held);
  }
  // Within a group, the people who hold office first, then by name.
  return [...groups]
    .sort(([a, x], [b, y]) => x.order - y.order || labelFor(a).localeCompare(labelFor(b)))
    .map(([key, { people }]) => ({
      key,
      label: labelFor(key),
      people: people.sort((a, b) => Number(b.officeLabel !== null) - Number(a.officeLabel !== null) || a.name.localeCompare(b.name)),
    }));
}
