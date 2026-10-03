import { adjacentTo, alliesLedBy, leaderOf, type WorldState } from "@chronica/shared";
import { readBoard } from "./board";

/**
 * The powers whose ordinary business is the player's news: his own, those it
 * borders, treats with, fights, or writes to. The rest of the world's
 * calendar -- ninety chiefs laying down their offices on one March day, the
 * Veneti and Aeolis electing their magistrates -- happens, and is known to
 * their own people, but is not told to Rome as public news.
 *
 * Null where there is no player to measure from: everything is near.
 */
export function powersNearThePlayer(world: WorldState, playerCharacterId: string | null | undefined): ReadonlySet<string> | null {
  if (playerCharacterId == null) return null;
  const own = world.characters.find((character) => character.id === playerCharacterId)?.polityId ?? null;
  if (own === null) return null;
  const near = new Set<string>([own]);
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active") continue;
    if (agreement.polityId === own) near.add(agreement.otherPolityId);
    if (agreement.otherPolityId === own) near.add(agreement.polityId);
  }
  for (const message of world.diplomacy) {
    if (message.fromPolityId === own) near.add(message.toPolityId);
    if (message.toPolityId === own) near.add(message.fromPolityId);
  }
  const controller = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  for (const province of world.map.provinces) {
    if (province.controllerPolityId !== own) continue;
    for (const { provinceId } of adjacentTo(world, province.id)) {
      const holder = controller.get(provinceId);
      if (holder != null) near.add(holder);
    }
  }
  return near;
}

/** "public" for a near power, "polity" -- its own people's news -- for a far one. */
export function newsReach(near: ReadonlySet<string> | null, polityId: string | null | undefined): "public" | "polity" {
  return near === null || polityId == null || near.has(polityId) ? "public" : "polity";
}

/**
 * The powers a government has business with, for what its slice shows of
 * other powers' aims and treaties: those `powersNearThePlayer` names, and
 * besides them everyone across the borders of the bloc it leads or follows --
 * Carthage touches Rome only through Rome's allies -- and every power it
 * trusts or distrusts, or that trusts or distrusts it. Null where there is no
 * player to measure from.
 */
export function powersDealtWith(world: WorldState, playerCharacterId: string | null | undefined): ReadonlySet<string> | null {
  const near = powersNearThePlayer(world, playerCharacterId);
  if (near === null) return null;
  const own = world.characters.find((character) => character.id === playerCharacterId)?.polityId ?? null;
  if (own === null) return near;
  const dealt = new Set(near);
  const leader = leaderOf(world.polityAgreements, own) ?? own;
  const bloc = [leader, ...alliesLedBy(world.polityAgreements, leader)];
  const board = readBoard(world);
  for (const member of bloc) {
    dealt.add(member);
    for (const neighbour of board.get(member)?.neighbours ?? []) dealt.add(neighbour.polityId);
  }
  for (const stance of world.polityStances) {
    if (stance.polityId === own) dealt.add(stance.towardPolityId);
    if (stance.towardPolityId === own) dealt.add(stance.polityId);
  }
  return dealt;
}

/** How many days back a letter still makes two powers each other's news. */
export const NEWS_LETTER_DAYS = 365;
/** How far trust must lean, either way, before a stance alone makes a power the player's news. */
export const NEWS_STANCE_MAGNITUDE = 25;
/** What a power nobody has dealings with is worth, as news: the wider world is not nothing, only far. */
export const STRANGER_RELATION = 0.3;

/** The agreements that make another power's wars the player's own news. */
const BINDING_AGREEMENTS: ReadonlySet<string> = new Set(["war", "alliance", "foedus", "protectorate", "tributary"]);

/**
 * How much each power's news is the player's, from 0.3 to 1 (L16).
 *
 * `powersDealtWith` answers a yes-or-no question for the slice -- which
 * powers' aims and treaties a government can see -- and answers it broadly:
 * every power ever written to, every neighbour of every member of the bloc,
 * any stance at all. Used for news it made two-thirds of the world "dealt
 * with", and a war between two of them was told to Rome at full weight. News
 * is a matter of degree: a power at war or in alliance with the player's own
 * is the whole of it; a neighbour of his own ground most of it; a power he has
 * written to this year, or that leans hard for or against him, half; anybody
 * else the stranger's share. Powers not in the map are strangers.
 *
 * Null where there is no player to measure from.
 */
export function newsRelations(world: WorldState, playerCharacterId: string | null | undefined): ReadonlyMap<string, number> | null {
  if (playerCharacterId == null) return null;
  const own = world.characters.find((character) => character.id === playerCharacterId)?.polityId ?? null;
  if (own === null) return null;
  const relation = new Map<string, number>([[own, 1]]);
  const raise = (polityId: string, value: number): void => {
    if (polityId !== own) relation.set(polityId, Math.max(relation.get(polityId) ?? 0, value));
  };
  // His power, and the leader whose wars and peaces are its own.
  const sides = new Set([own, ...(leaderOf(world.polityAgreements, own) === null ? [] : [leaderOf(world.polityAgreements, own)!])]);
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active") continue;
    const other = sides.has(agreement.polityId) ? agreement.otherPolityId : sides.has(agreement.otherPolityId) ? agreement.polityId : null;
    if (other !== null) raise(other, BINDING_AGREEMENTS.has(agreement.kind) ? 1 : 0.5);
  }
  const controller = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  for (const province of world.map.provinces) {
    if (province.controllerPolityId !== own) continue;
    for (const { provinceId } of adjacentTo(world, province.id)) {
      const holder = controller.get(provinceId);
      if (holder != null) raise(holder, 0.8);
    }
  }
  for (const message of world.diplomacy) {
    if (message.sentAtStep < world.elapsedStep - NEWS_LETTER_DAYS) continue;
    if (message.fromPolityId === own) raise(message.toPolityId, 0.5);
    if (message.toPolityId === own) raise(message.fromPolityId, 0.5);
  }
  for (const stance of world.polityStances) {
    if (Math.abs(stance.trustScore) < NEWS_STANCE_MAGNITUDE) continue;
    if (stance.polityId === own) raise(stance.towardPolityId, 0.5);
    if (stance.towardPolityId === own) raise(stance.polityId, 0.5);
  }
  return relation;
}
