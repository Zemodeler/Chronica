import {
  DELTA_AUTHORITY_DOMAIN,
  allOffices,
  buildAuthorityIndex,
  checkAuthority,
  type DebitWarrant,
  type MechanicDraft,
  type MechanicEffect,
  type MechanicPredicate,
  type Office,
  type WorldState,
} from "@chronica/shared";
import { polityOfScope } from "../apply/apply-deltas";
import type { ReadableRefs } from "./refs";

/**
 * Whether a rule the model wrote is one the engine will run.
 *
 * Every id must be one the writer was offered (`refs.ts`), not merely one
 * that exists: the list is the contract. Every effect must be able to change
 * something. And a debit from an account the owner does not control must be
 * backed by a warrant found here, now, from what stands in the world -- the
 * owner's authority over a treasury, a contract in which the payer agreed to
 * pay him, or the account being his own -- and stored on the rule, so the
 * firing checks the warrant and never the rule's own say-so. An unwarranted
 * debit is dropped, not refused outright: a toll the owner may not levy on
 * the treasury may still be levied on his own stall.
 */

export type Validation =
  | { readonly ok: true; readonly draft: MechanicDraft; readonly warrants: readonly DebitWarrant[]; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export function validateMechanic(draft: MechanicDraft, world: WorldState, refs: ReadableRefs, offices: readonly Office[]): Validation {
  const accountIds = new Set(refs.accounts.map((account) => account.id));
  const provinceIds = new Set(refs.provinces.map((province) => province.id));
  const polityIds = new Set(refs.polities.map((polity) => polity.id));
  const characterIds = new Set([refs.owner.kind === "character" ? refs.owner.id : "", ...refs.characters.map((person) => person.id)].filter((id) => id.length > 0));
  const forceIds = new Set(refs.forces.map((force) => force.id));
  const exists = {
    account: (id: string) => world.material.accounts.some((account) => account.id === id),
    force: (id: string) => world.material.forces.some((force) => force.id === id),
    character: (id: string) => world.characters.some((character) => character.id === id),
    province: (id: string) => world.map.provinces.some((province) => province.id === id),
    settlement: (id: string) => world.map.provinces.some((province) => province.settlements.some((settlement) => settlement.id === id)),
    position: (id: string) => world.map.provinces.some((province) => province.settlements.some((settlement) => settlement.id === id)) || world.map.provinces.some((province) => (province as { positions?: readonly { id: string }[] }).positions?.some((position) => position.id === id) ?? false),
    obligation: (id: string) => world.material.obligations.some((obligation) => obligation.id === id),
    office: (id: string) => allOffices(world, offices).some((office) => office.id === id),
    polity: (id: string) => world.map.polities.some((polity) => polity.id === id),
  };

  /** Why a predicate cannot be read, or null. The watch's own arms are checked against the world; the mechanic's against the offered list. */
  const predicateFault = (predicate: MechanicPredicate): string | null => {
    switch (predicate.kind) {
      case "force_enters_province": return exists.province(predicate.provinceId) ? null : `no province "${predicate.provinceId}"`;
      case "province_control_changes": return exists.province(predicate.provinceId) ? null : `no province "${predicate.provinceId}"`;
      case "force_enters_position": return exists.position(predicate.positionId) ? null : `no position "${predicate.positionId}"`;
      case "settlement_control_changes": return exists.settlement(predicate.settlementId) ? null : `no settlement "${predicate.settlementId}"`;
      case "polity_strength_above": return exists.polity(predicate.polityId) ? null : `no power "${predicate.polityId}"`;
      case "force_strength_below": return exists.force(predicate.forceId) ? null : `no army "${predicate.forceId}"`;
      case "account_below": return exists.account(predicate.accountId) ? null : `no account "${predicate.accountId}"`;
      case "arrears_reach": return exists.obligation(predicate.obligationId) ? null : `no obligation "${predicate.obligationId}"`;
      case "character_dies": return exists.character(predicate.characterId) ? null : `no person "${predicate.characterId}"`;
      case "office_vacant": return exists.office(predicate.officeId) ? null : `no office "${predicate.officeId}"`;
      case "province_level_above":
      case "province_level_below": return provinceIds.has(predicate.provinceId) ? null : `"${predicate.provinceId}" is not a province this rule may read`;
      case "account_above": return accountIds.has(predicate.accountId) ? null : `"${predicate.accountId}" is not an account this rule may read`;
      case "relation_above":
      case "relation_below":
        if (!characterIds.has(predicate.subjectCharacterId) || !characterIds.has(predicate.targetCharacterId)) return "a relation names somebody this rule may not read";
        return predicate.subjectCharacterId === predicate.targetCharacterId ? "a relation needs two people" : null;
      case "polity_trust_above":
      case "polity_trust_below":
        if (!polityIds.has(predicate.polityId) || !polityIds.has(predicate.towardPolityId)) return "a trust names a power this rule may not read";
        return predicate.polityId === predicate.towardPolityId ? "trust needs two powers" : null;
      case "at_war":
        if (!polityIds.has(predicate.polityId) || !polityIds.has(predicate.otherPolityId)) return "a war names a power this rule may not read";
        return predicate.polityId === predicate.otherPolityId ? "a war needs two powers" : null;
      case "force_strength_above": return forceIds.has(predicate.forceId) ? null : `"${predicate.forceId}" is not an army this rule may read`;
    }
  };

  // A change of hands is an event, not a state: it can trigger a rule, and
  // it can never hold as a condition or an end, so a rule written that way
  // would wait for ever.
  const isEvent = (predicate: MechanicPredicate): boolean => predicate.kind === "province_control_changes" || predicate.kind === "settlement_control_changes";
  if (draft.trigger.kind === "when") {
    const fault = predicateFault(draft.trigger.predicate);
    if (fault !== null) return { ok: false, reason: `the trigger cannot be read: ${fault}` };
  }
  if (draft.conditions.some(isEvent)) return { ok: false, reason: "a change of hands is an event, not a state: it can trigger a rule but cannot be one of its conditions" };
  if (draft.end.kind === "when" && isEvent(draft.end.predicate)) return { ok: false, reason: "a change of hands cannot be a rule's end; make it the trigger of another rule" };
  if (draft.trigger.kind === "on_fact" && draft.trigger.subjectRef !== null) {
    const subject = draft.trigger.subjectRef;
    const known = subject.kind === "character" ? exists.character(subject.id) : subject.kind === "polity" ? exists.polity(subject.id) : subject.kind === "province" ? exists.province(subject.id) : subject.kind === "force" ? exists.force(subject.id) : subject.kind === "account" ? exists.account(subject.id) : false;
    if (!known) return { ok: false, reason: `the trigger's subject "${subject.id}" does not exist` };
  }
  for (const condition of draft.conditions) {
    const fault = predicateFault(condition);
    if (fault !== null) return { ok: false, reason: `a condition cannot be read: ${fault}` };
  }
  if (draft.end.kind === "when") {
    const fault = predicateFault(draft.end.predicate);
    if (fault !== null) return { ok: false, reason: `the end cannot be read: ${fault}` };
    if (draft.conditions.some((condition) => JSON.stringify(condition) === JSON.stringify(draft.end.kind === "when" ? draft.end.predicate : null))) {
      return { ok: false, reason: "the rule would end the first time it could fire: its end is one of its conditions" };
    }
  }

  const ownedAccounts = new Set(refs.accounts.filter((account) => account.owned).map((account) => account.id));
  const warrants: DebitWarrant[] = [];
  const dropped: string[] = [];
  const effects: MechanicEffect[] = [];
  for (const effect of draft.effects) {
    const fault = effectFault(effect, { accountIds, provinceIds, polityIds, characterIds });
    if (fault !== null) return { ok: false, reason: fault };
    if (effect.op === "money_transfer" && !ownedAccounts.has(effect.fromAccountId)) {
      const warrant = warrantFor(effect.fromAccountId, world, refs, offices);
      if (warrant === null) {
        dropped.push(`a debit of ${effect.fromAccountId}: ${refs.owner.id} holds no authority over it and nobody there consented`);
        continue;
      }
      if (!warrants.some((held) => held.accountId === warrant.accountId)) warrants.push(warrant);
    }
    effects.push(effect);
  }
  if (effects.length === 0) return { ok: false, reason: `nothing this rule does may be done: ${dropped.join("; ")}` };
  return { ok: true, draft: { ...draft, effects }, warrants, dropped };
}

function effectFault(effect: MechanicEffect, known: { accountIds: Set<string>; provinceIds: Set<string>; polityIds: Set<string>; characterIds: Set<string> }): string | null {
  switch (effect.op) {
    case "money_transfer":
      if (!known.accountIds.has(effect.fromAccountId)) return `"${effect.fromAccountId}" is not an account this rule may name`;
      if (effect.toAccountId !== null && !known.accountIds.has(effect.toAccountId)) return `"${effect.toAccountId}" is not an account this rule may name`;
      if (effect.toAccountId === effect.fromAccountId) return "money moved from an account to itself does nothing";
      return null;
    case "province_material_shift":
      return known.provinceIds.has(effect.provinceId) ? null : `"${effect.provinceId}" is not a province this rule may change`;
    case "legitimacy_shift":
      return known.polityIds.has(effect.polityId) ? null : `"${effect.polityId}" is not a power this rule may change`;
    case "polity_stance_shift":
      if (!known.polityIds.has(effect.polityId) || !known.polityIds.has(effect.towardPolityId)) return "a stance names a power this rule may not change";
      return effect.polityId === effect.towardPolityId ? "a stance needs two powers" : null;
    case "relation_shift":
      if (!known.characterIds.has(effect.subjectCharacterId) || !known.characterIds.has(effect.targetCharacterId)) return "a relation names somebody this rule may not change";
      return effect.subjectCharacterId === effect.targetCharacterId ? "a relation needs two people" : null;
  }
}

/**
 * On what basis the owner may take from this account: an office over the
 * treasury (`checkAuthority`, with a grant over the power reaching what is in
 * it), or an active contract in which the account's holder pays the owner.
 * Null when neither stands.
 */
export function warrantFor(accountId: string, world: WorldState, refs: ReadableRefs, offices: readonly Office[]): DebitWarrant | null {
  if (refs.ownerAccountId === accountId) return { accountId, basis: "owner", refId: null };
  const every = allOffices(world, offices);
  const index = buildAuthorityIndex({ officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts }, world.authorityGrants, every, world.elapsedStep);
  const verdict = checkAuthority(
    index,
    { holder: refs.owner, domain: DELTA_AUTHORITY_DOMAIN.money_transfer, scope: { kind: "account", id: accountId }, power: "spend" },
    (granted, wanted) => granted.kind === "polity" && polityOfScope(wanted, world, every) === granted.id,
  );
  if (verdict.authorized) return { accountId, basis: "authority", refId: verdict.grant?.id ?? null };
  if (refs.owner.kind === "character") {
    const contract = world.material.contracts.find((candidate) => candidate.status === "active" && candidate.employerAccountId === accountId && candidate.employeeCharacterId === refs.owner.id);
    if (contract !== undefined) return { accountId, basis: "consent", refId: contract.id };
  }
  return null;
}

/** Whether a stored warrant still stands: the office still held, the contract still running, the purse still the owner's. */
export function warrantStands(warrant: DebitWarrant, world: WorldState, refs: ReadableRefs, offices: readonly Office[]): boolean {
  switch (warrant.basis) {
    case "owner": return refs.ownerAccountId === warrant.accountId;
    case "consent": return world.material.contracts.some((contract) => contract.id === warrant.refId && contract.status === "active");
    case "authority": return warrantFor(warrant.accountId, world, refs, offices)?.basis === "authority";
  }
}
