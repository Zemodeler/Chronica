import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { WorldStateSchema, WorldDeltaSchema, ScenarioDefinitionSchema, ensureProvinceMaterial, projectFundingAvailable, spentForOrderPart, OrderRecordSchema, orderPartStatus, type WorldState } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { debatersOf } from "./senate";
import { goalsOfAct, mergeGoals } from "./order-goals";
import { missionDestination, preserveDestination } from "./mission-intent";
import { keepContracts } from "./contracts";
import { carryOutEnactment } from "./enact";
import { ensureConstitutions } from "./constitutions";
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = () => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const apply = (world: WorldState, raw: unknown[]) => {
  const deltas = raw.map((item) => WorldDeltaSchema.parse(item));
  return applyDeltas(world, deltas, { now: world.instant, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare, ids: createIdFactory("reliability"), gameId: "test", orderDeltas: new Set(deltas) });
};
const charter = (employeeRef = "quintus-ogulnius") => ({ op: "service_contract_open", localId: "charter", role: "mercenary", label: "Fifty hired transports", employerAccountRef: "rome-treasury", employeeRef, advance: 900, monthlyPay: 80, termDays: 100, duties: "Carry Legio I to Messana", company: { categoryId: "warship", strength: 50 }, provinceId: PUNIC_IDS.rome, reason: "Charter ships for the crossing" });
const hulls = { op: "force_create", localId: "hulls", name: "Fifty hired transports", polityId: "rome", controllerCharacterRef: "gaius-genucius", commanderCharacterRef: "gaius-genucius", categoryId: "warship", authorizedStrength: 50, locationId: PUNIC_IDS.rome, reason: "Charter ships for the crossing" };
describe("run reliability", () => {
  it("rolls back the hulls and payment when their required hire fails", () => {
    const before = opening();
    const result = apply(before, [{ ...charter("gaius-genucius"), employerAccountRef: "gaius-purse" }, hulls]);
    expect(result.rejected).toHaveLength(2);
    expect(result.world.material.forces).toEqual(before.material.forces);
    expect(result.world.material.accounts).toEqual(before.material.accounts);
    expect(result.world.material.contracts).toEqual(before.material.contracts);
  });
  it("will not levy hired ships as local soldiers without their charter", () => {
    const before = opening(); const result = apply(before, [hulls]);
    expect(result.rejected[0]?.reason).toContain("service_contract_open");
    expect(result.world.material.provinceMaterial).toEqual(before.material.provinceMaterial);
    expect(result.world.material.accounts).toEqual(before.material.accounts);
  });
  it("creates one paid company when both the hire and its hulls are written", () => {
    const before = opening(); const result = apply(before, [charter(), hulls]);
    expect(result.rejected).toEqual([]);
    expect(result.world.material.forces.length - before.material.forces.length).toBe(1);
    const contract = result.world.material.contracts.at(-1)!;
    expect(result.assignedIds.get("hulls")).toBe(contract.forceId);
    expect(result.world.material.forces.find((force) => force.id === contract.forceId)?.payObligationId).toBe(contract.obligationId);
  });
  it("does not ask a fresh cohort on every debate day", () => {
    let world = apply(opening(), [{ op: "political_procedure_open", localId: "fleet", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius", subjectKind: "polity", subjectRef: "rome", label: "Authorize a Roman fleet", resolutionMechanism: "vote", deadlineInDays: 10, reason: "Build ships" }]).world;
    const procedure = world.material.politicalProcedures.at(-1)!; const speakers = new Set<string>();
    for (let day = 5; day < 10; day++) {
      const asked = debatersOf(world, definition.government.offices, day, [], definition.government.successionRules);
      for (const id of asked.keys()) speakers.add(id);
      world = { ...world, material: { ...world.material, supportPositions: [...world.material.supportPositions, ...[...asked.keys()].map((id) => ({ id: `pos-${id}`, procedureId: procedure.id, supporterKind: "character" as const, supporterId: id, position: "support" as const, influenceWeight: 0, visibility: "public" as const, reasons: [], provenanceEventIds: [], changedAtStep: day }))] } };
    }
    expect(speakers.size).toBeGreaterThan(0); expect(speakers.size).toBeLessThanOrEqual(4);
  });
  it("measures reinforcement by added strength rather than where the army stands", () => {
    const world = opening(); const force = world.material.forces.find((candidate) => candidate.id === "roman-field-army")!;
    const delta = WorldDeltaSchema.parse({ op: "force_reinforce", forceRef: force.id, men: 2000, categoryId: "infantry", label: "Reinforcements", reason: "Reinforce the legion" });
    expect(goalsOfAct(world, delta, [], (ref) => ref)).toEqual([{ kind: "force_strength", forceId: force.id, minimum: force.personnel.reduce((sum, item) => sum + item.fit, 0) + 2000 }]);
  });
  it("keeps Messana as the goal when the model names an intermediate shore", () => {
    const world = opening(); const delta = WorldDeltaSchema.parse({ op: "project_create", localId: "crossing", kind: "military_transport", label: "Transport Legio I", fundingAccountRef: null, sponsorRef: { kind: "character", id: "gaius-genucius" }, milestones: [{ label: "Arrival", dueInDays: 20, costAmount: 0 }], completionOutcome: { kind: "force_move", label: "Arrival", forceRef: "roman-field-army", provinceId: PUNIC_IDS.rome }, reason: "Carry the army" });
    const corrected = preserveDestination(world, delta, "Send Legio I to Messana", "Send Legio I to Messana", "gaius-genucius");
    expect(corrected.op === "project_create" && corrected.completionOutcome?.provinceId).toBe(PUNIC_IDS.messana);
    expect(missionDestination(world, "roman-field-army", "send it with them", "Send to Messana", "gaius-genucius")).toBe(PUNIC_IDS.messana);
    expect(mergeGoals([{ kind: "force_at", forceId: "roman-field-army", provinceId: PUNIC_IDS.rome }], [{ kind: "force_at", forceId: "roman-field-army", provinceId: PUNIC_IDS.messana }]).goals).toEqual([{ kind: "force_at", forceId: "roman-field-army", provinceId: PUNIC_IDS.messana }]);
  });
  it("shows a funded project as fundable even without a reservation", () => {
    const world = apply(opening(), [{ op: "project_create", localId: "fleet", kind: "naval_construction", label: "Roman fleet", sponsorRef: { kind: "polity", id: "rome" }, fundingAccountRef: "rome-treasury", milestones: [{ label: "Lay keels", dueInDays: 40, costAmount: 100 }], reason: "Build a fleet" }]).world;
    const project = world.projects.at(-1)!;
    expect(projectFundingAvailable(world, project)).toBeGreaterThanOrEqual(100);
  });
  it("moves an agent only after the engine's travel time", () => {
    const world = apply(opening(), [{ op: "service_contract_open", localId: "agent", role: "agent", label: "Messana intelligence", employerAccountRef: "rome-treasury", employeeRef: "quintus-ogulnius", advance: 10, monthlyPay: 20, termDays: 365, duties: "Report from Messana", provinceId: PUNIC_IDS.messana, reason: "Send an agent" }]).world;
    const contract = world.material.contracts.at(-1)!;
    expect(contract.journey?.toProvinceId).toBe(PUNIC_IDS.messana);
    const due = contract.journey!.arrivesAtStep;
    expect(keepContracts(world, due - 1).world.characters.find((person) => person.id === contract.employeeCharacterId)?.locationProvinceId).not.toBe(PUNIC_IDS.messana);
    expect(keepContracts(world, due).world.characters.find((person) => person.id === contract.employeeCharacterId)?.locationProvinceId).toBe(PUNIC_IDS.messana);
  });
  it("attaches implementation to an existing motion instead of creating a twin", () => {
    const motion = { op: "political_procedure_open", localId: "motion", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius", subjectKind: "polity", subjectRef: "rome", label: "Sicilian war budget", resolutionMechanism: "vote", deadlineInDays: 10, reason: "Fund the war" };
    const first = apply(opening(), [motion]);
    const next = apply(first.world, [{ ...motion, localId: "budget", enacts: { budget: { accountRef: "rome-treasury", amount: 3000, purpose: "Sicilian war" } } }]);
    expect(next.rejected).toEqual([]);
    expect(next.world.material.politicalProcedures).toHaveLength(first.world.material.politicalProcedures.length);
    expect(next.assignedIds.get("budget")).toBe(first.assignedIds.get("motion"));
    expect(next.world.enactments.some((enactment) => enactment.procedureId === first.assignedIds.get("motion") && enactment.budget?.amount === 3000)).toBe(true);
  });
  it("records a carried budget as authority, without inventing a payment", () => {
    const begun = apply(opening(), [{ op: "political_procedure_open", localId: "budget", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius", subjectKind: "polity", subjectRef: "rome", label: "Sicilian war budget", resolutionMechanism: "vote", deadlineInDays: 10, enacts: { budget: { accountRef: "rome-treasury", amount: 3000, purpose: "Sicilian war" } }, reason: "Fund the war" }]);
    expect(begun.rejected).toEqual([]);
    const result = carryOutEnactment(begun.world, begun.assignedIds.get("budget")!, 10, createIdFactory("budget"), definition.government.offices);
    expect(result.world.genericEntities.some((entity) => entity.kind === "budget_authorization" && entity.attributes.authorizedAmount === 3000)).toBe(true);
    expect(result.world.material.transactions).toEqual(begun.world.material.transactions);
  });
  it("keeps a law's own passing, so it can be read after the question has closed", () => {
    const begun = apply(opening(), [{ op: "political_procedure_open", localId: "budget", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius", subjectKind: "polity", subjectRef: "rome", label: "Sicilian war budget", resolutionMechanism: "vote", deadlineInDays: 10, enacts: { budget: { accountRef: "rome-treasury", amount: 3000, purpose: "Sicilian war" } }, reason: "Fund the war" }]);
    const result = carryOutEnactment(begun.world, begun.assignedIds.get("budget")!, 10, createIdFactory("record"), definition.government.offices);
    const enactment = result.world.enactments.find((candidate) => candidate.procedureId === begun.assignedIds.get("budget"))!;
    expect(enactment.enactedAtStep).toBe(10);
    expect(enactment.record).toMatchObject({ title: "Sicilian war budget", sponsorCharacterId: "gaius-genucius", decidedAtStep: 10 });
    expect(enactment.record?.bodyName).toBeTruthy();
    expect(enactment.record?.said).toMatch(/authorised/);
  });
  it("keeps the body and the vote in the history of a constitutional change it carries", () => {
    const begun = apply(ensureConstitutions({ world: opening(), government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, toDay: 0 }), [{ op: "political_procedure_open", localId: "reform", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius", subjectKind: "polity", subjectRef: "rome", label: "Found a Board of Censors", resolutionMechanism: "vote", deadlineInDays: 10, enacts: { constitution: { chamber: { name: "Board of Censors", powers: ["laws"], franchise: "council" } } }, reason: "Reform" }]);
    expect(begun.rejected).toEqual([]);
    const id = begun.assignedIds.get("reform")!;
    const result = carryOutEnactment(begun.world, id, 12, createIdFactory("reform"), definition.government.offices, definition.government.successionRules);
    const change = result.world.constitutions.find((entry) => entry.polityId === "rome")?.history.at(-1);
    expect(change).toMatchObject({ origin: "reform", procedureId: id });
    expect(change?.bodyName).toBeTruthy();
  });
});


const run = (world: WorldState, body: Record<string, unknown>, text: string | null = "Carry out my instructions") => {
  const port: SimModelPort = { complete(operation) { return Promise.resolve(JSON.stringify(operation === "simulate_orchestrate" ? { narrativeSummary: "Instructions recorded", deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], frictions: [], outcome: "continue", playerDecision: null, intent: { summary: "Instructions", parts: [] }, ...body } : { actors: [] })); } };
  return runSimulationBurst({ world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "conditional-proof", gameId: "test", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome", orderText: text, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1 });
};
describe("persistent conditional work and accounts", () => {
  it("remembers a future punitive force instead of dropping the instruction", async () => {
    const result = await run(opening(), { intent: { summary: "Send the future force", parts: [{ said: "When a punitive force is raised, send it with the Greek ships", acts: [], whenForceExists: "punitive", whyNot: "No such force yet" }] } });
    const part = result.world.orders.at(-1)!.parts[0]!;
    expect(part.stages[0]?.waitsOn).toContainEqual({ kind: "force_named", name: "punitive", polityId: "rome" });
    expect(part.whyNot).toBeNull(); expect(orderPartStatus(result.world, part)).toBe("awaiting_condition");
  });
  it("resumes a waiting instruction through an officer when its force appears", async () => {
    const base = opening(); const army = base.material.forces.find((force) => force.id === "roman-field-army")!;
    const order = OrderRecordSchema.parse({ id: "standing-order", actorCharacterId: "gaius-genucius", text: "Send the punitive force", givenAtStep: 0, parts: [{ said: "Send the punitive force to Messana", stages: [{ held: { op: "resume_instruction", instruction: "Send the punitive force to Messana" }, waitsOn: [{ kind: "force_named", name: "punitive", polityId: "rome" }], status: "waiting" }] }] });
    const world: WorldState = { ...base, orders: [order], material: { ...base.material, forces: [...base.material.forces, { ...army, id: "punitive-force", name: "Punitive force" }] } };
    const result = await run(world, {}, null);
    const resumed = result.world.orders.find((candidate) => candidate.id === order.id)!.parts[0]!;
    expect(resumed.stages[0]?.status).toBe("resumed");
    expect(result.world.orderAttempts.some((attempt) => attempt.servesRef === "standing-order-p0")).toBe(true);
  });
  it("counts the immediate charter payment against its own spending envelope", () => {
    const hired = apply(opening(), [charter()]); const contract = hired.world.material.contracts.at(-1)!;
    const order = OrderRecordSchema.parse({ id: "hire-order", actorCharacterId: "gaius-genucius", text: "Hire ships", givenAtStep: 0, parts: [{ said: "Hire ships", workRefs: [{ kind: "contract", id: contract.id }], spend: { cap: 900, payerAccountId: "rome-treasury" } }] });
    const world = { ...hired.world, orders: [order] };
    expect(spentForOrderPart(world, order.parts[0]!)).toBe(900);
  });
  it("never schedules an agent report before travel and collection time", async () => {
    const result = await run(opening(), { intent: { summary: "Send intelligence agent", parts: [{ said: "Send an agent to Messana", acts: [0] }] }, deltas: [{ op: "service_contract_open", localId: "agent", role: "agent", label: "Messana intelligence", employerAccountRef: "rome-treasury", employeeRef: "quintus-ogulnius", advance: 10, monthlyPay: 20, termDays: 365, duties: "Report from Messana", provinceId: PUNIC_IDS.messana, reason: "Send an agent" }], schedule: [{ kind: "intelligence_mission_report", dueInDays: 1, summary: "Agent reports", subjectRefs: ["quintus-ogulnius"], visibility: "private" }] });
    const contract = result.world.material.contracts.at(-1)!;
    expect(result.scheduled[0]!.dueInstantSortKey).toBeGreaterThanOrEqual((contract.journey!.arrivesAtStep + 2) * 1440);
  });
});
