import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";
import { resolveBattle, summarizeBattleResult, BattlePostureSchema, type ResolveBattleParticipant } from "../../warfare/battle-resolver";
import type { CasualtyResult, ForceStateChange, CommanderStateChange, RetreatResult, SiegeOrControlChange } from "../../warfare/battle";
import type { Force } from "../../material-state";
import { adjustPolityLegitimacy } from "../../material/legitimacy";
import { TacticalModifierProposalSchema } from "../../actions/verdict";

/**
 * Apply one casualty entry: permanent losses reduce `fit` directly; wounds
 * move into `unavailable`, eligible to recover later.
 *
 * Every id here is derived from the battle/force/category/kind, never
 * `crypto.randomUUID()` -- a resolved battle must replay to the exact same
 * world, ids included, and a random id would break that on every replay.
 */
function applyCasualtyToForce(force: Force, casualty: CasualtyResult, battleId: string): Force {
  const permanentLoss = casualty.dead + casualty.deserted;
  const idFor = (kind: string) => `${battleId}:${casualty.forceId}:${casualty.categoryId}:${kind}`;
  const history = [...force.history];
  if (casualty.dead > 0) {
    history.push({ id: idFor("dead"), atStep: casualty.recoveryEligibleAtStep, kind: "battle_death", categoryId: casualty.categoryId, count: casualty.dead, causeId: battleId });
  }
  if (casualty.deserted > 0) {
    history.push({ id: idFor("deserted"), atStep: casualty.recoveryEligibleAtStep, kind: "desertion", categoryId: casualty.categoryId, count: casualty.deserted, causeId: battleId });
  }
  if (casualty.wounded > 0) {
    history.push({ id: idFor("wounded"), atStep: casualty.recoveryEligibleAtStep, kind: "unavailable", categoryId: casualty.categoryId, count: casualty.wounded, causeId: battleId });
  }
  return {
    ...force,
    personnel: force.personnel.map((category) => {
      if (category.categoryId !== casualty.categoryId) return category;
      const totalLoss = permanentLoss + casualty.wounded;
      const unavailable = casualty.wounded > 0
        ? [...category.unavailable, { id: idFor("unavailable-group"), count: casualty.wounded, causeKind: "wounds" as const, causeId: battleId, earliestRecoveryStep: casualty.recoveryEligibleAtStep }]
        : category.unavailable;
      return { ...category, fit: Math.max(0, category.fit - totalLoss), unavailable };
    }),
    history,
  };
}

function applyForceChange(force: Force, change: ForceStateChange): Force {
  return { ...force, moraleBps: change.moraleBps, cohesionBps: change.cohesionBps, fatigueBps: change.fatigueBps };
}

function applyRetreat(force: Force, retreat: RetreatResult): Force {
  return retreat.toProvinceId ? { ...force, locationId: retreat.toProvinceId } : force;
}

