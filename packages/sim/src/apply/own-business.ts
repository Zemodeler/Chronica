import type { WorldDelta, WorldState } from "@chronica/shared";

/**
 * Kinds of message a man writes as himself. The rest -- an alliance offered,
 * tribute demanded, an ultimatum -- only mean anything in a power's name, and
 * are judged as that power's act.
 */
const PERSONAL_LETTERS = new Set(["letter", "congratulation", "warning", "protest", "marriage_offer"]);

/**
 * Whether an act is the actor's own business: the private sphere.
 *
 * With no scope of its own, an act fell back to the actor's whole polity and
 * was weighed against authority over it. A private man holds none, so a
 * philosopher teaching, a senator speaking against a motion, a man writing to
 * a friend in Syracuse or a matron endowing a shrine out of her own purse
 * were all recorded as insubordination against the republic.
 *
 * What makes an act private is that it binds nobody but the actor: his own
 * words, his own opinions, his own letters, and what he founds out of his own
 * money. The moment it reaches for an instrument that answers to somebody
 * else -- the treasury, a legion, a power's name on a treaty -- it is not
 * private any more, and is judged as before.
 */
export function isOwnBusiness(
  delta: WorldDelta,
  world: WorldState,
  actorId: string,
  resolve: (ref: string) => string | undefined,
): boolean {
  const id = (ref: string | null | undefined): string | null => ref == null ? null : resolve(ref) ?? ref;
  const isActor = (ref: string | null | undefined): boolean => id(ref) === actorId;
  const ownsAccount = (ref: string | null | undefined): boolean => {
    const account = world.material.accounts.find((candidate) => candidate.id === id(ref));
    return account !== undefined && account.owner.kind === "character" && account.owner.id === actorId;
  };

  switch (delta.op) {
    // Talking, promising, quarrelling: his own, so long as he is in it. The
    // same act written about two other men is somebody else's story.
    case "social_events":
      return delta.events.length > 0 && delta.events.every((event) => event.participantCharacterRefs.some(isActor));
    // What he believes, and what he persuades others of.
    case "belief_set":
      return isActor(delta.holderCharacterRef) || isActor(delta.sourceCharacterRef);
    // Declaring for or against a motion is his voice; how much it weighs is
    // the vote's business, not his authority's.
    case "political_support_set":
      return delta.supporterKind === "character" && isActor(delta.supporterRef);
    // Anyone may write to anyone -- a man or a whole government. Whether they
    // answer is theirs to decide.
    // A letter over some other power's name is a forgery, not a letter.
    case "diplomatic_message_send":
      return PERSONAL_LETTERS.has(delta.kind) && isActor(delta.fromCharacterRef)
        && id(delta.fromPolityId) === world.characters.find((character) => character.id === actorId)?.polityId;
    // A school, a shrine, a company: his, and kept out of his own purse.
    case "generic_entity_create":
      return delta.ownerRef?.kind === "character" && isActor(delta.ownerRef.id)
        && (delta.upkeep == null || ownsAccount(delta.upkeep.fromAccountRef));
    case "generic_entity_update": {
      const entity = world.genericEntities.find((candidate) => candidate.id === id(delta.entityRef));
      return entity?.ownerRef?.kind === "character" && entity.ownerRef.id === actorId
        && (delta.upkeep == null || ownsAccount(delta.upkeep.fromAccountRef));
    }
    // Leaving a job, or letting a man go: the two who made the bargain may end it.
    case "service_contract_close": {
      const contract = world.material.contracts.find((candidate) => candidate.id === id(delta.contractRef));
      if (contract === undefined) return false;
      const payer = world.material.accounts.find((account) => account.id === contract.employerAccountId);
      return contract.employeeCharacterId === actorId || (payer?.owner.kind === "character" && payer.owner.id === actorId);
    }
    // Freeing, selling or indulging his own slave is his household's business.
    case "legal_status_set": {
      const person = world.characters.find((candidate) => candidate.id === id(delta.characterRef));
      return person?.legalStatus === "enslaved" && person.ownerCharacterId === actorId;
    }
    default:
      return false;
  }
}
