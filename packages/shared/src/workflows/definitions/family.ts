import { z } from "zod";
import { EntityIdSchema, VisibilitySchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";
import { canCreateCharacter } from "../../continuity/continuity";
import { deriveDefaultMind } from "../../characters/mind";
import { openCharacterAccount } from "../../material/character-accounts";
import { FamilyLinkKindSchema, LifeContractTypeSchema } from "../../characters/family";

// Family, household, and life-contract workflows (character-sim phase 5).
//
// A contract (this file) is a social/legal fact only -- it never writes a
// `RelationCause`. Private sentiment around a marriage, guardianship, or
// birth still only ever moves through the existing, AI-proposed
// `applySocialEvents` path (Phase 2), unchanged.

const CONTRACT_PAIRED_FAMILY_LINK: Partial<Record<z.infer<typeof LifeContractTypeSchema>, z.infer<typeof FamilyLinkKindSchema>>> = {
  marriage_or_partnership: "spouse_or_partner",
  guardianship: "guardian",
};

export const familyWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "propose_life_contract",
    description: "Form a marriage/partnership, guardianship, adoption/heir designation, or household membership between eligible parties.",
    category: "character",
    parametersSchema: z
      .object({
        contractId: EntityIdSchema,
        type: LifeContractTypeSchema,
        partyCharacterIds: z.array(EntityIdSchema).min(1).max(4),
        institutionId: EntityIdSchema.nullable().default(null),
        eligibilityRequirementIds: z.array(EntityIdSchema).default([]),
        visibility: VisibilitySchema,
      })
      .strict(),
    apply(world, params, context) {
      const parties = params.partyCharacterIds.map((id) => world.characters.find((c) => c.id === id));
      if (parties.some((p) => p === undefined)) return null;

      const contract = {
        id: params.contractId,
        type: params.type,
        partyCharacterIds: params.partyCharacterIds,
        institutionId: params.institutionId,
        eligibilityRequirementIds: params.eligibilityRequirementIds,
        status: "active" as const,
        visibility: params.visibility,
        startedAtStep: context.atStep,
        endedAtStep: null,
        sourceEventId: null,
        resolutionReason: null,
      };

      const pairedKind = CONTRACT_PAIRED_FAMILY_LINK[params.type];
      const newLinks = [];
      if (pairedKind !== undefined && params.partyCharacterIds.length === 2) {
        const [a, b] = params.partyCharacterIds as [string, string];
        newLinks.push({
          id: `${params.contractId}:link`,
          characterId: a,
          relatedCharacterId: b,
          kind: pairedKind,
          startedAtStep: context.atStep,
          endedAtStep: null,
          visibility: params.visibility,
          provenanceEventId: null,
        });
      }

      return {
        world: {
          ...world,
          lifeContracts: [...world.lifeContracts.filter((c) => c.id !== params.contractId), contract],
          familyLinks: [...world.familyLinks, ...newLinks],
        },
        result: {
          summary: `A ${params.type.replace(/_/g, " ")} is formed between ${params.partyCharacterIds.join(" and ")}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "dissolve_life_contract",
    description: "Dissolve, widow, or separate an active life contract, ending its paired family link.",
    category: "character",
    parametersSchema: z
      .object({
        contractId: EntityIdSchema,
        resolution: z.enum(["dissolved", "widowed", "separated"]),
        reason: z.string().trim().min(1).max(240),
      })
      .strict(),
    apply(world, params, context) {
      const contract = world.lifeContracts.find((c) => c.id === params.contractId);
      if (!contract) return null;

      return {
        world: {
          ...world,
          lifeContracts: world.lifeContracts.map((c) =>
            c.id === params.contractId
              ? { ...c, status: params.resolution, endedAtStep: context.atStep, resolutionReason: params.reason }
              : c,
          ),
          familyLinks: world.familyLinks.map((link) =>
            link.id === `${params.contractId}:link` ? { ...link, endedAtStep: context.atStep } : link,
          ),
        },
        result: {
          summary: `The ${contract.type.replace(/_/g, " ")} is ${params.resolution}. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "create_child_character",
    description: "Create a distinct newborn character with a validated mind and family links to its living parent(s). Never copies a parent's relations, beliefs, or mind.",
    category: "character",
    parametersSchema: z
      .object({
        childCharacterId: EntityIdSchema,
        name: z.string().trim().min(1).max(120),
        parentCharacterIds: z.array(EntityIdSchema).min(1).max(2),
        cultureId: EntityIdSchema.optional(),
      })
      .strict(),
    apply(world, params, context) {
      if (!canCreateCharacter(world.characters.length)) return null;
      const parents = params.parentCharacterIds.map((id) => world.characters.find((c) => c.id === id));
      const livingParent = parents.find((p) => p !== undefined);
      if (livingParent === undefined) return null;

      // A newborn owns an empty purse from birth. Without it, their
      // `personalAccountId` names nothing and inheritance to them silently
      // drops (see material/character-accounts.ts).
      const purse = openCharacterAccount(world.material, params.childCharacterId);
      if (purse === null) return null;

      const skills = { martial: 10, intrigue: 10, learning: 10, piety: 10, stewardship: 10, diplomacy: 10, body: 10, subSkills: {} };
      const cultureId = params.cultureId ?? livingParent.cultureId;
      const child = {
        id: params.childCharacterId,
        name: params.name,
        cultureId,
        faithId: livingParent.faithId,
        dynastyId: livingParent.dynastyId,
        locationProvinceId: livingParent.locationProvinceId,
        polityId: livingParent.polityId,
        ageYearsAtStart: 0,
        birthStep: context.atStep,
        nextLifeReviewAtStep: null,
        officeId: null,
        personalAccountId: purse.accountId,
        skills,
        traits: [],
        healthBps: 10_000,
        prestigeBps: 0,
        relations: [],
        ambitions: [],
        mind: deriveDefaultMind({ officeId: null, skills, ageYears: 0, cultureId }),
        heirCharacterId: null,
        alive: true,
        diedAtStep: null,
        disqualifyingStatuses: [],
      };

      const parentLinks = parents
        .filter((p): p is NonNullable<typeof p> => p !== undefined)
        .map((parent) => ({
          id: `${parent.id}:parent:${params.childCharacterId}`,
          characterId: parent.id,
          relatedCharacterId: params.childCharacterId,
          kind: "parent" as const,
          startedAtStep: context.atStep,
          endedAtStep: null,
          visibility: "polity" as const,
          provenanceEventId: null,
        }));

      return {
        world: {
          ...world,
          characters: [...world.characters.filter((c) => c.id !== params.childCharacterId), child],
          material: purse.material,
          familyLinks: [...world.familyLinks, ...parentLinks],
          continuity: [
            ...world.continuity.filter((c) => c.characterId !== params.childCharacterId),
            { characterId: params.childCharacterId, tier: "ordinary" as const, notability: 0, encounterIds: [], lastingChanges: [], plan: null },
          ],
        },
        result: {
          summary: `${params.name} is born.`,
          applied: true,
        },
      };
    },
  }),
];
