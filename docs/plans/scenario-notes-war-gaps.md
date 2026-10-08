# Scenario notes, war gaps

Scenario DATA changed in the war-gaps batch, so a version bump is needed (the lead bumps once, at the end; `built-in-versions.ts` and the scenario pin were not touched here).

Intended version note, in the age's words:

> **The war the age dates.** The war with Carthage has something to start from. Hiero II of Syracuse beats the Mamertines at the river Longanus and shuts them up in Messana
> (about 265 BCE; the year is medium confidence, the battle itself high: Polybius 1.9); the Mamertines write to Rome and to Carthage for a protector (264; Polybius 1.10-11);
> and a Carthaginian garrison of fifteen hundred goes into the citadel of Messana at the call of one party of them (264; Polybius 1.11, Diodorus 23.1; the number is a guess).
> Nothing opens a war between Rome and Carthage: Rome's lean toward it is stronger once Carthage is in the strait, and what the Senate and the people make of it is their own business.

What changed, and where:

| Change | File | Hook |
| --- | --- | --- |
| Four pressures: `hiero-beats-the-mamertines` (day 1,995), `messana-asks-rome-and-carthage` (day 2,130), `a-carthaginian-garrison-enters-messana` (day 2,150), each with `happens` (done by the rules once, on or after its day), and `carthage-in-the-strait` (the age's lean of Rome toward Carthage: weight 12, only while Carthage has men in Messana's province and the two are at peace) | `packages/db/src/punic-wars-mamertines.ts` | `punic-wars-scenario.ts`, `historicalPressures`, after `...WORLD_PRESSURES`, reads `...MAMERTINE_DATES` |

What else the version carries, though it is engine and not data (a pinned scenario saved before it keeps its old rules as the engine reads them): the schema of a pressure has an
optional `happens` (`shared/src/world/scenario.ts`), which the rules read (`sim/src/a-dated-war.ts`) and the narrator does not offer (`narrator.ts`, `livePressures`); the armies are
shared among two wars by what each has at stake; a war plan's aim of peace is an asking and the peace is priced from what the war was for; a careful strategist shadows a stronger
army and the engine cuts the foragers and convoys of an army so shadowed (`docs/plans/war-plans.md`, "War gaps closed").

A game saved before the bump has none of the four pressures and keeps its old rules for the rest: the Mamertine war and the garrison come only where the scenario that began it carries them.

Dates, from the opening (day 0, the late winter of 270 BCE): 265 BCE, summer, is about day 1,995; the early months of 264 about day 2,130 to 2,150.
