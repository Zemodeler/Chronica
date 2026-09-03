import { resolveEligibility } from "./political-authority";
import type {
  GovernmentInstitution,
  GroupMembership,
  MaterialWorldState,
  PoliticalGroup,
  PoliticalProcedure,
  SupportPosition,
} from "../material-state";
import type { Character } from "./character";

// Political inspector (character-sim phase 4).
//
// A structured, developer-facing view of one procedure: every eligibility
// check, every recorded support position (public and private alike), group
// membership/influence, legitimacy modifiers, and the resulting execution
// provenance. Never rendered in ordinary player UI -- the player-facing
// account of the same procedure is the Chronicle's public `politicalOutcome`
// fact, which deliberately omits everything private this view exposes.

export interface InspectorEligibilityCheck {
  readonly requirementId: string;
  readonly label: string;
  readonly satisfied: boolean;
}

export interface InspectorSupportRow extends SupportPosition {
  readonly supporterName: string | null;
}

export interface PoliticalInspectorView {
  readonly procedure: PoliticalProcedure;
  readonly institution: GovernmentInstitution | null;
  readonly sponsorEligibility: readonly InspectorEligibilityCheck[];
  readonly subjectEligibility: readonly InspectorEligibilityCheck[];
  readonly supportPositions: readonly InspectorSupportRow[];
  readonly netSupportWeight: number;
  readonly netOppositionWeight: number;
  readonly eligibleParticipants: readonly { readonly characterId: string; readonly name: string | null }[];
  readonly participantMemberships: readonly GroupMembership[];
  readonly involvedGroups: readonly PoliticalGroup[];
}

function eligibilityChecks(
  world: { characters: readonly Character[]; material: MaterialWorldState },
  characterId: string,
  requirementIds: readonly string[],
): readonly InspectorEligibilityCheck[] {
  return requirementIds.map((requirementId) => {
    const requirement = world.material.eligibilityRequirements.find((r) => r.id === requirementId);
    const { eligible } = resolveEligibility(world, characterId, [requirementId]);
    return { requirementId, label: requirement?.label ?? requirementId, satisfied: eligible };
  });
}

/** Full diagnostic view of one procedure, for the admin/debug political inspector route only. */
export function buildPoliticalInspectorView(
  world: { characters: readonly Character[]; material: MaterialWorldState },
  procedureId: string,
): PoliticalInspectorView | undefined {
  const procedure = world.material.politicalProcedures.find((p) => p.id === procedureId);
  if (procedure === undefined) return undefined;

  const institution = procedure.institutionId
    ? world.material.institutions.find((i) => i.id === procedure.institutionId) ?? null
    : null;

  const positionsBySupporter = new Map<string, SupportPosition>();
  for (const position of world.material.supportPositions) {
    if (position.procedureId !== procedureId) continue;
    const existing = positionsBySupporter.get(position.supporterId);
    if (existing === undefined || position.changedAtStep > existing.changedAtStep) {
      positionsBySupporter.set(position.supporterId, position);
    }
  }
  const supportPositions: InspectorSupportRow[] = [...positionsBySupporter.values()].map((position) => ({
    ...position,
    supporterName:
      position.supporterKind === "character"
        ? world.characters.find((c) => c.id === position.supporterId)?.name ?? null
        : world.material.politicalGroups.find((g) => g.id === position.supporterId)?.name ?? null,
  }));

  const netSupportWeight = supportPositions.filter((p) => p.position === "support").reduce((sum, p) => sum + p.influenceWeight, 0);
  const netOppositionWeight = supportPositions.filter((p) => p.position === "oppose").reduce((sum, p) => sum + p.influenceWeight, 0);

  const eligibleParticipants = procedure.eligibleParticipantIds.map((characterId) => ({
    characterId,
    name: world.characters.find((c) => c.id === characterId)?.name ?? null,
  }));

  const participantMemberships = world.material.groupMemberships.filter(
    (m) => procedure.eligibleParticipantIds.includes(m.characterId) && m.leftAtStep === null,
  );
  const involvedGroupIds = new Set(participantMemberships.map((m) => m.groupId));
  const involvedGroups = world.material.politicalGroups.filter((g) => involvedGroupIds.has(g.id));

  return {
    procedure,
    institution,
    sponsorEligibility: eligibilityChecks(world, procedure.sponsorCharacterId, procedure.eligibilityRequirementIds),
    subjectEligibility:
      procedure.subjectKind === "character" && procedure.subjectId !== null
        ? eligibilityChecks(world, procedure.subjectId, procedure.eligibilityRequirementIds)
        : [],
    supportPositions,
    netSupportWeight,
    netOppositionWeight,
    eligibleParticipants,
    participantMemberships,
    involvedGroups,
  };
}
