import { describe, expect, it } from "vitest";
import { factsOfRefusedActs } from "./facts-of-refused-acts";

describe("a fact the model wrote for an act the engine refused", () => {
  const war = { acts: [0], factLocalIds: ["declared"] };
  const siege = { acts: [1], factLocalIds: ["besieged", "shared"] };
  const news = { acts: [], factLocalIds: ["shared", "weather"] };

  it("goes with the act when every act of its part was refused", () => {
    expect([...factsOfRefusedActs([war, siege], new Set([0]))]).toEqual(["declared"]);
  });

  it("stays when the part carried out any act", () => {
    expect(factsOfRefusedActs([{ acts: [0, 1], factLocalIds: ["declared"] }], new Set([0])).size).toBe(0);
  });

  it("stays when another part cites it, or its part had no act to refuse", () => {
    expect([...factsOfRefusedActs([war, siege, news], new Set([0, 1]))].sort()).toEqual(["besieged", "declared"]);
  });
});
