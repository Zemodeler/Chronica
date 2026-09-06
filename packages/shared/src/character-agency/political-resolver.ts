import type { Character } from "../characters/character";
import { computeOpinion } from "../characters/opinion";
import type { MaterialWorldState, Motion, PoliticalProcedure, SupportPosition, VoteRecord } from "../material-state";
import { stableHash } from "../determinism";
import type { Commitment } from "./commitments";

// Political support resolution (character-sim phase 4; vote agency, docs/29).
//
// This module validates and tallies whatever canonical SupportPosition
// records already exist, and decides a procedure's outcome when it comes due.
// Nothing here calls an AI and nothing here is randomised -- two identical
// world states at the same step always resolve the same way, per docs/03's
// replay guarantee.
//
// `evaluateSupport` no longer decides a position: the Game Master's own
// stated choice, recorded by the `pledge_support` workflow, is the position.
// `evaluateSupport` stays as advisory context only -- surfaced through the
// `inspect_political_procedure` read tool as a suggestion, never applied
// automatically.

export interface PoliticalResolverWorldView {
  readonly characters: readonly Character[];
  readonly material: MaterialWorldState;
}

/**
 * Folds relationship, belief-adjacent, group-loyalty, and legitimacy signals
 * into one advisory support score for `supporterId` toward `procedure`'s
 * sponsor -- a suggestion the Game Master may read before recording its own
 * chosen position, never the position itself. AI-proposed persuasion changes
 * the *inputs* (a new relationship cause, a new pressure), which this
 * function will reflect the next time it's read.
 */
export function evaluateSupport(
  world: PoliticalResolverWorldView,
  procedure: PoliticalProcedure,
  supporterId: string,
  commitments: readonly Commitment[] = [],
): { score: number; reasons: SupportPosition["reasons"] } {
  const supporter = world.characters.find((c) => c.id === supporterId);
  const sponsor = world.characters.find((c) => c.id === procedure.sponsorCharacterId);
  const reasons: SupportPosition["reasons"] = [];
  if (supporter === undefined || sponsor === undefined) return { score: 0, reasons };

  const opinion = computeOpinion(supporter, sponsor.id);
  if (opinion !== 0) {
    reasons.push({
      kind: "relationship",
      label: `${supporter.name}'s opinion of ${sponsor.name}`,
      score: opinion,
      sourceId: sponsor.id,
    });
  }

  const sharedGroups = world.material.groupMemberships.filter(
    (m) => m.characterId === supporterId && m.leftAtStep === null,
  );
  for (const membership of sharedGroups) {
    const sponsorInSameGroup = world.material.groupMemberships.some(
      (m) => m.characterId === sponsor.id && m.groupId === membership.groupId && m.leftAtStep === null,
    );
    if (sponsorInSameGroup) {
      reasons.push({
        kind: "group_loyalty",
        label: `Shared membership in group "${membership.groupId}"`,
        score: membership.loyaltyBps,
        sourceId: membership.groupId,
      });
    }
  }

  const relevantCommitments = commitments.filter(
    (c) =>
      (c.promisorCharacterId === supporterId && c.beneficiaryCharacterId === sponsor.id) ||
      (c.promisorCharacterId === sponsor.id && c.beneficiaryCharacterId === supporterId),
  );
  for (const commitment of relevantCommitments) {
    if (commitment.status === "fulfilled") {
      reasons.push({ kind: "commitment", label: `Honoured commitment: ${commitment.description}`, score: 20, sourceId: commitment.id });
    } else if (commitment.status === "broken") {
      reasons.push({ kind: "commitment", label: `Broken commitment: ${commitment.description}`, score: -30, sourceId: commitment.id });
    }
  }

  if (procedure.institutionId !== null) {
    const legitimacy = world.material.institutionLegitimacy.find((entry) => entry.institutionId === procedure.institutionId);
    if (legitimacy !== undefined && legitimacy.legitimacyBps < 3000) {
      reasons.push({
        kind: "ideology",
        label: "Low institutional legitimacy invites opposition",
        score: -10,
        sourceId: procedure.institutionId,
      });
    }
  }

  const score = Math.max(-100, Math.min(100, reasons.reduce((sum, reason) => sum + reason.score, 0)));
  return { score, reasons };
}

/** Maps a raw score onto a discrete position with hysteresis-free, fixed thresholds. */
export function positionFromScore(score: number): SupportPosition["position"] {
  if (score >= 15) return "support";
  if (score <= -15) return "oppose";
  if (score === 0) return "undecided";
  return "abstain";
}

/** The current (latest by step) support position for one supporter on one procedure, if any. */
export function currentSupportPosition(
  positions: readonly SupportPosition[],
  procedureId: string,
  supporterId: string,
): SupportPosition | undefined {
  return positions
    .filter((p) => p.procedureId === procedureId && p.supporterId === supporterId)
    .sort((a, b) => b.changedAtStep - a.changedAtStep)[0];
}

function weightForSupporter(
  world: PoliticalResolverWorldView,
  supporterKind: SupportPosition["supporterKind"],
  supporterId: string,
): number {
  if (supporterKind === "character") return 1;
  const group = world.material.politicalGroups.find((g) => g.id === supporterId);
  return group === undefined ? 0 : Math.max(1, Math.round(group.publicReputationBps / 1000));
}

