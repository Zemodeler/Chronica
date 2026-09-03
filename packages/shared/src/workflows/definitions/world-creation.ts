import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";
import { deriveDefaultMind } from "../../characters/mind";

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
  defineWorkflow({
    id: "create_world_character",
    description: "Create a new named NPC in the world. World Director authority only. Requires a provenance record.",
    category: "character" as const,
    invokerAuthority: ["world_director"] as unknown as never[],
    parametersSchema: z
      .object({
        /** The pipeline may reserve an ID so a newly cast NPC can be referenced this turn. */
        characterId: EntityIdSchema.optional(),
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

      const characterId = params.characterId ?? `char-wd-${randomUUID().slice(0, 12)}`;
      if (world.characters.some((character) => character.id === characterId)) return null;

      const skills = {
        martial: 35,
        intrigue: 45,
        learning: 45,
        piety: 35,
        stewardship: 45,
        diplomacy: 55,
        body: 45,
        subSkills: {},
      };
      const newCharacter = {
        id: characterId,
        name: params.name,
        // World-created figures begin as ordinary adults; scenario-specific
        // offices and skills can later be assigned through normal workflows.
        cultureId: "culture-local",
        faithId: null,
        dynastyId: null,
        polityId: params.polityId,
        locationProvinceId: params.locationProvinceId,
        ageYearsAtStart: 35,
        officeId: params.officeId,
        personalAccountId: `account-${characterId}`,
        skills,
        traits: [],
        mind: deriveDefaultMind({ officeId: params.officeId, skills, ageYears: 35, cultureId: "culture-local" }),
        alive: true,
        healthBps: 10000,
        prestigeBps: 3000,
        relations: [],
        ambitions: [],
        heirCharacterId: null,
        diedAtStep: null,
        createdByDirector: true,
        createdAtStep: context.atStep,
        creationReason: params.provenance.reason,
        disqualifyingStatuses: [],
      };

      return {
        world: { ...world, characters: [...world.characters, newCharacter] },
        result: {
          summary: `${params.name} enters the world as a new character.`,
          applied: true,
        },
      };
    },
  }),
];
