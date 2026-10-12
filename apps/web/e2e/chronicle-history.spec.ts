import { expect, test } from "@playwright/test";
import { createDatabase, schema } from "@chronica/db";
import { and, eq, like } from "drizzle-orm";
import { enterTheWorld, waitForTheOffice } from "./fixture";
import { seededWorlds } from "./paths";

/**
 * The record past its first page, and an order sent twice, in a real browser
 * against the mock-mode server (no provider is reached).
 *
 * The record is seeded straight into Postgres: 230 entries, older than
 * anything the scenario writes, so the newest page of 200 cannot hold them
 * all and the oldest can only be reached by turning back.
 */

const DATABASE_URL = process.env.DATABASE_URL?.trim() || "postgres://chronica:chronica@localhost:5432/chronica";
const SEEDED = "Seeded history";
const COUNT = 230;
const UNREAD = 3;

async function seedHistory(gameId: string): Promise<void> {
  const { db, close } = createDatabase(DATABASE_URL);
  try {
    await db.delete(schema.chronicleCheckpoints).where(and(eq(schema.chronicleCheckpoints.gameId, gameId), like(schema.chronicleCheckpoints.title, `${SEEDED}%`)));
    const writtenAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(schema.chronicleCheckpoints).values(Array.from({ length: COUNT }, (_, index) => ({
      gameId,
      // Long before the scenario opens, and in runs that share a day and a
      // timestamp, so the page boundary falls inside a tie.
      fromInstantSortKey: -10_000_000 + Math.floor(index / 4) * 1440,
      toInstantSortKey: -10_000_000 + Math.floor(index / 4) * 1440,
      ordinal: index % 4,
      kind: "narrated",
      title: `${SEEDED} ${String(index).padStart(3, "0")}`,
      body: "An entry from long ago.",
      stopReason: "action_completed",
      createdAt: writtenAt,
      // The oldest few are unread: the badge must count them though they are not on the first page.
      readAt: index < UNREAD ? null : writtenAt,
    })));
  } finally {
    await close();
  }
}

async function clearHistory(gameId: string): Promise<void> {
  const { db, close } = createDatabase(DATABASE_URL);
  try {
    await db.delete(schema.chronicleCheckpoints).where(and(eq(schema.chronicleCheckpoints.gameId, gameId), like(schema.chronicleCheckpoints.title, `${SEEDED}%`)));
  } finally {
    await close();
  }
}

test.describe("a record longer than one page", () => {
  test.afterEach(async () => { await clearHistory(seededWorlds().carthaginian); });

  test("is turned back through to its first entry, each entry once, and counts unread entries not yet loaded", async ({ page }) => {
    const gameId = seededWorlds().carthaginian;
    await seedHistory(gameId);
    await enterTheWorld(page, "carthaginian");
    await waitForTheOffice(page);

    // The badge counts the whole record, not the page the browser was given.
    const badge = page.locator('[data-object="chronicle"] .office-object__badge');
    await expect(badge).toBeVisible({ timeout: 60_000 });
    expect(Number(await badge.innerText())).toBeGreaterThanOrEqual(UNREAD);

    await page.locator('[data-object="chronicle"]').click();
    const record = page.getByRole("dialog", { name: /chronicle/i });
    await expect(record).toBeVisible({ timeout: 60_000 });
    const oldest = record.locator("article", { hasText: `${SEEDED} 000` });
    await expect(oldest).toHaveCount(0);

    const turnBack = record.getByRole("button", { name: "Turn back further" });
    await expect(turnBack).toBeVisible();
    // Further back than one page if the scenario's own entries fill some of the first.
    for (let pages = 0; pages < 5 && (await oldest.count()) === 0; pages += 1) {
      await turnBack.click();
      await expect(record.getByRole("button", { name: "Turning back…" })).toHaveCount(0);
    }
    await expect(oldest).toHaveCount(1);
    // Every seeded entry is there exactly once, across the page boundary.
    await expect(record.locator("article", { hasText: SEEDED })).toHaveCount(COUNT);
    await expect(record.locator("article", { hasText: `${SEEDED} 117` })).toHaveCount(1);
    // At the first entry of the reign there is nothing further back.
    await expect(record.getByRole("button", { name: "Turn back further" })).toHaveCount(0);
  });
});

test.describe("the same order sent twice", () => {
  test("opens one turn, and both sends follow it", async ({ page }) => {
    const gameId = seededWorlds().citizen;
    await enterTheWorld(page, "citizen");
    const body = { orderText: "", wait: true, spanDays: 7, requestId: `e2e-duplicate-${Date.now()}` };
    const [first, second] = await Promise.all([
      page.request.post(`/api/games/${gameId}/simulate`, { data: body }),
      page.request.post(`/api/games/${gameId}/simulate`, { data: body }),
    ]);
    expect(first.status()).toBe(202);
    expect(second.status()).toBe(202);
    const [a, b] = [(await first.json()) as { burstId: string }, (await second.json()) as { burstId: string }];
    expect(a.burstId).toBe(b.burstId);

    // Let it settle, so the world is not left moving for the next spec.
    await expect.poll(async () => {
      const response = await page.request.get(`/api/games/${gameId}/bursts/${a.burstId}`);
      return ((await response.json()) as { status: string }).status;
    }, { timeout: 110_000, intervals: [1_000] }).not.toBe("running");

    const { db, close } = createDatabase(DATABASE_URL);
    try {
      expect(await db.select({ id: schema.simulationBursts.id }).from(schema.simulationBursts).where(and(eq(schema.simulationBursts.gameId, gameId), eq(schema.simulationBursts.idempotencyKey, body.requestId)))).toHaveLength(1);
      expect(await db.select().from(schema.turnJobs).where(eq(schema.turnJobs.burstId, a.burstId))).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
