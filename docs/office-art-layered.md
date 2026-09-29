# Layered room art — prompts

The first run produced five good rooms, but the model ignored "empty" and
painted the furniture in, so they are **flat**: pointing at a thing can only
be a rectangle, and a private citizen sees an arms rack he cannot touch,
because the picture has one.

Layered art fixes both. An empty room plate, plus nine cut-outs on
transparent backgrounds. Then the hover traces the object's own silhouette,
and an object the player has no claim on is simply not in the room.

Two things make this run work where the last one did not.

**Use the rooms you already have as the style anchor.** Attach
`apps/web/public/office/roman-room.webp` to every one of these prompts. Ten
separately generated images will not otherwise agree on palette, light or
perspective, and the cut-outs have to sit in the plate as if they were
painted with it.

**Fight the furnishing.** Image models fill rooms. "Empty" alone will not do
it — it did not last time. The prompt below repeats the negative, gives a
reason for the emptiness, and describes the surfaces in enough detail that
there is something to render instead.

---

## Prompt 1 — the empty room

One per culture. Attach the matching existing room as the style reference.
Ask for **1536 × 1024**.

> Using the attached image as the exact style, palette, lighting and camera
> reference, paint **the same room with every piece of furniture taken out of
> it**.
>
> This is the room on the day before it is furnished: the walls are finished,
> the floor is laid, the window is in, and nothing has been carried in yet.
> Wide interior view from the same fixed point near the doorway, same eye
> height, same very slight downward angle, same warm lamplight from the upper
> left falling off into shadow at the edges.
>
> What is in the picture: the walls with their plaster and decoration, the
> floor, the doorway at the left edge, and the open window at the upper right
> with daylight and a landscape beyond it. That is all.
>
> **There is no furniture of any kind in this image.** No desk. No table. No
> chair. No shelves. No bookcase. No reading stand. No chest. No box. No
> trunk. No tray. No weapon rack. No shield. No helmet. No spears. No mirror.
> No lamp stand. No plants. No pots. No rugs. No baskets. No scrolls, books,
> papers or writing implements. No objects resting on the floor and nothing
> hanging on the walls. The floor is completely clear and unbroken from the
> doorway to the far wall. The walls are bare.
>
> No people, no animals, no text, no lettering, no signage, no watermark, no
> border, no UI. An empty room.

If it still paints furniture in, say so and ask again — "you have put a table
in it; remove the table and everything else standing on the floor" works
better than restating the original prompt.

---

## Prompt 2 — the nine cut-outs

One per object. Attach the same room image to every one. Keep the wording
identical apart from the object line, or they will not look like a set.

> Using the attached image as the exact style, palette, lighting and camera
> reference, paint a single object from that room, by itself.
>
> **THE OBJECT: <one line from the table below>**
>
> The object alone, centred, complete, nothing cut off at any edge. Seen from
> the same angle it would be seen at in the attached room — eye height,
> very slightly from above. Same warm lamplight from the upper left, same soft
> shadow on its own lower right.
>
> **The background is fully transparent.** No floor. No wall. No ground. No
> cast shadow on any surface. No backdrop, no gradient, no colour, no
> checkerboard, no white. Nothing touches or overlaps the object. Transparent
> PNG with a real alpha channel.
>
> No people, no text, no lettering, no watermark, no border.

| Object | Ask for | THE OBJECT |
|---|---|---|
| `council` | 1536 × 1024 | A heavy wooden writing desk, with a wax tablet, a cup of styluses, a small ink pot and a part-unrolled scroll on it. |
| `chronicle` | 1024 × 1024 | A set of open wooden wall shelves holding rolled scrolls and stacked bound volumes. |
| `books` | 1024 × 1536 | A tall wooden reading stand on a pedestal, with a large open ledger on it and counting tokens in a tray at its foot. |
| `purse` | 1024 × 1024 | A small banded wooden money chest with an iron ring handle, closed. |
| `people` | 1536 × 1024 | A low wooden side table holding a rack of folded letters sealed with red wax. |
| `forces` | 1024 × 1536 | A wooden arms rack holding upright spears, a round shield and a crested helmet. |
| `standing` | 1536 × 1024 | A small open document casket on a wall shelf, holding rolled documents, a seal and sticks of red wax. |
| `self` | 1024 × 1536 | A polished bronze mirror standing in a wooden frame on a wall shelf. |
| `window` | 1536 × 1024 | An open shuttered window frame with bright daylight and a distant landscape beyond it. |

