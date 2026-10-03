import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterIntentSchema,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  orderPartStatus,
  type Audit,
  type Commitment,
  type Force,
  type OrderPart,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { runSimulationBurst, type BurstInput, type BurstResult } from "./burst";
import { createIdFactory } from "./ports";
import type { ChronicleEntry } from "./chronicle";
import { resolveAudits } from "./departments";
import { findInvariantViolations } from "./invariants";
import { outcomeOfOrder } from "./order-outcome";
import type { SimModelPort, SimOperation } from "./ports";
import { keepPromises, keptOnTheRecord } from "./promises";
import { takeSteps } from "./plans";

/**
 * The gaps behind the Clepsina run (docs/reports/270-bc-clepsina-engine-gaps-
 * 2026-09-30.md): an order's work read as its fulfilment.
 *
 * The first block is the report's seven probes, each now held to what it
 * should have been. The second reads the world after the fact by its raw
 * fields -- where an army stands, what an account holds, who can see a fact
 * -- and never through the status functions being tested, so a status that
 * lies cannot also be the thing that passes it (E11).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const { messana: MESSANA } = PUNIC_IDS;
/** The Republic, as a power: `PUNIC_IDS.rome` is the city's province. */
const ROME = "rome";
const CONSUL = "gaius-genucius";
const HIERON = "hieron-ii";

function opening(): WorldState {
  return ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
}

const part = (change: Partial<OrderPart>): OrderPart => ({
  said: "Carry Legio I to Messana", goals: [], workRefs: [], refusal: null, note: null, whyNot: null, factIds: [],
  stages: [], spend: null, attribution: "tagged", closedAtStep: null, refusedAtStep: null, actsCarried: 0, actsRefused: 0, ...change,
});

function scripted(script: Partial<Record<SimOperation, string[]>>): SimModelPort {
  const remaining = { ...script };
  return {
    complete(operation) {
      const next = remaining[operation]?.shift();
      return Promise.resolve(next ?? JSON.stringify({ actors: [] }));
    },
  };
}

function input(world: WorldState, port: SimModelPort, orderText: string | null, burstId: string): BurstInput {
  return {
    world, clock: definition.clock, offices, warfare: definition.warfare, burstId, gameId: "game-proof",
    actorRef: { kind: "character", id: CONSUL }, actorPolityId: ROME,
    orderText, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1,
  };
}

const answer = (body: Record<string, unknown>): string => JSON.stringify({
  narrativeSummary: "Done as ordered.", frictions: [], deltas: [], facts: [], delegations: [], schedule: [],
  cognitionCandidates: [], outcome: "continue", playerDecision: null,
  intent: { summary: "The order.", parts: [] },
  ...body,
});

