import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";
import { deriveDefaultMind } from "../../characters/mind";
import { canCreateCharacter } from "../../continuity/continuity";
import { openCharacterAccount } from "../../material/character-accounts";

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
      const locationProv = world.map.provinces.find((p) => p.id === params.locationProvinceId);
      if (!locationProv) return null;

      const characterId = params.characterId ?? `char-wd-${randomUUID().slice(0, 12)}`;
      if (!canCreateCharacter(world.characters.length)) return null;

      // A character without a purse is invisible to candidate scoring,
      // commitments, inheritance, and every balance read. Open it here, in the
      // same atomic mutation, rather than naming an account that does not exist.
      const purse = openCharacterAccount(world.material, characterId);
      if (purse === null) return null;

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
        birthStep: null,
        nextLifeReviewAtStep: null,
        officeId: params.officeId,
        personalAccountId: purse.accountId,
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
        world: {
          ...world,
          characters: [...world.characters.filter((c) => c.id !== characterId), newCharacter],
          material: purse.material,
        },
        result: {
          // The returned id is part of the tool result, so the model can use
          // this person in later calls in the same turn without guessing an
          // identifier or relying on prose to make a person exist.
          summary: `${params.name} enters the world as a new character [id: ${characterId}].`,
          applied: true,
        },
      };
    },
  }),
];
