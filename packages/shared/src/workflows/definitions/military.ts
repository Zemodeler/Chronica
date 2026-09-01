import { z } from "zod";
import { EntityIdSchema, BasisPointsSchema } from "../../material-state";
import type { AnyWorkflowDefinition } from "../types";

const FORCE_KIND_SCHEMA = z.enum(["infantry", "cavalry", "siege", "naval", "militia", "mercenary", "other"]);

const randomUUID = () => globalThis.crypto.randomUUID();

export const militaryWorkflows: AnyWorkflowDefinition[] = [
  {
    id: "create_force",
    description: "Raise a new military force for a polity at a specified province. Use when a player orders raising an army, recruiting troops, or mustering soldiers. Requires a polity account to fund the obligation.",
    category: "military",
    parametersSchema: z.object({
      polityId: EntityIdSchema,
      locationProvinceId: EntityIdSchema,
      name: z.string().trim().min(1).max(120),
      size: z.number().int().min(100).max(50_000),
      kind: FORCE_KIND_SCHEMA,
      payerAccountId: EntityIdSchema.optional(),
    }).strict(),
    apply(world, params, context) {
      const polity = world.map.polities.find((p) => p.id === params.polityId);
      if (!polity) return null;
      const province = world.map.provinces.find((p) => p.id === params.locationProvinceId);
      if (!province) return null;
      // payerAccountId is optional — obligation is only created when a valid account exists.
      const account = params.payerAccountId
        ? world.material.accounts.find((a) => a.id === params.payerAccountId)
        : undefined;

      const forceId = randomUUID();
      const categoryId = `cat-${params.kind}-${forceId.slice(0, 8)}`;
      const summary = `${params.name} (${params.size} ${params.kind}) raised in ${province.name} for ${polity.name}.`;

      const baseForce = {
        id: forceId,
        name: params.name,
        polityId: params.polityId,
        commanderCharacterId: context.actorId,
        controllerCharacterId: context.actorId,
        locationId: params.locationProvinceId,
        authorizedStrength: params.size,
        personnel: [{ categoryId, label: params.kind, fit: params.size, unavailable: [] }],
        moraleBps: 7_000,
        cohesionBps: 7_000,
        fatigueBps: 0,
        provisionStatus: "provisioned" as const,
        provisionedThroughStep: context.atStep + 8,
        payArrearsPeriods: 0,
        history: [],
      };

      if (account) {
        const obligationId = randomUUID();
        const obligation = {
          id: obligationId,
          kind: "army_pay" as const,
          label: `Pay for ${params.name}`,
          payerAccountId: account.id,
          amount: Math.max(1, Math.floor(params.size * 2)),
          cadenceSteps: 4,
          nextDueStep: context.atStep + 4,
          priority: 100,
          arrears: 0,
          missedPeriods: 0,
          active: true,
        };
        return {
          world: {
            ...world,
            material: {
              ...world.material,
              obligations: [...world.material.obligations, obligation],
              forces: [...world.material.forces, { ...baseForce, payObligationId: obligationId }],
            },
          },
          result: { summary, applied: true },
        };
      }

      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: [...world.material.forces, { ...baseForce, payObligationId: null }],
          },
        },
        result: { summary, applied: true },
      };
    },
  },

  {
    id: "move_force",
    description: "Move a military force to a different province. The force's locationId changes immediately.",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      destinationProvinceId: EntityIdSchema,
    }).strict(),
    apply(world, params, context) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      const province = world.map.provinces.find((p) => p.id === params.destinationProvinceId);
      if (!province) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id === params.forceId ? { ...f, locationId: params.destinationProvinceId } : f,
            ),
          },
        },
        result: {
          summary: `${force.name} moves to ${province.name}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "injure_force",
    description: "Inflict casualties on a force, reducing its fit personnel count in a given category.",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      categoryId: EntityIdSchema,
      casualties: z.number().int().positive(),
      causeId: EntityIdSchema,
    }).strict(),
    apply(world, params, context) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      const category = force.personnel.find((p) => p.categoryId === params.categoryId);
      if (!category) return null;
      const actualCasualties = Math.min(params.casualties, category.fit);
      if (actualCasualties === 0) return null;
      const eventId = randomUUID();
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id !== params.forceId
                ? f
                : {
                    ...f,
                    personnel: f.personnel.map((p) =>
                      p.categoryId !== params.categoryId
                        ? p
                        : { ...p, fit: p.fit - actualCasualties },
                    ),
                    history: [
                      ...f.history,
                      {
                        id: eventId,
                        atStep: context.atStep,
                        kind: "battle_death" as const,
                        categoryId: params.categoryId,
                        count: actualCasualties,
                        causeId: params.causeId,
                      },
                    ],
                  },
            ),
          },
        },
        result: {
          summary: `${force.name} suffers ${actualCasualties} casualties.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "raise_morale",
    description: "Increase a force's morale by a given basis-points amount (capped at 10 000).",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      deltaBps: z.number().int().min(1).max(5_000),
    }).strict(),
    apply(world, params) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      const next = Math.min(10_000, force.moraleBps + params.deltaBps);
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id === params.forceId ? { ...f, moraleBps: next } : f,
            ),
          },
        },
        result: {
          summary: `${force.name}'s morale improves.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "lower_morale",
    description: "Decrease a force's morale by a given basis-points amount (floor at 0).",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      deltaBps: z.number().int().min(1).max(5_000),
    }).strict(),
    apply(world, params) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      const next = Math.max(0, force.moraleBps - params.deltaBps);
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id === params.forceId ? { ...f, moraleBps: next } : f,
            ),
          },
        },
        result: {
          summary: `${force.name}'s morale falls.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "disband_force",
    description: "Remove a military force from the world permanently.",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.filter((f) => f.id !== params.forceId),
          },
          conflicts: {
            ...world.conflicts,
            battles: world.conflicts.battles.map((b) => ({
              ...b,
              participantForceIds: b.participantForceIds.filter((id) => id !== params.forceId),
            })),
          },
        },
        result: {
          summary: `${force.name} is disbanded. ${params.reason}`,
          applied: true,
        },
      };
    },
  },

  {
    id: "start_battle",
    description: "Start a battle between two forces. Creates a conflict entry in the world.",
    category: "military",
    parametersSchema: z.object({
      battleId: EntityIdSchema,
      attackingForceId: EntityIdSchema,
      defendingForceId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const atk = world.material.forces.find((f) => f.id === params.attackingForceId);
      const def = world.material.forces.find((f) => f.id === params.defendingForceId);
      if (!atk || !def) return null;
      const alreadyExists = world.conflicts.battles.some(
        (b) => b.participantForceIds.includes(params.attackingForceId) && b.participantForceIds.includes(params.defendingForceId),
      );
      if (alreadyExists) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            battles: [
              ...world.conflicts.battles,
              { battleId: params.battleId, participantForceIds: [params.attackingForceId, params.defendingForceId] },
            ],
          },
        },
        result: {
          summary: `${atk.name} engages ${def.name} in battle.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "end_battle",
    description: "Remove a battle from the active conflicts list.",
    category: "military",
    parametersSchema: z.object({
      battleId: EntityIdSchema,
      outcomeLabel: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const battle = world.conflicts.battles.find((b) => b.battleId === params.battleId);
      if (!battle) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            battles: world.conflicts.battles.filter((b) => b.battleId !== params.battleId),
          },
        },
        result: {
          summary: params.outcomeLabel,
          applied: true,
        },
      };
    },
  },

  {
    id: "start_siege",
    description: "Begin a siege of a settlement by besieging forces.",
    category: "military",
    parametersSchema: z.object({
      settlementId: EntityIdSchema,
      invadingForceIds: z.array(EntityIdSchema).min(1),
      defendingForceIds: z.array(EntityIdSchema).default([]),
    }).strict(),
    apply(world, params) {
      const settlementWithProvince = world.map.provinces
        .flatMap((province) => province.settlements.map((settlement) => ({ settlement, province })))
        .find(({ settlement }) => settlement.id === params.settlementId);
      if (!settlementWithProvince) return null;
      const alreadyBesieged = world.conflicts.sieges.some((s) => s.settlementId === params.settlementId);
      if (alreadyBesieged) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            sieges: [
              ...world.conflicts.sieges,
              {
                settlementId: params.settlementId,
                invadingForceIds: params.invadingForceIds,
                defendingForceIds: params.defendingForceIds,
              },
            ],
          },
        },
        result: {
          summary: `A siege begins at ${settlementWithProvince.settlement.name}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "end_siege",
    description: "End an active siege, optionally transferring province control.",
    category: "military",
    parametersSchema: z.object({
      settlementId: EntityIdSchema,
      successfulCapture: z.boolean(),
      newControllerPolityId: EntityIdSchema.optional(),
    }).strict(),
    apply(world, params) {
      const siege = world.conflicts.sieges.find((s) => s.settlementId === params.settlementId);
      if (!siege) return null;
      let nextWorld = {
        ...world,
        conflicts: {
          ...world.conflicts,
          sieges: world.conflicts.sieges.filter((s) => s.settlementId !== params.settlementId),
        },
      };
      if (params.successfulCapture && params.newControllerPolityId) {
        nextWorld = {
          ...nextWorld,
          map: {
            ...nextWorld.map,
            provinces: nextWorld.map.provinces.map((p) =>
              p.settlements.some((settlement) => settlement.id === siege.settlementId)
                ? { ...p, controllerPolityId: params.newControllerPolityId!, controlFirmnessBps: 3_000 }
                : p,
            ),
          },
        };
      }
      const settlementWithProvince = world.map.provinces
        .flatMap((province) => province.settlements.map((settlement) => ({ settlement, province })))
        .find(({ settlement }) => settlement.id === siege.settlementId);
      return {
        world: nextWorld,
        result: {
          summary: params.successfulCapture
            ? `Siege of ${settlementWithProvince?.settlement.name ?? siege.settlementId} succeeds. Province captured.`
            : `Siege of ${settlementWithProvince?.settlement.name ?? siege.settlementId} ends without capture.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "merge_forces",
    description: "Merge one force into another, combining personnel. The source force is removed.",
    category: "military",
    parametersSchema: z.object({
      sourceForceId: EntityIdSchema,
      targetForceId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const src = world.material.forces.find((f) => f.id === params.sourceForceId);
      const tgt = world.material.forces.find((f) => f.id === params.targetForceId);
      if (!src || !tgt) return null;
      const mergedPersonnel = tgt.personnel.map((tp) => {
        const sp = src.personnel.find((p) => p.categoryId === tp.categoryId);
        return sp ? { ...tp, fit: tp.fit + sp.fit } : tp;
      });
      const newCats = src.personnel.filter((sp) => !tgt.personnel.some((tp) => tp.categoryId === sp.categoryId));
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces
              .filter((f) => f.id !== params.sourceForceId)
              .map((f) =>
                f.id !== params.targetForceId
                  ? f
                  : { ...f, personnel: [...mergedPersonnel, ...newCats] },
              ),
          },
          conflicts: {
            ...world.conflicts,
            battles: world.conflicts.battles.map((b) => ({
              ...b,
              participantForceIds: b.participantForceIds.filter((id) => id !== params.sourceForceId),
            })),
          },
        },
        result: {
          summary: `${src.name} is absorbed into ${tgt.name}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "retreat_force",
    description: "Force a military force to retreat to an adjacent province.",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      retreatToProvinceId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      const dest = world.map.provinces.find((p) => p.id === params.retreatToProvinceId);
      if (!force || !dest) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id === params.forceId
                ? { ...f, locationId: params.retreatToProvinceId, cohesionBps: Math.max(0, f.cohesionBps - 2_000) }
                : f,
            ),
          },
        },
        result: {
          summary: `${force.name} retreats to ${dest.name}.`,
          applied: true,
        },
      };
    },
  },
];
