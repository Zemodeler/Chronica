import type { WorldState } from "./world-state";
import type { PolityAgreement } from "./agreements";

/**
 * What each war has cost each power that fights in it, kept on the war itself
 * as it happens (`PolityAgreement.losses`).
 *
 * A war's losses used to be read, whenever asked, off the histories of the
 * armies standing at that moment, and laid to a war by the army's orders and
 * the war's battle days *as they stood when asked*: an army destroyed took its
 * dead with it, an army handed to another power gave it its dead, a change of
 * orders moved a season's dead from one war to another, two wars with battles
 * on the same day each claimed the other's dead, and a loss split evenly among
 * several wars and rounded counted some men twice and some not at all.
 *
 * Now every loss in an army's record -- killed in battle, dead of wounds, of
 * hunger, sickness, the sea or the snow, deserted -- is laid to a war once,
 * the day it is read after it happened (`archiveWarLosses`, at the end of
 * every tick and every applied answer, and before an army is taken out of the
 * world), by what the world shows *then*: a battle's or a siege's dead to the
 * war between the army's power and the enemy it fought; anything else to the
 * war its orders were for; where it has none and its power fights one war,
 * that war; where it fights several, shared out in whole men with nothing
 * left over or counted twice. The army keeps which of its entries have been
 * laid (`Force.lossesArchived`), so nothing is laid twice, and what has been
 * laid stays with the war however the army fares after.
 */

type Force = WorldState["material"]["forces"][number];
type LossEvent = Force["history"][number];

export type WarLossKind = "battle" | "wounds" | "hardship" | "desertion";

const KIND_OF: Partial<Record<LossEvent["kind"], WarLossKind>> = {
  battle_death: "battle",
  wounds_death: "wounds",
  attrition_death: "hardship",
  desertion: "desertion",
};

export interface WarLossTally {
  readonly battle: number;
  readonly wounds: number;
  readonly hardship: number;
  readonly desertion: number;
}

export const NO_LOSSES: WarLossTally = { battle: 0, wounds: 0, hardship: 0, desertion: 0 };

/** The world a loss is laid to a war in: the armies, the wars, the orders, and the fights. */
export type LossWorld = Pick<WorldState, "material" | "polityAgreements"> & {
  readonly campaigns?: readonly { readonly forceId: string; readonly warId: string }[] | undefined;
  readonly sieges?: readonly { readonly id: string; readonly besiegerPolityId: string; readonly defenderPolityId: string }[] | undefined;
  readonly engagements?: readonly { readonly id: string; readonly attackerForceIds: readonly string[]; readonly defenderForceIds: readonly string[] }[] | undefined;
  readonly conflicts?: { readonly battles?: readonly { readonly battleId: string; readonly participantForceIds: readonly string[] }[] | undefined } | undefined;
};

const isWar = (agreement: PolityAgreement): boolean => agreement.kind === "war" && agreement.status === "active";

/** The power whose wars this power fights: itself, and the power it follows by foedus. */
function sidesOf(agreements: readonly PolityAgreement[], polityId: string): readonly string[] {
  const leader = agreements.find((agreement) => agreement.status === "active" && agreement.kind === "foedus" && agreement.polityId === polityId)?.otherPolityId;
  return leader === undefined ? [polityId] : [polityId, leader];
}

