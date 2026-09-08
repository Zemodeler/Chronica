import { z } from "zod";
import {
  BasisPointsSchema,
  EntityIdSchema,
  PoliticalProcedureSubjectKindSchema,
  PoliticalProcedureTypeSchema,
  PoliticalResolutionMechanismSchema,
  SupportPositionChoiceSchema,
  SupportPositionKindSchema,
  SupportReasonKindSchema,
  VisibilitySchema,
  type MaterialWorldState,
  type PoliticalProcedure,
  type SupportPosition,
} from "../../material-state";
import { describePoliticalQuestion } from "../../chronicle/political-procedure-description";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";
import { resolveProcedure } from "../../character-agency/political-resolver";

// Political procedure workflows (character-sim phase 4).
//
// These are the only channels through which an intent to sponsor a
// procedure, nominate a candidate, take a public position, or call a
// decision becomes canonical state. None of them grant an office, remove a
// rival, or assign a command directly -- that only happens once
// `resolveDueProcedures` (packages/shared/src/character-agency/political-resolver.ts)
// resolves a procedure `passed`, which queues exactly one further,
// authorization-carrying invocation for the executor to run in the same batch.

/**
 * Older/generated worlds can supply an institution's voting blocs without the
 * matching political-group records and memberships. Create the minimum
 * representation at the point it is needed so a valid sponsor does not leave
 * behind an uncallable vote procedure.
 */
