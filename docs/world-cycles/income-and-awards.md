# Income and awards

**Status: designed, not built.**

Where money comes from, and why the amounts are judged rather than computed.

## The position

A polity's revenue should depend on what it holds, how quiet that territory is, and what trade reaches it. A character's income should depend on their offices, their holdings, and what people give them. Both of those sentences describe judgments, not formulas — and the moment either becomes a formula, players optimise the formula instead of playing the world.

So the rule is: **the engine moves money and records why; it never decides how much.** [The fiscal runtime](fiscal-runtime.md) owns the ledger, the cadence, and the consequences of not paying. This document is about the layer above it, where the amounts are set.

That is not a shortcut around designing an economy. It is the same division the game already makes everywhere else. A battle's outcome is computed because casualties follow mechanically from forces and posture; whether a consul dies of his wounds is judged, because it does not. Province revenue is on the judged side of that line — a good harvest, a closed strait, a plague, a governor who steals, a war that emptied the countryside. There is no honest formula, and a dishonest one would be worse than none.

## What exists to build on

There is real deterministic material already, and it should be the *baseline the judgment starts from* rather than something judgment replaces.

`province-material.ts` derives population from settlement sizes, manpower as a fraction of population, and tax capacity per head, then scales a taxation draw by `stabilityBps` and charges stability in proportion to how hard the province is squeezed. `collect_emergency_taxation` already uses all of it, charges polity legitimacy for the privilege, and auto-opens an opposition motion when legitimacy falls far enough. That is a good model of the *cost* of taking money, and it exists.

What does not exist is anything that makes money arrive without someone reaching for it. `IncomeSource` is the schema for exactly that — a recurring yield with a cadence, a rate, and a target account — and it is inert.

## The design

### A baseline the tick can compute

For each polity, derive a per-period revenue baseline from what it actually controls: the tax capacity of its provinces, scaled by their stability, reduced by occupation and siege, plus any authored trade sources. This is deterministic and cheap, and it should be readable — an actor deciding whether to raise an army needs to know roughly what the treasury takes in.

The baseline is not the revenue. It is the number the judgment is anchored to, and the number a player can reason about.

### Judgment sets the actual figure

Each period, the acting AI may assess and adjust. Two new capabilities, both ordinary validated workflows subject to the usual authority checks:

**Assess revenue.** Set or revise an `IncomeSource`'s effective yield for the coming period, with a stated reason grounded in something real — a war in the province, a lost port, a bumper harvest, a governor's corruption. The engine records the figure, the cause, and who judged it; it does not check the arithmetic, because there is no arithmetic to check. What it does check is that the reason references real world state, the same way a Chronicle entry must cite a real fact.

**Award payment.** A one-off transfer with a cause: a triumph's donative, a bribe, a client's gift, a senate's grant for a campaign, a ransom. This is how a player gets paid — not by a salary line, but because someone with money decided they had earned it or needed buying. It is already almost expressible with `transfer_gold`; what it needs is the cause recorded well enough that the Chronicle can say why, and the authority check that stops a character awarding themselves the treasury.

Both write a `MoneyTransaction` with a real cause, and both produce a factual event, so the Chronicle can report that Rome's Sicilian revenue collapsed this season without anyone having authored that as a story beat.

### Bounds, not formulas

Judgment without limits is just the AI printing money. The constraints should be structural rather than numeric:

- **Provenance.** Money credited to an account must come from somewhere nameable — a province's yield, another account, an authored source. An award moves money between existing accounts; it does not create it. `add_gold` as it stands can conjure money from nothing with no source at all, and that is the hole to close.
- **Authority.** Setting a polity's revenue assessment or awarding from its treasury requires fiscal authority over that treasury, which the authority index already derives from office. A general cannot assess the province he is standing in unless his office says he may.
- **Anchoring.** An assessment far from the computed baseline should require a reason that cites current world state, and should be visible in the Chronicle when it moves materially. A revenue that halves is an event.
- **Cadence.** Assessments apply to the coming period, not retroactively. Money already collected is history.

## Where the player's money comes from

Explicitly: not a stipend. A player character's income is offices, holdings, their share of what they take, and what other people decide to give them. That means it is mostly *earned through play and awarded by judgment* — which is the intended shape, because it makes patronage, plunder, and political favour into the real economy of a career rather than flavour text over a fixed allowance.

It also means a player can be poor, and that being poor should be an interesting problem rather than a soft-lock. An army the player personally raised and can no longer pay is the sharpest version of this, and the fiscal runtime's arrears path is what makes it bite.

## Open questions

**How visible should the baseline be?** Too visible and it reads as a number to maximise; too hidden and the player cannot plan a campaign they can afford. Probably: the treasury's balance and recent income are plainly readable, the per-province derivation is not.

**Who assesses a polity nobody plays?** Most polities have no player and often no attentive NPC. Either the tick falls back to the computed baseline when no one assessed (simplest, and probably right), or distant polities get a cheap periodic assessment through the star-context path.

**Does an assessment persist or expire?** A yield set once and never revisited will drift from a world that has changed underneath it. Expiring assessments back to the baseline after some periods is one answer; making a stale assessment visible to actors as something needing attention is another, and fits the existing pressure machinery better.
