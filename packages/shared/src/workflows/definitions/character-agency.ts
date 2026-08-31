import { z } from "zod";
import { EntityIdSchema, VisibilitySchema } from "../../material-state";
import type { AnyWorkflowDefinition } from "../types";
import {
  CharacterGoalCategorySchema,
  CharacterGoalStatusSchema,
  CharacterPlotStageSchema,
  CharacterPlotStatusSchema,
  DEFAULT_NEMESIS_STATE,
} from "../../character-agency/schemas";

const randomUUID = () => globalThis.crypto.randomUUID();

// Character agency workflows.
//
// These workflows manage persistent goals, plots, and the Nemesis role.
// They are the only channel through which the Character Director may mutate
// character agency state. They do not mutate material world state (money,
// forces, provinces) — those require separate material workflow invocations.

export const characterAgencyWorkflows: AnyWorkflowDefinition[] = [
  {
    id: "create_character_goal",
    description: "Give a character a new persistent goal. Use when the Character Director forms a new goal after a meaningful trigger (encounter, political event, plot resolution).",
    category: "character" as const,
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      objective: z.string().trim().min(1).max(240),
      category: CharacterGoalCategorySchema,
      targetEntityIds: z.array(EntityIdSchema).max(8).default([]),
      priority: z.number().int().min(1).max(5),
      visibility: VisibilitySchema,
    }).strict(),
    apply(world, params, context) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;

      const activeGoals = (world.characterGoals ?? []).filter(
        (g) => g.characterId === params.characterId && g.status === "active",
      );
      if (activeGoals.length >= 4) return null;

      const goalId = `goal-${params.characterId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
      const newGoal = {
        id: goalId,
        characterId: params.characterId,
        objective: params.objective,
        category: params.category,
        targetEntityIds: params.targetEntityIds,
        priority: params.priority,
        status: "active" as const,
        visibility: params.visibility,
        causalFactIds: [],
        createdAtStep: context.atStep,
        updatedAtStep: context.atStep,
        history: [],
      };

      return {
        world: { ...world, characterGoals: [...(world.characterGoals ?? []), newGoal] },
        result: {
          summary: `${character.name} forms a new goal: ${params.objective}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "update_character_goal",
    description: "Update the status or priority of an existing character goal.",
    category: "character" as const,
    parametersSchema: z.object({
      goalId: EntityIdSchema,
      status: CharacterGoalStatusSchema.optional(),
      priority: z.number().int().min(1).max(5).optional(),
      note: z.string().trim().min(1).max(240).optional(),
    }).strict(),
    apply(world, params, context) {
      const goal = (world.characterGoals ?? []).find((g) => g.id === params.goalId);
      if (!goal) return null;
      const character = world.characters.find((c) => c.id === goal.characterId);
      if (!character || !character.alive) return null;

      const historyEntry = params.note
        ? [{ atStep: context.atStep, note: params.note }]
        : [];
      const updated = {
        ...goal,
        status: params.status ?? goal.status,
        priority: params.priority ?? goal.priority,
        updatedAtStep: context.atStep,
        history: [...goal.history.slice(-9), ...historyEntry],
      };

      return {
        world: {
          ...world,
          characterGoals: (world.characterGoals ?? []).map((g) => (g.id === params.goalId ? updated : g)),
        },
        result: {
          summary: `${character.name}'s goal "${goal.objective.slice(0, 60)}" updated.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "create_character_plot",
    description: "Create a new plot for a character pursuing a goal. A plot is a concrete attempt: participants, objective, stakes, and a starting stage.",
    category: "character" as const,
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      goalId: EntityIdSchema,
      objective: z.string().trim().min(1).max(320),
      participantIds: z.array(EntityIdSchema).max(12).default([]),
      targetIds: z.array(EntityIdSchema).max(8).default([]),
      visibility: VisibilitySchema,
      stakes: z.string().trim().min(1).max(320),
      currentObstacle: z.string().trim().min(1).max(320).nullable().default(null),
      worldStorylineId: EntityIdSchema.nullable().default(null),
    }).strict(),
    apply(world, params, context) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;
      const goal = (world.characterGoals ?? []).find((g) => g.id === params.goalId && g.characterId === params.characterId);
      if (!goal || goal.status !== "active") return null;

      const activePlots = (world.characterPlots ?? []).filter(
        (p) => p.characterId === params.characterId && p.status === "active",
      );
      if (activePlots.length >= 3) return null;

      const plotId = `plot-${params.characterId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
      const newPlot = {
        id: plotId,
        characterId: params.characterId,
        goalId: params.goalId,
        worldStorylineId: params.worldStorylineId,
        participantIds: params.participantIds,
        allyIds: [],
        targetIds: params.targetIds,
        objective: params.objective,
        stage: "forming" as const,
        momentum: 0,
        stakes: params.stakes,
        visibility: params.visibility,
        currentObstacle: params.currentObstacle,
        nextIntendedMove: null,
        status: "active" as const,
        causalHistory: [],
        createdAtStep: context.atStep,
        updatedAtStep: context.atStep,
      };

      return {
        world: { ...world, characterPlots: [...(world.characterPlots ?? []), newPlot] },
        result: {
          summary: `${character.name} begins plotting: ${params.objective.slice(0, 80)}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "advance_character_plot",
    description: "Advance a plot to a new stage, updating momentum, obstacle, and next intended move.",
    category: "character" as const,
    parametersSchema: z.object({
      plotId: EntityIdSchema,
      newStage: CharacterPlotStageSchema,
      momentum: z.number().int().min(0).max(100).optional(),
      obstacle: z.string().trim().min(1).max(320).nullable().optional(),
      nextMove: z.string().trim().min(1).max(320).nullable().optional(),
      note: z.string().trim().min(1).max(240).optional(),
    }).strict(),
    apply(world, params, context) {
      const plot = (world.characterPlots ?? []).find((p) => p.id === params.plotId);
      if (!plot || plot.status !== "active") return null;
      const character = world.characters.find((c) => c.id === plot.characterId);
      if (!character || !character.alive) return null;

      const historyEntry = {
        atStep: context.atStep,
        stage: params.newStage,
        note: params.note ?? `Advanced to ${params.newStage}.`,
      };
      const updated = {
        ...plot,
        stage: params.newStage,
        momentum: params.momentum ?? plot.momentum,
        currentObstacle: params.obstacle !== undefined ? params.obstacle : plot.currentObstacle,
        nextIntendedMove: params.nextMove !== undefined ? params.nextMove : plot.nextIntendedMove,
        updatedAtStep: context.atStep,
        causalHistory: [...plot.causalHistory.slice(-9), historyEntry],
      };

      return {
        world: {
          ...world,
          characterPlots: (world.characterPlots ?? []).map((p) => (p.id === params.plotId ? updated : p)),
        },
        result: {
          summary: `${character.name}'s plot "${plot.objective.slice(0, 60)}" advances to ${params.newStage}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "resolve_character_plot",
    description: "Mark a plot as resolved (succeeded, failed, abandoned, exposed, or stalled).",
    category: "character" as const,
    parametersSchema: z.object({
      plotId: EntityIdSchema,
      status: z.enum(["succeeded", "failed", "abandoned", "exposed", "stalled"]),
      note: z.string().trim().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const plot = (world.characterPlots ?? []).find((p) => p.id === params.plotId);
      if (!plot) return null;
      const character = world.characters.find((c) => c.id === plot.characterId);
      if (!character) return null;

      const historyEntry = { atStep: context.atStep, stage: "resolved" as const, note: params.note };
      const updated = {
        ...plot,
        status: params.status,
        stage: "resolved" as const,
        updatedAtStep: context.atStep,
        causalHistory: [...plot.causalHistory.slice(-9), historyEntry],
      };

      return {
        world: {
          ...world,
          characterPlots: (world.characterPlots ?? []).map((p) => (p.id === params.plotId ? updated : p)),
        },
        result: {
          summary: `${character.name}'s plot "${plot.objective.slice(0, 60)}" ${params.status}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "assign_nemesis",
    description: "Assign a character as the player's Nemesis. The Nemesis receives consideration every turn and may form long-term hostile plots.",
    category: "character" as const,
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      reason: z.string().trim().min(1).max(320),
    }).strict(),
    apply(world, params, context) {
      const character = world.characters.find((c) => c.id === params.characterId);
      if (!character || !character.alive) return null;

      const nemesis = {
        characterId: params.characterId,
        active: true,
        assignedAtStep: context.atStep,
        reason: params.reason,
        deactivatedAtStep: null,
        deactivationReason: null,
      };

      return {
        world: { ...world, nemesis },
        result: {
          summary: `${character.name} becomes the player's Nemesis.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "clear_nemesis",
    description: "Deactivate the current Nemesis role (e.g., because the Nemesis died or became permanently irrelevant).",
    category: "character" as const,
    parametersSchema: z.object({
      reason: z.string().trim().min(1).max(320),
    }).strict(),
    apply(world, params, context) {
      if (!world.nemesis?.active) return null;
      const nemesis = {
        ...world.nemesis,
        active: false,
        deactivatedAtStep: context.atStep,
        deactivationReason: params.reason,
      };
      return {
        world: { ...world, nemesis },
        result: {
          summary: `The Nemesis role has been cleared: ${params.reason}`,
          applied: true,
        },
      };
    },
  },
];
