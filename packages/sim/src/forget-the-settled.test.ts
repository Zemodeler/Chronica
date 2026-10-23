import { describe, expect, it } from "vitest";
import type { WorldState } from "@chronica/shared";
import { forgetSettledPressures } from "./forget-the-settled";

const pressure = (id: string, status: "active" | "resolved" | "expired", at: number) => ({
  id, characterId: "c1", kind: "opportunity", intensity: 40, label: id, sourceEventId: null,
  createdAtStep: at, reviewAtStep: at, expiresAtStep: null, visibility: "private", status,
});

const worldWith = (pressures: ReturnType<typeof pressure>[], pointed: string[]): WorldState => ({
  characters: [{ id: "c1", mind: { currentPressures: pointed } }],
  characterPressures: pressures,
}) as unknown as WorldState;

describe("settled pressures are forgotten after two years", () => {
  it("lets go old resolved and expired ones, keeps active, recent and pointed-at ones", () => {
    const world = worldWith([
      pressure("old-resolved", "resolved", 10), pressure("old-expired", "expired", 20), pressure("old-active", "active", 10),
      pressure("recent-resolved", "resolved", 1_500), pressure("old-pointed", "resolved", 30),
    ], ["old-pointed"]);
    const after = forgetSettledPressures(world, 2_000);
    expect(after.characterPressures.map((entry) => entry.id)).toEqual(["old-active", "recent-resolved", "old-pointed"]);
  });

  it("returns the same world when nothing is old", () => {
    const world = worldWith([pressure("a", "active", 5)], []);
    expect(forgetSettledPressures(world, 3_000)).toBe(world);
  });
});