function ensureVotingBlocMembership(
  material: MaterialWorldState,
  institutionId: string,
  characterId: string,
  atStep: number,
): MaterialWorldState {
  const institution = material.institutions.find((candidate) => candidate.id === institutionId);
  if (institution === undefined) return material;
  const existingMembership = material.groupMemberships.some(
    (membership) => membership.characterId === characterId
      && membership.leftAtStep === null
      && institution.votingBlocs.some((bloc) => bloc.id === membership.groupId),
  );
  if (existingMembership) return material;

  // An institution always has at least one bloc. The first is the stable
  // fallback when the scenario supplied no affiliation for this office-holder.
  const bloc = institution.votingBlocs[0]!;
  const groupExists = material.politicalGroups.some((group) => group.id === bloc.id);
  return {
    ...material,
    politicalGroups: groupExists
      ? material.politicalGroups
      : [...material.politicalGroups, {
        id: bloc.id,
        name: bloc.name,
        polityId: institution.polityId,
        type: "faction",
        leaderCharacterId: null,
        platform: [bloc.representedInterest],
        resourceAccountId: null,
        publicReputationBps: 5_000,
        active: true,
      }],
    groupMemberships: [...material.groupMemberships, {
      characterId,
      groupId: bloc.id,
      role: "member",
      influenceBps: 5_000,
      loyaltyBps: 50,
      visibility: "polity",
      joinedAtStep: atStep,
      leftAtStep: null,
      joinProvenanceEventId: null,
      leaveProvenanceEventId: null,
    }],
  };
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
      if (params.institutionId !== null && !world.material.institutions.some((i) => i.id === params.institutionId)) {
        const names = world.material.institutions.map((i) => `${i.name} (${i.id})`).join("; ");
        return refuse(`There is no institution "${params.institutionId}". The institutions that exist are: ${names || "none"}. Pass one of those, or null to bring the matter before no institution.`);
      }
      for (const requirementId of params.eligibilityRequirementIds) {
        if (!world.material.eligibilityRequirements.some((r) => r.id === requirementId)) {
          const known = world.material.eligibilityRequirements.map((r) => r.id).join(", ");
          return refuse(`There is no eligibility requirement "${requirementId}". The ones that exist are: ${known || "none"}. Name only those, or pass an empty list.`);
        }
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
      const institution = params.institutionId === null ? null : world.material.institutions.find((i) => i.id === params.institutionId) ?? null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            politicalProcedures: [
              ...world.material.politicalProcedures.filter((p) => p.id !== params.procedureId),
              procedure,
            ],
          },
        },
        result: {
          summary: `${sponsor?.name ?? "A sponsor"} brings ${describePoliticalQuestion(world, procedure)}${institution ? ` before the ${institution.name}` : ""}.`,
          applied: true,
        },
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
    description: "Record a character's or group's canonical support position on an open procedure, with the stated reason for it. Use inspect_political_procedure first: it surfaces each participant's relationship/legitimacy context as a suggestion, never a decision -- the position and reason here are yours to choose.",
    category: "political",
    parametersSchema: z
      .object({
        procedureId: EntityIdSchema,
        supporterKind: SupportPositionKindSchema,
        supporterId: EntityIdSchema,
        position: SupportPositionChoiceSchema,
        reasonKind: SupportReasonKindSchema,
        reasonLabel: z.string().trim().min(1).max(200),
      })
      .strict(),
    apply(world, params, context) {
      const procedure = world.material.politicalProcedures.find((p) => p.id === params.procedureId);
      if (!procedure) return null;

      if (params.supporterKind === "character") {
        const supporter = world.characters.find((c) => c.id === params.supporterId);
        if (!supporter) return null;
      } else {
        const group = world.material.politicalGroups.find((g) => g.id === params.supporterId);
        if (!group) return null;
      }

      const nominalScore = params.position === "support" ? 20 : params.position === "oppose" ? -20 : 0;
      const position: SupportPosition = {
        id: `${procedure.id}:support:${params.supporterId}:${context.atStep}`,
        procedureId: procedure.id,
        supporterKind: params.supporterKind,
        supporterId: params.supporterId,
        position: params.position,
        influenceWeight: Math.max(1, Math.abs(nominalScore)),
        visibility: procedure.visibility,
        reasons: [{ kind: params.reasonKind, label: params.reasonLabel, score: nominalScore, sourceId: params.supporterId }],
        provenanceEventIds: [],
        changedAtStep: context.atStep,
      };
      return {
        world: { ...world, material: { ...world.material, supportPositions: [...world.material.supportPositions, position] } },
        result: { summary: `${params.supporterId} records a "${position.position}" position on procedure "${procedure.id}": ${params.reasonLabel}`, applied: true },
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
    apply(world, params, context) {
      const procedure = world.material.politicalProcedures.find((p) => p.id === params.procedureId);
      if (!procedure) {
        const open = world.material.politicalProcedures.filter((p) => p.resolvedAtStep === null);
        return refuse(
          open.length === 0
            ? "No procedure of that id exists, and none is open at all. Sponsor one first with sponsor_procedure; a vote can only be called on a procedure that already exists."
            : `No procedure of that id exists. The procedures now open are: ${open.map((p) => `${p.id} (${p.type}, ${p.stage})`).join("; ")}.`,
        );
      }
      // Supply missing scenario scaffolding so a caller who lacks a bloc
      // membership record still gets one, rather than the procedure carrying
      // a dangling reference.
      const material = procedure.resolutionMechanism === "vote" && procedure.institutionId !== null
        ? ensureVotingBlocMembership(world.material, procedure.institutionId, params.callerCharacterId, context.atStep)
        : world.material;

      const updated: PoliticalProcedure = { ...procedure, stage: "voting_or_deciding" };
      const institution = procedure.institutionId === null ? null : material.institutions.find((candidate) => candidate.id === procedure.institutionId) ?? null;
      return {
        world: { ...world, material: { ...material, politicalProcedures: material.politicalProcedures.map((p) => (p.id === procedure.id ? updated : p)) } },
        result: {
          summary: `${world.characters.find((character) => character.id === params.callerCharacterId)?.name ?? "The sponsor"} calls${institution ? ` the ${institution.name}` : ""} to decide ${describePoliticalQuestion(world, procedure)}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "resolve_procedure",
    description: "Decide an open political procedure that is ready: at voting_or_deciding, or past its deadline. Tallies the support positions already recorded (by the institution's own quorum/threshold rules, or the sponsor's authority) into a pass/fail outcome -- it invents no one's position, it only computes what the recorded positions already decide. If it passes, call the procedure's own linkedWorkflowId yourself (see inspect_political_procedure or list_due_political_procedures) with { authorization: { procedureId } } to carry out its effect: this tool only decides the vote, it does not itself grant an office, remove a rival, or otherwise act.",
    category: "political",
    parametersSchema: z.object({ procedureId: EntityIdSchema }).strict(),
    apply(world, params, context) {
      const procedure = world.material.politicalProcedures.find((p) => p.id === params.procedureId);
      if (!procedure) return null;
      if (procedure.stage === "resolved" || procedure.stage === "withdrawn" || procedure.stage === "blocked") {
        return refuse(`Procedure "${procedure.id}" is already ${procedure.stage} and cannot be resolved again.`);
      }
      const isDue = procedure.stage === "voting_or_deciding" || (procedure.deadlineStep !== null && procedure.deadlineStep <= context.atStep);
      if (!isDue) {
        return refuse(
          `Procedure "${procedure.id}" is not yet ready to resolve: call call_vote first, or wait for its deadline${procedure.deadlineStep !== null ? ` (step ${procedure.deadlineStep})` : ""}.`,
        );
      }

      const { resolution } = resolveProcedure({ characters: world.characters, material: world.material }, procedure, context.atStep);
      const material = {
        ...world.material,
        politicalProcedures: world.material.politicalProcedures.map((p) => (p.id === resolution.procedure.id ? resolution.procedure : p)),
        motions: resolution.motion ? [...world.material.motions.filter((m) => m.id !== resolution.motion!.id), resolution.motion] : world.material.motions,
        voteRecords: resolution.voteRecord ? [...world.material.voteRecords, resolution.voteRecord] : world.material.voteRecords,
      };
      const passed = resolution.procedure.outcome === "passed";
      return {
        world: { ...world, material },
        result: {
          summary:
            `${describePoliticalQuestion(world, procedure)} ${passed ? "passes" : "fails"}: ${resolution.procedure.outcomeReason ?? ""}`
            + (passed ? ` Carry out its effect by calling ${resolution.procedure.linkedWorkflowId} with authorization: { procedureId: "${resolution.procedure.id}" }.` : ""),
          applied: true,
        },
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
    apply(world, params) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      const commander = world.characters.find((c) => c.id === params.commanderCharacterId);
      if (!force || !commander) return null;

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
      const challenger = world.characters.find((c) => c.id === params.challengerCharacterId);
      if (!challenger) return null;
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
    apply(world, params) {
      const denouncer = world.characters.find((c) => c.id === params.denouncerCharacterId);
      const target = world.characters.find((c) => c.id === params.targetCharacterId);
      if (!denouncer || !target) return null;

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
