# The Levant, the Caucasus and Iran in 270 BCE: who held what

Evidence note for the polities in `scripts/map-gen/levant-caucasus-iran-polities.json`, checked by
`scripts/map-gen/check-levant-caucasus-iran-polities.cjs` (it prints a coverage map at 1 degree over
lon 33-65, lat 24-45 and marks overlaps with the other two polity files). It follows the format and
rules of `scripts/map-gen/anatolia-polities.json` and `docs/anatolia-270-bce.md`, and agrees with
`scripts/map-gen/egypt-arabia-polities.json` and `docs/egypt-arabia-270-bce.md` at the shared
frontiers. First match wins, so the list runs from specific to general and the Seleucid default is
last. Polygons are generous sketches of spheres of control, not borders. Iraq is left unclaimed by
every ring in this file on purpose.

## Polities

| id | held in 270 | ruler (confidence) |
|---|---|---|
| `seleucid-empire` (existing id) | Default holder: Syria with Antioch, Apamea, Laodicea, Beroea; Media (Ecbatana), Susiana, Persis, Carmania, Parthia, Hyrcania, Aria, Drangiana | Antiochus I Soter, 281-261 (high) |
| `ptolemaic-egypt` (existing id) | Coele-Syria: Gaza to the Eleutherus, Phoenician cities, Samaria, Idumea, Transjordan, Hauran, Damascus | Ptolemy II, 283/2-246 (high) |
| `judea` | Yehud around Jerusalem, temple state under Ptolemaic rule | a high priest, Simon the Just or Eleazar (low) |
| `ituraeans` | Beqaa and the Anti-Lebanon (a name from a later century applied to unlisted clans) | none |
| `colchis` (existing id) | The Anatolian ring, extended up the Abkhaz coast and the Rioni to the Surami ridge | none |
| `caucasian-iberia` | Kartli and the Kura valley to the Greater Caucasus | Pharnavaz I, c. 302-237 (medium) |
| `caucasian-albania` | Kura to the Caspian, Karabakh and Mil plains to the Aras | none |
| `atropatene` | North-west Iran, Aras to the Alborz gap, Lake Urmia to the Caspian | none |
| `caspian-peoples` | Cadusii, Mardi and Tapuri between the Alborz crest and the south Caspian | none |
| `dahae-parni` | Steppe north of the Kopet Dag, inside the map | none |
| `makran-tribes` | Gedrosia: Bampur and the Makran coast | none |

## Judgement calls

- **One Seleucid polity.** The Anatolian file already models the empire as one polity, and the
  record for 270 does not force a split. Persis's Frataraka dynasty is dated to the end of the 3rd
  century and the 2nd (Wikipedia, Persis), Elymais has no independent king before about 147, and
  Parthia and Hyrcania are satrapies until Andragoras and Arsaces (about 247). Only Atropatene is
  independent of Seleucus on the record, so only it is split. If the lead later wants an
  "upper satrapies" split (Antiochus I was co-regent of the east until 281), the ring boundary
  would be about lon 46.
- **Ptolemaic Coele-Syria.** Ptolemy II held it from Ipsus (301) until Panium (200); the
  frontier was the Eleutherus (Nahr al-Kabir, about 34.6 N), which is how the later "Coele Syria
  and Phoenicia" province is described (Wikipedia, Coele-Syria). The existing id `ptolemaic-egypt`
  is reused and gains a ring. Arwad and Marathus north of the river stay Seleucid; the era of
  Arwad's autonomy is remembered as 259/8, not checked.
- **Phoenician cities are not a polity.** Tyre, Sidon, Byblos and Berytus were Ptolemaic
  with civic autonomy (Philocles of Sidon, admiral of Ptolemy II, is recalled from memory). Their
  autonomy is a game-mechanic question for the city government, not a separate actor with its
  own foreign policy. If the lead wants a Rhodes-like maritime league, they can lift them out.
- **Damascus.** Drawn Ptolemaic on the south-of-Eleutherus rule and on Ptolemaic evidence I
  recall but did not verify. It is a separate ring in the Ptolemaic entry so it can be deleted and
  Damascus falls to the Seleucid default. This is the least secure claim in the file.
- **Judea.** Given a polity because it has its own sovereign institution (temple, high priest,
  Yehud coins) and a distinct identity that a player can act as. Small enough to fold back into
  `ptolemaic-egypt`. The high priest for 270 is not settled: Josephus puts Simon the Just c. 300-270
  and Eleazar under Ptolemy II; treat the ruler as null if the game needs a defended name.