describe("the report's probes, held to what they should have been", () => {
  it("does not call a part done for naming an army that does not exist", () => {
    expect(orderPartStatus(opening(), part({ workRefs: [{ kind: "force", id: "no-such-army" }] }))).toBe("unanswered");
  });

  it("calls an order taken up and not acted on taken up, not under way", () => {
    const world = opening();
    const withAttempt: WorldState = {
      ...world,
      orderAttempts: [{
        id: "order-1", actionId: "action-1", issuerRef: { kind: "character", id: CONSUL }, recipientRef: { kind: "character", id: "tiberius-coruncanius" },
        claimedAuthorityGrantId: null, authorityCheck: { authorized: true, grant: null, standing: null, reason: "Consul." },
        instruction: "Arrange the transport", standing: "binding", status: "accepted", recipientDecisionReason: "Yes.",
        issuedAtStep: 0, decidedAtStep: 0, consequenceFactRefs: [], servesRef: null,
      }],
    };
    expect(orderPartStatus(withAttempt, part({ workRefs: [{ kind: "order_attempt", id: "order-1" }] }))).toBe("acknowledged");
  });

  it("does not score an order as carried out, or as told, by its acceptance alone", () => {
    const world: WorldState = {
      ...opening(),
      orders: [{ id: "rec", actorCharacterId: CONSUL, text: "Carry Legio I over; examine the books.", givenAtStep: 0, parts: [
        part({ goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: MESSANA }] }),
        part({ said: "Examine the books" }),
      ] }],
    };
    const fact = { id: "fact-accepted", kind: "order_accepted", sourceActionId: "rec-p0", affectedEntities: [], summary: "Coruncanius accepted the transport." };
    const result = { world, orderRecordId: "rec", orderFactIds: [fact.id], newFacts: [fact], parseFailures: [], salvaged: [], unwritten: [] } as unknown as BurstResult;
    const entries = [{ title: "The transport", body: "Coruncanius accepted the transport.", factIds: [fact.id] }] as unknown as ChronicleEntry[];
    const outcome = outcomeOfOrder(result, entries);
    expect(outcome.carriedOut).toBe(false);
    // One of its two parts was told; the other was not.
    expect(outcome.inChronicle).toBe(false);
  });

  it("does not take an unrelated letter as a promise kept", () => {
    const world = opening();
    const promise: Commitment = {
      id: "promise-brother", promisorCharacterId: HIERON, beneficiaryCharacterId: CONSUL, actionKind: "other",
      description: "to see to the release of your brother", conditions: "", requiredOfficeId: null, requiredResource: null,
      visibility: "private", sourceEventId: null, breachPressureKind: "humiliation", status: "pending",
      createdAtStep: 0, reviewAtStep: 10, resolvedAtStep: null, resolutionReason: null,
    };
    const greeted: WorldState = {
      ...world,
      diplomacy: [...world.diplomacy, {
        ...(world.diplomacy[0] ?? {}),
        id: "letter-greeting", fromCharacterId: HIERON, toCharacterId: CONSUL, sentAtStep: 1, subject: "Greetings", terms: "Greetings from Syracuse.",
      } as WorldState["diplomacy"][number]],
    };
    expect(keptOnTheRecord(greeted, promise)).toBeNull();
  });

  it("credits no plan step to an answer that did nothing for it", () => {
    const world = opening();
    expect(takeSteps(world, HIERON, []).taken).toBe(0);
  });

  it("does not clear anybody when the auditor died before he could look", () => {
    const world = opening();
    const dead: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === HIERON ? { ...character, alive: false } : character)),
      audits: [{
        id: "audit-1", orderedByCharacterId: CONSUL, auditorCharacterId: HIERON, scope: { kind: "household", id: CONSUL },
        departmentId: null, startedAtStep: 0, dueAtStep: 5, status: "under_way", allegationPressureId: null,
      } as Audit],
    };
    const done = resolveAudits(dead, 6);
    expect(done.world.audits[0]!.status).toBe("interrupted");
    expect(done.facts.some((fact) => fact.kind === "audit_interrupted")).toBe(true);
  });
});