export interface ProcedureResolution {
  readonly procedure: PoliticalProcedure;
  readonly motion?: Motion;
  readonly voteRecord?: VoteRecord;
}

/**
 * Resolves one procedure at `voting_or_deciding` (or past its deadline) by its
 * declared `resolutionMechanism`. Never mutates its input; returns the
 * updated procedure (and, for a vote, the Motion/VoteRecord pair reusing the
 * institution's own quorum/threshold math) plus, on `passed`, the workflow
 * invocation parameters the caller should queue.
 */
export function resolveProcedure(
  world: PoliticalResolverWorldView,
  procedure: PoliticalProcedure,
  atStep: number,
): { resolution: ProcedureResolution; invocation: { actionId: string; actorId: string; parameters: Record<string, unknown> } | null } {
  if (procedure.resolutionMechanism === "vote") {
    return resolveByVote(world, procedure, atStep);
  }
  return resolveByAuthority(world, procedure, atStep);
}

function currentPositionsFor(world: PoliticalResolverWorldView, procedureId: string): readonly SupportPosition[] {
  const bySupporter = new Map<string, SupportPosition>();
  for (const position of world.material.supportPositions) {
    if (position.procedureId !== procedureId) continue;
    const existing = bySupporter.get(position.supporterId);
    if (existing === undefined || position.changedAtStep > existing.changedAtStep) {
      bySupporter.set(position.supporterId, position);
    }
  }
  return [...bySupporter.values()];
}

export function netSupportWeight(world: PoliticalResolverWorldView, procedure: PoliticalProcedure): { support: number; oppose: number } {
  let support = 0;
  let oppose = 0;
  for (const position of currentPositionsFor(world, procedure.id)) {
    const weight = weightForSupporter(world, position.supporterKind, position.supporterId);
    if (position.position === "support") support += weight;
    else if (position.position === "oppose") oppose += weight;
  }
  return { support, oppose };
}

function buildInvocation(procedure: PoliticalProcedure): { actionId: string; actorId: string; parameters: Record<string, unknown> } {
  return {
    actionId: procedure.linkedWorkflowId,
    actorId: procedure.sponsorCharacterId,
    parameters: { ...procedure.linkedWorkflowParams, authorization: { procedureId: procedure.id } },
  };
}

function resolveByAuthority(
  world: PoliticalResolverWorldView,
  procedure: PoliticalProcedure,
  atStep: number,
): { resolution: ProcedureResolution; invocation: { actionId: string; actorId: string; parameters: Record<string, unknown> } | null } {
  const { support, oppose } = netSupportWeight(world, procedure);
  let passed: boolean;
  let reason: string;
  if (procedure.resolutionMechanism === "sponsor_discretion" || procedure.resolutionMechanism === "decree_authority") {
    // The sponsor's own authority decides; net opposition can still block it if it outweighs support.
    passed = oppose <= support;
    reason =
      oppose <= support
        ? "The sponsor's authority carried it; opposition did not outweigh support."
        : "Opposition outweighed the sponsor's support and blocked the act.";
  } else {
    // appointment_authority / seniority: passes unless net opposition strictly outweighs support,
    // with a stable tie-break so an exact draw is decided the same way on every replay.
    if (support === oppose) {
      const tieBreak = stableHash([procedure.id, atStep, "authority-tie"]) % 2;
      passed = tieBreak === 0;
      reason = passed
        ? "Support and opposition were exactly balanced; the stable tie-break favoured the sponsor."
        : "Support and opposition were exactly balanced; the stable tie-break favoured the opposition.";
    } else {
      passed = support > oppose;
      reason = passed ? "Support outweighed opposition." : "Opposition outweighed support.";
    }
  }

  const resolved: PoliticalProcedure = {
    ...procedure,
    stage: "resolved",
    resolvedAtStep: atStep,
    outcome: passed ? "passed" : "failed",
    outcomeReason: reason,
  };
  return { resolution: { procedure: resolved }, invocation: passed ? buildInvocation(resolved) : null };
}

