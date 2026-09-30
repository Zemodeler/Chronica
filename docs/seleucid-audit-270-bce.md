# The Seleucid Empire in 270 BCE: what the map holds against the record

Audit of `seleucid-empire` on the 6,384-province map, made 2026-09-30 against the earlier evidence notes
`docs/anatolia-270-bce.md`, `docs/levant-caucasus-iran-270-bce.md` and `docs/iraq-270-bce.md`. The corrections
are data, in `scripts/map-gen/ownership-corrections-seleucid.json` (three assignments, six provinces, and thirteen
notes for what was left alone). The builder that would apply them is `scripts/map-gen/build-map-graph.ts`;
this audit does not change it or the map.

## What is held

1,111 provinces, about 1.37 million km2, from Troy to Sistan. It is the default holder: every ring of the
three polity files is tested first, and whatever falls in none of them and lies inside the Seleucid rings is
Seleucid. The region names below are the `regionId` of the province polygons (Ptolemy's and Strabo's names,
not modern ones), grouped by me.

| Block (regionIds) | Provinces | Verdict | Action |
|---|---|---|---|
| Anatolia west and centre (lydia 19, phrygia 18, caria 16, mysia 15, lycaonia 13, troad 8, pisidia 8, garsauritis 6, lycia 4, galatia 2, aeolis 2, tolistobogia 1, tyanitis 1) | 113 | Sound. Lydia, Phrygia west, Lycaonia, Apameia Kelainai and the Troad were Seleucid. Two Cappadocian provinces (Tyanitis, Garsauris) were not. | 2 to `cappadocia`. Galatian south, Hellespontine Mysia, Milyas and inland Caria are low-confidence notes |
| Cilicia (Pedias 9, Tracheia 2) | 11 | Contested. Sources say Ptolemy II held "most of Cilicia" after 271, yet the plain is Seleucid on later evidence | Left, note |
| Taurus fringe (Commagene 5, Sophene 3) | 8 | Commagene Seleucid: correct. The Sophene-labelled three are Osrhoene-side foothills | Left |
| North Syria and Euphrates (apamene 18, chalybonitis 17, cyrrhestice 12, seleucis 12) | 59 | Correct: Antioch, Apamea, Laodicea, Seleucia Pieria, Beroea | None |
| Syrian steppe and Damascene (palmyrene 31, damascene 7, hauran 1) | 39 | Steppe held in name; Damascus uncertain | Left, notes |
| Jazira (syrian-mesopotamia 73, osrhoene 18) | 91 | Correct | None |
| Babylonia, Assyria, Susiana, Elymais (matiane 64, susiana 62, kambadene 19, elymais 17) | 162 | Correct; the Seleucid heartland | None |
| Zagros and Taurus hill tribes (carduchia 40, cossaea 34, uxia 30, vaspurakan 8, mardia 8) | 120 | Held in name only | 55 upland provinces to the new `zagros-tribes`; the lowlands stay |
| Media and the plateau (media 30, rhagiana 28, cadusia 9, tapuria 14, choarene 32, sagartia 20, paraetacene 12, carmania-deserta 42) | 187 | Correct as sphere; much of it is desert fringe | None |
| Persis, Carmania, Gulf coast (persis 76, ichthyophagia 23, carmania 7) | 106 | Correct: Seleucid governors of Persis, Kerman, Harmozia | None |
| Parikania and Gedrosia (parikania 41, gedrosia 1) | 42 | Gedrosia was ceded to Chandragupta; Parikania is the border zone | 1 to `makran-tribes`, rest a note |
| Hyrcania, Parthia, Margiana (hyrcania 27, parthia 22, nisaea 20, margiana 17, astauene 11) | 97 | Correct: satrapies until about 247 | None |
| Aria, Drangiana, Zarangia (aria 43, drangiana 22, zarangia 11) | 76 | Correct | None |

The other direction, Seleucid land held by others: the rings for Atropatene, Armenia, Ptolemaic Coele-Syria
(to the Eleutherus at 34.6 N), Judea, the Ituraeans, Nabataea, Qedar and the Scenitae fit the record, with one
exception. The Atropatene ring's west edge stops at lon 45.0-45.4, so the plain and west shore of Lake Urmia,
which Strabo puts in Atropatene, went to the Seleucid default as "Northern Carduchia". Three provinces move.

## Corrections proposed (medium confidence)

1. Urmia west shore, lon 44.75-45.4, lat 37.15-37.95: 3 provinces Seleucid to `atropatene`.
2. Tyanitis and Garsauritis edge, lon 33.45-34.3, lat 37.3-38.2: 2 provinces Seleucid to `cappadocia`.
3. Lowland Gedrosia edge, lon 62.4-63.4, lat 27.9-28.4: 1 province Seleucid to `makran-tribes`.

None holds a Seleucid capital or anchor settlement; all other provinces in the polygons already belong to the
target polity. Applying them leaves the polity at 1,105.

## The Zagros hill tribes (decided: a new polity)

