import { MECHANIC_PRIVATE_SCALE_SHARE, MECHANIC_SETUP_MAX_SHARE, MECHANIC_SETUP_MIN_SHARE, UPKEEP_SHARE, type EffectBand, type GenericEntity, type WorldState } from "@chronica/shared";
import { arrangementScale } from "../standing-effects";

/**
 * What a rule costs: the model names a setup sum and a monthly keep, and the
 * engine clamps both into bands of the arrangement's own scale (its
 * province's monthly tax capacity), the same figure a standing effect's
 * income and keep are measured by. The keep is written as the entity's
 * `upkeep`, so charging it and lapsing for want of it reuse
 * `settleStandingEffects` unchanged: there is one monthly bill, not two.
 */
export interface MechanicPrice {
  readonly setup: number;
  /** The keep folded into the entity's upkeep, or null: a private rule pays none unless the model named one worth a band at the province's scale. */
  readonly upkeepBand: EffectBand | null;
  /** What that keep comes to a month, charged at the province's scale. */
  readonly keepPerMonth: number;
  readonly scale: number;
}

/** The scale a rule's sums are measured by: the province's for a power, a tenth of it for a person. */
export function mechanicScale(world: WorldState, entity: GenericEntity, ownerPolityId: string | null): number {
  const province = Math.max(1, arrangementScale(world, entity.provinceId ?? null, ownerPolityId));
  return entity.ownerRef?.kind === "polity" ? province : Math.max(1, province * MECHANIC_PRIVATE_SCALE_SHARE);
}

/**
 * `movesMoney`: whether the rule pays or takes anything. The setup floor is
 * for a rule that does -- a toll-house is built, a dole has its granaries --
 * and a rule that only moves a man's regard or an army's spirits costs what
 * the model said it does, nothing included. A letter of respect was charged
 * the floor, and the floor was a private man's last coins (play-test E20).
 */
export function priceMechanic(world: WorldState, entity: GenericEntity, ownerPolityId: string | null, named: { readonly setup: number; readonly upkeepPerMonth: number }, movesMoney = true): MechanicPrice {
  const scale = mechanicScale(world, entity, ownerPolityId);
  const floor = movesMoney ? scale * MECHANIC_SETUP_MIN_SHARE : 0;
  const setup = Math.round(Math.min(Math.max(named.setup, floor), scale * MECHANIC_SETUP_MAX_SHARE));
  // The keep is charged by `settleStandingEffects` at the province's scale,
  // whoever owns the thing, so it is folded in only when the sum the model
  // named comes to at least the slight band there; below that a private rule
  // simply has no keep of its own, which is what the model meant.
  const provinceScale = Math.max(1, arrangementScale(world, entity.provinceId ?? null, ownerPolityId));
  const wanted = named.upkeepPerMonth / provinceScale;
  const bands = (Object.keys(UPKEEP_SHARE) as EffectBand[]).sort((a, b) => UPKEEP_SHARE[a] - UPKEEP_SHARE[b]);
  let upkeepBand: EffectBand | null = null;
  if (wanted >= UPKEEP_SHARE[bands[0]!] / 2) {
    upkeepBand = bands[0]!;
    for (const band of bands) if (Math.abs(UPKEEP_SHARE[band] - wanted) < Math.abs(UPKEEP_SHARE[upkeepBand] - wanted)) upkeepBand = band;
  }
  return { setup, upkeepBand, keepPerMonth: upkeepBand === null ? 0 : Math.round(provinceScale * UPKEEP_SHARE[upkeepBand]), scale };
}

/** The stronger of two keeps: a rule never lowers what the arrangement already paid. */
export function strongerBand(a: EffectBand | null, b: EffectBand): EffectBand {
  if (a === null) return b;
  return UPKEEP_SHARE[a] >= UPKEEP_SHARE[b] ? a : b;
}
