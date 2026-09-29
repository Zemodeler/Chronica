# Office art — culture variants

Carthaginian, Greek, Gallic and neutral rooms now have unfurnished layered room
plates. Eight shared transparent furniture cut-outs are rendered only when an
office function exists; the open window remains part of each plate so its view
stays culture-specific. The furniture layout is shared and configured in
`office-scenery.ts`.

Generated using the built-in OpenAI image generation tool, with `apps/web/public/office/roman-room.webp` as the composition and style reference. Each output was resized to 1600 × 900 and encoded as WebP at quality 90.

## Assets

- `apps/web/public/office/carthaginian-room.webp`
- `apps/web/public/office/greek-room.webp`
- `apps/web/public/office/gallic-room.webp`
- `apps/web/public/office/neutral-room.webp`

## Shared prompt

Use case: historical-scene. Create a finished flat-art background for Chronica. Reference image is the existing Roman room: match its painterly semi-realistic adventure-game finish, camera angle and NINE OBJECT LOCATIONS while replacing architecture, furnishings and landscape for the requested culture. Single 1600x900 16:9 landscape image, eye height from doorway looking slightly down. Intimate lived-in private office, empty of people. Warm lamplight upper left, muted earth pigments, dim edges, daylight upper right. All furniture painted into scene.
Keep these separate objects in approximate 1600x900 rectangles:
chronicle x115 y80 w275 h230: wall shelves full of rolled scrolls and bound volumes.
books x125 y330 w275 h410: reading stand, open blank ledger, counting tokens.
purse x405 y520 w140 h145: closed small banded wooden money chest with lock.
council x550 y480 w580 h325: broad writing desk with blank wax tablet, stylus and partly unrolled blank scroll; chair pushed back behind.
people x1135 y455 w175 h100: shallow letter tray with folded blank sealed correspondence, on separate low support.
forces x1370 y275 w180 h400: arms rack with shield, spears and helmet stored.
standing x1090 y270 w220 h120: open seal case containing seal ring, wax and rolled documents on wall shelf.
self x465 y75 w170 h170: upright polished bronze hand mirror on small stand/shelf.
window x1060 y15 w425 h240: rectangular window with open wooden shutters and daylight beyond.
Keep all nine visually distinct, readable, separated and uncropped. Quiet open central upper wall. No people, animals, text, lettering, writing or pseudo-writing on any paper/tablet/book, signage, watermark, borders, UI, modern objects, fantasy ornament. No extra mirrors, chests, desks or windows.

## Culture additions

### carthaginian

CULTURE: A Carthaginian dignitary's private working room: pale warm stucco, refined Punic geometric borders, patterned terracotta and cream floor tiles, dark cedar furniture, bronze fittings, subtle coastal teal accents, richer decoration than Roman but restrained. Window overlooks an ancient Mediterranean harbor.

### greek

CULTURE: A Sicilian Greek official's private working room: cream painted plaster with a simple muted blue meander border, pale worn limestone floor, restrained Hellenistic decoration, honey-colored timber furniture. Window overlooks Sicilian coastline and distant Greek buildings.

### gallic

CULTURE: A Gallic chieftain's private working room: timber plank walls and sturdy posts, woven wool hangings, packed earth floor, hearth soot on beams, rugged oak furniture and iron fittings. Absolutely no plaster, mosaic, marble, or stonework. Window overlooks quiet wooded hills. Arms are Gallic spears, oval shield and simple iron helmet.

### neutral

CULTURE: An old private working room of no particular century: plain warm rendered walls, worn wooden floor, simple dark timber furnishings, no ornament that fixes a date. Window overlooks quiet countryside. Plain shield, spears, undecorated helmet.
