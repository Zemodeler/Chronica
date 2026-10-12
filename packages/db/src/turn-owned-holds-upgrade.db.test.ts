import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describe, expect, it } from "vitest";
import { createDatabase } from "./database";
import { expireStaleHolds } from "./queries/billing";
import { MIGRATIONS, TEST_DATABASE_URL, migrationsBefore, seedGame, withFreshDatabase } from "./testing/test-database";

/**
 * 0044 against a database whose holds were written before holds had owners:
 * migrated to 0043, given an active hold the way the old code wrote it, then
 * carried to 0044. The hold keeps no owner and is still expired by its age.
 * Then the rollback the migration documents, and the upgrade again: the old
 * code's writes work on the rolled-back table, and 0044 applies twice.
 */

const columnsOf = async (db: ReturnType<typeof createDatabase>["db"]) => [...await db.execute<{ column_name: string } & Record<string, unknown>>(sql`select column_name from information_schema.columns where table_name = 'credit_holds'`)].map((row) => row.column_name);

/** A hold as the code before 0044 wrote it: by its own columns only. */
async function oldStyleHold(db: ReturnType<typeof createDatabase>["db"], gameId: string, userId: string, minutesAgo: number): Promise<string> {
  const [wallet] = [...await db.execute<{ id: string } & Record<string, unknown>>(sql`
    insert into credit_wallets (user_id, available_microcredits, held_microcredits) values (${userId}, 0, 500)
    on conflict (user_id) do update set held_microcredits = credit_wallets.held_microcredits + 500 returning id`)];
  const [hold] = [...await db.execute<{ id: string } & Record<string, unknown>>(sql`
    insert into credit_holds (wallet_id, game_id, work_id, maximum_microcredits, lot_allocation, status, idempotency_key, created_at)
    values (${wallet!.id}, ${gameId}, ${`old-${minutesAgo}`}, 500, '[]'::jsonb, 'active', ${`old:${gameId}:${minutesAgo}`}, now() - ${`${minutesAgo} minutes`}::interval)
    returning id`)];
  return hold!.id;
}

describe.skipIf(TEST_DATABASE_URL === null)("0044 on a database with holds in it", () => {
  it("keeps old holds ownerless and expires them by age; rolls back and re-applies cleanly", async () => {
    await withFreshDatabase(async (url) => {
      const { db, close } = createDatabase(url);
      const before = migrationsBefore("0044_turn_owned_holds");
      try {
        await migrate(db, { migrationsFolder: before });
        expect(await columnsOf(db)).not.toContain("turn_burst_id");
        const { gameId, userId } = await seedGame(db);
        const stale = await oldStyleHold(db, gameId, userId, 60);
        const young = await oldStyleHold(db, gameId, userId, 1);

        await migrate(db, { migrationsFolder: MIGRATIONS });

        const owners = [...await db.execute<{ id: string; turn_burst_id: string | null; turn_attempt: number | null } & Record<string, unknown>>(sql`select id, turn_burst_id, turn_attempt from credit_holds`)];
        expect(owners).toHaveLength(2);
        expect(owners.every((row) => row.turn_burst_id === null && row.turn_attempt === null)).toBe(true);
        expect(await expireStaleHolds(db, new Date(Date.now() - 6 * 60_000))).toBe(1);
        const statuses = Object.fromEntries([...await db.execute<{ id: string; status: string } & Record<string, unknown>>(sql`select id, status from credit_holds`)].map((row) => [row.id, row.status]));
        expect(statuses[stale]).toBe("expired");
        expect(statuses[young]).toBe("active");

        // The rollback written in the migration's header, then the old code's write again.
        const migration = readFileSync(join(MIGRATIONS, "0044_turn_owned_holds.sql"), "utf8");
        const rollback = migration.split("\n").filter((line) => /^--\s{3}(ALTER|DROP)/.test(line)).map((line) => line.replace(/^--\s+/, ""));
        expect(rollback).toHaveLength(3);
        for (const statement of rollback) await db.execute(sql.raw(statement));
        expect(await columnsOf(db)).not.toContain("turn_burst_id");
        expect(await columnsOf(db)).not.toContain("turn_attempt");
        await oldStyleHold(db, gameId, userId, 2);

        // And forward again: the migration is safe to run over a table it already changed.
        for (const statement of migration.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
        for (const statement of migration.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
        expect(await columnsOf(db)).toEqual(expect.arrayContaining(["turn_burst_id", "turn_attempt"]));
      } finally {
        rmSync(before, { recursive: true, force: true });
        await close();
      }
    });
  }, 180_000);
});
