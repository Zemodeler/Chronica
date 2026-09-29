import { describe, expect, it } from "vitest";
import type { CanvasRegion } from "./canvas-world";
import { regionMenu, resolvePlace } from "./place-resolver";

const regions: CanvasRegion[] = [
  { id: "it-4f9k2", name: "Roma", region: "Latium", aliases: ["Rome", "Ostia"] },
  { id: "it-8m2q1", name: "Neapolis", region: "Campania", aliases: ["Naples"] },
  { id: "gr-1a2b3", name: "Neapolis", region: "Macedonia", aliases: ["Kavala"] },
  { id: "sc-9z8y7", name: "Syrakousai", region: "Sicily", aliases: ["Syracuse"] },
  { id: "sc-7x6w5", name: "Syrakousai Hinterland", region: "Sicily", aliases: [] },
];

describe("resolving a place the model named in words", () => {
  it("finds a province by name, alias, or id", () => {
    expect(resolvePlace(regions, "Roma, Latium")).toEqual({ status: "found", provinceId: "it-4f9k2" });
    expect(resolvePlace(regions, "Rome")).toEqual({ status: "found", provinceId: "it-4f9k2" });
    expect(resolvePlace(regions, "syracuse (Sicily)")).toEqual({ status: "found", provinceId: "sc-9z8y7" });
    expect(resolvePlace(regions, "sc-7x6w5")).toEqual({ status: "found", provinceId: "sc-7x6w5" });
  });

  it("uses the region to choose between two places of one name", () => {
    expect(resolvePlace(regions, "Neapolis, Macedonia")).toEqual({ status: "found", provinceId: "gr-1a2b3" });
    expect(resolvePlace(regions, "Neapolis in Campania")).toEqual({ status: "found", provinceId: "it-8m2q1" });
  });

  it("never guesses between two matches, and says when there is none", () => {
    expect(resolvePlace(regions, "Neapolis").status).toBe("ambiguous");
    expect(resolvePlace(regions, "Atlantis")).toEqual({ status: "unknown" });
  });
});

describe("the region menu", () => {
  it("is bounded however many provinces there are", () => {
    const many: CanvasRegion[] = Array.from({ length: 4400 }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, region: `Region ${index % 150}`, aliases: [] }));
    expect(regionMenu(many).split("\n")).toHaveLength(60);
    expect(regionMenu(many).length).toBeLessThan(6_000);
  });
});
