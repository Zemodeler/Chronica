import { z } from "zod";
import {
  BasisPointsSchema,
  EntityIdSchema,
  PoliticalProcedureSubjectKindSchema,
  PoliticalProcedureTypeSchema,
  PoliticalResolutionMechanismSchema,
  SupportPositionKindSchema,
  VisibilitySchema,
  type MaterialWorldState,
  type PoliticalProcedure,
  type SupportPosition,
} from "../../material-state";
import { canParticipate, canSponsorProcedure, resolveEligibility } from "../../characters/political-authority";
import { evaluateSupport, positionFromScore } from "../../character-agency/political-resolver";
import { describePoliticalQuestion } from "../../chronicle/political-procedure-description";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";

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
      if (world.material.politicalProcedures.some((p) => p.id === params.procedureId)) {
        return refuse(`A procedure already carries the id "${params.procedureId}". Give this one an id of its own.`);
      }
      if (params.institutionId !== null && !world.material.institutions.some((i) => i.id === params.institutionId)) {
        const names = world.material.institutions.map((i) => `${i.name} (${i.id})`).join("; ");
        return refuse(`There is no institution "${params.institutionId}". The institutions that exist are: ${names || "none"}. Pass one of those, or null to bring the matter before no institution.`);
      }
      const sponsorship = canSponsorProcedure(world, params.sponsorCharacterId, params.type, params.institutionId);
      if (!sponsorship.eligible) return refuse(sponsorship.failedReasons.join(" "));
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
        world: { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } },
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
    apply(world, params, context) {
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
      if (procedure.stage !== "proposed" && procedure.stage !== "gathering_support" && procedure.stage !== "deliberating") {
        return refuse(`That procedure is at stage "${procedure.stage}"; a vote can only be called while it is still proposed, gathering support, or deliberating.`);
      }
      if (procedure.sponsorCharacterId !== params.callerCharacterId) {
        const sponsor = world.characters.find((c) => c.id === procedure.sponsorCharacterId);
        return refuse(`Only its sponsor may call that procedure to a decision, and its sponsor is ${sponsor?.name ?? procedure.sponsorCharacterId}.`);
      }
      // Supply missing scenario scaffolding before enforcing the actual voting
      // rule. The sponsor still needs a bloc membership; this creates the
      // missing bloc and assignment rather than making the procedure dead-end.
      const material = procedure.resolutionMechanism === "vote" && procedure.institutionId !== null
        ? ensureVotingBlocMembership(world.material, procedure.institutionId, params.callerCharacterId, context.atStep)
        : world.material;
      const actions = canParticipate({ ...world, material }, params.callerCharacterId, procedure);
      if (procedure.resolutionMechanism === "vote" && !actions.includes("vote")) {
        return refuse("The caller could not be seated in one of this institution's voting blocs.");
      }

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
      const force = world.material.forces.find((f) => f.id === params.forceId);
      const commander = world.characters.find((c) => c.id === params.commanderCharacterId);
      if (!force || !commander || !commander.alive) return null;

      // A sitting magistrate of the polity that owns the force may give it a
      // commander on his own authority. A consul who cannot put himself at the
      // head of his republic's legions without first carrying a motion is not
      // a consul, and the procedure route -- which resolves a turn later --
      // made the most ordinary act of the office impossible to perform.
      // Everyone else still needs a resolved procedure that authorises it.
      const actor = world.characters.find((c) => c.id === context.actorId);
      const actorIsMagistrateOfForcePolity =
        actor !== undefined
        && actor.alive
        && actor.polityId !== null
        && actor.polityId === force.polityId
        && world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === actor.id);

      if (!actorIsMagistrateOfForcePolity) {
        const authorized = requireProcedureAuthorization(world.material.politicalProcedures, context.actorId, "assign_command", params.authorization);
        if (authorized === null) return null;
      }
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
