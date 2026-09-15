import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQueuedTurn: vi.fn(), getWorldView: vi.fn(), getOrdersForTurn: vi.fn(), resolveTurn: vi.fn(),
  releaseExpiredTurnClaims: vi.fn(), createDatabase: vi.fn(), getGameIdsNeedingResolution: vi.fn(),
  claimTurnForResolution: vi.fn(), failTurn: vi.fn(),
}));
vi.mock("@chronica/ai", () => ({ createAiAdapter: vi.fn(() => ({ call: vi.fn() })) }));
vi.mock("@chronica/db", () => ({
  createDatabase: mocks.createDatabase, getOrdersForTurn: mocks.getOrdersForTurn, getQueuedTurn: mocks.getQueuedTurn, getWorldView: mocks.getWorldView,
  releaseExpiredTurnClaims: mocks.releaseExpiredTurnClaims, getGameIdsNeedingResolution: mocks.getGameIdsNeedingResolution,
  claimTurnForResolution: mocks.claimTurnForResolution, failTurn: mocks.failTurn,
  schema: { players: { id: "id", characterId: "characterId", gameId: "gameId", status: "status" } },
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(() => "and"), eq: vi.fn(() => "eq") }));
vi.mock("./pipeline", () => ({ resolveTurn: mocks.resolveTurn }));
import { dispatchQueuedTurn, resolveQueuedTurn, runWorkerTick, TerminalResolutionError } from "./dispatch";

describe("resolveQueuedTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseExpiredTurnClaims.mockResolvedValue(0);
    mocks.getQueuedTurn.mockResolvedValue({ id: "turn-1", index: 1, elapsedStepStart: 0 });
    mocks.claimTurnForResolution.mockResolvedValue(true);
    mocks.getWorldView.mockResolvedValue({ world: { characters: [{ id: "character-1" }] } });
    mocks.getOrdersForTurn.mockResolvedValue([{ playerId: "player-1", directives: { directives: [{ kind: "new", text: "Secure the harbour." }] } }]);
    mocks.resolveTurn.mockResolvedValue({ workflowDownloads: [] });
  });
  it("dispatches a queued turn without an SSE caller", async () => {
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "player-1", characterId: "character-1" }]) })) })) })) };
    await resolveQueuedTurn(db as never, "game-1");
    expect(mocks.resolveTurn).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ gameId: "game-1", turnId: "turn-1", playerId: "player-1" }), expect.any(Function));
  });

  it("reclaims a lease abandoned by a crashed process before looking for a queued turn", async () => {
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "player-1", characterId: "character-1" }]) })) })) })) };
    await resolveQueuedTurn(db as never, "game-1");
    expect(mocks.releaseExpiredTurnClaims).toHaveBeenCalledWith(db, "game-1");
  });

  it("claims the turn before validating preconditions, so a bad batch never runs unclaimed", async () => {
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "player-1", characterId: "character-1" }]) })) })) })) };
    await resolveQueuedTurn(db as never, "game-1");
    expect(mocks.claimTurnForResolution).toHaveBeenCalledWith(db, "turn-1");
  });

  it("does nothing when another worker already holds the claim", async () => {
    mocks.claimTurnForResolution.mockResolvedValue(false);
    const db = { select: vi.fn() };
    const result = await resolveQueuedTurn(db as never, "game-1");
    expect(result).toBeUndefined();
    expect(mocks.getWorldView).not.toHaveBeenCalled();
    expect(mocks.resolveTurn).not.toHaveBeenCalled();
  });

  it("AI-HANDSHAKE issue-02: records a missing game as a terminal, durable failure instead of throwing unclaimed", async () => {
    mocks.getWorldView.mockResolvedValue(undefined);
    const db = { select: vi.fn() };
    await expect(resolveQueuedTurn(db as never, "game-1")).rejects.toThrow(TerminalResolutionError);
    expect(mocks.failTurn).toHaveBeenCalledWith(db, "turn-1", expect.stringContaining("Game not found"), { terminal: true });
    expect(mocks.resolveTurn).not.toHaveBeenCalled();
  });

  it("AI-HANDSHAKE issue-02: records an invalid order batch as a terminal, durable failure", async () => {
    mocks.getOrdersForTurn.mockResolvedValue([{ playerId: "player-1", directives: { not: "a valid batch" } }]);
    const db = { select: vi.fn() };
    await expect(resolveQueuedTurn(db as never, "game-1")).rejects.toThrow(TerminalResolutionError);
    expect(mocks.failTurn).toHaveBeenCalledWith(db, "turn-1", expect.stringContaining("invalid order batch"), { terminal: true });
  });

  it("classifies a failure inside resolveTurn itself as retryable, not terminal", async () => {
    mocks.resolveTurn.mockRejectedValue(new Error("provider timeout"));
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "player-1", characterId: "character-1" }]) })) })) })) };
    await expect(resolveQueuedTurn(db as never, "game-1")).rejects.toThrow("provider timeout");
    expect(mocks.failTurn).toHaveBeenCalledWith(db, "turn-1", expect.stringContaining("provider timeout"), { terminal: false });
  });
});

