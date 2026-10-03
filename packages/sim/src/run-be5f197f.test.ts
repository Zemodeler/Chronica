import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  canonicalKey,
  ensureProvinceMaterial,
  passagePlanFor,
  readStandingOrders,
  type Commitment,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyResult } from "./apply/context";
import { asksAVote, runSimulationBurst } from "./burst";
import { createIdFactory, type SimModelPort } from "./ports";
import { keepPromises } from "./promises";

/**
 * The faults of the 1 October run (game be5f197f): Legio I that never left
 * Italy, a navy petition that held the treasury and was told as voted down, a
 * peace whose legion stayed with Decius, and the rest. Each is held here to
 * what it should have done.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const { messana: MESSANA, rhegium: RHEGIUM, rome: ROME_CITY } = PUNIC_IDS;
const CONSUL = "gaius-genucius";

function opening(): WorldState {
  return ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
}

function apply(world: WorldState, actor: string, deltas: readonly Record<string, unknown>[], tag: string): ApplyResult {
  return applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), {
    now: world.instant, actorRef: { kind: "character", id: actor }, offices, warfare: definition.warfare,
    ids: createIdFactory(tag), gameId: "game-run", playerCharacterId: CONSUL,
  });
}

/** The hulls at Rhegium, made enough to carry the legion. */
function hullsAtRhegium(world: WorldState, ships: number): WorldState {
  return {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => force.id !== "allied-greek-hulls" ? force : {
        ...force, locationId: RHEGIUM, authorizedStrength: ships,
        personnel: [{ categoryId: "warship", label: "Allied transports", fit: ships, unavailable: [] }],
      }),
    },
  };
}

describe("the crossing to Messana", () => {
  it("takes ship where the hulls are, not at the shore nearest the army", () => {
    const world = hullsAtRhegium(opening(), 300);
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const plan = passagePlanFor(world, army, MESSANA, definition.warfare);
    // The ships come to the legion -- they sail 85 km a day and it walks ten
    // -- and the whole of it is over in well under the 47 days a march to
    // Rhegium would take, counting the ships' own voyage to the shore.
    expect(plan).not.toBeNull();
    expect(plan!.fleets.map((entry) => entry.fleet.id)).toContain("allied-greek-hulls");
    expect(plan!.gatherDays).toBeGreaterThanOrEqual(Math.ceil(plan!.fleets[0]!.sailKm / 85));
    expect(plan!.gatherDays + plan!.crossingDays).toBeLessThan(30);
  });

  it("keeps a hired fleet to the work its master sent it on", () => {
    let world = hullsAtRhegium(opening(), 300);
    world = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => force.id === "allied-greek-hulls" ? { ...force, commanderCharacterId: "manius-curius" } : force) } };
    const sent = apply(world, CONSUL, [{ op: "force_modify", forceRef: "allied-greek-hulls", locationId: ROME_CITY, reason: "Fetch the legion." }], "sent");
    const turned = apply(sent.world, "manius-curius", [{ op: "force_modify", forceRef: "allied-greek-hulls", locationId: MESSANA, reason: "On my own account." }], "turned");
    expect(turned.rejected.length).toBe(1);
    expect(turned.world.projects.filter((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === "allied-greek-hulls")).toHaveLength(1);
  });
});

