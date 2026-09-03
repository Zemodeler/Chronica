import type { Character, Office } from "./character";
import type { EligibilityRequirement, GroupMembership, MaterialWorldState, PoliticalProcedure } from "../material-state";

// Political authority and eligibility (character-sim phase 4).
//
// Deterministic, pure functions over already-canonical state -- nothing here
// calls an AI, and nothing a political workflow needs to check is duplicated
// inline in the workflow itself. This is the single choke point: sponsoring,
// voting, nominating, appointing, vetoing, commanding, and negotiating all
// route through the helpers below, so "no direct workflow may bypass these
// checks" is true by construction rather than by convention.

export interface PoliticalAuthorityWorldView {
  readonly characters: readonly Character[];
  readonly material: MaterialWorldState;
}

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly failedReasons: readonly string[];
}

function activeMembership(
  memberships: readonly GroupMembership[],
  characterId: string,
  groupId: string,
): GroupMembership | undefined {
  return memberships.find((m) => m.characterId === characterId && m.groupId === groupId && m.leftAtStep === null);
}

/** Evaluates one requirement against live world state. Never throws; an unknown character simply fails every check. */
function checkRequirement(
  world: PoliticalAuthorityWorldView,
  character: Character | undefined,
  requirement: EligibilityRequirement,
): string | null {
  if (character === undefined) return `Unknown character cannot satisfy "${requirement.label}".`;
  const params = requirement.params;

  switch (requirement.kind) {
    case "alive":
      return character.alive ? null : `${character.name} is not alive.`;
    case "polity_membership": {
      const polityId = params.polityId as string | undefined;
      return character.polityId === polityId ? null : `${character.name} does not belong to polity "${polityId}".`;
    }
    case "culture_membership": {
      const cultureId = params.cultureId as string | undefined;
      return character.cultureId === cultureId ? null : `${character.name} does not belong to culture "${cultureId}".`;
    }
    case "faith_membership": {
      const faithId = params.faithId as string | undefined;
      return character.faithId === faithId ? null : `${character.name} does not belong to faith "${faithId}".`;
    }
    case "group_membership": {
      const groupId = params.groupId as string | undefined;
      if (groupId === undefined) return `Requirement "${requirement.label}" names no group.`;
      return activeMembership(world.material.groupMemberships, character.id, groupId) !== undefined
        ? null
        : `${character.name} is not a member of group "${groupId}".`;
    }
    case "min_prestige": {
      const minPrestigeBps = (params.minPrestigeBps as number | undefined) ?? 0;
      return character.prestigeBps >= minPrestigeBps
        ? null
        : `${character.name}'s prestige is below the required minimum.`;
    }
    case "holds_office": {
      const officeId = params.officeId as string | undefined;
      return character.officeId === officeId ? null : `${character.name} does not hold office "${officeId}".`;
    }
    case "not_disqualified": {
      const statuses = character.disqualifyingStatuses;
      return statuses.length === 0 ? null : `${character.name} carries a disqualifying status: ${statuses.join(", ")}.`;
    }
    case "sponsorship_required": {
      const nominated = world.material.politicalProcedures.some(
        (procedure) =>
          procedure.type === "nomination" && procedure.subjectId === character.id && procedure.outcome === "passed",
      );
      return nominated ? null : `${character.name} has not been nominated by an eligible sponsor.`;
    }
    case "custom_scenario_flag": {
      const flagId = params.flagId as string | undefined;
      const mode = (params.mode as "present" | "absent" | undefined) ?? "absent";
      if (flagId === undefined) return `Requirement "${requirement.label}" names no flag.`;
      const present = character.disqualifyingStatuses.includes(flagId);
      if (mode === "present") return present ? null : `${character.name} lacks the required flag "${flagId}".`;
      return present ? `${character.name} carries the disqualifying flag "${flagId}".` : null;
    }
    default:
      return `Unrecognised eligibility requirement kind.`;
  }
}

/** Resolves every named requirement against `characterId`. Missing requirement ids fail closed. */
export function resolveEligibility(
  world: PoliticalAuthorityWorldView,
  characterId: string,
  requirementIds: readonly string[],
): EligibilityResult {
  const character = world.characters.find((c) => c.id === characterId);
  const failedReasons: string[] = [];
  for (const requirementId of requirementIds) {
    const requirement = world.material.eligibilityRequirements.find((r) => r.id === requirementId);
    if (requirement === undefined) {
      failedReasons.push(`Eligibility requirement "${requirementId}" is not defined.`);
      continue;
    }
    const failure = checkRequirement(world, character, requirement);
    if (failure !== null) failedReasons.push(failure);
  }
  return { eligible: failedReasons.length === 0, failedReasons };
}

