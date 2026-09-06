import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";
import { requireProcedureAuthorization } from "./political-procedures";
import { vacateOfficeSeatsFor } from "../../characters/succession";

export const characterWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "kill_character",
    description: "Mark a character as dead and record the step of death.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      cause: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, alive: false, diedAtStep: context.atStep }
              : c,
          ),
          material: vacateOfficeSeatsFor(world.material, params.characterId, "death", context.atStep),
        },
        result: {
          summary: `${character.name} dies. ${params.cause}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "incapacitate_character",
    description: "Mark a living character incapacitated -- alive but unable to hold office or act freely.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      cause: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      if (character.disqualifyingStatuses.includes("incapacitated")) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, disqualifyingStatuses: [...c.disqualifyingStatuses, "incapacitated"] }
              : c,
          ),
          material: vacateOfficeSeatsFor(world.material, params.characterId, "incapacity", context.atStep),
        },
        result: {
          summary: `${character.name} is incapacitated. ${params.cause}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "recover_from_incapacity",
    description: "Clear a character's incapacitated status. Does not restore any office already refilled.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.disqualifyingStatuses.includes("incapacitated")) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, disqualifyingStatuses: c.disqualifyingStatuses.filter((tag) => tag !== "incapacitated") }
              : c,
          ),
        },
        result: {
          summary: `${character.name} recovers from incapacity.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "retire_character",
    description: "Mark a living character retired from active office-holding, vacating any office they hold.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      if (character.disqualifyingStatuses.includes("retired")) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, officeId: null, disqualifyingStatuses: [...c.disqualifyingStatuses, "retired"] }
              : c,
          ),
          material: vacateOfficeSeatsFor(world.material, params.characterId, "resignation", context.atStep),
        },
        result: {
          summary: `${character.name} retires. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "injure_character",
    description: "Reduce a character's health basis-points, reflecting wounds or illness.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      healthLossBps: z.number().int().min(1).max(10_000),
      cause: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      const next = Math.max(0, character.healthBps - params.healthLossBps);
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId ? { ...c, healthBps: next } : c,
          ),
        },
        result: {
          summary: `${character.name} is injured. ${params.cause}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "heal_character",
    description: "Restore a character's health basis-points (capped at 10 000).",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      healthGainBps: z.number().int().min(1).max(10_000),
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      const next = Math.min(10_000, character.healthBps + params.healthGainBps);
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId ? { ...c, healthBps: next } : c,
          ),
        },
        result: {
          summary: `${character.name} recovers from their ailment.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "add_age",
    description: "LEGACY/system-only: directly correct a character's frozen start age. Normal play never advances age this way -- age derives from the scenario clock (characters/age.ts currentAgeYears).",
    category: "character",
    invokerAuthority: ["system"],
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      years: z.number().int().min(1).max(50),
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, ageYearsAtStart: c.ageYearsAtStart + params.years }
              : c,
          ),
        },
        result: {
          summary: `${character.name} ages ${params.years} year(s).`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "rename_character",
    description:
      "Give a character their proper name. Use it on a leader the engine seeded for a power that had none (named '<Power> leader') as soon as you know who they are, so the record calls them by a name rather than a role.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      newName: z.string().trim().min(1).max(120),
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character) return refuse(`No character exists with the id "${params.characterId}".`);
      if (!character.alive) return refuse(`${character.name} is dead; the record of a dead figure is not rewritten.`);
      if (character.name === params.newName) {
        return { world, result: { summary: `${character.name} keeps the name they already bear.`, applied: true, noOp: true } };
      }
      const taken = world.characters.some((c) => c.alive && c.id !== character.id && c.name === params.newName);
      if (taken) return refuse(`Another living character is already called ${params.newName}. Two people of one name in one record cannot be told apart.`);
      // A polity leader seeded by ensurePolityLeadership is bookkeeping for a
      // person who was already there, not their arrival in the world. Naming
      // that existing leader must therefore be recorded as an identification,
      // so the Chronicle cannot plausibly recast it as their sudden emergence.
      const summary = character.createdByDirector === true
        ? `The existing leader of ${world.map.polities.find((polity) => polity.id === character.polityId)?.name ?? "their people"} is identified in the record as ${params.newName}.`
        : `${character.name} is known thereafter as ${params.newName}.`;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) => (c.id === character.id ? { ...c, name: params.newName } : c)),
        },
        result: { summary, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "move_character",
    description: "Relocate a character to a different province.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      destinationProvinceId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      const province = world.map.provinces.find((p) => p.id === params.destinationProvinceId);
      if (!province) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, locationProvinceId: params.destinationProvinceId }
              : c,
          ),
        },
        result: {
          summary: `${character.name} travels to ${province.name}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "appoint_to_office",
    description: "Assign a character to a government office. Requires an already-resolved, passed appointment procedure (or system authority).",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      officeId: EntityIdSchema,
      authorization: z.object({ procedureId: EntityIdSchema }).optional(),
    }).strict(),
    apply(world, params, context) {
      const authorized = requireProcedureAuthorization(world.material.politicalProcedures, context.actorId, "appoint_to_office", params.authorization);
      if (authorized === null) return null;
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      // Two actors cannot occupy one exclusive office seat: a seat already
      // held by someone else must be vacated (removal/expiry) before this can succeed.
      const seat = world.material.officeSeats.find((s) => s.officeId === params.officeId && s.seatIndex === 0);
      if (seat !== undefined && seat.status === "held" && seat.holderCharacterId !== params.characterId) return null;
      const procedureId = authorized !== "system" ? authorized.id : null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId ? { ...c, officeId: params.officeId } : c,
          ),
          material: {
            ...world.material,
            officeSeats:
              seat === undefined
                ? [
                    ...world.material.officeSeats,
                    {
                      id: `${params.officeId}:seat:0`,
                      officeId: params.officeId,
                      seatIndex: 0,
                      holderCharacterId: params.characterId,
                      status: "held" as const,
                      vacancyCause: "none" as const,
                      termStartedAtStep: context.atStep,
                      termExpiresAtStep: null,
                      appointmentProcedureId: procedureId,
                      removalProcedureId: null,
                      eligibilityRequirementIds: [],
                    },
                  ]
                : world.material.officeSeats.map((s) =>
                    s.id === seat.id
                      ? {
                          ...s,
                          holderCharacterId: params.characterId,
                          status: "held" as const,
                          vacancyCause: "none" as const,
                          termStartedAtStep: context.atStep,
                          appointmentProcedureId: procedureId,
                        }
                      : s,
                  ),
          },
        },
        result: {
          summary: `${character.name} is appointed to office ${params.officeId}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "remove_from_office",
    description: "Remove a character from their current government office. Requires an already-resolved, passed removal procedure (or system authority).",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      reason: z.string().min(1).max(240),
      authorization: z.object({ procedureId: EntityIdSchema }).optional(),
    }).strict(),
    apply(world, params, context) {
      const authorized = requireProcedureAuthorization(world.material.politicalProcedures, context.actorId, "remove_from_office", params.authorization);
      if (authorized === null) return null;
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || character.officeId === null) return null;
      const officeId = character.officeId;
      const procedureId = authorized !== "system" ? authorized.id : null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId ? { ...c, officeId: null } : c,
          ),
          material: {
            ...world.material,
            officeSeats: world.material.officeSeats.map((s) =>
              s.officeId === officeId && s.holderCharacterId === params.characterId
                ? {
                    ...s,
                    holderCharacterId: null,
                    status: "vacant" as const,
                    vacancyCause: "removal" as const,
                    removalProcedureId: procedureId,
                  }
                : s,
            ),
          },
        },
        result: {
          summary: `${character.name} is removed from office. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "change_allegiance",
    description: "Switch a character's polity allegiance to a new polity.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      newPolityId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      const newPolity = world.map.polities.find((p) => p.id === params.newPolityId);
      if (!newPolity) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId ? { ...c, polityId: params.newPolityId } : c,
          ),
        },
        result: {
          summary: `${character.name} switches allegiance to ${newPolity.name}. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "capture_character",
    description: "Record a character as captured (alive but unable to act freely).",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      capturedByPolityId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? {
                  ...c,
                  officeId: null,
                  disqualifyingStatuses: c.disqualifyingStatuses.includes("captured")
                    ? c.disqualifyingStatuses
                    : [...c.disqualifyingStatuses, "captured"],
                }
              : c,
          ),
          material: vacateOfficeSeatsFor(world.material, params.characterId, "capture", context.atStep),
        },
        result: {
          summary: `${character.name} is captured. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "promote_character",
    description: "Increase a character's prestige basis-points.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      prestigeGainBps: z.number().int().min(1).max(5_000),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, prestigeBps: Math.min(10_000, c.prestigeBps + params.prestigeGainBps) }
              : c,
          ),
        },
        result: {
          summary: `${character.name}'s reputation grows. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),
];
