# Scenario notes, playtest fix batch 2 (for the version bump)

Nothing here touches `packages/db/src/built-in-versions.ts` or the scenario pin: the lead bumps once at the end. The data changes are in one new file,
`packages/db/src/punic-wars-sicily.ts`, hooked in one place (`punic-wars-scenario.ts`, `withCarthageInSicily`, between `withWorldPolitics` and `formArmies`).

## Intended version note

> Carthage holds western Sicily in the opening: a strategos' army of 3,200 at Lilybaeum, garrisons of 900 at Panormus and 1,000 at Agrigentum, three officers, and a
> pay obligation of 52,000 a month for the hired men. The consular army is drawn at Polybius' strength: two legions and two alae, 17,720 men (it was one legion and one
> ala, 8,860), and the legionaries' pay is doubled with them. Rules and tests: the Senate's refused war on an appeal goes to the people, a hard-pressed people calls for help,
> a fleet is built by decree, the corvus is a way of war put to the Senate once Rome has ships.

## What was added, and how sure it is

| Datum | Value | Source | Confidence |
|---|---|---|---|
| Carthage holds Lilybaeum, Panormus and the west | already in the map (`settlement-lilybaeum`, `settlement-panormus` under Carthage) | Polybius 1.10, 1.17, 1.38; Diodorus 22.10 (Pyrrhus fails before Lilybaeum, 277); Plutarch, *Pyrrhus* 22-23 | high |
| A Carthaginian army in Sicily in peace | 3,200 hired men (1,300 Libyan foot, 300 horse, 200 Balearic slingers, 500 Iberians, 600 Campanians and Gauls) under a strategos at Lilybaeum | Carthage kept hired men in its Sicilian towns and a strategos over them; Polybius 1.17 names the garrison of Agrigentum in 262 and its leader, Hannibal son of Gisco; the numbers of 270 are not given | the presence: high; the strengths: low (a peace-time guess; 262's numbers are for a war army and inflated) |
| Garrison of Panormus | 900 | as above | low (strength) |
| Garrison of Agrigentum | 1,000 | Agrigentum is Carthage's in the map already; the sources have it independent under its tyrant until 262, when Carthage garrisoned it (Polybius 1.17-19). The garrison here is early, and is an open decision (below) | low |
| Officers | Hasdrubal son of Hanno (34, at Lilybaeum), Carthalo (41, Panormus), Bodmelqart (46, Agrigentum) | invented: the sources name no commanders before 264. Hasdrubal son of Hanno and a Carthalo are Carthaginian generals in Sicily in the 250s-240s (Polybius 1.38, 1.44) | invented; marked as such |
| Pay | `carthage-sicilian-hired-men`, 52,000 a month from `carthage-treasury` (the existing `carthage-mercenaries` is 38,000 for 3,500 men) | scaled from the opening's own rate | n/a |
| The consular army | 6,000 legionaries, 2,400 velites, 600 horse, 7,040 allied foot, 1,680 allied horse = 17,720 (authorised 19,200); `rome-legion-pay` 65,000 to 130,000 | Polybius 6.20-26: two legions of 4,200 foot and 300 horse to a consul, the allies' foot as many, their horse three times the Romans' | the structure: high; that Genucius had all of it before Rhegium in 270: medium. One army is in the field (the other consul keeps the city, the scenario's own note on Cornelius) |

The Carthaginian "field force" of 3,000 at Carthage is kept (it is the army that comes over, and is Hanno's); the fleet at Lilybaeum is kept.

## The corvus

Not in the opening's doctrines, on purpose: Rome had no fleet of its own in 270 and the corvus is of 260 (Polybius 1.22). `a-fleet-by-decree.ts` carries it as a way of war
(`THE_CORVUS`: boarding raised a band, speed of the ships lowered a band, for the kind `warship`), put to the Senate by a rule-led Rome once it has ships and the enemy has the sea. It is
adopted by the existing military-reform machinery (`carryOutMilitaryReform`), so it is priced and refitted over months like any other doctrine. Not scenario data; no bump needed for it.

## Open decisions

- Agrigentum's garrison in 270: the map gives the city to Carthage already; history has it independent until 262. Either the map changes (a separate edit) or the garrison is
  moved to Heraclea Minoa or Eryx when the map has them.
- Whether Rome's second consular army should stand in the Samnite country in 270 (the sources have a consul triumph over the Samnites, Lucanians and Bruttians in 272-270).
- The Mamertines' appeal and the Carthaginian garrison in Messana are not in the opening; they arise by rule (`the-appeal-goes-to-the-people.ts`) only if the Mamertines are pressed and ask.
