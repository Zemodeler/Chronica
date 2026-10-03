import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, ordersUnderWay, orderPartStatus, type Force, type Office, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { runSimulationBurst, type BurstInput } from "./burst";
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

describe("a part that waited on a vote", () => {
  // R67: the Senate's leave came, and its record said "what it allows waits on
  // somebody's order" -- although the order had been given.
  it("is taken up again the day the vote passes, without a second order", async () => {
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
          note: null, whyNot: null, factIds: [], closedAtStep: null,
          stages: [{
            held: { op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, fleetRefs: ["roman-navy"], reason: "Carry Legio I over." },
            waitsOn: [{ kind: "procedure_passed", procedureId: voteId }], status: "waiting", reason: null,
          }],
        }],
      }],
    };
    const result = await runSimulationBurst({ ...input(scripted({})), world: { ...waiting, instant: { day: 1, minute: 540 }, elapsedStep: 1 }, orderText: null, burstId: "resumed" });
    const part = result.world.orders[0]!.parts[0]!;
    expect(part.stages[0]!.status).toBe("resumed");
    expect(part.workRefs.some((ref) => ref.kind === "project")).toBe(true);
    // Allowed and set going, not done: the legion is not in Messana yet.
    expect(orderPartStatus(result.world, part)).toBe("under_way");
    expect(result.newFacts.some((fact) => fact.kind === "order_resumed")).toBe(true);
  });
});
