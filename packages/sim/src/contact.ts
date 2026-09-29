import {
  atWar,
  isContingencyArmed,
  isNavalForce,
  paperWeightedStrength,
  retreatRoute,
  sameConfederation,
  warfareWith,
  type FactProposalDraft,
  type Force,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement, type BattleAccount } from "./battle";
import type { IdFactory } from "./ports";

/**
 * Armies at war that stand in the same province meet.
 *
 * Rome was at war with Syracuse from the forty-fifth day; Legio I landed at
 * Messana on the sixty-third, where Hieron's army stood, and nothing followed
 * for the rest of the season. A battle came only when somebody ordered one
 * (`force_engage`), or a trap sprang, or a fleet stood across a crossing, or
 * a relief fell on siege lines -- so two enemy armies could share a province
 * as if it were two.
 *
 * Now the day they stand on the same ground, they fight: the stronger side
 * offers battle, the weaker stands to receive it, each with whatever plan it
 * already had (`Force.battlePlan`). A commander badly outmatched does not
 * wait to be destroyed -- he falls back the way a beaten army would
 * (`retreatRoute`), if there is a road off the field that does not run
 * through the sea. Deterministic, like the rest of the tick.
 *
 * What this does not touch:
 *
 * - **Fleets.** Ships do not fight armies; a fleet off a shore is the
 *   crossings' business (`crossings.ts`).
 * - **A siege.** The besiegers and the city's side are already at grips in
 *   their lines, and a relief coming up is the siege's to fight
 *   (`sieges.ts`), or to make them draw off. Other wars in the same
 *   province are not.
 * - **An ambush lying in wait.** The men held back for a trap stay hidden
 *   until it springs (`contingencies.ts`).
 * - **Armies that have just fought.** A drawn field is not fought again the
 *   next morning: a week to bury the dead and reform, then they meet again if
 *   neither has gone.
 */

/** A side weaker than this share of the other falls back rather than stand. */
const WITHDRAWS_BELOW = 1 / 3;
/** Days after a battle before an army that fought it is brought to battle again by contact. */
const REST_AFTER_BATTLE_DAYS = 7;
/** What falling back in the enemy's face costs in fatigue, in basis points. */
const WITHDRAWAL_FATIGUE_BPS = 1_000;

/**
 * Where this module's battles start numbering their facts: apart from the
 * crossings' and the sieges' fights of the same tick, and from each other, so
 * their facts are not taken for one another.
 */
const CONTACT_FACT_INDEX = 900;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

/** Whose side a force is on: its power's, or -- an outlaw band -- its own. */
const sideOf = (force: Force): string => (force.outlaw === true ? `outlaw:${force.id}` : force.polityId);

function hostile(world: WorldState, a: Force, b: Force): boolean {
  if (sideOf(a) === sideOf(b)) return false;
  if (a.outlaw === true || b.outlaw === true) return true;
  return atWar(world.polityAgreements, a.polityId, b.polityId);
}

/** One side of a meeting: the lead's own, and whoever stands with it against the other. */
function sideWith(world: WorldState, lead: Force, against: Force, here: readonly Force[]): Force[] {
  return here.filter((force) => force.id === lead.id
    || (!hostile(world, force, lead) && hostile(world, force, against)
      && (sideOf(force) === sideOf(lead) || (force.outlaw !== true && lead.outlaw !== true && sameConfederation(world.polityAgreements, force.polityId, lead.polityId)))));
}

function foughtLately(force: Force, toDay: number): boolean {
  return force.history.some((event) => event.kind === "battle_death" && event.atStep > toDay - REST_AFTER_BATTLE_DAYS);
}

export interface ContactInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly warfare: ScenarioWarfareRules;
  readonly ids: IdFactory;
  readonly playerCharacterId?: string | null | undefined;
}

