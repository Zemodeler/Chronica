import { allOffices, type Office, type OrderPartyRef, type WorldDelta, type WorldState } from "@chronica/shared";
import type { AuthorityBreach } from "./apply/context";

/**
 * Somebody finding out that somebody else did a thing they had no authority to
 * do (VISION §12).
 *
 * The engine has always computed the breach. What it did with it was write a
 * private fact whose summary was the audit line -- `No active grant gives
 * character "quintus-ogulnius" propose power in the civil domain over polity
 * "rome"` -- and that reached the Chronicle exactly once, as an entry headlined
 * "Fiscal Record Grants No Spending Power to the Declared Character". The kind
 * is now excluded from the record entirely, and rightly: an audit line is not
 * an event.
 *
 * But insubordination is the whole reason the check applies the act anyway, and
 * a consequence nobody can ever learn of is not a consequence. So the breach
 * stays what it is -- the evidence -- and this makes a person the event: it says
 * what was done in words a chronicler could use, and works out who, in the
 * ordinary course of their duties, would come across it and when.
 *
 * What they then do about it is theirs. Hold it, tell somebody, demand an
 * accounting, put it to the body that can judge it. Every one of those already
 * has a delta arm; none of them needed building. What was missing was anybody
 * knowing.
 */

/** In a clause a person could say aloud. The audit line stays on the breach, for inspection. */
export function describeBreach(delta: WorldDelta, world: WorldState, actorName: string): string {
  const account = (id: string | null): string => {
    if (id === null) return "the treasury";
    const found = world.material.accounts.find((candidate) => candidate.id === id);
    if (found === undefined) return "an account";
    if (found.owner.kind === "polity") return `the ${world.map.polities.find((polity) => polity.id === found.owner.id)?.name ?? found.owner.id} treasury`;
    return `${world.characters.find((character) => character.id === found.owner.id)?.name ?? found.owner.id}'s purse`;
  };
  const force = (id: string): string => world.material.forces.find((candidate) => candidate.id === id)?.name ?? "a force";
  const province = (id: string): string => world.map.provinces.find((candidate) => candidate.id === id)?.name ?? "a province";

  switch (delta.op) {
    case "money_transfer": return `${actorName} moved ${delta.amount} out of ${account(delta.fromAccountRef)}`;
    case "obligation_upsert": return `${actorName} charged ${account(delta.payerAccountRef)} with a standing payment of ${delta.amount}`;
    case "income_source_upsert": return `${actorName} altered what ${account(delta.beneficiaryAccountRef)} receives`;
    case "loan_open": return `${actorName} borrowed ${delta.principal} against ${account(delta.borrowerAccountRef)}`;
    case "force_create": return `${actorName} raised ${delta.name} without leave to raise anybody`;
    case "force_modify": return `${actorName} gave orders to ${force(delta.forceRef)}`;
    case "force_engage": return `${actorName} took ${force(delta.forceRef)} into a fight`;
    case "province_control_set": return `${actorName} took ${province(delta.provinceId)} in his own name`;
    case "province_material_shift": return `${actorName} laid hands on ${province(delta.provinceId)}'s own stores and people`;
    case "character_create": return `${actorName} made ${delta.name} an officer of the government`;
    case "authority_grant_upsert": return `${actorName} granted powers that were not his to grant`;
    case "political_procedure_open": return `${actorName} put a question to a body he had no standing to put it to`;
    case "political_procedure_resolve": return `${actorName} settled a question that was not his to settle`;
    case "political_support_set": return `${actorName} recorded a position in a body he does not sit in`;
    case "legitimacy_shift": return `${actorName} spent the government's standing as though it were his own`;
    case "holding_transfer": return `${actorName} moved a holding from one man's hands to another's`;
    case "diplomatic_message_send": return `${actorName} wrote to a foreign power over the government's name`;
    case "diplomatic_message_answer": return `${actorName} answered a foreign power over the government's name`;
    case "agreement_open": return `${actorName} bound the government to terms he had no power to agree`;
    case "agreement_close": return `${actorName} ended an agreement he had no power to end`;
    case "polity_stance_shift": return `${actorName} altered how the government stands toward a foreign power`;
    case "order_attempt_decide": return `${actorName} answered an order that was not put to him`;
    default: return `${actorName} acted beyond what his place allows`;
  }
}

export interface Noticer {
  readonly characterId: string;
  readonly via: "witnessed" | "document" | "investigation";
  /** Books are read at the month's turn; a missing legion is noticed by Tuesday. */
  readonly afterDays: number;
}

/**
 * Who would come across this, in the ordinary course of their own duties.
 *
 * Deterministic, from canonical state, and bounded to two people: a scandal
 * that half the republic independently discovers is not a scandal.
 *
 * Returning nobody must stay possible. Some things genuinely are not noticed,
 * and a world where every irregularity is always caught is one where nobody
 * would ever try anything -- which would empty out the whole of VISION §12.
 */
export function findWhoWouldNotice(world: WorldState, scenarioOffices: readonly Office[], breach: AuthorityBreach, actorId: string): Noticer[] {
  const offices = allOffices(world, scenarioOffices);
  const delta = breach.delta;
  const found: Noticer[] = [];
  const add = (characterId: string | null | undefined, via: Noticer["via"], afterDays: number): void => {
    if (characterId == null || characterId === actorId || found.length >= 2) return;
    if (found.some((noticer) => noticer.characterId === characterId)) return;
    if (!world.characters.some((character) => character.id === characterId && character.alive)) return;
    found.push({ characterId, via, afterDays });
  };

  const accountId = "fromAccountRef" in delta ? delta.fromAccountRef
    : "payerAccountRef" in delta ? delta.payerAccountRef
      : "borrowerAccountRef" in delta ? delta.borrowerAccountRef
        : null;
  if (typeof accountId === "string") {
    // Whoever else is named on the books. They are reading them anyway.
    for (const access of world.material.accountAccess) {
      if (access.accountId === accountId) add(access.characterId, "document", 7);
    }
    // And the man whose office the treasury belongs to, who audits rather than reads.
    const office = offices.find((candidate) => candidate.treasuryAccountId === accountId);
    if (office !== undefined) {
      const seat = world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status === "held");
      add(seat?.holderCharacterId, "investigation", 30);
    }
  }

  const forceId = "forceRef" in delta ? delta.forceRef : null;
  if (typeof forceId === "string") {
    const force = world.material.forces.find((candidate) => candidate.id === forceId);
    // A legion does not move without the men who answer for it knowing.
    add(force?.controllerCharacterId, "witnessed", 2);
    add(force?.commanderCharacterId, "witnessed", 2);
  }

  // Otherwise: whoever holds the office whose business this was. The person
  // whose job it was to do this is the person who notices it was done.
  if (found.length === 0) {
    const actor = world.characters.find((character) => character.id === actorId);
    const theirs = offices.filter(
      (office) => office.polityId === actor?.polityId && (office.authorisedActionIds as readonly string[]).includes(delta.op),
    );
    for (const office of theirs) {
      const seat = world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status === "held");
      add(seat?.holderCharacterId, "document", 7);
    }
  }

  return found;
}

/** The refs the discovery ledger records, so the fact becomes knowable to them and nobody else. */
export const noticersAsRefs = (noticers: readonly Noticer[]): OrderPartyRef[] =>
  noticers.map((noticer) => ({ kind: "character" as const, id: noticer.characterId }));
