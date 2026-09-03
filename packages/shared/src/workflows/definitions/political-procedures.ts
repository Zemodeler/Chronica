import { z } from "zod";
import {
  BasisPointsSchema,
  EntityIdSchema,
  PoliticalProcedureSubjectKindSchema,
  PoliticalProcedureTypeSchema,
  PoliticalResolutionMechanismSchema,
  SupportPositionKindSchema,
  VisibilitySchema,
  type PoliticalProcedure,
  type SupportPosition,
} from "../../material-state";
import { canParticipate, canSponsorProcedure, resolveEligibility } from "../../characters/political-authority";
import { evaluateSupport, positionFromScore } from "../../character-agency/political-resolver";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";

// Political procedure workflows (character-sim phase 4).
//
// These are the only channels through which an intent to sponsor a
// procedure, nominate a candidate, take a public position, or call a
// decision becomes canonical state. None of them grant an office, remove a
// rival, or assign a command directly -- that only happens once
// `resolveDueProcedures` (packages/shared/src/character-agency/political-resolver.ts)
// resolves a procedure `passed`, which queues exactly one further,
// authorization-carrying invocation for the executor to run in the same batch.

/** True only for a resolved procedure that authorizes exactly this workflow and target. */
function isAuthorizedByResolvedProcedure(
  procedures: readonly PoliticalProcedure[],
  procedureId: string | undefined,
  expectedWorkflowId: string,
): PoliticalProcedure | null {
  if (procedureId === undefined) return null;
  const procedure = procedures.find((p) => p.id === procedureId);
  if (procedure === undefined) return null;
  if (procedure.stage !== "resolved" || procedure.outcome !== "passed") return null;
  if (procedure.linkedWorkflowId !== expectedWorkflowId) return null;
  return procedure;
}

/** Shared authorization gate for direct shortcuts that must otherwise route through a procedure. */
export function requireProcedureAuthorization(
  procedures: readonly PoliticalProcedure[],
  actorId: string,
  expectedWorkflowId: string,
  authorization: { procedureId: string } | undefined,
): PoliticalProcedure | "system" | null {
  if (actorId === "system") return "system";
  const procedure = isAuthorizedByResolvedProcedure(procedures, authorization?.procedureId, expectedWorkflowId);
  return procedure;
}

