import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import type { AnyWorkflowDefinition } from "../types";

export const politicalWorkflows: AnyWorkflowDefinition[] = [
  {
    id: "start_war",
    description: "Declare war between two polities. Creates a war entry in conflicts.",
    category: "political",
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!a || !b) return null;
      const alreadyAtWar = world.conflicts.wars.some(
        (w) =>
          (w.polityAId === params.polityAId && w.polityBId === params.polityBId) ||
          (w.polityAId === params.polityBId && w.polityBId === params.polityAId),
      );
      if (alreadyAtWar) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            wars: [...world.conflicts.wars, { polityAId: params.polityAId, polityBId: params.polityBId }],
          },
        },
        result: {
          summary: `${a.name} declares war on ${b.name}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "end_war",
    description: "End an active war between two polities via treaty or defeat.",
    category: "political",
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
      termsLabel: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!a || !b) return null;
      const hadWar = world.conflicts.wars.some(
        (w) =>
          (w.polityAId === params.polityAId && w.polityBId === params.polityBId) ||
          (w.polityAId === params.polityBId && w.polityBId === params.polityAId),
      );
      if (!hadWar) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            wars: world.conflicts.wars.filter(
              (w) =>
                !(
                  (w.polityAId === params.polityAId && w.polityBId === params.polityBId) ||
                  (w.polityAId === params.polityBId && w.polityBId === params.polityAId)
                ),
            ),
          },
        },
        result: {
          summary: `The war between ${a.name} and ${b.name} ends. ${params.termsLabel}`,
          applied: true,
        },
      };
    },
  },

  {
    id: "give_territory",
    description: "Transfer control of a province from one polity to another.",
    category: "political",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      newControllerPolityId: EntityIdSchema,
      firmnessBps: z.number().int().min(0).max(10_000).default(5_000),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      const newPolity = world.map.polities.find((p) => p.id === params.newControllerPolityId);
      if (!province || !newPolity) return null;
      const oldPolityId = province.controllerPolityId;
      const oldPolity = world.map.polities.find((p) => p.id === oldPolityId);
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id === params.provinceId
                ? { ...p, controllerPolityId: params.newControllerPolityId, controlFirmnessBps: params.firmnessBps }
                : p,
            ),
          },
        },
        result: {
          summary: `${province.name} passes from ${oldPolity?.name ?? "unknown"} to ${newPolity.name}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "sign_treaty",
    description: "Record a peace treaty between two polities (ends war if active).",
    category: "political",
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
      termsLabel: z.string().min(1).max(400),
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!a || !b) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            wars: world.conflicts.wars.filter(
              (w) =>
                !(
                  (w.polityAId === params.polityAId && w.polityBId === params.polityBId) ||
                  (w.polityAId === params.polityBId && w.polityBId === params.polityAId)
                ),
            ),
          },
        },
        result: {
          summary: `${a.name} and ${b.name} sign a treaty. ${params.termsLabel}`,
          applied: true,
        },
      };
    },
  },

  {
    id: "declare_independence",
    description: "Create a new polity that breaks away from a parent polity and claims a province.",
    category: "political",
    parametersSchema: z.object({
      newPolityId: EntityIdSchema,
      newPolityName: z.string().min(1).max(120),
      capitalSettlementId: EntityIdSchema.nullable(),
      claimedProvinceIds: z.array(EntityIdSchema).min(1).max(8),
    }).strict(),
    apply(world, params) {
      const alreadyExists = world.map.polities.some((p) => p.id === params.newPolityId);
      if (alreadyExists) return null;
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            polities: [
              ...world.map.polities,
              { id: params.newPolityId, name: params.newPolityName, capitalSettlementId: params.capitalSettlementId },
            ],
            provinces: world.map.provinces.map((p) =>
              params.claimedProvinceIds.includes(p.id)
                ? { ...p, controllerPolityId: params.newPolityId, controlFirmnessBps: 4_000 }
                : p,
            ),
          },
        },
        result: {
          summary: `${params.newPolityName} declares independence and establishes itself.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "impose_tribute",
    description: "Create a periodic tribute obligation from one polity's treasury to another.",
    category: "political",
    parametersSchema: z.object({
      tributeId: EntityIdSchema,
      payerAccountId: EntityIdSchema,
      amount: z.number().int().positive(),
      cadenceSteps: z.number().int().min(1).max(36_600),
      label: z.string().min(1).max(120),
      atStep: z.number().int().nonnegative(),
    }).strict(),
    apply(world, params, context) {
      const payerAccount = world.material.accounts.find((a) => a.id === params.payerAccountId);
      if (!payerAccount) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            obligations: [
              ...world.material.obligations,
              {
                id: params.tributeId,
                kind: "tribute" as const,
                label: params.label,
                payerAccountId: params.payerAccountId,
                amount: params.amount,
                cadenceSteps: params.cadenceSteps,
                nextDueStep: context.atStep + params.cadenceSteps,
                priority: 5,
                arrears: 0,
                missedPeriods: 0,
                active: true,
              },
            ],
          },
        },
        result: {
          summary: `A tribute of ${params.amount} is imposed, payable every ${params.cadenceSteps} season(s).`,
          applied: true,
        },
      };
    },
  },

  {
    id: "break_alliance",
    description: "Dissolve an alliance between two polities.",
    category: "political",
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!a || !b) return null;
      return {
        world,
        result: {
          summary: `The alliance between ${a.name} and ${b.name} dissolves. ${params.reason}`,
          applied: true,
        },
      };
    },
  },
];
