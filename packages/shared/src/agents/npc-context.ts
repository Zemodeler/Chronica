import type { Character } from "../characters/character";
import { listSocialLinks, type SocialLink } from "../characters/relationship-dimensions";
import type { CharacterGoal, CharacterPlot } from "../character-agency/schemas";
import type { CharacterPressure } from "../characters/pressures";
import type { CharacterBelief } from "../characters/beliefs";
import type { Commitment } from "../character-agency/commitments";
import type { AuthorityGrant, AuthorityIndex } from "../authority/authority-grant";
import type { OrderAttempt } from "../authority/order-attempt";
import type { Fact } from "../world/facts";
import { factsVisibleTo } from "../world/facts";
import type { WorldInstant } from "../world/instant";
import type { WorldState } from "../world/world-state";

/**
 * A hard allowlist of what one NPC agent (docs/32, Part B.4) is given: its own
 * goals/beliefs/pressures/plots/commitments/relationships, its own standing
 * authority, orders addressed to it this turn, and only the Facts visible to
 * this specific observer -- never a blanket world dump. This is the mechanism
 * that keeps a soldier's agent from reasoning off a rival polity's private
 * conspiracy it has no way to know about.
 */
export interface NpcAgentContext {
  readonly character: Character;
  readonly goals: readonly CharacterGoal[];
  readonly plots: readonly CharacterPlot[];
  readonly pressures: readonly CharacterPressure[];
  readonly beliefs: readonly CharacterBelief[];
  readonly commitments: readonly Commitment[];
  readonly relationships: readonly SocialLink[];
  readonly ownAuthorityGrants: readonly AuthorityGrant[];
  /** Orders/petitions naming this character as recipient, still awaiting their decision. */
  readonly pendingOrders: readonly OrderAttempt[];
  readonly visibleFacts: readonly Fact[];
}

/** Everything `buildNpcAgentContext` reads from `WorldState`, named explicitly so the allowlist is visible at the call site. */
export interface NpcAgentContextSource {
  readonly characters: readonly Character[];
  readonly characterGoals: readonly CharacterGoal[];
  readonly characterPlots: readonly CharacterPlot[];
  readonly characterPressures: readonly CharacterPressure[];
  readonly characterBeliefs: readonly CharacterBelief[];
  readonly commitments: readonly Commitment[];
  readonly socialLinks: readonly SocialLink[];
  readonly orderAttempts: readonly OrderAttempt[];
}

export function buildNpcAgentContext(
  world: Pick<WorldState, keyof NpcAgentContextSource> | NpcAgentContextSource,
  characterId: string,
  authorityIndex: AuthorityIndex,
  facts: readonly Fact[],
  atInstant: WorldInstant,
): NpcAgentContext | undefined {
  const character = world.characters.find((c) => c.id === characterId);
  if (character === undefined) return undefined;

  const observer = { kind: "character" as const, id: characterId };
  return {
    character,
    goals: world.characterGoals.filter((goal) => goal.characterId === characterId && goal.status === "active"),
    plots: world.characterPlots.filter((plot) => plot.characterId === characterId && plot.status === "active"),
    pressures: world.characterPressures.filter((pressure) => pressure.characterId === characterId && pressure.status === "active"),
    beliefs: world.characterBeliefs.filter((belief) => belief.holderCharacterId === characterId),
    commitments: world.commitments.filter(
      (commitment) => (commitment.promisorCharacterId === characterId || commitment.beneficiaryCharacterId === characterId) && commitment.status === "pending",
    ),
    relationships: listSocialLinks({ socialLinks: world.socialLinks }, characterId),
    ownAuthorityGrants: authorityIndex.grants.filter((grant) => grant.holder.kind === "character" && grant.holder.id === characterId),
    pendingOrders: world.orderAttempts.filter(
      (attempt) => attempt.recipientRef.kind === "character" && attempt.recipientRef.id === characterId && !isDecided(attempt),
    ),
    visibleFacts: factsVisibleTo(facts, observer, atInstant),
  };
}

function isDecided(attempt: OrderAttempt): boolean {
  return attempt.status !== "issued" && attempt.status !== "received";
}
