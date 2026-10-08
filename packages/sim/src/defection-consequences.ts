import {
  coinageOfPolity,
  conversionBps,
  employerPolityOf,
  stableHash,
  type Character,
  type FactProposalDraft,
  type Force,
  type ServiceContract,
  type WorldState,
} from "@chronica/shared";
import { endContract } from "./contracts";
import { safeLocalId } from "./safe-local-id";

/**
 * What a defection does to the man's bargains and his bands (docs/plans/playtest-fixes.md, "Defection gaps closed").
 *
 * Going over to another power left his contracts with the power he left running: its pay went on to a man who had gone over, and a hired company led by him stayed
 * as the handing-over of his armies had left it, with the contract still paying a deserter. By rule now:
 *
 *  - Every service contract the power he left let him is broken that day (`endContract`, "broken"): a deserter draws no pay of the power he betrayed; the unpaid
 *    wages are forfeit with his estate.
 *  - A hired band he led is his own men (`forceWas` is the captain): it follows him to the power he has gone to, or falls back to the officers of the power it was
 *    hired by. A band that has gone unpaid goes with him nearly always (the Mercenary War's lesson: they follow the man who speaks for their pay, Polybius 1.66-69);
 *    a band paid to date follows him less often, by a hash of the man and the band, so that it is the same in every run.
 *  - Money does not cross coinages for nothing. A chest the band takes with it was struck in the old power's coin and is changed into the new one's at the money-changers'
 *    rate (`conversionBps`), the cut leaving the books by the `abroad` door like any other crossing (`docs/economy.md`, "Coinages"); and its pay is reckoned anew, in the
 *    new power's coin, when the power he has gone to takes the band on.
 *  - The armies of the old power that he led stay with it: `handOverForcesOf` hands them to its officers.
 *
 * A man who comes back (`returningDeserter`) is judged by the power he left, by its own custom: Carthage's Hundred and Four try him for his life (Polybius 1.24, 1.82
 * on the punishment of generals; desertion to the enemy was a capital matter in every army of the age), Rome's courts and the people likewise, a king has him in chains.
 */

/** The share of a band, in a hundred, that follows its captain though it has been paid to date. */
export const FOLLOWS_PAID_PCT = 35;
/** And what each period unpaid adds. */
export const FOLLOWS_PER_MISSED_PCT = 25;
const MOST_FOLLOWS_PCT = 90;

/** The chance, in a hundred, that a band follows its captain over. */
export function followsHim(world: WorldState, force: Pick<Force, "id" | "payObligationId">, man: Pick<Character, "id">): number {
  const pay = world.material.obligations.find((obligation) => obligation.id === force.payObligationId);
  return Math.min(MOST_FOLLOWS_PCT, FOLLOWS_PAID_PCT + FOLLOWS_PER_MISSED_PCT * (pay?.missedPeriods ?? 0));
}

/** What a sum of one power's coin is worth in another's, and what the changers keep. */
export function changedCoin(world: WorldState, fromPolityId: string, toPolityId: string, amount: number): { readonly received: number; readonly cut: number } {
  if (amount <= 0) return { received: Math.max(0, amount), cut: 0 };
  const from = coinageOfPolity(world, fromPolityId);
  const to = coinageOfPolity(world, toPolityId);
  if (from.id === to.id) return { received: amount, cut: 0 };
  const received = Math.min(amount, Math.max(1, Math.floor((amount * conversionBps(world, from.id, to.id)) / 10_000)));
  return { received, cut: amount - received };
}

export interface Settled {
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
}

/**
 * The contracts the power he left had with him, broken, and the bands he led, followed him or fallen back. Called with the world after `handOverForcesOf` has
 * given his armies to the officers who stay.
 */
