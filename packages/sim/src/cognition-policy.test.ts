import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { OrderRecordSchema, ProjectSchema, ScenarioDefinitionSchema, WorldStateSchema, emitFacts, type Fact, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { routeAmbientActors, routeAttention } from "./attention";
import { plotsOf, salienceContextOf } from "./cast";
import { createCognitionPolicy, playerInterests } from "./cognition-policy";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { layPlan } from "./plans";
import { createIdFactory, type SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const seed = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const playerId = "gaius-genucius";
const atDay = (world: WorldState, day: number): WorldState => ({ ...world, elapsedStep: day, instant: { day, minute: 0 } });
function actorFor(world: WorldState, id: string): RoutedActor {
  const person = world.characters.find((candidate) => candidate.id === id)!;
  return { ref: { kind: "character", id }, characterId: id, name: person.name, level: "focused", impetus: "own_business", pressing: true, score: 80, knownFacts: [], why: "has work under way" };
}
function news(world: WorldState, actor: RoutedActor, kind: string): Fact {
  return emitFacts([{ time: world.instant, atStep: world.elapsedStep, kind, summary: "A new development.",
    affectedEntities: [{ kind: "character", id: actor.characterId }], resourceChanges: [], visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
    eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0 }], () => `${kind}-${world.instant.day}`)[0]!;
}

describe("the player's changing interests", () => {
  it("brings in the man at an ordered place only if he has a plan of his own, and releases him when the order closes", () => {
    const base = seed();
    const planned = (id: string): WorldState => layPlan(base, id, { ambition: "Hold the province", kind: "office", steps: [{ act: "Look to the walls", inDays: 10, when: null }] }, createIdFactory("order-plan")).world;
    // A man far from the player, who has a plan due and is still not asked: ordering his province is what changes it.
    const plotless = (world: WorldState, id: string): boolean => plotsOf(world, world.characters.find((person) => person.id === id)!, playerId, salienceContextOf(world, playerId)).length === 0;
    const distant = base.characters.find((person) => person.alive && plotless(base, person.id) && playerInterests(planned(person.id), playerId, offices).detailOf(person.id) === "background")!;
    expect(distant).toBeDefined();
    const order = OrderRecordSchema.parse({ id: "far-campaign", actorCharacterId: playerId, text: "Take this province.", givenAtStep: 0,
      parts: [{ said: "Take the province", goals: [{ kind: "control", provinceId: distant.locationProvinceId, polityId: "rome" }] }] });
    const world = planned(distant.id);
    const involved = { ...world, orders: [...world.orders, order] };
    expect(playerInterests(involved, playerId, offices).detailOf(distant.id)).toBe("personal");
    // The order alone, with no plan of his, asks nobody there.
    expect(playerInterests({ ...base, orders: [...base.orders, order] }, playerId, offices).detailOf(distant.id)).toBe("background");
    const closed = { ...world, orders: [{ ...order, parts: order.parts.map((part) => ({ ...part, closedAtStep: 1 })) }] };
    expect(playerInterests(closed, playerId, offices).detailOf(distant.id)).toBe("background");
  });

  it("keeps background actors out of both AI routers, even when they would occupy a cast seat", () => {
    const world = seed();
    const interests = playerInterests(world, playerId, offices);
    const distant = world.characters.find((person) => person.alive && interests.detailOf(person.id) === "background")!;
    const actor = actorFor(world, distant.id);
    const facts = [news(world, actor, "war_declared")];
    const attention = routeAttention({ world, offices, facts, excludeCharacterIds: [playerId], maxFocused: 4, maxCausalDepth: 3,
      cognitionEligible: interests.eligibleCharacterIds });
    const ambient = routeAmbientActors({ world, offices, facts, excludeCharacterIds: [playerId], max: 6,
      cognitionEligible: interests.eligibleCharacterIds, castMembers: new Map([[distant.id, { why: "a distant ruler" }]]) });
    expect([...attention.focused, ...ambient].some((candidate) => candidate.characterId === distant.id)).toBe(false);
    expect(world.characters.find((person) => person.id === distant.id)).toEqual(distant);
  });

  it("completes a distant approved project and its plan without asking its owner", async () => {
    let world = seed();
    // Far off, in another power's country: with a plan of his own due, he is still not asked.
    const withPlan = (id: string): WorldState => layPlan(world, id, { ambition: "Ready distant stores", kind: "office", steps: [{ act: "Prepare the stores", inDays: 14, when: null, routineProjectRef: "far-stores" }] }, createIdFactory("far-plan")).world;
    const distant = world.characters.find((person) => person.alive && person.officeId === null && plotsOf(world, person, playerId, salienceContextOf(world, playerId)).length === 0 && playerInterests(withPlan(person.id), playerId, offices).detailOf(person.id) === "background")!;
    world = { ...world, projects: [...world.projects, ProjectSchema.parse({ id: "far-stores", kind: "construction",
      sponsorEntityRef: { kind: "character", id: distant.id }, label: "Prepare the stores", status: "in_progress", startedAtStep: 0,
      targetCompletionStep: 7, milestones: [{ id: "far-stage", label: "Stores ready", requiredAtElapsedOffset: 7, costAmount: 0, status: "pending" }] })] };
    world = withPlan(distant.id);
    const asked: string[] = [];
    const port: SimModelPort = { complete(operation, _system, user) {
      if (operation === "simulate_cognition") { asked.push(...[...user.matchAll(/^## .+ \[([^\]]+)\]$/gm)].map((match) => match[1]!)); return Promise.resolve('{"actors":[]}'); }
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait", domains: ["administration"] }, narrativeSummary: "Time passes.", deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    } };
    const result = await runSimulationBurst({ world, clock: definition.clock, offices, warfare: definition.warfare, burstId: "far-routine", gameId: "far-routine",
      actorRef: { kind: "character", id: playerId }, actorPolityId: "rome", orderText: "Let fourteen days pass.", spanDays: 14,
      knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
    expect(asked).not.toContain(distant.id);
    expect(result.world.projects.find((project) => project.id === "far-stores")?.status).toBe("completed");
    expect(result.world.characters.find((person) => person.id === distant.id)?.ambitions.find((ambition) => ambition.label === "Ready distant stores")?.steps[0]?.status).toBe("done");
  });
});

describe("paying only for a new decision", () => {
  function setup() {
    let world = seed();
    const player = world.characters.find((person) => person.id === playerId)!;
    const person = world.characters.find((candidate) => candidate.id !== playerId && candidate.alive)!;
    // He sits in the cast: a man is asked only on a plot near the player, or for the cast (`far-people-are-never-asked.test.ts`).
    world = { ...world, cast: { ...world.cast, members: [{ characterId: person.id, seat: "open" as const, sinceStep: 0, salience: 50, why: "a plot of his own", belowFor: 0, reviews: 0 }] },
      diplomacy: [], orderAttempts: [],
      material: { ...world.material, politicalProcedures: [] },
      characters: world.characters.map((candidate) => candidate.id === person.id
        ? { ...candidate, officeId: offices[0]!.id, locationProvinceId: player.locationProvinceId, ambitions: [] } : candidate) };
    return { world, actor: actorFor(world, person.id), policy: createCognitionPolicy() };
  }
  it("turns thirty daily routine updates into five weekly personal reviews", () => {
    const { world, actor, policy } = setup();
    let decisions = 0;
    for (let day = 0; day < 30; day += 1) {
      const state = atDay(world, day);
      const fact = news(state, actor, "siege_progress");
      const candidate = { ...actor, knownFacts: [fact] };
      if (policy.shouldAsk(candidate, state, playerInterests(state, playerId, offices), new Map([[fact.id, 20]]), new Map())) {
        decisions += 1; policy.remember(candidate, state, [fact]);
      }
    }
    expect(decisions).toBe(5);
  });
  it("wakes immediately for a consequential event, once, and for a real change in command", () => {
    const { world, actor, policy } = setup();
    policy.remember(actor, world, []);
    const tomorrow = atDay(world, 1);
    const fact = news(tomorrow, actor, "battle");
    const candidate = { ...actor, knownFacts: [fact], impetus: "reaction" as const };
    expect(policy.shouldAsk(candidate, tomorrow, playerInterests(tomorrow, playerId, offices), new Map(), new Map())).toBe(true);
    policy.remember(candidate, tomorrow, [fact]);
    expect(policy.shouldAsk(candidate, atDay(world, 2), playerInterests(world, playerId, offices), new Map(), new Map())).toBe(false);
    const changed = { ...tomorrow, characters: tomorrow.characters.map((person) => person.id === actor.characterId ? { ...person, officeId: null } : person) };
    expect(world.characters.find((person) => person.id === actor.characterId)?.officeId).not.toBeNull();
    expect(policy.shouldAsk(actor, changed, playerInterests(changed, playerId, offices), new Map(), new Map())).toBe(true);
  });
  it("does not make a person react to their own new report", () => {
    const { world, actor, policy } = setup();
    policy.remember(actor, world, []);
    const state = atDay(world, 1);
    const fact = news(state, actor, "battle");
    expect(policy.shouldAsk({ ...actor, knownFacts: [fact] }, state, playerInterests(state, playerId, offices), new Map([[fact.id, 90]]), new Map([[fact.id, actor.characterId]]))).toBe(false);
  });
  it("asks for a newly due plan step before the routine review, and does not ask it twice", () => {
    const { world, actor, policy } = setup();
    policy.remember(actor, world, []);
    const state = atDay(world, 2);
    const due = [{ ownerId: actor.characterId, ambitionId: "embassy", stepId: "send-envoys", why: "the next step is due" }];
    const interests = playerInterests(state, playerId, offices);
    expect(policy.shouldAsk(actor, state, interests, new Map(), new Map(), due)).toBe(true);
    policy.remember(actor, state, [], due);
    expect(policy.shouldAsk(actor, atDay(world, 3), interests, new Map(), new Map(), due)).toBe(false);
  });
});
