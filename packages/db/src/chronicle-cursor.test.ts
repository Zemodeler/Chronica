import { describe, expect, it } from "vitest";
import { chronicleOrderKey, parseChronicleCursor, type ChroniclePosition } from "./queries/chronicle-cursor";

const at = (toInstantSortKey: number, createdMicros: string, ordinal: number, id: string): ChroniclePosition => ({ toInstantSortKey, createdMicros, ordinal, id });
const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";

describe("a place in the record, as one string", () => {
  it("round-trips every field exactly, microseconds included", () => {
    const position = at(-391_680, "1791806941360123", 7, ID_A);
    expect(parseChronicleCursor(chronicleOrderKey(position))).toEqual(position);
  });

  it("sorts as strings the way the record is read: day, then when written, then ordinal, then id", () => {
    const ordered = [
      at(-5, "1791806941360999", 9, ID_B),
      at(0, "1791806941360000", 0, ID_A),
      at(0, "1791806941360001", 0, ID_A),
      at(0, "1791806941360001", 1, ID_A),
      at(0, "1791806941360001", 1, ID_B),
      at(10, "1", 0, ID_A),
    ];
    const keys = ordered.map(chronicleOrderKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it("refuses anything it did not write", () => {
    for (const bad of ["", "abc", "1.2.3.4", `${"9".repeat(16)}.${"0".repeat(17)}.000000.not-a-uuid`, `${"1".repeat(200)}`]) {
      expect(parseChronicleCursor(bad)).toBeNull();
    }
  });
});
