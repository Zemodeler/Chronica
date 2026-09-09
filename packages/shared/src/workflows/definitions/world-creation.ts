import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";
import { createCanonicalNpc } from "../../characters/canonical-npc";
import { academyInfluenceFor, applyAcademyInfluence } from "../../characters/academy-influence";
import { canCreateCharacter } from "../../continuity/continuity";

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

      // docs/32 corrective pass, requirement 5: an academy standing in this
      // province is durable provenance a newly generated character's own
      // training actually reflects -- a bounded martial/learning bias, and a
      // note folded into `creationReason` so a later turn's Game Master (or
      // a character description) can see and cite it, not merely a record
      // nobody reads back.
      const academyInfluence = academyInfluenceFor(world, params.locationProvinceId);
      const baseSkills = { martial: 35, intrigue: 45, learning: 45, piety: 35, stewardship: 45, diplomacy: 55, body: 45, subSkills: {} };
      const skills = academyInfluence === null ? undefined : applyAcademyInfluence(baseSkills, academyInfluence);
      const creationReason = academyInfluence === null ? params.provenance.reason : `${params.provenance.reason} ${academyInfluence.note}`;

      const created = createCanonicalNpc(world, {
        characterId,
        name: params.name,
        polityId: params.polityId,
        locationProvinceId: params.locationProvinceId,
        officeId: params.officeId,
        ...(skills === undefined ? {} : { skills }),
        createdAtStep: context.atStep,
        creationReason,
      });
      if (created === null) return null;

      return {
        world: {
          ...world,
          ...created.world,
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
