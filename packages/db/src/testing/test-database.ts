import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, type ChronicaDatabase } from "../database";
import { gameWorlds } from "../schema/simulation";
import { games, players, scenarioVersions, scenarios } from "../schema/game";
import { users } from "../schema/auth";

/**
 * A throwaway Postgres for the tests that need one (`*.db.test.ts`).
 *
 * Only `CHRONICA_TEST_DATABASE_URL`, never `DATABASE_URL`: these tests run
 * every migration and write rows, and must never do either to somebody's own
 * save. The URL must name a database whose name says it is for tests, and
 * may not be the one `DATABASE_URL` names. Unset, the tests are skipped --
 * the CI's database tier sets it to a service container.
 */
export const TEST_DATABASE_URL = process.env.CHRONICA_TEST_DATABASE_URL?.trim() || null;

export function assertDisposable(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) throw new Error(`CHRONICA_TEST_DATABASE_URL must name a database for tests (its name must contain "test"); got "${name}".`);
  const own = process.env.DATABASE_URL?.trim();
  if (own !== undefined && own.length > 0 && own === url) throw new Error("CHRONICA_TEST_DATABASE_URL is DATABASE_URL; refusing to migrate or write to it.");
}

export async function openTestDatabase(): Promise<{ db: ChronicaDatabase; close: () => Promise<void> }> {
  if (TEST_DATABASE_URL === null) throw new Error("CHRONICA_TEST_DATABASE_URL is not set.");
  assertDisposable(TEST_DATABASE_URL);
  const opened = createDatabase(TEST_DATABASE_URL);
  await migrate(opened.db, { migrationsFolder: MIGRATIONS });
  return opened;
}

/** The smallest world the schema will load: no map, no people, no money. */
export function minimalWorld(day = 0): Record<string, unknown> {
  const empty = (keys: string) => Object.fromEntries(keys.split(" ").map((key) => [key, []]));
  return {
    schemaVersion: 3,
    pins: { scenarioId: "test", scenarioVersion: 1, libraryVersion: 1 },
    elapsedStep: day,
    instant: { day, minute: 0 },
    map: empty("provinces edges polities"),
    characters: [],
    continuity: [],
    encounters: [],
    material: {
      currency: { id: "coin", name: "Coin", unitName: "coin", unitNamePlural: "coins" },
      ...empty("accounts accountAccess incomeSources obligations transactions capturableValues holdings institutions reservedPowers motions voteRecords forces"),
    },
  };
}

/** A user, a scenario, and a game with its world at revision 1: what every durable-turn test starts from. */
export async function seedGame(db: ChronicaDatabase): Promise<{ gameId: string; userId: string; playerId: string }> {
  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [user] = await db.insert(users).values({ name: "Test", email: `test-${tag}@example.invalid`, username: `test_${tag}` }).returning({ id: users.id });
  const [scenario] = await db.insert(scenarios).values({ slug: `test-${tag}`, title: "Test", period: "test", authorId: user!.id }).returning({ id: scenarios.id });
  await db.insert(scenarioVersions).values({ scenarioId: scenario!.id, version: 1, definition: {}, initialWorld: minimalWorld(), schemaVersion: 3, origin: "test" });
  const [game] = await db.insert(games).values({
    scenarioId: scenario!.id, title: "Test", status: "active", aiProfileVersion: 1, payerUserId: user!.id, creditRateCardVersion: 1,
    creditBudgetMicrocredits: 1_000_000n, scenarioVersion: 1, libraryVersion: 1, startingSeatCount: 1, createdBy: user!.id,
  }).returning({ id: games.id });
  const [player] = await db.insert(players).values({ gameId: game!.id, userId: user!.id, characterId: "someone" }).returning({ id: players.id });
  await db.insert(gameWorlds).values({ gameId: game!.id, world: minimalWorld(), schemaVersion: 3, revision: 1, stateHash: "seed", instantSortKey: 0 });
  return { gameId: game!.id, userId: user!.id, playerId: player!.id };
}

/** Every migration, as shipped. */
export const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

/** The migrations folder as it stood before `tag`: the journal cut short there. */
export function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(join(tmpdir(), "chronica-migrations-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((entry) => entry.tag === tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

/** A database of its own for one upgrade case, created on the test server and dropped after. */
export async function withFreshDatabase(run: (url: string) => Promise<void>): Promise<void> {
  const admin = createDatabase(TEST_DATABASE_URL!);
  const name = `chronica_test_upgrade_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.db.execute(sql.raw(`create database "${name}"`));
  const url = new URL(TEST_DATABASE_URL!);
  url.pathname = `/${name}`;
  try {
    assertDisposable(url.toString());
    await run(url.toString());
  } finally {
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`)).catch(() => undefined);
    await admin.close();
  }
}
