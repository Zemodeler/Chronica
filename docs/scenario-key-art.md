# Scenario key art

Every world on the worlds page has a plate beside its premise. The plate
shows what defines that scenario: its place, its powers and the moment it
opens on. It is never an Office room.

There will be dozens of scenarios, so nothing about the art is written in
code. A plate is found by the scenario's slug:

    apps/web/public/worlds/<slug>.webp      1920×1200 (16:10), WebP

`lib/world-catalogue.ts` looks for that file. A scenario without one gets a
title plate, its name and opening day set like a book's title page, until its
art is made. Adding art is adding one file, with no code change and no
restart.

Current slugs:

| Scenario | Slug | File |
|---|---|---|
| Punic Wars (270 BC) | `punic-wars` | `punic-wars.webp` |
| The Numidian Decision (264 BC) | `first-punic-war` | `first-punic-war.webp` |

## The house style

Every plate uses the same closing paragraph, so dozens of worlds read as one
series on the page. Paste it unchanged at the end of each prompt:

```
Painterly digital oil in the manner of nineteenth-century academic history painting: rich textured brushwork, deep chiaroscuro, fine atmospheric perspective. One warm light source against a cool sky. Palette of lamp-gold, umber, bronze and oxblood against ink-teal water and slate-blue distance. Highly detailed, historically accurate dress, arms, ships and architecture for the year. No faces in close-up, no text, no lettering, no maps, no modern elements, no watermark, no border.
```

## Writing a new scenario's prompt

Fill in this skeleton, then add the house style and one mood phrase:

```
Create an image: A wide 16:10 painted history scene: [time of day] in [year] at [the place the scenario turns on]. In the foreground, [one or two figures of the power the player most likely plays, seen from behind or in three-quarter view, with the objects that mark their people]. [The middle ground: the city, harbour, camp or field in question.] [The distance: the rival power's presence, whether sails, smoke, banners or an army.] [One sentence naming the tension, e.g. "Nobody has crossed yet."] [Composition: where the focal point sits, left or right third.] <house style> [Two-word mood], mood.
```

Rules that keep the series coherent:

- **The tension, not a battle.** Show the moment before the scenario's
  question is answered.
- **At least two powers in frame.** The worlds are about rivals.
- **Figures seen from behind or far off.** The player will be someone, so
  the plate should not cast a face.
- **Focal point on a third, never centred.** The page alternates plates left
  and right.

## Punic Wars, 270 BC

Rome, Carthage and the Mamertines across the Strait of Messina. Nobody has
crossed yet.

```
Create an image: A wide 16:10 painted history scene: dawn over the Strait of Messina in 270 BC, seen from high on the walls of Messana. In the foreground, two Mamertine mercenaries in bronze helmets and red cloaks lean on their spears on a battlement, seen from behind, looking out. Below, the harbour of Messana with Greek merchant ships at anchor. A single Carthaginian quinquereme with a bronze ram and purple-edged sail rows slowly along the strait, keeping watch. Across the narrow water, on the Italian shore, the smoke of Roman camp fires rises above Rhegium. Three powers, one strait, nobody has crossed yet. The strait runs as a bright band through the middle; the warship is the focal point at the right third. Painterly digital oil in the manner of nineteenth-century academic history painting: rich textured brushwork, deep chiaroscuro, fine atmospheric perspective. One warm light source against a cool sky. Palette of lamp-gold, umber, bronze and oxblood against ink-teal water and slate-blue distance. Highly detailed, historically accurate dress, arms, ships and architecture for the year. No faces in close-up, no text, no lettering, no maps, no modern elements, no watermark, no border. Tense, expectant mood.
```

## The Numidian Decision, 264 BC

A Numidian prince above Carthage, with a Roman fleet on the sea. He must
choose a side.

```
Create an image: A wide 16:10 painted history scene: late afternoon in 264 BC on a dry ridge in the Numidian hills above the Gulf of Tunis. In the foreground, a Numidian prince on a small dark horse without saddle or bridle, a leopard skin over his shoulder and three light javelins in hand, seen in three-quarter view from behind, with a few riders waiting behind him. Far below, the city of Carthage spreads to the sea, its circular military harbour ringed with ship sheds, its walls gold in the low sun. Out on the sea to the north, beneath a gathering storm, the sails of a Roman fleet. He must choose a side. The prince is the focal point at the left third; Carthage and the storm fill the right. Painterly digital oil in the manner of nineteenth-century academic history painting: rich textured brushwork, deep chiaroscuro, fine atmospheric perspective. One warm light source against a cool sky. Palette of lamp-gold, umber, bronze and oxblood against ink-teal water and slate-blue distance. Highly detailed, historically accurate dress, arms, ships and architecture for the year. No faces in close-up, no text, no lettering, no maps, no modern elements, no watermark, no border. Weighty, undecided mood.
```
