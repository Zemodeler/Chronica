# Art for the Office

The Office is the player's own room: one of the game's two places, and where
every surface about their own position lives. The art is replaceable without
touching a single component.

**The prompts live in [`office-art-layered.md`](office-art-layered.md).** This
file is the contract they have to satisfy: how the room is put together, where
each thing goes, and how to install a replacement.

---

## How a room is put together

Three layers, deliberately separable.

| Layer | What it is |
|---|---|
| **scenery** | A picture. `aria-hidden`, no pointer events, no text, no handlers. |
| **boxes** | Where each object sits in that picture — data, in `office-scenery.ts`. |
| **controls** | The real buttons, positioned from the boxes. The only interactive layer. |

Nothing about the controls depends on the picture. The tab order, the focus
ring, the labels and what a screen reader says all come from
`office-objects.ts`, identically whether the room is drawn, flat or layered.
That is what makes art safe to swap: a picture cannot break the room.

**Flat** — one image with the furniture painted in. Pointing at a thing is a
rectangle over the part of the picture it occupies.

**Layered** — an empty room plate, plus one cut-out per object on a
transparent background. Each object is its own element, so hovering traces the
edge of *the thing itself*, an object can be redrawn alone, and an object the
player has no claim on is simply not in the room. This is what ships.

Mixed is fine: any object without a cut-out falls back to a rectangle over the
plate. The `window` has no cut-out on purpose — it is painted into the plate.

---

## Where the boxes are

Coordinates in a 1600 × 900 space, `x, y` from the top-left. These are the
live values from `CULTURE_ROOM_RECTS` in
`apps/web/app/games/[gameId]/components/office-scenery.ts`.

| Object | Box (x, y, w, h) |
|---|---|
| `council` — the writing desk | 550, 489, 580, 326 |
| `chronicle` — the shelf of annals | 115, 111, 275, 199 |
| `books` — the ledger stand | 125, 430, 270, 315 |
| `purse` — the strongbox | 400, 546, 145, 124 |
| `people` — the letter tray | 1158, 450, 129, 100 |
| `forces` — the arms rack | 1320, 367, 270, 323 |
| `standing` — the seal case | 1110, 265, 180, 120 |
| `self` — the bronze mirror | 465, 106, 170, 139 |
| `window` — the window | 1060, 15, 425, 240 |

### Boxes have to match the art

Each cut-out is placed with `object-fit: contain`, so a sprite is never
distorted — but it is never *larger* than its box either. A box whose
proportions differ from the art's leaves dead space the object does not fill,
while the hotspot still covers all of it: the arms rack first rendered at half
its height, floating off the floor, because its box was twice as tall as the
art was.

So each box above is cut to its own cut-out's proportions. **A replacement
cut-out of a different shape needs its box re-proportioned**: keep the centre
line and the surface the thing stands on, and shrink the other dimension to
match.

Measure the file. The generated cut-outs came back **trimmed to their
content**, not at the canvas size the prompt asked for — `roman-forces.png` is
1147 × 1371, not the 1024 × 1536 requested — so their proportions are the
object's own, not the model's.

---

## Installing a room

1. Put the files in `apps/web/public/office/`. The plate is 16:9, 1600 × 900
   or an exact multiple. Cut-outs are transparent PNG or WebP.

2. Add or edit the entry in `office-scenery.ts`:

   ```ts
   roman: {
     kind: "image",
     src: "/office/roman-room-empty.webp",
     alt: "A Roman working room, lamplit",
     objects: {
       council: "/office/roman-council.png",
       forces: "/office/roman-forces.png",
       // …any subset. Anything left out falls back to a rectangle.
     },
   },
   ```

3. Re-proportion any box whose art changed shape, per the rule above.

There is no step 4. No component, handler or stylesheet changes.

`arrangementProblems` holds any arrangement — default or overridden — to the
room's bounds, to no two objects overlapping, and to a size that can actually
be hit. `office-objects.test.ts` runs it over every room in the manifest.

**The one way this fails:** a PNG that is not really transparent. The white
edge on hover is drawn from the image's alpha, so a white or checkered
background outlines a rectangle. Open a file over a dark background before
wiring it in.
