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
 * ── Two ways to dress a room ──────────────────────────────────────────────
 *
 * **Flat** -- one picture with the furniture painted into it. Simple, and the
 * best a single generated image gives you. Pointing at a thing can then only
 * be a rectangle over the part of the picture it occupies.
 *
 * **Layered** -- an empty room, plus one cut-out per object. More to make and
 * much better to use: the object is its own element, so hovering can trace
 * the edge of the thing itself rather than a box around it, and a single
 * object can be redrawn without touching the room. `object-fit: contain`
 * places each cut-out inside its rect, so a sprite's own proportions do not
 * have to match the rect's.
 *
 * Mixed is fine: any object without a cut-out falls back to the rectangle.
 *
 * ── Putting a new picture in ──────────────────────────────────────────────
 *
 * 1. Drop the files in `apps/web/public/office/`. The room is 16:9, 1600x900
 *    or an exact multiple. Cut-outs are transparent PNG or WebP, trimmed to
 *    the object. WebP, PNG, JPEG and SVG all work.
 * 2. Add or edit the entry below for the style it belongs to.
 * 3. If a thing does not sit where the default rects say, override the ones
 *    that moved in `rects`. Only those -- anything left out keeps the
 *    default, and the arrangement rule still holds it to the room's bounds,
 *    to no overlaps and to a hittable size.
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
  /**
   * The room itself, served from `public/`: "/office/roman-room.webp".
   *
   * For a layered room this is the empty room -- walls, floor, light, the
   * window opening -- with none of the objects painted into it.
   */
  readonly src: string;
  /** What the room is, for the rare reader who has images turned off. */
  readonly alt: string;
  /** Who made it, if the licence asks for a line. Shown nowhere; kept for the record. */
  readonly credit?: string | undefined;
  /**
   * A cut-out per object, on a transparent background.
   *
   * Given one, the object is drawn as its own element inside its rect and
   * pointing at it traces the edge of the thing. Left out, the object falls
   * back to a rectangle over the room picture.
   */
  readonly objects?: Partial<Record<OfficeObjectId, string>> | undefined;
  /** Only the objects this picture puts somewhere other than the default. */
  readonly rects?: Partial<Record<OfficeObjectId, Rect>> | undefined;
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

/** The cut-out for one object, when the room has one. */
export const spriteFor = (scenery: Scenery, id: OfficeObjectId): string | null =>
  scenery.kind === "image" ? scenery.objects?.[id] ?? null : null;
