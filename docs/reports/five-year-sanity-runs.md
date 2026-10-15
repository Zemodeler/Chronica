# Five-year sanity runs: bug report

Date: 2026-10-09. Branch `chronicle-order-truth` (working tree with uncommitted changes). Provider-free: every run uses the "model that never acts", so everything below is the rules' own doing. Each run is 60 game months from 1 March 270 BC. All 11 runs exited 0, and the money audit read **unexplained 0** in every run that prints one.

## Runs

| # | Script | What it tests |
|---|---|---|
| 1 | `world-alone.mts 60` | The world left alone: wars, risings, alliances, sieges |
| 2 | `war-sanity.mts 5` | Forced Rome-Carthage war, rules conduct both sides |
| 3 | `war-sanity.mts 5 --free` | No war forced: do the rules reach it by themselves |
| 4 | `economy-sanity.mts 5` | Peaceful economy: treasuries, grain, development |
| 5 | `economy-sanity.mts 5 --war` | The same, with a Carthaginian sack |
| 6 | `government-sanity.mts 5` | Magistrates, votes, cases, rates, vacancies |
| 7 | `merchant-sanity.mts 5` | A private man's fortune: estate, trades, firm |
| 8 | `coin-sanity.mts 5` | Coinage and strain, war from month 6 |
| 9 | `coin-sanity.mts 5 --fleet-loss --lost-war` | Carthage loses the war and its chest |
| 10 | `coin-sanity.mts 5 --lean --long-war` | Carthage starts poor, Rome's chest emptied at month 24 |
| 11 | `coin-sanity.mts 5 --peace` | Control: no war |

Raw outputs are in the session scratchpad (`*.txt`, one per run).

Severity: **High** corrupts state or silently breaks a rule. **Medium** is a rule that misbehaves or a balance that is clearly wrong. **Low** is cosmetic or needs a design decision.

## Bugs

### B1 (High): a tick writes a non-integer account balance and the whole tick is discarded
- Run 10. Nine times: `the tick to day 1560 wrote a world that would not load and was set aside (material.accounts.20.balance: Invalid input: expected int, received number)`. The same message repeats for days 1560 and 1561.
- Account 20 at the scenario start is `bruttians-treasury` (192,000 drachmae). Its index may shift during the run, so treat that as a lead, not a certainty.
- It happens at month ~52, in the stretch where the Lucanian state is going unpaid and Rome is in fiscal collapse. A fractional amount reaches a treasury through some credit path. Candidate sources are the money-changer or conversion paths, the plunder or tribute paths, and the uncommitted edits in `coinage.ts`, `fiscal-officers.ts` and `markets.ts`.
- Effect: the guard (`burst.ts`) saves the world by discarding the tick, so the game keeps loading. But those days' work is lost and the same tick likely fails again and again, which could freeze that stretch of time.
- Not reproduced in isolation. A run takes about 30 minutes. A fix would round at every credit site, or `credit()` in `tick.ts` would round; a regression test should assert integer balances after a tick under a bankrupt state.

### B2 (High): coinage debasement motions "pass" but change nothing
- Run 9. Carthage's motions "that Carthaginian shekel be struck with less silver" passed on days 1080, 1260 and 1440. Yet the coin stayed at 100% of its standard, with 0 debasements in `coin.history`, in every year. Strain was 43 to 68 the whole time.
- Either the passed motion's act never applies, or it is applied and then reverted. The `fiscal-officers.ts` and `magistrates.ts` motion builders are the place to start (both were modified, uncommitted).
- The coin-strain feature (docs/economy.md, "Strain, debasement and arrears") is unreachable for a state that votes for it.

### B3 (Medium): every merchant trade loses money, so the economy offers no profitable play except an estate or a firm
- Run 7, 8 seeds each, against an idle control that gains 1,572 a year. Estate +5.9%/yr. Firm +13.1% mean, median +20.1%, worst −18%. Trades:
  - `trade-capua`: −4.5%/yr, **−34,732 in year 1** on 36,000 put in.
  - `trade-syracuse`: −7.6%/yr, a first-year gain of +9,837 and then a flat −11,806 in years 2 to 5. A flat line means the venture ended and the capital is gone.
  - `trade-carthage`: median −9.8%/yr, worst −60%.
- The docs describe ventures as a standing way to earn. Capua's first-year loss of 96% of the stake looks like a bug (a fee or a lost cargo) more than a market outcome. Check whether the Syracuse and Carthage ventures lapse after year 1 by design.

