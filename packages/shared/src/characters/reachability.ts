import type { DialogueChannel } from "../dialogue/dialogue";

// Canonical reachability (character-sim phase 1).
//
// Dialogue availability is derived from the same `Character` the rest of the
// simulation reads, never from a separately stored `isAvailable` flag: a dead
// character cannot be reachable by any channel, no matter what a per-player
// row still says.

const REQUIRES_PROXIMITY: ReadonlySet<DialogueChannel> = new Set(["in_person_private", "in_person_public"]);

export interface ReachabilityResult {
  readonly reachable: boolean;
  readonly reason: string | null;
}

export interface ReachabilityCharacter {
  readonly name: string;
  readonly alive: boolean;
  readonly locationProvinceId: string | null;
}

export function isCharacterReachable(
  character: ReachabilityCharacter,
  channel: DialogueChannel,
  playerLocationProvinceId: string | null,
): ReachabilityResult {
  if (!character.alive) {
    return { reachable: false, reason: `${character.name} is dead.` };
  }
  if (REQUIRES_PROXIMITY.has(channel) && playerLocationProvinceId !== null && character.locationProvinceId !== playerLocationProvinceId) {
    return { reachable: false, reason: `${character.name} is not in the same place right now.` };
  }
  return { reachable: true, reason: null };
}
