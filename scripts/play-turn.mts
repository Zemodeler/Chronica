// Plays a turn from the terminal, the way the web app plays it.
//
// The browser needs a session; a measurement does not. This runs the same two
// functions the web runs for an order -- `prepareBurst` and `runBurstToCommit`
// in `apps/web/lib/burst-runner.ts` -- against a save in the local database,
// so a turn can be timed and its audit read without anybody logged in. The one
// thing it leaves out is the conversation somebody may open with the ruler
// afterwards, which is the web's business and runs after the timing line.
//
// The model is answered by hand from eval-out/hand-turns unless --live is
// given (scripts/lib/model-mode.mts): the turn waits for each answer file, and
// nothing is spent. With --live it is the provider, and coins, as in the web.
//
// Usage, from the repo root:
//   npx tsx --env-file=.env.local scripts/play-turn.mts --new "<title>" [--as <characterId>] [--user <email>]
//   npx tsx --env-file=.env.local scripts/play-turn.mts <gameId> "<order>"
//   npx tsx --env-file=.env.local scripts/play-turn.mts <gameId> --wait <days>
//   npx tsx --env-file=.env.local scripts/play-turn.mts <gameId> --chronicles
//   npx tsx --env-file=.env.local scripts/play-turn.mts <gameId> --repin[=<version>]
import {
  PUNIC_WARS_SCENARIO_ID,
  claimCharacter,
  createDatabase,
  createGame,
  ensureBuiltInScenarios,
  getWorldView,
  listChronicle,
  repinGame,
  schema,
} from "@chronica/db";
import { and, eq } from "drizzle-orm";
import { prepareBurst, runBurstToCommit } from "../apps/web/lib/burst-runner";
import { chooseModel } from "./lib/model-mode.mts";

const args = process.argv.slice(2);
chooseModel(args, "eval-out/hand-turns");
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const { db, close } = createDatabase(process.env.DATABASE_URL!);

async function newGame(): Promise<void> {
  const title = flag("--new")!;
  const characterId = flag("--as") ?? "gaius-genucius";
  const email = flag("--user") ?? "andrei.dodu@icloud.com";
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (user === undefined) throw new Error(`no user ${email}`);
  await ensureBuiltInScenarios(db);
  const gameId = await createGame(db, {
    title, scenarioId: PUNIC_WARS_SCENARIO_ID, startingSeatCount: 1, extraPrincipalsPerPlayer: 0, hostUserId: user.id,
    coinBudgetMicroUnits: 5_000_000n,
  });
  const [player] = await db.select({ id: schema.players.id }).from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, user.id))).limit(1);
  if (player === undefined) throw new Error("the host was not seated");
  const claimed = await claimCharacter(db, { gameId, playerId: player.id, claim: { origin: "suggested", characterId }, characterId });
  const [game] = await db.select({ version: schema.games.scenarioVersion }).from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  console.log(`game ${gameId} · scenario v${game?.version} · ${email} plays ${characterId} (${claimed})`);
}

async function chronicles(gameId: string): Promise<void> {
  const rows = await listChronicle(db, gameId, 200);
  for (const row of rows) console.log(`\n## ${row.title}\n_(days ${Math.floor(Number(row.fromInstantSortKey) / 1440)}–${Math.floor(Number(row.toInstantSortKey) / 1440)})_\n\n${row.body}`);
}

/** Moves a save onto a newer scenario version (`repinGame`); with no number, onto the current one. */
async function repin(gameId: string, version: number | undefined): Promise<void> {
  await ensureBuiltInScenarios(db);
  const report = await repinGame(db, gameId, { toVersion: version });
  console.log(`repinned v${report.fromVersion} -> v${report.toVersion}; seats added: ${report.seatsAdded.join(", ") || "none"}; offices given: ${report.officesGiven.join(", ") || "none"}`);
}

async function playTurn(gameId: string, orderText: string | null, spanDays: number | undefined): Promise<void> {
  const [player] = await db
    .select({ id: schema.players.id, userId: schema.players.userId, characterId: schema.players.characterId })
    .from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.status, "active")))
    .limit(1);
  if (player === undefined || player.userId === null || player.characterId.startsWith("pending:")) throw new Error("no seated player");

  const prepared = await prepareBurst(db, { gameId, userId: player.userId, playerId: player.id, characterId: player.characterId, orderText, spanDays });
  if (prepared.status === "error") throw new Error(prepared.message);
  const startedAt = performance.now();
  await runBurstToCommit(db, prepared.job, {
    onProgress: (line) => console.log(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line.stage}: ${line.line}`),
  });

  const [burst] = await db.select({ status: schema.simulationBursts.status, error: schema.simulationBursts.error }).from(schema.simulationBursts).where(eq(schema.simulationBursts.id, prepared.job.burstId)).limit(1);
  if (burst?.status !== "committed") throw new Error(`the burst ${burst?.status ?? "vanished"}: ${burst?.error ?? "no reason recorded"}`);
  const view = await getWorldView(db, gameId);
  console.log(`\nday ${prepared.job.view.world.instant.day} → ${view?.world.instant.day} · burst ${prepared.job.burstId}`);
  const entries = await listChronicle(db, gameId, 20);
  for (const entry of entries.filter((row) => row.burstId === prepared.job.burstId)) console.log(`\n## ${entry.title}\n${entry.body}`);
}

try {
  if (flag("--new") !== undefined) await newGame();
  else {
    const [gameId, second] = args;
    if (!gameId || !second) throw new Error("usage: play-turn <gameId> \"<order>\" | --wait <days> | --chronicles | --repin[=<n>]");
    if (second === "--chronicles") await chronicles(gameId);
    else if (second === "--repin" || second.startsWith("--repin=")) await repin(gameId, second === "--repin" ? undefined : Number(second.slice("--repin=".length)));
    else if (second === "--wait") await playTurn(gameId, null, Number(flag("--wait")));
    else await playTurn(gameId, second, undefined);
  }
} finally {
  await close();
}
