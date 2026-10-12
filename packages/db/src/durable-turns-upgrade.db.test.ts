import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describe, expect, it } from "vitest";
import { createDatabase } from "./database";
import { listChroniclePage, reapStaleBursts } from "./queries/world";
import { chronicleCheckpoints, simulationBursts } from "./schema/simulation";
import { TEST_DATABASE_URL, assertDisposable, seedGame } from "./testing/test-database";

/**
 * 0043 against a database that already holds saves: migrated to 0042, given
 * a record and a burst the way the old code wrote them, then carried to 0043.
 * Nothing stored may change, and a burst with no job is reaped the old way.
 * Each case gets a database of its own, created and dropped here.
 */

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** The migrations folder as it stood before `tag`: the journal cut short there. */
function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(join(tmpdir(), "chronica-migrations-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((entry) => entry.tag === tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

async function withFreshDatabase(run: (url: string) => Promise<void>): Promise<void> {
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

describe.skipIf(TEST_DATABASE_URL === null)("0043 on a database with saves in it", () => {
  it("leaves the stored record as it was, pages it, and still reaps a burst that has no job", async () => {
    await withFreshDatabase(async (url) => {
      const { db, close } = createDatabase(url);
      const before = migrationsBefore("0043_durable_turns");
      try {
        await migrate(db, { migrationsFolder: before });
        const { gameId, userId } = await seedGame(db);
        const old = new Date(Date.now() - 3_600_000);
        const [burst] = await db.insert(simulationBursts).values({ gameId, playerUserId: userId, orderText: "an order from before", startedAt: old, heartbeatAt: old, progressAt: old }).returning({ id: simulationBursts.id });
        await db.insert(chronicleCheckpoints).values(Array.from({ length: 5 }, (_, ordinal) => ({ gameId, burstId: burst!.id, ordinal, fromInstantSortKey: 0, toInstantSortKey: 0, kind: "narrated", title: `Old ${ordinal}`, body: "…", stopReason: "action_completed" })));
        const stored = await db.select().from(chronicleCheckpoints).where(eq(chronicleCheckpoints.gameId, gameId));

        await migrate(db, { migrationsFolder: MIGRATIONS });

        expect(await db.select().from(chronicleCheckpoints).where(eq(chronicleCheckpoints.gameId, gameId))).toEqual(stored);
        expect((await listChroniclePage(db, gameId)).entries.map((entry) => entry.title)).toEqual(["Old 0", "Old 1", "Old 2", "Old 3", "Old 4"]);
        const liveness = { aliveAfter: new Date(Date.now() - 90_000), progressAfter: new Date(Date.now() - 480_000) };
        expect(await reapStaleBursts(db, gameId, liveness, "abandoned")).toBe(1);
        const indexes = await db.execute<{ indexname: string } & Record<string, unknown>>(sql`select indexname from pg_indexes where tablename = 'chronicle_checkpoints'`);
        expect([...indexes].map((row) => row.indexname)).toContain("chronicle_checkpoints_burst_ordinal_idx");
      } finally {
        rmSync(before, { recursive: true, force: true });
        await close();
      }
    });
  }, 180_000);

  it("migrates a record that already breaks the one-passage-per-ordinal rule without touching it", async () => {
    await withFreshDatabase(async (url) => {
      const { db, close } = createDatabase(url);
      const before = migrationsBefore("0043_durable_turns");
      try {
        await migrate(db, { migrationsFolder: before });
        const { gameId, userId } = await seedGame(db);
        const [burst] = await db.insert(simulationBursts).values({ gameId, playerUserId: userId, orderText: "x", status: "committed" }).returning({ id: simulationBursts.id });
        const twin = { gameId, burstId: burst!.id, ordinal: 0, fromInstantSortKey: 0, toInstantSortKey: 0, kind: "narrated", title: "Twin", body: "…", stopReason: "action_completed" };
        await db.insert(chronicleCheckpoints).values([twin, twin]);

        await migrate(db, { migrationsFolder: MIGRATIONS });

        expect(await db.select().from(chronicleCheckpoints).where(eq(chronicleCheckpoints.gameId, gameId))).toHaveLength(2);
        const indexes = await db.execute<{ indexname: string } & Record<string, unknown>>(sql`select indexname from pg_indexes where tablename = 'chronicle_checkpoints'`);
        expect([...indexes].map((row) => row.indexname)).not.toContain("chronicle_checkpoints_burst_ordinal_idx");
        expect([...indexes].map((row) => row.indexname)).toContain("chronicle_checkpoints_reading_idx");
      } finally {
        rmSync(before, { recursive: true, force: true });
        await close();
      }
    });
  }, 180_000);
});
