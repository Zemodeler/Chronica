import type { CastMember, CastSeat, WorldState } from "@chronica/shared";
import type { NarratorSeed } from "./narrator";
import type { PlayerInterests } from "./cognition-policy";

/**
 * Far men rest between asks (the user's rule, 2026-10-08: model calls are for the plots and plans of people near the player and for the
 * cast around him; a far ruler is never kept in the loop every round; the count stays near six a turn).
 *
 * The cast's "world" seat gives the model a voice or two of the wider world, so the world has more than Romans in it. It does not give them a
 * seat in every round: a foreign ruler is asked once, and then left to the rules for `FAR_REST_DAYS` unless something of the player's
 * touches him (an order he holds, a letter between him and the player, a request). The playtests asked Hanno of Carthage twenty and thirty
 * times in a run, a ruler of the Boii and a Massalia priest as often, and wrote rules for the censuses of far peoples on the player's order
 * text as "what was said".
 */

/** How long a far man in the cast is left to the rules after the model has been asked about him. */
export const FAR_REST_DAYS = 45;

/** The same for a wider-world man who is near the player's places (a ruler across the strait while the army is there): news and his own plans still wake him, but not every week. */
export const NEAR_WORLD_REST_DAYS = 21;

/** The seats that are the wider world's: a far man in one of them rests; the nemesis, the chain and the friends are the player's own and do not. */
const THE_WIDER_WORLD: ReadonlySet<CastSeat> = new Set<CastSeat>(["world", "open"]);

/** Whether a man of the cast is far from the player: in a wider-world seat and neither near the places the player holds nor in his circle. */
export function aFarCastMan(world: WorldState, member: Pick<CastMember, "characterId" | "seat">, interests: Pick<PlayerInterests, "nearPlaces">, circle: ReadonlySet<string>): boolean {
  if (!THE_WIDER_WORLD.has(member.seat)) return false;
  if (circle.has(member.characterId)) return false;
  const person = world.characters.find((candidate) => candidate.id === member.characterId);
  return person !== undefined && !interests.nearPlaces.has(person.locationProvinceId);
}

/** The player's own circle: those he has a kept relation with, whoever is set against him, and the cast's seats that are his (the nemesis, his chain, his friends), but not the wider world's voices. */
export function circleOf(world: WorldState, playerId: string | null): ReadonlySet<string> {
  const circle = new Set<string>();
  const player = world.characters.find((candidate) => candidate.id === playerId);
  if (player === undefined) return circle;
  for (const relation of player.relations) if (relation.causes.length > 0) circle.add(relation.subjectCharacterId);
  for (const nemesis of world.nemeses) if (nemesis.targetCharacterId === player.id && nemesis.retiredAtStep === null) circle.add(nemesis.characterId);
  for (const member of world.cast.members) if (!THE_WIDER_WORLD.has(member.seat)) circle.add(member.characterId);
  return circle;
}

/** Who the player's own business reaches this day: holders of his orders and the other end of a letter between him and a man. */
export function touchedByThePlayer(world: WorldState, playerId: string | null): ReadonlySet<string> {
  const touched = new Set<string>();
  if (playerId === null) return touched;
  for (const attempt of world.orderAttempts) {
    if (attempt.issuerRef.id === playerId && ["issued", "received", "delayed", "accepted"].includes(attempt.status)) touched.add(attempt.recipientRef.id);
  }
  for (const message of world.diplomacy) {
    if (message.status !== "awaiting_reply") continue;
    if (message.fromCharacterId === playerId && message.toCharacterId !== null) touched.add(message.toCharacterId);
    if (message.toCharacterId === playerId && message.fromCharacterId !== null) touched.add(message.fromCharacterId);
  }
  return touched;
}

/**
 * Whether a man is left to the rules this round: in the wider world's seat (not the player's circle), asked about within the rest (`FAR_REST_DAYS` far,
 * `NEAR_WORLD_REST_DAYS` near), and not touched by the player.
 * `lastAskedStep` is when the model was last asked about him (`cognition-memory.ts`, kept on the world), null if never.
 */
export function aFarManRests(
  world: WorldState,
  member: Pick<CastMember, "characterId" | "seat">,
  interests: Pick<PlayerInterests, "nearPlaces">,
  circle: ReadonlySet<string>,
  touched: ReadonlySet<string>,
  lastAskedStep: number | null,
  rests: { readonly far?: number | undefined; readonly near?: number | undefined } = {},
): boolean {
  if (lastAskedStep === null || touched.has(member.characterId) || circle.has(member.characterId) || !THE_WIDER_WORLD.has(member.seat)) return false;
  return world.elapsedStep - lastAskedStep < (aFarCastMan(world, member, interests, circle) ? rests.far ?? FAR_REST_DAYS : rests.near ?? NEAR_WORLD_REST_DAYS);
}

/**
 * Whether a stirring of the world is within the player's reach: it falls on his own realm, on ground near the places he holds, on a person of his
 * circle or on him. Far stirrings are the world's own; the orchestrator carries out only what the player can touch (the "world stirs" of his order).
 */
export function aSeedIsWithinReach(seed: NarratorSeed, interests: Pick<PlayerInterests, "nearPlaces">, circle: ReadonlySet<string>, playerId: string | null): boolean {
  if (seed.inPlayerRealm) return true;
  const { provinceId, characterId, forceId, polityId } = seed.target;
  if (provinceId === null && characterId === null && forceId === null && polityId === null) return true;
  if (characterId !== null && (characterId === playerId || circle.has(characterId))) return true;
  if (provinceId !== null && interests.nearPlaces.has(provinceId)) return true;
  return false;
}

/**
 * Whether an arrangement's owner is one the player's business touches, so that a rule is written for it by the model: the player, his circle, a man
 * near the places he holds, a power he deals with. A far people's census, a far ruler's levy, is left as the plain arrangement and run by the engine's
 * own defaults; it is never written up on the player's order text (`a-turn-spends-few-calls.test.ts`).
 */
export function anOwnerIsNear(
  world: WorldState,
  owner: { readonly kind: string; readonly id: string },
  playerId: string | null,
  interests: Pick<PlayerInterests, "nearPlaces">,
  circle: ReadonlySet<string>,
  near: ReadonlySet<string> | null,
): boolean {
  if (playerId === null) return true;
  if (owner.kind === "character") {
    if (owner.id === playerId || circle.has(owner.id)) return true;
    const person = world.characters.find((candidate) => candidate.id === owner.id);
    return person !== undefined && interests.nearPlaces.has(person.locationProvinceId);
  }
  if (owner.kind === "polity") return near === null || near.has(owner.id);
  return true;
}
