import {
  currentAgeYears,
  factsKnownTo,
  formatWorldDate,
  type Fact,
  type OrderPartyRef,
  type ScenarioClock,
  type WorldState,
} from "@chronica/shared";

/**
 * The compressed world slice (VISION §27).
 *
 * `WorldState` is far too large to send -- a full scenario world runs to
 * hundreds of kilobytes of JSON, most of it map geometry and history that has
 * no bearing on the order in hand. This projects the part that does.
 *
 * Two rules govern what goes in:
 *
 *  - **Bounded.** Every list has a hard cap. A slice that grows with the world
 *    would make the loop slower and more expensive the longer a campaign runs,
 *    which is exactly backwards.
 *  - **Knowable.** History is filtered through `factsVisibleTo` for the
 *    ordering actor. The orchestrator speaks for the player's government, so it
 *    must not be handed the secrets that government has not discovered
 *    (VISION §14) -- otherwise the world starts acting on knowledge nobody in
 *    it actually has.
 */

const CAPS = { characters: 12, forces: 10, projects: 8, accounts: 6, stances: 8, facts: 12, events: 8, intents: 8, provinces: 40 } as const;

export interface SliceEvent {
  readonly kind: string;
  readonly summary: string;
  readonly dueInDays: number;
}

/** A question the world put to the ruler, and the answer they gave. */
export interface AnsweredDecision {
  readonly prompt: string;
  readonly label: string;
  readonly summary: string;
}

export interface WorldSliceInput {
  readonly world: WorldState;
  readonly clock: ScenarioClock;
  readonly actorRef: OrderPartyRef;
  readonly actorPolityId: string | null;
  readonly orderText: string | null;
  readonly answeredDecision?: AnsweredDecision | undefined;
  readonly facts: readonly Fact[];
  readonly dueEvents: readonly SliceEvent[];
  readonly pendingEvents: readonly SliceEvent[];
}

export interface WorldSlice {
  readonly date: string;
  readonly order: string | null;
  readonly answeredDecision: AnsweredDecision | null;
  readonly actor: { readonly id: string; readonly name: string; readonly office: string | null; readonly polityId: string | null };
  readonly economy: readonly { readonly id: string; readonly label: string; readonly balance: number }[];
  readonly monthlyIncome: number;
  readonly monthlyExpenditure: number;
  readonly military: readonly { readonly id: string; readonly name: string; readonly strength: number; readonly location: string; readonly locationId: string; readonly commander: string }[];
  readonly provinces: readonly { readonly id: string; readonly name: string; readonly controller: string }[];
  readonly politics: readonly { readonly id: string; readonly name: string; readonly office: string | null; readonly age: number }[];
  readonly diplomacy: readonly { readonly toward: string; readonly trust: number; readonly why: string }[];
  readonly projects: readonly { readonly id: string; readonly label: string; readonly status: string; readonly nextMilestone: { readonly id: string; readonly label: string } | null }[];
  readonly intents: readonly { readonly actor: string; readonly action: string; readonly rationale: string }[];
  readonly recentHistory: readonly { readonly summary: string; readonly significance: number }[];
  readonly dueEvents: readonly SliceEvent[];
  readonly pendingEvents: readonly SliceEvent[];
  readonly openOrders: readonly { readonly id: string; readonly recipient: string; readonly status: string }[];
}

