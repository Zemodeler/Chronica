import { currentAgeYears } from "../characters/age";
import { familyLinksOf, reciprocalFamilyLinkKind, type FamilyLinkKind } from "../characters/family";
import type { SocialLinkKind } from "../characters/relationship-dimensions";
import { alliesLedBy } from "../world/agreements";
import type { WorldState } from "../world/world-state";
import { entityKey, type Linked } from "./glossary";

/**
 * Compared with you, and their people.
 *
 * CK3 sets every name against the player: stronger than you, richer, more
 * loved. Here each comparison is said in words and built only from what the
 * viewer could know. Land is on the map. Renown and offices held are public.
 * Another power's men are counted as the viewer's sources count them, so a
 * power nobody has reported on is "unknown to you", never a real figure.
 */

export interface ComparedLine {
  /** "On land", "Renown". */
  readonly aspect: string;
  /** "far stronger than yours", "about as renowned as you", "unknown to you". */
  readonly label: string;
}

/** A ratio in words, for a thing the other has "more" or "less" of. */
function scale(theirs: number, yours: number, more: string, less: string, same: string): string {
  if (theirs === 0 && yours === 0) return same;
  if (yours === 0) return `far ${more}`;
  const ratio = theirs / yours;
  if (ratio >= 2) return `far ${more}`;
  if (ratio >= 1.25) return more;
  if (ratio > 0.8) return same;
  if (ratio > 0.5) return less;
  return `far ${less}`;
}

export interface PowerStrength {
  /** The viewer's estimate of its men, or null where nobody has reported any. */
  readonly men: number | null;
}

export function comparePowers(
  world: WorldState,
  ownPolityId: string,
  otherPolityId: string,
  ownMen: number,
  theirs: PowerStrength,
): ComparedLine[] {
  const held = (polityId: string): number => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;
  const lines: ComparedLine[] = [
    { aspect: "Land", label: scale(held(otherPolityId), held(ownPolityId), "more land than yours", "less land than yours", "about as much land as yours") },
    {
      aspect: "Under arms",
      label: theirs.men === null ? "unknown to you" : scale(theirs.men, ownMen, "stronger than yours, as far as you know", "weaker than yours, as far as you know", "about as strong as yours, as far as you know"),
    },
  ];
  const allies = (polityId: string): number => alliesLedBy(world.polityAgreements, polityId).length;
  if (allies(otherPolityId) > 0 || allies(ownPolityId) > 0) {
    lines.push({ aspect: "Allies", label: scale(allies(otherPolityId), allies(ownPolityId), "more allies than yours", "fewer allies than yours", "about as many allies as yours") });
  }
  return lines;
}

const clientsOf = (world: WorldState, characterId: string): number =>
  world.material.politicalGroups
    .filter((group) => group.active && group.type === "clientele" && group.leaderCharacterId === characterId)
    .reduce((sum, group) => sum + (group.strengthBps ?? 1_000), 0);

const officesOf = (world: WorldState, characterId: string): number => {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  const held = new Set(character?.officesHeld.map((office) => office.officeId) ?? []);
  for (const seat of world.material.officeSeats) if (seat.status === "held" && seat.holderCharacterId === characterId) held.add(seat.officeId);
  return held.size;
};

export function comparePeople(world: WorldState, viewerId: string, subjectId: string): ComparedLine[] {
  const viewer = world.characters.find((character) => character.id === viewerId);
  const subject = world.characters.find((character) => character.id === subjectId);
  if (viewer === undefined || subject === undefined) return [];
  const lines: ComparedLine[] = [
    { aspect: "Renown", label: scale(subject.prestigeBps, viewer.prestigeBps, "better known than you", "less known than you", "about as well known as you") },
  ];
  const offices = [officesOf(world, subjectId), officesOf(world, viewerId)] as const;
  if (offices[0] > 0 || offices[1] > 0) {
    lines.push({ aspect: "Offices", label: offices[0] === offices[1] ? "as many offices held as you" : offices[0] > offices[1] ? "more offices held than you" : "fewer offices held than you" });
  }
  const clients = [clientsOf(world, subjectId), clientsOf(world, viewerId)] as const;
  if (clients[0] > 0 || clients[1] > 0) {
    lines.push({ aspect: "Clients", label: clients[0] === 0 ? "none that you know of" : scale(clients[0], clients[1], "more clients than you", "fewer clients than you", "about as many clients as you") });
  }
  const age = currentAgeYears(subject, world.elapsedStep) - currentAgeYears(viewer, world.elapsedStep);
  if (Math.abs(age) >= 3) lines.push({ aspect: "Age", label: `${Math.abs(age) >= 15 ? "much " : ""}${age > 0 ? "older" : "younger"} than you` });
  return lines;
}

