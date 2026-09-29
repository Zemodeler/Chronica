import { describe, expect, it } from "vitest";
import { DEFAULT_WEALTH_BANDS, bandFor, clampWealth, describeWealthBands, type ScenarioWealthRules } from "./wealth";

describe("what a person of this standing is worth", () => {
  it("does not let a common soldier be handed a senator's fortune", () => {
    // The declaration prompt asks for the standing and the money in the same
    // breath and believed whatever came back.
    expect(clampWealth(40_000, "Common soldier of the legions")).toBeLessThanOrEqual(60);
  });

  it("does not leave a merchant invented to lend money with nothing to lend", () => {
    // Which is the bug that put `wealth` on `character_create` at all, solved
    // in one direction and left open in the other.
    expect(clampWealth(4, "A merchant of Ostia")).toBeGreaterThanOrEqual(200);
  });

  it("keeps the model's judgment inside the band, because a rich merchant and a poor one are both merchants", () => {
    expect(clampWealth(400, "merchant")).toBe(400);
    expect(clampWealth(2_400, "merchant")).toBe(2_400);
  });

  it("reads a phrase by its richest word, not its first", () => {
    // "An equestrian of senatorial family" is a senator's household; taking
    // the first match would make him a merchant.
    expect(bandFor("An equestrian of senatorial family")?.id).toBe("great");
  });

  it("clamps, never rejects -- an unknown standing keeps what it was given", () => {
    expect(clampWealth(777, "Keeper of the Sacred Geese")).toBe(777);
    expect(clampWealth(-5, "Keeper of the Sacred Geese")).toBe(0);
  });

  it("lets a scenario author its own economy and overrule the defaults entirely", () => {
    const rules: ScenarioWealthRules = {
      bands: [{ id: "all", label: "everyone", words: ["anyone"], min: 7, max: 9 }],
      defaultBandId: "all",
    };
    expect(clampWealth(10_000, "Senatorial aristocracy", rules)).toBe(9);
    expect(clampWealth(0, "anything at all", rules)).toBe(7);
  });

  it("describes itself for the prompt it is bounding", () => {
    const lines = describeWealthBands();
    expect(lines).toHaveLength(DEFAULT_WEALTH_BANDS.length);
    expect(lines.join(" ")).toContain("merchant");
  });
});
