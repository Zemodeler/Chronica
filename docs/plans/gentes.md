# Gentes: the noble families of 270 BCE

The question: do Roman houses exist, actual noble families as they had historically? Before this work they did
not. What existed was a number (`Character.dynastyId`, always null at the opening), an order read off the
name (`ordo.ts`'s list of twenty nomina), eleven seeded households that were a man and his wife and children
with no name of their own, and the word "house" meaning two things (a noble family, and a trading firm:
`MerchantHouse`). This plan makes the family a thing in the world: a *gens* (Rome) or a house (Carthage, the
kings), with a name, branches, a head, honours, rites, feuds and marriages, and with consequences in
elections, marriage, the Senate, inheritance and adoption.

**Words.** In code and in everything the player or a model reads: *gens*, *gentes*, *stirps* (a branch, named
by its cognomen), *nobilitas*, *novus homo*, *imagines*, *sacra*, *princeps gentis*. "The house of ..." is used
only for a noble family or a royal house. A trading firm is a "firm" or "company" in new text (the code's
`MerchantHouse` keeps its name).

## S1. Sources and confidence

| What | Source | Confidence |
|---|---|---|
| Consuls 366 to 270 BCE | https://en.wikipedia.org/wiki/List_of_Roman_consuls (the table follows Broughton's *Magistrates of the Roman Republic* and the Fasti Capitolini; cross-check https://en.wikipedia.org/wiki/Fasti_Capitolini). The four "dictator years" 333, 324, 309, 301 are left out, as modern editors do. Where Wikipedia's text left a name incomplete (328, 351, 286) the Livy/Broughton reading is used. | High for 300 to 270; medium before 300 (the early lists are annalistic and some cognomina are doubtful) |
| Censors 300 to 265 | https://en.wikipedia.org/wiki/List_of_censors_of_the_Roman_Republic (Broughton). 289 and 283 carry the doubt the table notes. | Medium to high |
| Patrician and plebeian gentes, their branches (stirpes) | https://en.wikipedia.org/wiki/List_of_Roman_gentes and the article for each gens; Broughton's Index | High for the order of a gens; medium for which branch a given man belonged to |
| Plebeian consulship, priesthoods open to the plebs | Lex Licinia Sextia 367, lex Ogulnia 300 (Livy 10.6-9); one consul and one censor a year/lustrum plebeian from 342 | High |
| Adoption, adrogatio, the curiate law | Gaius, *Institutes* 1.97-107; Gellius 5.19 (the pontifices inquire; the adopter must be older than the adoptee by the age of puberty and past having children of his own) | High on the form; the 270 practice is inferred from later examples |
| Naming (praenomen, nomen, cognomen, filiation, women named by the nomen, "Maior/Minor") | Salway, "What's in a Name?" JRS 84 (1994); https://en.wikipedia.org/wiki/Roman_naming_conventions | High |
| Imagines, funeral rites, ius imaginum | Polybius 6.53; Pliny, *NH* 35.6-8 | High (the right belonged to those whose ancestors held a curule office) |
| Nobilitas | Gelzer, *The Roman Nobility*; Hopkins and Burton, "Ambition and Withdrawal"; the term proper is later (Livy and Cicero use it for the third and second centuries) | The concept is sound for 270; the statistics are of the later Republic and are only a guide |
| Hereditary sacra | Cicero, *De Legibus* 2.46-53 (sacra private, the heir carries them); Cato in Gellius; the rex sacrorum and the flamines were patrician by law | High |
| Carthage's Barcids, Magonids, Hannonids | https://en.wikipedia.org/wiki/Barcid ; https://en.wikipedia.org/wiki/Magonids (ruled c. 550 to 340, ended by a failed coup); Hanno the Great (4th c.) and the 3rd-century Hanno of the landed party (Polybius, Appian). Hamilcar Barca b. c. 275. The sources do not name his father. | The Barcid name and Hamilcar high; the head of the house in 270 is invented; the Magonid and Hannonid lines in 270 are a reconstruction, low |
| Hiero II's house | https://en.wikipedia.org/wiki/Hiero_II_of_Syracuse : an illegitimate son of the noble Hierocles who claimed descent from Gelon, b. c. 308; married Philistis daughter of Leptines (Polybius 1.9); children Gelon II (co-ruler to 216), Damarata, Heraclea; Hieronymus is a grandson. | High on the family; no child is known to be born by 270, so none is seeded |
| Ptolemies | https://en.wikipedia.org/wiki/Ptolemy_II_Philadelphus , https://en.wikipedia.org/wiki/Arsinoe_II_of_Egypt : Arsinoe II married her brother c. 276-273 and died in July 270 or 268; the future Ptolemy III b. c. 284 son of Arsinoe I; Magas of Cyrene was Ptolemy's half-brother by their mother | Medium (Arsinoe's death date is disputed) |
| Antigonids | https://en.wikipedia.org/wiki/Antigonus_II_Gonatas : Antigonus m. Phila, daughter of Seleucus I, c. 276; their son Demetrius II b. c. 275 | Medium |
| Seleucids | https://en.wikipedia.org/wiki/Antiochus_I_Soter : m. Stratonice; Antiochus II b. c. 287; an elder son Seleucus was co-regent and was executed c. 267-266 | Medium for Antiochus II; low for Seleucus (not seeded) |

The seed list below marks each person **H** (the sources name him and the age is within a few years), **M**
(named, age or kinship inferred), **L** (invented or very doubtful). Invented kinswomen and sons are marked
in their `creationReason` as the sources do not name them.

### What the opening does not do

* Publius Cornelius Scipio Africanus is **not** seeded (b. 236); nor Hannibal (b. 247), Marcus Claudius Marcellus
  (b. 268), Cato (b. 234), Aemilius Paullus (b. c. 229), Gelon II (b. c. 266), Hieronymus (b. c. 231), Ptolemy IV,
  Antiochus III. Of the Scipiones only Barbatus, his son Lucius (cos. 259) and Gnaeus Scipio Asina (cos. 260)
  live in 270; the Africanus line grows from Lucius's house by births in play.
* Appius Claudius Caecus is not alive in 270 (his death is put c. 273 by some, and the sources are silent); his sons
  Appius Claudius Russus and Publius Claudius Pulcher are, and the scenario already has Russus and "Claudia".
* No Scipio Barbatus epitaph, no Fabian "Cunctator" legend: Quintus Fabius Maximus Verrucosus is a boy of ten.

## Design

`world.gentes` is a list of records; `Character.dynastyId` is the id of the gens (and is real: set at the
opening, copied at birth, rewritten by adoption). `Character.praenomen/nomen/cognomen` are optional fields;
the ordo of a Roman is read from the gens record first, then the nomen, and the old name-list stays only as
the last fallback.

* **Gens**: `id` (`gens-cornelia`), `kind` (`noble` | `royal`), `nomen`, `plural` ("the Cornelii"), `polityId`,
  `ordo`, `stirpes` (cognomen, the branch), `honours` (every consulship, censorship and dictatorship the gens
  has held, with the man's name, his branch and the year), `imagines`, `sacra` (named hereditary rites),
  `tomb`, `feuds`, `alliances`, `princepsId`, `dignitasBps`, `keptAtStep`.
* **Nobilitas.** A man is a *nobilis* if his own branch has a consul among its forefathers or he is one himself
  (the count of consulships in his stirps), a lesser noble if only another branch of his gens has, and a
  *novus homo* if nobody of his gens ever sat in the curule chair. The count feeds the electors' reckoning of a man
  (`candidateScore`), the dowries and the willingness to marry, the size of his clientela, and his gens's dignitas.
* **Dignitas** of a gens: its first man's standing, a quarter of every other living member's, and a
  hundred and fifty points for each consulship, capped at the scale.
* **Alliances** are the marriages between gentes (the pair, the day, a strength that fades and is renewed by the next
  match), **feuds** are inherited grudges (made from the relations of the living; they outlast those who made them).
* **Loyalty.** Each gens has one group of the *household* kind and every member a membership in it, with a loyalty;
  in a division the seats of one gens lean together, the princeps counting double, and a feud turns a
  seat against a motion sponsored by the other side, both bounded.
* **Adoption** (`sim/adoption.ts`, one helper; the merchant firms' succession uses the same family, social and contract
  links): the adoptee takes the adopter's praenomen, nomen and cognomen and keeps his old nomen as an *-ianus*
  cognomen (Publius Cornelius Scipio Aemilianus); he enters the gens, its sacra and its imagines, and inherits.
  A patrician gens took only a patrician until v58, and now may take a plebeian, who becomes a patrician by it (below);
  the adopter must be a grown man, at least eighteen years older, with no living son (adrogatio), and a
  patrician adoption needs a living pontifex maximus to inquire.
* **Sacra and priesthoods**: the rex sacrorum, the flamines and the Salii are patrician by birth; the pontiffs and augurs
  are open to both orders since 300 with reserved places. Where a gens keeps sacra gentilicia, the head (princeps)
  carries them and the rites pass with the estate; a gens without a living man loses them.

## Roster (S3; as built is at the foot)

The existing characters are linked to gentes (dynastyId set) and the missing prominent living members are
added. Ages are for 270. "cons." is the consulship's year (BCE). Existing characters keep their ages.

| Gens | Stirps | Person | Age | Order | Honours by 270 / later | Conf |
|---|---|---|---|---|---|---|
| Cornelia | Blasio | Gnaeus Cornelius Blasio (existing) | 42 | pat. | cos. 270, 257; cens. 265 | H |
| Cornelia | Arvina | Publius Cornelius Arvina (existing) | 58 | pat. | cos. 306, 288; cens. 294 | H (age is the scenario's) |
| Cornelia | Rufinus | Publius Cornelius Rufinus | 66 | pat. | cos. 290, 277; expelled from the Senate 275 | M |
| Cornelia | Lentulus | Lucius Cornelius Lentulus Caudinus | 55 | pat. | cos. 275 | M |
| Cornelia | Merenda | Servius Cornelius Merenda | 50 | pat. | cos. 274 | M |
| Cornelia | Dolabella | Publius Cornelius Dolabella | 60 | pat. | cos. 283 | M |
| Cornelia | Scipio | Lucius Cornelius Scipio Barbatus | 67 | pat. | cos. 298; cens. 280 | M (alive in 270 by the lack of any report of his death) |
| Cornelia | Scipio | Lucius Cornelius Scipio, his son | 38 | pat. | cos. 259; cens. 258 | M |
| Cornelia | Scipio Asina | Gnaeus Cornelius Scipio Asina | 33 | pat. | cos. 260, 254 | M |
| Fabia | Maximus Gurges | Quintus Fabius Maximus Gurges (existing) | 50 | pat. | cos. 292, 276, 265 | H |
| Fabia | Maximus | Quintus Fabius Maximus Verrucosus | 10 | pat. | cos. 233 and after (born later in his career) | M |
| Fabia | Pictor | Gaius, Numerius Fabius Pictor (existing) and the historian | 41, 30, 1 | pat. | cos. 269, 266 | H |
| Fabia | Licinus | Gaius Fabius Licinus | 50 | pat. | cos. 273 | M |
| Valeria | Laevinus | Publius Valerius Laevinus (existing) | 52 | pat. | cos. 280 | H |
| Valeria | Maximus Messalla | Manius Valerius Maximus Messalla (existing, named Marcus there) | 44 | pat. | cos. 263 | H |
| Valeria | Flaccus | Lucius Valerius Flaccus | 35 | pat. | cos. 261 | M |
| Claudia | Canina | Gaius Claudius Canina (existing) | 50 | pat. (the old list made him plebeian: wrong) | cos. 285, 273 | H |
| Claudia | Pulcher (Caecus's sons) | Appius Claudius Russus (existing), Appius Claudius Caudex, Publius Claudius Pulcher | 39, 35, 20 | pat. | cos. 268, 264, 249 | M, L for Caudex's and Pulcher's kinship |
| Aemilia | Papus | Quintus Aemilius Papus (existing), his son Lucius | 62, 24 | pat. | cos. 282, 278; cens. 275 | H |
| Aemilia | Barbula | Lucius Aemilius Barbula (existing) | 53 | pat. | cos. 281; cens. 269 | H |
| Aemilia | Lepidus | Marcus Aemilius Lepidus | 55 | pat. | cos. 285 | M |
| Manlia | Vulso | Lucius Manlius Vulso Longus | 35 | pat. | cos. 256, 250 | M |
| Manlia | Torquatus | Titus Manlius Torquatus | 25 | pat. | cos. 235, 224 | L (age) |
| Postumia | Megellus | Lucius Postumius Megellus (existing) | 64 | pat. | cos. 305, 294, 291, 262 | H |
| Papiria | Cursor | Lucius Papirius Cursor (existing) | 52 | pat. | cos. 272 | H |
| Sulpicia | Paterculus | Gaius Sulpicius Paterculus | 30 | pat. | cos. 258 | M |
| Quinctia | Claudus | Gaius Quinctius Claudus | 50 | pat. | cos. 271 | M |
| Servilia | Tucca | Gaius Servilius Tucca | 55 | pat. | cos. 284 | M |
| Nautia | Rutilus | Gaius Nautius Rutilus | 62 | pat. | cos. 287 | M |
| Julia | Libo | Lucius Julius Libo (existing) | 31 | pat. | cos. 267 | H |
| Caecilia | Metellus | Lucius Caecilius Metellus | 20 | pleb. | cos. 251, 247 (his father Denter fell at Arretium, cos. 284); the gens's first consul is 284 | M |
| Genucia | Clepsina | Gaius Genucius Clepsina, Lucius Genucius Clepsina (existing) | 45, 50 | pleb. | cos. 276, 270; 271 | H |
| Decia | Mus | Publius Decius Mus (existing) | 48 | pleb. | cos. 279 (the gens: 340, 312, 308, 297, 295, 279) | H |
| Fulvia | Flaccus | Marcus Fulvius Flaccus (existing) | 37 | pleb. | cos. 264 | H |
| Atilia | Regulus | Marcus Atilius Regulus (existing) | 32 | pleb. | cos. 267, 256 | H |
| Sempronia | Sophus | Publius Sempronius Sophus (existing) | 41 | pleb. | cos. 268 | H |
| Marcia | Rutilus / Philippus | Gaius Marcius Rutilus, Quintus Marcius Philippus (existing) | 50, 50 | pleb. | cos. 281; cens. 269 | M (the scenario gives Rutilus fifty) |
| Junia | Brutus / Pera | Decimus Junius Pera (existing), Gaius Junius Bubulcus Brutus | 31, 55 | pleb. | cos. 266; 291/277 | M |
| Curia | Dentatus | Manius Curius Dentatus (existing) | 60 | pleb. | cos. 290, 275, 274; cens. 272; novus homo | H |
| Fabricia | Luscinus | Gaius Fabricius Luscinus (existing) | 58 | pleb. | cos. 282, 278; cens. 275; novus homo | H |
| Coruncania | | Tiberius Coruncanius (existing) | 50 | pleb. | cos. 280; first plebeian pontifex maximus (in the scenario at the opening) | H |
| Mamilia | Vitulus | Lucius Mamilius Vitulus (existing), Quintus Mamilius Vitulus | 33, 33 | pleb. | cos. 265, 262 | M |
| Otacilia | Crassus | Manius, Titus Otacilius Crassus (existing) | 38, 29 | pleb. | cos. 263, 261 | H |
| Aquillia | Florus | Gaius Aquillius Florus | 30 | pleb. | cos. 259 | M |
| Ogulnia | Gallus | Quintus Ogulnius Gallus (existing) | 47 | pleb. | cos. 269 | H |
| Others | | the remaining existing Romans (Duilius, Livius, Lutatius, Aurelius Cotta, Carvilius, Caedicius, Fundanius...) | | | | by name |

Carthage and the kings (all `Gens` with the same structure; no order):

| House | Kind | Head and members | Notes | Conf |
|---|---|---|---|---|
| Barcids | noble | Hannibal the Barcid (existing, invented head), Hamilcar Barca (age 5), Imilce, Arisha | Name "the lightning": Hamilcar b. c. 275 | H name, L head |
| Hannonids | noble | Hanno of Carthage (existing), Arishat, Batbaal, Bomilcar son of Hanno | the landed, African party of the 3rd century | M |
| Gisgonids | noble | Hannibal Gisco (existing), Elishat, Sophonba; the "son of Gisco" men | Hannibal son of Gisco commanded at Agrigentum 262 | M |
| Magonids | noble | Mago the Elder (existing) | the old ruling line (c. 550-340) fallen to a family of the Council | L |
| Hieronids | royal | Hieron II, Philistis | Claims the Deinomenid line of Gelon; children are born after 270 | H |
| Leptinids | noble | Leptines of Syracuse | Hiero's father-in-law | H |
| Ptolemies (Lagids) | royal | Ptolemy II (existing), Arsinoe II, the heir Ptolemy (III), Magas of Cyrene (existing) | | M |
| Antigonids | royal | Antigonus Gonatas (existing), Phila, Demetrius (II), heir | | M |
| Seleucids | royal | Antiochus I (existing), Stratonice, Antiochus (II) | the co-regent Seleucus is not seeded | M |

## As built

### Engine (S2)

* **The record**: `world.gentes` (`shared/src/world/gentes.ts`), `Character.dynastyId` is now the gens id (`gens-cornelius`; the
  merchant firms keep `house-...` ids, so the two never meet), with optional `praenomen`, `nomen` and `cognomen` on the character
  (`characters/roman-names.ts` parses a name written as one string, and reads a woman's nomen back to her father's gens).
  The order is read from the gens first, then the nomen; the old list is the last fallback and no longer calls the Claudii Caninae
  or the Scipiones Asinae plebeian.
* **The monthly pass** (`sim/gentes.ts`, called from the tick beside the merchant firms; a call inside a month returns the same world):
  gives every Roman a gens (making one for a nomen nobody has borne), adds the curule honours its men have won since the last look,
  names the head (most honours, then standing, then age) and recomputes imagines and dignitas, passes the sacra to the heir of the dead
  keeper if he is of the gens and else to the head (never to a stranger; a gens with no man keeps them waiting), feeds feuds from the
  worst opinion a living man holds of a man of another gens and cools every feud 25 points a month (a feud begun at 1,800 to 2,200
  lasts a generation untouched), and fades alliances 20 points a month.
* **Nobilitas** (`nobilitasOf`, `nobilitasBps`, `nobilitasWeightBps`): a man is a *nobilis* if others of his own branch sat in the
  consul's chair (+400 a consulship to +1,600), *gentilis* if only his gens did (+250 and +100 a consulship, to +1,000), a *novus homo*
  if nobody did (-600), and each adds a fifth of a twentieth of the gens's dignitas (to +500). The sum is weighed by the office: the
  consulship and censorship in full, the praetorship seven tenths, the aedileship four, the quaestorship a quarter, a priesthood
  a third and a half, the tribunate a tenth. It is added to the electors' reckoning in `candidateScore` and so decides who is
  thought of and who wins. It also gives a man's word in the Senate a client or two (`clientsFromName`: a thousand points, one man).
* **Marriage** (`marriage.ts`): a grudge between the families counts against the suitor (up to 40), an old marriage for him (up to 15),
  the difference in dignitas up to 8 either way; an accepted match records an alliance on both gentes (strength 4,500 on a first match,
  renewed by a second to 7,000 and so on) and the news says which two are bound.
* **The Senate** (`gens-loyalty.ts`, used by `ballotsOfBloc`): the seats of one gens in one bloc are drawn a quarter of the way to
  their mean, the head counting double, and a seat of a gens at feud with the mover leans against his motion by a 800th of the heat, at
  most twelve points of a hundred. No political group is made for a gens (it would put eighty household groups into the model's slice,
  the state's own view and the orders' "faction against"); the loyalty is read from `dynastyId` and the head.
* **Adoption** (`sim/adoption.ts`): `adoptIntoGens` and `adoptionBar` with the rules above, the Roman name (`adoptedRomanName`: the
  adopter's praenomen, nomen and cognomen and the old nomen as -ianus), the family graph, the social link and the contract of adoption
  that the merchant firms' succession writes, and the heir named so `settleEstate` carries the estate. The firms' own adoption
  (`house-succession.ts`) keeps its private helper and its own naming (a steward or freedman takes the head's names), which is the
  freedman's custom and not the -ianus of a true adoptee; the two write the same links. A childless head of a gens of forty-five and
  more looks once a year (a one-in-eight chance) for a young kinsman by marriage of his own order, and failing that names a young
  man of his own gens his heir. The act of adopting is built since v58 (below).
* **Births**: a child is of the father's gens and order and bears the parts of the name; the eldest son has the father's names ("the
  Younger"), a younger son the next given name of the gens's own, a daughter her father's nomen in the feminine ("Cornelia",
  "Cornelia Minor") with her father's name for a surname so two girls are not confused.
* **The old rites**: `priestlyBar` refuses a plebeian any office whose id or label names the king of the rites, a flamen or the Salii,
  in `admissionRefusal`, whatever else the office asks, so an office the world makes (or a later scenario writes) is covered.
* **Model-facing**: one phrase in a man's STANDING line and in the PEOPLE list ("of the Cornelii, a noble", "of the Curii, a new man").

### The seed (S3)

* `db/src/punic-wars-fasti.ts`: the consuls 366 to 270 and the censors 300 to 265. `db/src/punic-wars-gentes.ts`: the tables and
  `seatGentes`, hooked in once at the end of `withFoundingPeople`. Scenario v56.
* Sixty gentes at the opening: the 55 Roman (every gens that had a consul since 366 or has a man alive in the roster; the nine
  merchant-firm Romans take theirs at the first tick) and the nine foreign houses. Each Roman is of his gens; the 12 Cornelii, 9 Fabii,
  7 Aemilii, 6 Claudii, 4 Valerii and the rest are the living members.
* 38 characters added: 32 Romans (the consulars Rufinus, Lentulus Caudinus, Merenda, Dolabella, Barbatus, Aemilius Lepidus, Servilius Tucca, Nautius Rutilus,
  Domitius Calvinus, Aelius Paetus, Caedicius Noctua, Sulpicius Saverrio, Papirius Praetextatus, Quinctius Claudus, Fabius Licinus,
  the young men of 261 to 244 and the boy Fabius Verrucosus, with two women) and 6 of the kings' houses. Each carries "Historical
  (H|M)" or "Invented or doubtful (L)" in its creation reason. They hold no office and are not in the model's cast.
* Opening ties: every marriage in the world is an alliance between two gentes (at 6,000, with a date years back); two feuds the sources
  attest (the Fabii against the Claudii over the freedmen's enrolment of 304; Rufinus's against Fabricius, who struck him off the roll in
  275).
* The player's view: "Your gens" on the standing sheet (`GensSheet`, from `readYourGens`): the name and branch, noble, of a noble
  gens or a new man, its weight, the images, the first man, the rites and tomb, the kin, the friends by marriage, the feuds and the latest
  honours.

### What is not built, and what wants deciding

* **The act of adopting** is built (v58, below). The merchant firms' own adoption keeps its private helper and naming; the two write the same links and could be joined.
* **Priestly offices of the old rites** are in the scenario since v58 (below).
* **Letters**: a feud is heard in them since v58 (below); an alliance is still in votes, marriage and the player's sheet only.
* **The Hannonid, Gisgonid and Magonid houses** are reconstructions (confidence L to M); the plan lists them so they can be replaced.
* **Ages**: corrected in v58 (below); the nobilitas counts follow the fasti, as before.

## As built, v58 (the adoption act, the old priesthoods, feuds in letters, old ages)

* **Adoption is an act** (`adopt` delta, `shared/src/sim/deltas.ts`; `sim/src/adoption.ts`): a player or a model's NPC writes `adopterRef` and `adopteeRef`, and the engine judges the Roman rules: a free man adopts, grown, at least eighteen years the elder, with no son living; the adoptee a free man and willing (he does not hate the adopter: his feeling is not below -10), his father's leave if the father lives (adoptio), a pontiff alive to inquire if he is his own master (adrogatio); the name with the -ianus cognomen, the gens, the order, the sacra and the estate move as the yearly rule moves them, which is kept. **A patrician adopter may now take a plebeian, who is a patrician after it** (the one road from the plebs to the patriciate, and it goes before the curiae with the pontifices presiding: by rule a pontiff must be alive, the curiate law being the formality it was by then; Gellius 5.19, Cicero, *De domo* 34-38); a plebeian gens still does not take a patrician (Clodius went over to the plebs in 59 and it was a scandal). The act is a household's own business (`own-business.ts`), not a breach of anybody's authority; only the adopter or the adoptee may write it (the world may, for a house it is keeping). Tests: `a-man-adopts-an-heir.test.ts`. The prompt ceilings rose by 0.4k and 0.5k for it (dated in the tests).
* **The old priesthoods are in the scenario** (v58): the rex sacrorum and the flamines Dialis, Martialis and Quirinalis (`db/src/punic-wars-scenario.ts`, `punic-wars-rosters.ts`), each a patrician by birth (`req-patrician`, `priestlyBar`), held for life, chosen by the pontifex maximus (the pontifex maximus was already there, Tiberius Coruncanius), and in the college of the pontiffs' department, so the public rites are their only charge (`mayAct` gives them no act of the state). Their taboos are eligibility, in code (`priestlyTaboo`, `commandBar`, `shared/src/world/gentes.ts`): the flamen Dialis may hold no other office (Livy 27.8: a flamen refused the praetorship) and no command, since he might not see an army under arms (Gellius 10.15); the rex sacrorum may hold no magistracy (Livy 40.42). **The four men are invented** (L): the sources name no holder in 270; each carries "Invented" in his creation reason (Marcus Papirius Maso, rex; Publius Valerius Falto, Dialis, a Valerius because the first flamen Dialis the sources name, in 209, was a Valerius Flaccus; Servius Cornelius Cossus, Martialis; Quintus Sulpicius Camerinus, Quirinalis). Tests: `the-sacra-stay-in-the-gens.test.ts`.
* **Feuds in letters** (`sim/src/feuds-in-letters.ts`): where the gens of the man who writes and of the man who reads are at feud (heat of 800 or more), a letter is cooler, in words only and bounded: the answerer's liking for the writer falls by at most `FEUD_LIKING_SHIFT = 15` points (a few points either way is what liking moves a peace or a pact by, never an answer); the counsel the rules give him names the quarrel (`adviceOnALetter`), which he may let lie; the rules' own letter between the two is colder (`FEUD_COLDER_BY` of a point in its tone) and carries a line saying so; the model that words a letter for the player is told of it for the voice and not the substance. Test: `a-feud-outlives-the-feuders.test.ts`.
* **Old ages** (v58): a man is about forty-two in the year of his first consulship, so in 270 he is at least that year, in years before Christ, plus 42, less 270. Corrected: Quintus Fabius Maximus Gurges (consul 292) 66, not 50; Gaius Marcius Rutilus Censorinus (consul 310, censor 294 and 265) 84; Lucius Postumius Megellus (consul 305) 78; Publius Cornelius Arvina (consul 306) 78; Lucius Papirius Cursor and Spurius Carvilius Maximus (consuls 293) 66; Gaius Claudius Canina (consul 285) 58. Older men die sooner by the ordinary hazards (`mortality.ts`); nobody of the opening is more than 90. Test: `the-roster-is-historical.test.ts`.
