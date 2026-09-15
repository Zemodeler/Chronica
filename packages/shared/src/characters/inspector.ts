import type { Character, RelationDimension } from "./character";
import type { SocialLink } from "./relationship-dimensions";
import { deriveRelationDimension, listSocialLinks, strongestCauses } from "./relationship-dimensions";
import { resolveTraits, type TraitDefinition } from "./traits";
import { getActivePressures, type CharacterPressure } from "./pressures";
import { queryBeliefs, type CharacterBelief } from "./beliefs";
import type { ContinuityTier } from "../continuity/continuity";
import type { Commitment } from "./commitments";
import type { CharacterIntent } from "./intents";

// A structured, developer-facing view of everything canonical known about one
// character (character-sim phase 2). Never rendered in ordinary player UI --
// intended for an admin-gated diagnostics route, so "why did this character
// respond this way" has one place to look: identity, mind, pressures,
// relationships (with their strongest causes), beliefs, commitments, and
// continuity tier.

const DIMENSIONS: readonly RelationDimension[] = ["trust", "affection", "fear", "respect", "obligation", "reputation"];

export interface InspectorRelationshipTie {
  readonly targetCharacterId: string;
  readonly dimensions: Readonly<Record<RelationDimension, number>>;
  readonly strongestCauseLabels: readonly string[];
  readonly socialLinkKinds: readonly SocialLink["kind"][];
}

export interface InspectorCommitment {
  readonly id: string;
  readonly promiseType: string;
  readonly promisedResult: string;
  readonly status: string;
}

export interface CharacterInspectorView {
  readonly characterId: string;
  readonly name: string;
  readonly alive: boolean;
  readonly locationProvinceId: string;
  readonly polityId: string | null;
  readonly officeId: string | null;
  readonly mind: Character["mind"];
  readonly traits: readonly TraitDefinition[];
  readonly activePressures: readonly CharacterPressure[];
  readonly relationships: readonly InspectorRelationshipTie[];
  readonly beliefs: readonly CharacterBelief[];
  /** Legacy DB-sourced commitments, kept for backward-compat with saves predating character-sim phase 3. */
  readonly commitments: readonly InspectorCommitment[];
  /** Canonical, replayable commitments (character-sim phase 3) -- the resolver's own authority/resource-checked ledger. */
  readonly canonicalCommitments: readonly Commitment[];
  /** This character's recent intents: what they chose, why, and how each was ultimately resolved. */
  readonly recentIntents: readonly CharacterIntent[];
  readonly continuityTier: ContinuityTier | null;
}

export interface InspectorWorldView {
  readonly characters: readonly Character[];
  readonly characterPressures: readonly CharacterPressure[];
  readonly characterBeliefs: readonly CharacterBelief[];
  readonly socialLinks: readonly SocialLink[];
  readonly continuity: readonly { readonly characterId: string; readonly tier: ContinuityTier }[];
  readonly commitments?: readonly Commitment[];
  readonly characterIntents?: readonly CharacterIntent[];
}

export function buildCharacterInspectorView(
  world: InspectorWorldView,
  characterId: string,
  pendingCommitments: readonly { id: string; npcCharacterId: string; promiseType: string; promisedResult: string; status: string }[] = [],
): CharacterInspectorView | undefined {
  const character = world.characters.find((c) => c.id === characterId);
  if (character === undefined) return undefined;

  const links = listSocialLinks(world, characterId);
  const tieTargets = new Set<string>();
  for (const relation of character.relations) tieTargets.add(relation.subjectCharacterId);
  for (const link of links) tieTargets.add(link.subjectCharacterId === characterId ? link.targetCharacterId : link.subjectCharacterId);

  const relationships: InspectorRelationshipTie[] = [...tieTargets].map((targetCharacterId) => {
    const dimensions = Object.fromEntries(
      DIMENSIONS.map((dimension) => [dimension, deriveRelationDimension(character, targetCharacterId, dimension)]),
    ) as Record<RelationDimension, number>;
    const strongestLabels = DIMENSIONS.flatMap((dimension) => strongestCauses(character, targetCharacterId, dimension, 1).map((c) => c.label));
    const kinds = links
      .filter((l) => l.subjectCharacterId === targetCharacterId || l.targetCharacterId === targetCharacterId)
      .map((l) => l.kind);
    return { targetCharacterId, dimensions, strongestCauseLabels: [...new Set(strongestLabels)], socialLinkKinds: kinds };
  });

  return {
    characterId: character.id,
    name: character.name,
    alive: character.alive,
    locationProvinceId: character.locationProvinceId,
    polityId: character.polityId,
    officeId: character.officeId,
    mind: character.mind,
    traits: resolveTraits(character.traits),
    activePressures: getActivePressures(world, characterId),
    relationships,
    beliefs: queryBeliefs(world, characterId),
    commitments: pendingCommitments
      .filter((c) => c.npcCharacterId === characterId)
      .map((c) => ({ id: c.id, promiseType: c.promiseType, promisedResult: c.promisedResult, status: c.status })),
    canonicalCommitments: (world.commitments ?? []).filter((c) => c.promisorCharacterId === characterId || c.beneficiaryCharacterId === characterId),
    recentIntents: (world.characterIntents ?? []).filter((i) => i.actorCharacterId === characterId),
    continuityTier: world.continuity.find((c) => c.characterId === characterId)?.tier ?? null,
  };
}
