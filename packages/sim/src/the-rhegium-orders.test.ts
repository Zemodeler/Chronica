import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, OrderPartSchema, goalMet, orderPartStatus, settlePeaceTalks, type WorldState } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import { explicitOrderGoals } from "./mission-intent";
import { orderOutcomeLines } from "./order-outcomes";
import { composeChronicle } from "./chronicle";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { keepPromises, keptOnTheRecord } from "./promises";
import type { SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = () => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const ACTOR = "gaius-genucius";
const ORDER = "Find and kill the Campanian Legion. Send 2000 men to start claiming the territory owned by them.";

describe("the Rhegium orders require their actual outcomes", () => {
  it("does not complete an unexecuted order because an associated fact exists", () => {
    const part = OrderPartSchema.parse({ said: "Kill the Campanian legion despite the agreed safe passage.", factIds: ["fact-march"], whyNot: "The army holds instead." });
    expect(orderPartStatus(opening(), part)).toBe("unanswered");
    const legacy = OrderPartSchema.parse({ ...part, goals: [{ kind: "exists", of: "force", id: "roman-field-army" }], actsCarried: 2 });
    expect(orderPartStatus(opening(), legacy)).not.toBe("achieved");
  });

  it("does not complete a kill order by putting the Roman army on hold", async () => {
    const port: SimModelPort = { complete: (operation) => Promise.resolve(operation === "simulate_orchestrate" ? JSON.stringify({
      intent: { summary: ORDER, domains: ["military"], parts: [
        { said: "Find and kill the Campanian Legion.", acts: [0], whyNot: "Rome guarantees safe passage, so the army holds instead." },
        { said: "Send 2,000 men to start claiming the territory owned by them.", acts: [], whyNot: "They watch the approaches instead." },
      ] },
      narrativeSummary: "The army holds at Rhegium.", frictions: [],
      deltas: [{ op: "force_modify", forceRef: "roman-field-army", hold: true, reason: "Hold rather than attack the Campanian Legion." }],
      facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
    }) : JSON.stringify({ actors: [] })) };
    const result = await runSimulationBurst({ world: opening(), clock: definition.clock, offices: definition.government.offices,
      warfare: definition.warfare, burstId: "rhegium-proof", gameId: "rhegium-proof", actorRef: { kind: "character", id: ACTOR },
      actorPolityId: "rome", orderText: ORDER, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1 });
    const order = result.world.orders.find((record) => record.id === result.orderRecordId)!;
    expect(order.parts[0]!.goals).toContainEqual(expect.objectContaining({ kind: "force_killed", forceId: "campanian-legion" }));
    expect(orderPartStatus(result.world, order.parts[0]!)).not.toBe("achieved");
    expect(orderPartStatus(result.world, order.parts[1]!)).not.toBe("achieved");
    expect(orderOutcomeLines(result.world, order.id).some((line) => line.includes("-- done"))).toBe(false);
    expect(result.world.material.forces.find((force) => force.id === "campanian-legion")!.personnel[0]!.fit).toBeGreaterThan(0);
    expect(result.newFacts.some((fact) => fact.kind === "order_part_unanswered" && fact.summary.includes("Find and kill"))).toBe(true);
  });

  it("requires deaths, rather than capture or disappearance, to prove a killing", () => {
    const world = opening();
    const goal = explicitOrderGoals(world, "Find and kill the Campanian Legion.", ORDER, "rome")[0]!;
    expect(goalMet(world, goal)).toBe("not_yet");
    const target = world.material.forces.find((force) => force.id === "campanian-legion")!;
    const count = target.personnel.reduce((sum, row) => sum + row.fit, 0);
    const lost = (kind: "capture" | "battle_death"): WorldState => ({ ...world, material: { ...world.material,
      forces: world.material.forces.map((force) => force.id === target.id ? { ...force,
        personnel: force.personnel.map((row) => ({ ...row, fit: 0, unavailable: [] })),
        history: [{ id: "loss", kind, atStep: world.elapsedStep, count, categoryId: "infantry", causeId: "battle" }],
      } : force) } });
    expect(goalMet(lost("capture"), goal)).toBe("not_yet");
    expect(goalMet(lost("battle_death"), goal)).toBe("met");
    expect(goalMet({ ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.id !== target.id) } }, goal)).toBe("impossible");
  });

  it("does not turn a prohibition on killing into a killing goal", () => {
    expect(explicitOrderGoals(opening(), "Do not kill the Campanian Legion.", ORDER, "rome")).toEqual([]);
  });

  it("keeps safe passage pending until the garrison has actually left unharmed", () => {
    const world = opening();
    const target = world.material.forces.find((force) => force.id === "campanian-legion")!;
    const destination = world.map.provinces.find((province) => province.id !== target.locationId)!.id;
    const promise: WorldState["commitments"][number] = {
      id: "safe-passage", promisorCharacterId: ACTOR, beneficiaryCharacterId: "decius-vibellius", actionKind: "protection",
      description: "Under the treaty: Grant safe passage upon the garrison's withdrawal.", conditions: "", form: "do",
      completionGoals: [{ kind: "safe_passage", forceId: target.id, fromProvinceId: target.locationId, sinceStep: 0 }],
      requiredOfficeId: null, requiredResource: null, visibility: "public", sourceEventId: "peace-rhegium", breachPressureKind: "political_danger",
      status: "prepared", createdAtStep: 0, reviewAtStep: 30, resolvedAtStep: null, resolutionReason: null,
    };
    world.material.forces = world.material.forces.map((force) => force.id === "roman-field-army" ? { ...force, locationId: target.locationId } : force);
    world.commitments = [promise];
    expect(keptOnTheRecord(world, promise)).toBeNull();
    const stillThere = keepPromises({ world, toDay: 60, playerCharacterId: ACTOR });
    expect(stillThere.world.commitments[0]!.status).toBe("prepared");
    expect(stillThere.facts.some((fact) => fact.kind === "promise_kept" || fact.kind === "promise_broken")).toBe(false);
    const departed = { ...world, material: { ...world.material,
      forces: world.material.forces.map((force) => force.id === target.id ? { ...force, locationId: destination } : force) } };
    expect(keepPromises({ world: departed, toDay: 60, playerCharacterId: ACTOR }).world.commitments[0]!.status).toBe("fulfilled");
    const harmed = { ...departed, material: { ...departed.material, forces: departed.material.forces.map((force) => force.id === target.id ? {
      ...force, history: [{ id: "unsafe-loss", kind: "battle_death" as const, atStep: 40, count: 1, categoryId: "infantry", causeId: "attack" }],
    } : force) } };
    expect(keptOnTheRecord(harmed, promise)).toBeNull();
  });

  it("does not publish an invented killing when the order is unmet", async () => {
    const world = opening();
    const part = OrderPartSchema.parse({ said: "Find and kill the Campanian Legion.", whyNot: "The legion remains alive." });
    world.orders = [{ id: "rhegium-order", actorCharacterId: ACTOR, text: part.said, givenAtStep: 0, parts: [part] }];
    const port: SimModelPort = { complete: () => Promise.resolve(JSON.stringify({ entries: [{ thread: 0,
      title: "The Campanian Legion was killed", body: "The Campanian Legion was found and killed.", quote: null }] })) };
    const result = await composeChronicle({ port, clock: definition.clock, observer: { kind: "character", id: ACTOR }, observerPolityId: "rome",
      world, facts: [{ id: "hold-fact", time: world.instant, atStep: 0, kind: "order_part_unanswered", summary: "Legio I holds; the Campanian Legion remains alive.",
        affectedEntities: [{ kind: "character", id: ACTOR }], resourceChanges: [], visibility: "public",
        discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null, eligibleReactionScopes: [],
        sourceEventId: null, sourceActionId: "rhegium-order-p0", causalDepth: 0 }],
      from: world.instant, to: world.instant, narrative: [], frictions: [], orderFactIds: new Set(["hold-fact"]),
      orderOutcome: () => ({ line: '"Find and kill the Campanian Legion." -- nothing came of it: The legion remains alive.', status: "unanswered" }) });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.body).toContain("remains alive");
    expect(result.entries[0]!.body).not.toContain("was found and killed");
    expect(result.entries[0]!.title).not.toContain("was killed");
  });
});

