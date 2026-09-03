import type { Character } from "../characters/character";
import type { WorldState } from "../world/world-state";
import type { CharacterIntentActionType } from "./intents";
import type { Commitment } from "./commitments";
import { checkCommitmentAuthority, dueCommitments } from "./commitments";
import { getActivePressures, type CharacterPressure } from "../characters/pressures";
import { queryBeliefs } from "../characters/beliefs";
import { listSocialLinks } from "../characters/relationship-dimensions";
import type { CharacterGoal, CharacterPlot } from "./schemas";

// Candidate action generation (character-sim phase 3).
//
// A candidate is a legal possibility, not a decision -- `scoring.ts` picks
// among the candidates this module returns. Every field here is read
// straight off canonical world state (a real commitment, a real pressure, a
// real goal or plot, a real social link, a real account); nothing is
// invented. A character with no due commitment, no active plot, and no
// triggering pressure gets only the baseline `wait`/`prepare` candidates.

export interface CandidateAction {
  readonly actorCharacterId: string;
  readonly actionType: CharacterIntentActionType;
  readonly sourceGoalId: string | null;
  readonly sourcePlotId: string | null;
  readonly sourceCommitmentId: string | null;
  readonly targetIds: readonly string[];
  readonly requiredBeliefClaim: string | null;
  readonly minBeliefConfidence: number;
  readonly requiredOfficeId: string | null;
  readonly requiredResource: { readonly accountId: string; readonly minAmount: number } | null;
  readonly expectedRisk: number;
  readonly expectedEffectSummary: string;
  /** Workflow registry ids this candidate could execute through if chosen; empty means a direct social effect, not a material workflow. */
  readonly legalWorkflowIds: readonly string[];
  readonly rationale: string;
}

export interface CandidateGenerationContext {
  readonly world: WorldState;
  readonly character: Character;
  readonly atStep: number;
  readonly commitments: readonly Commitment[];
}

function accountBalance(world: WorldState, accountId: string | null): number {
  if (accountId === null) return 0;
  return world.material.accounts.find((a) => a.id === accountId)?.balance ?? 0;
}

/** Generates the bounded set of legal candidate actions for one character this turn. */
export function generateCandidateActions(context: CandidateGenerationContext): readonly CandidateAction[] {
  const { world, character, atStep } = context;
  const candidates: CandidateAction[] = [];

  // 1. Commitments this character owes that are due for review.
  const owed = dueCommitments(context.commitments, atStep).filter((c) => c.promisorCharacterId === character.id);
  for (const commitment of owed) {
    const authority = checkCommitmentAuthority(world, character.id, commitment.requiredOfficeId, commitment.requiredResource);
    if (authority.ok) {
      candidates.push({
        actorCharacterId: character.id, actionType: "fulfill_commitment",
        sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: commitment.id,
        targetIds: [commitment.beneficiaryCharacterId],
        requiredBeliefClaim: null, minBeliefConfidence: 0,
        requiredOfficeId: commitment.requiredOfficeId, requiredResource: commitment.requiredResource,
        expectedRisk: 5,
        expectedEffectSummary: `Keeps the promise: ${commitment.description}`,
        legalWorkflowIds: [],
        rationale: `A commitment to ${commitment.beneficiaryCharacterId} is due and can genuinely be kept.`,
      });
    }
    candidates.push({
      actorCharacterId: character.id, actionType: "defer_commitment",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: commitment.id,
      targetIds: [commitment.beneficiaryCharacterId],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 15,
      expectedEffectSummary: "Buys time without breaking the promise outright.",
      legalWorkflowIds: [],
      rationale: "The commitment cannot yet be kept, but is not worth breaking either.",
    });
    candidates.push({
      actorCharacterId: character.id, actionType: "break_commitment",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: commitment.id,
      targetIds: [commitment.beneficiaryCharacterId],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 60,
      expectedEffectSummary: "Abandons the promise outright, at a reputational cost.",
      legalWorkflowIds: [],
      rationale: "Keeping this commitment now conflicts with a higher priority.",
    });
  }

  // 2. Active plots with a stated next move -- advance them.
  for (const plot of (world.characterPlots ?? []).filter(
    (p): p is CharacterPlot => p.characterId === character.id && p.status === "active",
  )) {
    if (plot.nextIntendedMove === null) continue;
    candidates.push({
      actorCharacterId: character.id, actionType: "advance_plot",
      sourceGoalId: plot.goalId, sourcePlotId: plot.id, sourceCommitmentId: null,
      targetIds: plot.targetIds,
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: Math.max(10, 100 - plot.momentum),
      expectedEffectSummary: plot.nextIntendedMove,
      legalWorkflowIds: ["advance_character_plot"],
      rationale: `Continues an active plot: ${plot.objective.slice(0, 120)}`,
    });
  }

  // 3. Pressures translate into social or material candidates.
  const pressures = getActivePressures(world, character.id);
  const rivalLinks = listSocialLinks(world, character.id).filter(
    (l) => (l.kind === "rival" || l.kind === "enemy") && (l.subjectCharacterId === character.id || l.targetCharacterId === character.id),
  );

  for (const pressure of pressures) {
    if ((pressure.kind === "humiliation" || pressure.kind === "political_danger") && rivalLinks.length > 0) {
      const rivalId = rivalLinks[0]!.subjectCharacterId === character.id ? rivalLinks[0]!.targetCharacterId : rivalLinks[0]!.subjectCharacterId;
      candidates.push(...socialPressureCandidates(character.id, rivalId, pressure));
    }
    if (pressure.kind === "debt") {
      candidates.push(...debtCandidates(world, character, pressure));
    }
    if (pressure.kind === "opportunity") {
      candidates.push(...opportunityCandidates(character, pressure));
    }
  }

  // 4. Goals with no active plot yet still deserve a "seek_support"/"prepare" placeholder.
  for (const goal of (world.characterGoals ?? []).filter((g): g is CharacterGoal => g.characterId === character.id && g.status === "active")) {
    const hasPlot = (world.characterPlots ?? []).some((p) => p.goalId === goal.id && p.status === "active");
    if (hasPlot) continue;
    candidates.push({
      actorCharacterId: character.id, actionType: "prepare",
      sourceGoalId: goal.id, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: goal.targetEntityIds,
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 5,
      expectedEffectSummary: "Waits for a concrete plot before committing to action.",
      legalWorkflowIds: [],
      rationale: `Goal "${goal.objective.slice(0, 80)}" has no active plot yet.`,
    });
  }

  // Baseline fallback -- always legal, never invents a target.
  candidates.push({
    actorCharacterId: character.id, actionType: "wait",
    sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
    targetIds: [],
    requiredBeliefClaim: null, minBeliefConfidence: 0,
    requiredOfficeId: null, requiredResource: null,
    expectedRisk: 0,
    expectedEffectSummary: "No action this turn.",
    legalWorkflowIds: [],
    rationale: "Nothing currently outweighs the cost or risk of acting.",
  });

  return candidates;
}

