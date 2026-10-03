/** Repair the audited save's peace proposals without agreeing to anything or advancing time. */
import { mkdirSync, writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld } from "@chronica/db";
import { advanceWorldTo, peaceOfferMetadata, WorldDeltaSchema, WorldStateSchema } from "@chronica/shared";
import { applyDeltas, createIdFactory } from "@chronica/sim";

const gameId = process.argv[2];
if (gameId !== "7d212ada-aeb7-49f8-81c5-5af5f636579d") throw Error("This repair is scoped to the audited Clepsina game.");
const database = createDatabase(process.env.DATABASE_URL!);
try {
  const view = await getWorldView(database.db, gameId);
  if (!view || view.revision !== 10 || view.world.elapsedStep !== 49) throw Error("The inspected save changed. Inspect it again before repairing.");
  const before = view.world;
  const changed: string[] = [];
  const world = WorldStateSchema.parse({ ...before, diplomacy: before.diplomacy.map((message) => {
    const metadata = peaceOfferMetadata(message);
    let repaired = { ...message, ...metadata };
    // The final offer explicitly proposes surrender of this one-city garrison
    // and safe conduct for ordinary soldiers, excluding its leaders. Encode
    // those existing terms, so acceptance actually carries out the surrender.
    if (message.id === "message-6dea24d4-9b12-4064-a122-7337326057de-80" && !(message.clauses?.length)) {
      const clauses = WorldDeltaSchema.parse({ op: "diplomatic_message_send", localId: "offer", kind: "peace_offer", fromPolityId: message.fromPolityId,
        fromCharacterRef: message.fromCharacterId, toPolityId: message.toPolityId, subject: message.subject, terms: message.terms, reason: "Encode the existing surrender terms.",
        clauses: [
          { kind: "submission", polityId: "rhegium-campanians", toPolityId: "rome" },
          { kind: "undertaking", byPolityId: "rome", duty: "other", what: "Grant safe conduct to the ordinary Rhegium soldiers without execution or punitive service; Decius and the other leaders are excluded from that protection.", withinDays: 1 },
        ] });
      if (clauses.op !== "diplomatic_message_send") throw Error("Wrong delta.");
      repaired = { ...repaired, clauses: clauses.clauses ?? [] };
    }
    if (JSON.stringify(repaired) !== JSON.stringify(message)) changed.push(message.id);
    return repaired;
  }) });
  if (JSON.stringify(world.instant) !== JSON.stringify(before.instant) || world.elapsedStep !== before.elapsedStep) throw Error("Calendar changed.");
  if (JSON.stringify(world.polityAgreements) !== JSON.stringify(before.polityAgreements)) throw Error("Repair must not agree to peace.");
  // Probe acceptance on a copy only: verify the stored offer really can carry
  // out its treaty once it arrives. The probe is never saved.
  const finalOffer = world.diplomacy.find((message) => message.id === "message-6dea24d4-9b12-4064-a122-7337326057de-80")!;
  const probe = advanceWorldTo(structuredClone(world), { day: finalOffer.deliveredOnDay!, minute: 0 });
  const acceptance = applyDeltas(probe, [WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: finalOffer.id, answer: "accepted", answerText: "I accept the stated terms.", reason: "Dry-run treaty validation." })], {
    now: probe.instant, actorRef: { kind: "character", id: finalOffer.toCharacterId! }, offices: view.scenarioGovernment.offices,
    successionRules: view.scenarioGovernment.successionRules, warfare: view.scenarioWarfare, ids: createIdFactory("peace-repair-probe"), gameId,
    playerCharacterId: finalOffer.toCharacterId!,
  });
  if (acceptance.rejected.length || acceptance.factProposals.some((fact) => fact.kind === "acceptance_unbound")) throw Error(`Treaty probe failed: ${JSON.stringify(acceptance.rejected)} ${acceptance.factProposals.filter((fact) => fact.kind === "acceptance_unbound").map((fact) => fact.summary).join(" ")}`);
  if (!acceptance.world.diplomacy.find((message) => message.id === finalOffer.id)?.agreementId) throw Error("Accepted treaty has no record.");
  if (acceptance.world.polityAgreements.some((agreement) => agreement.id === "war-rome-rhegium" && agreement.status === "active")) throw Error("Accepted peace leaves the war active.");
  WorldStateSchema.parse(acceptance.world);
  console.log(JSON.stringify({ revision: view.revision, day: world.elapsedStep, repairedMessages: changed }));
  if (process.argv.includes("--apply")) {
    mkdirSync("/private/tmp/chronica-save-backups", { recursive: true });
    const backup = `/private/tmp/chronica-save-backups/${gameId}-peace-revision-${view.revision}.json`;
    writeFileSync(backup, JSON.stringify({ world: before, revision: view.revision }), { flag: "wx" });
    const revision = await persistRepairedWorld(database.db, { gameId, expectedRevision: view.revision, world, repairRecord: {
      title: "Rhegium peace negotiations clarified", storylineIds: ["rhegium-recovery"],
      body: "Decius rejected the execution and punitive-service terms and offered surrender in exchange for safe conduct for the ordinary soldiers, with the leaders excluded. Your renewed punitive terms remain awaiting an answer. No peace has been accepted. Peace proposals now stand as treaty offers; acceptance will bind their terms through the treaty process. The calendar has not advanced.",
    } });
    console.log(JSON.stringify({ writtenRevision: revision, backup }));
  } else console.log("Dry run; no save changed.");
} finally { await database.close(); }
