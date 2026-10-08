import { stableHash } from "../determinism";
import type { WorldState } from "../world/world-state";
import type { CharacterKnowledgebase } from "./knowledgebase";
import { createCanonicalNpc, linkCanonicalCharacters } from "./canonical-npc";
import type { FamilyLinkKind } from "./family";

/**
 * The people a player says he has: a wife, a son, a patron, a friend.
 *
 * They were made only where a game was confirmed through the web page, and nowhere else: a game begun any other way (the hand-played bursts, a test) had a
 * player with a declared wife and son who were nobody, a founder whose heir was then a stranger set over his house, and a "friend" who was nowhere. This is
 * the same making, done where the player himself is placed (`materializePlayerCharacter`), a pure projection with fixed ids: the web's confirmation finds
 * them there already, by name, and does not make them twice.
 */

const FAMILY_LINK_BY_ROLE: Readonly<Record<string, FamilyLinkKind>> = {
  parent: "parent", partner: "spouse_or_partner", sibling: "sibling", child: "child", other_relative: "other_relative",
};

/** Roughly how much older than the player each kind of kin is: a father a generation older, a son a generation younger. */
const KIN_AGE_OFFSET: Readonly<Partial<Record<FamilyLinkKind, number>>> = { parent: 25, child: -25, sibling: -2, spouse_or_partner: -5 };

/** How a declared relation stands with him: kin and friends warmly, enemies not at all. The web's reading of a declared connection, said again where the world is made. */
export function declaredConnectionScore(relationship: string, notes = ""): number {
  const context = `${relationship} ${notes}`.toLocaleLowerCase();
  if (/\b(estranged|disowned|feud|bitter|resent|betray|enemy|rival|foe|adversary|opponent)\b/.test(context)) return -55;
  if (/\b(suspicious|distrustful|wary)\b/.test(context)) return -25;
  if (/\b(brother|sister|sibling|spouse|wife|husband|son|daughter|child|parent|mother|father|uncle|aunt|cousin|nephew|niece|family|kin)\b/.test(context)) return 55;
  if (/\b(friend|ally|confidant|mentor|patron|loyal|trusted)\b/.test(context)) return 40;
  if (/\b(client|vassal|subordinate|servant|dependent)\b/.test(context)) return 20;
  return 0;
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** A wife is of the other sex than her husband; anyone else is a woman where the relationship says so in as many words. */
function genderOf(kin: FamilyLinkKind | null, relationship: string, playerGender: "male" | "female"): "male" | "female" {
  if (kin === "spouse_or_partner") return playerGender === "male" ? "female" : "male";
  return /\b(mother|sister|wife|daughter|aunt|niece|grandmother|widow|matron|mistress|concubine|consort|queen|priestess)\b/i.test(relationship) ? "female" : "male";
}

/** The id a declared relation is given: the web's, so that making it in either place is making it once. */
export const declaredKinId = (actorCharacterId: string, name: string): string => `declared-npc-${slug(name)}-${actorCharacterId.replace(/^declared-/, "")}`;

export function withDeclaredKin(world: WorldState, actorCharacterId: string, knowledgebase: CharacterKnowledgebase): WorldState {
  let next = world;
  for (const relation of knowledgebase.relations) {
    if (relation.kind !== "person") continue;
    const player = next.characters.find((candidate) => candidate.id === actorCharacterId);
    if (player === undefined) return world;
    const wanted = relation.name.trim().toLowerCase();
    // Somebody the world already has -- the other consul, a rival senator -- is that man, not a namesake made beside him.
    const known = next.characters.find((candidate) => candidate.alive && candidate.id !== actorCharacterId && candidate.name.trim().toLowerCase() === wanted);
    const npcId = known?.id ?? declaredKinId(actorCharacterId, relation.name);
    const kin = known !== undefined || relation.familyRole === null ? null : FAMILY_LINK_BY_ROLE[relation.familyRole] ?? null;
    const score = declaredConnectionScore(relation.relationship, relation.notes);
    const created = known !== undefined ? { world: next } : createCanonicalNpc(next, {
      characterId: npcId, name: relation.name, polityId: player.polityId, locationProvinceId: player.locationProvinceId, startingMoney: 0,
      createdAtStep: next.elapsedStep, creationReason: `Declared ${relation.relationship} of ${knowledgebase.canonicalName}.`,
      ageYearsAtStart: kin === null ? player.ageYearsAtStart : Math.max(1, player.ageYearsAtStart + (KIN_AGE_OFFSET[kin] ?? 0)),
      gender: genderOf(kin, relation.relationship, player.gender),
      cultureId: player.cultureId, faithId: player.faithId,
    });
    if (created === null) continue;
    next = linkCanonicalCharacters(created.world, actorCharacterId, npcId, relation.relationship, score, next.elapsedStep);
    next = linkCanonicalCharacters(next, npcId, actorCharacterId, relation.relationship, score, next.elapsedStep);
    if (kin !== null && !next.familyLinks.some((link) => link.id === `family-${npcId}`)) {
      next = { ...next, familyLinks: [...next.familyLinks, { id: `family-${npcId}`, characterId: npcId, relatedCharacterId: actorCharacterId, kind: kin, startedAtStep: next.elapsedStep, endedAtStep: null, visibility: "public" as const, provenanceEventId: null }] };
    }
  }
  return next;
}

/** A name no other person of the world bears: a second Gaius Genucius is "the Younger", then "Secundus", then numbered. */
export function nameNotTaken(world: WorldState, name: string, seed: string): string {
  const taken = new Set(world.characters.map((character) => character.name.trim().toLowerCase()));
  if (!taken.has(name.trim().toLowerCase())) return name;
  const suffixes = ["the Younger", "Secundus", "the Elder", "Tertius"];
  const first = stableHash([seed, name, "namesake"]) % suffixes.length;
  for (let at = 0; at < suffixes.length; at += 1) {
    const candidate = `${name} ${suffixes[(first + at) % suffixes.length]}`.slice(0, 120);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} ${2 + (stableHash([seed, name]) % 90)}`.slice(0, 120);
}

/** The words of a man in the ranks of an army, and the words of one who is over them. */
const RANK_AND_FILE = /\b(legionary|legionaries|hastatus|hastati|miles|private|soldier|recruit|conscript|velites|velit|rank and file|man in the ranks|marine|oarsman|rower)\b/i;
const OVER_THEM = /\b(centurion|optio|tribune|legate|legatus|consul|praetor|general|commander|prefect|strategos|admiral|trierarch|captain|veteran|senior|decurion|decurio)\b/i;

/**
 * How old a man is who did not say: a soldier of the line is a young man (seventeen to twenty-five, as the levy took them), anyone else thirty-five. A
 * legionary of the hastati was thirty-five years old for want of a number, and was owed sixteen campaigns for it.
 */
export function ageWhereNoneWasSaid(role: string, seed: string): number {
  // (A possessive is somebody else's: "a legionary in the consul's army" is not a consul.)
  const mine = role.replace(/\b[\p{L}-]+['’]s\b/gu, " ");
  if (RANK_AND_FILE.test(mine) && !OVER_THEM.test(mine)) return 17 + (stableHash([seed, "age"]) % 9);
  return 35;
}
