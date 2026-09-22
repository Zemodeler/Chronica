# Roman office art

The first installed office illustration uses the flat option in `office-art.md`.
It is a single painted room with all nine objects, served from
`apps/web/public/office/roman-room.webp` at 1600 × 900. Its hotspot overrides
are in `office-scenery.ts`. Flat art uses rectangular hover highlights;
transparent object layers remain a possible future upgrade. The other culture
variants are documented in `office-art-cultures.md`.

Created with the built-in OpenAI image generation tool. The generated image
was resized and encoded as WebP for delivery.

## Generation prompt

Use case: historical-scene. Create a finished painterly background for Chronica, a historical adventure/strategy game. One single 1600x900 16:9 landscape image. A private working room of a Roman senator in the ancient Mediterranean, viewed from the doorway at eye height looking slightly down. Intimate working office, not throne room. Faded Pompeian red and ochre plaster, worn plain stone and timber, understated tiled floor. Warm lamplight from upper left, muted earth pigments, deep soft shadows around edges and bottom, gentle daylight at upper right. Beautiful hand-painted adventure game background, semi-realistic, tactile brushwork, lived-in. All furniture painted into this image.
Composition MUST allow nine separate interactive hotspots; use these approximate rectangles in a 1600x900 canvas and keep each object visually distinct, uncropped, and separated:
1 left upper wall x90 y120 w300 h300: wall shelves with rolled scrolls and stacked bound volumes.
2 left bottom x90 y470 w240 h260: tall reading stand with large open blank ledger and counting tokens.
3 x370 y560 w150 h170: small closed banded wooden money chest with iron lock.
4 centre x560 y470 w480 h260: low broad writing desk, wax tablet, stylus, partly unrolled blank scroll; chair pushed back behind desk.
5 right x1080 y560 w220 h170: shallow wooden pigeonhole letter tray with folded blank sealed correspondence on a low support.
6 far right x1340 y430 w180 h300: wooden arms rack with spears, shield and helmet, stored.
7 right middle x1080 y380 w200 h140: open document case on narrow wall shelf containing bronze seal ring, red sealing wax and rolled documents.
8 left upper middle x420 y130 w180 h220: polished bronze hand mirror upright on small wall shelf stand, dull bronze reflection of light only.
9 upper right x1120 y90 w380 h240: rectangular open shuttered window, soft bright Mediterranean daylight beyond.
Preserve quiet open wall across middle upper part and floor below furniture. Subtle perspective, broad front-facing back wall so layout reads naturally. No people, animals, text, lettering, writing even on paper, signage, watermark, border, UI, captions, modern objects, fantasy ornament or dramatic sunbeams.
