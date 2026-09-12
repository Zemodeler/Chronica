import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQueuedTurn: vi.fn(), getWorldView: vi.fn(), getOrdersForTurn: vi.fn(), resolveTurn: vi.fn(),
  releaseExpiredTurnClaims: vi.fn(), createDatabase: vi.fn(),
}));
vi.mock("@chronica/ai", () => ({ createAiAdapter: vi.fn(() => ({ call: vi.fn() })) }));
vi.mock("@chronica/db", () => ({
  createDatabase: mocks.createDatabase, getOrdersForTurn: mocks.getOrdersForTurn, getQueuedTurn: mocks.getQueuedTurn, getWorldView: mocks.getWorldView,
  releaseExpiredTurnClaims: mocks.releaseExpiredTurnClaims,
  schema: { players: { id: "id", characterId: "characterId", gameId: "gameId", status: "status" } },
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(() => "and"), eq: vi.fn(() => "eq") }));
vi.mock("./pipeline", () => ({ resolveTurn: mocks.resolveTurn }));
import { dispatchQueuedTurn, resolveQueuedTurn } from "./dispatch";

describe("resolveQueuedTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseExpiredTurnClaims.mockResolvedValue(0);
    mocks.getQueuedTurn.mockResolvedValue({ id: "turn-1", index: 1, elapsedStepStart: 0 });
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
});

describe("dispatchQueuedTurn -- resilience (unified action runtime, Stage 7)", () => {
  const fakeDb = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "player-1", characterId: "character-1" }]) })) })) })) };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
    mocks.createDatabase.mockReturnValue({ db: fakeDb, close: vi.fn() });
    mocks.releaseExpiredTurnClaims.mockResolvedValue(0);
    mocks.getQueuedTurn.mockResolvedValue({ id: "turn-1", index: 1, elapsedStepStart: 0 });
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
