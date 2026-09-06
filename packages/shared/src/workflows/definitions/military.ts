import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";
import { BattlePostureSchema } from "../../warfare/battle-resolver";

const FORCE_KIND_SCHEMA = z.enum(["infantry", "cavalry", "siege", "naval", "militia", "mercenary", "other"]);

const randomUUID = () => globalThis.crypto.randomUUID();

interface BattleConflict {
  readonly battleId: string;
  readonly participantForceIds: readonly string[];
  readonly attackerForceIds: readonly string[];
}

function removeForceFromBattle<T extends BattleConflict>(battle: T, forceId: string): T {
  return {
    ...battle,
    participantForceIds: battle.participantForceIds.filter((id) => id !== forceId),
    attackerForceIds: battle.attackerForceIds.filter((id) => id !== forceId),
  };
}

/** A battle needs at least one force still fighting on each side. */
function battleHasBothSides(battle: BattleConflict): boolean {
  return battle.attackerForceIds.length >= 1 && battle.participantForceIds.length > battle.attackerForceIds.length;
}

export const militaryWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "army_change_name",
    description: "Rename an existing military force, such as an army or legion.",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      newName: z.string().trim().min(1).max(120),
    }).strict(),
    apply(world, params) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id === params.forceId ? { ...f, name: params.newName } : f,
            ),
          },
        },
        result: {
          summary: force.name === params.newName
            ? `${force.name} keeps the name it already bears.`
            : `${force.name} is renamed to ${params.newName}.`,
          applied: true,
          ...(force.name === params.newName ? { noOp: true } : {}),
        },
      };
    },
  }),

  defineWorkflow({
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
        positionId: null,
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
  }),

  defineWorkflow({
    id: "move_force",
    description: "Move a military force to a different province. The force's locationId changes immediately.",
    category: "military",
    parametersSchema: z.object({
      forceId: EntityIdSchema,
      destinationProvinceId: EntityIdSchema,
    }).strict(),
    apply(world, params, _context) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      const province = world.map.provinces.find((p) => p.id === params.destinationProvinceId);
      if (!province) return null;
      if (force.locationId === params.destinationProvinceId) {
        return {
          world,
          result: {
            summary: `${force.name} is already at ${province.name}.`,
            applied: true,
            noOp: true,
          },
        };
      }
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
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
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
            battles: world.conflicts.battles
              .map((b) => removeForceFromBattle(b, params.forceId))
              .filter(battleHasBothSides),
          },
        },
        result: {
          summary: `${force.name} is disbanded. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "start_battle",
    description: "Start a battle between two sides, each one or more forces. A multi-force side is merged into the resolver as one combined contribution (docs/19 Phase 3); no new phase-arrival model is needed. An optional posture per side (offer_battle, avoid_battle, defend, hold) is carried through to the battle's deterministic resolution.",
    category: "military",
    parametersSchema: z.object({
      battleId: EntityIdSchema,
      attackingForceIds: z.array(EntityIdSchema).min(1),
      // Deliberately not `.min(1)`. An empty defender list is a real thing an
      // army can meet, and rejecting it at the schema turned "there was no one
      // there to fight" into an argument error the caller could not act on and
      // reported to the player as though the world had refused. It is refused
      // below instead, in words, naming the tool that does answer the case.
      defendingForceIds: z.array(EntityIdSchema),
      attackerPosture: BattlePostureSchema.optional(),
      defenderPosture: BattlePostureSchema.optional(),
    }).strict(),
    apply(world, params) {
      const attackers = params.attackingForceIds.map((id) => world.material.forces.find((f) => f.id === id));
      const defenders = params.defendingForceIds.map((id) => world.material.forces.find((f) => f.id === id));
      if (params.defendingForceIds.length === 0) {
        // The commonest reason there is no defender: the ground being taken
        // belongs to a power that has no army at all.
        return refuse(
          "No force is named on the defending side, so there is no battle to fight. An unopposed advance is not a battle: besiege the settlement with start_siege (which accepts an empty defender list) or take the ground with change_province_control, and say that it was taken unopposed.",
        );
      }
      if (attackers.some((f) => !f) || defenders.some((f) => !f)) {
        const missing = [...params.attackingForceIds, ...params.defendingForceIds].filter((id) => !world.material.forces.some((f) => f.id === id));
        return refuse(`No force exists with the id ${missing.map((id) => `"${id}"`).join(", ")}. Inspect the province to see which forces actually stand there.`);
      }
      const alreadyExists = world.conflicts.battles.some(
        (b) => params.attackingForceIds.some((id) => b.participantForceIds.includes(id))
          && params.defendingForceIds.some((id) => b.participantForceIds.includes(id)),
      );
      if (alreadyExists) return null;
      const attackerNames = attackers.map((f) => f!.name).join(" and ");
      const defenderNames = defenders.map((f) => f!.name).join(" and ");
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            battles: [
              ...world.conflicts.battles,
              {
                battleId: params.battleId,
                participantForceIds: [...params.attackingForceIds, ...params.defendingForceIds],
                attackerForceIds: [...params.attackingForceIds],
              },
            ],
          },
        },
        result: {
          summary: `${attackerNames} engages ${defenderNames} in battle.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
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
      if (!settlementWithProvince) {
        // A guessed id is often the settlement's display name instead of its
        // authoritative id (e.g. "messana" for "settlement-messana"): surface
        // any settlement whose name or id matches what was guessed before an
        // arbitrary cap on the rest of the list pushes the real answer out.
        const guess = params.settlementId.toLowerCase();
        const allSettlements = world.map.provinces.flatMap((province) => province.settlements);
        const matches = allSettlements.filter(
          (settlement) => settlement.name.toLowerCase().includes(guess) || settlement.id.toLowerCase().includes(guess),
        );
        const rest = allSettlements.filter((settlement) => !matches.includes(settlement));
        const known = [...matches, ...rest]
          .slice(0, 12)
          .map((settlement) => `${settlement.name} (${settlement.id})`)
          .join("; ");
        return refuse(`No settlement exists with the id "${params.settlementId}". Settlements that do exist include: ${known || "none"}. Use inspect_province to get the id of the one you mean.`);
      }
      const alreadyBesieged = world.conflicts.sieges.some((s) => s.settlementId === params.settlementId);
      if (alreadyBesieged) return refuse(`${settlementWithProvince.settlement.name} is already under siege; it cannot be besieged twice.`);
      const invadingForces = params.invadingForceIds.map((id) => world.material.forces.find((f) => f.id === id));
      const missingBesiegers = params.invadingForceIds.filter((id, index) => !invadingForces[index]);
      if (missingBesiegers.length > 0) {
        return refuse(`No force exists with the id ${missingBesiegers.map((id) => `"${id}"`).join(", ")}, so nothing can lay the siege.`);
      }
      // A siege is a real army sitting outside a real wall: naming a force
      // that is somewhere else entirely is not a siege, it is a claim.
      const outOfRange = invadingForces.filter((force) => force!.locationId !== settlementWithProvince.province.id).map((force) => force!.name);
      if (outOfRange.length > 0) {
        return refuse(
          `${outOfRange.join(", ")} ${outOfRange.length === 1 ? "is" : "are"} not at ${settlementWithProvince.province.name}, so ${outOfRange.length === 1 ? "it" : "they"} cannot besiege ${settlementWithProvince.settlement.name} from where ${outOfRange.length === 1 ? "it stands" : "they stand"}. Move the force to ${settlementWithProvince.province.name} first.`,
        );
      }
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
  }),

  defineWorkflow({
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
      if (params.successfulCapture && params.newControllerPolityId) {
        // A siege that "succeeds" without anyone left besieging it, or that
        // hands the prize to a power that was never party to it, is not a
        // capture -- it is control changing hands by nothing more than the
        // claim. At least one besieger must still be a real, living force,
        // and the power receiving the settlement must be one of them.
        const livingBesiegers = siege.invadingForceIds
          .map((id) => world.material.forces.find((f) => f.id === id))
          .filter((force): force is NonNullable<typeof force> => force !== undefined && force.personnel.some((category) => category.fit > 0));
        if (livingBesiegers.length === 0) {
          return refuse(`No besieging force at "${params.settlementId}" is still standing; there is no one left to have captured it.`);
        }
        if (!livingBesiegers.some((force) => force.polityId === params.newControllerPolityId)) {
          const besiegerPolities = [...new Set(livingBesiegers.map((force) => force.polityId))].join(", ");
          return refuse(`${params.newControllerPolityId} did not besiege "${params.settlementId}" -- the besieging power(s) were: ${besiegerPolities}. Capture can only pass it to one of them.`);
        }
      }
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
  }),

  defineWorkflow({
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
            battles: world.conflicts.battles
              .map((b) => removeForceFromBattle(b, params.sourceForceId))
              .filter(battleHasBothSides),
          },
        },
        result: {
          summary: `${src.name} is absorbed into ${tgt.name}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
    id: "disband_forces_bulk",
    description: "Disband multiple military forces at once (e.g. post-war demobilization).",
    category: "military",
    parametersSchema: z.object({
      forceIds: z.array(EntityIdSchema).min(1).max(20),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const idsToDisband = new Set(
        params.forceIds.filter((id) => world.material.forces.some((f) => f.id === id)),
      );
      if (idsToDisband.size === 0) return null;
      const disbandedNames = world.material.forces
        .filter((f) => idsToDisband.has(f.id))
        .map((f) => f.name)
        .join(", ");
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.filter((f) => !idsToDisband.has(f.id)),
          },
          conflicts: {
            ...world.conflicts,
            // A battle requires both a live attacker and a live defender; one
            // that would drop below that after disbanding no longer has
            // anyone left to fight.
            battles: world.conflicts.battles
              .map((b) => ({
                ...b,
                participantForceIds: b.participantForceIds.filter((id) => !idsToDisband.has(id)),
                attackerForceIds: b.attackerForceIds.filter((id) => !idsToDisband.has(id)),
              }))
              .filter(battleHasBothSides),
            sieges: world.conflicts.sieges.map((s) => ({
              ...s,
              invadingForceIds: s.invadingForceIds.filter((id) => !idsToDisband.has(id)),
              defendingForceIds: s.defendingForceIds.filter((id) => !idsToDisband.has(id)),
            })),
          },
        },
        result: {
          summary: `${disbandedNames} disbanded. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "blockade_port",
    description: "Place a naval blockade on a port settlement, recorded as a siege with no defending force.",
    category: "military",
    parametersSchema: z.object({
      settlementId: EntityIdSchema,
      blockadingForceIds: z.array(EntityIdSchema).min(1),
    }).strict(),
    apply(world, params) {
      const settlementWithProvince = world.map.provinces
        .flatMap((province) => province.settlements.map((settlement) => ({ settlement, province })))
        .find(({ settlement }) => settlement.id === params.settlementId);
      if (!settlementWithProvince) return null;
      if (settlementWithProvince.settlement.kind !== "port") return null;
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
                invadingForceIds: params.blockadingForceIds,
                defendingForceIds: [],
              },
            ],
          },
        },
        result: {
          summary: `A naval blockade begins at ${settlementWithProvince.settlement.name}.`,
          applied: true,
        },
      };
    },
  }),
];
