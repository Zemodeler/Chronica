# Iraq (and Kuwait) in 270 BCE: who held what

Evidence note for `scripts/map-gen/iraq-polities.json`, checked by
`scripts/map-gen/check-iraq-polities.cjs` (it prints a coverage map at 1 degree over lon 36-50, lat 27-38 and
marks overlaps with the other three polity files). It follows the format of
`scripts/map-gen/levant-caucasus-iran-polities.json` and the decisions of
`docs/levant-caucasus-iran-270-bce.md` and `docs/anatolia-270-bce.md`: one Seleucid polity, first match wins,
polygons are generous sketches of spheres of control, not borders. The Arabian side is
`docs/egypt-arabia-270-bce.md`.

## Polities

| id | held in 270 | ruler (confidence) |
|---|---|---|
| `seleucid-empire` (existing id) | Babylonia and the alluvium (Seleucia on the Tigris, Babylon, Borsippa, Kutha, Sippar, Nippur, Uruk, Larsa, Ur), the Assyrian edge (Nineveh, Arbela, Ashur, Kirkuk), the Jazira with Nisibis, the Gulf-head port site | Antiochus I Soter (high); eldest son Seleucus viceroy of the east c. 275-268/7 (medium) |
| `scenitae-arabs` | Steppe and desert west of the Euphrates, from Wadi Hauran to the Kuwait border and the coast of Kuwait | none |
| `marsh-peoples` | The Hammar and Hawizeh marsh country between Uruk and the Susiana border | none |

Not new: `qedar` holds the Sirhan and Dumat and abuts the Arab ring; Failaka (Ikaros) keeps its small Seleucid
ring in the Iran file. Together the three rings leave no overlap cell with any other file.

## Judgement calls

- **One Seleucid polity.** Nothing in the record for 270 gives Babylonia, Assyria or the Jazira a separate
  actor. Babylonia is the empire's tax base and the seat of the eastern satrapies, but Seleucus I's foundation
  Seleucia on the Tigris (c. 305) and the temple cities are all under the crown. The builder should add
  `seleucidCities` to the Seleucid polity. The capital stays Antioch (as in both other files). A second seat
  at Seleucia on the Tigris is a lead decision, not a data change.
- **Where was the king?** The brief guessed Antiochus I was resident in Babylon or Seleucia. What the record
  shows: he laid the foundation of the Ezida at Borsippa in 268 and styled himself restorer of Esagila and
  Ezida (Antiochus Cylinder), so he was active in Babylonia, but the same page gives his eldest son Seleucus as
  viceroy of the east from about 275 until Antiochus had him put to death in 268/7. In 270 the person who
  governed Iraq for the crown is therefore the son (a `viceroy` field on the Seleucid entry). Antiochus's own
  location in 270 is not settled; the First Syrian War (274-271) had just ended in Syria.
- **Characene did not exist.** Hyspaosines declared it independent in 141 BCE; Antiochus IV refounded the
  Tigris-mouth city as Antiochia about 166-165 and made Hyspaosines satrap of the Erythraean Sea. Alexander's
  older Alexandria there was destroyed by floods in the mid-3rd century (Wikipedia, Characene), so whether
  anyone lived on the site in 270 is open. It is a small port in `seleucidCities`, sized 8, to mark the Gulf
  head; Spasinou Charax is not used.
- **Seleucid cities.** Sizes are ranked guesses against Antioch 75, Ecbatana 70 and Susa 60. Seleucia is 85
  (population growing by transfers from Babylon; the 600,000 figure of Pliny is a later century). Babylon 60
  with walls; Uruk, Borsippa, Nippur are temple cities under Babylonian priests. Ashur and Nineveh were small
  after the fall of Assyria and only villages or minor towns in the Hellenistic period, so they get 6 and 8.
  Arbela is the one real Assyrian town (citadel, Gaugamela-road town). Kirkuk as `Karka de Beth Selok` rests
  on the Syriac tradition and is a guess for 270. Nisibis (Antioch in Mygdonia) is a Seleucid refoundation of
  an old city; Edessa and Carrhae lie in Turkey and Syria, outside this file. Dura-Europos is in the Iran file.
  Gaugamela (Alexander's battle of 331) has no settlement worth showing; it is somewhere near Nineveh/Arbela.
- **Apamea.** Pliny puts an Apamea in Mesene where a Tigris channel splits, named for the wife of Seleucus.
  Its site is not settled; it is put on the Tigris near Kut, low confidence.
- **Arab tribes.** The record has Xenophon's Arabs on the Euphrates and Strabo's Scenitae, tent-dwellers on
  both banks. Tribal names commonly used for this area (Tayy, Kalb, Bakr) are later or from Islamic tradition
  and are not used, and Rhambaei (in the brief) is a Gedrosian village-name in Arrian, not an Arab tribe. Hira is
  3rd-century CE. The polity is a placeholder in the class of `hejaz-tribes`; it takes the Wadi Hauran, the
  Hamad, the desert west of Najaf and the mainland coast of Kuwait. The lead may fold it into `qedar` or the
  Seleucid default. Its named places are oases and wells, not attested towns.
- **Marsh peoples.** Chaldean and Aramean tribes (Bit-Yakin, Gambulu) in the marshes are Neo-Assyrian and
  Neo-Babylonian evidence; Strabo speaks of marshes and Chaldaeans in the south. Nothing dates a ruler or a
  seat to 270, so the polity is a placeholder and every place is a marsh landing. It may be dropped without loss.
- **Kuwait.** Mainland Kuwait is in the Arab ring. The Seleucid presence there is Failaka (Ikaros), already a
  ring in the Iran file, and the Seleucid Antioch in Persis on the Iranian shore. Gerrha's ring stops at lat 28.
- **Elymais, Zagros, Dahae.** Elymais has no king before about 147 and stays Seleucid; hill peoples
  (Cossaeans, Uxians) have no polity in the record. The Dahae are far east (Dahistan) and do not reach Iraq.
- **Edges.** North edge at lat 37.1-37.25 is the Armenian ring; the east edge follows the Zagros Seleucid ring
  of the Iran file and stops short of Atropatene. West edge follows the Euphrates' west bank. The Anatolian
  Seleucid ring already runs to lon 46 in the north (same id, no clash).

## Cohesion

Arabs and marsh peoples 2200 (ligurians, hejaz-tribes, najd-tribes); qedar has 2800. The Seleucid value stays
5500 (Anatolian file).

## Sources

- Characene: https://en.wikipedia.org/wiki/Characene (founded 141; Alexandria destroyed by floods; refounded as Antiochia c. 166-165)
- Antiochus I: https://en.wikipedia.org/wiki/Antiochus_I_Soter (Seleucus as viceroy c. 275-268/7; Ezida, 268; Antiochus Cylinder)
- Recalled, not re-read: Strabo 16.1 (Babylonia, marshes, Chaldaeans; 16.1.27 Scenitae), Pliny 6.117-139 (Seleucia, Apamea, Alexandria on the Tigris), Xenophon Anabasis 1.5, Polybius 5.51 (Antioch in Mygdonia), Arrian Anabasis 6.21 (Rhambacia).

Coordinates are from memory, good to about 0.05-0.1 degree; sizes and fortification levels are ranked guesses on the scale used in the existing scenario.
