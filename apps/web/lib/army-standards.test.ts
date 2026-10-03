import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARMY_STANDARDS, defaultStandardFor, standardFor, standardsForPolity } from "./army-standards";

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("army standards", () => {
  it("draws every banner at the shape it was painted", () => {
    // The banners were repainted at 3:2 and the catalogue still said 4:3, so
    // every one of them was drawn squashed.
    for (const standard of ARMY_STANDARDS) {
      const { width, height } = pngSize(join(__dirname, "..", "public", standard.url));
      expect(Math.abs(width / height - standard.aspectRatio), standard.id).toBeLessThan(.02);
    }
  });

  it("has no two banners with the same id", () => {
    expect(new Set(ARMY_STANDARDS.map((standard) => standard.id)).size).toBe(ARMY_STANDARDS.length);
  });

  it("keeps army and navy lists disjoint, including the generic banners", () => {
    for (const polityId of ["rome", "carthage", "syracuse", "mamertines", "rhegium-campanians", "gauls"]) {
      const armies = standardsForPolity(polityId, "army");
      const navies = standardsForPolity(polityId, "navy");
      expect(armies.every((standard) => standard.kind === "army" && !standard.id.startsWith("navy-"))).toBe(true);
      expect(navies.every((standard) => standard.kind === "navy" && standard.id.startsWith("navy-"))).toBe(true);
      expect(armies.some((standard) => navies.some((navy) => navy.id === standard.id))).toBe(false);
    }
  });

  it("has a painted navy banner for every power with a fleet", () => {
    for (const polityId of ["rome", "carthage", "syracuse"]) {
      const navy = standardsForPolity(polityId, "navy");
      expect(navy.some((standard) => standard.factions.includes(polityId as "rome" | "carthage" | "syracuse"))).toBe(true);
      for (const standard of navy) {
        const { width, height } = pngSize(join(__dirname, "..", "public", standard.url));
        expect(Math.abs(width / height - 3 / 2), standard.id).toBeLessThan(.02);
      }
    }
  });

  it("gives each power of the scenario a banner of its own first", () => {
    expect(defaultStandardFor("rome", "army").id).toBe("roman-wolf");
    expect(defaultStandardFor("syracuse", "army").id).toBe("syracusan-horseman");
    expect(defaultStandardFor("mamertines", "army").id).toBe("mamertine-eagle");
    expect(defaultStandardFor("rhegium-campanians", "army").id).toBe("campanian-bull");
    expect(defaultStandardFor("rome", "navy").id).toBe("navy-roman-corvus");
    expect(defaultStandardFor("gauls", "navy").id).toBe("navy-athenian-trireme");
  });

  it("never lets one power carry another's own banner", () => {
    expect(standardsForPolity("carthage", "army").some((standard) => standard.id === "roman-wolf-twins")).toBe(false);
    expect(standardFor("carthage", "army", "roman-wolf-twins").id).toBe(defaultStandardFor("carthage", "army").id);
  });

  it("draws the banner a force's record names", () => {
    expect(standardFor("rome", "army", "roman-taras").id).toBe("roman-taras");
    expect(standardFor("rome", "army", undefined).id).toBe("roman-wolf");
    expect(standardFor("rome", "navy", "roman-taras").id).toBe("navy-roman-corvus");
    expect(standardFor("carthage", "navy", "navy-roman-corvus").id).toBe("navy-punic-warship");
  });
});
