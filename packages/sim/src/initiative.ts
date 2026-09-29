import { computeOpinion, readDepartments, stableHash, type OrderPartyRef, type WorldState } from "@chronica/shared";

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
      `About the charge you laid on me — ${attempt.instruction} — I should speak with you.`,
    );
  }

  // Someone who refused them, or quietly did otherwise. A refusal reaches the
  // ruler as an entry in the record; the man who made it may also come and say
  // why, which is the difference between a report and a reign.
  for (const attempt of world.orderAttempts) {
    if (attempt.issuerRef.id !== playerId) continue;
    if (attempt.status !== "refused" && attempt.status !== "ignored") continue;
    if (attempt.decidedAtStep === null || world.elapsedStep - attempt.decidedAtStep > 30) continue;
    if (attempt.recipientRef.kind !== "character") continue;
    add(
      attempt.recipientRef.id,
      "did not do as they were asked",
      `You asked me to ${attempt.instruction}. I did not, and you should hear why from me.`,
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
    // A private pressure is one they are hiding. Whatever its weight, a man
    // afraid of being found out does not walk up to the ruler and say so.
    if (pressure.visibility === "private") continue;
    const character = world.characters.find((candidate) => candidate.id === pressure.characterId);
    if (character === undefined) continue;
    const player = world.characters.find((candidate) => candidate.id === playerId);
    if (player === undefined || character.polityId !== player.polityId) continue;
    add(pressure.characterId, `is under serious ${pressure.kind}`, `I would not trouble you were it lighter: ${pressure.label}.`);
  }

  // Then those who want something of the ruler for their own reasons, less
  // urgent than anything above, and each only while the reason is fresh.
  for (const seeker of ownReasons(world, playerId)) add(seeker.characterId, seeker.reason, seeker.openingLine);

  return [...found.values()].slice(0, input.limit ?? 2);
}

/** A grievance this fresh, and this bitter, is worth saying to his face. */
const GRIEVANCE_DAYS = 30;
const GRIEVANCE_OPINION = -40;
/** A friend this warm asks a favour. */
const FRIENDLY_OPINION = 30;
/** A plan step this close to its day is when a man goes looking for help with it. */
const STEP_DUE_WITHIN_DAYS = 15;
/** A man with a venture comes to offer a share in it for a few days a season. */
const OFFER_CYCLE_DAYS = 90;
const OFFER_WINDOW_DAYS = 5;

/**
 * People with business of their own with the ruler: a man with a fresh and
 * bitter grievance against him; a friend whose plan has come to the step he
 * needs help with; a merchant with a venture to offer a share in; and the
 * ruler of an ally whose war has just begun. Every one of these fades when
 * its reason does, so nobody asks twice for ever.
 */
function ownReasons(world: WorldState, playerId: string): ContactInitiation[] {
  const player = world.characters.find((character) => character.id === playerId);
  if (player === undefined) return [];
  const out: ContactInitiation[] = [];
  const today = world.instant.day;
  for (const character of world.characters) {
    if (!character.alive || character.id === playerId) continue;
    // A grievance, fresh and bitter: what he did, in the man's own words.
    const relation = character.relations.find((candidate) => candidate.subjectCharacterId === playerId);
    const latest = relation === undefined ? undefined : [...relation.causes].sort((a, b) => b.occurredAtStep - a.occurredAtStep)[0];
    const opinion = computeOpinion(character, playerId);
    if (latest !== undefined && latest.score < 0 && world.elapsedStep - latest.occurredAtStep <= GRIEVANCE_DAYS && opinion <= GRIEVANCE_OPINION) {
      out.push({ characterId: character.id, reason: "has a grievance against the ruler", openingLine: `I will say it to your face, since you will hear it anyway: ${latest.label}` });
      continue;
    }
    // A friend of his own power, at the step of his plan he cannot take alone.
    if (opinion >= FRIENDLY_OPINION && character.polityId === player.polityId) {
      const wanting = character.ambitions.find((ambition) => ambition.status === "active"
        && ambition.steps.some((step) => step.status === "pending" && step.dueDay >= today && step.dueDay - today <= STEP_DUE_WITHIN_DAYS));
      if (wanting !== undefined) {
        out.push({ characterId: character.id, reason: "wants the ruler's help with his own aims", openingLine: `I have a favour to ask of you, as a friend: ${wanting.label}.` });
        continue;
      }
    }
    // A man with a venture, wanting the ruler's purse or protection for it --
    // a few days in every season, his own, so he comes by now and then
    // rather than every time the ruler looks up.
    const offering = (world.elapsedStep + stableHash([character.id, "offer"])) % OFFER_CYCLE_DAYS < OFFER_WINDOW_DAYS;
    if (offering && opinion >= 0 && (character.polityId === player.polityId || character.locationProvinceId === player.locationProvinceId)) {
      const venture = world.material.incomeSources.find((source) => source.active && source.originKind === "venture"
        && source.beneficiaryAccountId === character.personalAccountId);
      if (venture !== undefined) {
        out.push({ characterId: character.id, reason: "has a venture to offer the ruler a part in", openingLine: `There is money to be made in ${venture.label}, and room in it for a man like you.` });
      }
    }
  }
  // An ally's ruler whose war has just begun, asking for what the alliance promised.
  if (player.polityId !== null) {
    for (const alliance of world.polityAgreements.filter((agreement) => agreement.status === "active" && agreement.kind === "alliance"
      && (agreement.polityId === player.polityId || agreement.otherPolityId === player.polityId))) {
      const allyId = alliance.polityId === player.polityId ? alliance.otherPolityId : alliance.polityId;
      const war = world.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "war"
        && (agreement.polityId === allyId || agreement.otherPolityId === allyId) && world.elapsedStep - agreement.sinceStep <= GRIEVANCE_DAYS
        && agreement.polityId !== player.polityId && agreement.otherPolityId !== player.polityId);
      const ruler = war === undefined ? undefined : readDepartments(world).rulers(allyId)[0];
      if (war === undefined || ruler === undefined) continue;
      const enemyId = war.polityId === allyId ? war.otherPolityId : war.polityId;
      const enemy = world.map.polities.find((polity) => polity.id === enemyId)?.name ?? enemyId;
      out.push({ characterId: ruler.id, reason: "an ally at war asks for help", openingLine: `We are at war with ${enemy}, and I am asking for what our alliance promised.` });
    }
  }
  return out;
}