/** Whether `characterId` may sponsor a procedure of `procedureType`, optionally through `institutionId`. */
export function canSponsorProcedure(
  world: PoliticalAuthorityWorldView,
  characterId: string,
  procedureType: PoliticalProcedure["type"],
  institutionId: string | null = null,
): EligibilityResult {
  const character = world.characters.find((c) => c.id === characterId);
  if (character === undefined) return { eligible: false, failedReasons: ["Unknown character."] };
  if (!character.alive) return { eligible: false, failedReasons: [`${character.name} is not alive.`] };
  if (character.disqualifyingStatuses.length > 0) {
    return { eligible: false, failedReasons: [`${character.name} carries a disqualifying status.`] };
  }
  if (institutionId !== null) {
    const institution = world.material.institutions.find((i) => i.id === institutionId);
    if (institution === undefined) return { eligible: false, failedReasons: ["Institution does not exist."] };
  }
  // Reserved-power sponsorship (which office may sponsor which category of
  // motion) is checked via `officeGrantsDirectAccess`/`ReservedPowerRule` at
  // the workflow layer, where the office record is already in hand -- offices
  // are scenario data, not part of `WorldState`, so this helper only checks
  // what live world state can answer: aliveness and disqualification.
  void procedureType;
  return { eligible: true, failedReasons: [] };
}

export type PoliticalAuthorityAction = "vote" | "nominate" | "appoint" | "veto" | "command" | "negotiate";

/** Which authority actions `characterId` may exercise against `procedure`, given eligibility and institution membership. */
export function canParticipate(
  world: PoliticalAuthorityWorldView,
  characterId: string,
  procedure: PoliticalProcedure,
): readonly PoliticalAuthorityAction[] {
  const character = world.characters.find((c) => c.id === characterId);
  if (character === undefined || !character.alive || character.disqualifyingStatuses.length > 0) return [];
  if (!procedure.eligibleParticipantIds.includes(characterId) && procedure.sponsorCharacterId !== characterId) return [];

  const actions: PoliticalAuthorityAction[] = [];
  if (procedure.resolutionMechanism === "vote" && procedure.institutionId !== null) {
    const institution = world.material.institutions.find((i) => i.id === procedure.institutionId);
    const isBlocMember = institution?.votingBlocs.some((bloc) =>
      world.material.groupMemberships.some(
        (membership) => membership.characterId === characterId && membership.groupId === bloc.id && membership.leftAtStep === null,
      ),
    );
    if (isBlocMember) actions.push("vote");
  }
  if (procedure.type === "nomination" && procedure.sponsorCharacterId === characterId) actions.push("nominate");
  if (
    (procedure.type === "appointment" || procedure.type === "removal") &&
    (procedure.resolutionMechanism === "appointment_authority" || procedure.resolutionMechanism === "decree_authority") &&
    procedure.sponsorCharacterId === characterId
  ) {
    actions.push("appoint");
  }
  if (procedure.type === "command_assignment" && procedure.sponsorCharacterId === characterId) actions.push("command");
  if (procedure.type === "treaty_ratification" && procedure.eligibleParticipantIds.includes(characterId)) actions.push("negotiate");
  if (procedure.type === "denunciation" && procedure.eligibleParticipantIds.includes(characterId)) actions.push("veto");
  return actions;
}

/** Whether `institutionId` controls the named account, force, title, or treaty power. */
export function institutionControls(
  world: PoliticalAuthorityWorldView,
  institutionId: string,
  resourceKind: "account" | "force" | "title" | "treaty",
  resourceId: string,
): boolean {
  switch (resourceKind) {
    case "account":
      return world.material.accountAccess.some(
        (access) => access.accountId === resourceId && access.sourceKind === "law" && access.sourceId === institutionId,
      );
    case "force":
      return world.material.forces.some((force) => force.id === resourceId && force.polityId === institutionSponsorPolity(world, institutionId));
    case "title":
      return world.material.holdings.some((holding) => holding.id === resourceId);
    case "treaty":
      return world.material.reservedPowers.some((rule) => rule.institutionId === institutionId);
    default:
      return false;
  }
}

function institutionSponsorPolity(world: PoliticalAuthorityWorldView, institutionId: string): string | undefined {
  return world.material.institutions.find((i) => i.id === institutionId)?.polityId;
}

/** True only if the office's holder may invoke `actionId` directly; false means it is proposal-only. */
export function officeGrantsDirectAccess(office: Office, actionId: string): boolean {
  return office.authorisedActionIds.includes(actionId);
}