export function armiesMeet(input: ContactInput): { world: WorldState; facts: FactProposalDraft[]; battles: BattleAccount[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  const rules = warfareWith(world, input.warfare);
  const name = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;

  // Held back for a trap: not to be found before it springs.
  const lyingInWait = new Set(world.contingencies
    .filter((plan) => isContingencyArmed(plan) && plan.ambushForceId !== null)
    .map((plan) => plan.ambushForceId!));

  const provinces = [...new Set(world.material.forces.map((force) => force.locationId))].sort();
  for (const provinceId of provinces) {
    const here = world.material.forces
      .filter((force) => force.locationId === provinceId && fitOf(force) > 0 && !isNavalForce(force, rules)
        && !lyingInWait.has(force.id) && !foughtLately(force, input.toDay))
      .sort((a, b) => paperWeightedStrength(b, rules) - paperWeightedStrength(a, rules) || a.id.localeCompare(b.id));
    // The city's side and its besiegers are the siege's to settle -- and,
    // for a week after besiegers drew off from a relief rather than fight it,
    // not brought to the battle they drew off to avoid.
    const sieges = world.sieges.filter((siege) => siege.provinceId === provinceId
      && (siege.status === "active" || (siege.status === "lifted" && siege.endedAtStep !== null && siege.endedAtStep > input.toDay - REST_AFTER_BATTLE_DAYS)));
    const inTheSiege = (a: Force, b: Force): boolean => sieges.some((siege) => {
      const besieging = (force: Force): boolean => force.id === siege.forceId || force.polityId === siege.besiegerPolityId;
      const holding = (force: Force): boolean => (siege.garrisonForceIds ?? []).includes(force.id) || force.polityId === siege.defenderPolityId
        || sameConfederation(world.polityAgreements, force.polityId, siege.defenderPolityId);
      return (besieging(a) && holding(b)) || (besieging(b) && holding(a));
    });

    // The strongest army here, and the strongest of its enemies.
    let pair: [Force, Force] | null = null;
    for (const lead of here) {
      const enemy = here.find((other) => hostile(world, lead, other) && !inTheSiege(lead, other));
      if (enemy !== undefined) { pair = [lead, enemy]; break; }
    }
    if (pair === null) continue;
    const [lead, enemy] = pair;
    const ours = sideWith(world, lead, enemy, here).filter((force) => !inTheSiege(force, enemy));
    const theirs = sideWith(world, enemy, lead, here).filter((force) => !ours.includes(force) && !inTheSiege(force, lead));
    const weight = (side: readonly Force[]): number => side.reduce((sum, force) => sum + paperWeightedStrength(force, rules), 0);
    const [strong, weak] = weight(ours) >= weight(theirs) ? [ours, theirs] : [theirs, ours];

    // Badly outmatched, the weaker side falls back while it can.
    if (weight(weak) < weight(strong) * WITHDRAWS_BELOW) {
      const enemies = new Set(strong.map((force) => force.polityId));
      const to = retreatRoute(world, weak[0]!, provinceId, enemies);
      if (to !== null) {
        const going = new Set(weak.map((force) => force.id));
        world = {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((force) => (going.has(force.id)
              ? { ...force, locationId: to, positionId: null, fatigueBps: Math.min(10_000, force.fatigueBps + WITHDRAWAL_FATIGUE_BPS) }
              : force)),
          },
        };
        facts.push({
          localId: `withdrew_${weak[0]!.id}_${input.toDay}`.slice(0, 60),
          kind: "force_withdrew",
          summary: `${weak.map((force) => force.name).join(" and ")} would not give battle to ${strong.map((force) => force.name).join(" and ")} in ${name(provinceId)}, and fell back into ${name(to)}.`.slice(0, 600),
          affectedRefs: [
            ...weak.slice(0, 3).map((force) => ({ kind: "force" as const, id: force.id })),
            ...strong.slice(0, 3).map((force) => ({ kind: "force" as const, id: force.id })),
            { kind: "province", id: provinceId },
            { kind: "province", id: to },
          ],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 50,
        });
        continue;
      }
    }

    const attacker = strong[0]!;
    const defender = weak[0]!;
    const engagement = resolveEngagement({
      world,
      attacker,
      attackerAllies: strong.slice(1),
      defender,
      defenderAllies: weak.slice(1),
      posture: "offer_battle",
      tactic: attacker.battlePlan ?? null,
      defenderTactic: defender.battlePlan ?? null,
      warfare: rules,
      battleId: input.ids.next("battle"),
      seed: `${provinceId}:contact:${input.toDay}`,
      playerCharacterId: input.playerCharacterId ?? null,
    }, CONTACT_FACT_INDEX + battles.length);
    world = engagement.world;
    facts.push(...engagement.facts);
    if (engagement.account !== undefined) battles.push(engagement.account);
  }
  return { world, facts, battles };
}
