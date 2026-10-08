import type { BlocInterest, PoliticalGroup, GroupMembership, WorldState } from "@chronica/shared";

/**
 * The parties a scenario authors, as data (docs/plans/government.md, "Offices and data gaps closed").
 *
 * Carthage has none at 270 and this is deliberate: the sources for a party of Hanno the Great or of the Barcids are of the 240s and after (Hamilcar Barca,
 * b. about 275, is a child at the opening), and a party made up for 270 would be an invention put where the evidence is thin (confidence: that there were
 * factions in the Council as in any oligarchy, high; who led them in 270, none). The world still makes its own, as it does in Rome, from men who keep declaring
 * together (`sim/society.ts`, `factions`). What there is here is the place for a later scenario (the 240s, 218) to author them: a list of `AuthoredFaction`, turned into
 * groups with members by `withAuthoredFactions`. The 270 list is empty.
 */
export interface AuthoredFaction {
  /** A stable id for the group: "faction-barcid". */
  readonly id: string;
  readonly name: string;
  readonly polityId: string;
  readonly leaderCharacterId: string;
  readonly memberCharacterIds: readonly string[];
  /** What it stands for, in the words of the age. */
  readonly platform: readonly string[];
  /** What it wants, for the bloc it takes in a chamber. */
  readonly interest: BlocInterest;
  /** How much it weighs, 0 to 10,000. */
  readonly strengthBps: number;
}

/** Carthage's parties at 270: none authored (see above). */
export const CARTHAGE_FACTIONS_270: readonly AuthoredFaction[] = [];

/** The factions authored for the opening of this scenario. */
export const AUTHORED_FACTIONS_270: readonly AuthoredFaction[] = [...CARTHAGE_FACTIONS_270];

/** The groups and memberships a list of authored factions makes; a member or leader who is not in the world is left out. */
export function groupsOfFactions(world: Pick<WorldState, "characters">, factions: readonly AuthoredFaction[], atStep: number): { groups: PoliticalGroup[]; memberships: GroupMembership[] } {
  const living = new Set(world.characters.map((character) => character.id));
  const groups: PoliticalGroup[] = [];
  const memberships: GroupMembership[] = [];
  for (const faction of factions) {
    if (!living.has(faction.leaderCharacterId)) continue;
    groups.push({
      id: faction.id, name: faction.name, polityId: faction.polityId, type: "faction", leaderCharacterId: faction.leaderCharacterId, platform: [...faction.platform],
      resourceAccountId: null, publicReputationBps: 5_000, active: true, emergentKey: null, strengthBps: faction.strengthBps, interest: faction.interest, foundedAtStep: atStep, endedAtStep: null,
    });
    for (const characterId of [...new Set([faction.leaderCharacterId, ...faction.memberCharacterIds])].filter((id) => living.has(id))) {
      memberships.push({
        characterId, groupId: faction.id, role: characterId === faction.leaderCharacterId ? "leader" : "follower", influenceBps: characterId === faction.leaderCharacterId ? 8_000 : 3_000,
        loyaltyBps: 60, visibility: "public", joinedAtStep: atStep, leftAtStep: null, joinProvenanceEventId: null, leaveProvenanceEventId: null,
      });
    }
  }
  return { groups, memberships };
}

/** The world with its authored factions in it: unchanged where there are none. */
export function withAuthoredFactions(world: WorldState, factions: readonly AuthoredFaction[] = AUTHORED_FACTIONS_270): WorldState {
  if (factions.length === 0) return world;
  const made = groupsOfFactions(world, factions, world.elapsedStep);
  const known = new Set(world.material.politicalGroups.map((group) => group.id));
  const groups = made.groups.filter((group) => !known.has(group.id));
  if (groups.length === 0) return world;
  const ids = new Set(groups.map((group) => group.id));
  return {
    ...world,
    material: {
      ...world.material,
      politicalGroups: [...world.material.politicalGroups, ...groups],
      groupMemberships: [...world.material.groupMemberships, ...made.memberships.filter((membership) => ids.has(membership.groupId))],
    },
  };
}
