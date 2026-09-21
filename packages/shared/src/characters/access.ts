import { buildStation, holdsPolityStanding } from "../authority/station";
import type { DialogueChannel } from "../dialogue/dialogue";
import type { OrderAttempt } from "../authority/order-attempt";
import { allOffices, type Character, type Office } from "./character";
import { isCharacterReachable } from "./reachability";
import type { WorldState } from "../world/world-state";

/**
 * Who you can get a hearing from, and what it takes when you cannot (slice 10).
 *
 * A merchant of Ostia could open a conversation with the consul as easily as
 * the consul's own legate could, because the only thing between them was
 * whether the man was alive and in the province. That is not a world where
 * station means anything, and it is the other half of the same complaint the
 * slice filter answered: the player was told everything and could reach
 * everybody.
 *
 * Two things keep this from being a veto, which is what the branch forbids:
 *
 *  - **An order between them always comes first.** If either has put something
 *    to the other, they can speak, whatever either of them is. A world that
 *    lets you order a man about and not answer him is worse than one that lets
 *    you do neither.
 *  - **Blocked is never the end of it.** Every refusal carries a ladder, and
 *    the last rung is always `write` -- you may always write to anybody. What
 *    you get back is their business, in character, which is the difference
 *    between a locked door and a door you have to knock on.
 *
 * Expressed over any two characters. Never "player versus NPC": one contract
 * for both, or the two drift and the player becomes a special case again.
 */

export type AccessRoute = "answerable" | "already_known" | "station" | "peer" | "public_occasion" | "proximity";

export type LadderRung = "attend" | "ask_intermediary" | "write";

export interface AccessStep {
  readonly rung: LadderRung;
  /** In words, for the player. */
  readonly label: string;
  /** Who this rung goes through, where it goes through somebody. */
  readonly throughCharacterId: string | null;
}

export interface AccessVerdict {
  readonly reachable: boolean;
  /** Why they can, when they can. */
  readonly via: AccessRoute | null;
  /** Why they cannot, when they cannot. Shown to the player. */
  readonly reason: string | null;
  /**
   * What to do about it. Non-empty whenever `reachable` is false -- there is a
   * property test on exactly that, because an empty ladder is a dead end and a
   * dead end is the one thing this branch rules out.
   */
  readonly ladder: readonly AccessStep[];
}

export interface AccessInput {
  readonly world: WorldState;
  readonly offices: readonly Office[];
  readonly reacherId: string;
  readonly targetId: string;
  readonly channel: DialogueChannel;
  /** Orders outstanding between people, so an order always has an answer. */
  readonly orderAttempts?: readonly OrderAttempt[] | undefined;
  /**
   * People an introduction has just been made to, before the world has folded
   * it in. Without this the ladder's own payoff would be barred by the ladder:
   * a man introduced to you a minute ago is not yet in anybody's relations.
   */
  readonly introducedCharacterIds?: ReadonlySet<string> | undefined;
}

/** How much standing separates two people before one of them needs an introduction. */
const PEER_PRESTIGE_BAND_BPS = 2_500;

/**
 * Whether these two have actually had anything to do with each other: a
 * directed relation with at least one cause, either way round, or a family
 * link. Stricter than `station.knownCharacterIds`, which also counts open
 * order attempts and commitments, and it is the honest answer to "does this
 * person know that one".
 */
export function knowsAlready(world: WorldState, reacherId: string, targetId: string): boolean {
  const reacher = world.characters.find((character) => character.id === reacherId);
  const target = world.characters.find((character) => character.id === targetId);
  const named = (character: Character | undefined, otherId: string): boolean =>
    character?.relations.some((relation) => relation.subjectCharacterId === otherId && relation.causes.length > 0) === true;
  if (named(reacher, targetId) || named(target, reacherId)) return true;
  return world.familyLinks.some(
    (link) => (link.characterId === reacherId && link.relatedCharacterId === targetId)
      || (link.characterId === targetId && link.relatedCharacterId === reacherId),
  );
}

function hasOrderBetween(attempts: readonly OrderAttempt[], a: string, b: string): boolean {
  return attempts.some((attempt) => {
    if (attempt.status === "carried_out" || attempt.status === "refused" || attempt.status === "ignored") return false;
    const between = (one: string, other: string): boolean =>
      attempt.issuerRef.kind === "character" && attempt.issuerRef.id === one
      && attempt.recipientRef.kind === "character" && attempt.recipientRef.id === other;
    return between(a, b) || between(b, a);
  });
}

