import { describe, expect, it } from "vitest";
import { buildCurrentDispatch, type DispatchEntryInput } from "./dispatch";

const entry = (overrides: Partial<DispatchEntryInput> = {}): DispatchEntryInput => ({
  title: "An event",
  body: "Something happened.",
  playerRelevance: "none",
  knowledgeStatus: "confirmed",
  ...overrides,
});

describe("buildCurrentDispatch", () => {
  it("falls back to a quiet-turn headline with no entries and no authority changes", () => {
    const dispatch = buildCurrentDispatch({ entriesThisTurn: [], authorityChangesForPlayer: [] });
    expect(dispatch.headline).toBe("A quiet turn passes.");
    expect(dispatch.items).toEqual([]);
    expect(dispatch.uncertaintyNote).toBeNull();
  });

  it("prioritises the highest player-relevance entry as the headline", () => {
    const dispatch = buildCurrentDispatch({
      entriesThisTurn: [entry({ title: "Low", playerRelevance: "low" }), entry({ title: "High", playerRelevance: "high" })],
      authorityChangesForPlayer: [],
    });
    expect(dispatch.headline).toBe("High");
    expect(dispatch.items).toContain("Low");
  });

  it("surfaces authority changes ahead of ordinary entries", () => {
    const dispatch = buildCurrentDispatch({
      entriesThisTurn: [entry({ title: "Ordinary", playerRelevance: "medium" })],
      authorityChangesForPlayer: ["Now: Consul of Rome"],
    });
    expect(dispatch.items[0]).toBe("Now: Consul of Rome");
  });

  it("notes uncertainty when any surfaced entry is not confirmed", () => {
    const dispatch = buildCurrentDispatch({
      entriesThisTurn: [entry({ knowledgeStatus: "rumour", playerRelevance: "medium" })],
      authorityChangesForPlayer: [],
    });
    expect(dispatch.uncertaintyNote).not.toBeNull();
  });

  it("never exceeds maxLength", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ title: `Event number ${i} with a fairly long title`, playerRelevance: "high" }));
    const dispatch = buildCurrentDispatch({ entriesThisTurn: many, authorityChangesForPlayer: [], maxLength: 100 });
    const totalLength = dispatch.headline.length + dispatch.items.reduce((sum, item) => sum + item.length, 0);
    expect(totalLength).toBeLessThanOrEqual(100 + dispatch.items.length * 2);
  });
});