export function buildWorldSlice(input: WorldSliceInput): WorldSlice {
  const { world } = input;
  const name = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;
  const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

  const actor = world.characters.find((character) => character.id === input.actorRef.id);
  const ownPolity = input.actorPolityId;

  // Money the actor's side actually holds, biggest first: a slice that leads
  // with a pauper's purse tells the model nothing about whether an order is
  // affordable.
  const accounts = [...world.material.accounts]
    .filter((account) => account.owner.kind === "polity" || world.characters.some((c) => c.id === account.owner.id && c.polityId === ownPolity))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, CAPS.accounts)
    .map((account) => ({
      id: account.id,
      label: account.owner.kind === "polity" ? `${polityName(account.owner.id)} treasury` : `${name(account.owner.id)}'s purse`,
      balance: account.balance,
    }));

  const perDay = (amount: number, cadenceDays: number) => (cadenceDays <= 0 ? 0 : amount / cadenceDays);
  const monthlyIncome = Math.round(
    world.material.incomeSources.filter((source) => source.active).reduce((sum, source) => sum + perDay(source.amount, source.cadenceSteps) * 30, 0),
  );
  const monthlyExpenditure = Math.round(
    world.material.obligations.filter((obligation) => obligation.active).reduce((sum, obligation) => sum + perDay(obligation.amount, obligation.cadenceSteps) * 30, 0),
  );

  const military = world.material.forces
    .filter((force) => ownPolity === null || force.polityId === ownPolity)
    .slice(0, CAPS.forces)
    .map((force) => ({
      id: force.id,
      name: force.name,
      strength: force.authorizedStrength,
      location: provinceName(force.locationId),
      locationId: force.locationId,
      commander: name(force.commanderCharacterId),
    }));

  // Every place in the world, by the id an order must name it by -- not only
  // the places already ours. An order to invade names somewhere we do not hold,
  // and a model with no id for it will invent one.
  const ourProvinceIds = new Set([
    ...world.map.provinces.filter((province) => province.controllerPolityId === ownPolity).map((province) => province.id),
    ...world.material.forces.filter((force) => force.polityId === ownPolity).map((force) => force.locationId),
  ]);
  const provinces = [...world.map.provinces]
    .sort((a, b) => Number(ourProvinceIds.has(b.id)) - Number(ourProvinceIds.has(a.id)))
    .slice(0, CAPS.provinces)
    .map((province) => ({
      id: province.id,
      name: province.name,
      controller: province.controllerPolityId === null ? "uncontrolled" : polityName(province.controllerPolityId),
    }));

  const politics = world.characters
    .filter((character) => character.alive && (ownPolity === null || character.polityId === ownPolity))
    .slice(0, CAPS.characters)
    .map((character) => ({
      id: character.id,
      name: character.name,
      office: character.officeId,
      age: currentAgeYears(character, world.elapsedStep),
    }));

  const diplomacy = world.polityStances
    .filter((stance) => ownPolity === null || stance.polityId === ownPolity)
    .slice(0, CAPS.stances)
    .map((stance) => ({ toward: polityName(stance.towardPolityId), trust: stance.trustScore, why: stance.lastShiftReason }));

  const projects = world.projects
    .filter((project) => project.status !== "completed" && project.status !== "cancelled")
    .slice(0, CAPS.projects)
    .map((project) => ({
      id: project.id,
      label: project.label,
      status: project.status,
      nextMilestone: (() => {
        const pending = project.milestones.find((milestone) => milestone.status === "pending");
        return pending === undefined ? null : { id: pending.id, label: pending.label };
      })(),
    }));

  const intents = world.characterIntents
    .filter((intent) => intent.status === "proposed" || intent.status === "prepared")
    .slice(0, CAPS.intents)
    .map((intent) => ({ actor: name(intent.actorCharacterId), action: intent.actionType, rationale: intent.rationale }));

  // Only what this actor could actually know.
  const recentHistory = factsKnownTo(input.facts, input.actorRef, ownPolity, world.instant)
    .slice(-CAPS.facts)
    .map((fact) => ({ summary: fact.summary, significance: 0 }));

  const openOrders = world.orderAttempts
    .filter((attempt) => attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed" || attempt.status === "accepted")
    .slice(0, CAPS.events)
    .map((attempt) => ({ id: attempt.id, recipient: name(attempt.recipientRef.id), status: attempt.status }));

  return {
    date: formatWorldDate(world.instant, input.clock),
    order: input.orderText,
    answeredDecision: input.answeredDecision ?? null,
    actor: { id: input.actorRef.id, name: actor?.name ?? input.actorRef.id, office: actor?.officeId ?? null, polityId: ownPolity },
    economy: accounts,
    monthlyIncome,
    monthlyExpenditure,
    military,
    provinces,
    politics,
    diplomacy,
    projects,
    intents,
    recentHistory,
    dueEvents: input.dueEvents.slice(0, CAPS.events),
    pendingEvents: input.pendingEvents.slice(0, CAPS.events),
    openOrders,
  };
}

/** The slice as the compact text a prompt carries. */
export function renderWorldSlice(slice: WorldSlice): string {
  const lines: string[] = [];
  const section = (title: string, body: readonly string[]) => {
    if (body.length === 0) return;
    lines.push(title, ...body.map((line) => `  ${line}`), "");
  };

  lines.push(`CURRENT DATE: ${slice.date}`, "");
  lines.push(`ACTING FOR: ${slice.actor.name}${slice.actor.office === null ? "" : ` (${slice.actor.office})`}, of ${slice.actor.polityId ?? "no polity"}`, "");
  // An answer is not a fresh order, and saying so matters: the world is
  // resuming something it had already begun and put to the ruler.
  if (slice.answeredDecision !== null) {
    lines.push(
      "A QUESTION WAS PUT TO THE RULER:",
      `  ${slice.answeredDecision.prompt}`,
      "THE RULER'S ANSWER:",
      `  ${slice.answeredDecision.label} — ${slice.answeredDecision.summary}`,
      "",
      "Carry out that answer. Do not ask it again.",
      "",
    );
  }
  if (slice.order !== null) lines.push("PLAYER ORDER:", `  ${slice.order}`, "");

  section("TREASURY", [
    ...slice.economy.map((account) => `${account.label} [${account.id}]: ${account.balance}`),
    `Monthly income ~${slice.monthlyIncome}, monthly expenditure ~${slice.monthlyExpenditure}`,
  ]);
  section("MILITARY", slice.military.map((force) => `${force.name} [${force.id}] — ${force.strength} men at ${force.location} [${force.locationId}], under ${force.commander}`));
  section("PLACES", slice.provinces.map((province) => `${province.name} [${province.id}] — held by ${province.controller}`));
  section("PEOPLE", slice.politics.map((person) => `${person.name} [${person.id}]${person.office === null ? "" : `, ${person.office}`}, aged ${person.age}`));
  section("DIPLOMACY", slice.diplomacy.map((stance) => `toward ${stance.toward}: trust ${stance.trust} (${stance.why})`));
  section("ACTIVE PROJECTS", slice.projects.map((project) =>
    `${project.label} [${project.id}] — ${project.status}${project.nextMilestone === null ? "" : `, next: ${project.nextMilestone.label} [${project.nextMilestone.id}]`}`));
  section("STANDING INTENTIONS", slice.intents.map((intent) => `${intent.actor} means to ${intent.action}: ${intent.rationale}`));
  section("ORDERS AWAITING AN ANSWER", slice.openOrders.map((order) => `${order.id} to ${order.recipient} — ${order.status}`));
  section("RECENT HISTORY (only what is known to this government)", slice.recentHistory.map((entry) => entry.summary));
  section("DUE NOW", slice.dueEvents.map((event) => `${event.kind}: ${event.summary}`));
  section("SCHEDULED AHEAD", slice.pendingEvents.map((event) => `in ${event.dueInDays} days — ${event.kind}: ${event.summary}`));

  return lines.join("\n").trim();
}