/** Somebody who knows them both, and could say a word. */
function intermediariesBetween(world: WorldState, reacherId: string, targetId: string): string[] {
  return world.characters
    .filter((character) => character.alive && character.id !== reacherId && character.id !== targetId)
    .filter((character) => knowsAlready(world, character.id, targetId) && knowsAlready(world, reacherId, character.id))
    .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))
    .map((character) => character.id);
}

export function whoMayBeReached(input: AccessInput): AccessVerdict {
  const { world, reacherId, targetId, channel } = input;
  const offices = allOffices(world, input.offices);
  const reacher = world.characters.find((character) => character.id === reacherId);
  const target = world.characters.find((character) => character.id === targetId);
  if (reacher === undefined || target === undefined) {
    return { reachable: false, via: null, reason: "There is no such person.", ladder: [] };
  }

  // The existing rule, and the only one that can refuse without a ladder: a
  // dead man cannot be written to either.
  const present = isCharacterReachable(target, channel, reacher.locationProvinceId);
  if (!present.reachable && !target.alive) {
    return { reachable: false, via: null, reason: present.reason, ladder: [] };
  }

  const yes = (via: AccessRoute): AccessVerdict => ({ reachable: true, via, reason: null, ladder: [] });

  // 1. An order between them, either way. First, so nothing can shadow it.
  if (hasOrderBetween(input.orderAttempts ?? [], reacherId, targetId)) return yes("answerable");

  // 2. They have had dealings, they are kin, or somebody has just made the
  //    introduction and the world has not yet caught up with it.
  if (knowsAlready(world, reacherId, targetId)) return yes("already_known");
  if (input.introducedCharacterIds?.has(targetId) === true) return yes("already_known");

  // 3. Station reaches them: an office that speaks for the power they serve,
  //    or a grant naming them, their army or their province.
  const station = buildStation({ world, characterId: reacherId, offices });
  const reachesByStation = (holdsPolityStanding(station) && target.polityId === reacher.polityId)
    || station.knownCharacterIds.has(targetId)
    || station.provinceIds.has(target.locationProvinceId)
    || world.material.forces.some((force) => station.forceIds.has(force.id) && (force.commanderCharacterId === targetId || force.controllerCharacterId === targetId));
  if (reachesByStation) return yes("station");

  // 4. Peers. Two magistrates of the same power, or two men of much the same
  //    standing, need no introduction to each other.
  const officeOf = (characterId: string): Office | undefined => {
    const seat = world.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId === characterId);
    return seat === undefined ? undefined : offices.find((office) => office.id === seat.officeId);
  };
  const bothHoldOffice = officeOf(reacherId) !== undefined && officeOf(targetId) !== undefined;
  const sameStanding = Math.abs(reacher.prestigeBps - target.prestigeBps) <= PEER_PRESTIGE_BAND_BPS;
  if ((bothHoldOffice && reacher.polityId === target.polityId) || (sameStanding && reacher.polityId === target.polityId)) {
    return yes("peer");
  }

  // 5. In public, in the same place. You can put yourself in a magistrate's
  //    way at the forum without anybody's leave; what he does about it is his.
  const inPublic = channel === "in_person_public" || channel === "in_person_private";
  if (inPublic && reacher.locationProvinceId === target.locationProvinceId && officeOf(targetId) !== undefined) {
    return yes("public_occasion");
  }

  // 6. Not out of reach; just not yet reached. The ladder is the play.
  const ladder: AccessStep[] = [];
  if (reacher.locationProvinceId !== target.locationProvinceId) {
    const where = world.map.provinces.find((province) => province.id === target.locationProvinceId)?.name ?? "wherever he is";
    ladder.push({ rung: "attend", label: `Be where he is. He is in ${where}.`, throughCharacterId: null });
  }
  for (const intermediaryId of intermediariesBetween(world, reacherId, targetId).slice(0, 2)) {
    const name = world.characters.find((character) => character.id === intermediaryId)?.name ?? intermediaryId;
    ladder.push({
      rung: "ask_intermediary",
      label: `Ask ${name} to make the introduction. He may, he may not, and he may want something for it.`,
      throughCharacterId: intermediaryId,
    });
  }
  // Always, and always last. You may write to anybody; whether you get an
  // answer is his business, in character. That is what keeps this a door to
  // knock on rather than a lock.
  ladder.push({ rung: "write", label: `Write to ${target.name}, and see whether he answers.`, throughCharacterId: null });

  return {
    reachable: false,
    via: null,
    reason: present.reachable
      ? `${target.name} does not know you, and nothing about your place obliges him to.`
      : present.reason,
    ladder,
  };
}