describe("what the world shows, read from its own fields", () => {
  it("never calls a part done while the army it wanted somewhere is elsewhere", () => {
    const world = opening();
    const legion = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const finished = part({
      goals: [{ kind: "force_at", forceId: legion.id, provinceId: MESSANA }],
      workRefs: [{ kind: "project", id: "proj-done" }],
    });
    const withProject: WorldState = {
      ...world,
      projects: [{ ...(world.projects[0] ?? {}), id: "proj-done", status: "completed" } as WorldState["projects"][number]],
    };
    // The oracle: the legion is not in Messana.
    expect(legion.locationId).not.toBe(MESSANA);
    expect(orderPartStatus(withProject, finished)).toBe("failed");
  });

  it("keeps a fleet from two voyages at once", () => {
    const world = opening();
    const voyage = (id: string) => ({
      ...(world.projects[0] ?? {}), id, status: "in_progress" as const,
      completionOutcome: { kind: "force_move" as const, label: "Crossing", amount: 0, provinceId: MESSANA, polityId: ROME, commanderCharacterId: null, forceId: "roman-field-army", fleetIds: ["roman-navy"], beneficiaryAccountId: null, cadenceDays: null, agreementKind: null, withPolityId: null },
    }) as unknown as WorldState["projects"][number];
    expect(findInvariantViolations({ ...world, projects: [voyage("one")] })).toEqual([]);
    expect(findInvariantViolations({ ...world, projects: [voyage("one"), voyage("two")] }).some((violation) => violation.includes("roman-navy"))).toBe(true);
  });

  it("does not break the promise of a man the burst never got round to asking", () => {
    const world = opening();
    const due: WorldState = {
      ...world,
      commitments: [{
        id: "promise-grain", promisorCharacterId: HIERON, beneficiaryCharacterId: CONSUL, actionKind: "military_support",
        description: "to send men to Messana", conditions: "", requiredOfficeId: null, requiredResource: null,
        visibility: "private", sourceEventId: null, breachPressureKind: "humiliation", status: "deferred",
        createdAtStep: 0, reviewAtStep: 3, resolvedAtStep: null, resolutionReason: null,
      }],
      owed: [{ characterId: HIERON, why: "his promise's day", sinceStep: 2, bursts: 0 }],
    };
    const kept = keepPromises({ world: due, toDay: 5, playerCharacterId: CONSUL });
    // The oracle: the raw status, and no grievance written.
    expect(kept.world.commitments[0]!.status).not.toBe("broken");
    expect(kept.facts.some((fact) => fact.kind === "promise_broken")).toBe(false);
  });

  it("keeps a city said to have fallen, with no act behind it, as a report and not as the fall", async () => {
    const world = opening();
    const port = scripted({ simulate_orchestrate: [answer({
      intent: { summary: "News from Sicily.", parts: [{ said: "Hear the news", factLocalIds: ["fell"] }] },
      facts: [{ localId: "fell", kind: "city_taken", summary: "Messana fell to Syracuse.", affectedRefs: [{ kind: "polity", id: "syracuse" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 80 }],
    })] });
    const result = await runSimulationBurst(input(world, port, "What news from Sicily?", "claims"));
    const fact = result.newFacts.find((candidate) => candidate.summary.includes("Messana fell"));
    expect(fact?.kind).toBe("claim_city_taken");
    expect(fact?.evidence?.provenance).toBe("report");
    // The oracle: Messana is still held by whoever held it.
    expect(result.world.map.provinces.find((province) => province.id === MESSANA)?.controllerPolityId)
      .toBe(world.map.provinces.find((province) => province.id === MESSANA)?.controllerPolityId);
  });

  it("does not publish another man's private mind as public news", async () => {
    const base = opening();
    const world: WorldState = {
      ...base,
      characterIntents: [...base.characterIntents, CharacterIntentSchema.parse({
        actionType: "prepare", targetIds: [], prerequisites: [], intendedWorkflowIds: [], priority: 50, status: "proposed", createdAtStep: 0,
        id: "intent-hieron-secret", actorCharacterId: HIERON, visibility: "private",
        rationale: "Hieron means to marry his granddaughter to the Mamertine captain and take Messana by the match",
      })],
    };
    const port = scripted({ simulate_orchestrate: [answer({
      facts: [{ localId: "match", kind: "marriage_plan", summary: "Hieron means to marry his granddaughter to the Mamertine captain and take Messana by the match.", affectedRefs: [{ kind: "character", id: HIERON }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40 }],
    })] });
    const result = await runSimulationBurst(input(world, port, "What of Syracuse?", "minds"));
    const fact = result.newFacts.find((candidate) => candidate.kind === "marriage_plan");
    // The oracle: who may see it, by its own visibility field.
    expect(fact?.visibility).toBe("private");
  });

  it("carries a crossing held for the Senate's leave the day the leave comes, with no second order", async () => {
    const base = opening();
    const hulls = base.material.forces.find((force) => force.id === "allied-greek-hulls")!;
    // Enough hulls to carry a legion in the loads a crossing allows.
    const navy: Force = { ...hulls, id: "roman-navy", name: "Roman Navy", polityId: ROME, locationId: MESSANA, personnel: [{ categoryId: "warship", label: "Warships", fit: 300, unavailable: [] }] };
    const world: WorldState = { ...base, material: { ...base.material, forces: [...base.material.forces.filter((force) => force.id !== navy.id), navy] } };
    const port = scripted({ simulate_orchestrate: [answer({
      intent: { summary: "Seek leave and carry the legion over.", parts: [{ said: "Carry Legio I to Messana once the Senate gives leave", acts: [0, 1] }] },
      deltas: [
        { op: "political_procedure_open", localId: "leave", type: "decree", institutionRef: null, sponsorCharacterRef: CONSUL, subjectKind: "polity", subjectRef: ROME, label: "Leave for the crossing to Messana", resolutionMechanism: "appointment_authority", deadlineInDays: null, reason: "Leave." },
        { op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, fleetRefs: ["roman-navy"], reason: "Carry Legio I over to Messana." },
      ],
    })] });
    const result = await runSimulationBurst(input(world, port, "Seek the Senate's leave and carry Legio I to Messana.", "leave"));
    const order = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const [crossing] = order.parts;
    // The part wants the legion in Messana, whatever became of the act.
    expect(crossing!.goals).toContainEqual({ kind: "force_at", forceId: "roman-field-army", provinceId: MESSANA });
    expect(crossing!.attribution).toBe("tagged");
    // The act waits on the vote, held: nothing asks for it again.
    expect(crossing!.stages.length + crossing!.workRefs.filter((ref) => ref.kind === "project").length).toBeGreaterThan(0);

    // The Senate gives its leave, and time passes with no new order.
    const vote = crossing!.workRefs.find((ref) => ref.kind === "procedure")!;
    const allowed = applyDeltas(result.world, [WorldDeltaSchema.parse({ op: "political_procedure_resolve", procedureRef: vote.id, outcome: "passed", outcomeReason: "Granted.", reason: "Granted." })], {
      now: result.world.instant, actorRef: { kind: "character", id: CONSUL }, offices, warfare: definition.warfare, ids: createIdFactory("leave-given"), gameId: "game-proof",
    }).world;
    let later = allowed;
    for (let burst = 0; burst < 6; burst += 1) {
      const next = await runSimulationBurst({ ...input(later, scripted({}), null, `later-${burst}`), spanDays: 30 });
      later = next.world;
      if (later.material.forces.find((force) => force.id === "roman-field-army")?.locationId === MESSANA) break;
    }
    // The oracle: where the legion stands.
    expect(later.material.forces.find((force) => force.id === "roman-field-army")?.locationId).toBe(MESSANA);
  }, 120_000);

  it("sets aside what the order allowed a part to spend, from the chest it named, and no more", async () => {
    const base = opening();
    const treasury = base.material.accounts.find((account) => account.id === "rome-treasury")!;
    const made = applyDeltas(base, [WorldDeltaSchema.parse({
      op: "project_create", localId: "transport", kind: "transport", label: "Transport of Legio I",
      sponsorRef: { kind: "polity", id: ROME }, fundingAccountRef: treasury.id,
      milestones: [{ label: "Ships found", dueInDays: 20, costAmount: 50 }],
      completionOutcome: { kind: "none", label: "Transport of Legio I" },
      reason: "The consul's transport.",
    })], { now: base.instant, actorRef: { kind: "character", id: CONSUL }, offices, warfare: definition.warfare, ids: createIdFactory("envelope-project"), gameId: "game-proof" });
    const projectId = made.assignedIds.get("transport")!;
    const project = made.world.projects.find((candidate) => candidate.id === projectId)!;
    const world: WorldState = {
      ...made.world,
      orders: [{ id: "rec-spend", actorCharacterId: CONSUL, text: "Transport the legion; spend up to 300 from the treasury.", givenAtStep: 0, parts: [
        part({ said: "Transport the legion", workRefs: [{ kind: "project", id: project.id }], spend: { payerAccountId: treasury.id, cap: 300, reservationId: null } }),
      ] }],
    };
    const result = await runSimulationBurst(input(world, scripted({}), null, "envelope"));
    // The oracle: the reservation itself, and the project drawing on it.
    const reservation = result.world.material.reservations.find((candidate) => candidate.purposeId === "rec-spend-p0");
    expect(reservation?.accountId).toBe(treasury.id);
    expect(reservation?.reservedAmount).toBe(Math.min(300, treasury.balance));
    expect(result.world.projects.find((candidate) => candidate.id === project.id)?.reservationId).toBe(reservation?.id);
  });

  it("asks first, in the next burst, the man the last one could not pay to ask", async () => {
    const world: WorldState = { ...opening(), owed: [{ characterId: HIERON, why: "his answer to Rome's letter", sinceStep: 0, bursts: 0 }] };
    const sections: string[] = [];
    const port: SimModelPort = {
      complete(operation, _system, message) {
        if (operation === "simulate_cognition") sections.push(message);
        return Promise.resolve(JSON.stringify({ actors: [] }));
      },
    };
    const result = await runSimulationBurst(input(world, port, null, "owed"));
    // The oracle: what the model was actually sent, and what the world keeps.
    expect(sections.some((text) => text.includes(HIERON))).toBe(true);
    expect(result.world.owed.some((entry) => entry.characterId === HIERON)).toBe(false);
  });
});
