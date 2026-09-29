import {
  enemiesOf,
  groundToRetake,
  hopsBetween,
  allOffices,
  isOwnPurseGrant,
  buildAuthorityIndex,
  buildStation,
  factsKnownToStation,
  isDelivered,
  openStorylines,
  stableHash,
  type AuthorityIndex,
  type Fact,
  type Office,
  type OrderPartyRef,
  type WorldState,
} from "@chronica/shared";
import { PLAN_SLOTS } from "./plans";

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
   * Whether asking them this round is more than routine: they are reacting to
   * something, were handed a problem by the narrator, are the antagonist, owe
   * an order or a letter an answer, or are in a thread that is escalating. A
   * round in which nobody is pressing is the rotation alone, and a burst pays
   * for only so many of those (`maxAmbientOnlyRounds`).
   */
  readonly pressing: boolean;
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
  /**
   * Facts each person has already been asked about, this burst. The router
   * remembered nothing between rounds, so a man was put in front of the same
   * news every round until the depth ran out -- and "directly affected" by a
   * fact he had written himself, because his own act names him.
   */
  readonly alreadyAnswered?: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  /** Who wrote each fact this burst, by character. Nobody is woken by his own act. */
  readonly authorOf?: ReadonlyMap<string, string> | undefined;
}

export function routeAttention(input: AttentionInput): AttentionResult {
  const { world } = input;
  const excluded = new Set(input.excludeCharacterIds);

  // Gate 0: a fact can only wake someone if it is inside the causal horizon
  // (VISION §21 -- otherwise every reaction breeds another forever). Whether
  // its news has reached them yet is gate 1's: word travels to each person
  // at the pace of the road from where it happened (VISION §16).
  const triggering = input.facts.filter((fact) => fact.causalDepth < input.maxCausalDepth);
  if (triggering.length === 0) return { focused: [], active: [], relevantCount: 0, dormantCount: world.characters.length };

  const authority = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    allOffices(world, input.offices),
    world.elapsedStep,
  );
  const holdsAuthority = new Set(authority.grants.filter((grant) => !isOwnPurseGrant(grant)).map((grant) => grant.holder.id));
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));

  // Nearness. Nothing in the router knew where anybody was or whom they
  // served beside, so a soldier's own centurion was exactly as likely to
  // notice him being wounded as a king across the sea was. The armies a
  // person is in (commanding or in the ranks), and where the news happened.
  const forcesOf = (characterId: string): string[] => world.material.forces
    .filter((force) => force.commanderCharacterId === characterId || force.controllerCharacterId === characterId || force.memberCharacterIds.includes(characterId))
    .map((force) => force.id);
  // What a person's own news touches: who and what it names, the armies in
  // it and the armies of the people in it, and where it happened. Worked out
  // from the news that is new to them, not from the whole round's, so a man
  // is not "directly affected" by what he himself just did.
  const interestOf = (news: readonly Fact[]) => {
    const affectedIds = new Set(news.flatMap((fact) => fact.affectedEntities.map((entity) => entity.id)));
    const affectedPolities = new Set(news.flatMap((fact) => fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id)));
    const affectedForceIds = new Set(world.material.forces.filter((force) => affectedIds.has(force.id)).map((force) => force.id));
    const affectedCharacters = world.characters.filter((character) => affectedIds.has(character.id));
    const comradeForceIds = new Set(affectedCharacters.flatMap((character) => forcesOf(character.id)));
    const wherePlaces = new Set([
      ...world.map.provinces.filter((province) => affectedIds.has(province.id)).map((province) => province.id),
      ...affectedCharacters.map((character) => character.locationProvinceId),
    ]);
    return { affectedIds, affectedPolities, affectedForceIds, comradeForceIds, wherePlaces };
  };

  // The two ends of every venture still trading, by owner.
  const routesOf = new Map<string, string[]>();
  for (const venture of world.material.ventures) {
    if (venture.status !== "running") continue;
    routesOf.set(venture.ownerCharacterId, [...(routesOf.get(venture.ownerCharacterId) ?? []), venture.fromProvinceId, venture.toProvinceId]);
  }

  const scored: RoutedActor[] = [];
  let dormantCount = 0;

  for (const character of world.characters) {
    if (!character.alive || excluded.has(character.id)) {
      dormantCount += 1;
      continue;
    }

    const ref: OrderPartyRef = { kind: "character", id: character.id };

    // Gate 1: could they know? This is the epistemic wall -- a secret nobody
    // has discovered cannot pull anyone into cognition (VISION §14), a
    // government's dispatches reach its people only as far as their station
    // does, and nothing reaches anybody before the road brings it.
    const answered = input.alreadyAnswered?.get(character.id);
    const knownFacts = heardBy(world, input.offices, authority, triggering, character.id)
      .filter((fact) => input.authorOf?.get(fact.id) !== character.id && answered?.has(fact.id) !== true);
    if (knownFacts.length === 0) {
      dormantCount += 1;
      continue;
    }
    const { affectedIds, affectedPolities, affectedForceIds, comradeForceIds, wherePlaces } = interestOf(knownFacts);

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
    const theirForces = forcesOf(character.id);
    if (theirForces.some((forceId) => affectedForceIds.has(forceId))) {
      score += 20;
      reasons.push("their own army is involved");
    } else if (!affectedIds.has(character.id) && theirForces.some((forceId) => comradeForceIds.has(forceId))) {
      score += 25;
      reasons.push("it touches a comrade in the same army");
    }
    if (!affectedIds.has(character.id) && wherePlaces.has(character.locationProvinceId)) {
      score += 15;
      reasons.push("it happened where they are");
    } else if (!affectedIds.has(character.id) && (routesOf.get(character.id) ?? []).some((provinceId) => wherePlaces.has(provinceId))) {
      score += 15;
      reasons.push("it happened where their trade runs");
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
        message.status === "awaiting_reply" && isDelivered(message, world.instant.day) &&
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
      pressing: true,
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
  /**
   * People a step of their own plan wants now (see `plans.ts`), with the
   * sentence they are told. The engine decides when it is time; asking them is
   * how that decision reaches the world. Up to `PLAN_SLOTS` of them are
   * reserved places, taken from the cast rather than added to it.
   */
  readonly dueStepOwners?: ReadonlyMap<string, string> | undefined;
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
/** The nearest enemy army to any army this man commands, within one province. */
function enemyContactOf(world: WorldState, characterId: string): { readonly hops: number; readonly enemy: string } | null {
  const own = world.material.forces.filter((force) => force.commanderCharacterId === characterId);
  let best: { hops: number; enemy: string } | null = null;
  for (const force of own) {
    const enemies = enemiesOf(world.polityAgreements, force.polityId);
    if (enemies.length === 0) continue;
    for (const other of world.material.forces) {
      if (!enemies.includes(other.polityId)) continue;
      const hops = hopsBetween(world, force.locationId, other.locationId, 1);
      if (hops === null || (best !== null && hops >= best.hops)) continue;
      const where = world.map.provinces.find((province) => province.id === other.locationId)?.name ?? other.locationId;
      best = { hops, enemy: `${other.name} at ${where}` };
    }
  }
  return best;
}

/** The nearest lost ground or besieged city of his power his own army can reach in two provinces. */
function woundWithinReach(world: WorldState, characterId: string): { readonly hops: number; readonly why: string } | null {
  const own = world.material.forces.filter((force) => force.commanderCharacterId === characterId);
  if (own.length === 0) return null;
  const polityId = own[0]!.polityId;
  const places = [
    ...groundToRetake(world, polityId).map((lost) => ({ provinceId: lost.provinceId, why: `his power lost ${lost.name} ${lost.daysAgo} days ago` })),
    ...world.sieges.filter((siege) => siege.status === "active" && siege.defenderPolityId === polityId)
      .map((siege) => ({ provinceId: siege.provinceId, why: `a city of his power is under siege in ${world.map.provinces.find((province) => province.id === siege.provinceId)?.name ?? siege.provinceId}` })),
  ];
  let best: { hops: number; why: string } | null = null;
  for (const place of places) {
    for (const force of own) {
      const hops = hopsBetween(world, force.locationId, place.provinceId, 2);
      if (hops !== null && (best === null || hops < best.hops)) best = { hops, why: `${place.why}, and ${force.name} can reach it` };
    }
  }
  return best;
}

export function routeAmbientActors(input: AmbientInput): RoutedActor[] {
  const { world } = input;
  const excluded = new Set(input.excludeCharacterIds);
  const authority = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    allOffices(world, input.offices),
    world.elapsedStep,
  );
  const holdsAuthority = new Set(authority.grants.filter((grant) => !isOwnPurseGrant(grant)).map((grant) => grant.holder.id));
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
    let pressing = false;
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
      if (thread.phase === "escalating" || thread.phase === "crisis") pressing = true;
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
      pressing = true;
      reasons.push("has an order to answer");
    }
    if (world.diplomacy.some(
      (message) =>
        message.status === "awaiting_reply" && isDelivered(message, world.instant.day) &&
        (message.toCharacterId === character.id || (message.toCharacterId === null && character.polityId !== null && message.toPolityId === character.polityId)),
    )) {
      score += 28;
      pressing = true;
      reasons.push("has a letter to answer");
    }
    // Asked because something just landed on them. It counts for itself: a man
    // with no office and no command used to score only because everybody's own
    // purse was counted as authority.
    if (priority.has(character.id)) {
      score += 20;
      pressing = true;
      reasons.unshift("something has just come to them");
    }
    // Always worth hearing, and never told why. The reason given is the true
    // one a man would give himself: he has something of his own running.
    if (character.id === input.nemesisCharacterId) {
      score += 40;
      pressing = true;
      reasons.unshift("has a matter of their own that will not keep");
    }
    // A step of their own plan has come due, or what it waited for has
    // happened, or it passed its day undone. Pressing: that is a round worth
    // paying for, and the step wakes him once for each, never every hop.
    const step = input.dueStepOwners?.get(character.id);
    if (step !== undefined) {
      score += 30;
      pressing = true;
      reasons.unshift(step);
    }
    // An army of theirs at war with somebody close by. Carthage's admiral and
    // the Campanians' leader were each asked because they had "a command to
    // run", never because the enemy was a province away -- being at war scored
    // nothing. The enemy in the same province will not wait for the rotation.
    const contact = enemyContactOf(world, character.id);
    if (contact !== null) {
      score += contact.hops === 0 ? 30 : 20;
      if (contact.hops === 0) pressing = true;
      reasons.unshift(contact.hops === 0
        ? `has the enemy in the same province: ${contact.enemy}`
        : `has the enemy one province off: ${contact.enemy}`);
    }
    // Ground his power lost, or a city of theirs under siege, within his army's
    // reach: the thing a beaten power's general is for. Near enough to strike
    // at once, and it will not wait for the rotation.
    const wound = woundWithinReach(world, character.id);
    if (wound !== null) {
      score += 25;
      if (wound.hops <= 1) pressing = true;
      reasons.unshift(wound.why);
    }
    if (character.polityId !== null && polityHasAims.has(character.polityId)) {
      score += 15;
      reasons.push("their government is pursuing something");
    }
    // Somebody with nothing on his plate still has a life: he is asked now and
    // then, on the rotation alone, below everybody who has business -- which
    // is what his own purse used to buy him, counted as authority.
    if (score === 0) reasons.push("has his own affairs to see to");

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
      pressing,
      // Filled in for the chosen cast only, below: a station per person alive is dear.
      knownFacts: [],
      why: reasons.join(", "),
    });
  }

  scored.sort((a, b) => b.score - a.score || stableHash([a.characterId]) - stableHash([b.characterId]));
  // The antagonist first, then whoever the narrator has just handed something
  // to, then whoever a plan wants now, then the rotation. All three are
  // reservations against the same cast size: a busy week must not be the
  // reason the quarrel goes quiet, nor the reason a man's plan never comes up.
  const antagonist = scored.filter((actor) => actor.characterId === input.nemesisCharacterId).slice(0, 1);
  const reserved = scored.filter((actor) => priority.has(actor.characterId) && !antagonist.includes(actor)).slice(0, 1);
  const planned = scored
    .filter((actor) => input.dueStepOwners?.has(actor.characterId) === true && !antagonist.includes(actor) && !reserved.includes(actor))
    .slice(0, PLAN_SLOTS);
  const held = [...antagonist, ...reserved, ...planned].slice(0, input.max);
  const rest = scored.filter((actor) => !held.includes(actor)).slice(0, Math.max(0, input.max - held.length));
  return [...held, ...rest].map((actor) => ({
    ...actor,
    knownFacts: heardBy(world, input.offices, authority, input.facts, actor.characterId).slice(-(input.maxFactsEach ?? 6)),
  }));
}

/**
 * What a person has actually heard: the share of it their station reaches
 * (`factsKnownToStation` -- a private man does not read the Senate's
 * dispatches), once word has come to where they are.
 */
function heardBy(world: WorldState, offices: readonly Office[], authority: AuthorityIndex, facts: readonly Fact[], characterId: string): Fact[] {
  if (facts.length === 0) return [];
  const station = buildStation({ world, characterId, offices, authority });
  return factsKnownToStation(facts, station, world.instant, world);
}
