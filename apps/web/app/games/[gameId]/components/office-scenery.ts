import type { OfficeObjectId, Rect, RoomStyle } from "./office-objects";

/**
 * The picture on the wall behind the controls, and how to replace it.
 *
 * This is the only file that has to change to put new art in the Office.
 * Nothing here is interactive: the scenery is `aria-hidden`, has
 * `pointer-events: none`, and carries no text. Every button, every label,
 * every focus ring and the whole tab order live in the control layer above
 * it, positioned from `office-objects.ts`. A picture cannot break them.
 *
 * ── Putting a new picture in ──────────────────────────────────────────────
 *
 * 1. Drop the file in `apps/web/public/office/`. 16:9, and 1600x900 or any
 *    exact multiple of it. WebP, PNG or JPEG; SVG works too.
 * 2. Add or edit the entry below for the style it belongs to.
 * 3. If its furniture does not sit where the default rects say, override the
 *    ones that moved in `rects`. Only the ones that moved -- anything left
 *    out keeps the default, and the arrangement test still holds it to the
 *    room's bounds, to no overlaps and to a hittable size.
 *
 * There is no step 4. No component, handler or stylesheet needs touching, and
 * a style with no entry falls back to the drawn room, which is plain CSS and
 * always renders.
 *
 * `docs/office-art.md` is the brief to hand an illustrator or an image model:
 * the framing, the object positions, and what must be left clear.
 */

export interface SceneryImage {
  readonly kind: "image";
  /** Served from `public/`, so a leading slash: "/office/roman.webp". */
  readonly src: string;
  /** What the room is, for the rare reader who has images turned off. */
  readonly alt: string;
  /** Who made it, if the licence asks for a line. Shown nowhere; kept for the record. */
  readonly credit?: string;
  /** Only the objects this picture puts somewhere other than the default. */
  readonly rects?: Partial<Record<OfficeObjectId, Rect>>;
}

/** No picture yet: the room is drawn in CSS from the --room-* tokens. */
export interface SceneryDrawn {
  readonly kind: "drawn";
}

export type Scenery = SceneryImage | SceneryDrawn;

const DRAWN: SceneryDrawn = { kind: "drawn" };

/**
 * One entry per culture. All drawn until real art exists -- which is the
 * point: the room works, and swapping a picture in is a one-line edit rather
 * than a rewrite.
 */
export const SCENERY: Readonly<Record<RoomStyle, Scenery>> = {
  roman: DRAWN,
  carthaginian: DRAWN,
  greek: DRAWN,
  gallic: DRAWN,
  neutral: DRAWN,
};

export const sceneryFor = (style: RoomStyle): Scenery => SCENERY[style] ?? DRAWN;

/** The rect a given picture puts an object at, or the room's default. */
export function rectFor(scenery: Scenery, id: OfficeObjectId, fallback: Rect): Rect {
  if (scenery.kind !== "image") return fallback;
  return scenery.rects?.[id] ?? fallback;
}
