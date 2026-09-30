import { describe, expect, it } from "vitest";
import {
  MIN_OBJECT_SIZE, OFFICE_OBJECTS, ROOM_HEIGHT, ROOM_WIDTH,
  arrangementProblems, officeObject, roomStyleFor, type Rect,
} from "./office-objects";
import { SCENERY, rectFor } from "./office-scenery";

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the arrangement of the room", () => {
  it("keeps every object inside the picture", () => {
    for (const object of OFFICE_OBJECTS) {
      expect(object.rect.x).toBeGreaterThanOrEqual(0);
      expect(object.rect.y).toBeGreaterThanOrEqual(0);
      expect(object.rect.x + object.rect.w).toBeLessThanOrEqual(ROOM_WIDTH);
      expect(object.rect.y + object.rect.h).toBeLessThanOrEqual(ROOM_HEIGHT);
    }
  });

  it("never puts two things in the same place", () => {
    for (let i = 0; i < OFFICE_OBJECTS.length; i++) {
      for (let j = i + 1; j < OFFICE_OBJECTS.length; j++) {
        const a = OFFICE_OBJECTS[i]!;
        const b = OFFICE_OBJECTS[j]!;
        expect(overlap(a.rect, b.rect), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("leaves every object big enough to hit", () => {
    for (const object of OFFICE_OBJECTS) {
      expect(object.rect.w, object.id).toBeGreaterThanOrEqual(MIN_OBJECT_SIZE);
      expect(object.rect.h, object.id).toBeGreaterThanOrEqual(MIN_OBJECT_SIZE);
    }
  });

  it("names each thing once, and can find it again", () => {
    const ids = OFFICE_OBJECTS.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(officeObject(id).id).toBe(id);
    expect(() => officeObject("nowhere" as never)).toThrow();
  });

  it("says what each thing is for, without an id leaking into the prose", () => {
    for (const object of OFFICE_OBJECTS) {
      expect(object.name.length).toBeGreaterThan(0);
      expect(object.does).toMatch(/\.$/);
      expect(object.does).not.toContain("_");
    }
  });
});

describe("which room a culture gets", () => {
  it("reads a cultureId that is half enum and half free text", () => {
    // Scenario NPCs carry "roman"; a declared player's is built from prose.
    expect(roomStyleFor("roman", "rome")).toBe("roman");
    // A player with no declared culture still belongs to a power, and the
    // polity id is the bare place name rather than the adjective.
    expect(roomStyleFor("", "rome")).toBe("roman");
    expect(roomStyleFor("", "carthage")).toBe("carthaginian");
    expect(roomStyleFor("", "syracuse")).toBe("greek");
    expect(roomStyleFor("culture-roman-patrician", null)).toBe("roman");
    expect(roomStyleFor("culture-carthaginian-merchant", null)).toBe("carthaginian");
    expect(roomStyleFor("culture-local", "syracuse")).toBe("greek");
    expect(roomStyleFor("culture-gallic-chieftain", null)).toBe("gallic");
    // Asia Minor's kingdoms sit in Hellenistic rooms; the Galatians are Celts.
    expect(roomStyleFor("", "seleucid-empire")).toBe("greek");
    expect(roomStyleFor("anatolian", "pontus")).toBe("greek");
    expect(roomStyleFor("celtic", "galatians-trocmi")).toBe("gallic");
    // The Semitic peoples of the Near East take the nearest existing room.
    expect(roomStyleFor("arabian", "nabataeans")).toBe("carthaginian");
    expect(roomStyleFor("judaean", "judea")).toBe("carthaginian");
    expect(roomStyleFor("mesopotamian", "marsh-peoples")).toBe("carthaginian");
  });

  it("falls back rather than guessing", () => {
    expect(roomStyleFor("culture-local", null)).toBe("neutral");
    expect(roomStyleFor("", null)).toBe("neutral");
    expect(roomStyleFor("culture-han-official", "han")).toBe("neutral");
  });
});

describe("the rule an arrangement has to satisfy", () => {
  const at = (id: string, x: number, y: number, w = 200, h = 200) => ({ id, rect: { x, y, w, h } });

  it("passes the room's own arrangement", () => {
    expect(arrangementProblems(OFFICE_OBJECTS.map((o) => ({ id: o.id, rect: o.rect })))).toEqual([]);
  });

  it("catches a control pushed off the edge", () => {
    expect(arrangementProblems([at("desk", ROOM_WIDTH - 100, 0)])).toContain("desk runs off the right of the room");
    expect(arrangementProblems([at("desk", 0, ROOM_HEIGHT - 100)])).toContain("desk runs off the bottom of the room");
    expect(arrangementProblems([at("desk", -10, 0)])).toContain("desk starts outside the room");
  });

  it("catches a control nobody could hit", () => {
    expect(arrangementProblems([at("seal", 0, 0, MIN_OBJECT_SIZE - 1, 200)])).toContain("seal is too small to hit");
  });

  it("catches two things put in the same place", () => {
    expect(arrangementProblems([at("a", 100, 100), at("b", 200, 200)])).toContain("a overlaps b");
    expect(arrangementProblems([at("a", 100, 100), at("b", 400, 400)])).toEqual([]);
  });
});

describe("a replacement picture's own arrangement", () => {
  // docs/office-art.md promises an overridden arrangement is held to the same
  // rules as the default one. This is that promise, over whatever art exists.
  it("holds every scenery override to the same rule", () => {
    for (const [style, scenery] of Object.entries(SCENERY)) {
      if (scenery.kind !== "image") continue;
      const placed = OFFICE_OBJECTS.map((object) => ({ id: object.id, rect: rectFor(scenery, object.id, object.rect) }));
      expect(arrangementProblems(placed), style).toEqual([]);
    }
  });

  it("would catch a bad override, art or no art", () => {
    // The loop above is vacuous until real art lands, so prove the check bites.
    const bad = { kind: "image" as const, src: "/office/x.webp", alt: "x", rects: { forces: { x: 560, y: 470, w: 480, h: 260 } } };
    const placed = OFFICE_OBJECTS.map((object) => ({ id: object.id, rect: rectFor(bad, object.id, object.rect) }));
    expect(arrangementProblems(placed)).toContain("council overlaps forces");
  });

  it("only ever names objects the room actually has", () => {
    const known = new Set(OFFICE_OBJECTS.map((object) => object.id));
    for (const [style, scenery] of Object.entries(SCENERY)) {
      if (scenery.kind !== "image" || scenery.rects === undefined) continue;
      for (const id of Object.keys(scenery.rects)) {
        expect(known.has(id as never), `${style} places an unknown "${id}"`).toBe(true);
      }
    }
  });

  it("points every picture at a file under public/", () => {
    for (const [style, scenery] of Object.entries(SCENERY)) {
      if (scenery.kind !== "image") continue;
      expect(scenery.src.startsWith("/"), `${style} src must be served from public/`).toBe(true);
      expect(scenery.alt.length, `${style} needs an alt`).toBeGreaterThan(0);
    }
  });
});