export const battleResolutionWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "resolve_battle",
    description: "Deterministically resolve an active battle from authoritative force, commander, terrain, position, and supply state. System-invoked only, immediately after start_battle.",
    category: "military",
    invokerAuthority: ["system"],
    parametersSchema: z.object({
      battleId: EntityIdSchema,
      /** Forwarded from `start_battle`'s own optional posture params (docs/14 Phase 1's order posture, consumed here per docs/19 Phase 3). */
      attackerPosture: BattlePostureSchema.optional(),
      defenderPosture: BattlePostureSchema.optional(),
      /** Novel tactics proposed for this battle, checked and bounded by the resolver itself (docs/19 Phase 3). */
      tacticalProposals: z.array(TacticalModifierProposalSchema).optional(),
    }).strict(),
    apply(world, params, context) {
      const battle = world.conflicts.battles.find((b) => b.battleId === params.battleId);
      if (!battle) return null;
      const attackerForceIds = battle.attackerForceIds;
      const defenderForceIds = battle.participantForceIds.filter((id) => !attackerForceIds.includes(id));
      if (attackerForceIds.length === 0 || defenderForceIds.length === 0) return null;
      const attackerForces = attackerForceIds.map((id) => world.material.forces.find((f) => f.id === id));
      const defenderForces = defenderForceIds.map((id) => world.material.forces.find((f) => f.id === id));
      if (attackerForces.some((f) => !f) || defenderForces.some((f) => !f)) return null;
      // "The" attacker/defender force below, used only to anchor the
      // province and to attribute the political consequence of a decisive
      // outcome, is the lead (first-listed) force on each side -- a
      // multi-force side is otherwise resolved as N full participants, not
      // merged into one synthetic force (docs/19 Phase 3).
      const attackerForce = attackerForces[0]!;
      const defenderForce = defenderForces[0]!;
      const province = world.map.provinces.find((p) => p.id === defenderForce.locationId);
      if (!province) return null;

      const commanderFor = (force: Force) => world.characters.find((c) => c.id === force.commanderCharacterId && c.alive) ?? null;
      const participants: ResolveBattleParticipant[] = [
        ...attackerForces.map((force) => ({ forceId: force!.id, side: "attacker" as const, force: force!, commander: commanderFor(force!), ...(params.attackerPosture ? { posture: params.attackerPosture } : {}) })),
        ...defenderForces.map((force) => ({ forceId: force!.id, side: "defender" as const, force: force!, commander: commanderFor(force!), ...(params.defenderPosture ? { posture: params.defenderPosture } : {}) })),
      ];
      const adjacentProvinceIds = world.map.edges
        .filter((edge) => edge.from === province.id || edge.to === province.id)
        .map((edge) => (edge.from === province.id ? edge.to : edge.from));
      const provinceMaterial = world.material.provinceMaterial.find((m) => m.provinceId === province.id) ?? null;

      const result = resolveBattle(
        {
          battle: { battleId: battle.battleId, provinceId: province.id, startedAtStep: context.atStep, participants: participants.map((p) => ({ forceId: p.forceId, side: p.side, arrivesAtPhase: "contact" as const })) },
          participants, province, provinceMaterial, adjacentProvinceIds, tacticalProposals: params.tacticalProposals,
          // docs/32 corrective pass, requirement 5: a fortress/wall standing
          // in this province adds its defensive bonus for real, not merely
          // as a note -- see `structureDefenseBps` in the resolver.
          structures: world.structures,
        },
        `${context.atStep}:combat:${battle.battleId}`,
      );

      let forces = world.material.forces;
      for (const casualty of result.casualties) {
        forces = forces.map((f) => (f.id === casualty.forceId ? applyCasualtyToForce(f, casualty, battle.battleId) : f));
      }
      for (const change of result.forceChanges) {
        forces = forces.map((f) => (f.id === change.forceId ? applyForceChange(f, change) : f));
      }
      for (const retreat of result.retreats) {
        forces = forces.map((f) => (f.id === retreat.forceId ? applyRetreat(f, retreat) : f));
      }

      const commanderOutcomeById = new Map<string, CommanderStateChange["outcome"]>(
        result.commanderChanges.map((change) => [change.characterId, change.outcome]),
      );
      const characters = world.characters.map((c) => {
        const outcome = commanderOutcomeById.get(c.id);
        if (!outcome || outcome === "unharmed") return c;
        if (outcome === "killed") return { ...c, alive: false, diedAtStep: context.atStep };
        if (outcome === "wounded" || outcome === "captured") {
          return { ...c, healthBps: Math.max(0, c.healthBps - 3_000) };
        }
        return c;
      });

      const controlChangeByProvince = new Map<string, SiegeOrControlChange>(
        result.siegeAndControlChanges.map((change) => [change.provinceId, change]),
      );
      const provinces = world.map.provinces.map((p) => {
        const change = controlChangeByProvince.get(p.id);
        return change ? { ...p, controlFirmnessBps: change.controlFirmnessBps } : p;
      });

      const forceNameById = new Map(world.material.forces.map((f) => [f.id, f.name]));
      const summary = summarizeBattleResult(result, forceNameById, province.name);

      // A decisive victory (the same condition that weakens the defender's
      // control firmness above) is a political fact, not only a military
      // one: it moves both polities' standing (docs/14 Phase 6, "battle
      // results create durable ... political ... effects").
      const decisive = result.siegeAndControlChanges.length > 0;
      const winnerPolityId = decisive ? (result.outcome === "attacker_victory" ? attackerForce.polityId : defenderForce.polityId) : null;
      const loserPolityId = decisive ? (result.outcome === "attacker_victory" ? defenderForce.polityId : attackerForce.polityId) : null;
      const polityLegitimacy = decisive
        ? adjustPolityLegitimacy(
            adjustPolityLegitimacy(world.material.polityLegitimacy, winnerPolityId!, 300, `Victory at ${province.name}`, params.battleId),
            loserPolityId!, -300, `Defeat at ${province.name}`, params.battleId,
          )
        : world.material.polityLegitimacy;

      return {
        world: {
          ...world,
          characters,
          map: { ...world.map, provinces },
          material: { ...world.material, forces, polityLegitimacy },
          conflicts: {
            ...world.conflicts,
            battles: world.conflicts.battles.filter((b) => b.battleId !== params.battleId),
          },
        },
        result: { summary, applied: true },
      };
    },
  }),
];