export function settleHisBargains(world: WorldState, man: Character, homePolityId: string, hostPolityId: string, atStep: number): Settled {
  const facts: FactProposalDraft[] = [];
  let next = world;
  const homeName = world.map.polities.find((polity) => polity.id === homePolityId)?.name ?? homePolityId;
  const hostName = world.map.polities.find((polity) => polity.id === hostPolityId)?.name ?? hostPolityId;
  const his = world.material.contracts.filter((contract: ServiceContract) => contract.status === "active" && contract.employeeCharacterId === man.id && employerPolityOf(world, contract) === homePolityId);
  for (const contract of his) {
    const band = contract.forceId === null ? undefined : next.material.forces.find((force) => force.id === contract.forceId);
    const follows = band !== undefined && stableHash([man.id, band.id, "follows-roll"]) % 100 < followsHim(world, band, man);
    next = endContract(next, contract, "broken", atStep);
    if (band === undefined) {
      facts.push({
        localId: safeLocalId(`contract_broken_${contract.id}`).slice(0, 60), kind: "contract_broken", summary: `${man.name} went over to ${hostName}, and ${homeName} stopped his pay: ${contract.label}.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: man.id }, { kind: "polity", id: homePolityId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 35,
      });
      continue;
    }
    // `endContract` has given the band back to its captain's own power; here is where it goes.
    const chest = next.material.accounts.find((account) => account.owner.kind === "force" && account.owner.id === band.id);
    if (follows) {
      const changed = chest === undefined ? { received: 0, cut: 0 } : changedCoin(next, homePolityId, hostPolityId, chest.balance);
      next = {
        ...next,
        material: {
          ...next.material,
          forces: next.material.forces.map((force) => (force.id === band.id ? { ...force, polityId: hostPolityId, commanderCharacterId: man.id, controllerCharacterId: man.id, payObligationId: null, payArrearsPeriods: 0 } : force)),
          accounts: chest === undefined || changed.cut <= 0 ? next.material.accounts : next.material.accounts.map((account) => (account.id === chest.id ? { ...account, balance: account.balance - changed.cut } : account)),
          transactions: chest === undefined || changed.cut <= 0 ? next.material.transactions : [...next.material.transactions, {
            id: safeLocalId(`txn_changers_${band.id}`).slice(0, 100), atStep, kind: "transfer" as const, amount: changed.cut, external: "abroad" as const, sourceAccountId: chest.id,
            cause: { kind: "action" as const, id: `defection-${man.id}`.slice(0, 120), explanation: `The money-changers' cut on the chest of ${band.name} changed from ${homeName}'s coin to ${hostName}'s.`.slice(0, 240) }, visibility: "polity" as const,
          }],
        },
      };
      facts.push({
        localId: safeLocalId(`band_follows_${band.id}`).slice(0, 60), kind: "defection",
        summary: `${band.name} went over with ${man.name} to ${hostName}: ${homeName}'s contract is broken and its pay stopped${changed.cut > 0 ? `; the chest of ${changed.received + changed.cut} was changed into ${hostName}'s coin, and the money-changers kept ${changed.cut}` : ""}. ${hostName} must take the band on at its own pay.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: man.id }, { kind: "force", id: band.id }, { kind: "polity", id: hostPolityId }, { kind: "polity", id: homePolityId }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 55,
      });
    } else {
      // Falls back to the officers of the power that hired it: the captain who leads it now is whoever the handing-over gave it to.
      const stays = world.material.forces.find((force) => force.id === band.id);
      const leader = stays !== undefined && stays.commanderCharacterId !== man.id ? stays.commanderCharacterId : next.characters.find((character) => character.alive && character.polityId === homePolityId && character.id !== man.id)?.id ?? band.commanderCharacterId;
      next = {
        ...next,
        material: { ...next.material, forces: next.material.forces.map((force) => (force.id === band.id ? { ...force, polityId: homePolityId, commanderCharacterId: leader, controllerCharacterId: leader, payObligationId: null } : force)) },
      };
      facts.push({
        localId: safeLocalId(`band_stays_${band.id}`).slice(0, 60), kind: "defection",
        summary: `${band.name} would not follow ${man.name} over to ${hostName}: it falls back to the officers of ${homeName}, and the contract he held is broken.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: man.id }, { kind: "force", id: band.id }, { kind: "polity", id: homePolityId }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 45,
      });
    }
  }
  return { world: next, facts };
}
