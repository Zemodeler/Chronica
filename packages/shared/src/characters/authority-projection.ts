import { lifeStatus } from "./age";
import { familyLinksOf, type FamilyLink } from "./family";
import { canParticipate, type PoliticalAuthorityAction } from "./political-authority";
import type { Character } from "./character";
import type { MaterialWorldState } from "../material-state";
import type { ScenarioGovernmentRules } from "./character";

// Canonical Authority projection (character-sim phase 6).
//
// Pure, deterministic, no AI: replaces the free-text, AI-generated
// `knowledgebase.authority` as the source of the personal screen's Authority
// field. Every label traces to already-canonical Phase 4/5 state -- offices,
// institution membership, open-procedure rights, force command, guardianship
// -- so nothing here can grant power a workflow did not actually grant.

export interface AuthorityWorldView {
  readonly characters: readonly Character[];
  readonly material: MaterialWorldState;
  readonly familyLinks: readonly FamilyLink[];
  readonly map: { readonly polities: readonly { readonly id: string; readonly name: string }[] };
}

const MAX_AUTHORITY_LABELS = 8;

const ACTION_LABELS: Record<PoliticalAuthorityAction, string> = {
  vote: "Eligible voter",
  nominate: "Eligible to nominate",
  appoint: "Appointing authority",
  veto: "Eligible to denounce",
  command: "Sponsor of command assignment",
  negotiate: "Eligible negotiator",
};

function polityName(world: AuthorityWorldView, polityId: string | null): string | null {
  if (polityId === null) return null;
  return world.map.polities.find((polity) => polity.id === polityId)?.name ?? null;
}

function actionLabel(action: PoliticalAuthorityAction, institutionName: string | null): string {
  const base = ACTION_LABELS[action];
  return institutionName ? `${base} in the ${institutionName}` : base;
}

/** Ordered, capped, human-readable labels for what `characterId` can presently and visibly exercise. */
export function deriveAuthoritySummary(
  world: AuthorityWorldView,
  characterId: string,
  scenarioGovernment?: ScenarioGovernmentRules,
): readonly string[] {
  const character = world.characters.find((c) => c.id === characterId);
  if (character === undefined) return ["No current public office"];

  const status = lifeStatus(character);
  if (status === "deceased") return ["Deceased"];

  const labels: string[] = [];
  if (status === "captured") labels.push("Held captive");
  else if (status === "incapacitated") labels.push("Incapacitated");
  else if (status === "retired") labels.push("Retired from public life");
  else if (status === "unavailable") labels.push("Currently unavailable");

  for (const seat of world.material.officeSeats) {
    if (seat.holderCharacterId !== characterId || seat.status !== "held") continue;
    const office = scenarioGovernment?.offices.find((candidate) => candidate.id === seat.officeId);
    if (office === undefined) continue;
    const polity = polityName(world, office.polityId);
    labels.push(polity ? `${office.label} of ${polity}` : office.label);
  }

  for (const membership of world.material.groupMemberships) {
    if (membership.characterId !== characterId || membership.leftAtStep !== null) continue;
    const group = world.material.politicalGroups.find((candidate) => candidate.id === membership.groupId);
    if (group !== undefined) labels.push(`${membership.role} of ${group.name}`);
  }

  for (const procedure of world.material.politicalProcedures) {
    if (procedure.resolvedAtStep !== null) continue;
    const actions = canParticipate(world, characterId, procedure);
    if (actions.length === 0) continue;
    const institution = procedure.institutionId
      ? world.material.institutions.find((candidate) => candidate.id === procedure.institutionId)
      : undefined;
    for (const action of actions) labels.push(actionLabel(action, institution?.name ?? null));
  }

  for (const force of world.material.forces) {
    if (force.commanderCharacterId === characterId) labels.push(`Command of the ${force.name}`);
  }

  for (const view of familyLinksOf(world, characterId)) {
    if (view.kind !== "guardian") continue;
    const estate = world.material.estates.find((candidate) => candidate.ownerCharacterId === view.counterpartCharacterId);
    if (estate === undefined) continue;
    const ward = world.characters.find((candidate) => candidate.id === view.counterpartCharacterId);
    labels.push(`Guardian of ${ward?.name ?? "a ward"}'s estate`);
  }

  return labels.length > 0 ? labels.slice(0, MAX_AUTHORITY_LABELS) : ["No current public office"];
}
