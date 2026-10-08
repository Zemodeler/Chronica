# Scenario notes: defection gaps closed

**No scenario change and no version bump is required by this work.** `packages/db/src/built-in-versions.ts` and the scenario pin are untouched.

- The hired bands (`packages/sim/src/hired-bands.ts`) read the unit structure from the scenario's own establishments as they stand (Carthage's Gallic, Iberian, Numidian, Balearic and Greek contingents, Syracuse's mercenary band for the Campanians) and carry a small table of the peoples' arms and practice in code. A game saved before this work keeps the bands it has; only a company hired after it is drawn up this way.
- The reception decree needs no data: the receiving power's council is the chamber that is not a mere counsel (Rome's Senate); a power with none receives at once.

**Intended version note, if the scenario is next republished** (to be added to `built-in-versions.ts` by whoever owns the pin): "A man of rank who goes over is a suppliant until the receiving Senate has voted; a hired company is a band of its own people, with its own practice; a defection breaks his contracts and his bands follow or fall back; a deserter who returns is tried by the power he left. Establishments of the Gauls, Iberians, Numidians, Balearic slingers, Campanians and Greeks may later be authored for Rome and the other powers in a new db file (`punic-wars-hired-peoples.ts`) in place of the table in `sim/hired-bands.ts`."
