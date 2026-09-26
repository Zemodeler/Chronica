import { describe, expect, it } from "vitest";
import { toneAtlas } from "./atlas-tone";

const pixel = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

describe("toning the relief", () => {
  it("turns blue sea into flat ink-teal", () => {
    const deep = pixel(40, 90, 160);
    const shallow = pixel(120, 175, 205);
    toneAtlas(deep);
    toneAtlas(shallow);
    expect([...deep.slice(0, 3)]).toEqual([16, 40, 46]);
    expect([...shallow.slice(0, 3)]).toEqual([16, 40, 46]);
  });

  it("keeps land's light and shade but not its green", () => {
    const lowland = pixel(150, 170, 120);
    const mountain = pixel(90, 95, 80);
    toneAtlas(lowland);
    toneAtlas(mountain);
    // Sepia: red above green above blue, whatever the land was.
    for (const land of [lowland, mountain]) {
      expect(land[0]!).toBeGreaterThan(land[1]!);
      expect(land[1]!).toBeGreaterThan(land[2]!);
    }
    expect(lowland[0]!).toBeGreaterThan(mountain[0]!);
  });

  it("leaves transparent pixels alone", () => {
    const clear = pixel(40, 90, 160, 0);
    toneAtlas(clear);
    expect([...clear]).toEqual([40, 90, 160, 0]);
  });
});
