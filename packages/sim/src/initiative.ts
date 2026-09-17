import type { OrderPartyRef, WorldState } from "@chronica/shared";

/**
 * Who has reason to seek the ruler out (VISION §10, §20).
 *
 * NPC-initiated contact previously reached the player through a field on a
 * Chronicle entry, written by the deleted turn resolution. When that went, the
 * capability survived with nothing to trigger it -- an NPC could be given an
 * order, owe a promise, or be in real trouble, and would simply wait forever to
 * be spoken to first.
 *
 * This is the replacement trigger, and it is deliberately deterministic and
 * free: the world already knows who owes the ruler an answer. It costs no model
 * call, because the opening line only has to be true; the character's own voice
 * takes over the moment the player replies.
 *
 * Bounded on purpose. A ruler swarmed by everyone with a grievance would learn
 * to ignore the lot, so only the most pressing reach them, most urgent first.
 */

export interface ContactInitiation {
  readonly characterId: string;
  /** Why they are asking, for inspection and for the Chronicle. */
  readonly reason: string;
  readonly openingLine: string;
}

export interface InitiativeInput {
  readonly world: WorldState;
  readonly playerRef: OrderPartyRef;
  readonly limit?: number;
}

export function whoSeeksThePlayer(input: InitiativeInput): ContactInitiation[] {
  const { world } = input;
  const playerId = input.playerRef.id;
  const alive = (id: string) => world.characters.some((character) => character.id === id && character.alive);
  const found = new Map<string, ContactInitiation>();

  const add = (characterId: string, reason: string, openingLine: string): void => {
    if (characterId === playerId || !alive(characterId) || found.has(characterId)) return;
    found.set(characterId, { characterId, reason, openingLine });
  };

  // Someone the ruler gave an order to, who has not yet answered it. They are
  // the most likely person in the world to want a word.
  for (const attempt of world.orderAttempts) {
    if (attempt.issuerRef.id !== playerId) continue;
    if (attempt.status !== "issued" && attempt.status !== "received" && attempt.status !== "delayed") continue;
    if (attempt.recipientRef.kind !== "character") continue;
    add(
      attempt.recipientRef.id,
      "owes an answer to an order from the ruler",
      `About the charge you laid on me — ${attempt.authorityCheck.reason} — I should speak with you.`,
    );
  }

  // Someone who promised the ruler something, and whose promise has come due.
  for (const commitment of world.commitments) {
    if (commitment.beneficiaryCharacterId !== playerId) continue;
    if (commitment.status !== "pending" && commitment.status !== "deferred") continue;
    if (commitment.reviewAtStep > world.elapsedStep) continue;
    add(
      commitment.promisorCharacterId,
      "has a promise to the ruler that has come due",
      `I have not forgotten what I undertook: ${commitment.description}.`,
    );
  }

  // Someone of the ruler's own who is in serious trouble. Below this intensity
  // people manage their own difficulties, as they should.
  for (const pressure of world.characterPressures) {
    if (pressure.status !== "active" || pressure.intensity < 70) continue;
    const character = world.characters.find((candidate) => candidate.id === pressure.characterId);
    if (character === undefined) continue;
    const player = world.characters.find((candidate) => candidate.id === playerId);
    if (player === undefined || character.polityId !== player.polityId) continue;
    add(pressure.characterId, `is under serious ${pressure.kind}`, `I would not trouble you were it lighter: ${pressure.label}.`);
  }

  return [...found.values()].slice(0, input.limit ?? 2);
}
