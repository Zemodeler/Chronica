// Scratch playtest driver: replicates apps/web/lib/simulation-service.ts's
// submitOrder without the browser session, so the narrator can be watched
// from a terminal. Usage: npx tsx scripts/narrator-play.ts <gameId> "<order>"
import { callWithCoinGate, createAiAdapter } from "@chronica/ai";
import { commitBurst, createDatabase, ensureBuiltInScenarios, failBurst, getOpenDecision, getWorldView, listChronicle, listPendingEvents, listRecentFacts, persistOpeningWorld, schema, startBurst } from "@chronica/db";
import { FactSchema, type Fact, type OrderPartyRef } from "@chronica/shared";
import { composeChronicle, runSimulationBurst, type SimModelPort } from "@chronica/sim";
import { and, eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";

const [gameId, orderText] = process.argv.slice(2);
if (!gameId || !orderText) throw new Error("usage: narrator-play <gameId> <order>");
const { db, close } = createDatabase(process.env.DATABASE_URL!);
const outDir = process.env.PLAY_OUT ?? "/tmp";

try {
  if (orderText === "--chronicles") {
    const rows = await listChronicle(db, gameId, 200);
    for (const row of rows) console.log(`\n## ${row.title}\n_(days ${Math.floor(Number(row.fromInstantSortKey) / 1440)}–${Math.floor(Number(row.toInstantSortKey) / 1440)})_\n\n${row.body}`);
    process.exit(0);
  }
  if (orderText.startsWith("--repin=")) {
    // One-off for a playtest game: move it to a newer scenario version and seat
    // the offices that version adds, so definition and world agree.
    const version = Number(orderText.slice("--repin=".length));
    await ensureBuiltInScenarios(db);
    const view = await getWorldView(db, gameId);
    if (!view) throw new Error("no world");
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
    const [scenarioVersion] = await db.select().from(schema.scenarioVersions).where(and(eq(schema.scenarioVersions.scenarioId, game!.scenarioId), eq(schema.scenarioVersions.version, version))).limit(1);
    if (!scenarioVersion) throw new Error("no such version");
    const fresh = scenarioVersion.initialWorld as { material: { officeSeats: typeof view.world.material.officeSeats }; characters: { id: string; officeId: string | null }[] };
    const seats = fresh.material.officeSeats.filter((seat) => !view.world.material.officeSeats.some((existing) => existing.id === seat.id));
    const officeOf = new Map(fresh.characters.map((c) => [c.id, c.officeId]));
    const world = {
      ...view.world,
      pins: { ...view.world.pins, scenarioVersion: version },
      material: { ...view.world.material, officeSeats: [...view.world.material.officeSeats, ...seats] },
      characters: view.world.characters.map((c) => (c.officeId === null && officeOf.get(c.id) ? { ...c, officeId: officeOf.get(c.id)! } : c)),
    };
    await persistOpeningWorld(db, gameId, world);
    await db.update(schema.games).set({ scenarioVersion: version }).where(eq(schema.games.id, gameId));
    console.log(`repinned to v${version}; seats added: ${seats.map((seat) => seat.id).join(", ")}`);
    process.exit(0);
  }
  const [player] = await db.select().from(schema.players).where(eq(schema.players.gameId, gameId)).limit(1);
  if (!player?.characterId) throw new Error("no seated player");
  const view = await getWorldView(db, gameId);
  if (!view?.scenarioClock || !view.scenarioWarfare) throw new Error("no world");
  if (await getOpenDecision(db, gameId)) throw new Error("a decision is open");

  const [factRows, queueRows] = await Promise.all([listRecentFacts(db, gameId), listPendingEvents(db, gameId)]);
  const actorRef: OrderPartyRef = { kind: "character", id: player.characterId };
  const actorPolityId = view.world.characters.find((c) => c.id === player.characterId)?.polityId ?? null;
  const burstId = await startBurst(db, { gameId, playerUserId: player.userId, orderText });
  const adapter = createAiAdapter();
  const shown: Record<string, string[]> = {};
  const port: SimModelPort = {
    async complete(operation, systemPrompt, userMessage) {
      (shown[operation] ??= []).push(userMessage);
      const result = await callWithCoinGate(db, player.userId, gameId, operation, adapter, { system: systemPrompt, user: userMessage });
      (shown[`${operation}:out`] ??= []).push(result.content);
      return result.content;
    },
  };
  const from = view.world.instant;
  console.log(`day ${from.day} · narrator ledger`, JSON.stringify(view.world.narrator), `· open threads ${view.world.storylines.filter((s) => s.phase !== "closed").length}`);

  let result;
  try {
    result = await runSimulationBurst({
      world: view.world, clock: view.scenarioClock, offices: view.scenarioGovernment?.offices ?? [], warfare: view.scenarioWarfare,
      burstId, gameId, actorRef, actorPolityId, orderText,
      knownFacts: factRows.map((row) => FactSchema.parse(row.fact)) as Fact[],
      queue: queueRows.map((row) => ({ id: row.id, dueInstantSortKey: row.dueInstantSortKey, kind: row.kind, summary: row.summary, payload: row.payload })),
      port,
    });
  } catch (error) {
    await failBurst(db, burstId, String(error));
    throw error;
  }

  const orchestratorPrompt = shown.simulate_orchestrate?.[0] ?? "";
  const stirs = orchestratorPrompt.match(/THE WORLD STIRS[\s\S]*?\n\n/);
  console.log(stirs ? `\n--- DIRECTIVE ---\n${stirs[0]}` : "\n--- no seed this burst ---");

  const chronicle = result.outcome === "continue" ? null : await composeChronicle({
    port, clock: view.scenarioClock, observer: actorRef, observerPolityId: actorPolityId, facts: result.newFacts, from, to: result.world.instant,
    narrative: result.narrative, frictions: result.frictions, significanceByFactId: result.significanceByFactId,
    storylines: result.world.storylines, polityOfCharacter: (id) => result.world.characters.find((c) => c.id === id)?.polityId ?? null,
  });

  const toRow = (fact: Fact) => ({
    id: fact.id, instantSortKey: fact.time.day * 1440 + fact.time.minute, kind: fact.kind, summary: fact.summary, visibility: fact.visibility,
    discoveryState: fact.discovery.state,
    knowableAtSortKey: fact.discovery.knowableAtInstant === null ? null : fact.discovery.knowableAtInstant.day * 1440 + fact.discovery.knowableAtInstant.minute,
    significance: result.significanceByFactId.get(fact.id) ?? 0, causalDepth: fact.causalDepth, fact,
  });
  writeFileSync(`${outDir}/burst-${burstId}.json`, JSON.stringify({ shown, result: { ...result, world: undefined } }, null, 2));
  await commitBurst(db, {
    gameId, expectedRevision: view.revision, world: result.world, burstId,
    facts: result.newFacts.map(toRow), rediscoveredFacts: result.rediscoveredFacts.map(toRow), scheduled: result.scheduled, firedEventIds: result.firedEventIds,
    burst: { iterations: result.iterations, modelCalls: result.modelCalls + (chronicle?.calls ?? 0), outcome: result.outcome, stopReason: result.stopReason, accumulatedSignificance: result.accumulatedSignificance },
    ...(chronicle && chronicle.entries.length > 0 ? { checkpoints: chronicle.entries.map((e) => ({ title: e.title, body: e.body, factIds: e.factIds, subjects: e.subjects, fromInstantSortKey: e.fromInstantSortKey, toInstantSortKey: e.toInstantSortKey })) } : {}),
    ...(result.playerDecision ? { decision: { prompt: result.playerDecision.prompt, options: result.playerDecision.options } } : {}),
  });

  console.log(`\n=== ${orderText} ===`);
  console.log(`days ${from.day} → ${result.world.instant.day} · stop ${result.stopReason} · outcome ${result.outcome} · calls ${result.modelCalls} · iterations ${result.iterations}`);
  if (result.parseFailures.length) console.log("parse failures:", result.parseFailures);
  console.log("ledger:", JSON.stringify(result.world.narrator));
  console.log("breaches:", result.breaches.map((b) => b.reason));
  console.log("threads:", result.world.storylines.map((s) => `${s.title} [${s.id}] ${s.phase} ${s.visibility} seed=${s.seedKey} facts=${s.causalFactIds.length}`));
  console.log("pressures:", result.world.characterPressures.filter((p) => p.status === "active").map((p) => `${p.characterId}: ${p.kind} ${p.intensity} (${p.visibility}) ${p.label}`));
  console.log("new facts:", result.newFacts.map((f) => `[${f.visibility}${f.discovery.discoveredBy.length ? ` known to ${f.discovery.discoveredBy.map((d) => d.observerRef.id).join(",")}` : ""}] ${f.kind}: ${f.summary}`));
  console.log("scheduled:", result.scheduled.map((e) => `${e.kind} @${Math.round(e.dueInstantSortKey / 1440)} ${JSON.stringify(e.payload)}`));
  for (const entry of chronicle?.entries ?? []) console.log(`\n## ${entry.title}\n${entry.body}`);
  if (result.playerDecision) console.log("\nDECISION:", result.playerDecision.prompt, result.playerDecision.options.map((o) => o.label));
  console.log(`\ntranscript: ${outDir}/burst-${burstId}.json`);
} finally {
  await close();
}
