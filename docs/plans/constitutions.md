# Constitutions, organic groups, and changing a government

Settled with the user on 2026-09-26. Only Rome had chambers; every other
power's questions could not be put to a vote, a hereditary throne was never
refilled when its king died, and a government could not change its form.

## Decisions

- A polity's constitution is stored **as parts**: its chambers and what each
  may decide, its offices and how they are filled, and who sits in each
  chamber (the franchise). The form word (`monarchy`, `league`...) only seeds
  the parts, and is read back from them.
- **Major powers are historical** (Carthage, Syracuse, the Mamertines, the
  Campanians of Rhegium) and hand-written in the scenario. **Minor powers get
  seeded variety** from their form's template. **Rome stays hand-written.**
- Blocs lean **per question**: a bloc has interests, a question has concerns,
  and a table in code says how the one meets the other.
- A monarchy has an **advisory council that can disagree**. Its vote does not
  bind; a ruler who acts against it pays in legitimacy.
- **Organic groups** appear from world data past a threshold, carry weight in
  chambers and pressure on people, and dissolve below a lower one.
- **Constitutional change, option C**: the engine raises openings when the
  world is ripe; a motivated character may try without one at a higher price;
  the engine decides every outcome.

## Parts

- `Polity.governmentForm`: the seed. Null infers from cohesion.
- `GovernmentInstitution`: `powers` (laws, war, taxes, elections,
  constitution, judgment), `advisory`, `franchise` (council, citizens,
  soldiers, chiefs, cities, priests), `blocSource` (authored or world),
  `refersFailuresTo` (Carthage's council sending a split to the people).
- `VotingBloc.interests`, `VotingBloc.groupId`.
- `PoliticalProcedure.concerns`: derived by the engine from what it enacts,
  plus any the model names.
- `world.constitutions`: one record per polity -- the form read back, where
  it came from, and its history of changes.
- `world.successionRules`: rules the world made, merged with the scenario's
  as offices are (`allSuccessionRules`).

## Groups

Factions around a man, clienteles, the deposed's party, debtors, veterans,
merchants, conquered peoples, generals whose armies are their own, offices
made by need (and lapsing), custom from precedent, cults. All share one loop
(`sim/society.ts`): measure, appear, weigh, dissolve.

## Change

- **By law**: `enacts.constitution` on a procedure -- a whole new form, a
  chamber added, reformed or abolished, a succession changed. Put before the
  chamber with constitutional power, or decreed by a ruler where none has it.
- **By force**: `regime_change`, route `coup`, `revolution`, `imposition` or
  `restoration`. Hard prerequisites; the outcome rolled by code from armed
  force, the army's loyalty, the state's legitimacy and the plotters' standing.
  A failed attempt has consequences.
- **By extinction**: a hereditary throne passes to the heir; with no heir, the
  engine opens the question and, if nobody answers, the council takes over.
- On any change: abolished offices vacate ("abolished"), open questions before
  abolished chambers lapse, treaties and debts stand, new chambers start with
  low legitimacy and earn it, and the losers become the deposed's party.
