import { accountLabel, type Mechanic, type MechanicAmount, type MechanicDraft, type MechanicEffect, type MechanicPredicate, type MechanicTrigger, type WorldState } from "@chronica/shared";

/**
 * A rule in words: for the slice, the facts, and the audit. Never parsed.
 */

const named = (world: WorldState, id: string): string =>
  world.characters.find((character) => character.id === id)?.name
  ?? world.map.polities.find((polity) => polity.id === id)?.name
  ?? world.map.provinces.find((province) => province.id === id)?.name
  ?? world.material.forces.find((force) => force.id === id)?.name
  ?? accountName(world, id)
  ?? id;

function accountName(world: WorldState, id: string): string | null {
  const account = world.material.accounts.find((candidate) => candidate.id === id);
  return account === undefined ? null : accountLabel(world, account, "clause");
}

const level = (name: string): string => name.replace(/_/g, " ");

export function predicateInWords(predicate: MechanicPredicate, world: WorldState): string {
  switch (predicate.kind) {
    case "force_enters_province": return `an army${predicate.polityId === undefined ? "" : ` of ${named(world, predicate.polityId)}`} enters ${named(world, predicate.provinceId)}`;
    case "province_control_changes": return `${named(world, predicate.provinceId)} changes hands`;
    case "force_enters_position": return `an army reaches ${predicate.positionId}`;
    case "settlement_control_changes": return `${predicate.settlementId} changes hands`;
    case "polity_strength_above": return `${named(world, predicate.polityId)} has more than ${predicate.headcount} men under arms`;
    case "force_strength_below": return `${named(world, predicate.forceId)} falls below ${predicate.headcount} fit`;
    case "force_strength_above": return `${named(world, predicate.forceId)} stands above ${predicate.headcount} fit`;
    case "account_below": return `${named(world, predicate.accountId)} holds less than ${predicate.amount}`;
    case "account_above": return `${named(world, predicate.accountId)} holds more than ${predicate.amount}`;
    case "arrears_reach": return `arrears on ${predicate.obligationId} reach ${predicate.periods} month(s)`;
    case "character_dies": return `${named(world, predicate.characterId)} dies`;
    case "office_vacant": return `${predicate.officeId} is ${predicate.vacant ? "vacant" : "filled"}`;
    case "province_level_above": return `${level(predicate.level)} in ${named(world, predicate.provinceId)} is above ${predicate.bps} bps`;
    case "province_level_below": return `${level(predicate.level)} in ${named(world, predicate.provinceId)} is below ${predicate.bps} bps`;
    case "relation_above": return `${named(world, predicate.subjectCharacterId)}'s ${predicate.dimension} for ${named(world, predicate.targetCharacterId)} is above ${predicate.score}`;
    case "relation_below": return `${named(world, predicate.subjectCharacterId)}'s ${predicate.dimension} for ${named(world, predicate.targetCharacterId)} is below ${predicate.score}`;
    case "polity_trust_above": return `${named(world, predicate.polityId)}'s trust of ${named(world, predicate.towardPolityId)} is above ${predicate.score}`;
    case "polity_trust_below": return `${named(world, predicate.polityId)}'s trust of ${named(world, predicate.towardPolityId)} is below ${predicate.score}`;
    case "at_war": return `${named(world, predicate.polityId)} is ${predicate.atWar ? "at war" : "at peace"} with ${named(world, predicate.otherPolityId)}`;
  }
}

function amountInWords(amount: MechanicAmount, world: WorldState): string {
  switch (amount.kind) {
    case "band": return `a ${amount.band} sum`;
    case "share": return `${(amount.bps / 100).toFixed(amount.bps % 100 === 0 ? 0 : 1)}% of ${amount.of.kind === "account_balance" ? named(world, amount.of.accountId) : `${named(world, amount.of.provinceId)}'s tax capacity`}`;
    case "fixed": return `${amount.amount}`;
  }
}

export function effectInWords(effect: MechanicEffect, world: WorldState): string {
  switch (effect.op) {
    case "money_transfer": return `${amountInWords(effect.amount, world)} passes from ${named(world, effect.fromAccountId)} to ${effect.toAccountId === null ? "outside the world" : named(world, effect.toAccountId)}`;
    case "province_material_shift": return `${level(effect.quantity)} in ${named(world, effect.provinceId)} ${effect.direction === "raise" ? "rises" : "falls"} a ${effect.band} step`;
    case "legitimacy_shift": return `${named(world, effect.polityId)}'s legitimacy ${effect.direction === "raise" ? "rises" : "falls"} a ${effect.band} step`;
    case "polity_stance_shift": return `${named(world, effect.polityId)}'s trust of ${named(world, effect.towardPolityId)} ${effect.direction === "raise" ? "rises" : "falls"} a ${effect.band} step`;
    case "relation_shift": return `${named(world, effect.subjectCharacterId)}'s ${effect.dimension} for ${named(world, effect.targetCharacterId)} ${effect.direction === "raise" ? "rises" : "falls"} a ${effect.band} step`;
  }
}

function triggerInWords(trigger: MechanicTrigger, world: WorldState): string {
  switch (trigger.kind) {
    case "monthly": return "each month";
    case "on_fact": return `whenever ${trigger.factKind.replace(/_/g, " ")}${trigger.subjectRef === null ? "" : ` touches ${named(world, trigger.subjectRef.id)}`}`;
    case "when": return `when ${predicateInWords(trigger.predicate, world)}`;
  }
}

export function mechanicInWords(rule: MechanicDraft | Mechanic, world: WorldState): string {
  const when = triggerInWords(rule.trigger, world);
  const conditions = rule.conditions.length === 0 ? "" : ` while ${rule.conditions.map((condition) => predicateInWords(condition, world)).join(" and ")}`;
  const effects = rule.effects.map((effect) => effectInWords(effect, world)).join("; ");
  const end = rule.end.kind === "never" ? "" : rule.end.kind === "term" ? `; ends after ${rule.end.days} days` : rule.end.kind === "owner_death" ? "; ends with its owner" : `; ends when ${predicateInWords(rule.end.predicate, world)}`;
  return `${when}${conditions}, ${effects}${end}`;
}

/** What one firing did, for its fact. */
export function firingInWords(label: string, done: readonly { readonly effect: MechanicEffect; readonly amount: number | null }[], world: WorldState): string {
  const parts = done.map(({ effect, amount }) =>
    effect.op === "money_transfer" && amount !== null
      ? `${amount} passed from ${named(world, effect.fromAccountId)} to ${effect.toAccountId === null ? "outside the world" : named(world, effect.toAccountId)}`
      : effectInWords(effect, world));
  return `${label}: ${parts.join("; ")}.`;
}

/** A rule as one clause of at most 160 characters, with when it is next due and how often it has fired. */
export function ruleInWords(rule: Mechanic, world: WorldState, entityId: string): string {
  const words = mechanicInWords(rule, world);
  const due = rule.trigger.kind === "monthly" && rule.nextDueStep !== null ? `; next due in ${Math.max(0, rule.nextDueStep - world.instant.day)} days` : "";
  const fired = rule.firedCount === 0 ? "" : `; fired ${rule.firedCount} time${rule.firedCount === 1 ? "" : "s"}`;
  const tail = `${due}${fired}`;
  const room = Math.max(40, 160 - tail.length);
  return `${words.length > room ? `${words.slice(0, room - 1)}…` : words}${tail}`.replace(entityId, "").trim();
}

