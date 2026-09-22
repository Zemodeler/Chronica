/**
 * Where the things in the room are, and which of them are there at all.
 *
 * Kept as data, apart from both the drawing and the components, because the
 * art is meant to be replaced. A room is three separable layers:
 *
 *   1. scenery  -- a picture. Swappable; see `office-scenery.ts`.
 *   2. rects    -- where each object sits in that picture. This file.
 *   3. controls -- the real buttons, positioned from the rects, and the only
 *                  layer that is ever interactive or reachable by keyboard.
 *
 * Nothing about (3) depends on (1). A new picture is a new file and a new set
 * of rects; no component changes, no handler moves, and the tab order, the
 * focus behaviour and the screen-reader names are all untouched.
 *
 * Coordinates are in a 1600x900 space -- a 16:9 room. They are converted to
 * percentages at render, so the room scales with no measurement and no
 * ResizeObserver.
 */

export type OfficeObjectId =
  | "council" | "chronicle" | "books" | "purse"
  | "forces" | "standing" | "people" | "self" | "window";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const ROOM_WIDTH = 1600;
export const ROOM_HEIGHT = 900;

/** Anything smaller than this is a target nobody can hit. */
export const MIN_OBJECT_SIZE = 96;

export interface OfficeObjectDefinition {
  readonly id: OfficeObjectId;
  /** What the thing is called in the room. */
  readonly name: string;
  /** What you do here, in one line. Also the object's accessible description. */
  readonly does: string;
  readonly rect: Rect;
}

/**
 * The default arrangement.
 *
 * Laid out for the built-in drawn room: a working surface across the middle,
 * shelving and storage down the left, arms and seal to the right, the window
 * high on the right wall. A replacement picture overrides whichever of these
 * do not land where its own furniture is.
 */
export const OFFICE_OBJECTS: readonly OfficeObjectDefinition[] = [
  { id: "council", name: "The writing desk", does: "Give an order.", rect: { x: 560, y: 470, w: 480, h: 260 } },
  { id: "chronicle", name: "The shelf of annals", does: "Turn back through the record.", rect: { x: 90, y: 120, w: 300, h: 300 } },
  { id: "books", name: "The ledger stand", does: "Read the books.", rect: { x: 90, y: 470, w: 240, h: 260 } },
  { id: "purse", name: "The strongbox", does: "Count what is yours.", rect: { x: 370, y: 560, w: 150, h: 170 } },
  { id: "people", name: "The letter tray", does: "Read your correspondence, and ask after people.", rect: { x: 1080, y: 560, w: 220, h: 170 } },
  { id: "forces", name: "The arms rack", does: "Count the men you command.", rect: { x: 1340, y: 430, w: 180, h: 300 } },
  { id: "standing", name: "The seal case", does: "See what your office lets you do.", rect: { x: 1080, y: 380, w: 200, h: 140 } },
  { id: "self", name: "The bronze mirror", does: "Consider yourself.", rect: { x: 420, y: 130, w: 180, h: 220 } },
  { id: "window", name: "The window", does: "Look out at the world.", rect: { x: 1120, y: 90, w: 380, h: 240 } },
];

const BY_ID = new Map(OFFICE_OBJECTS.map((object) => [object.id, object]));

export const officeObject = (id: OfficeObjectId): OfficeObjectDefinition => {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`No office object is defined for "${id}".`);
  return found;
};

/**
 * Which room a character's culture gets.
 *
 * `cultureId` is not a stable vocabulary and must not be treated as one.
 * Scenario NPCs carry "roman" and "culture-local"; a declared player gets
 * `culture-${free text}`, so "Roman Patrician" arrives as
 * "culture-roman-patrician". Matching on substrings is the honest reading of
 * a field that is half enum and half prose.
 */
export type RoomStyle = "roman" | "carthaginian" | "greek" | "gallic" | "neutral";

const STYLE_WORDS: readonly (readonly [RoomStyle, readonly string[]])[] = [
  // "rome" as well as "roman": the culture arrives as prose and the polity as
  // an id, and the id is the bare place name.
  ["roman", ["roman", "rome", "latin", "italic", "sabine", "etruscan"]],
  ["carthaginian", ["carthag", "punic", "phoenic", "numid", "libyan"]],
  ["greek", ["greek", "hellen", "syracus", "achaean", "macedon", "spartan", "athen"]],
  ["gallic", ["gaul", "gallic", "celt", "boii", "insubr", "briton"]],
];

export function roomStyleFor(cultureId: string, polityId: string | null): RoomStyle {
  const haystack = `${cultureId} ${polityId ?? ""}`.toLowerCase();
  for (const [style, words] of STYLE_WORDS) {
    if (words.some((word) => haystack.includes(word))) return style;
  }
  return "neutral";
}

/**
 * What is wrong with an arrangement, if anything.
 *
 * The rules a picture's own placement has to satisfy, as a function rather
 * than as assertions buried in a test, so the same check covers the default
 * arrangement and every override a replacement picture brings with it. There
 * is no way to add art that quietly puts a control off the edge of the room,
 * on top of another one, or too small to hit.
 */
export function arrangementProblems(placed: readonly { readonly id: string; readonly rect: Rect }[]): string[] {
  const problems: string[] = [];
  for (const { id, rect } of placed) {
    if (rect.x < 0 || rect.y < 0) problems.push(`${id} starts outside the room`);
    if (rect.x + rect.w > ROOM_WIDTH) problems.push(`${id} runs off the right of the room`);
    if (rect.y + rect.h > ROOM_HEIGHT) problems.push(`${id} runs off the bottom of the room`);
    if (rect.w < MIN_OBJECT_SIZE || rect.h < MIN_OBJECT_SIZE) problems.push(`${id} is too small to hit`);
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      const hit = a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w
        && a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h;
      if (hit) problems.push(`${a.id} overlaps ${b.id}`);
    }
  }
  return problems;
}
