import { describe, expect, it } from "vitest";
import { savesByLastPlayed } from "./saves-by-last-played";

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe("the save the home page goes back to", () => {
  it("is the one played last, not the one made last", () => {
    const older = { id: "older", createdAt: day(1), lastPlayedAt: day(9) };
    const newer = { id: "newer", createdAt: day(5), lastPlayedAt: day(6) };
    expect(savesByLastPlayed([newer, older]).map((save) => save.id)).toEqual(["older", "newer"]);
  });

  it("counts a save never played from the day it was made", () => {
    const played = { id: "played", createdAt: day(1), lastPlayedAt: day(3) };
    const fresh = { id: "fresh", createdAt: day(4), lastPlayedAt: null };
    expect(savesByLastPlayed([played, fresh]).map((save) => save.id)).toEqual(["fresh", "played"]);
  });

  it("keeps the order it was given when nothing separates two", () => {
    const a = { id: "a", createdAt: day(2) };
    const b = { id: "b", createdAt: day(2) };
    expect(savesByLastPlayed([a, b]).map((save) => save.id)).toEqual(["a", "b"]);
  });
});
