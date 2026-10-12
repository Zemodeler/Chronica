import { describe, expect, it } from "vitest";
import { PUNIC_IDS, punicWarsScenario } from "@chronica/db";
import { OrderPartSchema, ScenarioDefinitionSchema, effectsOf, type OrderPart, type OrderPartyRef, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput } from "./burst";
import { composeChronicle } from "./chronicle";
import { factContradictsState } from "./fact-parity";
import { opening } from "./fiscal-test-kit";
import { lineOf, toldOutcome } from "./order-outcomes";
import type { SimModelPort, SimOperation } from "./ports";
import { factsNamingRefusals } from "./reconcile-facts";
import { evidenceOfDone, scoreToldPart } from "./scorecard";

/**
 * The causal links an order's record keeps, end to end: an act the world
 * applied stamps the work it made with the day and the op, and is kept on the
 * part as an applied effect; a held act resumed is dated to the day it was
 * taken up; a ref to a thing that stood before the order carries no such
 * stamp. The outcome line and the scorecard read these, and nothing else, for
 * "done". And a fact that claims what the world can check -- an army raised,
 * a sum paid -- is held to the applied effects of its day.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const CONSUL = "gaius-genucius";
const LEGION = "roman-field-army";

const answer = (change: Record<string, unknown>): string => JSON.stringify({
  narrativeSummary: "Done as ordered.", frictions: [], deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  intent: { summary: "The order.", domains: ["military"], parts: [] },
  ...change,
});

function scripted(orchestrate: string): SimModelPort & { asked: SimOperation[] } {
  const port = {
    asked: [] as SimOperation[],
    complete(operation: SimOperation) {
      port.asked.push(operation);
      if (operation === "simulate_orchestrate") return Promise.resolve(orchestrate);
      if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.resolve("{}");
    },
  };
  return port;
}

const input = (world: WorldState, port: SimModelPort, orderText: string, burstId: string): BurstInput => ({
  world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId, gameId: "game-causal",
  actorRef: { kind: "character", id: CONSUL }, actorPolityId: "rome", orderText, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1,
});

const commanderFor = (world: WorldState): string => world.characters.find((character) => character.alive && character.polityId === "rome" && character.id !== CONSUL
  && !world.material.forces.some((force) => force.commanderCharacterId === character.id))!.id;

describe("an act of the order stamps the work it made", () => {
  it("keeps the army the order raised as the part's own, dated and by its op, and tells the part done on it", async () => {
    const world = opening(150);
    const raise = answer({
      intent: { summary: "Raise an army.", domains: ["military"], parts: [{ said: "Raise an army called Legio Nova", acts: [0], goals: [], spend: null, factLocalIds: [], whyNot: null }] },
      deltas: [{ op: "force_create", localId: "nova", name: "Legio Nova", polityId: "rome", commanderCharacterRef: commanderFor(world), controllerCharacterRef: CONSUL, locationId: PUNIC_IDS.rome, authorizedStrength: 4000, payObligationRef: null, reason: "The consul raises a second legion." }],
    });
    const result = await runSimulationBurst(input(world, scripted(raise), "Raise an army called Legio Nova", "raise"));
    const order = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const part = order.parts[0]!;
    const ref = part.workRefs.find((candidate) => candidate.kind === "force");
    expect(ref).toBeDefined();
    expect(ref!.op).toBe("force_create");
    expect(ref!.by).toBe("act");
    expect(ref!.madeAtStep).toBe(order.givenAtStep);
    const made = effectsOf(part).find((effect) => effect.op === "force_create");
    expect(made).toBeDefined();
    expect(made!.refs).toContainEqual({ kind: "force", id: ref!.id });
    expect(made!.atStep).toBe(order.givenAtStep);
    expect(result.world.material.forces.find((force) => force.id === ref!.id)?.name).toBe("Legio Nova");
    // The outcome, the line and the scorecard all read it.
    expect(toldOutcome(result.world, part, CONSUL).status).toBe("achieved");
    expect(lineOf(result.world, part, CONSUL)).toMatch(/-- done/);
    expect(evidenceOfDone(result.world, part, CONSUL)).toBe(true);
    expect(scoreToldPart(result.world, part, CONSUL).doneWithoutEvidence).toBe(false);
    // And the record loads again as written.
    expect(() => OrderPartSchema.parse(JSON.parse(JSON.stringify(part)))).not.toThrow();
  });

  it("does not tell an army raised when the order's act only touched the army that stood before it", async () => {
    const world = opening(150);
    const touch = answer({
      intent: { summary: "Raise an army.", domains: ["military"], parts: [{ said: "Raise an army called Roman field army", acts: [0], goals: [], spend: null, factLocalIds: [], whyNot: null }] },
      deltas: [{ op: "force_modify", forceRef: LEGION, drilling: true, reason: "The consul sets the army to drill." }],
    });
    const result = await runSimulationBurst(input(world, scripted(touch), "Raise an army called Roman field army", "touch"));
    const order = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const part = order.parts[0]!;
    expect(part.workRefs.some((ref) => ref.kind === "force" && ref.op === "force_create")).toBe(false);
    expect(effectsOf(part).some((effect) => effect.op === "force_create")).toBe(false);
    expect(toldOutcome(result.world, part, CONSUL).status).not.toBe("achieved");
    expect(lineOf(result.world, part, CONSUL)).not.toMatch(/-- done/);
    expect(scoreToldPart(result.world, part, CONSUL, `"${part.said}" -- done.`).doneWithoutEvidence).toBe(true);
  });

  it("dates a held act to the day it was taken up again, and keeps what it did as the part's evidence", async () => {
    const world0 = opening(150);
    const consul = world0.characters.find((character) => character.id === CONSUL)!;
    const treasury = world0.material.accounts.find((account) => account.id === "rome-treasury")!;
    const held: OrderPart = OrderPartSchema.parse({
      said: "Pay the consul 50 once the chest holds it",
      stages: [{ held: { op: "money_transfer", fromAccountRef: treasury.id, toAccountRef: consul.personalAccountId, amount: 50, reason: "The sum the order allowed." }, waitsOn: [{ kind: "funds", accountId: treasury.id, amount: 1 }], status: "waiting", reason: null, heldSinceStep: 140, failedAtStep: null, reviewAtStep: 300 }],
    });
    const world: WorldState = { ...world0, orders: [{ id: "rec-held", actorCharacterId: CONSUL, text: "x", givenAtStep: 140, parts: [held] }] };
    const result = await runSimulationBurst(input(world, scripted(answer({})), "Nothing new.", "resume"));
    const part = result.world.orders.find((candidate) => candidate.id === "rec-held")!.parts[0]!;
    const stage = part.stages[0]!;
    expect(stage.status).toBe("resumed");
    // Taken up on a day of the burst, and dated to it -- not to the order's day, nor to the burst's end.
    expect(stage.resumedAtStep).toBeGreaterThanOrEqual(150);
    expect(stage.resumedAtStep).toBeLessThanOrEqual(result.world.elapsedStep);
    const effect = effectsOf(part).find((candidate) => candidate.op === "money_transfer");
    expect(effect?.by).toBe("stage");
    expect(effect?.atStep).toBe(stage.resumedAtStep);
    expect(effect?.refs).toContainEqual({ kind: "account", id: treasury.id });
    expect(part.actsDone).toBe(1);
    expect(result.world.material.transactions.some((transaction) => transaction.atStep === stage.resumedAtStep && transaction.sourceAccountId === treasury.id && transaction.amount === 50)).toBe(true);
  });

  it("stamps the delegation a part handed on, and marks a guess as one", async () => {
    const world = opening(150);
    const recipient = commanderFor(world);
    const handed = answer({
      intent: { summary: "Find bread.", domains: ["military"], parts: [
        { said: "Find bread for the army", acts: [], goals: [], spend: null, factLocalIds: [], whyNot: null },
        { said: "Write to Hiero of Syracuse", acts: [], goals: [], spend: null, factLocalIds: [], whyNot: null },
      ] },
      delegations: [{ localId: "d1", issuerRef: { kind: "character", id: CONSUL }, recipientRef: { kind: "character", id: recipient }, claimedAuthorityGrantRef: null, instruction: "Find bread for the army.", part: 0 }],
    });
    const result = await runSimulationBurst(input(world, scripted(handed), "Find bread for the army; write to Hiero of Syracuse.", "hand"));
    const order = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const ref = order.parts[0]!.workRefs.find((candidate) => candidate.kind === "order_attempt");
    expect(ref?.by).toBe("act");
    expect(ref?.madeAtStep).toBe(order.givenAtStep);
    expect(result.world.orderAttempts.find((attempt) => attempt.id === ref?.id)?.servesRef).toBe(`${order.id}-p0`);
  });
});

describe("a fact that claims what the world can check", () => {
  const where = (forceId: string, state: WorldState) => new Set([state.material.forces.find((force) => force.id === forceId)!.locationId]);

  it("is held to the army it says was raised", () => {
    const state = opening(150);
    const raised = { kind: "levy", summary: "A new legion was raised at Capua.", affectedRefs: [{ kind: "force", id: "no-such-legion" }] as OrderPartyRef[] };
    expect(factContradictsState(state, raised, (id) => where(id, state))).toMatch(/no such army stands/);
    expect(factContradictsState(state, { ...raised, affectedRefs: [{ kind: "force", id: LEGION }] }, (id) => where(id, state))).toBeNull();
    expect(factContradictsState(state, { ...raised, summary: "No legion was raised at Capua." }, (id) => where(id, state))).toBeNull();
  });

  it("is held to the money that moved on its day, when told the day", () => {
    const state = opening(150);
    const treasury = state.material.accounts.find((account) => account.id === "rome-treasury")!;
    const paid = { kind: "payment", summary: "The treasury paid 5,000 to the shipwrights.", affectedRefs: [{ kind: "account", id: treasury.id }] as OrderPartyRef[] };
    expect(factContradictsState(state, paid, () => new Set(), { atStep: 150 })).toMatch(/no money moved/);
    const moved: WorldState = { ...state, material: { ...state.material, transactions: [...state.material.transactions, { ...state.material.transactions[0]!, id: "tx-paid", atStep: 150, sourceAccountId: treasury.id, amount: 5000 }] } };
    expect(factContradictsState(moved, paid, () => new Set(), { atStep: 150 })).toBeNull();
    // Without the day there is nothing to hold it to, and it passes as before.
    expect(factContradictsState(state, paid, () => new Set())).toBeNull();
  });
});

describe("facts asked about with the acts they depended on", () => {
  it("names a fact about what a refusal's own reason names: the army a dependent act could not find", () => {
    const facts = [{ localId: "a", summary: "The tribune took command.", affectedRefs: [{ id: "legio-nova" }], storylineRef: null }];
    expect(factsNamingRefusals(facts, [{ delta: { op: "force_modify", forceRef: "local:phantom" }, reason: "No force legio-nova exists." }])).toHaveLength(1);
    expect(factsNamingRefusals(facts, [{ delta: { op: "force_modify", forceRef: "local:phantom" }, reason: "No such force." }])).toHaveLength(0);
  });
});

const clock = definition.clock;
let factCounter = 0;
const factOf = (summary: string, affectedEntities: OrderPartyRef[], secret = false) => ({
  id: `fact-${(factCounter += 1)}`, time: { day: 0, minute: 0 }, atStep: 0, kind: "event", summary, affectedEntities, resourceChanges: [], authorityChange: undefined,
  visibility: secret ? "private" as const : "public" as const, discovery: { state: secret ? "private" as const : "public" as const, knowableAtInstant: null, discoveredBy: [] },
  evidence: null, eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0,
});

describe("the historian's passage and the part as it stood", () => {
  const ordered = { ...factOf("The consul ordered the legion carried over.", [{ kind: "character", id: CONSUL }]), sourceActionId: "order-1-p0" };
  const compose = (body: string, outcome: { status: "unanswered" | "achieved" | "failed"; before?: "unanswered" | "achieved" | null }, said: string | null = null) => composeChronicle({
    port: { complete: () => Promise.resolve(JSON.stringify({ entries: [{ thread: 1, title: "The crossing", body }] })) },
    clock, observer: { kind: "character", id: CONSUL }, observerPolityId: "rome",
    facts: [ordered],
    from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
    // Words the man is recorded saying in the matter, which the historian may print as the passage's quotation.
    utterances: said === null ? [] : [{ actorRef: { kind: "character", id: CONSUL }, speaker: "Gaius Genucius Clepsina", line: said, occasion: "to the Senate", factIds: [ordered.id] }],
    orderOutcome: () => ({ line: '"Carry the legion over" -- failed.', ...outcome }),
  });

  it("is judged against the part as it stood when the window opened, not only when it closed", async () => {
    // Landed on the third day, broken on the ninth: the passage saying it landed is not an overclaim.
    expect((await compose("The legion landed at Messana on the third day.", { status: "failed", before: "achieved" })).inspection!.overstated).toBe(0);
    // Never landed within the window: it is.
    expect((await compose("The legion landed at Messana on the third day.", { status: "failed", before: "unanswered" })).inspection!.overstated).toBe(1);
    expect((await compose("The legion landed at Messana on the third day.", { status: "failed" })).inspection!.overstated).toBe(1);
  });

  it("drops a recorded quotation that claims the thing done, and counts it; keeps one that does not", async () => {
    const boast = await compose("The consul waited at Rhegium for ships that did not come.", { status: "unanswered" }, "The legion landed at Messana today.");
    expect(boast.inspection!.overstated).toBe(1);
    expect(boast.entries[0]!.quote).toBeNull();
    const plain = await compose("The consul waited at Rhegium for ships that did not come.", { status: "unanswered" }, "We wait on the ships, and the ships wait on the Senate.");
    expect(plain.inspection!.overstated).toBe(0);
    expect(plain.entries[0]!.quote?.line).toBe("We wait on the ships, and the ships wait on the Senate.");
  });
});

describe("the tags on an entry", () => {
  it("name nothing the reader could not know: a private matter of another court is neither told nor tagged", async () => {
    const port = {
      complete: (_operation: SimOperation, _system: string, user: string) => {
        const threads = [...user.matchAll(/^THREAD (\d+)/gm)].map((match) => Number(match[1]));
        return Promise.resolve(JSON.stringify({ entries: threads.map((thread) => ({ thread, title: `Thread ${thread}`, body: "In the spring, Rome began to raise new legions." })) }));
      },
    };
    const world = opening(150);
    const foreign = world.characters.find((character) => character.polityId === "carthage" && character.alive)!;
    const result = await composeChronicle({
      port, clock, observer: { kind: "character", id: CONSUL }, observerPolityId: "rome",
      facts: [
        factOf("Rome begins raising two new legions.", [{ kind: "polity", id: "rome" }]),
        factOf(`${foreign.name} quietly courts the officers of the fleet.`, [{ kind: "character", id: foreign.id }, { kind: "polity", id: "carthage" }], true),
      ],
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["rome", CONSUL]),
      world,
    });
    const tags = result.entries.flatMap((entry) => entry.tags.map((tag) => tag.id));
    expect(tags).not.toContain(foreign.id);
    expect(result.entries.flatMap((entry) => entry.factIds)).toHaveLength(1);
  });
});
