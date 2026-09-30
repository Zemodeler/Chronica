import {
  breakCommitment,
  cancelCommitment,
  checkCommitmentAuthority,
  deferCommitment,
  fulfillCommitment,
  isConditionalPromise,
  promiseFormOf,
  type Commitment,
  type CommitmentResolutionResult,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";
import { kinOf, remember, teach, type Grievance } from "./grievances";

/**
 * Promises kept and broken (character-sim, commitments).
 *
 * A promise made in conversation became a commitment the world was meant to
 * hold its maker to -- and nothing ever held anybody to anything. No code
 * marked one kept, none marked one broken, and `breakCommitment` had no
 * caller: a man could swear to bring his legion to your side, stay at home,
 * and be as welcome at your door the next spring. The player's promises sat in
 * the mirror for ever.
 *
 * Now each is settled on its day by what the world shows was done:
 *
 * - kept, the moment the deed is on the record -- the money paid, the vote
 *   cast, the army standing by him, the office given, the letter written --
 *   or when the promisor himself says in his answer that he has kept it
 *   (`claimPromisesKept`, from the same "stepsTaken" a plan step goes in);
 * - on its day, a man with a promised payment in hand simply pays it;
 * - otherwise it is given one grace of `GRACE_DAYS`, while he still can, and
 *   then it is broken: the promisor's standing suffers (`breakCommitment`),
 *   and the man he failed, and that man's kin, remember it.
 *
 * Nothing here asks the model anything.
 */

/** Days of grace a promise gets past its day, once, before it is broken. */
export const GRACE_DAYS = 14;

const OPEN: ReadonlySet<Commitment["status"]> = new Set(["pending", "prepared", "deferred", "partially_fulfilled"]);

export interface PromiseInput {
  readonly world: WorldState;
  readonly toDay: number;
  /** The player never pays by the engine's hand: his money moves by his orders. */
  readonly playerCharacterId: string | null;
}

/** What the record shows was done for the beneficiary since the promise was made. */
export function keptOnTheRecord(world: WorldState, commitment: Commitment): string | null {
  const promisor = world.characters.find((character) => character.id === commitment.promisorCharacterId);
  const beneficiary = world.characters.find((character) => character.id === commitment.beneficiaryCharacterId);
  if (promisor === undefined || beneficiary === undefined) return null;
  const since = commitment.createdAtStep;

  switch (commitment.actionKind) {
    case "payment": {
      const his = new Set(world.material.accounts.filter((account) => account.owner.kind === "character" && account.owner.id === promisor.id).map((account) => account.id));
      const theirs = new Set(world.material.accounts.filter((account) => account.owner.kind === "character" && account.owner.id === beneficiary.id).map((account) => account.id));
      const paid = world.material.transactions
        .filter((transaction) => transaction.atStep >= since
          && transaction.sourceAccountId !== undefined && his.has(transaction.sourceAccountId)
          && transaction.destinationAccountId !== undefined && theirs.has(transaction.destinationAccountId))
        .reduce((total, transaction) => total + transaction.amount, 0);
      const owed = commitment.requiredResource?.minAmount ?? 1;
      return paid >= owed ? `${promisor.name} paid ${paid}` : null;
    }
    case "political_support": {
      const theirQuestions = new Set(world.material.politicalProcedures.filter((procedure) => procedure.sponsorCharacterId === beneficiary.id).map((procedure) => procedure.id));
      const stood = world.material.supportPositions.some((position) => position.supporterKind === "character" && position.supporterId === promisor.id
        && position.position === "support" && position.changedAtStep >= since && theirQuestions.has(position.procedureId));
      return stood ? `${promisor.name} spoke for ${beneficiary.name}'s question` : null;
    }
    case "military_support":
    case "protection": {
      const beside = world.material.forces.some((force) => (force.commanderCharacterId === promisor.id || force.controllerCharacterId === promisor.id)
        && force.locationId === beneficiary.locationProvinceId);
      return beside ? `${promisor.name}'s men stand beside ${beneficiary.name}` : null;
    }
    case "office_favour": {
      const given = world.material.officeSeats.some((seat) => seat.holderCharacterId === beneficiary.id && seat.status === "held"
        && seat.termStartedAtStep !== null && seat.termStartedAtStep >= since);
      return given ? `${beneficiary.name} was given office` : null;
    }
    case "information_sharing":
    case "other": {
      const wrote = world.diplomacy.some((message) => message.fromCharacterId === promisor.id && message.toCharacterId === beneficiary.id && message.sentAtStep >= since);
      return wrote ? `${promisor.name} wrote to ${beneficiary.name}` : null;
    }
  }
}

/**
 * Whether what a conditional promise waited on has happened since it was made:
 * for support in a house, a question the beneficiary put there; for men or
 * protection, a war of the beneficiary's power; for anything else, a letter
 * from the beneficiary asking for it. What cannot be told is taken as come,
 * so a promise is never excused by the engine's not knowing.
 */
function occasionCame(world: WorldState, commitment: Commitment): boolean {
  const since = commitment.createdAtStep;
  const beneficiary = world.characters.find((character) => character.id === commitment.beneficiaryCharacterId);
  switch (commitment.actionKind) {
    case "political_support":
      return world.material.politicalProcedures.some((procedure) => procedure.sponsorCharacterId === commitment.beneficiaryCharacterId && procedure.openedAtStep >= since);
    case "military_support":
    case "protection":
      return beneficiary?.polityId != null && world.polityAgreements.some((agreement) => agreement.kind === "war" && agreement.status === "active"
        && (agreement.polityId === beneficiary.polityId || agreement.otherPolityId === beneficiary.polityId) && agreement.sinceStep >= since);
    case "information_sharing":
    case "other":
      return world.diplomacy.some((message) => message.fromCharacterId === commitment.beneficiaryCharacterId && message.toCharacterId === commitment.promisorCharacterId && message.sentAtStep >= since);
    default:
      return true;
  }
}

/**
 * A man asked in the burst said he kept these (their ids, in "stepsTaken"):
 * held as done, to be settled as kept on the next tick. Only his own, and only
 * when his answer changed the world -- a sentence is not a deed.
 */
export function claimPromisesKept(world: WorldState, promisorId: string, ids: readonly string[], leftAMark: boolean): WorldState {
  if (!leftAMark || ids.length === 0) return world;
  const claimed = new Set(ids);
  let changed = false;
  const commitments = world.commitments.map((commitment) => {
    if (!claimed.has(commitment.id) || commitment.promisorCharacterId !== promisorId || !OPEN.has(commitment.status)) return commitment;
    changed = true;
    return { ...commitment, status: "prepared" as const };
  });
  return changed ? { ...world, commitments } : world;
}

/** The world with a commitment's resolution written into it. */
function settled(world: WorldState, resolution: CommitmentResolutionResult): WorldState {
  return {
    ...world,
    characters: [...resolution.characters],
    commitments: [...resolution.commitments],
    characterPressures: [...resolution.characterPressures],
    material: resolution.material,
  };
}

export function keepPromises(input: PromiseInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const nameOf = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? "someone";
  const aliveIds = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));

  for (const original of input.world.commitments) {
    if (!OPEN.has(original.status)) continue;
    const commitment = world.commitments.find((candidate) => candidate.id === original.id) ?? original;
    const { promisorCharacterId: promisor, beneficiaryCharacterId: beneficiary } = commitment;
    const refs = [{ kind: "character" as const, id: promisor }, { kind: "character" as const, id: beneficiary }];
    const told = (kind: string, summary: string, significance: number): FactProposalDraft => ({
      localId: `${kind}_${commitment.id}`.slice(0, 60),
      kind,
      summary: summary.slice(0, 600),
      affectedRefs: refs,
      visibility: commitment.visibility === "public" ? "public" : "private",
      discoveryState: commitment.visibility === "public" ? "public" : "private",
      knownToRefs: commitment.visibility === "public" ? [] : refs,
      knowableInDays: 0,
      significance,
    });

    // A promise dies with either man: nobody is left to keep it, or to keep it to.
    if (!aliveIds.has(promisor) || !aliveIds.has(beneficiary)) {
      world = settled(world, cancelCommitment(world, commitment.id, input.toDay, "One of them is dead."));
      continue;
    }

    const deed = commitment.status === "prepared" ? `${nameOf(promisor)} did as he said` : keptOnTheRecord(world, commitment);
    const due = commitment.reviewAtStep <= input.toDay;
    const paysByHand = commitment.actionKind === "payment" && commitment.requiredResource !== null && promisor !== input.playerCharacterId
      && checkCommitmentAuthority(world, promisor, commitment.requiredOfficeId, commitment.requiredResource).ok;

    if (deed !== null || (due && paysByHand)) {
      // Money already paid is not paid twice: only an unpaid promise spends it here.
      const kept = deed !== null && commitment.actionKind === "payment"
        ? { ...world, commitments: world.commitments.map((candidate) => (candidate.id === commitment.id ? { ...candidate, status: "fulfilled" as const, resolvedAtStep: input.toDay, resolutionReason: deed } : candidate)) }
        : settled(world, fulfillCommitment(world, commitment.id, input.toDay));
      world = remember(kept, [{
        subjectCharacterId: beneficiary, targetCharacterId: promisor,
        label: `Kept his word: ${commitment.description}`, score: 8, dimensions: { trust: 12, reputation: 6 },
      }], input.toDay, `promise-kept-${commitment.id}`);
      facts.push(told("promise_kept", `${nameOf(promisor)} kept his promise to ${nameOf(beneficiary)}: ${commitment.description}`, 35));
      continue;
    }
    if (!due) continue;

    // A promise to hold back is kept by holding back. Its day passing is the
    // proof of it, not a breach: Fabricius was marked a traitor to his word
    // for not having written a letter he had never promised (R23).
    if (promiseFormOf(commitment) === "refrain") {
      world = {
        ...world,
        commitments: world.commitments.map((candidate) => candidate.id === commitment.id
          ? { ...candidate, status: "fulfilled" as const, resolvedAtStep: input.toDay, resolutionReason: "He held to it." }
          : candidate),
      };
      world = remember(world, [{
        subjectCharacterId: beneficiary, targetCharacterId: promisor,
        label: `Held to his word: ${commitment.description}`, score: 4, dimensions: { trust: 6 },
      }], input.toDay, `promise-held-${commitment.id}`);
      continue;
    }
    // A promise that waits on an occasion is judged on the occasion. If it
    // never came, nobody broke anything: it lapses, and nobody is wronged.
    // Support in a house is support for a question, and waits on one being put.
    if ((isConditionalPromise(commitment) || commitment.actionKind === "political_support") && !occasionCame(world, commitment)) {
      world = settled(world, cancelCommitment(world, commitment.id, input.toDay, "The occasion it waited on never came."));
      continue;
    }

    // One grace, while he still can keep it; none for a man who no longer holds what he promised.
    const able = checkCommitmentAuthority(world, promisor, commitment.requiredOfficeId, commitment.requiredResource).ok;
    if (commitment.status === "pending" && able) {
      world = settled(world, deferCommitment(world, commitment.id, input.toDay, "Its day came and it was not yet kept.", GRACE_DAYS));
      facts.push(told("promise_overdue", `${nameOf(promisor)} has not yet kept his promise to ${nameOf(beneficiary)}: ${commitment.description}`, 30));
      continue;
    }

    world = settled(world, breakCommitment(world, commitment.id, input.toDay, able ? "He let its day pass twice." : "He no longer holds what he promised."));
    const wronged: Grievance[] = [
      { subjectCharacterId: beneficiary, targetCharacterId: promisor, label: `Broke his word: ${commitment.description}`, score: -14, dimensions: { trust: -20, reputation: -8 } },
      ...kinOf(world, beneficiary).filter((kin) => kin !== promisor).map((kin): Grievance => ({
        subjectCharacterId: kin, targetCharacterId: promisor, label: `Broke his word to ${nameOf(beneficiary)}`, score: -5, dimensions: { trust: -6 },
      })),
    ];
    world = teach(remember(world, wronged, input.toDay, `promise-broken-${commitment.id}`), beneficiary, "betrayed", input.toDay);
    facts.push(told("promise_broken", `${nameOf(promisor)} broke his promise to ${nameOf(beneficiary)}: ${commitment.description}`, 55));
  }
  return { world, facts };
}
