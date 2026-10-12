import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { OrderAttemptSchema, OrderPartSchema, ScenarioDefinitionSchema, WorldStateSchema, answerDueOf, type OrderAttempt, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput } from "./burst";
import { withACast } from "./askable-test-kit";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * A decision the processing could not pay for is preserved, never made for
 * the man, and taken up when it can be paid for.
 *
 * The world used to stop waiting for an owed man after two bursts and have
 * the rules answer the request put to him, as though he had chosen: a short
 * budget, a provider down or a turn out of time became his refusal in the
 * record. Now an owed turn stands as long as its reason does, survives a
 * save, holds the request's day ahead of the calendar, and is cleared only
 * by his own answer -- or by his death. Meanwhile what the order holds for
 * its moment -- money, ships, a crossing, a report -- waits on the world, and
 * what the world has made ready is done by the rules without a call.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const PLAYER = "marcus-atilius";
const world = (): WorldState => withACast(WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld)), PLAYER);

const ORDER = JSON.stringify({
  intent: { summary: "Hold the line.", domains: ["military"], parts: [] },
  narrativeSummary: "The consul holds his ground.", frictions: [], deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
});

function port(asked: SimOperation[], cognition: () => Promise<string> = () => Promise.resolve(JSON.stringify({ actors: [] }))): SimModelPort {
  return {
    complete(operation) {
      asked.push(operation);
      if (operation === "simulate_orchestrate") return Promise.resolve(ORDER);
      if (operation === "simulate_cognition") return cognition();
      return Promise.resolve("{}");
    },
  };
}

const input = (base: WorldState, model: SimModelPort, overrides: Partial<BurstInput> = {}): BurstInput => ({
  world: base, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "owed", gameId: "game-owed",
  actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: "Hold the line.", knownFacts: [], queue: [], port: model, narratorSeeds: [], spanDays: 1,
  ...overrides,
});

/** A request put to the first man of the cast, unanswered. */
function asking(base: WorldState, id = "attempt-waiting"): { world: WorldState; recipient: string; attempt: OrderAttempt } {
  const recipient = base.cast.members[0]!.characterId;
  const attempt = OrderAttemptSchema.parse({
    id, actionId: `action-${id}`, issuerRef: { kind: "character", id: PLAYER }, recipientRef: { kind: "character", id: recipient },
    authorityCheck: { authorized: true, grant: null, standing: null, reason: "asked" }, instruction: "Send word of the harbour at Rhegium.", status: "issued", issuedAtStep: base.elapsedStep,
  });
  return { world: { ...base, orderAttempts: [...base.orderAttempts, attempt] }, recipient, attempt };
}

const starved = { ...DEFAULT_BUDGET, maxModelCalls: 1, maxMechanicCalls: 0 };
const attemptOf = (state: WorldState, id: string): OrderAttempt => state.orderAttempts.find((attempt) => attempt.id === id)!;
/** The world as a save would hold it: through the wire and the schema. */
const reloaded = (state: WorldState): WorldState => WorldStateSchema.parse(JSON.parse(JSON.stringify(state)));
const WAITING = ["issued", "received", "delayed"];

