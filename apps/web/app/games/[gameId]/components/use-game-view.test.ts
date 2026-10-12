import { describe, expect, it } from "vitest";
import { coinDifference, mergeByOrder, mergeNewestPage, purseIsSpent, unreadInView, type ChronicleEntry } from "./use-game-view";

describe("what the last order cost", () => {
  it("subtracts in millionths, so 0.3 is never 0.29999", () => {
    expect(coinDifference("1.3", "1")).toBe("0.3");
    expect(coinDifference("2.000314", "1.9")).toBe("0.1");
    expect(coinDifference("0.4567", "0.1")).toBe("0.357");
  });

  it("gives whole coins without a fraction, and never a negative cost", () => {
    expect(coinDifference("3", "1")).toBe("2");
    expect(coinDifference("1", "1")).toBe("0");
    expect(coinDifference("0.5", "1")).toBe("0");
  });
});

describe("a spent purse", () => {
  it("is an empty wallet or a save at its cap", () => {
    expect(purseIsSpent({ available: "0", spent: "1", cap: "5" })).toBe(true);
    expect(purseIsSpent({ available: "3", spent: "5", cap: "5" })).toBe(true);
    expect(purseIsSpent({ available: "3", spent: "5.2", cap: "5" })).toBe(true);
  });

  it("is not a purse with coins and room under the cap, nor one not yet read", () => {
    expect(purseIsSpent({ available: "3", spent: "1.2", cap: "5" })).toBe(false);
    expect(purseIsSpent({ available: "3", spent: null, cap: null })).toBe(false);
    expect(purseIsSpent(undefined)).toBe(false);
  });
});

describe("pages of the record merged in reading order", () => {
  const entry = (id: string, orderKey: string, extra: Partial<ChronicleEntry> = {}): ChronicleEntry => ({
    id, orderKey, burstId: null, kind: "narrated", date: null, title: id, body: "", subjects: [], tags: [], changes: [], quote: null, unread: false, published: true, ...extra,
  });

  it("puts an older page before the one in hand and shows each entry once", () => {
    const inHand = [entry("c", "3"), entry("d", "4")];
    const older = [entry("a", "1"), entry("b", "2"), entry("c", "3")];
    expect(mergeByOrder(older, inHand).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps what the reader turned back to when a commit brings a new newest page", () => {
    // The reader had turned back to "a"; the record then grew by "e", which pushed "b" off the newest page.
    const had = [entry("a", "1"), entry("b", "2"), entry("c", "3"), entry("d", "4")];
    const merged = mergeNewestPage(had, null, [entry("c", "3"), entry("d", "4"), entry("e", "5")], "key-of-c");
    expect(merged.chronicle.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
    // Nothing is older than "a": the reader had reached the start, and still has.
    expect(merged.chronicleOlder).toBeNull();
  });

  it("takes the newest page's read marks over the copy in hand", () => {
    const merged = mergeNewestPage([entry("a", "1", { unread: true })], "key-of-a", [entry("a", "1", { unread: false })], "key-of-a");
    expect(merged.chronicle[0]!.unread).toBe(false);
  });

  it("drops passages still being written: the commit is what replaces them", () => {
    const merged = mergeNewestPage([entry("p", "", { published: false })], null, [entry("a", "1")], null);
    expect(merged.chronicle.map((e) => e.id)).toEqual(["a"]);
  });

  it("counts unread across the whole record once the server has said", () => {
    expect(unreadInView({ chronicle: [entry("a", "1", { unread: true })], unreadTotal: 250 })).toBe(250);
    expect(unreadInView({ chronicle: [entry("a", "1", { unread: true })] })).toBe(1);
  });
});