### B4 (Medium): treasuries hoard without limit
- Run 4, peace: Carthage 18.6M, rising to 82.3M at year 5 (income ~20M/yr, almost nothing spent). Run 6: Carthage chest 55M (year 3), 67M (year 4). Run 8: 30M, then 82M. Rome rises 2.8M to 17.6M.
- Carthage's rule acts are only "festival 1, audit 1, census 1" a year, so it never spends. That feeds the coin model (strain is 0, cover 569) and makes later wars cheap for it.
- At the other extreme, Samnites drains 84k down to 50,400 and stops falling there, as if clamped by a floor. Boii sits at 0 all five years (`chest 0`). Etruscan-cities jumped 281k to 7.1M in one year (run 6, year 3 to year 4) with no matching income.

### B5 (Medium): in `--free`, Rome and Carthage never go to war in five years
- Run 3. "war not opened" every year. Carthaginian forces stand in Sicily (fleet 110 at the Elymi, 2,900 men, garrisons), Rome's 15 to 17k field army wanders Bruttium, then Campania and Latium. At month 60 eight wars exist, none of them Rome vs Carthage.
- The Mamertine war opened on 3 Feb 265 BC (the date is historical) and Rome did not respond. This may be by design (wars follow the player's decisions), but the opening is the scenario's main plot and the rules don't reach it.

### B6 (Medium): Roman armies and risings on the move in a way that looks broken
- Run 3. Rome's field army moves Bruttium → Campania → Latium → Lucani uplands. The "rising" forces (Bruttium, South-western..., Uplands) come with it to Latium itself (`@Latium on the Almo`), i.e. insurgents marching on the capital with Rome's army elsewhere, and rise to 6 hostile bands by year 5 and 97 armies in all.
- Flip-flop counters: 92 flips over 338 march orders, and run 2: 163 of 524. Early flips are the same two Contingents (Lucanians, Apulian cities) changing target each month for three months running (months 4 to 6). The Seleucid royal army flips at months 17 and 21.
- Whether these are bugs or tuning depends on intent. The repeat-flip pattern on a single force looks like a missing hysteresis.

### B7 (Medium): Rome's chest collapses into an unrecoverable spiral in a long war
- Run 10 (`--long-war`). From month 24 Rome's chest is ~1 percent of what it was. Arrears grow 120k/month (3.19M by year 5), desertion ripples (248, 485, 677, 805, 881...) and then dwindles because there are no men left. Debasement motions fail four times (days 940, 1090, 1240, 1390); the chest shows 43k to 581k.
- There is no recovery path in the rules: no loan, no tax rise, no peace. Rome never sues for peace or raises a tax in 36 months, and the strain index stays at 62 to 65. The `coin_strain` fact repeats at months 26 and 38.
- In run 9 Carthage behaves similarly: arrears 172k to 1.9M over 4 years.

### B8 (Low): the Seleucid fleet is "completed" again every year
- Run 3: `shipbuilding works: The new fleet of Seleucid Empire completed` printed in every yearly line (5 times). Either one project is being re-reported, or a new fleet is built each year with nothing appearing in the fleet count.

### B9 (Low): performance degrades as the world grows
- CPU per month: 15.5 s (year 1), 19.8 s, 24.2 s, 28 s, 35.6 s (run 3). Run 2: 19 to 45 s per month, worst month 60 s. Armies go 14, 29, 40, 51, 97. Three of these runs were also running at the same time, which inflates the numbers, but the growth with army count is consistent.
- Worst month 40 to 60 s is too slow for a player turn; the economy run reports 1,158 s for 60 months and the government run 1,683 s.

### B10 (Low): the economy table shows `income/yr 0` and `grain% 0` at the start
- Run 4, first table, every polity. These appear only at the START line (cosmetic: no month has run yet), but they are shown as zeros and not as `-`.

### B11 (Low): fixed order of "premium" values across unrelated powers
- Run 4: Rome, Samnites and Etruscan-cities show the identical premium (−232, −405, −497, −545...) every year. Syracuse and Mamertines also match each other (187, 287, 340, 368...). The premium appears to be computed by coinage, so the three share one coin. Intended, but it makes the Samnites and Etruscan figures carry no information of their own.

### B12 (Low): "acts the applier refused: 1" in the world-alone run
- Run 1: 1 act refused out of 900 rule acts over 60 months. The detail is not printed, so I cannot say which. Worth printing the refusal reason in the script's summary.

### B13 (Low): unrealistic election cadence
- Run 6: Rome "named 36" and "named 30" seats in a year; Carthage's "Election of Carthaginian suffete: 2 places" recurs yearly, and in run 3 passes after "gathering_support" in one case. It is plausible for Rome (many offices). Check whether Carthage's suffete election should be yearly and whether the same men are named.

## Things that held up
- Money audit: `unexplained 0` in runs 3, 4, 5, 8 to 11.
- No crash, no hang; `world-alone` alliances (4), wars (12 opened, 10 ended) and 1 polity ended show the world is lively on its own.
- The government run reports no flip-flopping rates (0 reversed), no vacant charges (`empty none`) and no month with a chest below zero.
- Estates earn a steady 5.8 to 6.0% with a tight seed spread.
- Peace control (run 11): no strain, no arrears.

## Not covered
Player-driven play (orders), the web UI, saves and migrations, the scenarios other than the Punic opening, and a run with a live model. B1 is the item most worth reproducing and fixing first, then B2.

## Fix pass (same day): status of each item

| # | Status | What was found and done |
|---|---|---|
| B1 | **Hardened; source not found** | Did not reproduce once B2 was fixed (the run diverged before month 52). `credit()` in `packages/sim/src/tick.ts` now rounds the balance it writes, so a stray fractional sum cannot cost the world a day. `burst.ts` now names the account(s) and the balance before the tick when a tick is set aside, so a recurrence points straight at its source. No regression test: no known input produces the fraction. |
| B2 | **Fixed (in the working tree)** | Root cause: the burst's keep-out guard (`keepOutOfOtherStatesBooks`) set aside the officers' own acts, so the fiscal officer's and magistrates' coin, loans and customs were decided monthly and never struck. The change in `burst.ts` (`pass.sanctioned === undefined`) with `the-officers-strike-lands-in-the-burst.test.ts` was already in progress; I verified the test passes and re-ran run 9 end to end: the shekel is now struck 9000 → 8100 (day 1050), and `coin_debased` is reported. |
| B3 | **Mostly a harness error; one real balance issue left** | `merchant-sanity.mts` ignored that a venture is bought partly on the seller's credit (36,000 down on a 76,650 cargo, the rest owed at interest), and counted a land venture's price as lost. With the debt netted and the price counted as an asset, **Capua (a land venture) is +16.3%/yr in every seed**. Still open: **sea cargoes to Syracuse (−7.6%/yr) and Carthage (−9.9%/yr) lose in every seed.** A cargo's base margin is ~12% but the crew (6%) and Syracuse's duty (10%) and the money-changers' cut come out of the sale, so it loses unless the price gap is large. `docs/economy.md` says "5 to 24 in the hundred... before the crew, the customs..."; it needs a design decision (lower the duty or crew share, or raise the base margin). Not changed. |
| B4 | Open (design) | Treasuries still hoard; nothing spends the surplus. |
| B5 | Open (design) | Rome–Carthage war does not open by itself. May be intended while the player is Rome. |
| B6 | Open | Flip-flopping marches and risings reaching Latium: no change made. |
| B7 | **Largely the same cause as B2** | The unrecoverable Roman spiral had the officers' loans, taxes and coin suppressed by the guard. After the fix, run 10 shows Rome borrowing (debt 2.1 months) and the strain falling; arrears still reach ~2.4M by year 4 in this artificial setup (chest cut to a fortieth, income to 15%). Rome still never sues for peace. |
| B8 | **Not a bug** | `war-sanity.mts` prints every shipbuilding project, completed ones included, in each yearly line; it is one old project listed repeatedly. |
| B9 | Open | Performance growth with army count: not profiled yet. |
| B10, B11, B13 | Open / by design | Cosmetic or intended. |
| B12 | **Done** | `world-alone.mts` now prints each refused act (date, operation, reason) in its summary. |

Files changed in this pass: `packages/sim/src/tick.ts`, `packages/sim/src/burst.ts` (diagnostic only; the guard change was already in the tree), `scripts/merchant-sanity.mts`, `scripts/world-alone.mts`. Checked: `tsc --noEmit` on `packages/sim` is clean; `the-books-balance.test.ts` and `tick.test.ts` (39 tests) and the officers test pass. The full sim suite was not run.