describe("a turn the budget could not pay for", () => {
  it("is owed for the budget, with the request left open and its day held ahead of the calendar", async () => {
    const { world: base, recipient, attempt } = asking(world());
    const result = await runSimulationBurst(input(base, port([]), { spanDays: undefined, budget: starved }));
    expect(result.stopReason).toBe("budget_exhausted");
    const owed = result.world.owed.find((entry) => entry.characterId === recipient);
    expect(owed?.cause).toBe("budget");
    const after = attemptOf(result.world, attempt.id);
    expect(WAITING).toContain(after.status);
    expect(answerDueOf(after)).toBeGreaterThan(result.world.elapsedStep);
  });

  it("is kept across a save and a long wait of bursts without ever becoming his refusal", async () => {
    const { world: base, recipient, attempt } = asking(world());
    let state = base;
    let facts = 0;
    for (let burst = 0; burst < 4; burst += 1) {
      const result = await runSimulationBurst(input(reloaded(state), port([]), { spanDays: undefined, budget: starved, burstId: `starved-${burst}` }));
      facts += result.newFacts.filter((fact) => fact.affectedEntities.some((entity) => entity.id === recipient) && /refus|declin|would not/i.test(fact.summary)).length;
      state = result.world;
      const owed = state.owed.find((entry) => entry.characterId === recipient);
      expect(owed, `burst ${burst}`).toBeDefined();
      expect(owed!.bursts).toBe(burst);
      expect(WAITING).toContain(attemptOf(state, attempt.id).status);
    }
    expect(facts).toBe(0);
  });

  it("is taken up in the next burst that can pay: he is asked first, and the owed turn is cleared", async () => {
    const { world: base, recipient } = asking(world());
    const first = await runSimulationBurst(input(base, port([]), { spanDays: undefined, budget: starved }));
    expect(first.world.owed.some((entry) => entry.characterId === recipient)).toBe(true);
    const sections: string[] = [];
    const asked: SimOperation[] = [];
    const model: SimModelPort = {
      complete(operation, _system, message) {
        asked.push(operation);
        if (operation === "simulate_orchestrate") return Promise.resolve(ORDER);
        if (operation === "simulate_cognition") sections.push(message);
        return Promise.resolve(JSON.stringify({ actors: [] }));
      },
    };
    const second = await runSimulationBurst(input(reloaded(first.world), model, { burstId: "paid" }));
    expect(asked).toContain("simulate_cognition");
    expect(sections.some((text) => text.includes(recipient))).toBe(true);
    expect(second.world.owed.some((entry) => entry.characterId === recipient)).toBe(false);
  });
});