The Carduchian, Cossaean, Uxian and Mardian highlands were peoples the Persian kings paid or fought and
Alexander raided; no Seleucid administration in them is attested. The lead decided they become a tribal
polity of their own, `zagros-tribes` ("Zagros hill tribes", tribal confederation, cohesion 2200 like
`ligurians` and `caspian-peoples`, no capital, ruler or settlement because none is attested).

- Data: `scripts/map-gen/zagros-polities.json` (four rings, in the format of the other polity files) and
  `scripts/map-gen/check-zagros-polities.cjs` (validates it and checks it against the other five files: no
  overlap with any non-Seleucid ring, and no settlement of any file, nor Susa, Ecbatana, Laodicea in Media,
  Bisitun, Arbela, Kirkuk, Nineveh, Nippur, Babylon, Seleucia, Gabae or Persepolis, inside a ring). It passes.
- The rings are drawn on the upland only. The regions' own names split them: about 65 provinces of Carduchia,
  Cossaea, Uxia, Vaspurakan and Mardia are named lowland, coastal or valley (the Assyrian plain, the Little Zab,
  the Nippur plain, the Bushehr coast) and stay Seleucid. So the polity takes 55 provinces, not the 120 the region
  names suggest: 17 Cossaea, 14 Uxia, 11 Carduchia, 7 Mardia, 3 Vaspurakan and 3 Matiane uplands.
- Order: the rings are meant to be tested before the Seleucid default of their theatre. The builder does not
  read the file yet. The same four rings are the first four assignments of
  `scripts/map-gen/ownership-corrections-seleucid.json`, which the builder does read and which pins the
  provinces against the smoothing pass, so only `zagros` needs adding to the builder's theatre list.
- The four pieces are not contiguous (Kambadene, Elymais and Media lie between them), so the builder will report
  them as several pieces on one landmass.
- Five Vaspurakan and three northern Carduchia provinces lie inside the Armenian ring but are Seleucid on the
  current build; they are a build inconsistency, left alone here.

With the Zagros polity and the three other corrections the Seleucid polity is 1,050 provinces (1,111 - 6 - 55).
The map as it stands already carries the three other corrections (1,105).

## One polity or several

Recommendation: keep one `seleucid-empire` polity for 270, do not split by satrapy, and take the Zagros
decision above. Reasons:

- The record supports one crown. Antiochus I reigns alone from 281; the co-regency of his son Seleucus in the
  east (about 275-268) is a delegation inside one house, which is what an office does, not a second state
  (`docs/iraq-270-bce.md` already records it as a viceroy field).
- Nothing in the record for 270 gives Babylonia, Persis, Elymais, Media or the Syrian core an independent actor.
  The independent pieces (Atropatene, Cappadocia, Bithynia, Armenia, Pergamon's near-independence) are already
  separate polities. Persis's Frataraka and Elymais's kings are 2nd century; Andragoras and Diodotus are 3rd
  century, after 250.
- Splitting would invent a second treasury, second cohesion figure and second foreign policy for a
  relationship the sources describe as one court. The extra cost is real: two crowns to write, a war
  declaration by one that binds the other, and a border the sim must treat as domestic.

The case for a split is only about size and reach. One polity with 1,050 provinces is 16% of the map and
runs every per-polity pass over 1,050 provinces; the Seleucid heartland is 1,500 km from the Aegean holdings.
I did not measure the sim's per-polity cost, so this is unverified. If it matters, the least invented cut is
"upper satrapies" (east of about lon 46, the line `docs/levant-caucasus-iran-270-bce.md` already names)
under the viceroy Seleucus, roughly 450 to 600 provinces, with Bactria off the map. I would take that only if play
shows a cost, and I would rather model the delegation as offices and a governor character inside the one
polity.

## Uncertainty

Sources actually read for this audit were the three Wikipedia pages below, which are thin on borders; Strabo,
Pliny, Theocritus Idyll 17 and the Anatolian and Iranian satrapal geography are recalled, not re-read. The
provinces' `regionId` names come from the map's own tables and say where the polygon lies, not who held it.
The Cilicia, Damascus, inland Caria and Parikania questions cannot be settled from what was consulted.

## Sources

- First Syrian War: https://en.wikipedia.org/wiki/First_Syrian_War (Ptolemy II held Caria and most of Cilicia by 271)
- Antiochus I: https://en.wikipedia.org/wiki/Antiochus_I_Soter (could not reduce Bithynia or Cappadocia; Galatians 275; Damascus and the coast districts of Asia Minor changed hands)
- Gedrosia: https://en.wikipedia.org/wiki/Gedrosia (ceded to the Mauryas)
- Atropatene: https://en.wikipedia.org/wiki/Atropatene
- Cappadocia: https://en.wikipedia.org/wiki/Kingdom_of_Cappadocia
- Seleucid Empire: https://en.wikipedia.org/wiki/Seleucid_Empire (general only)
- Recalled, not opened: Strabo 11.13 (Atropatene), 12.1-2 (Cappadocian prefectures), 15.2.9 (the cession); Pliny 6.23; Xenophon Anabasis 4 (Carduchi); Theocritus Idyll 17.
