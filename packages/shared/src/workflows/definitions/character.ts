import { z } from "zod";
import type { WorldState } from "../../world/world-state";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";
import { vacateOfficeSeatsFor } from "../../characters/succession";
import { settleEstate } from "../../characters/inheritance";

/** Default years-per-step used when no scenario clock is available to a workflow. */
const DEFAULT_STEPS_PER_YEAR = 4;

/**
 * Verifies a claimed `authorization.procedureId` actually is what it says
 * it is (docs/plans/ai-world-matters-runtime.md, "Institutional time":
 * "Any appointment authorized by a procedure must verify that the real
 * procedure and its recorded disposition support that exact workflow" --
 * before this, `authorization` was accepted and stored on the seat's
 * `appointmentProcedureId`/`removalProcedureId` without ever being checked
 * against the procedure it names). Returns a refusal reason, or `null` when
 * the authorization holds (or none was offered at all -- the "restricted
 * shortcut" path this deliberately leaves untouched, see
 * `character.test.ts`'s own tests for it). Checks only the structural
 * fields (`characterId`/`officeId`) a real procedure would have recorded,
 * never free-text fields like a removal's `reason`, which may legitimately
 * be restated at execution time.
 */
function verifiedProcedureAuthorization(
  world: WorldState,
  authorization: { readonly procedureId: string } | undefined,
  expected: { readonly linkedWorkflowId: string; readonly matchParams: Readonly<Record<string, unknown>> },
): string | null {
  if (authorization === undefined) return null;
  const procedure = world.material.politicalProcedures.find((p) => p.id === authorization.procedureId);
  if (!procedure) return `No political procedure "${authorization.procedureId}" exists.`;
  if (procedure.stage !== "resolved" || procedure.outcome !== "passed") {
    return `Procedure "${procedure.id}" is not a resolved, passed authorization (stage: ${procedure.stage}, outcome: ${procedure.outcome ?? "none"}).`;
  }
  if (procedure.linkedWorkflowId !== expected.linkedWorkflowId) {
    return `Procedure "${procedure.id}" authorizes "${procedure.linkedWorkflowId}", not "${expected.linkedWorkflowId}".`;
  }
  for (const [key, value] of Object.entries(expected.matchParams)) {
    if (key in procedure.linkedWorkflowParams && procedure.linkedWorkflowParams[key] !== value) {
      return `Procedure "${procedure.id}" authorized ${key} "${String(procedure.linkedWorkflowParams[key])}", not "${String(value)}".`;
    }
  }
  return null;
}

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
      if (!character) return null;
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
      if (!character) return null;
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
      if (!character) return null;
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
    id: "settle_estate",
    description: "Settle a deceased character's estate: transfer assets to beneficiaries per their inheritance rule, or escheat it if none applies. Call this once, promptly after a death.",
    category: "character",
    parametersSchema: z.object({
      ownerCharacterId: EntityIdSchema,
    }).strict(),
    apply(world, params, context) {
      const owner = world.characters.find((c) => c.id === params.ownerCharacterId);
      if (!owner) return null;
      if (owner.alive) return refuse(`${owner.name} is still alive; an estate is only settled after death.`);

      const settlement = settleEstate(world, params.ownerCharacterId, DEFAULT_STEPS_PER_YEAR, context.atStep);
      if (settlement.transfers.length === 0) {
        return refuse(`${owner.name} has no unsettled estate to transfer -- it may already be settled, escheated, or never existed.`);
      }
      const primaryBeneficiaryId = settlement.beneficiaryIds[0];
      const beneficiaryName = primaryBeneficiaryId !== undefined
        ? world.characters.find((c) => c.id === primaryBeneficiaryId)?.name ?? primaryBeneficiaryId
        : null;
      return {
        world: { ...world, material: settlement.material },
        result: {
          summary: beneficiaryName !== null
            ? `${owner.name}'s estate is settled; ${beneficiaryName} inherits.`
            : `${owner.name}'s estate is escheated for lack of a valid heir.`,
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
      if (!character) return null;
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
      if (!character) return null;
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
      if (!character) return null;
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
      if (character.name === params.newName) {
        return { world, result: { summary: `${character.name} keeps the name they already bear.`, applied: true, noOp: true } };
      }
      const summary = `${character.name} is known thereafter as ${params.newName}.`;
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
      if (!character) return null;
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
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character) return null;
      const authorizationError = verifiedProcedureAuthorization(world, params.authorization, {
        linkedWorkflowId: "appoint_to_office",
        matchParams: { characterId: params.characterId, officeId: params.officeId },
      });
      if (authorizationError !== null) return refuse(authorizationError);
      const seat = world.material.officeSeats.find((s) => s.officeId === params.officeId && s.seatIndex === 0);
      const procedureId = params.authorization?.procedureId ?? null;
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
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character) return null;
      const authorizationError = verifiedProcedureAuthorization(world, params.authorization, {
        linkedWorkflowId: "remove_from_office",
        matchParams: { characterId: params.characterId },
      });
      if (authorizationError !== null) return refuse(authorizationError);
      const officeId = character.officeId;
      const procedureId = params.authorization?.procedureId ?? null;
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
      if (!character) return null;
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
      if (!character) return null;
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
      if (!character) return null;
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