describe("a turn the provider could not answer", () => {
  it("owes the man asked for the provider's failure, and leaves his request open", async () => {
    const { world: base, recipient, attempt } = asking(world());
    const asked: SimOperation[] = [];
    const result = await runSimulationBurst(input(base, port(asked, () => Promise.reject(new Error("provider down")))));
    expect(asked).toContain("simulate_cognition");
    expect(result.world.owed.find((entry) => entry.characterId === recipient)?.cause).toBe("provider");
    expect(result.skipped.some((skip) => /provider's answer could not be read/.test(skip.reason))).toBe(true);
    expect(WAITING).toContain(attemptOf(result.world, attempt.id).status);
  });
});

describe("a turn whose time ran out", () => {
  it("still asks the man a request waits on, or owes him his turn for the time: his request stays open across a save, answered by nobody for him", async () => {
    const { world: base, recipient, attempt } = asking(world());
    const sections: string[] = [];
    const model: SimModelPort = {
      complete(operation, _system, message) {
        if (operation === "simulate_orchestrate") return Promise.resolve(ORDER);
        if (operation === "simulate_cognition") sections.push(message);
        return Promise.resolve(JSON.stringify({ actors: [] }));
      },
    };
    const result = await runSimulationBurst(input(base, model, { spanDays: 7, outOfTime: () => true }));
    // The turn's time is spent before the first round: those an answer is owed by are still asked
    // first, and anyone it could not reach is owed his turn for the time -- never answered for.
    const askedHim = sections.some((text) => text.includes(recipient));
    const owed = result.world.owed.find((entry) => entry.characterId === recipient);
    expect(askedHim || owed?.cause === "time").toBe(true);
    const after = attemptOf(reloaded(result.world), attempt.id);
    expect(WAITING).toContain(after.status);
    expect(answerDueOf(after)).toBeGreaterThan(result.world.elapsedStep);
    expect(result.newFacts.filter((fact) => fact.affectedEntities.some((entity) => entity.id === recipient) && /refus|declin|would not/i.test(fact.summary))).toEqual([]);
    // Later hops pass on the engine's rules: routine decisions go on, and are said to.
    expect(result.skipped.some((skip) => /routine decisions continue on engine rules|the turn's time is spent/.test(skip.reason))).toBe(true);
  });

  it("does not owe a turn to a man with nothing of his own waiting: routine quiet days pass without him", async () => {
    const base = world();
    const inCast = new Set(base.cast.members.map((member) => member.characterId));
    const idle = base.characters.find((character) => character.alive && character.id !== PLAYER && !inCast.has(character.id))!.id;
    const result = await runSimulationBurst(input(base, port([]), { spanDays: 7, outOfTime: () => true }));
    expect(result.world.owed.some((entry) => entry.characterId === idle)).toBe(false);
  });
});

describe("a turn whose reason is gone", () => {
  it("is let go when the man is dead, and his request is answered as a dead man's", async () => {
    const { world: base, recipient, attempt } = asking(world());
    const first = await runSimulationBurst(input(base, port([]), { spanDays: undefined, budget: starved }));
    const dead: WorldState = { ...first.world, characters: first.world.characters.map((character) => (character.id === recipient ? { ...character, alive: false, diedAtStep: first.world.elapsedStep } : character)) };
    const second = await runSimulationBurst(input(reloaded(dead), port([]), { spanDays: undefined, budget: starved, burstId: "dead" }));
    expect(second.world.owed.some((entry) => entry.characterId === recipient)).toBe(false);
    expect(WAITING).not.toContain(attemptOf(second.world, attempt.id).status);
  });

  it("is let go, with nothing answered for him, once nothing readable of his still waits", async () => {
    const base = world();
    const inCast = new Set(base.cast.members.map((member) => member.characterId));
    const idle = base.characters.find((character) => character.alive && character.id !== PLAYER && !inCast.has(character.id))!.id;
    const owedForNothing: WorldState = { ...base, owed: [{ characterId: idle, why: "his promise's day", sinceStep: base.elapsedStep, bursts: 1 }] };
    const result = await runSimulationBurst(input(owedForNothing, port([]), { spanDays: undefined, budget: starved }));
    expect(result.world.owed.some((entry) => entry.characterId === idle)).toBe(false);
    expect(result.skipped.some((skip) => /owed turn\(s\) let go/.test(skip.reason))).toBe(true);
  });
});

describe("what the order holds for its moment, while the processing is short", () => {
  const stage = (held: Record<string, unknown>, waitsOn: Record<string, unknown>[], base: WorldState) => ({ held, waitsOn, status: "waiting" as const, reason: null, heldSinceStep: base.elapsedStep, failedAtStep: null, reviewAtStep: base.elapsedStep + 20 });
  /** The player's own purse, and another man's: a transfer his to make, waiting only on the money. */
  const purses = (base: WorldState) => {
    const consul = base.characters.find((character) => character.id === PLAYER)!;
    const other = base.characters.find((character) => character.alive && character.id !== PLAYER && character.personalAccountId !== null)!;
    const purse = base.material.accounts.find((account) => account.id === consul.personalAccountId)!;
    return { purse, to: other.personalAccountId };
  };

  it("keeps a crossing waiting on ships, a march on an arrival and a payment on funds: none fails for want of a call", async () => {
    const base = world();
    const legion = base.material.forces.find((force) => force.polityId === "rome")!;
    const far = base.map.provinces.find((province) => province.id !== legion.locationId)!;
    const { purse, to } = purses(base);
    const parts = [
      OrderPartSchema.parse({ said: "Carry the legion over", stages: [stage({ op: "force_modify", forceRef: legion.id, locationId: far.id, reason: "x" }, [{ kind: "transport_capacity", forceId: legion.id, provinceId: far.id }], base)] }),
      OrderPartSchema.parse({ said: "Then lay siege", stages: [stage({ op: "siege_lay", forceRef: legion.id, settlementId: null, reason: "x" }, [{ kind: "force_at", forceId: legion.id, provinceId: far.id }], base)] }),
      OrderPartSchema.parse({ said: "Pay the shipwrights", stages: [stage({ op: "money_transfer", fromAccountRef: purse.id, toAccountRef: to, amount: 50, reason: "x" }, [{ kind: "funds", accountId: purse.id, amount: purse.balance + 1_000_000 }], base)] }),
    ];
    const withOrder: WorldState = { ...base, orders: [{ id: "rec-held", actorCharacterId: PLAYER, text: "x", givenAtStep: base.elapsedStep, parts }] };
    const result = await runSimulationBurst(input(withOrder, port([]), { spanDays: undefined, budget: starved }));
    const after = result.world.orders.find((order) => order.id === "rec-held")!;
    for (const part of after.parts) {
      expect(part.stages[0]!.status, part.said).toBe("waiting");
      expect(part.refusal, part.said).toBeNull();
      expect(part.closedAtStep, part.said).toBeNull();
    }
  });

  it("does what the world has made ready by the rules, with no call: the payment goes once the purse holds it", async () => {
    const base = world();
    const { purse, to } = purses(base);
    const part = OrderPartSchema.parse({ said: "Pay the shipwrights", stages: [stage({ op: "money_transfer", fromAccountRef: purse.id, toAccountRef: to, amount: 5, reason: "x" }, [{ kind: "funds", accountId: purse.id, amount: 5 }], base)] });
    const withOrder: WorldState = { ...base, orders: [{ id: "rec-paid", actorCharacterId: PLAYER, text: "x", givenAtStep: base.elapsedStep, parts: [part] }] };
    const asked: SimOperation[] = [];
    const result = await runSimulationBurst(input(withOrder, port(asked), { spanDays: undefined, budget: starved }));
    expect(asked).toEqual(["simulate_orchestrate"]);
    const after = result.world.orders.find((order) => order.id === "rec-paid")!.parts[0]!;
    expect(after.stages[0]!.status).toBe("resumed");
    expect(after.stages[0]!.resumedAtStep).toBeGreaterThanOrEqual(base.elapsedStep);
    expect(after.actsDone).toBe(1);
  });

  it("keeps a report owed by a delegate who could not be asked: his order stays taken up, not abandoned, and he is owed his turn for it", async () => {
    const base = world();
    const recipient = base.cast.members[0]!.characterId;
    const attempt = OrderAttemptSchema.parse({
      id: "attempt-report", actionId: "action-report", issuerRef: { kind: "character", id: PLAYER }, recipientRef: { kind: "character", id: recipient },
      authorityCheck: { authorized: true, grant: null, standing: null, reason: "asked" }, instruction: "Send word of the harbour at Rhegium.", status: "accepted", issuedAtStep: base.elapsedStep, decidedAtStep: base.elapsedStep, servesRef: "rec-report-p0",
    });
    const part = OrderPartSchema.parse({ said: "Send word of the harbour at Rhegium", workRefs: [{ kind: "order_attempt", id: attempt.id, madeAtStep: base.elapsedStep, op: "order_attempt_issue", by: "act" }] });
    const withOrder: WorldState = { ...base, orderAttempts: [...base.orderAttempts, attempt], orders: [{ id: "rec-report", actorCharacterId: PLAYER, text: "x", givenAtStep: base.elapsedStep, parts: [part] }] };
    const result = await runSimulationBurst(input(withOrder, port([]), { spanDays: undefined, budget: starved }));
    expect(attemptOf(result.world, attempt.id).status).toBe("accepted");
    expect(result.world.owed.find((entry) => entry.characterId === recipient)?.cause).toBe("budget");
    // And a save later, still owed, still taken up.
    const again = await runSimulationBurst(input(reloaded(result.world), port([]), { spanDays: undefined, budget: starved, burstId: "report-2" }));
    expect(attemptOf(again.world, attempt.id).status).toBe("accepted");
    expect(again.world.owed.some((entry) => entry.characterId === recipient)).toBe(true);
  });
});
