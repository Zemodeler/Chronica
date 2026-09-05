import { z } from "zod";
import { EntityIdSchema, type Force } from "../../material-state";
import { DetailTierSchema, SettlementKindSchema } from "../../world/map";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";

const allSettlements = (world: Parameters<AnyWorkflowDefinition["apply"]>[0]) =>
  world.map.provinces.flatMap((province) => province.settlements.map((settlement) => ({ settlement, province })));

/** A force with at least one living soldier still fit to fight -- a record reduced to zero fit everywhere is not a defender any more. */
function forceIsLive(force: Force): boolean {
  return force.personnel.some((category) => category.fit > 0);
}

export const mapWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "change_province_control",
    description:
      "Transfer control of a province to a different polity, adjusting firmness. Refused unless the province is verifiably undefended and reachable: a living force of the new controller must already stand there, and no living force of any other power may. A province with a real defending force still present must be taken by a decisive siege or battle first, or ceded diplomatically with give_territory.",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      newControllerPolityId: EntityIdSchema.nullable(),
      firmnessBps: z.number().int().min(0).max(10_000).default(5_000),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) {
        return refuse(`No province exists with the id "${params.provinceId}". The world state lists every province id; use the one you mean.`);
      }
      if (params.newControllerPolityId !== null) {
        const polity = world.map.polities.find((p) => p.id === params.newControllerPolityId);
        if (!polity) {
          const known = world.map.polities.map((p) => `${p.name} (${p.id})`).join("; ");
          return refuse(`No power exists with the id "${params.newControllerPolityId}" to take control. The powers that exist are: ${known}.`);
        }
      }

      // A conquest, not merely a firmness adjustment: control is actually
      // changing to a real new power. This is the one path this workflow
      // offers for "the ground was undefended and my army already stands on
      // it" (docs/14 Phase 1 rule 10) -- so it is the one place that claim
      // is verified, not narrated. A cession where the old power still has
      // troops present belongs to give_territory's diplomatic-authorization
      // path instead; this workflow never bypasses a real defender.
      if (params.newControllerPolityId !== null && params.newControllerPolityId !== province.controllerPolityId) {
        const forcesPresent = world.material.forces.filter((f) => f.locationId === province.id && forceIsLive(f));
        const opposing = forcesPresent.filter((f) => f.polityId !== params.newControllerPolityId);
        if (opposing.length > 0) {
          return refuse(
            `${province.name} is not undefended: ${opposing.map((f) => `${f.name} (${f.polityId})`).join(", ")} still stands there. `
            + "It cannot be handed to a new power by fiat. Win a siege (start_siege, end_siege) or a decisive battle first, or cede it diplomatically with give_territory and an accepted message.",
          );
        }
        const attackerPresent = forcesPresent.some((f) => f.polityId === params.newControllerPolityId);
        if (!attackerPresent) {
          const newControllerName = world.map.polities.find((p) => p.id === params.newControllerPolityId)?.name ?? params.newControllerPolityId;
          return refuse(
            `No force of ${newControllerName} stands in ${province.name}, so there is nothing to confirm as having taken it unopposed. Move a force there first, or resolve a siege, battle, or diplomatic cession (give_territory).`,
          );
        }
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
      // Renaming a province to the name it already bears changes nothing, and
      // must not push a duplicate onto formerNames as though it had.
      if (province.name === params.newName) {
        return {
          world,
          result: { summary: `${province.name} keeps the name it already bears.`, applied: true, noOp: true },
        };
      }
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

  defineWorkflow({
    id: "found_settlement",
    description: "Found a new settlement inside an existing province. World Director authority only.",
    category: "map",
    invokerAuthority: ["world_director"] as unknown as never[],
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      settlementId: EntityIdSchema,
      name: z.string().trim().min(1).max(120),
      kind: SettlementKindSchema,
      size: z.number().int().nonnegative(),
      controllerPolityId: EntityIdSchema.nullable().default(null),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      if (allSettlements(world).some(({ settlement }) => settlement.id === params.settlementId)) return null;
      if (params.controllerPolityId !== null && !world.map.polities.some((p) => p.id === params.controllerPolityId)) return null;
      const newSettlement = {
        id: params.settlementId,
        name: params.name,
        kind: params.kind,
        provinceId: province.id,
        controllerPolityId: params.controllerPolityId,
        size: params.size,
        fortificationLevel: 0,
      };
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id === params.provinceId ? { ...p, settlements: [...p.settlements, newSettlement] } : p,
            ),
          },
        },
        result: {
          summary: `${params.name} is founded in ${province.name}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "raze_settlement",
    description: "Permanently remove a settlement from its province (destruction, depopulation).",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      settlementId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      const settlement = province.settlements.find((s) => s.id === params.settlementId);
      if (!settlement) return null;
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id === params.provinceId
                ? { ...p, settlements: p.settlements.filter((s) => s.id !== params.settlementId) }
                : p,
            ),
          },
        },
        result: {
          summary: `${settlement.name} is razed. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "cede_settlement",
    description: "Change a single settlement's local controller without changing the province's controller (a city defects or surrenders independently).",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      settlementId: EntityIdSchema,
      newControllerPolityId: EntityIdSchema.nullable(),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      const settlement = province.settlements.find((s) => s.id === params.settlementId);
      if (!settlement) return null;
      if (params.newControllerPolityId !== null && !world.map.polities.some((p) => p.id === params.newControllerPolityId)) return null;
      const newControllerName = params.newControllerPolityId
        ? (world.map.polities.find((p) => p.id === params.newControllerPolityId)?.name ?? params.newControllerPolityId)
        : "no one";
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
                      s.id === params.settlementId ? { ...s, controllerPolityId: params.newControllerPolityId } : s,
                    ),
                  },
            ),
          },
        },
        result: {
          summary: `${settlement.name} passes to ${newControllerName}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "split_province",
    description: "Split a province in two, moving named settlements (by id) into a new province.",
    category: "map",
    parametersSchema: z.object({
      sourceProvinceId: EntityIdSchema,
      newProvinceId: EntityIdSchema,
      newProvinceName: z.string().trim().min(1).max(120),
      terrainId: EntityIdSchema,
      movedSettlementIds: z.array(EntityIdSchema).min(1),
    }).strict(),
    apply(world, params) {
      const source = world.map.provinces.find((p) => p.id === params.sourceProvinceId);
      if (!source) return null;
      if (world.map.provinces.some((p) => p.id === params.newProvinceId)) return null;
      const movedSet = new Set(params.movedSettlementIds);
      if (!params.movedSettlementIds.every((id) => source.settlements.some((s) => s.id === id))) return null;
      const movedSettlements = source.settlements
        .filter((s) => movedSet.has(s.id))
        .map((s) => ({ ...s, provinceId: params.newProvinceId }));
      const newProvince = {
        id: params.newProvinceId,
        name: params.newProvinceName,
        formerNames: [],
        terrainId: params.terrainId,
        settlements: movedSettlements,
        controllerPolityId: source.controllerPolityId,
        controlFirmnessBps: source.controlFirmnessBps,
        tier: source.tier,
      };
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: [
              ...world.map.provinces.map((p) =>
                p.id === params.sourceProvinceId
                  ? { ...p, settlements: p.settlements.filter((s) => !movedSet.has(s.id)) }
                  : p,
              ),
              newProvince,
            ],
          },
        },
        result: {
          summary: `${params.newProvinceName} splits off from ${source.name}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "merge_provinces",
    description: "Merge one province into another, moving all settlements and dropping the absorbed province.",
    category: "map",
    parametersSchema: z.object({
      absorbedProvinceId: EntityIdSchema,
      targetProvinceId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      if (params.absorbedProvinceId === params.targetProvinceId) return null;
      const absorbed = world.map.provinces.find((p) => p.id === params.absorbedProvinceId);
      const target = world.map.provinces.find((p) => p.id === params.targetProvinceId);
      if (!absorbed || !target) return null;
      const movedSettlements = absorbed.settlements.map((s) => ({ ...s, provinceId: target.id }));
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces
              .filter((p) => p.id !== params.absorbedProvinceId)
              .map((p) =>
                p.id === params.targetProvinceId
                  ? {
                      ...p,
                      settlements: [...p.settlements, ...movedSettlements],
                      formerNames: [...p.formerNames, absorbed.name],
                    }
                  : p,
              ),
            edges: world.map.edges.filter(
              (edge) => edge.from !== params.absorbedProvinceId && edge.to !== params.absorbedProvinceId,
            ),
          },
        },
        result: {
          summary: `${absorbed.name} is absorbed into ${target.name}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "change_province_tier",
    description: "Change a province's detail tier (focus, near, or far).",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      newTier: DetailTierSchema,
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      if (province.tier === params.newTier) return null;
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id === params.provinceId ? { ...p, tier: params.newTier } : p,
            ),
          },
        },
        result: {
          summary: `${province.name} shifts to ${params.newTier} detail.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "fortify_province_capital",
    description: "Set the fortification level of a province's principal settlement directly (capital-defense projects, siege preparation).",
    category: "map",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      settlementId: EntityIdSchema,
      newFortificationLevel: z.number().int().min(0).max(10),
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      const settlement = province.settlements.find((s) => s.id === params.settlementId);
      if (!settlement) return null;
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
                      s.id === params.settlementId ? { ...s, fortificationLevel: params.newFortificationLevel } : s,
                    ),
                  },
            ),
          },
        },
        result: {
          summary: `${settlement.name}'s defenses are set to level ${params.newFortificationLevel}.`,
          applied: true,
        },
      };
    },
  }),
];
