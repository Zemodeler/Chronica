# Fiscal runtime

**Status: designed, not built.**

Money that moves because time passed, rather than because someone spent it.

## What exists today

Money is real and already moves, but only when an action moves it. There is one currency per world (`MaterialWorldState.currency`, a single definition rather than a list, with every account's `currencyId` forced to match it in the state-level refinement). Balances are non-negative integers, so **debt cannot currently be represented at all** — `remove_gold` clamps to the available balance rather than going below zero.

An account is owned by exactly one character or polity, one account per owner, and reach is separate from ownership: `AccountAccess` grants a character `view` / `propose_spending` / `spend_without_vote` over an account, sourced from ownership, office, title, or law, and `Office.treasuryAccountId` is what turns an office into a fiscal `AuthorityGrant`.

The workflows that move money are `add_gold`, `remove_gold`, `transfer_gold`, plus `recruit_from_province` (which charges a hardcoded 2 per head) and `collect_emergency_taxation` (which draws against province tax capacity, costs stability in proportion to the bite, charges polity legitimacy, and can auto-open an opposition motion below a legitimacy threshold). Inheritance moves money on death, and project milestones spend against a reservation.

### What is missing

**No polity owns an account in either shipped scenario.** Every account is a character's personal purse, and every office sets `treasuryAccountId: null`. "The treasury" is, today, whatever the office-holder happens to be carrying. The UI already labels a polity-owned account "Royal treasury" — it has simply never had one to label.

**Nothing recurs.** `IncomeSource` has a `cadenceSteps` and a `nextDueStep`; no code anywhere compares that due step against the current one. The field's only reader is a UI label. `create_income_source` is a pure record that moves nothing, and hardcodes `collectionRateBps` to 10,000.

**Armies cost nothing.** `create_force` looks up its `payerAccountId` only to check that it exists — it never reads the balance and never debits. If the account resolves it creates an `army_pay` obligation of `max(1, floor(size * 2))` at a cadence of 4 and links it; if not, it sets `payObligationId: null` and raises the army anyway. Its own description claims it "requires a polity account". It does not.

**Nothing ever falls due.** `MoneyObligation.nextDueStep` is written at creation and never advanced. `arrears` and `missedPeriods` are written as `0` and never incremented. `Force.payArrearsPeriods` is written as `0` and never incremented, though it is read in two read tools and the world view. `provisionedThroughStep` is never compared to the clock and `provisionStatus` never leaves `"provisioned"` — which makes the battle resolver's provisioning penalty dead code for every force in shipped data. The obligation kind `army_upkeep` has no producer and no consumer. `MoneyTransaction`'s reserved kind `"upkeep"` and causes `"scheduled_income"` / `"obligation"` likewise have no producer.

**Consequences authors set are inert.** `arrearsMoralePeriods` and `arrearsDesertionPeriods` are authored in both scenarios (1 and 2) and read by nothing. The watch predicates `arrears_reach` and `account_below` have no evaluator.

**Obligations leak.** `disband_force`, `disband_forces_bulk`, and `merge_forces` all orphan the force's pay obligation — validation only checks force→obligation, never the reverse. And `recruit_from_province` can double a force's size without touching its obligation's amount.

## The design

### Polities get treasuries

Add `ensurePolityAccounts`, mirroring the existing `ensureCharacterAccounts`, and run it in the same pre-agent step. Point the shipped scenarios' offices at their polity's treasury via `treasuryAccountId`, which makes the existing office→fiscal-grant derivation work as it was always meant to. A consul then has authority over Rome's money because of the office, and loses it when the office does — which is already implemented and currently reaches nothing.

This is the one piece with real balance consequences for existing saves, since it introduces a pot of money where there was none. It needs a migration decision: seed treasuries at a scenario-authored opening balance for new campaigns, and for in-flight ones either seed at zero or leave them absent, but never retroactively enrich a running game.

### One fiscal tick

Follow the pattern `advanceProjectsTick` already establishes: a recurring `world_process_tick` with a new `processKind` of `"fiscal"`, seeded like `ensureProjectTicksSeeded` and registered in the same handler map in `pipeline.ts`. This gets transactional persistence for free through the existing event-loop commit path, and — unlike folding the work into `advanceWorldDynamics` — it fires on the simulated calendar rather than once per turn, which matters once elastic time lands and a turn can span an arbitrary number of days.

Each time it runs, in this order:

1. **Collect due income.** Every active `IncomeSource` whose `nextDueStep` has arrived credits its target account at its `collectionRateBps`, writes a `MoneyTransaction` with cause `"scheduled_income"`, and advances `nextDueStep` by its cadence. A source whose province has been lost, razed, or occupied yields nothing — the tick should read current control rather than assume the source still produces.
2. **Settle due obligations,** in `priority` order. Each debits `payerAccountId` and writes a transaction with cause `"obligation"` and, for army pay, kind `"upkeep"`. Advance `nextDueStep` by the cadence whether or not it was paid — a period that passed unpaid is still a period that passed.
3. **Record shortfalls.** Where the account cannot cover an obligation, pay what it can, add the remainder to `arrears`, and increment `missedPeriods`; for an army-pay obligation also increment the force's `payArrearsPeriods`. Partial payment matters: an army half-paid is in a different position from one paid nothing, and the model already has the fields to say so.
4. **Apply arrears consequences,** finally giving `arrearsMoralePeriods` and `arrearsDesertionPeriods` their first reader. Past the morale threshold a force loses morale; past the desertion threshold it loses personnel. Both are authored per scenario, and neither should be duplicated as a constant here.
5. **Advance provisioning.** A force past its `provisionedThroughStep` degrades through `provisionStatus`, which finally activates the battle resolver's existing penalty.

Every step of this emits ordinary factual events, so unpaid troops and a failing treasury reach the Chronicle the same way a battle does.

### Raising an army costs something

`create_force` should require a payer that can actually pay, and debit it. Which payer is the interesting part, and it is the distinction the player asked for:

- A force raised **on a polity's behalf** is paid by that polity's treasury. This is the ordinary case, and it needs the raiser to hold fiscal authority over that treasury — which the authority index already knows how to check.
- A force raised **by a character personally** — a client army, a private retinue, a mercenary company bought with a general's own money — is paid from that character's own account. It answers to them, and it stops existing when they stop paying for it.

That distinction should be explicit on the call rather than inferred, because inferring it from "did a polity account resolve" is exactly the silent-degradation bug that exists now. The force's `payObligationId` then points at an obligation whose `payerAccountId` says, permanently and legibly, who is buying this army's loyalty.

An army whose personal payer dies is a genuinely interesting situation the inheritance path already partly handles, and worth getting right rather than leaving to a dangling reference.

### Maintenance varies

The obligation's `amount` must stop being `size * 2`. What a force costs depends on what it is and where it is: mercenaries cost more than levies and desert faster when unpaid; a besieging army in hostile country costs more than a garrison at home; a fleet is not an infantry column; a force that just won may accept less than one that just lost.

None of that should become a table. The mechanism is: the tick reads the obligation's current `amount`, and the *amount* is set and revised by judgment — at creation, and afterwards by any actor with the authority and the reason to revise it. See [income and awards](income-and-awards.md) for how the AI sets and adjusts these figures, and why that is the right layer for it.

### Fix the leaks first

Before any of the above, the orphaning bugs need closing, because a runtime that settles obligations will expose them immediately: `disband_force`, `disband_forces_bulk`, and `merge_forces` must deactivate or repoint the obligations they orphan, and validation should check obligation→force as well as force→obligation. `recruit_from_province` should revise the pay obligation when it changes a force's size.

## Open questions

**Can anyone go into debt?** `MoneyAmountSchema` is non-negative, so today the answer is structurally no, and `arrears` on the obligation is the only place a shortfall can live. That is probably the right answer — a treasury at zero with mounting arrears models a bankrupt state better than a negative number does — but it should be a decision rather than an accident of the schema.

**What happens to an army nobody is paying?** Desertion handles the slow case. The interesting case is faster and more political: an unpaid army with a commander and a grievance is how a republic acquires a warlord. That is a storyline the pressure and goal machinery could carry, and it is the strongest argument for making arrears visible to actors rather than only to the ledger.

**Does the fiscal tick run per-day or per-period?** Obligations carry `cadenceSteps`, which is step-based, while the tick would fire on the simulated calendar. These need reconciling before elastic time lands, or a turn that spans a year will settle a quarterly obligation once.
