import { findPolityGaps } from "./population";
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

const CAPS = { characters: 12, forces: 10, projects: 8, accounts: 6, stances: 8, facts: 12, events: 8, intents: 8, provinces: 40, foreignForces: 12, foreignFigures: 12, outlooks: 8, institutions: 4, procedures: 6, strainedProvinces: 8, holdings: 6 } as const;

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
  /**
   * What each polity is trying to do (VISION §11), including foreign ones.
   *
   * The orchestrator is the world: it has to drive Carthage consistently with
   * Carthage's own aims, so it is shown them. Nobody inside the world gets this
   * view -- an NPC's cognition sees only their own government's outlook, and a
   * Chronicle is built from facts, never from here.
   */
  /** VISION §6: how far this government is still obeyed, and why. */
  readonly standing: readonly {
    readonly id: string;
    readonly kind: "polity" | "institution";
    readonly name: string;
    readonly legitimacy: number;
    readonly confidence: number | null;
    readonly causes: readonly string[];
  }[];
  /** What the country is actually made of -- people, manpower, food, order. */
  readonly country: {
    readonly provinces: number;
    readonly population: number;
    readonly availableManpower: number;
    readonly strained: readonly {
      readonly id: string;
      readonly name: string;
      readonly manpower: number;
      readonly food: number;
      readonly stability: number;
      readonly warDamage: number;
      readonly taxCapacity: number;
    }[];
  };
  /** Bodies that can decide something, and the terms on which they decide it. */
  readonly institutions: readonly { readonly id: string; readonly name: string; readonly blocs: number; readonly threshold: number }[];
  /** Questions still open before them, with where the weight currently sits. */
  readonly council: readonly {
    readonly id: string;
    readonly label: string;
    readonly type: string;
    readonly institution: string | null;
    readonly sponsor: string;
    readonly mechanism: string;
    readonly stage: string;
    readonly dueInDays: number | null;
    readonly supportWeight: number;
    readonly opposeWeight: number;
  }[];
  /** Land, and the gap between who owns it and who holds it. */
  readonly holdings: readonly { readonly id: string; readonly title: string; readonly holder: string; readonly control: number; readonly territoryId: string }[];
  readonly outlooks: readonly {
    readonly polityId: string;
    readonly name: string;
    readonly own: boolean;
    readonly objective: string;
    readonly riskTolerance: number;
    readonly concerns: readonly string[];
    readonly intentions: readonly string[];
  }[];
  /**
   * The world outside our borders, as far as it is plainly known. Filtering
   * foreign secrets is right; filtering the existence of the army marching at
   * us is not, and doing so left the orchestrator inventing placeholders for
   * enemies it could not see.
   */
  readonly foreignPowers: readonly { readonly id: string; readonly name: string; readonly provinces: number; readonly leaders: readonly string[]; readonly forces: readonly string[] }[];
  /** Countries holding land with nobody to speak or fight for them (VISION §5). */
  readonly populationGaps: readonly { readonly polityId: string; readonly name: string; readonly needsLeader: boolean; readonly needsForce: boolean; readonly why: string }[];
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

  // Basis points are the engine's unit and a hundredth of a point is not a
  // political fact; the model reads /100 the way VISION §6 writes it.
  const outOfHundred = (bps: number): number => Math.round(bps / 100);

  const ourInstitutions = world.material.institutions.filter((institution) => ownPolity === null || institution.polityId === ownPolity);
  const ourInstitutionIds = new Set(ourInstitutions.map((institution) => institution.id));

  const standing = [
    ...world.material.polityLegitimacy
      .filter((entry) => ownPolity === null || entry.polityId === ownPolity)
      .map((entry) => ({
        id: entry.polityId,
        kind: "polity" as const,
        name: polityName(entry.polityId),
        legitimacy: outOfHundred(entry.legitimacyBps),
        confidence: outOfHundred(entry.institutionalConfidenceBps),
        causes: [...entry.causes].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 2).map((cause) => cause.label),
      })),
    ...world.material.institutionLegitimacy
      .filter((entry) => ourInstitutionIds.has(entry.institutionId))
      .map((entry) => ({
        id: entry.institutionId,
        kind: "institution" as const,
        name: ourInstitutions.find((institution) => institution.id === entry.institutionId)?.name ?? entry.institutionId,
        legitimacy: outOfHundred(entry.legitimacyBps),
        confidence: null,
        causes: [...entry.causes].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 2).map((cause) => cause.label),
      })),
  ];

  // Manpower is per-province and there is no polity total, so the total the
  // model needs to answer "can we raise another legion" has to be summed here.
  const ourMaterial = world.material.provinceMaterial.filter((material) => ourProvinceIds.has(material.provinceId));
  const country = {
    provinces: ourMaterial.length,
    population: ourMaterial.reduce((sum, material) => sum + material.population, 0),
    availableManpower: ourMaterial.reduce((sum, material) => sum + material.availableManpower, 0),
    // The worst-off first: a province at its baseline needs no line of prompt.
    strained: [...ourMaterial]
      .sort((a, b) => (a.foodSecurityBps + a.stabilityBps - a.warDamageBps) - (b.foodSecurityBps + b.stabilityBps - b.warDamageBps))
      .slice(0, CAPS.strainedProvinces)
      .map((material) => ({
        id: material.provinceId,
        name: provinceName(material.provinceId),
        manpower: material.availableManpower,
        food: outOfHundred(material.foodSecurityBps),
        stability: outOfHundred(material.stabilityBps),
        warDamage: outOfHundred(material.warDamageBps),
        taxCapacity: material.taxCapacity,
      })),
  };

  const institutions = ourInstitutions.slice(0, CAPS.institutions).map((institution) => ({
    id: institution.id,
    name: institution.name,
    blocs: institution.votingBlocs.length,
    threshold: outOfHundred(institution.passageThresholdBps),
  }));

  /**
   * Support positions are append-only: someone who changes their mind leaves
   * both rows behind. Summing them would count a senator twice and let a
   * waverer outweigh the whole chamber, so only their latest row counts.
   */
  const latestPositions = (procedureId: string) => {
    const latest = new Map<string, (typeof world.material.supportPositions)[number]>();
    for (const position of world.material.supportPositions) {
      if (position.procedureId !== procedureId) continue;
      const key = `${position.supporterKind}:${position.supporterId}`;
      const held = latest.get(key);
      if (held === undefined || position.changedAtStep >= held.changedAtStep) latest.set(key, position);
    }
    return [...latest.values()];
  };

  const council = world.material.politicalProcedures
    .filter((procedure) => procedure.stage !== "resolved" && procedure.stage !== "withdrawn" && procedure.stage !== "blocked")
    .filter((procedure) => procedure.institutionId === null || ourInstitutionIds.has(procedure.institutionId))
    .slice(0, CAPS.procedures)
    .map((procedure) => {
      const positions = latestPositions(procedure.id);
      return {
        id: procedure.id,
        label: procedure.label,
        type: procedure.type,
        institution: procedure.institutionId === null ? null : ourInstitutions.find((institution) => institution.id === procedure.institutionId)?.name ?? procedure.institutionId,
        sponsor: name(procedure.sponsorCharacterId),
        mechanism: procedure.resolutionMechanism,
        stage: procedure.stage,
        dueInDays: procedure.deadlineStep === null ? null : procedure.deadlineStep - world.elapsedStep,
        supportWeight: positions.filter((position) => position.position === "support").reduce((sum, position) => sum + position.influenceWeight, 0),
        opposeWeight: positions.filter((position) => position.position === "oppose").reduce((sum, position) => sum + position.influenceWeight, 0),
      };
    });

  const ourCharacterIds = new Set(world.characters.filter((character) => ownPolity === null || character.polityId === ownPolity).map((character) => character.id));
  const holdings = world.material.holdings
    .filter((holding) => ourCharacterIds.has(holding.legalHolderCharacterId) || ourProvinceIds.has(holding.territoryId))
    .slice(0, CAPS.holdings)
    .map((holding) => ({
      id: holding.id,
      title: holding.title,
      holder: name(holding.legalHolderCharacterId),
      control: outOfHundred(holding.physicalControlBps),
      territoryId: holding.territoryId,
    }));

  // Ours first: the order the model reads them in is the order it weighs them.
  const outlooks = [...world.polityOutlooks]
    .sort((a, b) => Number(b.polityId === ownPolity) - Number(a.polityId === ownPolity))
    .slice(0, CAPS.outlooks)
    .map((outlook) => ({
      polityId: outlook.polityId,
      name: polityName(outlook.polityId),
      own: outlook.polityId === ownPolity,
      objective: outlook.primaryObjective,
      riskTolerance: outlook.riskTolerance,
      concerns: outlook.concerns.map((concern) => `${concern.label}: ${concern.level}`),
      intentions: outlook.intentions,
    }));

  // Armies in the field and heads of state are not secrets.
  const foreignPowers = world.map.polities
    .filter((polity) => polity.id !== ownPolity)
    .map((polity) => ({
      id: polity.id,
      name: polity.name,
      provinces: world.map.provinces.filter((province) => province.controllerPolityId === polity.id).length,
      leaders: world.characters
        .filter((character) => character.alive && character.polityId === polity.id)
        .slice(0, 4)
        .map((character) => `${character.name} [${character.id}]${character.officeId === null ? "" : `, ${character.officeId}`}`),
      forces: world.material.forces
        .filter((force) => force.polityId === polity.id)
        .slice(0, 4)
        .map((force) => `${force.name} [${force.id}] — ${force.authorizedStrength} men at ${provinceName(force.locationId)} [${force.locationId}]`),
    }))
    .filter((power) => power.provinces > 0 || power.leaders.length > 0 || power.forces.length > 0)
    .slice(0, CAPS.foreignFigures);

  const populationGaps = findPolityGaps({ world, ownPolityId: ownPolity, facts: input.facts, limit: 2 });

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
    foreignPowers,
    populationGaps,
    provinces,
    politics,
    diplomacy,
    standing,
    country,
    institutions,
    council,
    holdings,
    outlooks,
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
  section("OTHER POWERS", slice.foreignPowers.map((power) => {
    const people = power.leaders.length === 0 ? "nobody known to lead them" : power.leaders.join("; ");
    const arms = power.forces.length === 0 ? "no forces known in the field" : power.forces.join("; ");
    return `${power.name} [${power.id}] — ${power.provinces} province(s). ${people}. ${arms}`;
  }));
  if (slice.populationGaps.length > 0) {
    lines.push(
      "COUNTRIES WITH NOBODY IN THEM:",
      ...slice.populationGaps.map((gap) => {
        const missing = [gap.needsLeader ? "a leader" : null, gap.needsForce ? "forces of their own" : null].filter((part) => part !== null).join(" and ");
        return `  ${gap.name} [${gap.polityId}] holds land but has ${missing === "" ? "nobody" : `no ${missing}`} — ${gap.why}.`;
      }),
      "  Give each of them the people and forces they plainly ought to have, now.",
      "",
    );
  }
  section("PEOPLE", slice.politics.map((person) => `${person.name} [${person.id}]${person.office === null ? "" : `, ${person.office}`}, aged ${person.age}`));
  section(
    "POLITICAL STANDING",
    slice.standing.map((entry) => {
      const confidence = entry.confidence === null ? "" : `, confidence in its institutions ${entry.confidence}/100`;
      const why = entry.causes.length === 0 ? "" : ` — ${entry.causes.join("; ")}`;
      return `${entry.name} [${entry.id}]: legitimacy ${entry.legitimacy}/100${confidence}${why}`;
    }),
  );
  section("INSTITUTIONS", slice.institutions.map((institution) =>
    `${institution.name} [${institution.id}] — ${institution.blocs} bloc(s), ${institution.threshold}/100 needed to carry a question`));
  section(
    "BEFORE THE COUNCIL",
    slice.council.map((question) => {
      const where = question.institution === null ? "decided by its sponsor" : `before the ${question.institution}`;
      const when = question.dueInDays === null ? "" : `, due in ${question.dueInDays} days`;
      return `${question.label} [${question.id}] — ${question.type}, ${where}, raised by ${question.sponsor}${when}. For ${question.supportWeight}, against ${question.opposeWeight}.`;
    }),
  );
  section(
    "THE COUNTRY",
    slice.country.provinces === 0
      ? []
      : [
        `${slice.country.provinces} province(s), ${slice.country.population} people, ${slice.country.availableManpower} men available to raise.`,
        ...slice.country.strained.map((province) =>
          `${province.name} [${province.id}] — ${province.manpower} men, food ${province.food}/100, order ${province.stability}/100, war damage ${province.warDamage}/100, taxable ${province.taxCapacity}`),
      ],
  );
  section("LANDS AND HOLDINGS", slice.holdings.map((holding) =>
    `${holding.title} [${holding.id}] in ${holding.territoryId} — held in law by ${holding.holder}, held in fact ${holding.control}/100`));
  section("DIPLOMACY", slice.diplomacy.map((stance) => `toward ${stance.toward}: trust ${stance.trust} (${stance.why})`));
  section(
    "STANDING AIMS",
    slice.outlooks.flatMap((outlook) => [
      `${outlook.name} [${outlook.polityId}]${outlook.own ? " (ours)" : ""} — ${outlook.objective}. Will risk ${outlook.riskTolerance}/100.`,
      ...outlook.concerns.map((concern) => `  worried about ${concern}`),
      ...outlook.intentions.map((intention) => `  means to ${intention}`),
    ]),
  );
  section("ACTIVE PROJECTS", slice.projects.map((project) =>
    `${project.label} [${project.id}] — ${project.status}${project.nextMilestone === null ? "" : `, next: ${project.nextMilestone.label} [${project.nextMilestone.id}]`}`));
  section("STANDING INTENTIONS", slice.intents.map((intent) => `${intent.actor} means to ${intent.action}: ${intent.rationale}`));
  section("ORDERS AWAITING AN ANSWER", slice.openOrders.map((order) => `${order.id} to ${order.recipient} — ${order.status}`));
  section("RECENT HISTORY (only what is known to this government)", slice.recentHistory.map((entry) => entry.summary));
  section("DUE NOW", slice.dueEvents.map((event) => `${event.kind}: ${event.summary}`));
  section("SCHEDULED AHEAD", slice.pendingEvents.map((event) => `in ${event.dueInDays} days — ${event.kind}: ${event.summary}`));

  return lines.join("\n").trim();
}
