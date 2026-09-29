import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARMY_STANDARDS, defaultStandardForPolity, standardFor, standardsForPolity } from "./army-standards";

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

  it("gives each power of the scenario a banner of its own first", () => {
    expect(defaultStandardForPolity("rome").id).toBe("roman-wolf");
    expect(defaultStandardForPolity("syracuse").id).toBe("syracusan-horseman");
    expect(defaultStandardForPolity("mamertines").id).toBe("mamertine-eagle");
    expect(defaultStandardForPolity("rhegium-campanians").id).toBe("campanian-bull");
  });

  it("never lets one power carry another's own banner", () => {
    expect(standardsForPolity("carthage").some((standard) => standard.id === "roman-wolf-twins")).toBe(false);
    expect(standardFor("carthage", "roman-wolf-twins").id).toBe(defaultStandardForPolity("carthage").id);
  });

  it("draws the banner a force's record names", () => {
    expect(standardFor("rome", "roman-taras").id).toBe("roman-taras");
    expect(standardFor("rome", undefined).id).toBe("roman-wolf");
  });
});