The sizes are what the model actually offers. They need not match the boxes:
each cut-out is fitted inside its box without distortion.

---

## Installing them

`apps/web/public/office/`, then one manifest entry in
`office-scenery.ts` — `src` is the empty plate, `objects` the cut-outs:

```ts
roman: {
  kind: "image",
  src: "/office/roman-room-empty.webp",
  alt: "A Roman working room, lamplit",
  objects: {
    council: "/office/roman-desk.png",
    chronicle: "/office/roman-shelves.png",
    books: "/office/roman-stand.png",
    purse: "/office/roman-chest.png",
    people: "/office/roman-letters.png",
    forces: "/office/roman-arms.png",
    standing: "/office/roman-seal.png",
    self: "/office/roman-mirror.png",
    window: "/office/roman-window.png",
  },
  rects: { /* only what moved */ },
},
```

They can arrive one at a time. Any object without a cut-out keeps its
rectangle over the plate, so a half-finished set still runs.

**The one way this fails:** a PNG that is not really transparent. The white
edge is drawn from the image's alpha, so a white or checkered background
outlines a rectangle. Check a file by opening it over a dark background
before wiring it in.

---

## Prompt 3 — the same eight objects, in another culture

All five rooms currently share the **Roman** cut-outs, so a Carthaginian sits
at a Roman desk under a Roman helmet. The plates are per-culture; the objects
are not, and that is the largest thing still missing.

Eight per culture, for Carthaginian, Greek, Gallic and neutral. `window` needs
none — it is painted into the plate.

The trick that makes this cheap and consistent: **give it the Roman cut-out it
is replacing, and the empty room it has to sit in.** Attach both. Asking for a
fresh object from a text description will not match the set; asking for *this
object, re-made for that room* will.

> Attached are two images: an object cut out on a transparent background, and
> the room it belongs in.
>
> Re-make **the same object, serving the same purpose, at the same size, angle
> and lighting**, as it would have been made for the second room's culture
> instead. Same viewpoint, same warm lamplight from the upper left, same soft
> shadow on its own lower right, same painterly semi-realistic style.
>
> **CULTURE LINE GOES HERE**
>
> Keep its silhouette close to the original so it stands in the same place:
> the same proportions, the same footprint, the same overall height and width.
> Change the materials, the ornament and the craft, not the shape or the
> scale.
>
> The object alone, centred, complete, nothing cut off at any edge. **The
> background is fully transparent** — no floor, no wall, no ground, no cast
> shadow on any surface, no backdrop, no gradient, no colour, no checkerboard,
> no white. Transparent PNG with a real alpha channel.
>
> No people, no text, no lettering, no watermark, no border.

| Style key | Culture line |
|---|---|
| `carthaginian` | Carthaginian work: dark imported hardwood, bronze and ivory inlay, Punic geometric and palmette ornament, a merchant city's finish — richer and more decorated than the Roman original. |
| `greek` | Sicilian Greek work: lighter turned wood, restrained Hellenistic detail, a painted meander or palmette band, slimmer and more elegant than the Roman original. |
| `gallic` | Gallic work: heavy rough-hewn timber, iron bands and rivets, carved spiral and knotwork ornament, no marble and no fine turning — plainer and stronger than the Roman original. |
| `neutral` | Plain old work of no particular century: worn wood, simple iron fittings, no ornament that fixes a date or a place. |

Keeping the silhouette close is what lets all five cultures share one set of
boxes. If a replacement does come back a different shape, re-proportion its
box — see **Boxes have to match the art** in `office-art.md`.

Then add a per-culture object map in `office-scenery.ts` instead of the shared
`OFFICE_CUT_OUTS`:

```ts
const CUT_OUTS = (style: string): Partial<Record<OfficeObjectId, string>> => ({
  council: `/office/${style}-council.png`,
  chronicle: `/office/${style}-chronicle.png`,
  books: `/office/${style}-books.png`,
  purse: `/office/${style}-purse.png`,
  people: `/office/${style}-people.png`,
  forces: `/office/${style}-forces.png`,
  standing: `/office/${style}-standing.png`,
  self: `/office/${style}-self.png`,
});
```

They can arrive one culture at a time: keep `OFFICE_CUT_OUTS` for the ones
not yet drawn.