- **Ituraeans.** The name appears only in the 2nd century BCE. The polygon exists to give the
  Beqaa and the Anti-Lebanon a holder that is neither coast nor steppe; it is a placeholder of the
  same class as `hejaz-tribes`. The lead may prefer to fold it into the Ptolemaic entry.
- **Commagene** is Seleucid and lies in the Anatolian default; no ring here.
- **Colchis.** Extended, not redefined. Vani is an excavated Colchian site; the Georgian
  Chronicles say Pharnavaz conquered part of western Georgia, but they are late, so the border
  is drawn at the Surami ridge.
- **Iberia.** Pharnavaz I is the first king (c. 302-237, Wikipedia, Kingdom of Iberia, citing the
  Chronicles); a native king in Kartli in the 3rd century is safe, the exact dates are not. The id
  is `caucasian-iberia` so it cannot clash with the Iberian peninsula.
- **Caucasian Albania.** Barely documented for 270; Kabalaka (Gabala) is the one city name. The
  south edge runs to the Aras, so Karabakh is Albanian here and Armenian later (after 190).
- **Atropatene.** Independent from Seleucus since Atropates (Wikipedia, Atropatene); Artabazanes
  (about 221) is the first ruler after him named there, so there is no ruler for 270. Ganzak is
  put near Miandoab following that page; Phraaspa is Takht-e Soleyman.
- **Caspian peoples** and **Dahae/Parni** are placeholders in the sense of the Hejaz tribes: real
  peoples with no cities, so the named places are modern or medieval markers. The Parni are still
  nomads in 270; Arsaces's revolt is later.
- **Baluchistan.** Seleucus held Gedrosia with Aria and Arachosia and ceded lands to Chandragupta
  (Wikipedia, Gedrosia); whether the Makran was included and when it took effect is not settled.
  It is drawn as its own tribal polity; reassign it if a Mauryan polity is written. Seleucid Aria
  and Drangiana keep the Seleucid default up to lon 63.4, where the next pass must resume.
- **Deserts** (Dasht-e Kavir, Lut, Syrian desert) are inside the Seleucid Iran ring; the
  builder should drop desert provinces as for the Nafud.

## Cohesion, relative to existing polities

Judea 5500; Iberia and Atropatene 4500 (pontus); Albania 3000 (cenomani); Ituraeans, Caspian
peoples and Dahae/Parni 2200 (ligurians); Makran tribes 2000. The three reused polities keep the
values in their existing files (Seleucid 5500, Ptolemaic 8000, Colchis 2500).

## Faults to fix outside this file

- The Anatolian `seleucid-empire` ring runs to lon 46 between lat 35.3 and 40.6, which covers
  the Jazira and northern Iraq (Mosul, Erbil), against the plan to leave Iraq empty for now. The
  checker shows it as five overlap cells with Albania and Atropatene as well.
- The Anatolian `armenia` ring reaches lon 45.5, which puts the west shore of Lake Urmia and Khoy
  in Armenia; this file abuts it rather than overlapping.
- `node scripts/check-docs.mjs` currently fails on `docs/anatolia-270-bce.md` for a path the
  rewire agent is deleting ; that is not this file.

## Sources

- Atropatene: https://en.wikipedia.org/wiki/Atropatene (Atropates, independence, Ganzak near Miandoab)
- Iberia: https://en.wikipedia.org/wiki/Kingdom_of_Iberia (Pharnavaz I, c. 302-237; Armaztsikhe; extent)
- Coele-Syria: https://en.wikipedia.org/wiki/Coele-Syria (Ptolemaic until Panium 200; frontier at the Eleutherus)
- Persis: https://en.wikipedia.org/wiki/Persis (Frataraka; Seleucid overlordship)
- Gedrosia: https://en.wikipedia.org/wiki/Gedrosia (Seleucid then Mauryan; Pura = Bampur)
- Not consulted, recalled from general knowledge: Strabo 11 on Albania, the Cadusii and Atropatene, Strabo 15.2.9 on the cession to Chandragupta, Josephus AJ 12 on the high priests, the Zenon papyri, Polybius 5 on Coele-Syria.

Coordinates other than those with a cited page are from memory, good to about 0.05-0.1 degree; sizes and
fortification levels are ranked guesses on the scale used in the existing scenario.