export const politicalProcedureWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "sponsor_procedure",
    description: "Open a new political procedure: a sponsor names its type, target, and resolution mechanism.",
    category: "political",
    parametersSchema: z
      .object({
        procedureId: EntityIdSchema,
        type: PoliticalProcedureTypeSchema,
        institutionId: EntityIdSchema.nullable(),
        sponsorCharacterId: EntityIdSchema,
        subjectKind: PoliticalProcedureSubjectKindSchema,
        subjectId: EntityIdSchema.nullable(),
        linkedWorkflowId: EntityIdSchema,
        linkedWorkflowParams: z.record(z.string(), z.unknown()).default({}),
        eligibilityRequirementIds: z.array(EntityIdSchema).default([]),
        eligibleParticipantIds: z.array(EntityIdSchema).default([]),
        resolutionMechanism: PoliticalResolutionMechanismSchema,
        visibility: VisibilitySchema,
        deadlineStep: z.number().int().nonnegative().nullable().default(null),
        sourceEventIds: z.array(EntityIdSchema).max(8).default([]),
      })
      .strict(),
    apply(world, params, context) {
      if (world.material.politicalProcedures.some((p) => p.id === params.procedureId)) return null;
      const sponsorship = canSponsorProcedure(world, params.sponsorCharacterId, params.type, params.institutionId);
      if (!sponsorship.eligible) return null;
      for (const requirementId of params.eligibilityRequirementIds) {
        if (!world.material.eligibilityRequirements.some((r) => r.id === requirementId)) return null;
      }

      const procedure: PoliticalProcedure = {
        id: params.procedureId,
        type: params.type,
        institutionId: params.institutionId,
        sponsorCharacterId: params.sponsorCharacterId,
        subjectKind: params.subjectKind,
        subjectId: params.subjectId,
        linkedWorkflowId: params.linkedWorkflowId,
        linkedWorkflowParams: params.linkedWorkflowParams,
        eligibilityRequirementIds: params.eligibilityRequirementIds,
        eligibleParticipantIds: params.eligibleParticipantIds,
        stage: "proposed",
        resolutionMechanism: params.resolutionMechanism,
        openedAtStep: context.atStep,
        deadlineStep: params.deadlineStep,
        resolvedAtStep: null,
        visibility: params.visibility,
        voteRecordId: null,
        outcome: null,
        outcomeReason: null,
        sourceEventIds: params.sourceEventIds,
        resultingEventIds: [],
      };
      const sponsor = world.characters.find((c) => c.id === params.sponsorCharacterId);
      return {
        world: { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } },
        result: { summary: `${sponsor?.name ?? params.sponsorCharacterId} sponsors a ${params.type} procedure.`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "nominate_candidate",
    description: "Name a candidate for a proposed nomination or appointment procedure, subject to its eligibility requirements.",
    category: "political",
    parametersSchema: z
      .object({
        procedureId: EntityIdSchema,
        candidateCharacterId: EntityIdSchema,
        nominatorCharacterId: EntityIdSchema,
      })
      .strict(),
    apply(world, params) {
      const procedure = world.material.politicalProcedures.find((p) => p.id === params.procedureId);
      if (!procedure) return null;
      if (procedure.type !== "nomination" && procedure.type !== "appointment") return null;
      if (procedure.stage !== "proposed" && procedure.stage !== "gathering_support") return null;
      if (procedure.sponsorCharacterId !== params.nominatorCharacterId) return null;

      const eligibility = resolveEligibility(world, params.candidateCharacterId, procedure.eligibilityRequirementIds);
      if (!eligibility.eligible) return null;

      const candidate = world.characters.find((c) => c.id === params.candidateCharacterId);
      const updated: PoliticalProcedure = {
        ...procedure,
        subjectKind: "character",
        subjectId: params.candidateCharacterId,
        stage: "gathering_support",
      };
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            politicalProcedures: world.material.politicalProcedures.map((p) => (p.id === procedure.id ? updated : p)),
          },
        },
        result: { summary: `${candidate?.name ?? params.candidateCharacterId} is nominated for procedure "${procedure.id}".`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "pledge_support",
    description: "Record a character's or group's canonical, resolver-computed support position on an open procedure.",
    category: "political",
    parametersSchema: z
      .object({
        procedureId: EntityIdSchema,
        supporterKind: SupportPositionKindSchema,
        supporterId: EntityIdSchema,
      })
      .strict(),
    apply(world, params, context) {
      const procedure = world.material.politicalProcedures.find((p) => p.id === params.procedureId);
      if (!procedure) return null;
      if (procedure.stage !== "gathering_support" && procedure.stage !== "deliberating") return null;

      if (params.supporterKind === "character") {
        const supporter = world.characters.find((c) => c.id === params.supporterId);
        if (!supporter || !supporter.alive || supporter.disqualifyingStatuses.length > 0) return null;
        const isEligible = procedure.eligibleParticipantIds.includes(params.supporterId) || procedure.sponsorCharacterId === params.supporterId;
        if (!isEligible) return null;
      } else {
        const group = world.material.politicalGroups.find((g) => g.id === params.supporterId);
        if (!group || !group.active) return null;
      }

      const { score, reasons } = evaluateSupport(world, procedure, params.supporterId);
      const position: SupportPosition = {
        id: `${procedure.id}:support:${params.supporterId}:${context.atStep}`,
        procedureId: procedure.id,
        supporterKind: params.supporterKind,
        supporterId: params.supporterId,
        position: positionFromScore(score),
        influenceWeight: Math.max(1, Math.abs(score)),
        visibility: procedure.visibility,
        reasons,
        provenanceEventIds: [],
        changedAtStep: context.atStep,
      };
      return {
        world: { ...world, material: { ...world.material, supportPositions: [...world.material.supportPositions, position] } },
        result: { summary: `${params.supporterId} records a "${position.position}" position on procedure "${procedure.id}".`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "withdraw_support",
    description: "Withdraw a previously recorded support position before a procedure resolves.",
    category: "political",
    parametersSchema: z
      .object({
        procedureId: EntityIdSchema,
        supporterKind: SupportPositionKindSchema,
        supporterId: EntityIdSchema,
      })
      .strict(),
    apply(world, params, context) {
      const procedure = world.material.politicalProcedures.find((p) => p.id === params.procedureId);
      if (!procedure) return null;
      if (procedure.stage !== "gathering_support" && procedure.stage !== "deliberating") return null;
      const hadPosition = world.material.supportPositions.some(
        (p) => p.procedureId === procedure.id && p.supporterId === params.supporterId,
      );
      if (!hadPosition) return null;

      const withdrawal: SupportPosition = {
        id: `${procedure.id}:support:${params.supporterId}:${context.atStep}`,
        procedureId: procedure.id,
        supporterKind: params.supporterKind,
        supporterId: params.supporterId,
        position: "undecided",
        influenceWeight: 0,
        visibility: procedure.visibility,
        reasons: [{ kind: "ideology", label: "Support withdrawn before resolution.", score: 0, sourceId: procedure.id }],
        provenanceEventIds: [],
        changedAtStep: context.atStep,
      };
      return {
        world: { ...world, material: { ...world.material, supportPositions: [...world.material.supportPositions, withdrawal] } },
        result: { summary: `${params.supporterId} withdraws their position on procedure "${procedure.id}".`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "call_vote",
    description: "The sponsor calls the eligible vote or decision, advancing a procedure to voting_or_deciding.",
    category: "political",
    parametersSchema: z.object({ procedureId: EntityIdSchema, callerCharacterId: EntityIdSchema }).strict(),
    apply(world, params) {
      const procedure = world.material.politicalProcedures.find((p) => p.id === params.procedureId);
      if (!procedure) return null;
      if (procedure.stage !== "proposed" && procedure.stage !== "gathering_support" && procedure.stage !== "deliberating") return null;
      if (procedure.sponsorCharacterId !== params.callerCharacterId) return null;
      const actions = canParticipate(world, params.callerCharacterId, procedure);
      const canCall = procedure.sponsorCharacterId === params.callerCharacterId && (actions.length > 0 || procedure.resolutionMechanism !== "vote");
      if (!canCall) return null;

      const updated: PoliticalProcedure = { ...procedure, stage: "voting_or_deciding" };
      return {
        world: { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((p) => (p.id === procedure.id ? updated : p)) } },
        result: { summary: `Procedure "${procedure.id}" moves to a decision.`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "assign_command",
    description: "Assign a character as a force's commander through an authorized command_assignment procedure.",
    category: "military",
    parametersSchema: z
      .object({
        forceId: EntityIdSchema,
        commanderCharacterId: EntityIdSchema,
        authorization: z.object({ procedureId: EntityIdSchema }).optional(),
      })
      .strict(),
    apply(world, params, context) {
      const authorized = requireProcedureAuthorization(world.material.politicalProcedures, context.actorId, "assign_command", params.authorization);
      if (authorized === null) return null;
      const force = world.material.forces.find((f) => f.id === params.forceId);
      const commander = world.characters.find((c) => c.id === params.commanderCharacterId);
      if (!force || !commander || !commander.alive) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) => (f.id === force.id ? { ...f, commanderCharacterId: params.commanderCharacterId } : f)),
          },
        },
        result: { summary: `${commander.name} is assigned command of ${force.name}.`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "challenge_legitimacy",
    description: "Publicly challenge an institution's or polity's legitimacy through an authorized procedure.",
    category: "political",
    parametersSchema: z
      .object({
        institutionId: EntityIdSchema.nullable().default(null),
        polityId: EntityIdSchema.nullable().default(null),
        challengerCharacterId: EntityIdSchema,
        magnitudeBps: BasisPointsSchema.default(500),
        reason: z.string().trim().min(1).max(240),
        authorization: z.object({ procedureId: EntityIdSchema }).optional(),
      })
      .strict(),
    apply(world, params, context) {
      const authorized = requireProcedureAuthorization(world.material.politicalProcedures, context.actorId, "challenge_legitimacy", params.authorization);
      if (authorized === null) return null;
      const challenger = world.characters.find((c) => c.id === params.challengerCharacterId);
      if (!challenger || !challenger.alive) return null;
      if (params.institutionId === null && params.polityId === null) return null;

      const cause = { id: `${context.atStep}:${challenger.id}:challenge`, label: params.reason, score: -Math.round(params.magnitudeBps / 100), sourceId: challenger.id };
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            institutionLegitimacy: params.institutionId
              ? world.material.institutionLegitimacy.map((entry) =>
                  entry.institutionId === params.institutionId
                    ? { ...entry, legitimacyBps: Math.max(0, entry.legitimacyBps - params.magnitudeBps), causes: [...entry.causes, cause] }
                    : entry,
                )
              : world.material.institutionLegitimacy,
            polityLegitimacy: params.polityId
              ? world.material.polityLegitimacy.map((entry) =>
                  entry.polityId === params.polityId
                    ? { ...entry, legitimacyBps: Math.max(0, entry.legitimacyBps - params.magnitudeBps), causes: [...entry.causes, cause] }
                    : entry,
                )
              : world.material.polityLegitimacy,
          },
        },
        result: { summary: `${challenger.name} publicly challenges legitimacy: ${params.reason}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "public_denunciation",
    description: "Publicly denounce a character through an authorized procedure, costing them prestige.",
    category: "political",
    parametersSchema: z
      .object({
        denouncerCharacterId: EntityIdSchema,
        targetCharacterId: EntityIdSchema,
        prestigeLossBps: BasisPointsSchema.default(300),
        reason: z.string().trim().min(1).max(240),
        authorization: z.object({ procedureId: EntityIdSchema }).optional(),
      })
      .strict(),
    apply(world, params, context) {
      const authorized = requireProcedureAuthorization(world.material.politicalProcedures, context.actorId, "public_denunciation", params.authorization);
      if (authorized === null) return null;
      const denouncer = world.characters.find((c) => c.id === params.denouncerCharacterId);
      const target = world.characters.find((c) => c.id === params.targetCharacterId);
      if (!denouncer || !denouncer.alive || !target || !target.alive) return null;

      return {
        world: {
          ...world,
          characters: world.characters.map((c) =>
            c.id === target.id ? { ...c, prestigeBps: Math.max(0, c.prestigeBps - params.prestigeLossBps) } : c,
          ),
        },
        result: { summary: `${denouncer.name} publicly denounces ${target.name}: ${params.reason}`, applied: true },
      };
    },
  }),
];