export interface PersonTie {
  /** "his son", "his patron", "leads". */
  readonly role: string;
  readonly who: Linked;
}

function kinRole(kind: FamilyLinkKind, female: boolean): string | null {
  switch (kind) {
    case "parent": return female ? "mother" : "father";
    case "child": return female ? "daughter" : "son";
    case "sibling": return female ? "sister" : "brother";
    case "spouse_or_partner": return female ? "wife" : "husband";
    case "other_relative": return "kinsman";
    default: return null;
  }
}

/** What X is to S when S holds a tie of this kind to X, turned round. */
const TURNED: Readonly<Partial<Record<SocialLinkKind, SocialLinkKind>>> = {
  patron: "client", client: "patron", commander: "subordinate", subordinate: "commander", creditor: "debtor", debtor: "creditor",
};

const TIE_ROLE: Readonly<Partial<Record<SocialLinkKind, string>>> = {
  patron: "patron", client: "client", rival: "rival", friend: "friend", ally: "ally", enemy: "enemy", commander: "commander", subordinate: "man under", creditor: "creditor", debtor: "debtor",
};

/**
 * A person's people: kin, patrons and clients, friends and rivals, and what
 * they lead. Ties only where they are public, or the viewer's own.
 */
export function theirPeople(world: WorldState, viewerId: string, subjectId: string, limit = 8): PersonTie[] {
  const subject = world.characters.find((character) => character.id === subjectId);
  if (subject === undefined) return [];
  const his = subject.gender === "female" ? "her" : "his";
  const person = (id: string): Linked | null => {
    const found = world.characters.find((character) => character.id === id);
    return found === undefined ? null : { label: found.name, key: entityKey("person", id) };
  };
  const ties: PersonTie[] = [];
  const seen = new Set<string>();
  const add = (role: string, id: string) => {
    if (id === viewerId || seen.has(id)) return;
    const who = person(id);
    if (who === null) return;
    seen.add(id);
    ties.push({ role, who });
  };

  for (const link of familyLinksOf(world, subjectId)) {
    const counterpart = world.characters.find((character) => character.id === link.counterpartCharacterId);
    if (counterpart === undefined || !counterpart.alive) continue;
    const role = kinRole(reciprocalFamilyLinkKind(link.kind), counterpart.gender === "female");
    if (role !== null) add(`${his} ${role}`, counterpart.id);
  }
  for (const link of world.socialLinks) {
    const open = link.visibility === "public" || link.subjectCharacterId === viewerId || link.targetCharacterId === viewerId;
    if (!open || link.kind === "kin" || link.kind === "spouse") continue;
    // A tie held by S towards T of kind k: T is S's k.
    if (link.subjectCharacterId === subjectId) {
      const role = TIE_ROLE[link.kind];
      if (role !== undefined) add(`${his} ${role}`, link.targetCharacterId);
    } else if (link.targetCharacterId === subjectId) {
      const role = TIE_ROLE[TURNED[link.kind] ?? link.kind];
      if (role !== undefined) add(`${his} ${role}`, link.subjectCharacterId);
    }
  }
  return ties.slice(0, limit);
}

/** Groups a person leads, in words: "leads the clients of the Curii". */
export function groupsLedBy(world: WorldState, characterId: string): string[] {
  return world.material.politicalGroups
    .filter((group) => group.active && group.leaderCharacterId === characterId && group.type !== "household")
    .slice(0, 3)
    .map((group) => group.name);
}
