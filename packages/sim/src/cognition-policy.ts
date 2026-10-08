import { REFERENCE_PROVINCE_KM, answerDueOf, buildStation, findOrderPart, holdsPolityStanding, kmFromAny, openStorylines, orderPartStatus, type Office, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { newsRelations } from "./far-powers";
import { readBoard } from "./board";
import { houseFolkOf } from "./merchant-houses";
import { plotsOf, salienceContextOf } from "./cast";
import type { DueStep } from "./plans";

/**
 * Whom the model may be asked about (the user's rule: model calls are for the plots and plans of people near the player, and the rotating cast).
 * "personal" may be asked; "background" never is. ("regional" was a whole power's people; it is no longer given.)
 */
export type SimulationDetail = "personal" | "regional" | "background";

/**
 * How far from the places the player holds and stands in a man must be to be asked on a plot or plan of his own: two provinces' ride
 * (the reference province is about 85 km). Further off, only the cast, the nemesis, a kept relation, an order or a storyline of the player's bring a man in.
 */
export const ASK_REACH_KM = 2 * REFERENCE_PROVINCE_KM;
export interface PlayerInterests {
  readonly entities: ReadonlySet<string>;
  readonly people: ReadonlySet<string>;
  readonly polities: ReadonlySet<string>;
  readonly eligibleCharacterIds: ReadonlySet<string>;
  /** The provinces within `ASK_REACH_KM` of the places the player stands in, holds and leads armies in: where a man with a plot or plan of his own may be asked. */
  readonly nearPlaces: ReadonlySet<string>;
  readonly detailOf: (characterId: string) => SimulationDetail;
}

/** Read ids from structured goals/work, never infer interests from narrative wording. */
function references(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) references(item, into); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && (key === "id" || key.endsWith("Id"))) into.add(child);
    else if (typeof child === "object") references(child, into);
  }
}

/** Recomputed as orders, contact and ownership change. Background state is never erased. */
export function playerInterests(world: WorldState, playerId: string | null, offices: readonly Office[]): PlayerInterests {
  let byPlayer = cache.get(world);
  if (byPlayer === undefined) { byPlayer = new Map(); cache.set(world, byPlayer); }
  const key = `${playerId ?? ""}`;
  const kept = byPlayer.get(key);
  if (kept !== undefined && kept.offices === offices) return kept.interests;
  const interests = readInterests(world, playerId, offices);
  byPlayer.set(key, { offices, interests });
  return interests;
}

/** What was read for a world, so the three calls a round make one reading (the answer is a pure function of the world). */
const cache = new WeakMap<WorldState, Map<string, { readonly offices: readonly Office[]; readonly interests: PlayerInterests }>>();