function settledWorld(): WorldState {
  const world = opening();
  const base = { fromPolityId: "rhegium-campanians", fromCharacterId: "decius-vibellius", toPolityId: "rome", toCharacterId: ACTOR,
    sentAtStep: 2, deliveredOnDay: 17, replyDueByStep: 47, status: "awaiting_reply" as const, answer: null, answerText: null,
    answeredAtStep: null, inReplyToMessageId: null, visibility: "polity" as const, agreementId: null };
  world.diplomacy = [
    { ...base, id: "old-talks", kind: "peace_talks", subject: "Terms to end the war over Rhegium", terms: "Will Rome grant safe passage in return for Rhegium?" },
    { ...base, id: "accepted-offer", kind: "peace_offer", subject: "Safe passage with the return of Rhegium", terms: "Rhegium returns; the garrison leaves alive.",
      sentAtStep: 17, status: "answered", answer: "accepted", answerText: "Rome accepts.", answeredAtStep: 32, agreementId: "peace-rhegium" },
  ];
  world.polityAgreements = [{ id: "peace-rhegium", kind: "peace", polityId: "rome", otherPolityId: "rhegium-campanians", terms: "Safe passage and restoration.",
    sinceStep: 32, untilStep: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public", sourceMessageId: "accepted-offer" }];
  return world;
}

describe("an accepted settlement closes the earlier request for peace talks", () => {
  it("does not let the old request lapse as Rome refusing peace by silence", () => {
    const world = settledWorld();
    const result = runDeterministicTick({ world: { ...world, elapsedStep: 47, instant: { day: 47, minute: 0 } }, toDay: 47,
      ids: createIdFactory("rhegium-letters"), playerCharacterId: ACTOR, warfare: definition.warfare });
    const message = result.world.diplomacy.find((letter) => letter.id === "old-talks")!;
    expect(message.answer).toBe("accepted");
    expect(message.agreementId).toBe("peace-rhegium");
    expect(message.answerText).toContain("Resolved by");
    expect(result.factProposals.some((fact) => fact.kind === "diplomatic_silence" && fact.summary.includes("Terms to end the war over Rhegium"))).toBe(false);
  });

  it("leaves new talks, other parties and independent demands open", () => {
    const world = settledWorld();
    const old = world.diplomacy[0]!;
    world.diplomacy.push({ ...old, id: "new-talks", sentAtStep: 33 },
      { ...old, id: "other-party", fromPolityId: "syracuse" },
      { ...old, id: "different-demand", kind: "tribute_demand", terms: "Pay us tribute." });
    const result = settlePeaceTalks(world);
    expect(result.diplomacy.filter((letter) => ["new-talks", "other-party", "different-demand"].includes(letter.id)).every((letter) => letter.status === "awaiting_reply")).toBe(true);
  });
});
