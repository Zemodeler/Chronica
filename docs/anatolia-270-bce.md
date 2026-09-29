# Anatolia in 270 BCE: who held what

Evidence note for the polities in `scripts/map-gen/anatolia-polities.json`, checked by
`scripts/map-gen/check-anatolia-polities.cjs`. The plan is `docs/plans/imperator-density-map.md`.
The polygons are generous sketches of spheres of control, drawn from the historical record, not
from modern borders. In the JSON, first match wins, so the list runs from specific to general and
the Seleucid default is last.

## What the game already has

Only `rhodes`, `aeolis-communities` and `ionia-communities` reached Anatolia on the map before
this one; they are reused. There is no Seleucid or Ptolemaic
polity (the Ptolemaic world is only `cyrene`). Every other polity below is new.
`packages/db/src/punic-wars-scenario.ts` lists cohesion for only some powers; the rest, Macedon
included, fall to the 3000 default. The cohesion values here follow the intended scale instead.

## Polities

| id | held in 270 | ruler (confidence) |
|---|---|---|
| `seleucid-empire` | Default holder: Lydia (Sardis), Phrygia, Lycaonia, Cilicia Pedias, Commagene, north Syria with Antioch | Antiochus I Soter, 281-261 (high) |
| `ptolemaic-egypt` | Coastal Caria, Cos, Lycia, Pamphylia, Cilicia Tracheia; capital Alexandria is off the map | Ptolemy II, 283/2-246 (high) |
| `pergamon` | The Pergamon fortress and its territory in Mysia | Philetaerus, 282-263 (high) |
| `bithynia` | Thynia, Bithynia, Olympene; seat at Astacus (Nicomedia only from about 264) | Nicomedes I, about 278-255 (high) |
| `heraclea-pontica` | The city, Tium, Amastris | none (city republic) |
| `hellespont-propontic-cities` | Cyzicus, Lampsacus, Parium, Abydos, Chalcedon | none |
| `euxine-greek-cities` | Sinope, Amisos, Cotyora, Cerasus, Trapezus | none |
| `paphlagonia` | Interior north of the Galatians, around Gangra | not known |
| `pontus` | Interior: Amaseia, Zela, Gaziura, Comana Pontica | Mithridates I Ktistes, 281-266 (medium) |
| `cappadocia` | Mazaca, Tyanitis, Cataonia, Melitene | Ariamnes I (low) |
| `galatians-tolistobogii`, `-tectosages`, `-trocmi` | Pessinus and Gordion; Ancyra; Tavium | none: leaders of 278 are Leonnorius and Lutarius, but their role in 270 is unattested |
| `pisidia-isauria` | Selge, Termessos, Sagalassos, Isaura | none |
| `colchis` | Black Sea coast east of Trapezus and the Pontic Alps | none |
| `armenia` | Orontid Armenia with Sophene and the Van basin | not known |
| `rhodes`, `ionia-communities`, `aeolis-communities` | Reused. Rhodes gets a small Peraea on the Carian shore | as they are |

## Judgement calls

- **One Seleucid polity, one Ptolemaic polity.** The Seleucid realm is far larger than Anatolia and
  the game treats the far edge of a great power as part of it (Rome is one polity). Splitting by
  satrapy would invent institutions. The lead may still want a separate west-Anatolian polity.
- **Ptolemaic coast.** Theocritus, Idyll 17 (about 270), lists Pamphylia, Cilicia, Lycia and Caria
  among Ptolemy II's lands. How far the First Syrian War (274-271) pushed him into Cilicia Pedias is
  not settled; Tarsus is drawn Seleucid. Termessos and inland Pisidia are not Ptolemaic.
- **Ionia.** Miletus, Ephesus and Samos passed between Ptolemaic and Seleucid control across
  280-260. They stay in `ionia-communities` (autonomous cities), not in either empire.
- **Galatians.** They crossed in 278-277 with Nicomedes' help and were still raiding. The tribal
  homelands are those of Strabo, so the polygons show where they ended up. Pessinus was a Phrygian
  temple state and probably not yet Galatian.
- **Pontus.** In 270 it is only the interior; Sinope was taken in 183 BCE and the coast was Greek.
- **Cappadocia.** The succession before Ariarathes III is poorly documented; treat Ariamnes I as
  provisional.
- **Armenia.** Sophene and Van are folded into one Orontid polity as a simplification. Commagene is
  left Seleucid. Iberia and Georgia proper are outside the map.
- **Heraclea and the small Greek clusters** are separate from Bithynia because Heraclea allied with
  Nicomedes rather than being his subject.

## Sources

- Cappadocia: https://en.wikipedia.org/wiki/Kingdom_of_Cappadocia (Ariamnes, capital Mazaca, satrapies)
- Pontus: https://en.wikipedia.org/wiki/Mithridates_I_of_Pontus (281-266 BCE, Amasia, Cimiata)
- Bithynia: https://en.wikipedia.org/wiki/Nicomedes_I_of_Bithynia (reign, Nicomedia about 264, Galatians, Heraclea alliance)
- Galatia: https://en.wikipedia.org/wiki/Galatia; https://en.wikipedia.org/wiki/Tavium; https://en.wikipedia.org/wiki/Pessinus (coordinates checked)
- Ptolemaic Kingdom: https://en.wikipedia.org/wiki/Ptolemaic_Kingdom (general only). The Lycia-to-Caria list rests on Theocritus, Idyll 17, which was not opened here.
- Not consulted, recalled from general knowledge and to be checked: Strabo books 12-14 on tribal territories, Memnon of Heraclea, Livy 38.16 on the Galatians, Seleucid and Ptolemaic reigns.

Settlement coordinates other than Pessinus are from memory and good to about 0.05-0.1 degree; sizes and
fortification levels are ranked guesses on the scale used in the existing scenario.
