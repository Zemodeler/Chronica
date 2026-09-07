import type { Character } from "../characters/character";
import type { WorldState } from "../world/world-state";
import type { CharacterIntentActionType } from "./intents";
import type { Commitment } from "./commitments";
import { checkCommitmentAuthority, dueCommitments } from "./commitments";
import { getActivePressures, type CharacterPressure } from "../characters/pressures";
import { queryBeliefs } from "../characters/beliefs";
import { listSocialLinks, type SocialLink } from "../characters/relationship-dimensions";
import type { CharacterGoal, CharacterPlot } from "./schemas";
import { canSponsorProcedure } from "../characters/political-authority";
import { PoliticalProcedureSubjectKindSchema, type PoliticalProcedureType, type PoliticalResolutionMechanism } from "../material-state";
import type { z } from "zod";

type PoliticalProcedureSubjectKind = z.infer<typeof PoliticalProcedureSubjectKindSchema>;

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
  /** Present only for `investigate`/`spread_belief`: the exact belief this candidate is about, so invocation-building can read its canonical subject/kind rather than reconstructing them. */
  readonly sourceBeliefId?: string;
  /**
   * Present only for `sponsor_procedure`: the shape of the procedure this
   * candidate would open. `buildIntentInvocation`
   * (apps/web/lib/resolution/character-agency.ts) reads this to assemble the
   * `sponsor_procedure` command's parameters -- everything else about that
   * command (institution, requirements, eligible participants) is left for
   * the Game Master's own judgement, since only it can read live
   * institution/office data through its read tools; this is advisory
   * context, never auto-invoked.
   */
  readonly proposedProcedure?: {
    readonly type: PoliticalProcedureType;
    readonly subjectKind: PoliticalProcedureSubjectKind;
    readonly linkedWorkflowId: string;
    readonly resolutionMechanism: PoliticalResolutionMechanism;
  };
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
        legalWorkflowIds: ["fulfill_commitment"],
        rationale: `A commitment to ${commitment.beneficiaryCharacterId} is due and can genuinely be kept.`,
      });
    } else if (commitment.requiredResource !== null) {
      // The promisor no longer controls what was promised outright -- offer
      // proposing new terms as an alternative to deferring or breaking it.
      candidates.push({
        actorCharacterId: character.id, actionType: "renegotiate_commitment",
        sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: commitment.id,
        targetIds: [commitment.beneficiaryCharacterId],
        requiredBeliefClaim: null, minBeliefConfidence: 0,
        requiredOfficeId: null, requiredResource: null,
        expectedRisk: 30,
        expectedEffectSummary: "Proposes new terms rather than keeping the promise as originally made.",
        legalWorkflowIds: ["renegotiate_commitment"],
        rationale: `The original terms of the commitment to ${commitment.beneficiaryCharacterId} are no longer within reach.`,
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
      legalWorkflowIds: ["defer_commitment"],
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
      legalWorkflowIds: ["break_commitment"],
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
    // A plot naming a province the character is not currently in also
    // legally admits actually going there, alongside advancing the plot itself.
    const destinationProvinceId = plot.targetIds.find(
      (id) => id !== character.locationProvinceId && world.map.provinces.some((p) => p.id === id),
    );
    if (destinationProvinceId !== undefined) {
      candidates.push({
        actorCharacterId: character.id, actionType: "travel",
        sourceGoalId: plot.goalId, sourcePlotId: plot.id, sourceCommitmentId: null,
        targetIds: [destinationProvinceId],
        requiredBeliefClaim: null, minBeliefConfidence: 0,
        requiredOfficeId: null, requiredResource: null,
        expectedRisk: 10,
        expectedEffectSummary: `Travels toward where the plot's business is: ${plot.objective.slice(0, 100)}`,
        legalWorkflowIds: ["move_character"],
        rationale: `An active plot names a province other than where ${character.id} currently is.`,
      });
    }
  }

  // 3. Pressures translate into social or material candidates.
  const pressures = getActivePressures(world, character.id);
  const rivalLinks = listSocialLinks(world, character.id).filter(
    (l) => (l.kind === "rival" || l.kind === "enemy") && (l.subjectCharacterId === character.id || l.targetCharacterId === character.id),
  );
  const allyLinks = listSocialLinks(world, character.id).filter(
    (l) => (l.kind === "ally" || l.kind === "friend" || l.kind === "patron" || l.kind === "client" || l.kind === "kin")
      && (l.subjectCharacterId === character.id || l.targetCharacterId === character.id),
  );

  for (const pressure of pressures) {
    if ((pressure.kind === "humiliation" || pressure.kind === "political_danger") && rivalLinks.length > 0) {
      const rivalId = otherParty(rivalLinks[0]!, character.id);
      candidates.push(...socialPressureCandidates(world, character, rivalId, pressure));
      candidates.push(...spreadBeliefCandidates(world, character, rivalId, allyLinks));
    }
    if (pressure.kind === "debt") {
      candidates.push(...debtCandidates(world, character, pressure, allyLinks));
    }
    if (pressure.kind === "opportunity") {
      candidates.push(...opportunityCandidates(world, character, pressure));
    }
  }

  // 4. Goals with no active plot yet still deserve a "seek_support"/"prepare" placeholder.
  for (const goal of (world.characterGoals ?? []).filter((g): g is CharacterGoal => g.characterId === character.id && g.status === "active")) {
    const hasPlot = (world.characterPlots ?? []).some((p) => p.goalId === goal.id && p.status === "active");
    if (allyLinks.length > 0) {
      const allyId = otherParty(allyLinks[0]!, character.id);
      candidates.push({
        actorCharacterId: character.id, actionType: "seek_support",
        sourceGoalId: goal.id, sourcePlotId: null, sourceCommitmentId: null,
        targetIds: [allyId],
        requiredBeliefClaim: null, minBeliefConfidence: 0,
        requiredOfficeId: null, requiredResource: null,
        expectedRisk: 15,
        expectedEffectSummary: "Asks a trusted ally to back this goal.",
        legalWorkflowIds: ["record_character_social_action"],
        rationale: `Goal "${goal.objective.slice(0, 80)}" is easier with real backing.`,
      });
    }
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

  // 5. A belief already held, but genuinely uncertain -- worth investigating
  // further. Deliberately a low bar (not merely "not yet 100% confident",
  // which would sweep in routine background suspicion practically every
  // character starts with) -- only a suspicion this weakly held competes
  // with whatever else the character has real reason to be doing.
  const ownSuspicions = queryBeliefs(world, character.id).filter((b) => b.kind === "suspicion" && b.confidence < 40);
  for (const belief of ownSuspicions) {
    candidates.push({
      actorCharacterId: character.id, actionType: "investigate",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: belief.subjectEntityId !== null ? [belief.subjectEntityId] : [],
      requiredBeliefClaim: belief.claim, minBeliefConfidence: belief.confidence,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 15,
      expectedEffectSummary: `Looks further into: ${belief.claim.slice(0, 100)}`,
      legalWorkflowIds: ["investigate"],
      rationale: `Holds a suspicion (confidence ${belief.confidence}) not yet confirmed.`,
      sourceBeliefId: belief.id,
    });
  }

  // 6. Commands a force, and an enemy force shares its ground -- battle is a real option.
  const ownForce = world.material.forces.find((f) => f.commanderCharacterId === character.id);
  if (ownForce !== undefined && character.polityId !== null) {
    const atWar = world.conflicts.wars.some((w) => w.polityAId === character.polityId || w.polityBId === character.polityId);
    if (atWar) {
      const enemyForce = world.material.forces.find(
        (f) => f.locationId === ownForce.locationId
          && f.polityId !== character.polityId
          && world.conflicts.wars.some(
            (w) => (w.polityAId === character.polityId && w.polityBId === f.polityId)
              || (w.polityBId === character.polityId && w.polityAId === f.polityId),
          ),
      );
      if (enemyForce !== undefined) {
        candidates.push({
          actorCharacterId: character.id, actionType: "military_action",
          sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
          targetIds: [enemyForce.id],
          requiredBeliefClaim: null, minBeliefConfidence: 0,
          requiredOfficeId: null, requiredResource: null,
          expectedRisk: 70,
          expectedEffectSummary: `Gives battle to ${enemyForce.name}, sharing the same ground.`,
          legalWorkflowIds: ["start_battle"],
          rationale: `Commands ${ownForce.name}; an enemy force stands on the same ground while the two polities are at war.`,
        });
      }
    }
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

/** The party on the opposite side of a link from `characterId`. */
function otherParty(link: SocialLink, characterId: string): string {
  return link.subjectCharacterId === characterId ? link.targetCharacterId : link.subjectCharacterId;
}

function socialPressureCandidates(world: WorldState, character: Character, rivalId: string, pressure: CharacterPressure): CandidateAction[] {
  const candidates: CandidateAction[] = [
    {
      actorCharacterId: character.id, actionType: "threaten",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: [rivalId],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 50,
      expectedEffectSummary: "Raises fear, damages trust and respect toward the rival.",
      legalWorkflowIds: ["record_character_social_action"],
      rationale: `Responds to pressure "${pressure.label}" by confronting the rival directly.`,
    },
    {
      actorCharacterId: character.id, actionType: "reconcile",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: [rivalId],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 20,
      expectedEffectSummary: "Seeks to repair trust and affection with the rival.",
      legalWorkflowIds: ["record_character_social_action"],
      rationale: `Responds to pressure "${pressure.label}" by seeking to defuse it instead.`,
    },
  ];
  // A rival who currently holds an office is also, alternatively, someone a
  // procedure could be sponsored against -- an option alongside a direct
  // social response, not instead of it.
  const rival = world.characters.find((c) => c.id === rivalId);
  if (rival?.officeId !== null && rival?.officeId !== undefined) {
    const sponsorship = canSponsorProcedure(world, character.id, "removal");
    if (sponsorship.eligible) {
      candidates.push({
        actorCharacterId: character.id, actionType: "sponsor_procedure",
        sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
        targetIds: [rival.officeId],
        requiredBeliefClaim: null, minBeliefConfidence: 0,
        requiredOfficeId: rival.officeId, requiredResource: null,
        expectedRisk: 55,
        expectedEffectSummary: `Opens a procedure to remove the rival from office "${rival.officeId}".`,
        legalWorkflowIds: ["sponsor_procedure"],
        rationale: `Responds to pressure "${pressure.label}": the rival holds an office that could be contested.`,
        proposedProcedure: {
          type: "removal", subjectKind: "office_seat",
          linkedWorkflowId: "remove_from_office", resolutionMechanism: "decree_authority",
        },
      });
    }
  }
  return candidates;
}

function spreadBeliefCandidates(world: WorldState, character: Character, rivalId: string, allyLinks: readonly SocialLink[]): CandidateAction[] {
  if (allyLinks.length === 0) return [];
  const damaging = queryBeliefs(world, character.id, rivalId).filter(
    (b) => b.kind === "secret" || b.kind === "suspicion" || b.kind === "rumour",
  );
  if (damaging.length === 0) return [];
  const belief = damaging[0]!;
  const allyId = otherParty(allyLinks[0]!, character.id);
  if (queryBeliefs(world, allyId, rivalId).some((b) => b.claim === belief.claim)) return [];
  return [{
    actorCharacterId: character.id, actionType: "spread_belief",
    sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
    targetIds: [allyId],
    requiredBeliefClaim: belief.claim, minBeliefConfidence: belief.confidence,
    requiredOfficeId: null, requiredResource: null,
    expectedRisk: 35,
    expectedEffectSummary: `Shares with a trusted ally: ${belief.claim.slice(0, 100)}`,
    legalWorkflowIds: ["spread_belief"],
    rationale: `Holds something about the rival worth a trusted ally knowing too.`,
    sourceBeliefId: belief.id,
  }];
}

function debtCandidates(world: WorldState, character: Character, pressure: CharacterPressure, allyLinks: readonly SocialLink[]): CandidateAction[] {
  const balance = accountBalance(world, character.personalAccountId);
  const trustedContactId = allyLinks.length > 0 ? otherParty(allyLinks[0]!, character.id) : null;
  const candidates: CandidateAction[] = [
    {
      actorCharacterId: character.id, actionType: "request_assistance",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: trustedContactId !== null ? [trustedContactId] : [],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: null, requiredResource: null,
      expectedRisk: 25,
      expectedEffectSummary: "Asks a trusted contact for help with the debt.",
      legalWorkflowIds: trustedContactId !== null ? ["record_character_social_action"] : [],
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

function opportunityCandidates(world: WorldState, character: Character, pressure: CharacterPressure): CandidateAction[] {
  const ambition = character.ambitions.find((a) => a.status === "active" && a.targetId !== null);
  if (ambition === undefined || ambition.targetId === null) return [];
  const officeId = ambition.targetId;
  const openProcedureExists = world.material.politicalProcedures.some(
    (p) => p.subjectKind === "office_seat" && p.subjectId === officeId
      && p.stage !== "resolved" && p.stage !== "withdrawn" && p.stage !== "blocked",
  );
  if (!openProcedureExists && canSponsorProcedure(world, character.id, "appointment").eligible) {
    return [{
      actorCharacterId: character.id, actionType: "sponsor_procedure",
      sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
      targetIds: [officeId],
      requiredBeliefClaim: null, minBeliefConfidence: 0,
      requiredOfficeId: officeId, requiredResource: null,
      expectedRisk: 35,
      expectedEffectSummary: `Opens an appointment procedure for office "${officeId}" -- the step `
        + `"appoint_to_office" itself requires before it can succeed.`,
      legalWorkflowIds: ["sponsor_procedure"],
      rationale: `Responds to pressure "${pressure.label}": a sought office has fallen vacant, but no procedure for it is open yet.`,
      proposedProcedure: {
        type: "appointment", subjectKind: "office_seat",
        linkedWorkflowId: "appoint_to_office", resolutionMechanism: "appointment_authority",
      },
    }];
  }
  return [{
    actorCharacterId: character.id, actionType: "seek_office",
    sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
    targetIds: [officeId],
    requiredBeliefClaim: null, minBeliefConfidence: 0,
    requiredOfficeId: officeId, requiredResource: null,
    expectedRisk: 40,
    expectedEffectSummary: `Seeks appointment to ${officeId}.`,
    legalWorkflowIds: ["appoint_to_office"],
    rationale: `Responds to pressure "${pressure.label}": a sought office has fallen vacant.`,
  }];
}

// Re-exported for callers that only need the belief-gating helper.
export { queryBeliefs };