function readInterests(world: WorldState, playerId: string | null, offices: readonly Office[]): PlayerInterests {
  const entities = new Set<string>();
  const people = new Set<string>();
  /** Askable only if near the player and in a plot of their own, or already in his circle: letters he is party to, and decisions owed. */
  const deferred = new Set<string>();
  const polities = new Set<string>();
  const player = world.characters.find((person) => person.id === playerId);
  if (player !== undefined) {
    const station = buildStation({ world, characterId: player.id, offices });
    people.add(player.id);
    entities.add(player.locationProvinceId);
    for (const id of [...station.forceIds, ...station.accountIds, ...station.holdingIds, ...station.procedureIds]) entities.add(id);
    // A relationship with a kept cause, rather than an empty acquaintance.
    for (const relation of player.relations) if (relation.causes.length > 0) people.add(relation.subjectCharacterId);
    // The cast is askable by its own rule (every seat: a seated person entered for a plot near the player), and so is whoever is set against him.
    for (const member of world.cast.members) people.add(member.characterId);
    for (const nemesis of world.nemeses) if (nemesis.targetCharacterId === player.id && nemesis.retiredAtStep === null) people.add(nemesis.characterId);
    // Honour a decision deferred by an earlier burst, if the man is still one the player's circle reaches (below).
    for (const owed of world.owed) deferred.add(owed.characterId);
    for (const order of world.orders) {
      if (order.actorCharacterId !== player.id) continue;
      for (const part of order.parts) if (part.closedAtStep === null) {
        references(part.goals, entities); references(part.workRefs, entities); references(part.stages, entities);
      }
    }
    for (const attempt of world.orderAttempts) {
      const part = attempt.servesRef === null ? null : findOrderPart(world, attempt.servesRef);
      if ((attempt.issuerRef.id === player.id || part?.order.actorCharacterId === player.id)
        && ["issued", "received", "accepted", "delayed"].includes(attempt.status)
        && (part === null || part.part.closedAtStep === null)) people.add(attempt.recipientRef.id);
    }
    for (const story of openStorylines(world.storylines)) {
      if (!story.participantIds.includes(player.id)) continue;
      for (const id of story.participantIds) people.add(id);
      if (story.provinceId !== null) entities.add(story.provinceId);
    }
    for (const message of world.diplomacy) {
      if (message.status !== "awaiting_reply") continue;
      if (message.fromCharacterId === player.id || message.toCharacterId === player.id
        || (holdsPolityStanding(station) && (message.fromPolityId === player.polityId || message.toPolityId === player.polityId))) {
        // A letter is answered at send time (`answerALetterNow`); afterwards a far reader is not woken for it again, he answers by rule.
        if (message.fromCharacterId !== null) deferred.add(message.fromCharacterId);
        if (message.toCharacterId !== null) deferred.add(message.toCharacterId);
        polities.add(message.fromPolityId); polities.add(message.toPolityId);
      }
    }
    for (const venture of world.material.ventures) if (venture.ownerCharacterId === player.id && venture.status === "running") {
      entities.add(venture.fromProvinceId); entities.add(venture.toProvinceId);
    }
    for (const [id, relation] of newsRelations(world, player.id) ?? []) if (relation >= .5) polities.add(id);
    // Reachable rivals across a sea lane can threaten a government without
    // sharing a polygon edge (Syracuse and Carthage around Rome's strait).
    if (holdsPolityStanding(station) && player.polityId !== null) {
      for (const neighbour of readBoard(world).get(player.polityId)?.neighbours ?? []) polities.add(neighbour.polityId);
    }
  }
  // The places the player's own concerns lie in, before the cast's far seats (a foreign ruler, his army) lend theirs: nearness is measured from these.
  const anchors = new Set(entities);
  for (const id of people) entities.add(id);
  const ownForces = new Set(player === undefined ? [] : buildStation({ world, characterId: player.id, offices }).forceIds);
  for (const force of world.material.forces) {
    if (ownForces.has(force.id) || force.controllerCharacterId === playerId || force.memberCharacterIds.includes(playerId ?? "") || anchors.has(force.id)) anchors.add(force.locationId);
  }
  for (const force of world.material.forces) if (entities.has(force.id) || people.has(force.commanderCharacterId) || people.has(force.controllerCharacterId) || force.memberCharacterIds.includes(playerId ?? "")) {
    entities.add(force.id); entities.add(force.locationId);
    // The man at the head of the player's own army is his; the head of any other is asked only as a near man with a plot of his own (below).
    if (ownForces.has(force.id) || force.controllerCharacterId === playerId || force.memberCharacterIds.includes(playerId ?? "") || people.has(force.commanderCharacterId)) people.add(force.commanderCharacterId);
  }
  for (const project of world.projects) if (entities.has(project.id)) {
    if (project.overseerCharacterId != null) people.add(project.overseerCharacterId);
  }
  // A reachable theatre, including sea crossings, matters beyond the exact
  // destination polygon. Expand once, without making neighbours' neighbours
  // recursively turn the entire map into the player's detailed world.
  const focal = world.map.provinces.filter((province) => entities.has(province.id)).map((province) => province.id);
  const reachable = kmFromAny(world, focal, { budgetKm: 300 });
  for (const province of world.map.provinces) if (reachable.has(province.id) && province.controllerPolityId !== null) polities.add(province.controllerPolityId);
  for (const story of openStorylines(world.storylines)) {
    if (story.visibility !== "public" || story.provinceId === null || !reachable.has(story.provinceId)) continue;
    for (const person of world.characters) if (story.participantIds.includes(person.id) && person.polityId !== null) polities.add(person.polityId);
  }
  for (const province of world.map.provinces) if (entities.has(province.id) && province.controllerPolityId !== null) polities.add(province.controllerPolityId);
  for (const polity of world.map.polities) if (entities.has(polity.id)) polities.add(polity.id);
  const personById = new Map(world.characters.map((person) => [person.id, person]));
  // The merchant houses' heads and heirs run on rules (`merchant-houses.ts`): the model is not asked about them unless the player's own
  // circle touches them -- a letter, a kinsman, a loan he asked for -- whatever province they happen to live in.
  const houseFolk = houseFolkOf(world);
  // Near the places the player stands in and holds: a man in one of these, with a plot or a plan of his own, may be asked; a man further off may not.
  const nearPlaces = player === undefined ? new Set<string>()
    : new Set(kmFromAny(world, world.map.provinces.filter((province) => anchors.has(province.id)).map((province) => province.id), { budgetKm: ASK_REACH_KM }).keys());
  let salience: ReturnType<typeof salienceContextOf> | undefined;
  const askedOn = new Map<string, boolean>();
  /** Whether a man has a plot of the cast's kind, or a step of his own plan coming due. */
  const hasAPlotOrPlan = (id: string): boolean => {
    const known = askedOn.get(id);
    if (known !== undefined) return known;
    const person = personById.get(id);
    let live = false;
    if (person !== undefined && person.alive && player !== undefined) {
      live = person.ambitions.some((ambition) => ambition.status === "active" && ambition.steps.some((step) => step.status === "pending" && step.dueDay <= world.instant.day + 30));
      if (!live) { salience ??= salienceContextOf(world, player.id); live = plotsOf(world, person, player.id, salience).length > 0; }
    }
    askedOn.set(id, live);
    return live;
  };
  for (const id of deferred) {
    const person = personById.get(id);
    if (person !== undefined && nearPlaces.has(person.locationProvinceId) && hasAPlotOrPlan(id)) people.add(id);
  }
  const detailOf = (id: string): SimulationDetail => {
    if (player === undefined) return "personal"; // Headless/world simulations have no player horizon.
    const person = personById.get(id);
    if (people.has(id)) return "personal";
    if (houseFolk.has(id)) return "background";
    // Near him and in a plot or plan of his own: or never asked. A whole power's generals and councillors are the rules' to play.
    return person !== undefined && nearPlaces.has(person.locationProvinceId) && hasAPlotOrPlan(id) ? "personal" : "background";
  };
  return { entities, people, polities, nearPlaces, detailOf, eligibleCharacterIds: new Set(world.characters.filter((person) => detailOf(person.id) !== "background").map((person) => person.id)) };
}

