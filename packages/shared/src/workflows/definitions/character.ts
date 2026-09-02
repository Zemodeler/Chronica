import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";

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
        },
        result: {
          summary: `${character.name} dies. ${params.cause}`,
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
    description: "Increment a character's age by a given number of years.",
    category: "character",
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
    description: "Assign a character to a government office.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      officeId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId ? { ...c, officeId: params.officeId } : c,
          ),
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
    description: "Remove a character from their current government office.",
    category: "character",
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || character.officeId === null) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId ? { ...c, officeId: null } : c,
          ),
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
    apply(world, params) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === params.characterId
              ? { ...c, officeId: null }
              : c,
          ),
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