function resolveByVote(
  world: PoliticalResolverWorldView,
  procedure: PoliticalProcedure,
  atStep: number,
): { resolution: ProcedureResolution; invocation: { actionId: string; actorId: string; parameters: Record<string, unknown> } | null } {
  const institution = world.material.institutions.find((i) => i.id === procedure.institutionId);
  if (institution === undefined) {
    const blocked: PoliticalProcedure = {
      ...procedure,
      stage: "blocked",
      resolvedAtStep: atStep,
      outcome: "blocked",
      outcomeReason: "The institution this procedure names no longer exists.",
    };
    return { resolution: { procedure: blocked }, invocation: null };
  }

  const positions = currentPositionsFor(world, procedure.id);
  const votes = institution.votingBlocs.map((bloc) => {
    const blocSupporters = world.material.groupMemberships.filter(
      (m) => m.groupId === bloc.id && m.leftAtStep === null,
    );
    const blocPositions = positions.filter((p) =>
      blocSupporters.some((m) => m.characterId === p.supporterId) || p.supporterId === bloc.id,
    );
    const net = blocPositions.reduce((sum, p) => {
      if (p.position === "support") return sum + 1;
      if (p.position === "oppose") return sum - 1;
      return sum;
    }, 0);
    const netScore = net === 0 ? bloc.baseSupport : Math.max(-100, Math.min(100, bloc.baseSupport + net * 10));
    const choice: "yes" | "no" | "abstain" = netScore >= bloc.yesThreshold ? "yes" : netScore <= bloc.noThreshold ? "no" : "abstain";
    return {
      blocId: bloc.id,
      choice,
      weight: bloc.weight,
      supportScore: netScore,
      reasons: [`Net bloc position from ${blocPositions.length} recorded support(s), base support ${bloc.baseSupport}.`],
    };
  });

  const yesWeight = votes.filter((v) => v.choice === "yes").reduce((s, v) => s + v.weight, 0);
  const noWeight = votes.filter((v) => v.choice === "no").reduce((s, v) => s + v.weight, 0);
  const abstainWeight = votes.filter((v) => v.choice === "abstain").reduce((s, v) => s + v.weight, 0);
  const presentWeight = yesWeight + noWeight + abstainWeight;
  const denominatorWeight =
    institution.denominator === "total" ? institution.totalVotingWeight : institution.denominator === "present" ? presentWeight : yesWeight + noWeight;
  const quorumMet = presentWeight * 10_000 >= institution.quorumBps * institution.totalVotingWeight;
  const thresholdMet = denominatorWeight > 0 && yesWeight * 10_000 >= institution.passageThresholdBps * denominatorWeight;
  const outcome: "passed" | "failed" = quorumMet && thresholdMet && yesWeight > noWeight ? "passed" : "failed";

  const voteRecord: VoteRecord = {
    id: `${procedure.id}:vote:${atStep}`,
    motionId: procedure.id,
    votes,
    yesWeight,
    noWeight,
    abstainWeight,
    presentWeight,
    quorumMet,
    thresholdMet,
    outcome,
    resolvedAtStep: atStep,
  };

  const motion: Motion = {
    id: procedure.id,
    institutionId: institution.id,
    sponsorCharacterId: procedure.sponsorCharacterId,
    category: "foundational_law",
    proposalLabel: procedure.outcomeReason ?? procedure.type,
    linkedActionId: procedure.linkedWorkflowId,
    openedAtStep: procedure.openedAtStep,
    status: outcome === "passed" ? "passed" : "failed",
    voteRecordId: voteRecord.id,
  };

  const resolved: PoliticalProcedure = {
    ...procedure,
    stage: "resolved",
    resolvedAtStep: atStep,
    outcome: outcome === "passed" ? "passed" : "failed",
    outcomeReason:
      outcome === "passed"
        ? "The institution's vote met quorum and threshold with more support than opposition."
        : !quorumMet
          ? "The institution's vote failed to reach quorum."
          : !thresholdMet
            ? "The institution's vote did not clear its passage threshold."
            : "Opposition weight met or exceeded support weight.",
    voteRecordId: voteRecord.id,
  };

  return {
    resolution: { procedure: resolved, motion, voteRecord },
    invocation: outcome === "passed" ? buildInvocation(resolved) : null,
  };
}

/** Every procedure due for resolution this step: at `voting_or_deciding`, or past its deadline. */
export function dueProcedures(procedures: readonly PoliticalProcedure[], atStep: number): readonly PoliticalProcedure[] {
  return procedures.filter(
    (p) => p.stage === "voting_or_deciding" || (p.deadlineStep !== null && p.deadlineStep <= atStep && p.stage !== "resolved" && p.stage !== "withdrawn" && p.stage !== "blocked"),
  );
}

/**
 * Resolves every due procedure once, deterministically, folding each result
 * back into `material` so later procedures in the same batch see prior
 * outcomes (e.g. a seat vacated earlier this step). Returns the updated
 * material plus the invocations the caller should queue into the same batch
 * that reaches `executeWorkflows`.
 */
export function resolveDueProcedures(
  world: PoliticalResolverWorldView,
  atStep: number,
): { material: MaterialWorldState; invocations: readonly { actionId: string; actorId: string; parameters: Record<string, unknown> }[] } {
  let material = world.material;
  const invocations: { actionId: string; actorId: string; parameters: Record<string, unknown> }[] = [];

  for (const procedure of dueProcedures(material.politicalProcedures, atStep)) {
    const { resolution, invocation } = resolveProcedure({ characters: world.characters, material }, procedure, atStep);
    material = {
      ...material,
      politicalProcedures: material.politicalProcedures.map((p) => (p.id === resolution.procedure.id ? resolution.procedure : p)),
      motions: resolution.motion ? [...material.motions.filter((m) => m.id !== resolution.motion!.id), resolution.motion] : material.motions,
      voteRecords: resolution.voteRecord ? [...material.voteRecords, resolution.voteRecord] : material.voteRecords,
    };
    if (invocation !== null) invocations.push(invocation);
  }

  return { material, invocations };
}
