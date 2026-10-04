import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, ordersUnderWay, orderPartLabel, orderPartStatus, type Force, type Office, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput } from "./burst";
import { orderOutcomeLines, withOrderOutcomes } from "./order-outcomes";
import type { SimModelPort, SimOperation } from "./ports";
import type { ChronicleEntry } from "./chronicle";

/**
 * R54, R55, R65, R66: an order is a standing thing, part by part.
 *
 * "Carry Legio I to Messana", "appoint someone independent to examine the
 * accusation" and three other parts went into one order. The crossing was
 * refused, the audit was begun and never mentioned, and the Council showed an
 * inert "pursuit" as the only thing under way. Each part is now remembered with
 * the work that answers it, and what it came to is read from that work.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const { rome: ROME, messana: MESSANA } = PUNIC_IDS;
const ACTOR = "gaius-genucius";

function world(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const hulls = opening.material.forces.find((force) => force.id === "allied-greek-hulls")!;
  const navy: Force = { ...hulls, id: "roman-navy", name: "Roman Navy", locationId: MESSANA, personnel: [{ categoryId: "warship", label: "Warships", fit: 150, unavailable: [] }] };
  return {
    ...opening,
    material: {
      ...opening.material,
      forces: [
        ...opening.material.forces.map((force): Force => force.id === "roman-field-army"
          ? { ...force, locationId: ROME, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 7_100, unavailable: [] }] }
          : force),
        navy,
      ],
    },
  };
}

function scripted(script: Partial<Record<SimOperation, string[]>>): SimModelPort {
  const remaining = { ...script };
  return {
    complete(operation) {
      const next = remaining[operation]?.shift();
      return next === undefined ? Promise.resolve(JSON.stringify({ actors: [] })) : Promise.resolve(next);
    },
  };
}

const ORDER = "Carry Legio I to Messana in the Roman Navy. Appoint someone independent of me to examine the accusation.";

const ANSWER = JSON.stringify({
  intent: {
    summary: "Carry the legion over and have the accusation examined.",
    domains: ["military"],
    parts: [
      { said: "Carry Legio I to Messana in the Roman Navy", factLocalIds: [], whyNot: null },
      { said: "Appoint someone independent to examine the accusation", factLocalIds: [], whyNot: null },
    ],
  },
  narrativeSummary: "The legion is sent south.",
  frictions: [],
  deltas: [{ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, fleetRefs: ["roman-navy"], reason: "Carry Legio I over to Messana in the Roman Navy." }],
  facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
});

function input(port: SimModelPort): BurstInput {
  return {
    world: world(), clock: definition.clock, offices, warfare: definition.warfare, burstId: "remembered", gameId: "game-remembered",
    actorRef: { kind: "character", id: ACTOR }, actorPolityId: "rome",
    orderText: ORDER, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1,
  };
}

describe("an order, part by part", () => {
  it("is kept with the work each part set going", async () => {
    const result = await runSimulationBurst(input(scripted({ simulate_orchestrate: [ANSWER] })));
    const order = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    expect(order.parts).toHaveLength(2);
    const [crossing, audit] = order.parts;
    expect(crossing!.workRefs.some((ref) => ref.kind === "project")).toBe(true);
    expect(orderPartStatus(result.world, crossing!)).toBe("under_way");
    // Nothing was written for the second part, and it says so.
    expect(orderPartStatus(result.world, audit!)).toBe("unanswered");
  });

  it("puts what each part came to under the passage, whatever the prose left out", async () => {
    const result = await runSimulationBurst(input(scripted({ simulate_orchestrate: [ANSWER] })));
    const lines = orderOutcomeLines(result.world, result.orderRecordId!);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("under way");
    expect(lines[1]).toContain("nothing came of it");
    const passage: ChronicleEntry = {
      kind: "narrated", title: "The legion goes south", body: "Clepsina ordered the existing transport used.",
      factIds: [...result.orderFactIds], subjects: [], tags: [], changes: [], quote: null, fromInstantSortKey: 0, toInstantSortKey: 0,
    };
    const [told] = withOrderOutcomes([passage], lines, result.orderFactIds, 0);
    expect(told!.body).toContain("What came of the order:");
    expect(told!.body).toContain("Appoint someone independent");
  });

  it("shows the Council real work, and a part that came to nothing as wanting his word", async () => {
    const result = await runSimulationBurst(input(scripted({ simulate_orchestrate: [ANSWER] })));
    const items = ordersUnderWay(result.world, ACTOR, offices);
    expect(items.some((item) => item.kind === "project" || item.kind === "march")).toBe(true);
    const nothing = items.find((item) => item.kind === "order" && item.label.startsWith("Appoint"))!;
    expect(nothing.stalled).toBe(true);
    expect(items.some((item) => item.kind === "pursuit")).toBe(false);
  });

  it("closes an earlier part when a later order says the same thing again", async () => {
    const first = await runSimulationBurst(input(scripted({ simulate_orchestrate: [ANSWER] })));
    const again = await runSimulationBurst({ ...input(scripted({ simulate_orchestrate: [ANSWER] })), burstId: "remembered-2", world: first.world });
    const open = again.world.orders.flatMap((order) => order.parts).filter((part) => part.said.startsWith("Carry") && part.closedAtStep === null);
    expect(open).toHaveLength(1);
  });
});

function stageWaitingOnPassedVote(): WorldState {
  const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
  const act = (state: WorldState, delta: Record<string, unknown>) => applyDeltas(state, [WorldDeltaSchema.parse(delta)], {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "hieron-ii" }, ...government,
    warfare: definition.warfare, ids: createIdFactory(`vote-${delta.op as string}`), gameId: "game-vote",
  });
  const opened = act(world(), {
    op: "political_procedure_open", localId: "d", type: "decree", institutionRef: null, sponsorCharacterRef: "hieron-ii",
    subjectKind: "polity", subjectRef: "syracuse", label: "Leave for the crossing", resolutionMechanism: "appointment_authority", deadlineInDays: null,
    reason: "Leave.",
  });
  const voteId = opened.assignedIds.get("d")!;
  const passed = act(opened.world, { op: "political_procedure_resolve", procedureRef: voteId, outcome: "passed", outcomeReason: "Granted.", reason: "Granted." }).world;
  const waiting: WorldState = {
    ...passed,
    orders: [{
      id: "order-waiting", actorCharacterId: ACTOR, text: "Seek leave and carry the legion over.", givenAtStep: 0,
      parts: [{
        said: "Carry Legio I to Messana once the Senate gives leave", workRefs: [{ kind: "procedure", id: voteId }], refusal: null,
        goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: MESSANA }], spend: null, attribution: "tagged",
        note: null, whyNot: null, factIds: [], closedAtStep: null, refusedAtStep: null, actsCarried: 0, actsRefused: 0,
        stages: [{
          held: { op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, fleetRefs: ["roman-navy"], reason: "Carry Legio I over." },
          waitsOn: [{ kind: "procedure_passed", procedureId: voteId }], status: "waiting", reason: null, heldSinceStep: 0, failedAtStep: null, reviewAtStep: null,
        }],
      }],
    }],
  };
  return waiting;
}

describe("a part that waited on a vote", () => {
  // R67: the Senate's leave came, and its record said "what it allows waits on
  // somebody's order" -- although the order had been given.
  it("is taken up again the day the vote passes, without a second order", async () => {
    const waiting = stageWaitingOnPassedVote();
    const result = await runSimulationBurst({ ...input(scripted({})), world: { ...waiting, instant: { day: 1, minute: 540 }, elapsedStep: 1 }, orderText: null, burstId: "resumed" });
    const part = result.world.orders[0]!.parts[0]!;
    expect(part.stages[0]!.status).toBe("resumed");
    expect(part.workRefs.some((ref) => ref.kind === "project")).toBe(true);
    // Allowed and set going, not done: the legion is not in Messana yet.
    expect(orderPartStatus(result.world, part)).toBe("under_way");
    expect(result.newFacts.some((fact) => fact.kind === "order_resumed")).toBe(true);
  });

  // Plan chronicle-and-order-truth, phase 2: a held stage wakes on the tick,
  // not on whatever the model budget allowed.
  it("is taken up again although the burst had no model calls to spend", async () => {
    const waiting = stageWaitingOnPassedVote();
    const result = await runSimulationBurst({
      ...input(scripted({})), world: { ...waiting, instant: { day: 1, minute: 540 }, elapsedStep: 1 }, orderText: null, burstId: "resumed-broke",
      budget: { ...DEFAULT_BUDGET, maxModelCalls: 0, maxMechanicCalls: 0 },
    });
    expect(result.world.orders[0]!.parts[0]!.stages[0]!.status).toBe("resumed");
  });
});

describe("a part carried out with nothing to check it against", () => {
  // Plan chronicle-and-order-truth, phase 1.4: no "done" without evidence.
  it("reads as ordered, effect not observed, never as done", () => {
    const part = {
      said: "Make the allies ready", workRefs: [], refusal: null, goals: [], spend: null, attribution: "tagged" as const,
      note: null, whyNot: null, factIds: [], closedAtStep: null, refusedAtStep: null, actsCarried: 1, actsRefused: 0, stages: [],
    };
    const status = orderPartStatus(world(), part);
    expect(status).toBe("carried_unverified");
    expect(orderPartLabel(status, part)).toBe("ordered, effect not observed");
  });
});

describe("a part held for something that does not come", () => {
  // Plan chronicle-and-order-truth, 2.3: every wait has a day it is looked at.
  const holding = (): WorldState => ({
    ...world(),
    orders: [{
      id: "order-held", actorCharacterId: ACTOR, text: "Carry the legion over when the Senate gives leave.", givenAtStep: 0,
      parts: [{
        said: "Carry Legio I to Messana when the road is clear", workRefs: [], refusal: null,
        goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: MESSANA }], spend: null, attribution: "tagged",
        note: null, whyNot: null, factIds: [], closedAtStep: null, refusedAtStep: null, actsCarried: 0, actsRefused: 0,
        stages: [{
          held: { op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, reason: "Carry Legio I over." },
          waitsOn: [{ kind: "force_named", name: "No Such Army Will Be Named This", polityId: "rome" }], status: "waiting", reason: null, heldSinceStep: 0, failedAtStep: null, reviewAtStep: 14,
        }],
      }],
    }],
  });
  const at = (day: number): WorldState => ({ ...holding(), instant: { day, minute: 540 }, elapsedStep: day });

  it("asks the player on its review day and puts the next one a fortnight on", async () => {
    const result = await runSimulationBurst({ ...input(scripted({})), world: at(20), orderText: null, burstId: "review" });
    const stage = result.world.orders[0]!.parts[0]!.stages[0]!;
    expect(stage.status).toBe("waiting");
    expect(stage.reviewAtStep).toBeGreaterThan(20);
    expect(result.newFacts.some((fact) => fact.kind === "order_wait_review" && /your word/.test(fact.summary))).toBe(true);
  });

  it("lets it lapse, loudly, after a season", async () => {
    const result = await runSimulationBurst({ ...input(scripted({})), world: at(95), orderText: null, burstId: "lapse" });
    const part = result.world.orders[0]!.parts[0]!;
    expect(part.stages[0]!.status).toBe("failed");
    expect(part.stages[0]!.reason).toMatch(/did not come in/);
    expect(part.refusal).not.toBeNull();
  });
});

describe("a part handed on and accepted, then left", () => {
  // Plan chronicle-and-order-truth, 2.6: taken up is not done, and after three weeks it is stalled.
  const handed = (): WorldState => {
    const attempt = {
      id: "order-1", actionId: "action-1", issuerRef: { kind: "character" as const, id: ACTOR }, recipientRef: { kind: "character" as const, id: "tiberius-coruncanius" },
      claimedAuthorityGrantId: null, authorityCheck: { authorized: true, grant: null, standing: null, reason: "Consul." },
      instruction: "Arrange the transport", standing: "binding" as const, status: "accepted" as const, recipientDecisionReason: "Yes.",
      issuedAtStep: 0, decidedAtStep: 2, consequenceFactRefs: [], servesRef: null,
    };
    return { ...world(), orderAttempts: [attempt] };
  };
  const part = { said: "Arrange the transport", workRefs: [{ kind: "order_attempt" as const, id: "order-1" }], refusal: null, goals: [], spend: null, attribution: "tagged" as const, note: null, whyNot: null, factIds: [], closedAtStep: null, refusedAtStep: null, actsCarried: 0, actsRefused: 0, stages: [] };

  it("is taken up for the first three weeks", () => {
    expect(orderPartStatus({ ...handed(), elapsedStep: 10 }, part)).toBe("acknowledged");
  });

  it("is stalled after, and says so", () => {
    const status = orderPartStatus({ ...handed(), elapsedStep: 30 }, part);
    expect(status).toBe("stalled");
    expect(orderPartLabel(status, part)).toBe("accepted, but nothing done for weeks");
  });
});

describe("a delegate whose work is settled", () => {
  // Plan chronicle-and-order-truth, 4.1 and 4.2: he reports in his own voice, from what the world shows.
  it("sends word to the one who ordered it, with what the world shows", async () => {
    const legion = world().material.forces.find((force) => force.id === "roman-field-army")!;
    const attempt = {
      id: "order-del", actionId: "action-del", issuerRef: { kind: "character" as const, id: ACTOR }, recipientRef: { kind: "character" as const, id: "tiberius-coruncanius" },
      claimedAuthorityGrantId: null, authorityCheck: { authorized: true, grant: null, standing: null, reason: "Consul." },
      instruction: "Keep the legion at Rome", standing: "binding" as const, status: "accepted" as const, recipientDecisionReason: "Yes.",
      issuedAtStep: 0, decidedAtStep: 0, consequenceFactRefs: [], servesRef: null,
    };
    const state: WorldState = {
      ...world(), orderAttempts: [attempt],
      orders: [{ id: "order-d", actorCharacterId: ACTOR, text: "Keep the legion at Rome.", givenAtStep: 0, parts: [{
        said: "Keep the legion at Rome", workRefs: [{ kind: "order_attempt", id: "order-del" }], refusal: null,
        goals: [{ kind: "force_at", forceId: legion.id, provinceId: legion.locationId }], spend: null, attribution: "tagged",
        note: null, whyNot: null, factIds: [], closedAtStep: null, refusedAtStep: null, actsCarried: 0, actsRefused: 0, stages: [],
      }] }],
    };
    const result = await runSimulationBurst({ ...input(scripted({})), world: state, orderText: null, burstId: "report" });
    const report = result.newFacts.find((fact) => fact.kind === "delegate_report");
    expect(report).toBeDefined();
    expect(report!.summary).toContain("it is done");
    expect(report!.summary).toContain(legion.name);
    expect(report!.story?.source).toBe("reported");
    // Addressed to people who exist: the issuer and the delegate.
    expect(report!.affectedEntities.map((entity) => entity.id)).toEqual([ACTOR, "tiberius-coruncanius"]);
  });
});
