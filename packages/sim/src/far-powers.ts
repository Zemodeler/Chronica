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
