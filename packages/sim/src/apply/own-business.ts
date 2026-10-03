import { peaceOfferMetadata, type WorldDelta, type WorldState } from "@chronica/shared";

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
      return PERSONAL_LETTERS.has(peaceOfferMetadata(delta).kind) && peaceOfferMetadata(delta).proposes.length === 0 && isActor(delta.fromCharacterRef)
        && id(delta.fromPolityId) === world.characters.find((character) => character.id === actorId)?.polityId;
    // Answering a letter written to him by name: his own, when it is the kind
    // a man writes as himself and offers nothing a power would have to keep.
    // Written back to by a private man, a friend's letter from Syracuse was
    // judged as his answering for the republic.
    case "diplomatic_message_answer": {
      const letter = world.diplomacy.find((candidate) => candidate.id === id(delta.messageRef));
      return letter !== undefined && letter.toCharacterId === actorId && PERSONAL_LETTERS.has(peaceOfferMetadata(letter).kind)
        && peaceOfferMetadata(letter).proposes.length === 0 && (letter.clauses ?? []).length === 0 && letter.onRefusal == null;
    }
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
    // An officer drilling his own formation: the centurion's maniple, the
    // tribune's legion. Only that, and only his own -- the rest of the army
    // is its commander's to order.
    case "force_modify": {
      const said = Object.entries(delta).filter(([key, value]) => value !== undefined && !["op", "forceRef", "formationRef", "drilling", "reason"].includes(key));
      if (said.length > 0 || delta.drilling === undefined) return false;
      const force = world.material.forces.find((candidate) => candidate.id === id(delta.forceRef));
      if (force === undefined) return false;
      const posts = (force.posts ?? []).filter((post) => post.characterId === actorId);
      // A man in the ranks with no post drilling with his comrades drills his
      // own unit, and nothing else (`practiseInArmy`): a legionary's drill was
      // recorded as insubordination for want of a post (E12).
      const service = world.characters.find((character) => character.id === actorId)?.service;
      if (posts.length === 0) {
        return service?.forceId === force.id && service.formationId !== null && service.unitIndex !== null
          && (delta.formationRef === undefined || id(delta.formationRef) === service.formationId);
      }
      if (delta.formationRef === undefined) return false;
      const formationId = id(delta.formationRef);
      const formation = force.formations?.find((candidate) => candidate.id === formationId);
      if (formation === undefined) return false;
      return posts.some((post) => post.formationId === formation.id
        || (post.unitIndex === null && force.formations?.find((candidate) => candidate.id === post.formationId)?.bodyId === formation.bodyId));
    }
    // Standing for office, or putting a man forward: a candidacy is his own
    // voice, however the chamber takes it. Exempt from the convener's rule in
    // `whoseToGive` and still recorded as a breach (E12).
    case "political_procedure_open":
      return delta.type === "nomination" && (isActor(delta.sponsorCharacterRef) || (delta.subjectKind === "character" && isActor(delta.subjectRef)));
    default:
      return false;
  }
}
