import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";

export const mapWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "change_province_control",
    description: "Transfer control of a province to a different polity, adjusting firmness.",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      newControllerPolityId: EntityIdSchema.nullable(),
      firmnessBps: z.number().int().min(0).max(10_000).default(5_000),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      if (params.newControllerPolityId !== null) {
        const polity = world.map.polities.find((p) => p.id === params.newControllerPolityId);
        if (!polity) return null;
      }
      const oldControllerName = province.controllerPolityId
        ? (world.map.polities.find((p) => p.id === province.controllerPolityId)?.name ?? province.controllerPolityId)
        : "neutral";
      const newControllerName = params.newControllerPolityId
        ? (world.map.polities.find((p) => p.id === params.newControllerPolityId)?.name ?? params.newControllerPolityId)
        : "neutral";
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
          summary: `${province.name} passes from ${oldControllerName} to ${newControllerName}. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "weaken_province_control",
    description: "Reduce the control firmness of a province without changing its controller.",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      lossBps: z.number().int().min(1).max(10_000),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      const next = Math.max(0, province.controlFirmnessBps - params.lossBps);
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id === params.provinceId ? { ...p, controlFirmnessBps: next } : p,
            ),
          },
        },
        result: {
          summary: `Control of ${province.name} weakens. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "fortify_settlement",
    description: "Increase the fortification level of a settlement.",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      settlementId: EntityIdSchema,
      levelIncrease: z.number().int().min(1).max(5),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      const settlement = province.settlements.find((s) => s.id === params.settlementId);
      if (!settlement) return null;
      const newLevel = Math.min(10, settlement.fortificationLevel + params.levelIncrease);
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id !== params.provinceId
                ? p
                : {
                    ...p,
                    settlements: p.settlements.map((s) =>
                      s.id === params.settlementId ? { ...s, fortificationLevel: newLevel } : s,
                    ),
                  },
            ),
          },
        },
        result: {
          summary: `${settlement.name} fortifications improved to level ${newLevel}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "rename_province",
    description: "Change the name of a province (adds the old name to formerNames).",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      newName: z.string().min(1).max(120),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id === params.provinceId
                ? { ...p, name: params.newName, formerNames: [...p.formerNames, p.name] }
                : p,
            ),
          },
        },
        result: {
          summary: `${province.name} is renamed to ${params.newName}.`,
          applied: true,
        },
      };
    },
  }),
];
