# Scenario notes, offices and data gaps

Scenario DATA changed here, so a version bump is needed (the lead bumps once, at the end; `built-in-versions.ts` and the scenario pin were not touched).

Intended version note, in the age's words:

> **A chest for every state.** Every power with a king, a council or a league now keeps a treasury and a standing tax of its own, as Rome and Carthage did: Egypt's takes in
> about four thousand talents of silver a year (Jerome gives the king fourteen thousand and eight hundred, a late figure that counts the corn; the order is what the sources
> bear). The tribal peoples keep none, as their custom had no standing tax. **A seat says its chamber**: the senators sit in the Senate, the elders in the Council, the judges in
> the Hundred and Four, and a military tribune in none, being an officer of his legion. Carthage has no parties at 270: the evidence is thin, and the data now has a place for a
> later opening to write them.

What changed, and where:

| Change | File | Hook |
| --- | --- | --- |
| A treasury, a standing tax (`<power>-standing-tax`, two in the hundred of what the power's provinces could bear in a month, between 500 and 2,400,000 a month; Egypt's 2,100,000 by hand), four months of it as the opening balance and an upkeep of four fifths, for every state that had no chest (about fifty powers) | `packages/db/src/punic-wars-treasuries.ts` | `withRegionalTaxes` in `punic-wars-taxes.ts` (built on the finished map, before the merchant houses) |
| `chamberId` on the authored membership offices (`roman-senator` to `roman-senate`; `carthaginian-elder` to `carthaginian-council`; `carthaginian-judge` to `carthaginian-hundred-and-four`; `syracusan-friend`, `mamertine-councillor`, `campanian-councillor`; `roman-military-tribune` null: no chamber) | `packages/db/src/punic-wars-seats.ts` | the `office()` helper in `punic-wars-scenario.ts` (`seatChamberField`) |
| `AuthoredFaction`, `AUTHORED_FACTIONS_270` (empty), `withAuthoredFactions` | `packages/db/src/punic-wars-factions.ts` | `withRegionalTaxes`; a later opening writes its list |

What else the version carries, though it is engine and not data: the offices a constitution's template makes carry `chamberId` (`seatChamberKey` in `constitutions.ts`), a house has `tutorCharacterId`, a chamber `recentVotes` (all optional, so a save made before reads as it did). The scenario's unseated template offices (`<power>-councillor`) are not given a chamber, as they are not seated; the generated constitution's own are.
