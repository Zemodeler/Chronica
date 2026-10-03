/** Repair the audited Clepsina save without advancing time. Dry run unless --apply. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld } from "@chronica/db";
import { WorldDeltaSchema, WorldStateSchema, EnactmentSchema, findWorldReferenceViolations, newsDaysBetween, orderPartRef, type WorldState, type OrderStage } from "@chronica/shared";
import { applyDeltas } from "../packages/sim/src/apply/apply-deltas";
import { createIdFactory } from "../packages/sim/src/ports";
import { carryOutEnactment } from "../packages/sim/src/enact";

const gameId = process.argv[2];
if (gameId !== "7d212ada-aeb7-49f8-81c5-5af5f636579d") throw Error("This repair is scoped to the audited Clepsina save.");
const database = createDatabase(process.env.DATABASE_URL!);
try {
  const view = await getWorldView(database.db, gameId);
  if (view === undefined) throw Error("No world.");
  const before = view.world;
  if (view.revision !== 9 || before.elapsedStep !== 49) throw Error("The audited revision changed; inspect the new run before repairing.");
  const actor = "declared-94556bab-1163-42af-895b-fb03789487ac";
  const latestId = "order-record-6dea24d4-9b12-4064-a122-7337326057de-16";
  const earlierId = "order-record-950ce8a7-0712-47ea-846f-d7acdd96cef6-20";
  const fleetId = "force-6dea24d4-9b12-4064-a122-7337326057de-6";
  const oldTransport = "project-6dea24d4-9b12-4064-a122-7337326057de-9";
  const agentContract = "contract-6dea24d4-9b12-4064-a122-7337326057de-2";
  const budgetProcedure = "procedure-950ce8a7-0712-47ea-846f-d7acdd96cef6-15";
  const navyProcedure = "procedure-139b4bd6-c40d-4643-a6ea-621210aa0929-66";
  const duplicateProcedure = "procedure-139b4bd6-c40d-4643-a6ea-621210aa0929-105";
  const messana = "sic-q659z";
  const released = before.material.reservations.filter((reservation) => reservation.status === "active" && [earlierId, latestId].some((id) => reservation.purposeId.startsWith(id))).map((reservation) => reservation.id);
  let world: WorldState = { ...before,
    map: { ...before.map, provinces: before.map.provinces.map((province) => province.id === "it-5sjyb" ? { ...province, name: "Rhegium coast" } : province) },
    material: { ...before.material, reservations: before.material.reservations.map((reservation) => released.includes(reservation.id) ? { ...reservation, status: "released", closedAtStep: before.elapsedStep } : reservation) },
    projects: before.projects.map((project) => project.id === oldTransport ? { ...project, status: "cancelled" } : project),
  };
  const ids = createIdFactory("save-consistency-repair");
  const raw = [
    { op: "character_create", localId: "captain", name: "Lucius Valerius, transport master", polityId: "rome", provinceId: "it-l865w", age: 38, officeLabel: null, traits: ["Practical", "Cautious"], standing: "a merchant shipmaster", wealth: 0, generatedBecause: "The fifty transports already hired require an independent captain and a real charter; correcting the failed self-hire." },
    { op: "force_modify", forceRef: fleetId, commanderCharacterRef: "local:captain", reason: "Assign the hired transports to their shipmaster before signing their charter." },
    { op: "service_contract_open", localId: "charter", role: "mercenary", label: "Fifty hired transports for Sicily", duties: "Provide fifty transport ships and crews for repeated sailings carrying Legio I to Messana.", employerAccountRef: "gaius-purse", employeeRef: "local:captain", forceRef: fleetId, advance: 900, monthlyPay: 80, termDays: 180, provinceId: "it-l865w", reason: "Complete the authorised charter now; the original self-hire failed. No payment is backdated." },
  ];
  const deltas = raw.map((delta) => WorldDeltaSchema.parse(delta));
  const context = { now: world.instant, actorRef: { kind: "character" as const, id: actor }, offices: view.scenarioGovernment.offices, successionRules: view.scenarioGovernment.successionRules, warfare: view.scenarioWarfare, terrains: view.scenarioMap.terrains, clock: view.scenarioClock, ids, gameId, orderDeltas: new Set(deltas), atomicGroups: [deltas] };
  const hired = applyDeltas(world, deltas, context);
  if (hired.rejected.length) throw Error(JSON.stringify(hired.rejected));
  world = hired.world;
  const contractId = hired.assignedIds.get("charter")!;
  const move = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "roman-field-army", locationId: messana, fleetRefs: [fleetId], reason: "Carry Legio I to Messana using the fifty hired transports, with real assembly and crossing legs." });
  const transported = applyDeltas(world, [move], { ...context, atomicGroups: [], orderDeltas: new Set([move]) });
  if (transported.rejected.length) throw Error(JSON.stringify(transported.rejected));
  world = transported.world;
  const crossing = world.projects.find((project) => !before.projects.some((old) => old.id === project.id) && project.kind === "crossing" && project.completionOutcome?.provinceId === messana);
  if (crossing === undefined) throw Error("No engine crossing was arranged.");
  if (!crossing.completionOutcome?.fleetIds?.includes(fleetId) || crossing.completionOutcome.embarkProvinceId === undefined) throw Error("Crossing has no fleet or embarkation shore.");
  if (world.material.forces.find((force) => force.id === fleetId)?.payObligationId === null) throw Error("Charter has no fleet pay link.");
  const agent = world.material.contracts.find((contract) => contract.id === agentContract)!;
  const employee = world.characters.find((character) => character.id === agent.employeeCharacterId)!;
  const arrives = world.elapsedStep + Math.max(1, newsDaysBetween(world, employee.locationProvinceId, messana));
  const waiting = (instruction: string, waitsOn: OrderStage["waitsOn"]): OrderStage => ({ held: { op: "resume_instruction", instruction }, waitsOn, status: "waiting", reason: null });
  world = { ...world,
    material: { ...world.material,
      contracts: world.material.contracts.map((contract) => contract.id === agentContract ? { ...contract, provinceId: messana, journey: { fromProvinceId: employee.locationProvinceId, toProvinceId: messana, arrivesAtStep: arrives, arrivedAtStep: null } } : contract),
      transactions: world.material.transactions.map((transaction) => transaction.cause.id === contractId ? { ...transaction, sourceActionId: orderPartRef(latestId, 0) } : transaction.cause.id === agentContract ? { ...transaction, sourceActionId: orderPartRef(latestId, 1) } : transaction),
    },
    orders: world.orders.map((order) => order.id === latestId ? { ...order, parts: order.parts.map((part, index) => index === 0 ? { ...part, goals: [{ kind: "contract_active", contractId }], workRefs: [{ kind: "contract", id: contractId }, { kind: "force", id: fleetId }], spend: { ...part.spend!, reservationId: null }, note: null } : index === 1 ? { ...part, goals: [{ kind: "contract_active", contractId: agentContract }], workRefs: [{ kind: "contract", id: agentContract }], spend: { ...part.spend!, reservationId: null }, note: null } : index === 2 ? { ...part, goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: messana }], workRefs: [{ kind: "project", id: crossing.id }], spend: null, note: null } : { ...part, whyNot: null, stages: [waiting(part.said, [{ kind: "force_named", name: "punitive", polityId: "rome" }])] }) }
      : order.id === earlierId ? { ...order, parts: order.parts.map((part, index) => index === 0 ? { ...part, goals: [{ kind: "force_strength", forceId: "roman-field-army", minimum: 9100 }] } : index === 1 ? { ...part, closedAtStep: world.elapsedStep, note: "Superseded by the completed fifty-ship charter and the engine's Messana crossing; unused funding released." } : index === 2 ? { ...part, whyNot: null, stages: [waiting(part.said, [{ kind: "force_at", forceId: "roman-field-army", provinceId: messana }])] } : part) }
      : { ...order, parts: order.parts.map((part) => part.workRefs.some((ref) => ref.id === navyProcedure) ? { ...part, goals: [{ kind: "procedure_passed", procedureId: navyProcedure }, { kind: "project_done", projectId: "project-139b4bd6-c40d-4643-a6ea-621210aa0929-67" }] } : part) }),
  };
  const navyEnactment = world.enactments.find((enactment) => enactment.procedureId === navyProcedure)!;
  world = { ...world, enactments: [...world.enactments,
    { ...navyEnactment, procedureId: duplicateProcedure, enactedAtStep: world.elapsedStep },
    EnactmentSchema.parse({ procedureId: budgetProcedure, polityId: "rome", budget: { accountId: "rome-treasury", amount: null, purpose: "War in Sicily" } }),
  ] };
  world = carryOutEnactment(world, budgetProcedure, world.elapsedStep, ids, view.scenarioGovernment.offices).world;
  world = WorldStateSchema.parse(world);
  if (world.elapsedStep !== before.elapsedStep || JSON.stringify(world.instant) !== JSON.stringify(before.instant)) throw Error("Repair advanced the calendar.");
  const preExisting = new Set(findWorldReferenceViolations(before));
  const introduced = findWorldReferenceViolations(world).filter((violation) => !preExisting.has(violation));
  if (introduced.length) throw Error(JSON.stringify(introduced));
  const report = { gameId, revision: view.revision, day: world.elapsedStep, reservationsReleased: released, charterId: contractId, charterPaidNow: 900, fleetCountBefore: before.material.forces.length, fleetCountAfter: world.material.forces.length, crossing: { id: crossing.id, arrivesAt: crossing.targetCompletionStep, destination: crossing.completionOutcome?.provinceId, fleetIds: crossing.completionOutcome?.fleetIds }, agentArrivesAt: arrives, reportNotBefore: arrives + 2 };
  writeFileSync("/private/tmp/chronica-repaired-world.json", JSON.stringify(world));
  console.log(JSON.stringify(report, null, 2));
  if (!process.argv.includes("--apply")) { console.log("Dry run; no save changed."); }
  else {
    const backupDir = "/private/tmp/chronica-save-backups";
    mkdirSync(backupDir, { recursive: true });
    const backup = `${backupDir}/${gameId}-revision-${view.revision}.json`;
    writeFileSync(backup, JSON.stringify({ world: before, revision: view.revision, report, events: JSON.parse(readFileSync("/private/tmp/chronica-current-audit.json", "utf8")).events }), { flag: "wx" });
    const revision = await persistRepairedWorld(database.db, { gameId, expectedRevision: view.revision, world, intelligenceReportsNotBeforeStep: arrives + 2, repairRecord: { title: "Orders and accounts corrected", body: "The fifty hired transports now have an independent shipmaster, a charter, and their monthly pay. The missing 900 was paid from your purse today; earlier payments were not backdated. Legio I is ordered to Messana, with the ships and army assembling at an embarkation shore before the crossing. Its defense orders wait for arrival. The punitive-force instruction remains waiting for that force to exist. Publius Sestius now has a real journey to Sicily, and his report waits until after arrival. Obsolete funding holds were released; the Senate’s war budget is established and the fleet petition points to the existing construction. The calendar has not advanced." } });
    console.log(JSON.stringify({ writtenRevision: revision, backup }));
  }
} finally { await database.close(); }
