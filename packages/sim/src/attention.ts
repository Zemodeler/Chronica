import {
  buildAuthorityIndex,
  factsVisibleTo,
  stableHash,
  type Fact,
  type Office,
  type OrderPartyRef,
  type WorldState,
} from "@chronica/shared";

/**
 * The attention router (VISION §18, §19).
 *
 * The engine must not call the model once per NPC. An event generates signals,
 * and this decides who plausibly (1) could know, (2) would care, (3) has enough
 * agency to respond, and (4) actually needs model cognition -- narrowing
 * thousands of people to a handful.
 *
 * It is entirely deterministic and costs nothing. That is the point: a router
 * that itself asked the model "who should react?" would answer "everyone
 * interesting" and defeat its own purpose.
 *
 * Activity level (§19) is derived per burst rather than stored. Importance here
 * is emergent from what a character is currently entangled in, so recomputing it
 * is both cheap and more truthful than a field that has to be maintained.
 */

export type ActivityLevel = "dormant" | "relevant" | "active" | "focused";

export interface RoutedActor {
  readonly ref: OrderPartyRef;
  readonly characterId: string;
  readonly name: string;
  readonly level: ActivityLevel;
  readonly score: number;
  /** The facts this actor can actually see -- what their cognition prompt is built from. */
  readonly knownFacts: readonly Fact[];
  readonly why: string;
}

export interface AttentionResult {
  readonly focused: readonly RoutedActor[];
  readonly active: readonly RoutedActor[];
  readonly relevantCount: number;
  readonly dormantCount: number;
}

export interface AttentionInput {
  readonly world: WorldState;
  readonly facts: readonly Fact[];
  readonly offices: readonly Office[];
  /** Never wakes the player's own character: the player speaks for themselves. */
  readonly excludeCharacterIds: readonly string[];
  readonly maxFocused: number;
  readonly maxCausalDepth: number;
}

export function routeAttention(input: AttentionInput): AttentionResult {
  const { world } = input;
  const excluded = new Set(input.excludeCharacterIds);

  // Gate 0: a fact can only wake someone if it is inside the causal horizon
  // (VISION §21 -- otherwise every reaction breeds another forever) and if its
  // news has actually arrived. `factsVisibleTo` treats every public fact as
  // visible the instant it exists, which is right for "is this a secret" and
  // wrong for "has word reached Carthage yet"; `knowableAtInstant` is what
  // carries the travel time the model asked for (VISION §16).
  const nowKey = world.instant.day * 1440 + world.instant.minute;
  const triggering = input.facts.filter((fact) => {
    if (fact.causalDepth >= input.maxCausalDepth) return false;
    const knowableAt = fact.discovery.knowableAtInstant;
    if (knowableAt === null) return true;
    return knowableAt.day * 1440 + knowableAt.minute <= nowKey;
  });
  if (triggering.length === 0) return { focused: [], active: [], relevantCount: 0, dormantCount: world.characters.length };

  const authority = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    input.offices,
    world.elapsedStep,
  );
  const holdsAuthority = new Set(authority.grants.map((grant) => grant.holder.id));
  const affectedIds = new Set(triggering.flatMap((fact) => fact.affectedEntities.map((entity) => entity.id)));
  const affectedPolities = new Set(
    triggering.flatMap((fact) => fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id)),
  );
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));

  const scored: RoutedActor[] = [];
  let dormantCount = 0;

  for (const character of world.characters) {
    if (!character.alive || excluded.has(character.id)) {
      dormantCount += 1;
      continue;
    }

    const ref: OrderPartyRef = { kind: "character", id: character.id };

    // Gate 1: could they know? This is the epistemic wall -- a secret nobody
    // has discovered cannot pull anyone into cognition (VISION §14).
    const knownFacts = factsVisibleTo(triggering, ref, world.instant);
    if (knownFacts.length === 0) {
      dormantCount += 1;
      continue;
    }

    // Gate 2: would they care?
    const reasons: string[] = [];
    let score = 0;
    for (const fact of knownFacts) score += fact.causalDepth === 0 ? 10 : 5;

    if (affectedIds.has(character.id)) {
      score += 40;
      reasons.push("directly affected");
    }
    if (character.polityId !== null && affectedPolities.has(character.polityId)) {
      score += 20;
      reasons.push("their polity is involved");
    }
    const pressures = world.characterPressures.filter((pressure) => pressure.characterId === character.id && pressure.status === "active");
    if (pressures.length > 0) {
      score += 10 * pressures.length;
      reasons.push(`${pressures.length} live pressure(s)`);
    }
    const commitments = world.commitments.filter(
      (commitment) =>
        (commitment.status === "pending" || commitment.status === "prepared" || commitment.status === "deferred") &&
        (commitment.promisorCharacterId === character.id || commitment.beneficiaryCharacterId === character.id),
    );
    if (commitments.length > 0) {
      score += 8 * commitments.length;
      reasons.push(`${commitments.length} open commitment(s)`);
    }
    if (world.orderAttempts.some((attempt) => attempt.recipientRef.id === character.id && (attempt.status === "issued" || attempt.status === "received"))) {
      score += 35;
      reasons.push("owes an answer to an order");
    }

    // Gate 3: could they do anything about it? Someone with no office, no
    // command and no standing grant may care deeply and still not be a
    // strategic actor.
    const hasAgency = holdsAuthority.has(character.id) || character.officeId !== null || commanders.has(character.id);
    if (hasAgency) {
      score += 25;
      reasons.push("holds authority");
    }

    if (score < 30) {
      dormantCount += 1;
      continue;
    }
    scored.push({
      ref,
      characterId: character.id,
      name: character.name,
      level: "relevant",
      score,
      knownFacts,
      why: reasons.join(", "),
    });
  }

  // Deterministic ordering: score first, then a stable hash, never insertion
  // order -- a replay must select the same people for the same reasons.
  scored.sort((a, b) => b.score - a.score || stableHash([a.characterId]) - stableHash([b.characterId]));

  // The focus bar is set at the score of someone who can know about an event,
  // has reason to care, and holds the authority to do something about it
  // (10 + 20 + 25). That is precisely the person worth spending cognition on;
  // a higher bar meant an ordinary public event woke nobody at all, which made
  // the whole router moot. `maxFocused` is what actually bounds the cost.
  const FOCUS_SCORE = 50;
  const ACTIVE_SCORE = 35;

  const focused = scored.filter((actor) => actor.score >= FOCUS_SCORE).slice(0, input.maxFocused).map((actor) => ({ ...actor, level: "focused" as const }));
  const focusedIds = new Set(focused.map((actor) => actor.characterId));
  const active = scored.filter((actor) => !focusedIds.has(actor.characterId) && actor.score >= ACTIVE_SCORE).map((actor) => ({ ...actor, level: "active" as const }));

  return {
    focused,
    active,
    relevantCount: scored.length - focused.length - active.length,
    dormantCount,
  };
}
