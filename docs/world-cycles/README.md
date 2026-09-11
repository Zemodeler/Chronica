# World cycles

**Status: designed, not built.** Nothing described in this folder exists in the running game yet. Read these as specifications for work to be done, never as descriptions of current behaviour.

That warning is not boilerplate. The codebase already contains comments claiming this work is done — `midnight-tick.ts` says its pass covers "income, debt, pay, supply, construction, travel, upkeep", and `advanceWorldDevelopments` is described as performing "obligation/income/development settlement". Neither is true. There is no such code. A reader who trusts those comments will conclude the economy runs and go looking for a bug that is really an absence. When any part of this folder ships, fix the comment that lied about it in the same change.

## What these documents cover

A campaign turn is driven by what people decide: the player gives an order, characters decide what they mean to do, and the interpreter carries out as much of it as the world allows. This folder is about everything that happens *between* those decisions — the world running itself on its own schedule, whether or not anyone acted.

- [Fiscal runtime](fiscal-runtime.md) — money that moves because time passed. Polity treasuries, income that arrives, obligations that fall due, armies that cost something to keep, and what happens to troops who go unpaid.
- [Income and awards](income-and-awards.md) — where the money comes from, and why the amounts are judged rather than computed.
- [Institutional cycles](institutional-cycles.md) — offices whose terms actually end, and the elections that follow.

## The situation these share

Chronica has a remarkably complete economic *data model* and no economic *runtime*. `MoneyObligation` carries `kind: army_pay | army_upkeep | salary | tribute | pension`, a `cadenceSteps`, a `nextDueStep`, `arrears`, and `missedPeriods`. `IncomeSource` carries a cadence and a due step. `Force` carries `payObligationId`, `payArrearsPeriods`, `provisionStatus`, and `provisionedThroughStep`. `MoneyTransaction` reserves the kind `"upkeep"` and the causes `"scheduled_income"` and `"obligation"`. `OfficeSeat` carries `termExpiresAtStep`, and the vacancy causes include `"term_expired"`.

Every one of those fields is written once at creation and never advanced, incremented, compared against the clock, or produced. The schemas describe a world with a functioning economy and a constitutional calendar; the code implements neither. Two authored scenario knobs — `arrearsMoralePeriods` and `arrearsDesertionPeriods` — have no reader at all, so the consequences an author sets for unpaid troops are silently inert. A battle penalty for poor provisioning exists in the resolver and is dead for every force in shipped data, because nothing ever moves a force out of `provisioned`.

So the work here is mostly *wiring up a model that is already there*, not designing one from scratch. That is worth stating plainly because it changes the shape of the job: the risk is not "will this schema hold up" but "does anything already depend on these fields being frozen". Mostly nothing does, which is its own warning — a field nobody reads is a field nobody has tested.

## Principles these designs follow

**The engine owns mechanism; judgment owns amounts.** A deterministic tick decides *that* an army must be paid this period, *which* account owes it, and *what happens* when the account cannot cover it. It does not decide what a legion costs or what a province yields. Those are situational — a war-ravaged province yields less, a mercenary company costs more than a citizen levy, a victorious army may accept arrears a beaten one will not — and they are exactly the kind of judgment the game already trusts to AI everywhere else. A hardcoded formula here would make the economy predictable in the way a spreadsheet is predictable, which is the opposite of the point.

**No full economic system is set in stone.** There is deliberately no tax rate, no upkeep table, no yield curve. What is fixed is the ledger: money exists, it has an owner, it moves for a stated cause, and it cannot be conjured or vanish unaccounted. Everything above that line is judged per situation and recorded as a fact like any other.

**Money that moves is history.** Every transfer these systems make writes a `MoneyTransaction` with its real cause, and anything a player would notice — troops going unpaid, a province's revenue collapsing, a treasury emptying — reaches the Chronicle through the ordinary factual-event path. A silent debit is as much a lie by omission as a silent mutation.

**A cycle that fires is a cycle that can be seen coming.** An office whose term expires, an obligation about to fall due, a treasury that will not cover next period — each should be readable before it happens, not only discovered in the aftermath. The read tools are where that belongs, so an actor can act on a coming problem rather than only on a past one.
