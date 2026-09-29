# Egypt and Arabia in 270 BCE: who held what

Evidence note for the polities in `scripts/map-gen/egypt-arabia-polities.json`, checked by
`scripts/map-gen/check-egypt-arabia-polities.cjs` (it also prints a coverage map at 1 degree over
lon 24-57, lat 15-33). It follows the format and rules of `scripts/map-gen/anatolia-polities.json`
and `docs/anatolia-270-bce.md`. First match wins, so the list runs from specific to general and the
two tribal defaults (Hejaz, Najd) are last. Polygons are generous sketches of spheres of control,
not borders. Deep sand (Western Desert south of lat 24, the Nafud, the Rub al-Khali) is left
unclaimed on purpose.

## Polities

| id | held in 270 | ruler (confidence) |
|---|---|---|
| `ptolemaic-egypt` (existing id) | The Delta, the Nile to Aswan and Lower Nubia to Maharraqa, Fayum, the Western Desert oases and Siwa, Sinai, the Red Sea ports | Ptolemy II Philadelphus, 283/2-246 (high) |
| `kush` | The Nile above Maharraqa, Napata, Meroe, the Butana | none dateable |
| `nabataeans` | Edom, Petra, the Hisma, Wadi Araba, the southern Negev | none (no kings before about 169) |
| `qedar` | Dumat al-Jandal, the Jawf, Wadi Sirhan | none |
| `lihyan` | Dedan/Al-Ula, Hegra, Tayma, Khaybar, Yathrib, Tabuk, Midian coast | none dateable |
| `hejaz-tribes` | Mecca to Asir, the Tihamah coast | none |
| `najd-tribes` | The Najd plateau and oases, Qaryat al-Faw | none |
| `minaeans` | Jawf of Yemen (Qarnawu, Yathill) and the Najran corridor | none |
| `saba` | Marib and the northern Sabaean highlands and Tihamah | none |
| `hadramawt` | Northern Wadi Hadramawt (Shabwa, Shibam) | none |
| `gerrha` | Gulf coast: Thaj/Gerrha, Hofuf, Tarut, Bahrain, Qatar | none |

## Judgement calls

- **Egypt is one polity, and it is the existing id.** `ptolemaic-egypt` in the Anatolian file holds
  the Anatolian exclaves with Alexandria off the map. Alexandria is now on the map, so the entry
  in the new file replaces its name, cohesion (7500 to 8000), cohesion note and capital
  (`offMap` becomes false) and appends 8 settlements and 2 territory rings; the Anatolian
  settlements and rings stay. Ruler and government form are unchanged.
- **Lower Nubia.** Ptolemy II sent an army to Nubia in 275/274 and defeated Kush, and the
  Dodekaschoinos ran from the First Cataract to Maharraqa (Hierasykaminos, near 23.0N). The border
  is drawn there. The kings of Kush cannot be dated to 270: Arqamani (Ergamenes) is now placed
  about 215-205, so Diodorus 3.6 (Ergamenes contemporary with Ptolemy II) is unreliable. No ruler.
- **Red Sea coast.** Berenice Troglodytica (23.9N) and Myos Hormos are Ptolemy II foundations; the
  coast south of them (Blemmyes, Beja, Ptolemais Theron) is not drawn.
- **Siwa and the oases** are inside the Egyptian ring; Siwa's independence of mind is why it is low
  confidence. The west edge at lon 25.0 meets Cyrene at the Catabathmus.
- **Nabataeans.** First seen in 312/311 at Petra (Diodorus 19.94-100). They do not reach Hegra until
  the 1st century BCE-CE, so NW Arabia is not theirs. They are a confederation of tribes with no
  king in 270. Negev "towns" (Avdat, Haluza) are later than 270 and are placeholders for stations
  on an existing caravan road.
- **Lihyan** is dated 5th-1st century BCE, capital Dedan, with a Minaean community. Extent to
  Yathrib and the Midian coast is the maximal reading. Ptolemy II explored the Arabian Red Sea
  coast (Diodorus 3.42) but held nothing there.
- **Minaeans.** Ma'in is a merchant republic of allied towns, with colonies at Dedan and in Egypt.
  Najran is drawn Minaean, on Minaean inscriptions there; Saba' is the alternative. Chronology of
  Ma'in is disputed but 270 is within every scheme.
- **Saba', Hadramawt.** Only the north of the Yemeni kingdoms lies on the map. Qataban lies south of
  lat 15 and is not drawn. Hadramawt never reaches Saudi Arabia in any attested way; it is included
  only because Shabwa and Wadi Hadramawt sit at lat 15.4-16 and drop out if the map is cut higher.
- **Gerrha** is independent: Antiochus III in 205 obtained a ransom and gave freedom, which is not
  what a subject city would receive. Its site is lost; Thaj (48.72, 26.87) is the leading
  identification, with Uqair and Hofuf as alternatives. Seleucid Ikaros on Failaka is off the
  polygon and belongs to the Seleucid default.
- **Hejaz and Najd tribes.** Nothing is attested for the seats named; they are tribal placeholders,
  except Qaryat al-Faw (settled from the 4th century BCE). Kinda is later.
- **Edges shared with the Levant.** Nabataeans, Qedar and Egyptian Sinai meet a polity for the
  southern Levant. Whoever writes the Levant file must agree on Edom, the Negev and Wadi Sirhan;
  Gaza and Coele-Syria are Ptolemaic and not in this file.

## Cohesion, relative to existing polities

Ptolemaic core 8000 (as carthage); Kush 6000 (mamertines); Saba' and Hadramawt 5500; Gerrha 5000;
Minaeans and Lihyan 4500; Nabataeans 3500 (messapians); Qedar 2800; Hejaz and Najd tribes 2200
(ligurians). None of these ids are in the scenario's cohesion table today, so all currently fall to
the 3000 default.

## Sources

- Lihyan: https://en.wikipedia.org/wiki/Lihyan (dates, extent, Minaean community at Dedan)
- Gerrha: https://en.wikipedia.org/wiki/Gerrha; https://en.wikipedia.org/wiki/Thaj (coordinates, Seleucid pottery)
- Ptolemaic Lower Nubia: https://en.wikipedia.org/wiki/Dodekaschoinos (275/274 campaign, First Cataract to Maharraqa)
- Arqamani: https://en.wikipedia.org/wiki/Arqamani (reign about 215-205)
- Ma'in: https://en.wikipedia.org/wiki/Ma%27in (merchant republic, colonies); https://en.wikipedia.org/wiki/Baraqish (Yathill)
- Nabataeans: https://en.wikipedia.org/wiki/Nabataeans (312/311 first mention, Hegra later)
- Qaryat al-Faw: https://en.wikipedia.org/wiki/Qaryat_al-Faw (4th century BCE onward)
- Shabwa: https://en.wikipedia.org/wiki/Shabwa (15.37N, 47.02E)
- Not consulted, recalled from general knowledge: Diodorus 3.42-43 and 19.94-100, Strabo 16.3-4 on Gerrhaeans and Nabataeans, Ptolemy II's foundations on the Red Sea, the Qedarite kings.

Coordinates other than those with a cited page are from memory, good to about 0.1 degree; sizes and
fortification levels are ranked guesses on the scale used in the existing scenario.
