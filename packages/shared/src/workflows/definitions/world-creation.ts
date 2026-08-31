import { z } from "zod";
import { EntityIdSchema, VisibilitySchema } from "../../material-state";
import type { AnyWorkflowDefinition } from "../types";

// World Director entity-creation workflows.
//
// These are the only legal channel through which new named entities may be
// introduced into the world at runtime. All require invokerAuthority:
// "world_director" and a provenance record describing why the entity was created.

const randomUUID = () => globalThis.crypto.randomUUID();

const ProvenanceSchema = z
  .object({
    reason: z.string().trim().min(1).max(320),
    storylineId: EntityIdSchema.nullable().default(null),
    createdByDirector: z.literal(true),
  })
  .strict();

export const worldCreationWorkflows: AnyWorkflowDefinition[] = [
  {
    id: "create_world_character",
    description: "Create a new named NPC in the world. World Director authority only. Requires a provenance record.",
    category: "character" as const,
    invokerAuthority: ["world_director"] as unknown as never[],
    parametersSchema: z
      .object({
        name: z.string().trim().min(1).max(120),
        polityId: EntityIdSchema.nullable().default(null),
        locationProvinceId: EntityIdSchema,
        officeId: EntityIdSchema.nullable().default(null),
        provenance: ProvenanceSchema,
      })
      .strict(),
    apply(world, params, context) {
      // Uniqueness check: Levenshtein-approximate name collision.
      const nameLower = params.name.toLowerCase();
      const collision = world.characters.find((c) => {
        if (!c.alive) return false;
        const cLower = c.name.toLowerCase();
        if (cLower === nameLower) return true;
        // Simple prefix check as lightweight collision guard
        const minLen = Math.min(nameLower.length, cLower.length);
        if (minLen >= 4 && cLower.slice(0, 4) === nameLower.slice(0, 4)) return true;
        return false;
      });
      if (collision) return null;

      const locationProv = world.map.provinces.find((p) => p.id === params.locationProvinceId);
      if (!locationProv) return null;

      const newCharacter = {
        id: `char-wd-${randomUUID().slice(0, 12)}`,
        name: params.name,
        polityId: params.polityId,
        locationProvinceId: params.locationProvinceId,
        officeId: params.officeId,
        alive: true,
        healthBps: 10000,
        prestigeBps: 3000,
        relations: [],
        createdByDirector: true,
        createdAtStep: context.atStep,
        creationReason: params.provenance.reason,
      };

      return {
        world: { ...world, characters: [...world.characters, newCharacter as never] },
        result: {
          summary: `${params.name} enters the world as a new character.`,
          applied: true,
        },
      };
    },
  },
];
