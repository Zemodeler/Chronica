import { classifyLifeStage, currentAgeYears, lifeStatus, type LifeStage, type LifeStatus } from "./age";
import { familyLinksOf, type FamilyLink, type FamilyLinkView, type Household } from "./family";
import { findPlayerSuccessors } from "./inheritance";
import type { Character } from "./character";
import type { Estate, InheritanceRule, InheritanceTransfer, MaterialWorldState } from "../material-state";
import type { LegacyCause } from "../continuity/continuity";

// Life inspector (character-sim phase 5).
//
// A structured, developer-facing view of one character's life state: derived
// age/life stage/status, family/household graph, estate and inheritance
// trace, legacy-cause provenance, and (always computed, not gated on "is this
// the player") the canonical successor list if this character were to die
// today. Never rendered in ordinary player UI -- the player-facing account of
// the same events is the Chronicle's public `lifeEvent` fact, which
// deliberately omits everything private this view exposes.

export interface LifeInspectorView {
  readonly characterId: string;
  readonly name: string;
  readonly alive: boolean;
  readonly ageYears: number | null;
  readonly lifeStage: LifeStage | null;
  readonly status: LifeStatus;
  readonly familyLinks: readonly FamilyLinkView[];
  readonly household: Household | null;
  readonly estate: Estate | null;
  readonly estateInheritanceRule: InheritanceRule | null;
  readonly inheritanceTransfersAsDeceased: readonly InheritanceTransfer[];
  readonly legacyCausesAsPredecessor: readonly LegacyCause[];
  readonly legacyCausesAsSuccessor: readonly LegacyCause[];
  readonly successorCandidatesIfDeceasedToday: readonly string[];
}

export function buildLifeInspectorView(
  world: {
    readonly characters: readonly Character[];
    readonly material: MaterialWorldState;
    readonly familyLinks: readonly FamilyLink[];
    readonly households: readonly Household[];
    readonly legacyCauses: readonly LegacyCause[];
    readonly elapsedStep: number;
  },
  characterId: string,
  scenario?: { readonly lifeStages: readonly LifeStage[] },
): LifeInspectorView | undefined {
  const character = world.characters.find((c) => c.id === characterId);
  if (character === undefined) return undefined;

  // Age no longer needs the scenario: a step is a day, so it derives from the
  // clock alone. The scenario is still what names the life stages.
  const ageYears = currentAgeYears(character, world.elapsedStep);
  const lifeStage = scenario !== undefined ? classifyLifeStage(ageYears, scenario.lifeStages) ?? null : null;

  const household = world.households.find((h) => h.headCharacterId === characterId) ?? null;
  const estate = world.material.estates.find((e) => e.ownerCharacterId === characterId) ?? null;
  const estateInheritanceRule = estate ? world.material.inheritanceRules.find((r) => r.id === estate.inheritanceRuleId) ?? null : null;

  return {
    characterId: character.id,
    name: character.name,
    alive: character.alive,
    ageYears,
    lifeStage,
    status: lifeStatus(character),
    familyLinks: familyLinksOf(world, characterId),
    household,
    estate,
    estateInheritanceRule,
    inheritanceTransfersAsDeceased: world.material.inheritanceTransfers.filter((t) => t.deceasedCharacterId === characterId),
    legacyCausesAsPredecessor: world.legacyCauses.filter((c) => c.predecessorCharacterId === characterId),
    legacyCausesAsSuccessor: world.legacyCauses.filter((c) => c.successorCharacterId === characterId),
    successorCandidatesIfDeceasedToday:
      findPlayerSuccessors(world, characterId, world.elapsedStep),
  };
}
