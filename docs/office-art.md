# Art for the Office

The Office is the player's own room: one of the game's two places, and where
every surface about their own position lives. It ships with a plain drawn
background and is built so that background can be replaced by real art without
touching a single component.

This is the brief to hand an illustrator or an image model, and the three
steps to install what comes back.

---

## What the picture is

A room belonging to a person of consequence, seen from a fixed point near the
doorway, looking in. Nobody is in it. It is their working room, not a hall:
the place where letters are read, orders are written, accounts are gone
through, and the seal is kept.

**Framing**

- 16:9, exactly. 1600×900, or any exact multiple (3200×1800 is welcome).
- One fixed viewpoint, roughly eye height, looking slightly down.
- No people, no animals, no motion.
- No text anywhere in the image — no labels, no signage, no writing on the
  papers. The room is read in the player's own language by the layer above.

**Light**

Lamplit and warm, dim at the edges. The controls sit on top of the image with
a dark gradient behind their labels, so the lower third of each object should
not be the brightest part of the picture.

**Mood**

Lived in and in use. Papers where somebody left them, a chair pushed back.
Not a museum set, not a throne room, not a fantasy study.

---

## What must be in it, and where

Nine things, each at a position the code already knows. Coordinates are in a
1600×900 space, `x, y` from the top-left, and they are where the *object*
sits — the picture should put recognisable furniture in each of these boxes.

| Thing | What it is | Box (x, y, w, h) |
|---|---|---|
| The writing desk | A working surface with something to write on and with | 560, 470, 480, 260 |
| The shelf of annals | Shelving holding the record — scrolls, codices, tablets | 90, 120, 300, 300 |
| The ledger stand | Where the accounts are kept and read | 90, 470, 240, 260 |
| The strongbox | A money chest, closed | 370, 560, 150, 170 |
| The letter tray | Where correspondence arrives and waits | 1080, 560, 220, 170 |
| The arms rack | Arms and armour, stored rather than worn | 1340, 430, 180, 300 |
| The seal case | Where the seal and the documents of office are kept | 1080, 380, 200, 140 |
| The bronze mirror | A mirror, or a polished surface that serves as one | 420, 130, 180, 220 |
| The window | A window with daylight and a view out | 1120, 90, 380, 240 |

Exact placement is not sacred — see step 3 — but **every one of the nine must
be somewhere in the picture, and no two may occupy the same space.**

Keep the boxes reasonably clear of clutter: each one has a label drawn over
its lower edge when the player points at it.

---

## The styles

One picture per culture. A style with no picture falls back to the drawn room,
so they can arrive one at a time.

| Style | The room belongs to |
|---|---|
| `roman` | A Roman of senatorial rank. Plastered walls, a mosaic or tiled floor, wooden furniture, bronze fittings, scroll cases. |
| `carthaginian` | A Carthaginian of standing. Punic decoration, imported textiles, a merchant's fittings; wealthier and more coastal-Mediterranean than the Roman room. |
| `greek` | A Sicilian Greek or Hellenistic official. Painted plaster, klismos chair, papyrus, a more decorated room than the Roman one. |
| `gallic` | A Gallic chieftain. Timber, woven hangings, ironwork, a hearth; no plaster, no mosaic, and far less writing. |
| `neutral` | No particular century. Plain, and never actively wrong. Used for any culture without a room of its own. |

All five are the **same room from the same viewpoint**, refurnished. A player
who changes culture between saves should recognise the arrangement.

---

## Installing one

1. Put the file in `apps/web/public/office/` — `roman.webp`, say. WebP, PNG,
   JPEG or SVG.

2. Edit the entry in
   `apps/web/app/games/[gameId]/components/office-scenery.ts`:

   ```ts
   roman: {
     kind: "image",
     src: "/office/roman.webp",
     alt: "A Roman working room, lamplit",
     credit: "…",
   },
   ```

3. If the furniture did not land where the table above says, override the
   boxes that moved — and only those:

   ```ts
   roman: {
     kind: "image",
     src: "/office/roman.webp",
     alt: "A Roman working room, lamplit",
     rects: {
       forces: { x: 1280, y: 400, w: 220, h: 320 },
       purse: { x: 400, y: 580, w: 160, h: 160 },
     },
   },
   ```

There is no step 4. No component, handler or stylesheet changes, and nothing
about the room's behaviour depends on the picture: the scenery is
`aria-hidden`, has no pointer events and carries no text, while the buttons,
the labels, the focus ring, the tab order and what a screen reader says all
come from `office-objects.ts`.

`office-objects.test.ts` holds any arrangement — default or overridden — to
the room's bounds, to no two objects overlapping, and to a size that can
actually be hit.
