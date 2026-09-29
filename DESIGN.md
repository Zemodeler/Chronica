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
(1200px for the game, 1024px for the site) rather than responsive
breakpoints. Accessibility is
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
| `--bronze-hover` | `#C99A58` | a primary button under the pointer |
| `--lamp` | `#F2C66D` | new and unread |
| `--lamp-core`, `--lamp-rim` | `#FFF3C8`, `#C9993F` | the flame and the lamp-gold badge |
| `--vellum-high` | `#F4ECDA` | vellum text under the pointer |
| `--danger`, `--danger-ink` | `#C0534A`, `#E3A69E` | harm that cannot be undone, on dark: deleting a save, a refused form |
| `--danger-deep` | `#8A2A22` | the same on papyrus; `.on-papyrus` and dialogs swap it in |
| `--seal` | per culture | decisions, deficits, breaches, war borders |

Danger is not the seal. The seal is the world asking for the player's word;
danger is the site warning that something will be lost.

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

Sizes run on a 1.25 scale from 15px UI text. The step below it stops at 13px:
nothing a player has to read is smaller. Chronicle body text is 19px/1.6 at
about 62 characters.

## Parts

Shared components live in `apps/web/app/components/ui/`, styled in
`apps/web/app/styles/primitives.css`.

- **`Sheet`**: every surface the Office opens, and the map's standard
  catalog. A native `<dialog>` opened with `showModal`, so focus is held and
  restored and Escape closes it. The backdrop is the room with the lamp turned
  down. It anchors on the side opposite the object that opened it. On opening
  it focuses its content (or an element marked `data-autofocus`, like the
  order on the desk), not its close button. Widths: `reading` (Chronicle,
  letters), `ledger` (treasury, muster, standing, the mirror), `desk` (the
  council), `narrow` (small forms).
- **`Tabs`**: ribbons in a document (the treasury, the seal case). A ribbon
  with nothing in it is not offered; a document with one section shows no
  ribbons. A ribbon wanting attention carries the seal dot.
- **Object states**: an object's plaque says its current fact ("1,370 a
  month to spare"), from `roomStates` (shared); the seal mark when that fact
  wants the player's word. One line and one mark per object at most; a quiet
  room means nothing needs you.
- **Plaques**: invisible until the object is pointed at or focused. The
  painting is the thing to look at; only the seal mark and the lamp-gold
  badge sit on an object at rest.
- **The reckoning** under the order at the desk: what this save has spent of
  its cap, what is in the wallet, and what the last order came to. Turns are
  billed by tokens, so there is no price in advance; the desk says what the
  last one cost. An empty purse, or a save at its cap, shuts the desk and the
  map's order bar and says why before the click. The lintel's date and coins
  are read with the record, so both move when the world does.
- **The calendar line** after the date in the lintel: the next dated thing
  the player could know of, from `whatComesNext` (shared), never from the
  event queue. A seal dot when it wants the player's word; choosing it opens
  the next few in a native popover. Nothing coming, nothing shown.
- **The army card** on the map is a papyrus card, not a sheet: a modal would
  take the map out of the player's hand while they look at an army.
- **`Button`**: `primary` (bronze, one per surface), `quiet` (everything
  else), `seal` (only inside a decision).
- **`CloseButton`**: the one close control, labelled "Close".
- Lamp-gold unread badges, underlined word filters instead of pill chips, and
  ledgers with the surplus or shortfall at the foot.
- **Unread in the Chronicle**: an entry the player has not read carries a
  lamp-gold "New" badge (ink on the lamp, since gold letters vanish on
  papyrus). It becomes read once it has held the page for a moment and a
  half, not when the Chronicle opens. The head of the sheet says how many are
  unread and offers "Only what is unread" and "Mark all as read"; the
  unread-only view keeps what was unread when it was chosen, so reading an
  entry never makes it vanish.
- Marks before a line, not bars beside it: a notice, an error or an empty
  purse leads with a small dot in bronze, danger or the seal.

## Outside the game

The site is the same room seen before the lamp is lit.

- **The threshold** (signed out): the Roman room full-bleed, dark where the
  words stand, leading with "Play anyone." Below it, one turn as it goes: an
  order on wax, the world moving, and a Chronicle passage on papyrus, marked
  as an example.
- **The shelf** (your games): the save to go back to as its own room, with
  who the player is there, the world's date and the last thing the Chronicle
  recorded; the others as ruled rows. No saves is an invitation, not an empty
  table.
- **Worlds**: a plate and its words, alternating down the page: the day it
  opens, the premise, and who you might be, all read from the scenario's own
  data. The plate is `public/worlds/<slug>.webp`, painted to one house style
  (docs/scenario-key-art.md); a world without art gets a title plate.
- **Character creation**: the question, the world's date, and under the box
  the scenario's leading people and a few stations as starting points that
  fill it. The price is said on the button line.
- **The account**: the wallet first, then a ruled ledger of name, recovery
  email and saves.
- Deleting a save asks on papyrus, never in a browser alert.

## Motion

One orchestrated moment: when a sheet opens, the room dims and softens behind
it. Everything else moves only in answer to the player. The progress trail
while the world moves adds one line per real stage. `prefers-reduced-motion`
turns the dimming into a cut.

## The map

The satellite relief is drawn as an engraved plate:

- a sepia pass over the terrain, baked once into the raster bitmap when it
  loads, so no frame pays for it;
- the relief itself sharp where the player looks: tiles of shaded relief
  (`apps/web/app/games/[gameId]/components/relief-tiles.ts`) fetched only for
  what is in view and toned the same way, over the whole-world raster;
- flat ink-teal water;
- each polity as a light wash with a strong band inside its border, like a
  hand-coloured atlas, in mineral pigments;
- region labels in letterspaced Alegreya SC, cached as bitmaps per zoom level
  (see `map-canvas-labels.ts`), rebuilt once the font has loaded.

Sizes on the map are set in CSS pixels times a display unit: the shorter side
of the map over 1000 px, held between 0.75 and 1.6 and rounded to tenths
(`map-display-unit.ts`). A laptop's map is about 0.8 and a large monitor's
about 1.3. Settlement markers, their names and gaps, the army standards and
the label floors all scale by it, so a large screen is not dotted with a
laptop's specks. Markers grow gently with each octave of zoom up to a
ceiling, instead of sitting on a floor and then jumping.

Zoomed all the way out, each polity is named once, on its largest piece, and
the largest few by all the land they hold (twelve times the display unit) are
always named. A name that will not fit along its territory's curve is set
straight through the territory at 11 px times the unit, overhanging its
borders if it must. When two of these collide, both shrink toward that
floor, then the smaller slides along its line, and only then is it dropped.
Detached pieces get their own names once the player zooms in.

Capitals are named at every zoom. Other settlements are named only close in.

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
- A coloured bar down the left of a callout or option.
- Any colour that is not a token.