/** The wars a power's armies fight in, on a day: begun by then, oldest id first so a share is always laid the same way. */
function warsOn(world: LossWorld, polityId: string, atStep: number): PolityAgreement[] {
  const sides = sidesOf(world.polityAgreements, polityId);
  return world.polityAgreements
    .filter((agreement) => isWar(agreement) && agreement.sinceStep <= atStep && (sides.includes(agreement.polityId) || sides.includes(agreement.otherPolityId)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The enemy powers a fight named by `causeId` was against, as far as the world can still say. */
function opponentsOf(world: LossWorld, causeId: string, force: Force): Set<string> {
  const polityOf = (forceId: string): string | undefined => world.material.forces.find((candidate) => candidate.id === forceId)?.polityId;
  const found = new Set<string>();
  const siege = world.sieges?.find((candidate) => candidate.id === causeId);
  if (siege !== undefined) {
    for (const polityId of [siege.besiegerPolityId, siege.defenderPolityId]) found.add(polityId);
  }
  const engagement = world.engagements?.find((candidate) => candidate.id === causeId);
  if (engagement !== undefined) {
    const ours = engagement.attackerForceIds.includes(force.id) ? engagement.defenderForceIds : engagement.defenderForceIds.includes(force.id) ? engagement.attackerForceIds : [...engagement.attackerForceIds, ...engagement.defenderForceIds];
    for (const id of ours) { const polityId = polityOf(id); if (polityId !== undefined) found.add(polityId); }
  }
  const battle = world.conflicts?.battles?.find((candidate) => candidate.battleId === causeId);
  if (battle !== undefined) {
    for (const id of battle.participantForceIds) { const polityId = polityOf(id); if (polityId !== undefined) found.add(polityId); }
  }
  for (const own of sidesOf(world.polityAgreements, force.polityId)) found.delete(own);
  return found;
}

/**
 * The war or wars one loss of an army is laid to, by what the world shows now,
 * and the men each takes. Empty where its power fights no war.
 */
export function warsOfLoss(world: LossWorld, force: Force, event: LossEvent): { readonly warId: string; readonly count: number }[] {
  const wars = warsOn(world, force.polityId, event.atStep);
  if (wars.length === 0) return [];
  let chosen: PolityAgreement[] = [];
  if (event.kind === "battle_death" || event.kind === "wounds_death") {
    const enemies = opponentsOf(world, event.causeId, force);
    if (enemies.size > 0) {
      chosen = wars.filter((war) => enemies.has(war.polityId) || enemies.has(war.otherPolityId));
      // A fight with nobody it is at war with -- brigands, a private band -- is no war's.
      if (chosen.length === 0) return [];
    }
  }
  if (chosen.length === 0) {
    const ordered = world.campaigns?.find((plan) => plan.forceId === force.id)?.warId;
    const underOrders = ordered === undefined ? undefined : wars.find((war) => war.id === ordered);
    chosen = underOrders !== undefined ? [underOrders] : wars;
  }
  // Shared in whole men: the first wars in their order take the men left over, one each.
  const base = Math.floor(event.count / chosen.length);
  const over = event.count - base * chosen.length;
  return chosen.map((war, index) => ({ warId: war.id, count: base + (index < over ? 1 : 0) })).filter((share) => share.count > 0);
}

const isLoss = (event: LossEvent): boolean => KIND_OF[event.kind] !== undefined;

/** The loss entries of an army not yet laid to a war. */
function unlaid(force: Force): LossEvent[] {
  const laid = new Set(force.lossesArchived?.ids ?? []);
  return force.history.filter((event) => isLoss(event) && !laid.has(event.id));
}

function add(tally: WarLossTally, kind: WarLossKind, count: number): WarLossTally {
  return { ...tally, [kind]: tally[kind] + count };
}

/**
 * Lays every loss not yet laid to the war it belongs to, on the war's own
 * record, and marks it laid on the army. `onlyForceIds` limits it to those
 * armies (an army about to be taken out of the world). Idempotent: a second
 * call lays nothing.
 */
export function archiveWarLosses<W extends LossWorld>(world: W, onlyForceIds?: ReadonlySet<string>): W {
  const laid = new Map<string, Map<string, WarLossTally>>();
  let touched = false;
  const forces = world.material.forces.map((force) => {
    if (onlyForceIds !== undefined && !onlyForceIds.has(force.id)) return force;
    const fresh = unlaid(force);
    if (fresh.length === 0 && force.lossesArchived !== undefined) return force;
    for (const event of fresh) {
      for (const share of warsOfLoss(world, force, event)) {
        const byPolity = laid.get(share.warId) ?? new Map<string, WarLossTally>();
        byPolity.set(force.polityId, add(byPolity.get(force.polityId) ?? NO_LOSSES, KIND_OF[event.kind]!, share.count));
        laid.set(share.warId, byPolity);
      }
    }
    touched = true;
    // What is still in its record is laid; what it has forgotten needs no mark.
    return { ...force, lossesArchived: { ids: force.history.filter(isLoss).map((event) => event.id) } };
  });
  if (!touched) return world;
  const polityAgreements = laid.size === 0 ? world.polityAgreements : world.polityAgreements.map((agreement) => {
    const byPolity = laid.get(agreement.id);
    if (byPolity === undefined) return agreement;
    const losses = [...(agreement.losses ?? [])];
    for (const [polityId, tally] of byPolity) {
      const at = losses.findIndex((entry) => entry.polityId === polityId);
      const before = at < 0 ? { polityId, ...NO_LOSSES } : losses[at]!;
      const after = { polityId, battle: before.battle + tally.battle, wounds: before.wounds + tally.wounds, hardship: before.hardship + tally.hardship, desertion: before.desertion + tally.desertion };
      if (at < 0) losses.push(after); else losses[at] = after;
    }
    return { ...agreement, losses };
  });
  return { ...world, polityAgreements, material: { ...world.material, forces } };
}

/**
 * What one power has lost to one war: what has been laid on the war's record,
 * and what its armies have lost since and not yet had laid, read the same way.
 */
export function lossesToWar(world: LossWorld, war: PolityAgreement, polityId: string): WarLossTally {
  const kept = war.losses?.find((entry) => entry.polityId === polityId);
  let tally: WarLossTally = kept === undefined ? NO_LOSSES : { battle: kept.battle, wounds: kept.wounds, hardship: kept.hardship, desertion: kept.desertion };
  for (const force of world.material.forces) {
    if (force.polityId !== polityId) continue;
    for (const event of unlaid(force)) {
      const share = warsOfLoss(world, force, event).find((entry) => entry.warId === war.id);
      if (share !== undefined) tally = add(tally, KIND_OF[event.kind]!, share.count);
    }
  }
  return tally;
}