/** Changes that can require a new choice immediately. Daily progress is intentionally absent. */
export const DECISION_EVENTS: ReadonlySet<string> = new Set([
  "battle", "war_declared", "city_taken", "province_control_change", "siege_laid", "siege_ended", "siege_lifted",
  "motion_passed", "motion_failed", "motion_vetoed", "political_position_changed", "authority_breach",
  "treaty_breached", "call_to_arms", "rising", "civil_war", "promise_broken", "character_death",
]);

/**
 * Commanders whose army is on the road to a place an open order named: each
 * day's step along it is progress, not a new choice. They are asked again when
 * they arrive, or when something happens to them (a battle, a letter, a plan
 * falling due). A commander asked every day of a march was most of what a
 * month's order cost.
 */
export function marchingCommanders(world: WorldState): ReadonlySet<string> {
  const commanders = new Set<string>();
  for (const order of world.orders) {
    for (const part of order.parts) {
      if (part.closedAtStep !== null) continue;
      const places = [
        ...part.goals.flatMap((goal) => goal.kind === "force_at" ? [{ forceId: goal.forceId, provinceId: goal.provinceId }] : []),
        ...part.stages.flatMap((stage) => stage.status !== "waiting" ? [] : stage.waitsOn.flatMap((wait) => wait.kind === "force_at" ? [{ forceId: wait.forceId, provinceId: wait.provinceId }] : [])),
      ];
      for (const place of places) {
        const force = world.material.forces.find((candidate) => candidate.id === place.forceId);
        if (force !== undefined && force.locationId !== place.provinceId) commanders.add(force.commanderCharacterId);
      }
    }
  }
  return commanders;
}

