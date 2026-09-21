import {
  allOffices,
  buildAuthorityIndex,
  factsKnownTo,
  openStorylines,
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

/**
 * Why this person is being thought for.
 *
 * A reactor has just heard something and is answering it; someone on their own
 * business has not, and was chosen because they have something of their own
 * under way. Cognition must be told which, or the world elsewhere is asked to
 * react to news it never received and sensibly answers that it will do nothing.
 */
export type Impetus = "reaction" | "own_business";

export interface RoutedActor {
  readonly ref: OrderPartyRef;
  readonly characterId: string;
  readonly name: string;
  readonly level: ActivityLevel;
  readonly impetus: Impetus;
  readonly score: number;
  /** The facts this actor can actually see -- what their cognition prompt is built from. */
  readonly knownFacts: readonly Fact[];
  readonly why: string;
  /**
   * Something true about this person's situation that the router did not work
   * out, appended to their own section of the prompt. Used for the one thing
   * the world knows and the router has no business knowing: where the ruler's
   * antagonist stands this season.
   */
  readonly note?: string | undefined;
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
    allOffices(world, input.offices),
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
    const knownFacts = factsKnownTo(triggering, ref, character.polityId, world.instant);
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
    // A letter put to them, or to their government, and not yet answered. After
    // an unanswered order this is the likeliest reason in the world to want to
    // act -- and an unanswered letter is itself an answer, so leaving them
    // dormant decides the matter by silence.
    if (world.diplomacy.some(
      (message) =>
        message.status === "awaiting_reply" &&
        (message.toCharacterId === character.id || (message.toCharacterId === null && character.polityId !== null && message.toPolityId === character.polityId)),
    )) {
      score += 30;
      reasons.push("owes an answer to a letter");
    }

    // Something they have found out that somebody did without the authority to
    // do it. Recent only: without the window the same official is woken by the
    // same scandal every burst for a year, which is how a consequence becomes
    // a nuisance.
    if (knownFacts.some(
      (fact) => fact.kind === "authority_breach"
        && fact.discovery.discoveredBy.some(
          (entry) => entry.observerRef.id === character.id && world.elapsedStep - entry.atInstant.day <= 14,
        ),
    )) {
      score += 30;
      reasons.push("has come upon an irregularity");
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
      impetus: "reaction",
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

export interface AmbientInput {
  readonly world: WorldState;
  /** Recent history, for the context an ambient actor reasons from. */
  readonly facts: readonly Fact[];
  readonly offices: readonly Office[];
  readonly excludeCharacterIds: readonly string[];
  readonly max: number;
  /** How many of their own facts to carry into the prompt. */
  readonly maxFactsEach?: number;
  /**
   * Someone who must be asked this round whatever their score: the person the
   * narrator has just handed a problem to. One slot, so the seed actually moves
   * in the burst that planted it rather than waiting on the rotation.
   */
  readonly priorityCharacterIds?: readonly string[];
  /**
   * The ruler's antagonist, who is asked every round whatever the week's facts
   * happen to say.
   *
   * This is the one standing exception to a router that is otherwise fair, and
   * it exists because fairness was the problem: a man working against the
   * ruler for two years was heard only in the weeks he happened to score, so
   * a reign read as unrelated difficulties rather than as a struggle with
   * somebody. He is not told he is anybody's nemesis -- he is simply always in
   * the room, and his own thread is in his section like anyone else's.
   */
  readonly nemesisCharacterId?: string | null | undefined;
}

/**
 * Who is getting on with their own business, whatever the player just did.
 *
 * `routeAttention` is purely reactive: gate 0 needs a triggering fact and gate 1
 * needs the actor to know it, so anyone with no connection to the player's order
 * scores nothing and stays dormant. That is correct for reactions and fatal as
 * the whole of the world's agency -- it meant Syracuse never moved on Messana,
 * Carthage never negotiated with anyone, and every Chronicle was one thread
 * about the player because the player was the only person doing anything.
 *
 * This is the other half: a small, rotating cast chosen from their *own*
 * standing business -- an office to run, a promise outstanding, a pressure on
 * them, a storyline they are part of, a government with stated intentions.
 * It costs no extra model call. Cognition is batched, so these people ride
 * along in the call the reactors were already making; only the prompt grows.
 */
export function routeAmbientActors(input: AmbientInput): RoutedActor[] {
  const { world } = input;
  const excluded = new Set(input.excludeCharacterIds);
  const authority = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    allOffices(world, input.offices),
    world.elapsedStep,
  );
  const holdsAuthority = new Set(authority.grants.map((grant) => grant.holder.id));
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));
  // The most recently moved thread each person is in, so the reason they are
  // asked says what is actually pending rather than that something is.
  const threadOf = new Map<string, WorldState["storylines"][number]>();
  for (const storyline of openStorylines(world.storylines).sort((a, b) => a.updatedAtStep - b.updatedAtStep)) {
    for (const participantId of storyline.participantIds) threadOf.set(participantId, storyline);
  }
  const priority = new Set(input.priorityCharacterIds ?? []);
  const polityHasAims = new Set(
    world.polityOutlooks.filter((outlook) => outlook.intentions.length > 0 || outlook.concerns.length > 0).map((outlook) => outlook.polityId),
  );

  const scored: RoutedActor[] = [];
  for (const character of world.characters) {
    if (!character.alive || excluded.has(character.id)) continue;

    const reasons: string[] = [];
    let score = 0;
    if (holdsAuthority.has(character.id) || character.officeId !== null || commanders.has(character.id)) {
      score += 25;
      reasons.push("has a command or an office to run");
    }
    const pressures = world.characterPressures.filter((pressure) => pressure.characterId === character.id && pressure.status === "active");
    if (pressures.length > 0) {
      score += Math.min(30, 10 * pressures.length);
      reasons.push(pressures[0]!.label);
    }
    const commitments = world.commitments.filter(
      (commitment) =>
        (commitment.status === "pending" || commitment.status === "prepared" || commitment.status === "deferred") &&
        commitment.promisorCharacterId === character.id,
    );
    if (commitments.length > 0) {
      score += Math.min(24, 8 * commitments.length);
      reasons.push("has a promise still to keep");
    }
    const thread = threadOf.get(character.id);
    if (thread !== undefined) {
      score += thread.phase === "escalating" || thread.phase === "crisis" ? 20 : 12;
      reasons.push(`is caught up in ${thread.title}: ${thread.nextDevelopment}`);
    }
    // Somebody has asked them to do something and is waiting. The ambient
    // router had no clause for this at all, so an officeless, threadless
    // quartermaster who had just been given an order scored nothing in either
    // router and could never answer it -- which made "an order is always
    // answered" unreachable for exactly the people orders are given to.
    if (world.orderAttempts.some(
      (attempt) => attempt.recipientRef.id === character.id
        && (attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed"),
    )) {
      score += 32;
      reasons.push("has an order to answer");
    }
    if (world.diplomacy.some(
      (message) =>
        message.status === "awaiting_reply" &&
        (message.toCharacterId === character.id || (message.toCharacterId === null && character.polityId !== null && message.toPolityId === character.polityId)),
    )) {
      score += 28;
      reasons.push("has a letter to answer");
    }
    if (priority.has(character.id)) reasons.unshift("something has just come to them");
    // Always worth hearing, and never told why. The reason given is the true
    // one a man would give himself: he has something of his own running.
    if (character.id === input.nemesisCharacterId) {
      score += 40;
      reasons.unshift("has a matter of their own that will not keep");
    }
    if (character.polityId !== null && polityHasAims.has(character.polityId)) {
      score += 15;
      reasons.push("their government is pursuing something");
    }
    if (score === 0) continue;

    // Rotation, so the world elsewhere is not the same two people every time.
    // Bucketed by week and stable within it: a replay picks the same cast.
    score += stableHash([character.id, String(Math.floor(world.instant.day / 7))]) % 12;

    scored.push({
      ref: { kind: "character", id: character.id },
      characterId: character.id,
      name: character.name,
      level: "focused",
      impetus: "own_business",
      score,
      knownFacts: factsKnownTo(input.facts, { kind: "character", id: character.id }, character.polityId, world.instant).slice(-(input.maxFactsEach ?? 6)),
      why: reasons.join(", "),
    });
  }

  scored.sort((a, b) => b.score - a.score || stableHash([a.characterId]) - stableHash([b.characterId]));
  // The antagonist first, then whoever the narrator has just handed something
  // to, then the rotation. Both are reservations against the same cast size:
  // a busy week must not be the reason the quarrel goes quiet.
  const antagonist = scored.filter((actor) => actor.characterId === input.nemesisCharacterId).slice(0, 1);
  const reserved = scored.filter((actor) => priority.has(actor.characterId) && !antagonist.includes(actor)).slice(0, 1);
  const held = [...antagonist, ...reserved];
  const rest = scored.filter((actor) => !held.includes(actor)).slice(0, Math.max(0, input.max - held.length));
  return [...held, ...rest];
}