function socialPressureCandidates(actorId: string, rivalId: string, pressure: CharacterPressure): CandidateAction[] {
  return [
    {
      actorCharacterId: actorId, actionType: "threaten",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: [rivalId],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 50,
      expectedEffectSummary: "Raises fear, damages trust and respect toward the rival.",
      legalWorkflowIds: [],
      rationale: `Responds to pressure "${pressure.label}" by confronting the rival directly.`,
    },
    {
      actorCharacterId: actorId, actionType: "reconcile",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: [rivalId],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 20,
      expectedEffectSummary: "Seeks to repair trust and affection with the rival.",
      legalWorkflowIds: [],
      rationale: `Responds to pressure "${pressure.label}" by seeking to defuse it instead.`,
    },
  ];
}

function debtCandidates(world: WorldState, character: Character, pressure: CharacterPressure): CandidateAction[] {
  const balance = accountBalance(world, character.personalAccountId);
  const candidates: CandidateAction[] = [
    {
      actorCharacterId: character.id, actionType: "request_assistance",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: [],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 25,
      expectedEffectSummary: "Asks a trusted contact for help with the debt.",
      legalWorkflowIds: [],
      rationale: `Responds to pressure "${pressure.label}".`,
    },
  ];
  if (balance > 0) {
    candidates.push({
      actorCharacterId: character.id, actionType: "economic_action",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: [],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: { accountId: character.personalAccountId, minAmount: Math.min(balance, 1) },
      expectedRisk: 10,
      expectedEffectSummary: "Manages remaining funds to reduce exposure.",
      legalWorkflowIds: ["remove_gold"],
      rationale: `Responds to pressure "${pressure.label}" with the funds actually on hand.`,
    });
  }
  return candidates;
}

function opportunityCandidates(character: Character, pressure: CharacterPressure): CandidateAction[] {
  const ambition = character.ambitions.find((a) => a.status === "active" && a.targetId !== null);
  if (ambition === undefined || ambition.targetId === null) return [];
  return [{
    actorCharacterId: character.id, actionType: "seek_office",
    sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
    targetIds: [ambition.targetId],
    requiredBeliefClaim: null, minBeliefConfidence: 0,
    requiredOfficeId: ambition.targetId, requiredResource: null,
    expectedRisk: 40,
    expectedEffectSummary: `Seeks appointment to ${ambition.targetId}.`,
    legalWorkflowIds: ["appoint_to_office"],
    rationale: `Responds to pressure "${pressure.label}": a sought office has fallen vacant.`,
  }];
}

// Re-exported for callers that only need the belief-gating helper.
export { queryBeliefs };
