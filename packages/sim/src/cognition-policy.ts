import { answerDueOf, buildStation, findOrderPart, holdsPolityStanding, kmFromAny, openStorylines, orderPartStatus, type Office, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { newsRelations } from "./far-powers";
import { readBoard } from "./board";
import { houseFolkOf } from "./merchant-houses";
import type { DueStep } from "./plans";

export type SimulationDetail = "personal" | "regional" | "background";
export interface PlayerInterests {
  readonly entities: ReadonlySet<string>;
  readonly people: ReadonlySet<string>;
  readonly polities: ReadonlySet<string>;
  readonly eligibleCharacterIds: ReadonlySet<string>;
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
  const entities = new Set<string>();
  const people = new Set<string>();
  const polities = new Set<string>();
  const player = world.characters.find((person) => person.id === playerId);
  if (player !== undefined) {
    const station = buildStation({ world, characterId: player.id, offices });
    people.add(player.id);
    entities.add(player.locationProvinceId);
    for (const id of [...station.forceIds, ...station.accountIds, ...station.holdingIds, ...station.procedureIds]) entities.add(id);
    // A relationship with a kept cause, rather than an empty acquaintance.
    for (const relation of player.relations) if (relation.causes.length > 0) people.add(relation.subjectCharacterId);
    for (const member of world.cast.members) if (member.seat === "chain" || member.seat === "nemesis") people.add(member.characterId);
    // Honour a decision deferred by an earlier burst before lowering its detail.
    for (const owed of world.owed) people.add(owed.characterId);
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
        if (message.fromCharacterId !== null) people.add(message.fromCharacterId);
        if (message.toCharacterId !== null) people.add(message.toCharacterId);
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
  for (const id of people) entities.add(id);
  for (const force of world.material.forces) if (entities.has(force.id) || people.has(force.commanderCharacterId) || people.has(force.controllerCharacterId) || force.memberCharacterIds.includes(playerId ?? "")) {
    entities.add(force.id); entities.add(force.locationId); people.add(force.commanderCharacterId);
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
  const detailOf = (id: string): SimulationDetail => {
    if (player === undefined) return "personal"; // Headless/world simulations have no player horizon.
    const person = personById.get(id);
    if (people.has(id)) return "personal";
    if (houseFolk.has(id)) return "background";
    if (person !== undefined && entities.has(person.locationProvinceId)) return "personal";
    return person?.polityId != null && polities.has(person.polityId) ? "regional" : "background";
  };
  return { entities, people, polities, detailOf, eligibleCharacterIds: new Set(world.characters.filter((person) => detailOf(person.id) !== "background").map((person) => person.id)) };
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
