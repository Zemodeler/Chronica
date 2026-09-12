import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Fact } from "@chronica/shared";
import { NO_INTERVENTION_SIGNALS } from "@chronica/shared";
import { eq } from "drizzle-orm";
import { createDatabase, type ChronicaDatabase } from "../database";
import { games, scenarios, turns } from "../schema/game";
import { users } from "../schema/auth";
import { insertWorldFacts } from "./events";
import { getChronicleForLatestTurn } from "./turns";

// Live-Postgres, mirroring resolution.test.ts's own pattern: this reads real
// join/aggregate behavior across turns/chronicle/world_facts that no
// in-memory fake reproduces faithfully. Skips itself when unreachable.

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://chronica:chronica@localhost:5432/chronica";

describe.skipIf(process.env.SKIP_DB_TESTS === "true")("getChronicleForLatestTurn -- decision/stopping-fact surfacing (unified action runtime, Stage 7; live Postgres)", () => {
  let handle: ReturnType<typeof createDatabase> | null = null;
  let db: ChronicaDatabase;
  let reachable = true;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL);
    db = handle.db;
    try {
      await db.execute("select 1");
    } catch {
      reachable = false;
    }
  });

  afterAll(async () => {
    await handle?.close();
  });

  async function seedGame(): Promise<string> {
    const [user] = await db.insert(users).values({ name: "Test User", email: `test-${randomUUID()}@example.test` }).returning({ id: users.id });
    const [scenario] = await db.insert(scenarios).values({ slug: `test-scenario-${randomUUID()}`, title: "Test Scenario", period: "test" }).returning({ id: scenarios.id });
    const [game] = await db.insert(games).values({
      scenarioId: scenario!.id, title: "Test Game", aiProfileVersion: 1, payerUserId: user!.id,
      creditRateCardVersion: 1, creditBudgetMicrocredits: 0n, scenarioVersion: 1, libraryVersion: 1,
      startingSeatCount: 1, createdBy: user!.id,
    }).returning({ id: games.id });
    return game!.id;
  }

  async function deleteGame(gameId: string): Promise<void> {
    await db.delete(games).where(eq(games.id, gameId));
  }

  function fact(id: string, summary: string): Fact {
    return {
      id, time: { day: 1, minute: 0 }, atStep: 1, kind: "test_event", summary,
      affectedEntities: [], resourceChanges: [], authorityChange: undefined, visibility: "public",
      discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
      eligibleReactionScopes: [], interventionSignals: NO_INTERVENTION_SIGNALS, sourceEventId: null, sourceActionId: null, causalDepth: 0,
    };
  }

  it("resolves stoppingFactIds to their real summaries and carries the requested decision through", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const factA = fact(`fact-a-${randomUUID()}`, "Hieron II proposes a truce.");
      const factB = fact(`fact-b-${randomUUID()}`, "The Roman fleet blocks the harbour.");
      await insertWorldFacts(db, gameId, null, [factA, factB]);
      const [turn] = await db.insert(turns).values({
        gameId, index: 0, status: "news", seed: `${gameId}:0`, openedAt: new Date(), elapsedStepStart: 0, elapsedStepEnd: 1,
        stoppingFactIds: [factA.id, factB.id],
        requestedPlayerDecision: "Accept Hieron II's truce, or press the siege?",
      }).returning({ id: turns.id });

      const chronicle = await getChronicleForLatestTurn(db, gameId);
      expect(chronicle?.turnId).toBe(turn!.id);
      expect(chronicle?.requestedPlayerDecision).toBe("Accept Hieron II's truce, or press the siege?");
      expect(chronicle?.stoppingFacts).toEqual(expect.arrayContaining([
        { id: factA.id, summary: factA.summary },
        { id: factB.id, summary: factB.summary },
      ]));
      expect(chronicle?.stoppingFacts).toHaveLength(2);
    } finally {
      await deleteGame(gameId);
    }
  });

  it("omits both fields when the turn stopped for its own reasons, not a requested decision", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      await db.insert(turns).values({
        gameId, index: 0, status: "news", seed: `${gameId}:0`, openedAt: new Date(), elapsedStepStart: 0, elapsedStepEnd: 1,
      });
      const chronicle = await getChronicleForLatestTurn(db, gameId);
      expect(chronicle?.requestedPlayerDecision).toBeUndefined();
      expect(chronicle?.stoppingFacts).toBeUndefined();
    } finally {
      await deleteGame(gameId);
    }
  });
});
