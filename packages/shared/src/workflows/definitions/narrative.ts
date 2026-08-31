import { z } from "zod";
import { EntityIdSchema, VisibilitySchema } from "../../material-state";
import type { AnyWorkflowDefinition } from "../types";

export const narrativeWorkflows: AnyWorkflowDefinition[] = [
  {
    id: "create_storyline",
    description: "Start a new narrative storyline in the world.",
    category: "narrative",
    parametersSchema: z.object({
      storylineId: EntityIdSchema,
      title: z.string().min(1).max(160),
      participantIds: z.array(EntityIdSchema).max(16),
      provinceId: EntityIdSchema.nullable(),
      phase: z.string().min(1).max(80),
      stakes: z.string().min(1).max(320),
      nextDevelopment: z.string().min(1).max(320),
      visibility: VisibilitySchema,
    }).strict(),
    apply(world, params, context) {
      const exists = world.storylines?.some((s) => s.id === params.storylineId);
      if (exists) return null;
      const newStoryline = {
        id: params.storylineId,
        title: params.title,
        participantIds: params.participantIds,
        provinceId: params.provinceId,
        phase: params.phase,
        stakes: params.stakes,
        history: [] as string[],
        nextDevelopment: params.nextDevelopment,
        visibility: params.visibility,
        updatedAtStep: context.atStep,
        type: "simulator" as const,
        initialPlan: null,
        causalEntryIds: [] as string[],
        turnsActive: 0,
      };
      return {
        world: {
          ...world,
          storylines: [...(world.storylines ?? []), newStoryline],
        },
        result: {
          summary: `New storyline begins: ${params.title}.`,
          applied: true,
        },
      };
    },
  },

  {
    id: "update_storyline",
    description: "Advance an existing storyline to a new phase with updated stakes.",
    category: "narrative",
    parametersSchema: z.object({
      storylineId: EntityIdSchema,
      phase: z.string().min(1).max(80),
      stakes: z.string().min(1).max(320),
      historyEntry: z.string().min(1).max(480),
      nextDevelopment: z.string().min(1).max(320),
    }).strict(),
    apply(world, params, context) {
      const storyline = world.storylines?.find((s) => s.id === params.storylineId);
      if (!storyline) return null;
      return {
        world: {
          ...world,
          storylines: (world.storylines ?? []).map((s) =>
            s.id !== params.storylineId
              ? s
              : {
                  ...s,
                  phase: params.phase,
                  stakes: params.stakes,
                  history: [...s.history, params.historyEntry],
                  nextDevelopment: params.nextDevelopment,
                  updatedAtStep: context.atStep,
                },
          ),
        },
        result: {
          summary: `Storyline "${storyline.title}" advances: ${params.phase}`,
          applied: true,
        },
      };
    },
  },

  {
    id: "resolve_storyline",
    description: "Conclude a storyline by recording its final outcome.",
    category: "narrative",
    parametersSchema: z.object({
      storylineId: EntityIdSchema,
      resolution: z.string().min(1).max(480),
    }).strict(),
    apply(world, params, context) {
      const storyline = world.storylines?.find((s) => s.id === params.storylineId);
      if (!storyline) return null;
      return {
        world: {
          ...world,
          storylines: (world.storylines ?? []).map((s) =>
            s.id !== params.storylineId
              ? s
              : {
                  ...s,
                  phase: "resolved",
                  history: [...s.history, params.resolution],
                  nextDevelopment: "",
                  updatedAtStep: context.atStep,
                },
          ),
        },
        result: {
          summary: `Storyline "${storyline.title}" concludes. ${params.resolution}`,
          applied: true,
        },
      };
    },
  },
];
