# Art for the Office

The Office is the player's own room: one of the game's two places, and where
every surface about their own position lives. It ships with a plain drawn
background and is built so that background can be replaced by real art
without touching a single component.

There are two ways to dress it.

**Flat** — one picture with the furniture painted in. Simple, and what a
single generated image gives you. Pointing at a thing can then only be a
rectangle over the part of the picture it sits in.

**Layered** — an empty room, plus one cut-out per object on a transparent
background. More to make and much better to use: each object is its own
element, so hovering traces the edge of *the thing itself* rather than a box
around it, and any one object can be redrawn without touching the room.

Layered is what the prompts below are for. Mixed is fine — any object with no
cut-out falls back to the rectangle.

---

## The brief

A room belonging to a person of consequence, seen from a fixed point near the
doorway, looking in. Nobody is in it. It is their working room, not a hall:
where letters are read, orders written, accounts gone through, and the seal
kept.

- 16:9 for the room. One fixed viewpoint, roughly eye height, looking
  slightly down.
- No people, no animals, no motion.
- **No text anywhere.** No labels, no signage, no writing on the papers. The
  room is read in the player's own language by the layer above.
- Lamplit and warm, dim at the edges. Light falls from the upper left.
- Lived in and in use — papers where somebody left them, a chair pushed back.
  Not a museum set, not a throne room, not a fantasy study.

---

## Prompt 1 — the empty room

Paste this, substituting the culture line from the table below. Ask for
**1536 × 1024** (the nearest landscape size; it is cropped to 16:9 on the
way in, or extend it yourself to 1600 × 900).

> A wide interior view of an empty private working room in the ancient
> Mediterranean world, seen from a fixed point near the doorway looking in,
> at roughly eye height and angled very slightly downward. Painterly, warm,
> muted, semi-realistic — like a background plate from a hand-painted
> adventure game.
>
> **CULTURE LINE GOES HERE**
>
> The room is completely empty of furniture: bare walls, a bare floor, and an
> empty window opening in the upper right with soft daylight coming through
> it. No desk, no shelves, no chest, no chair, no racks, no objects of any
> kind — only the room itself.
>
> Lit by warm lamplight from the upper left, falling off into shadow at the
> edges and corners. Deep shadow along the bottom edge. Quiet, lived-in,
> slightly worn. No people, no animals, no text, no lettering, no writing, no
> signage, no watermark, no border, no UI. Flat even composition with nothing
> competing for attention in the centre.

| Style key | Culture line |
|---|---|
| `roman` | A Roman room of senatorial rank: plastered walls in faded red and ochre, a simple mosaic or tiled floor, plain stone and timber. |
| `carthaginian` | A Carthaginian room of standing: pale stucco walls with Punic geometric borders, patterned floor tiles, a coastal Mediterranean feel, richer and more decorated than a Roman one. |
| `greek` | A Sicilian Greek room: painted plaster walls with a simple meander border, a pale stone floor, restrained Hellenistic decoration. |
| `gallic` | A Gallic chieftain's room: timber walls and posts, woven hangings, a packed earth floor, a hearth's soot on the beams. No plaster, no mosaic, no stonework. |
| `neutral` | An old room of no particular century: plain rendered walls, a worn wooden floor, no ornament that fixes a date. |

## Prompt 2 — one cut-out per object

Nine of these, one per object. Keep the same culture line and the same light
direction in every one, or they will not look like they belong to the room.

> **OBJECT DESCRIPTION GOES HERE**
>
> **CULTURE LINE GOES HERE**
>
> A single object, alone, centred, on a fully transparent background.
> Painterly, warm, muted, semi-realistic, matching a hand-painted adventure
> game background. Lit by warm lamplight from the upper left with soft shadow
> on its lower right; no cast shadow on the ground, no floor, no wall, no
> backdrop of any kind. Seen at roughly eye height, angled very slightly
> downward, as it would sit in a room viewed from the doorway. Nothing
> touching or overlapping it. No people, no text, no lettering, no writing,
> no watermark, no border. Transparent PNG.

| Object | Ask for | Object description |
|---|---|---|
| `council` | 1536 × 1024 | A low writing desk with a wax tablet and a stylus on it, and a scroll left unrolled at one end. |
| `chronicle` | 1024 × 1024 | A set of open shelves filled with rolled scrolls and stacked bound volumes. |
| `books` | 1024 × 1536 | A tall reading stand with a large open ledger resting on it, and counting tokens beside it. |
| `purse` | 1024 × 1024 | A heavy banded wooden money chest, closed, with an iron lock. |
| `people` | 1536 × 1024 | A shallow tray or set of pigeonholes holding folded letters and sealed correspondence. |
| `forces` | 1024 × 1536 | A wooden arms rack holding spears, a shield and a helmet, stored rather than worn. |
| `standing` | 1536 × 1024 | A small open document case holding a seal ring, a stick of wax and rolled documents of office. |
| `self` | 1024 × 1536 | A polished bronze hand mirror on a small stand. |
| `window` | 1536 × 1024 | A shuttered window frame with its shutters open and bright daylight beyond. |

The sizes are what image models actually offer; they need not match the boxes
below, because each cut-out is fitted inside its box without distortion.

---

## Installing it

1. Put the files in `apps/web/public/office/` — e.g. `roman-room.webp` and
   `roman-desk.png`.

2. Edit the entry in
   `apps/web/app/games/[gameId]/components/office-scenery.ts`:

   ```ts
   roman: {
     kind: "image",
     src: "/office/roman-room.webp",
     alt: "A Roman working room, lamplit",
     objects: {
       council: "/office/roman-desk.png",
       forces: "/office/roman-arms.png",
       // …any subset. Anything left out falls back to a rectangle.
     },
   },
   ```

3. If a thing does not sit where the default boxes say, override the ones
   that moved — and only those:

   ```ts
   rects: { forces: { x: 1280, y: 400, w: 220, h: 320 } },
   ```

There is no step 4. No component, handler or stylesheet changes.

### Where the boxes are

Coordinates in a 1600 × 900 space, `x, y` from the top-left.

| Object | Box (x, y, w, h) |
|---|---|
| `council` — the writing desk | 560, 470, 480, 260 |
| `chronicle` — the shelf of annals | 90, 120, 300, 300 |
| `books` — the ledger stand | 90, 470, 240, 260 |
| `purse` — the strongbox | 370, 560, 150, 170 |
| `people` — the letter tray | 1080, 560, 220, 170 |
| `forces` — the arms rack | 1340, 430, 180, 300 |
| `standing` — the seal case | 1080, 380, 200, 140 |
| `self` — the bronze mirror | 420, 130, 180, 220 |
| `window` | 1120, 90, 380, 240 |

Each cut-out is placed with `object-fit: contain`, anchored to the bottom of
its box, so a sprite's own proportions do not have to match the box's.

---

## Why the layers stay apart

The picture is `aria-hidden`, has no pointer events, and carries no text.
Every button, label, focus ring and the whole tab order come from
`office-objects.ts` and are identical whether the room is drawn, flat or
layered. A picture cannot break them, which is why art can be swapped without
anyone re-testing the room.

The white edge on hover is four hard drop-shadows following the cut-out's own
alpha, so it traces the object's silhouette rather than its bounding box.
That only works if the PNG really is transparent around the object — a white
or checkered background will outline a rectangle and look wrong.

`arrangementProblems` holds any arrangement, default or overridden, to the
room's bounds, to no two objects overlapping, and to a size that can actually
be hit.
