# Scenario notes, the coin under strain

Scenario DATA changed here (a little), so a version bump is needed (the lead bumps once, at the end; `built-in-versions.ts` and the scenario pin were not touched).

Intended version note, in the age's words:

> **Carthage's hired men are hired.** The two hosts Carthage pays in Africa and Sicily (the field force under Hanno, the army at Lilybaeum under Hasdrubal son of Hanno)
> are companies in the treasury's pay, on the pay each had: Carthage's armies were foreign hired men, Libyans, Numidians, Iberians and Balearic slingers, and the Greek and
> Italian garrisons of the Sicilian towns (Polybius 1.17, 1.67). What a hired company does when it is not paid, or paid in coin that has been struck lighter, is now theirs to do:
> wait two late wages in sound silver and fewer in worse, ask more of a coin that holds less, and, if the employer's own, take the road with its arms (the Mercenary War).

What changed, and where:

| Change | File | Hook |
| --- | --- | --- |
| A mercenary contract (`contract-<force>-hired`, employer `carthage-treasury`, the captain's company, the pay obligation each already had) for `carthaginian-garrison` (pay `carthage-mercenaries`) and `carthaginian-sicilian-army` (pay `carthage-sicilian-hired-men`, shared with the two Sicilian garrisons, who are not hired out as a company) | `packages/db/src/punic-wars-hired-hosts.ts` (`withHiredHosts`) | the outermost wrap of `initialWorld` in `punic-wars-scenario.ts` |

Nothing paid, held or owed changed: the contract only gives the existing pay the rules of a hired company. The wage a company asks follows the silver in the coin (`mercenary-pay.ts`),
and the engine now applies that index to an `army_upkeep` obligation that a mercenary contract pays (`tick.ts`), where it applied to a `salary` alone.

Not changed, and open: the fleet's crews (citizens and subjects, not hired), Rome's armies (citizen levy and allies), the Sicilian garrisons' own revolt (they share the army's pay, so they go unpaid
with it, but do not rise as a company). The sources give Carthage's treasury in 270 no figure; the opening chest (18.6 million) and income (1.5 million a month) are the scenario's own, and
no war the rules can fight in seven years draws them down, which is why the sanity run (`scripts/coin-sanity.mts`) has a `--lost-war` knob: it empties the chest and stops the dues, as the indemnity of 241 (3,200 talents) and the blockade did.
