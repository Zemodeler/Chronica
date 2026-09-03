import { describe, expect, it } from "vitest";
import { buildCurrentDispatch, type DispatchEntryInput } from "./dispatch";

const entry = (overrides: Partial<DispatchEntryInput> = {}): DispatchEntryInput => ({
  title: "An event",
  body: "Something happened.",
  playerRelevance: "none",
  knowledgeStatus: "confirmed",
  consequences: [],
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
      entriesThisTurn: [
        entry({ title: "Low", playerRelevance: "low", consequences: ["Low consequence"] }),
        entry({ title: "High", playerRelevance: "high" }),
      ],
      authorityChangesForPlayer: [],
    });
    expect(dispatch.headline).toBe("High");
    expect(dispatch.items).toContain("Low consequence");
  });

  it("surfaces authority changes ahead of ordinary entries", () => {
    const dispatch = buildCurrentDispatch({
      entriesThisTurn: [entry({ title: "Ordinary", playerRelevance: "medium", consequences: ["Ordinary consequence"] })],
      authorityChangesForPlayer: ["Now: Consul of Rome"],
    });
    expect(dispatch.items[0]).toBe("Now: Consul of Rome");
  });

  it("does not surface entry titles as items, only authority changes and direct consequences", () => {
    const dispatch = buildCurrentDispatch({
      entriesThisTurn: [entry({ title: "A truncated and garbled slice of prose", playerRelevance: "high", consequences: ["Messana captured"] })],
      authorityChangesForPlayer: [],
    });
    expect(dispatch.items).toEqual(["Messana captured"]);
  });

  it("notes uncertainty when any surfaced entry is not confirmed", () => {
    const dispatch = buildCurrentDispatch({
      entriesThisTurn: [entry({ knowledgeStatus: "rumour", playerRelevance: "medium" })],
      authorityChangesForPlayer: [],
    });
    expect(dispatch.uncertaintyNote).not.toBeNull();
  });

  it("never exceeds maxLength", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ playerRelevance: "high", consequences: [`Event number ${i} with a fairly long consequence label`] }));
    const dispatch = buildCurrentDispatch({ entriesThisTurn: many, authorityChangesForPlayer: [], maxLength: 100 });
    const totalLength = dispatch.headline.length + dispatch.items.reduce((sum, item) => sum + item.length, 0);
    expect(totalLength).toBeLessThanOrEqual(100 + dispatch.items.length * 2);
  });
});
