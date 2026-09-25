import {
  MECHANIC_MAX_DEBIT_PER_BURST_BPS,
  MECHANIC_MONEY_MAX_SHARE,
  MECHANIC_PURSE_DEBIT_MAX_BPS,
  mechanicWorth,
  provinceTaxCapacity,
  type GenericEntity,
  type MechanicAmount,
  type MechanicEffect,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";

/**
 * A rule's effects as the concrete deltas one firing applies.
 *
 * Every sum is read at the moment of firing and clamped here, before the
 * applier sees it: a share of a purse is a share of what is in it now, a band
 * is of the arrangement's scale now, and no firing takes more than the ceilings
 * allow -- of the scale, of a purse, and of a purse across the whole burst,
 * which is the ledger's job.
 */

/** What every rule has taken from each purse this burst, against what was in it when the burst began. */
export interface DebitLedger {
  readonly opening: Map<string, number>;
  readonly debited: Map<string, number>;
}

export const newDebitLedger = (world: WorldState): DebitLedger => ({
  opening: new Map(world.material.accounts.filter((account) => account.owner.kind === "character").map((account) => [account.id, account.balance])),
  debited: new Map(),
});

export interface Instantiated {
  readonly effect: MechanicEffect;
  readonly delta: WorldDelta;
  /** The sum a money effect settled on, for the fact. */
  readonly amount: number | null;
}

function readAmount(amount: MechanicAmount, world: WorldState, scale: number): number {
  switch (amount.kind) {
    case "band": return scale * mechanicWorth.moneyShare[amount.band];
    case "share": {
      const source = amount.of;
      const of = source.kind === "account_balance"
        ? world.material.accounts.find((account) => account.id === source.accountId)?.balance ?? 0
        : provinceTaxCapacity(world, source.provinceId) ?? 0;
      return of * (amount.bps / 10_000);
    }
    case "fixed": return amount.amount;
  }
}

/**
 * The deltas of one firing. An effect that comes to nothing -- a sum clamped
 * to zero, a purse already taken from as much as the burst allows -- is left
 * out, and the firing counts as empty if nothing is left.
 */
/** The applier hands back filled copies of what it was given, so each delta is tagged in its reason and matched by the tag. */
export const reasonTag = (entity: { readonly label: string }, index: number): string => `${entity.label.slice(0, 200)}: a standing rule (${index + 1}).`;
export const tagOf = (delta: WorldDelta): string | undefined =>
  delta.op === "social_events" ? delta.events[0]?.summary : "reason" in delta ? delta.reason : undefined;

export function instantiate(rule: { readonly effects: readonly MechanicEffect[] }, entity: GenericEntity, world: WorldState, scale: number, ledger: DebitLedger): Instantiated[] {
  const out: Instantiated[] = [];
  for (const [index, effect] of rule.effects.entries()) {
    const reason = reasonTag(entity, index);
    switch (effect.op) {
      case "money_transfer": {
        const from = world.material.accounts.find((account) => account.id === effect.fromAccountId);
        if (from === undefined && effect.fromAccountId !== entity.id) continue;
        let amount = Math.min(readAmount(effect.amount, world, scale), scale * MECHANIC_MONEY_MAX_SHARE);
        if (from !== undefined) {
          amount = Math.min(amount, from.balance);
          if (from.owner.kind === "character") {
            amount = Math.min(amount, from.balance * (MECHANIC_PURSE_DEBIT_MAX_BPS / 10_000));
            const opening = ledger.opening.get(from.id) ?? from.balance;
            const room = opening * (MECHANIC_MAX_DEBIT_PER_BURST_BPS / 10_000) - (ledger.debited.get(from.id) ?? 0);
            amount = Math.min(amount, Math.max(0, room));
          }
        }
        amount = Math.floor(amount);
        if (amount <= 0) continue;
        if (from?.owner.kind === "character") ledger.debited.set(from.id, (ledger.debited.get(from.id) ?? 0) + amount);
        out.push({ effect, amount, delta: { op: "money_transfer", fromAccountRef: effect.fromAccountId, toAccountRef: effect.toAccountId, amount, reason } });
        break;
      }
      case "province_material_shift": {
        const sign = effect.direction === "raise" ? 1 : -1;
        if (effect.quantity === "available_manpower") {
          const population = world.material.provinceMaterial.find((row) => row.provinceId === effect.provinceId)?.population ?? 0;
          const men = Math.round(population * mechanicWorth.manpowerShare[effect.band]) * sign;
          if (men === 0) continue;
          out.push({ effect, amount: null, delta: { op: "province_material_shift", provinceId: effect.provinceId, availableManpowerDelta: men, reason } });
          break;
        }
        const bps = mechanicWorth.provinceBps[effect.band] * sign;
        const field = { stability: "stabilityBpsDelta", food_security: "foodSecurityBpsDelta", productive_capacity: "productiveCapacityBpsDelta", war_damage: "warDamageBpsDelta" } as const;
        out.push({ effect, amount: null, delta: { op: "province_material_shift", provinceId: effect.provinceId, [field[effect.quantity]]: bps, reason } });
        break;
      }
      case "legitimacy_shift":
        out.push({ effect, amount: null, delta: { op: "legitimacy_shift", target: "polity", targetId: effect.polityId, legitimacyBpsDelta: mechanicWorth.legitimacyBps[effect.band] * (effect.direction === "raise" ? 1 : -1), causeLabel: entity.label.slice(0, 160), reason } });
        break;
      case "polity_stance_shift":
        out.push({ effect, amount: null, delta: { op: "polity_stance_shift", polityId: effect.polityId, towardPolityId: effect.towardPolityId, trustDelta: mechanicWorth.trust[effect.band] * (effect.direction === "raise" ? 1 : -1), reason } });
        break;
      case "relation_shift": {
        const score = mechanicWorth.relation[effect.band] * (effect.direction === "raise" ? 1 : -1);
        out.push({
          effect, amount: null,
          delta: {
            op: "social_events",
            events: [{
              participantCharacterRefs: [effect.subjectCharacterId, effect.targetCharacterId],
              kind: effect.direction === "raise" ? "favour" : "insult",
              visibility: "polity",
              summary: reason,
              relationCauses: [{ subjectCharacterRef: effect.subjectCharacterId, targetCharacterRef: effect.targetCharacterId, label: entity.label.slice(0, 200), score, decayPerYearBps: mechanicWorth.relationDecayPerYearBps, dimensions: { [effect.dimension]: score } }],
              observedTraits: [],
            }],
          },
        });
        break;
      }
    }
  }
  return out;
}