describe("a fleet at sea", () => {
  it("sails at a sailing pace and holds a course it set this fortnight", () => {
    const world = opening();
    const fleet = world.material.forces.find((force) => force.id === "carthaginian-fleet")!;
    const to = world.map.provinces.find((province) => province.id !== fleet.locationId && province.id === RHEGIUM)!.id;
    const sent = apply(world, fleet.commanderCharacterId ?? "hanno-carthage", [{ op: "force_modify", forceRef: fleet.id, locationId: to, reason: "Watch the strait." }], "sail");
    const sailing = sent.world.projects.find((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === fleet.id);
    if (sailing !== undefined) {
      expect(sailing.milestones[0]!.requiredAtElapsedOffset).toBeLessThanOrEqual(10);
      const turned = apply(sent.world, fleet.commanderCharacterId ?? "hanno-carthage", [{ op: "force_modify", forceRef: fleet.id, locationId: MESSANA, reason: "Elsewhere again." }], "back");
      expect(turned.rejected.length).toBe(1);
    }
  });
});

describe("a vote with no body named", () => {
  it("goes before the Senate whatever it is about", () => {
    const result = apply(opening(), "gnaeus-cornelius", [{
      op: "political_procedure_open", localId: "punitive", type: "council_deliberation", label: "Punitive service for the Campanian legion",
      institutionRef: null, sponsorCharacterRef: "gnaeus-cornelius", subjectKind: "group", subjectRef: null,
      resolutionMechanism: "vote", deadlineInDays: 30, reason: "Put before the Senate.",
    }], "vote");
    expect(result.rejected).toHaveLength(0);
    expect(result.world.material.politicalProcedures.find((procedure) => procedure.label.startsWith("Punitive"))?.institutionId).toBe("roman-senate");
  });
});

describe("a company hired", () => {
  it("musters with its captain, and brings only what the pay keeps", () => {
    const result = apply(opening(), CONSUL, [{
      op: "service_contract_open", localId: "ships", role: "mercenary", label: "Hired transport for the Roman field army",
      employerAccountRef: "gaius-purse", employeeRef: "manius-curius", advance: 900, monthlyPay: 0, termDays: 90,
      duties: "Carry the legion to Messana.", company: { categoryId: "warship", strength: 400 }, provinceId: MESSANA, reason: "Ships for the crossing.",
    }], "hire");
    expect(result.rejected).toHaveLength(0);
    const fleet = result.world.material.forces.find((force) => force.name === "Hired transport for the Roman field army")!;
    expect(fleet.locationId).not.toBe(MESSANA);
    expect(fleet.personnel[0]!.fit).toBeLessThan(400);
    expect(fleet.personnel[0]!.fit).toBeGreaterThan(50);
  });
});

describe("Legio II raised", () => {
  it("is not raised twice when the same answer reinforces it", () => {
    const result = apply(opening(), CONSUL, [
      { op: "force_create", localId: "legio2", name: "Legio II", polityId: "rome", commanderCharacterRef: CONSUL, controllerCharacterRef: CONSUL, locationId: ROME_CITY, authorizedStrength: 5000, categoryId: "infantry", reason: "A second legion." },
      { op: "force_reinforce", forceRef: "local:legio2", categoryId: "infantry", label: "Roman infantry", men: 5000, reason: "Its men." },
    ], "legio2");
    const legion = result.world.material.forces.find((force) => force.name === "Legio II")!;
    expect(legion.personnel.reduce((sum, row) => sum + row.fit, 0)).toBeLessThanOrEqual(5000);
  });
});

describe("the peace of Rhegium", () => {
  it("puts the legion its terms name into Rome's service, and calls off Decius's knife", () => {
    let world = opening();
    world = apply(world, "decius-vibellius", [{
      op: "covert_plot_open", localId: "knife", kind: "assassination", targetCharacterRef: CONSUL, sponsorCharacterRef: "decius-vibellius",
      fundingAccountRef: "vibellius-purse", spend: 50, cover: "Travellers.", expectedInDays: 60, reason: "Revenge.",
    }], "plot").world;
    expect(world.covertPlots.some((plot) => plot.outcome === null)).toBe(true);
    const peace = apply(world, "decius-vibellius", [{
      op: "agreement_open", localId: "peace", kind: "peace", forDays: null, polityId: "rhegium-campanians", otherPolityId: "rome", visibility: "public",
      terms: "The war over Rhegium ends. The Campanian legion serves as a punitive legion for ten years, maintained by Rome at lower pay; its men are then released.",
      reason: "Decius accepts Rome's terms.",
    }], "peace");
    expect(peace.rejected).toHaveLength(0);
    expect(peace.world.material.forces.find((force) => force.id === "campanian-legion")?.polityId).toBe("rome");
    expect(peace.world.covertPlots.filter((plot) => plot.outcome === null && plot.sponsorCharacterId === "decius-vibellius")).toHaveLength(0);
  });
});

describe("a promise to put a question", () => {
  const promise = (description: string): Commitment => ({
    id: "c1", promisorCharacterId: "gnaeus-cornelius", beneficiaryCharacterId: CONSUL, actionKind: "political_support", description, conditions: "",
    requiredOfficeId: null, requiredResource: null, visibility: "private", sourceEventId: "e1", breachPressureKind: "humiliation",
    status: "pending", createdAtStep: 0, reviewAtStep: 6, resolvedAtStep: null, resolutionReason: null,
  } as Commitment);

  it("is his to keep, not an occasion that lapses", () => {
    const world = { ...opening(), elapsedStep: 6, instant: { day: 6, minute: 0 }, commitments: [promise("I will carry the Sicilian matter before the Senate and seek its decree.")] };
    const unkept = keepPromises({ world, toDay: 6, playerCharacterId: CONSUL }).world.commitments[0]!;
    expect(unkept.status).not.toBe("cancelled");
    const voted = apply(world, "gnaeus-cornelius", [{
      op: "political_procedure_open", localId: "levy", type: "council_deliberation", label: "Decree for the Sicilian levy",
      institutionRef: null, sponsorCharacterRef: "gnaeus-cornelius", subjectKind: "force", subjectRef: "roman-field-army",
      resolutionMechanism: "vote", deadlineInDays: 30, reason: "As promised.",
    }], "kept");
    expect(voted.rejected.map((entry) => entry.reason)).toEqual([]);
    expect(keepPromises({ world: voted.world, toDay: 6, playerCharacterId: CONSUL }).world.commitments[0]!.status).toBe("fulfilled");
  });
});

describe("the order's record", () => {
  it("knows a petition from the work beside it", () => {
    expect(asksAVote("Petition the Senate to begin construction of a Roman navy of 150 ships.")).toBe(true);
    expect(asksAVote("Amend the standing order: sail Legio I to Messana, hiring ships and mercenaries.")).toBe(false);
    expect(asksAVote("Sail Legio I to Messana as fast as possible.")).toBe(false);
  });

  it("lists a march once on the agenda, and says where a held crossing goes", () => {
    expect(canonicalKey("march:project-1")).toBe(canonicalKey("project:project-1"));
    const world: WorldState = { ...opening(), orders: [{
      id: "order-1", actorCharacterId: CONSUL, text: "Sail Legio I to Messana", givenAtStep: 0,
      parts: [{ said: "Sail Legio I to Messana", goals: [], workRefs: [], refusal: null, note: null, whyNot: null, factIds: [], spend: null, attribution: "tagged", closedAtStep: null,
        stages: [{ held: { op: "resume_instruction" }, waitsOn: [{ kind: "transport_capacity", forceId: "roman-field-army", provinceId: MESSANA }], status: "waiting", reason: null, heldSinceStep: 0, failedAtStep: null }], refusedAtStep: null, actsCarried: 0, actsRefused: 0 }],
    }] };
    const rows = readStandingOrders(world, CONSUL, offices, definition.clock).rows;
    expect(rows[0]!.summary).toMatch(/ to /);
    expect(rows[0]!.summary).not.toMatch(/ from /);
  });
});

describe("an order that hires ships and petitions for a navy", () => {
  it("gives the hires to the order they serve, and holds no treasury for a vote never put", async () => {
    const world = opening();
    const port: SimModelPort = {
      complete(operation) {
        if (operation !== "simulate_orchestrate") return Promise.resolve(JSON.stringify({ actors: [] }));
        return Promise.resolve(JSON.stringify({
          narrativeSummary: "Ships hired.", frictions: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
          deltas: [{
            op: "service_contract_open", localId: "ships", role: "mercenary", label: "Hired transport for the Roman field army",
            employerAccountRef: "gaius-purse", employeeRef: "manius-curius", advance: 300, monthlyPay: 200, termDays: 90,
            duties: "Carry the legion to Messana.", company: { categoryId: "warship", strength: 80 }, provinceId: MESSANA, reason: "Ships.",
          }],
          // The answer files the hire under the petition, as the run's did.
          intent: { summary: "Hire ships; petition for a navy.", parts: [
            { said: "Amend the standing order: sail Legio I to Messana, hiring ships and mercenaries.", acts: [], spend: { payerAccountRef: "gaius-purse", cap: 1000 } },
            { said: "Petition the Senate to begin construction of a Roman navy of 150 ships.", acts: [0], spend: { payerAccountRef: "rome-treasury", cap: 7500 } },
          ] },
        }));
      },
    };
    const result = await runSimulationBurst({
      world, clock: definition.clock, offices, warfare: definition.warfare, burstId: "petition", gameId: "game-run",
      actorRef: { kind: "character", id: CONSUL }, actorPolityId: "rome",
      orderText: "Amend my standing order: hire ships, mercenaries for this. Petition the Senate to start the construction of a roman navy, 150 ships in size",
      knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1,
    });
    const order = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const [amend, petition] = order.parts;
    expect(amend!.workRefs.some((ref) => ref.kind === "contract")).toBe(true);
    expect(petition!.workRefs.some((ref) => ref.kind === "contract")).toBe(false);
    expect(petition!.spend?.reservationId ?? null).toBeNull();
    expect(result.world.material.reservations.filter((reservation) => reservation.accountId === "rome-treasury" && reservation.status === "active")).toHaveLength(0);
  });
});