/** Only actionable transitions: no dates, countdown prose, daily income or routine siege progress. */
function decisionState(actor: RoutedActor, world: WorldState, marching: ReadonlySet<string> = marchingCommanders(world)): string {
  const id = actor.characterId;
  const onTheRoad = marching.has(id);
  const person = world.characters.find((candidate) => candidate.id === id);
  return JSON.stringify([
    person === undefined ? null : [person.alive, person.polityId, person.officeId, onTheRoad ? null : person.locationProvinceId, person.healthBps < 3500, person.healthBps < 1500],
    world.characterPressures.filter((pressure) => pressure.characterId === id && pressure.status === "active")
      .map((pressure) => [pressure.id, pressure.intensity >= 60]),
    world.orderAttempts.filter((attempt) => attempt.recipientRef.id === id).map((attempt) => {
      const part = attempt.servesRef === null ? null : findOrderPart(world, attempt.servesRef);
      return [attempt.id, attempt.status, world.elapsedStep >= answerDueOf(attempt), part === null ? null : orderPartStatus(world, part.part)];
    }),
    world.projects.filter((project) => project.overseerCharacterId === id || project.sponsorEntityRef.id === id)
      .map((project) => [project.id, project.status, project.milestones.map((milestone) => milestone.status)]),
    world.material.forces.filter((force) => force.commanderCharacterId === id || force.controllerCharacterId === id || force.memberCharacterIds.includes(id))
      .map((force) => [force.id, onTheRoad ? null : force.locationId, force.provisionStatus, force.hold, force.commanderCharacterId]),
    world.diplomacy.filter((message) => message.toCharacterId === id || (message.toCharacterId === null && message.toPolityId === person?.polityId))
      .map((message) => [message.id, message.status, message.deliveredOnDay == null || message.deliveredOnDay <= world.instant.day,
        message.replyDueByStep != null && world.instant.day >= message.replyDueByStep]),
    world.material.politicalProcedures.filter((procedure) => procedure.sponsorCharacterId === id || procedure.eligibleParticipantIds.includes(id)
      || world.material.institutions.some((institution) => institution.id === procedure.institutionId && institution.polityId === person?.polityId))
      .map((procedure) => [procedure.id, procedure.stage, procedure.outcome, procedure.deadlineStep !== null && world.instant.day >= procedure.deadlineStep - 3]),
    world.commitments.filter((commitment) => commitment.promisorCharacterId === id || commitment.beneficiaryCharacterId === id)
      .map((commitment) => [commitment.id, commitment.status, world.instant.day >= commitment.reviewAtStep]),
    person?.ambitions.filter((ambition) => ambition.status === "active").map((ambition) => [ambition.id,
      ambition.steps.filter((step) => step.status === "pending").map((step) => [step.id, world.instant.day >= step.dueDay])]),
  ]);
}

/** A meaningful event beats the cadence; routine new facts do not buy another daily decision. */
export function createCognitionPolicy() {
  const last = new Map<string, { day: number; state: string; facts: Set<string>; steps: Set<string> }>();
  const stepKey = (step: DueStep) => `${step.stepId}:${step.waiting === true ? "review" : "act"}`;
  return {
    shouldAsk(actor: RoutedActor, world: WorldState, interests: PlayerInterests, significance: ReadonlyMap<string, number>, authorOf: ReadonlyMap<string, string>, due: readonly DueStep[] = []): boolean {
      const detail = interests.detailOf(actor.characterId);
      if (detail === "background") return false;
      const previous = last.get(actor.characterId);
      if (previous === undefined) return true;
      if (due.some((step) => step.ownerId === actor.characterId && !previous.steps.has(stepKey(step)))) return true;
      if (decisionState(actor, world) !== previous.state) return true;
      const decisionNews = actor.knownFacts.some((fact) => !previous.facts.has(fact.id) && authorOf.get(fact.id) !== actor.characterId
        && (DECISION_EVENTS.has(fact.kind) || (significance.get(fact.id) ?? 0) >= 60)
        && fact.affectedEntities.some((entity) => entity.id === actor.characterId || interests.entities.has(entity.id) || interests.polities.has(entity.id)));
      return decisionNews || world.instant.day - previous.day >= (detail === "personal" ? 7 : 14);
    },
    /** The day this person was last asked, or null when they have not been this burst or the last. */
    lastAskedDay(characterId: string): number | null {
      return last.get(characterId)?.day ?? null;
    },
    remember(actor: RoutedActor, world: WorldState, facts: readonly { readonly id: string }[], due: readonly DueStep[] = []): void {
      const seen = new Set(last.get(actor.characterId)?.facts);
      for (const fact of facts) seen.add(fact.id);
      const steps = new Set(last.get(actor.characterId)?.steps);
      for (const step of due) if (step.ownerId === actor.characterId) steps.add(stepKey(step));
      last.set(actor.characterId, { day: world.instant.day, state: decisionState(actor, world), facts: seen, steps });
    },
  };
}
