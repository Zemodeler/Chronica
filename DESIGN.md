# Design

How Chronica's interface looks, and why. It covers the chrome around the painted
rooms and the map; the room art itself has its own brief in
[docs/office-art.md](docs/office-art.md).

## The room is lit by one lamp

The game is played in two places: the Office, a painted room, and the Map. The
interface is not a dashboard laid over them. It belongs to the room.

- **The chrome is the dark of the room.** Every ground is soot or umber, a
  lamp-shadow brown. Nothing is slate blue.
- **Documents are objects laid on the desk.** The Chronicle, letters, the
  ledger and the muster roll are papyrus sheets with ink on them.
- **Bronze is what you can touch.** Every interactive edge, focus ring and
  primary button is bronze.
- **The seal means "this needs your word".** Each culture has one seal colour.
  It marks decisions, deficits, breaches and war borders, and nothing else.
- **Lamp-gold means new.** Unread counts and "new since you last looked" only.

The mode is *operate*: a player reads what happened, writes an order, and
checks their position. The Chronicle is the one surface built for reading at
length.

Chronica is a desktop-browser game. Layouts take a `min-width` floor
(1200px for the game) rather than responsive breakpoints. Accessibility is
still required on its own terms: real controls, a sensible tab order, visible
focus, and labels a screen reader can use.

## Tokens

All colours live in `apps/web/app/styles/tokens.css`. The canvas map cannot
read CSS variables cheaply, so it takes the same values from
`apps/web/lib/palette.ts`; a unit test keeps the two in step.

| Token | Value | Role |
|---|---|---|
| `--soot` | `#15110D` | page ground |
| `--umber` | `#2A211A` | raised chrome: the lintel, sheet frames, inputs on dark |
| `--wax` | `#2B2419` | the writing surface at the desk |
| `--papyrus` | `#E6D8BA` | document sheets |
| `--ink` | `#231B14` | text on papyrus (12.0:1) |
| `--vellum` | `#E6D9BE` | text on dark (13.4:1 on soot) |
| `--dust` | `#A8977C` | muted text on dark (6.6:1 on soot) |
| `--bronze` | `#B98B4A` | interactive edges on dark (6.1:1 on soot) |
| `--bronze-deep` | `#7A5626` | interactive edges on papyrus (4.7:1) |
| `--lamp` | `#F2C66D` | new and unread |
| `--seal` | per culture | decisions, deficits, breaches, war borders |

The seal is set by `data-culture` on the game shell:

| Culture | Seal | Value |
|---|---|---|
| Roman | cinnabar | `#8F2320` |
| Carthaginian | Tyrian purple | `#5B2A5E` |
| Greek | meander blue | `#2F5A8A` |
| Gallic | iron rust | `#7A4A1E` |
| Neutral | earth | `#6B5A45` |

Every seal passes 4.5:1 against papyrus and with vellum text on it.

## Type

One family, loaded with `next/font/google`:

- **Alegreya**, a humanist serif drawn for literature: headings, Chronicle
  prose, the order text. `--font-serif`.
- **Alegreya Sans**: controls, labels and dense UI. `--font-sans`.
- **Alegreya SC**: true small caps for "BC" in dates, for speaker names, and
  letterspaced for region names on the map. `--font-caps`.

Figures are old-style in prose (`font-variant-numeric: oldstyle-nums`) and
tabular lining in ledgers and muster numbers.

Sizes run on a 1.25 scale from 15px UI text. Chronicle body text is 19px/1.6
at about 62 characters.

## Parts

Shared components live in `apps/web/app/components/ui/`, styled in
`apps/web/app/styles/primitives.css`.

- **`Sheet`**: every surface the Office opens, and the map's own panels. A
  native `<dialog>` opened with `showModal`, so focus is trapped and restored
  and Escape closes it. The backdrop is the room with the lamp turned down.
  It anchors on the side opposite the object that opened it. Widths:
  `reading` (Chronicle, letters), `ledger` (treasury, muster, standing, the
  mirror), `desk` (the council).
- **`Button`**: `primary` (bronze, one per surface), `quiet` (everything
  else), `seal` (only inside a decision).
- **`CloseButton`**: the one close control, labelled "Close".
- Lamp-gold unread badges, underlined word filters instead of pill chips, and
  ledgers with the surplus or shortfall at the foot.

## Motion

One orchestrated moment: when a sheet opens, the room dims and softens behind
it. Everything else moves only in answer to the player. The progress trail
while the world moves adds one line per real stage. `prefers-reduced-motion`
turns the dimming into a cut.

## The map

The satellite relief is drawn as an engraved plate:

- a sepia pass over the terrain, baked once into the raster bitmap when it
  loads, so no frame pays for it;
- flat ink-teal water;
- each polity as a light wash with a strong band inside its border, like a
  hand-coloured atlas, in mineral pigments;
- region labels in letterspaced Alegreya SC, cached as bitmaps per zoom level
  (see `map-canvas-labels.ts`), rebuilt once the font has loaded.

Measure map performance with a GPU trace, not script timers.

## Words

Sentence case. Plain verbs. Buttons say what happens ("Send", "Let a month
pass"). Errors say what went wrong and what to do. Where the game already
speaks in the world's voice ("Sending for the muster roll…"), keep it.

## Don't

- All-caps eyebrow labels over headings.
- Meta strings joined with middle dots. Write a sentence instead.
- Monospace for data, emoji for icons, `→` on buttons.
- The same rounded card and shadow on everything. A border or shadow marks a
  thing as a separate object; use it only for one.
- Any colour that is not a token.