describe("dispatchQueuedTurn -- resilience (unified action runtime, Stage 7)", () => {
  const fakeDb = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "player-1", characterId: "character-1" }]) })) })) })) };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
    mocks.createDatabase.mockReturnValue({ db: fakeDb, close: vi.fn() });
    mocks.releaseExpiredTurnClaims.mockResolvedValue(0);
    mocks.getQueuedTurn.mockResolvedValue({ id: "turn-1", index: 1, elapsedStepStart: 0 });
    mocks.claimTurnForResolution.mockResolvedValue(true);
    mocks.getWorldView.mockResolvedValue({ world: { characters: [{ id: "character-1" }] } });
    mocks.getOrdersForTurn.mockResolvedValue([{ playerId: "player-1", directives: { directives: [{ kind: "new", text: "Secure the harbour." }] } }]);
  });

  it("retries in place when an attempt fails but failTurn left the turn queued for another try", async () => {
    vi.useFakeTimers();
    try {
      mocks.resolveTurn.mockRejectedValueOnce(new Error("provider error")).mockResolvedValueOnce({ workflowDownloads: [] });
      const promise = dispatchQueuedTurn("game-1");
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toEqual({ workflowDownloads: [] });
      expect(mocks.resolveTurn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up once the turn is no longer queued, instead of retrying forever", async () => {
    mocks.resolveTurn.mockRejectedValue(new Error("provider error"));
    mocks.getQueuedTurn
      .mockResolvedValueOnce({ id: "turn-1", index: 1, elapsedStepStart: 0 })
      .mockResolvedValueOnce(undefined);
    await expect(dispatchQueuedTurn("game-1")).rejects.toThrow("provider error");
    expect(mocks.resolveTurn).toHaveBeenCalledTimes(1);
  });
});

describe("runWorkerTick -- durable worker poll pass (unified action runtime, durable dispatch)", () => {
  const fakeDb = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "player-1", characterId: "character-1" }]) })) })) })) };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
    mocks.createDatabase.mockReturnValue({ db: fakeDb, close: vi.fn() });
    mocks.releaseExpiredTurnClaims.mockResolvedValue(0);
    mocks.getQueuedTurn.mockResolvedValue({ id: "turn-1", index: 1, elapsedStepStart: 0 });
    mocks.claimTurnForResolution.mockResolvedValue(true);
    mocks.getWorldView.mockResolvedValue({ world: { characters: [{ id: "character-1" }] } });
    mocks.getOrdersForTurn.mockResolvedValue([{ playerId: "player-1", directives: { directives: [{ kind: "new", text: "Secure the harbour." }] } }]);
  });

  it("does nothing when no game has resolution work outstanding", async () => {
    mocks.getGameIdsNeedingResolution.mockResolvedValue([]);
    const result = await runWorkerTick();
    expect(result).toEqual({ processedGameIds: [], errors: [] });
    expect(mocks.resolveTurn).not.toHaveBeenCalled();
  });

  it("dispatches every game with outstanding work and isolates one game's failure from the rest", async () => {
    vi.useFakeTimers();
    try {
      mocks.getGameIdsNeedingResolution.mockResolvedValue(["game-1", "game-2", "game-3"]);
      mocks.resolveTurn.mockImplementation((_db: unknown, _adapter: unknown, input: { gameId: string }) => {
        if (input.gameId === "game-2") throw new Error("provider error");
        return { workflowDownloads: [] };
      });

      const resultPromise = runWorkerTick();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.processedGameIds).toEqual(["game-1", "game-3"]);
      expect(result.errors).toEqual([{ gameId: "game-2", message: "provider error" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
