import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQueuedTurn: vi.fn(), getWorldView: vi.fn(), getOrdersForTurn: vi.fn(), resolveTurn: vi.fn(),
}));
vi.mock("@chronica/ai", () => ({ createAiAdapter: vi.fn(() => ({ call: vi.fn() })) }));
vi.mock("@chronica/db", () => ({
  createDatabase: vi.fn(), getOrdersForTurn: mocks.getOrdersForTurn, getQueuedTurn: mocks.getQueuedTurn, getWorldView: mocks.getWorldView,
  schema: { players: { id: "id", characterId: "characterId", gameId: "gameId", status: "status" } },
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(() => "and"), eq: vi.fn(() => "eq") }));
vi.mock("./pipeline", () => ({ resolveTurn: mocks.resolveTurn }));
import { resolveQueuedTurn } from "./dispatch";

describe("resolveQueuedTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
