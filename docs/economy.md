# The economy

How money, land, goods, trade and coin work in the simulation, and where each piece lives. It was built in
five phases over scenario versions 47 to 50 (v51 then wrote down how each great power taxes, and v52 set the income to the army-cost rule). This is what
stands; the order it was built in is in the git log (`4442400` to `8035315`).

## Principles

- **Derive, store little.** The engine keeps a handful of levels and reads everything else off them: a province's
  development, scar and tax policy sit on its row of material state (`packages/shared/src/material-state.ts`); a hub
  keeps a stock of each of six goods; a coinage keeps its silver content. Prices, food security, tax yields, customs,
  exchange rates and the regional and trade pages are computed on request and stored nowhere.
- **Deterministic.** No model is asked for any of it; the monthly pass is plain engine code (`packages/sim`) and
  `stableHash` is the only source of variety.
- **O(provinces) a month.** The pass walks provinces once, in id order, adding each one's use and output to its hub;
  trade is O(hubs x links x goods). `packages/sim/src/a-thousand-provinces.test.ts` holds the budget. The model is
  told one line a power (`packages/sim/src/slice.ts`), never a line a province.

## Money and the audit (phase A, v47)

Every balance is an integer in silver units, the Attic drachma of silver being the numeraire. Money is conserved
except at nine doors, each a real thing outside the accounts the model keeps (`EXTERNAL_MONEY_KINDS` in
`packages/shared/src/material-state.ts`; a one-sided transaction carries `external`):

| Door | What passes through it |
| --- | --- |
| `harvest` | the land and its people: taxes, rents and tithes, which keep no purse |
| `market` | cargoes sold, harbour earnings, goods bought of the world at large, and customs (`sim/customs.ts`) |
| `plunder` | a sacked town |
| `credit` | a banker the world does not name |
| `the_unnamed` | wages to the men nobody names, and what such a man brings |
| `bread` | grain bought from the country at large |
| `abroad` | an order sending money out of the books; also the money-changer's cut on a crossing between coinages |
| `seigniorage` | what a mint earns by debasing (phase E) |
| `endowment` | the means a man arrives with |

`auditMoney` (`packages/sim/src/money-audit.ts`) sorts every line of a span into a transfer between accounts or a
passage through a door, checks each balance against its own lines and lists whatever neither explains.
`packages/sim/src/the-books-balance.test.ts` runs two years of the Punic world (a venture, a foreign loan, a year of
customs under tariffs, a pact and an embargo, a debasement and a tribute across two coinages) and fails on any
unexplained line; a further case proves the audit does find money made from nowhere.

## Calibration (v47)

The scale is the age's, in drachmae. `DRACHMAE_PER_TALENT = 6_000`; a legionary draws `LEGIONARY_PAY_GROSS = 10` a
month with `PAY_STOPPAGES_SHARE = 1/3` stopped for grain, clothes and arms (Polybius 6.39), a centurion twice that and a
horseman three times (`packages/sim/src/money.ts`). An army costs `SOLDIER_PAY_PER_THOUSAND = 10_000` a month per
thousand men, a warship `WARSHIP_PAY_PER_HULL = 500`, and the army's bread is priced from the same rate
(`ordinaryGrainPrice`): one pay rate, one grain price (`packages/shared/src/world/economy.ts`).

What a province can bear is `taxCapacity`, `reckonTaxCapacity` in `packages/shared/src/material/province-material.ts`:
population times `50 x REVENUE_SCALE / (1 + 9)` (a townsman bears fifty times the factor, each country person a ninth of
a townsman's share; `REVENUE_SCALE = 3.1` since v52, see below), times
productive capacity, less war damage, times a development factor. A power may raise `TAX_EXTRACTION_BPS = 1_000` (a
tenth) of the stability-weighted capacity, and asking under `CUSTOMARY_TAX_BURDEN = 0.5` of it costs no order
(`packages/shared/src/material/taxation.ts`).

**The army-cost rule (v52).** A rule of the game: *a 20,000-man army costs 40% of Rome's income, a 10,000-man army 20%*,
that is N men cost N/500 per cent of a month's revenue. Pay stayed the Polybian 10 a man (`SOLDIER_PAY_PER_THOUSAND`; 100,000
a month for 10,000 men, 200,000 for 20,000), so the revenue rose, not the pay: Rome took in 162,000 a month under v47 to v51
and a legion with its ala (65,000) cost 40% of it; it now takes in **500,000**. Every land's yield (`REVENUE_SCALE = 3.1`) and
every authored source, chest and tribute rose by the same factor, so Carthage and Syracuse stand to Rome as they did, and
`PRIVATE_WEALTH_SCALE` (estates, ventures) divides the factor out again, so a senator is still worth about 100,000.
`an-army-costs-its-share.test.ts` puts the Roman treasury through the real tick with 10,000 and 20,000 men on the roll and
reads 20% and 40% (the takings of the first month run a few points under the nominal figure: the Treasury's officers, and
Rhegium, which is the Campanians'). The legion's 4,500 now cost 13%; a year of 20,000 men leaves the chest higher, 100,000 men
(a fifth of Rome's people) put it in arrears in the sixth month. Asked/bearable is unchanged by the factor (Rome 0.35,
Carthage 0.23, Syracuse 0.37, the Mamertines 0.18), so every opening burden is still under the customary half.

| Power | Monthly revenue (collected) | Chest | 10,000 men | 20,000 men |
| --- | --- | --- | --- | --- |
| Rome | 500,000 | 2,790,000 | 20% | 40% |
| Carthage | 1,457,000 | 18,600,000 (3,100 talents) | 6.9% | 13.7% |
| Syracuse | 192,000 | 1,612,000 | 52% | 104% (cannot) |
| the Mamertines | 54,250 | 775,000 | 184% | 369% (cannot) |

The Punic opening (`packages/db/src/punic-wars-scenario.ts`): Rome takes in 500,000 a month (tributum 340,000 at
90% collected, public land 102,000, the Sila forest and Samnite rents 46,000 each) with a chest of 2,790,000; Carthage
1,457,000 (harbour dues 930,000, African tribute 620,000 at 85%) with 18,600,000 (3,100 talents); Syracuse 192,000 with
1,612,000; the Mamertines 54,250 with 775,000 (these figures are 3.1 times those of v47 to v51: 162,000, 470,000, 62,000,
17,500). A peace's indemnity is a tenth of `meansOf` (`packages/sim/src/peace.ts`):
the chest plus a year of active income at its collection rate, so a beaten Carthage is asked for hundreds of talents a
year. `INDEMNITY_MEANS_FLOOR = 50_000` bounds the price of a clause for a poor power.

## Land: development and scars (phase B, v48)

`developmentBps` (0 to 10,000; floor `MIN_DEVELOPMENT_BPS = 500`, neutral 5,000) is roads, harbours, estates and the
habit of trade. It starts between 2,000 and 7,000 by ground, town size and harbour, and sets how many people a province
carries, what they make and what a government can take. `packages/sim/src/economy.ts` moves it monthly and
**asymmetrically**: a province at full war damage, in disorder and starved loses about `FALL_REFERENCE_BPS = 100` a
month; one at peace, fed (stability 4,500, food 5,500 at least), orderly and lightly taxed regrows at most
`REGROWTH_BPS = 20` a month, 240 a year, slower where scarred and faster beside a more developed neighbour. A thing
that takes a decade to build can be undone in a season and takes a generation to put back.

**Regions pull apart in peace (v53+).** Peace used to lift every province the same ~240 a year, so the spread
between provinces never widened. Growth is now `REGROWTH_BPS` (20 a month) times: `reinvestmentOf(rate)` (1.5 at a tax of 4 in
100 or less, 1.0 at the ordinary 10, 0.5 at 15, 0.1 at 20, none past it; a `men` province counts at the ordinary money rate),
`tradeAccessOf` (an isolated province 0.4; +0.35 if it is its country's hub; +0.3 for a port and +0.15 for a river on a steady
market; + up to 1.0 for the traffic through its hub, `hubTradeOf`, the lanes' units against what the country uses, eight points
of access per whole month's use, outlying provinces at 0.6 of it), order (0.7 at the least, 1.3 at perfect), a richer
neighbour (up to +25%), the scar, and the room left (a quarter of the way to the ceiling, at least 1,000, tapers it).
`regions-pull-apart.test.ts`: a lightly taxed, trade-linked port gains over 1,500 in five years at the same start as an
isolated, heavily taxed hilltop which gains under 250 (the real pair: 2,236 and 173). The five-year peace run of the whole
Punic map (6,394 provinces), before and after (p10 / median / p90, spread, sd): start 2,218 / 2,829 / 3,957, 1,739, 743; v52
year 5 3,414 / 4,024 / 5,156, 1,742, 761; v53+ year 5 2,813 / 3,409 / 4,599, 1,786, 819. Mean growth is about half of what it
was (an isolated province at an ordinary tax builds a 100 a year): most of the map has no trade to build on and stagnates, and the
trade-linked fringe pulls away.

**Where a province lies decides what it becomes (v55).** Five years of peace left the map's best and worst tenth as far apart as
they began (p90 - p10 1,750, then 1,759), because most provinces had no trade and the rest were lifted together. Nine more
differences now shape the ceiling and the speed, all derived from the map in `packages/shared/src/material/province-site.ts`
(`provinceSites`, worked out once per map like `provinceGrounds`, nothing stored) and `economy.ts`:

- **The ceiling** (`developmentPotential`, the permanent facts only): the fertility of the terrain (plain 8,400, hills 6,000, uplands
  4,600, pass 4,200, steppe 3,000); a port +700, a coast without one +350, a river +600; the weight of the towns; **agglomeration**, up
  to +1,600 for the market towns and cities within reach (a bounded search over the map's distances, a town of 20 or more
  settled units pulling with the root of its size, fading over about 55 units) and up to +500 for a capital's court nearby; **resources**,
  up to +450 for what the terrain and the quays sell beyond the province's own bread (read off `GOODS.supplyByTerrain`), +900 for a mine
  (7 in 100 hills and 12 in 100 uplands, by `stableHash`), +2,400 for an oasis (6 in 100 of the steppe) and +800 for a caravan town;
  **roads and passes**: -600 for a province reached by passes alone (walled in), +300 for a crossroads of seven roads. Past 8,500 the
  gains count half, so no ceiling is pinned at the top of the scale; a ceiling is never less than 300 above a province's start.
- **The speed** (`monthOfDevelopment`), each a multiple of the ordinary 20 a month: **soil** (plain 1.3, hills 1.0, uplands 0.65,
  steppe 0.4, an oasis 1.15), **specialisation** (1 to 1.35 for a mine and the exportable goods), a province's own **luck** (0.95 to
  1.05, `stableHash` of its id), **agglomeration and court as trade access** (`tradeAccessOf`: +0.45 and +0.1 at the most, beside the
  hub's traffic, a coast +0.15, walled in -0.15), **institutional quality** (`tenureFactorOf`: half the rate when its holder has just taken it
  in war, `lostBy`, the full rate after ten years, 5 in 100 more after thirty, times 0.75 to 1.0 for the firmness of the hold and 0.85 to
  1.15 for the holder's cohesion; beside the tax rate and the order already counted), **crowding** (`crowdingFactorOf`: 0.7 for a land whose
  people fill what its fields carry, 1.1 for one with a tenth of slack), the **frontier** (`frontierFactorOf`: up to half off for a
  neighbour's war damage, 8 in 100 off beside ground nobody holds), and **cumulative advantage** (`compoundingFactorOf`: 0.75 at a quarter of the way to
  the ground's ceiling, 1.5 at seven tenths, measured against the ceiling the scar and a rebuilding do not move, so a war-torn province
  has lost its head start). A province builds at most 38 a month however much favours it, and loses `UPKEEP_SHARE_PER_MONTH` (0.17 in 100 of
  its development, faded to nothing at the ceiling) to the keeping-up of its roads, so a poor, isolated province stands still or
  slips back (Tripolitania's steppe, -120 in ten years; a fortress upland walled in by passes, -240).
- The war-scar rules, the asymmetric rebuild and the tax rate's effect are unchanged; the neighbours are read from `site.neighbours`,
  not rebuilt each month.

The whole Punic map (6,455 provinces), peace, p10 / median / p90, p90 - p10, sd: start 2,205 / 2,824 / 3,955, 1,750, 745; v53 year 5
2,809 / 3,449 / 4,615, 1,806, 833 and year 10 3,402 / 4,098 / 5,340, 1,938, 933; v55 year 5 2,354 / 3,134 / 4,558, 2,204 (1.26 times the
start), 981 and year 10 2,547 / 3,589 / 5,827, 3,280 (1.87 times), 1,355. The mean grows 91 a year (v53: 129) and the favoured
tenth about 300; the provinces next to a city build a median 1,975 in ten years, the isolated 424, the steppe 184, those walled in by
passes 68. `regions-diverge-over-a-decade.test.ts` holds the spread, the modest mean, the rich port against the walled upland, the
newly conquered against the long held, the bounds and the determinism.

War writes a **scar** (`scarBps`) through `scarredBy`/`applyWarDamage` in `province-material.ts`: an event of severity s
takes `DEVELOPMENT_LOSS_PER_SEVERITY = 0.5` times s of development at once and adds `SCAR_PER_SEVERITY = 0.35` times s of
the room left to the scar, so campaigns stack. The scar caps development at `potential x (1 - scar)` and fades
`SCAR_FADES_BPS = 6` a month in peace under a light tax, faster where a work is rebuilding; an occupier adds 5 a month
(25 where it plunders). Burned fields are sown again in about three years; the province stays behind far longer.
A province scarred past `WASTE_SCAR_BPS = 2_000` is told once to its power as laid waste.

## Tax regimes (phase B)

A province is taxed by, in order: its own row (`taxRegime`, `taxRateBps`), the custom of the country
(`economy.provinceTaxPolicies`, which stays with the ground when it changes hands), its holder's default
(`economy.taxPolicies`), then the old uniform land levy (`taxPolicyIndex`, `packages/shared/src/material/tax-policy.ts`).
The default rate is `DEFAULT_TAX_RATE_BPS = 1_000`; above `CUSTOMARY_TAX_RATE_BPS = 1_200` each thousand costs
`OVER_CUSTOMARY_UNREST_BPS = 1_500` of order, plus a resentment per regime (`REGIME_RESENTMENT_BPS`).

| Regime | Yield (`regimeFactor`) | Leak scale (`REGIME_LEAK_SCALE`) | Resentment |
| --- | --- | --- | --- |
| tithe | follows food security, 0.35 to 1.3 of land levy | 0.6 | 150 |
| land_levy | steady, 1 | 1 | 400 |
| customs | `CUSTOMS_STALLS_FACTOR` 0.15 plus up to 1.6 for the trade through the hub | 0.5 | 100 |
| men | no money to the overlord; a tribute of `MEN_PER_YEAR_SHARE = 0.05` of the people a year at the default rate. The holder keeps its own land levy at the ordinary rate times `1 - MEN_LEVY_RESERVE_SHARE` (0.6), v53 | land levy's (1) for the holder's money, 0 for the men | 250 |

**Collection efficiency by distance.** A province loses `LEAK_PER_STEP = 0.005` of its yield per step from the capital,
scaled by its regime and eased by a good tax office (at best 0.4 of the leak saved), and never below
`MIN_COLLECTION_EFFICIENCY = 0.5` (`taxation.ts`). A tribute of men raises a province's roll of men by what it owes in a
year. Scenario v51 sets Rome's tributum as a land levy, Sicily as a tithe whoever holds it, Carthage's rural Libya a
heavy levy and Rome's allies by foedus in men (`packages/db/src/punic-wars-taxes.ts`).

**The `tax_policy_set` delta** (`packages/shared/src/sim/deltas.ts`) has scopes `polity` (default), `province` (only
ground the power holds) and `customs` (tariff on goods entering, at most `MAX_CUSTOMS_RATE_BPS = 5_000`). It is a
fiscal act judged against the power's chest (`apply-deltas.ts`): an officer may set only his own power's taxes (anyone
else is rejected), and the office must carry the grant (the treasurer-words bundle in
`packages/shared/src/characters/office-powers.ts` grants it along with `coinage_debase`). Others get a reading, not a
control, in the treasury.

## Goods and market hubs (phase C)

Six goods, `GOODS` in `packages/shared/src/world/markets.ts`, with base prices in drachmae: grain 1 (a modius), oil and
wine 8, metals 30, timber and naval stores 4, textiles and luxuries 25, slaves 200. A **hub** is a province with a port
town of settled size 25 or more, or towns adding to 70 (`PORT_HUB_SETTLED_SIZE`, `INLAND_HUB_SETTLED_SIZE`): some seventy
on the Punic map, at most `MAX_MARKET_HUBS = 256`. Every other province trades in its nearest hub by the map's distance;
an island with no town gets its largest province. Each hub keeps, per good, a stock, a target, the country's monthly
demand, a price and last month's inflow and outflow, all integers.

**Price** is one function, `priceBpsFrom`: base x (target / stock)^exponent, clamped to a floor and ceiling (grain
exponent 0.9, between 40% and 400%; slaves 50% to 300%, and floating inside it since v58, below). `marketPriceBps` is the single source; the army's bread, a
merchant's margin, famine facts and a ruler's page all read it. What a power's own people pay is the hub price times its
coinage's price level (`nominalPriceBps`), whereas the markets trade among themselves in silver.

**Stock.** `packages/sim/src/markets.ts` does the monthly step: a hub's country makes and uses goods, stock above
`SURPLUS_AT = 1.15` of target spills 4% a month, and no hub holds more than `MAX_STOCK_MONTHS = 30`. Grain comes in once
a year, at the harvest month (`HARVEST_MONTH = 7`, `stockTheHarvest`) and carries, with a grain target of the months to
harvest plus `GRAIN_RESERVE_MONTHS = 6`; so one drought makes bread dear and two make a famine. **Food security is a
readout** of grain in hand against need to the next harvest (`foodReadoutBps`: enough to last reads 7,000, half enough
3,500), and a province's bread follows its hub by `FOOD_STEP_DOWN_BPS`/`FOOD_STEP_UP_BPS`. A besieged, occupied or
blockaded hub is stripped: `CUT_OFF_REQUISITION_BPS = 2_500` of its stock a month, its inflow cut to `CUT_OFF_INFLOW`
0.25 (the countryside eats from its farms down to `FARMS_FEED_BPS`). Armies buy bread by drawing the hub's grain
(`drawStock`, `packages/sim/src/grain.ts`), a sack plunders `SACK_PLUNDER_OF_HUB = 0.35` of it, and a grain office's
skill speeds or slows the readout (up to three in ten).

**Slaves (v58).** The slave sat at its price limit in thirty of the seventy-four hubs: a frontier trickle five times what a poor province could use and nothing in a rich one, against a demand so small that no hub's supply and demand ever met. Now `addFlows` (`packages/shared/src/world/markets.ts`) gives a country its own supply (`homeSupply`, nine tenths of what its people use: the households' own, the debtors sold), a frontier trickle (`frontierSupply`, fading to nothing at development 6,000 and never more than `FRONTIER_CEILING_OF_USE = 0.7` of the country's use), and demand that follows wealth (`wealthExponent` 1.5), thins where war has laid the place waste (`warDamageBps`, `scarBps`) and is thickened by what the mines (`MINING_SLAVES_PER_CAPITA` in hills and uplands), the great estates (`SLAVES_PER_ESTATE` a holding) and the works let and not yet built (`SLAVES_PER_WORK`) absorb (`slaveWorkDemand`, read from the world, never stored). Slave labour in production is not modelled beyond that demand. What a war brings goes to the **winner's nearest hub** (`sellCaptives`, `nearestHubOf`: the first hub, walking out from the place over the map's edges, that the winner holds): a quarter of the beaten side's casualties in a field battle (`BATTLE_CAPTIVE_SHARE`, `battle.ts`; Polybius 1.20 has Agrigentum's people sold in 262, and Livy 10.17, 10.46 the Samnite booty), three in a hundred of a city taken by storm and four in a thousand of one that yielded (`STORMED_CAPTIVE_SHARE`, `SURRENDERED_CAPTIVE_SHARE`, `sieges.ts`), and half the people a sack kills or sells (`CAPTIVE_SHARE`, `sackTheMarket`); the sacked town's own market gains none. Dealers drive a glut onward (`SLAVE_DEALERS_SHARE_OF_STOCK` of a hub's stock a month, `trade-flows.ts`). Measured over a year of peace (`npm run sanity:economy -- 1 --bounds`): hubs at a bound of the seventy-four, floor and ceiling together, thirty before and one after; the median price a quarter over the base (the country makes a little less than it uses, and the frontier and the wars make up the rest). `captives-fill-the-slave-market.test.ts` pins it.

## Trade flows, customs and tariffs (phase D, v49)

`packages/sim/src/trade-flows.ts`, after the hubs have made and used goods: for each neighbouring hub pair and good, the
cheaper hub sells to the dearer until the gap is no more than the cost of carrying. Land haul is per 100 km as a share of
base (`LAND_HAUL_BPS_PER_100_KM`: grain and timber 1,500, slaves 120), multiplied by crossing (`CROSSING_COST_SHARE`: river
0.4, strait 0.25, sea lane 0.12, pass 1.4). Capacity is a share of what the buyer uses (`CROSSING_CAPACITY_SHARE`); a
seller keeps `RESERVE_SHARE = 0.7` of its target and, for grain, what it needs to harvest plus
`GRAIN_PROTECTED_MONTHS = 2`; no hub exports more than `EXPORT_SHARE_OF_USE = 0.5` of its use in a month. A way is
open whole in peace, 3,500 when its holder is at war, 2,000 when occupied or blockaded (`routeOpenBps`); a blockade past
`BLOCKADE_SHUTS_AT_BPS = 9_000` shuts a harbour's sea trade. Grain by water into a market at 140% or more is a relief ship.

**Customs.** The importing power's rate (`economy.customsRates`) applies to the value of goods entering from another
power, brought down by a pact (`customsOn`); a province taxed by the customs regime also levies a portoria of a quarter
of its rate (`PORTORIA_DIVISOR = 4`) on what passes through. The duty accrues in `economy.customsDue` and
`packages/sim/src/customs.ts` pays it into the treasury through the `market` door, the same day. The duty is part of what
the merchant paid to land the goods, so a steep tariff shrinks the trade it taxes. v49 sets customs at Carthage and
Syracuse 1,000, Rome 250, Athens and Rhodes 200, the Ptolemies 25, others none.

## Trade pacts and embargoes (phase D)

Both are `PolityAgreement`s with `trade` terms (`TradeTerms` in `packages/shared/src/world/agreements.ts`): a pact has
`tariffCapBps`, `mostFavoured` (the lowest cap in any pact either party holds) and `exempt` goods; an embargo has `goods`
(empty means every good). `tradeTermsBetween` is the reader: a war between the sides is `closed: "war"`, a whole embargo
`closed: "embargo"`, a partial one forbids named goods; a pact in force gives the cap. **War suspends and does not end**
a pact (`ENDED_BY_WAR` leaves it out): the pact is `pactSuspended`, the border is shut, and the day the war ends the
same terms are back, told once as `trade_resumed` (`packages/sim/src/treaties.ts`). **Breach costs.** Making war on a
power with whom one holds a pact costs the victim's trust in the warmaker `SUSPENDED_PACT_TRUST = 10` unless there was a
grievance. Laying an embargo while a pact stands ends the pact and costs the embargoer `EMBARGO_BREACH_TRUST = 10` of
that power's trust, with no legitimacy hit or war grievance (`apply-deltas.ts`); closing the pact first is no breach.
v49 opens Rome with pacts with Carthage (cap 500) and Massalia (cap 250, most favoured).

## Proposing trade by letter

A pact or an embargo is part of "Write to", not a decree. The treaties sheet's "Propose trade" (and the letter tray's
"Put trade to ...") opens a form (`trade-proposal.tsx`) whose terms start from what stands (`readTradeDesk`,
`packages/shared/src/authority/trade-desk.ts`): a new pact from half the writer's own customs rate (three to ten in a hundred),
a revision from the pact in force, one point tighter, bread free when the writer's own hubs are short.

- **Who decides.** `tradeAddresseeFinder` names who answers for a power in trade, and why: the head of the department that
  writes its letters, else whoever holds its diplomatic grant, else its ruler, else its first officer. It is the same function
  `diplomaticAnswererOf` uses to address a letter to a power, so the sheet and the engine cannot disagree. A letter to somebody
  else is allowed and is stamped `decidedBy`; the person written to answers "countered", saying who decides, and nothing is
  opened or refused (no trust moves).
- **Pacts are bargains.** `trade_offer` carries `trade` (cap, most-favoured, exempt) and `forDays`. Sending agrees nothing.
  The answerer's yes opens the pact through `bindTheAcceptance`; accepted over a pact already standing it revises that pact in
  place (the same record, new terms, the new letter as its source). Lifting an embargo is a pact offer: a pact opened over an
  embargo ends it. A refusal opens nothing.
- **The answer is the model's, and the verdict is counsel.** A letter is answered by the model at the moment it is sent (below).
  `trade-verdict.ts` is what the rules would say, and is put in the answerer's section as "what your interests and nature say"
  (`adviceOnALetter`); the model's yes, no or terms of its own stand, even against it. Only one thing is held by the engine: a
  letter to somebody who does not decide it is answered "countered", pointing to the one who does (`holdAnswerToAuthority`).
  The rules still answer, unchanged, letters between powers nobody plays (`answerByRule`), never one to or from the player.
- **The verdict** is `trade-verdict.ts`, deterministic, the same every time it is asked: the customs given up (the cap against
  the answerer's own rate, times 0.6 plus 0.8 of the share of its inbound trade that comes from the writer; each good let in
  free costs 150), against what he will bear (700 bp, plus 6 a point of trust, 5 of his liking, 700 for a hand that is not
  greedy, 300 for the sociable, 350 where its own bread is short; less where he laid an embargo himself). A war refuses; trust
  of -40 or worse refuses. Past what he bears but within 900 he answers "countered" with `counterTrade`: the cap raised in
  hundreds until he can keep it, most-favoured dropped, only bread free. The engine sends that back as a `trade_offer` of his
  own; a counter is not countered again, so a bargain is at most two letters. The model is told all this in the portrait line, and
  may take it or not.
- **Answered at send time, delivered on its day.** `POST /letters` applies the `diplomatic_message_send` and then calls the
  model once for the reader (`answerALetterNow`, `letter-reply.ts`; `apps/web/lib/letter-answer-now.ts`), whoever he is -- a far
  king, a clerk -- through the coin gate. The answer is decided then and kept on the letter (`heldAnswer`); the letter stays
  `awaiting_reply`, so nothing is opened by sending. On `comesOnDay` -- the road there and the road back -- the burst gives it as
  the reader's own act (`heldAnswersDue`, `releaseHeldAnswers`), and a yes opens the pact then. The player is told "the answer will
  come in N days"; the commit records `modelCalls: 1`. If the call fails or the coins are short the letter stays pending as it
  always did, the player is told so, and the reader is asked in the next round that is paid for (`lettersOwed`).
- **Embargo is announced.** An embargo is one power's own act, so it cannot be accepted into being. `embargo_notice` is a
  threat of the ultimatum's kind (`onRefusal: "embargo"`): what it asks is yielded to, which lays nothing, or it is refused or
  goes unanswered and the sender lays the embargo it named (`carryOutTheThreat`, and `tick.ts` for silence, which breaks any
  pact that stood at `EMBARGO_BREACH_TRUST`). The answerer yields when the pain (his trade with the sender, more where bread is
  short) outweighs his pride. A bare embargo is still `agreement_open`.
- Tests: `a-trade-pact-is-written-for` and `a-letter-is-always-answered-by-the-model` (sim), `trade-proposal.test.tsx` and
  `letter-answer-now.test.ts` (web).

## Coinages (phase E, v50)

`packages/shared/src/world/coinage.ts`: each `Coinage` has an issuer, the powers that hold it, `silverBps` (silver in
one unit against the Attic drachma's 10,000), the `standardBps` it began at, a price level, a premium and a short
history. A balance stays in silver units; the face amount is silver over `silverBps` (`faceAmount`). The v50 table
(`PUNIC_COINAGES` in `packages/db/src/punic-wars-scenario.ts`):

| Coinage | Issuer | silverBps | Held by |
| --- | --- | --- | --- |
| Roman aes and silver | Rome | 7,300 | Rome and the foedus allies |
| Carthaginian shekel | Carthage | 9,000 | Carthage |
| Syracusan litra and drachma | Syracuse | 9,500 | Syracuse, Mamertines, Rhegium Campanians |
| Ptolemaic silver | Egypt | 8,300 | Egypt, Cyrene |
| Attic drachma | none | 10,000 | the Greek cities, leagues, Macedon, Seleucids |
| Foreign silver | none | 10,000 | everyone else |

**Conversion.** A sum crossing between coinages (`convertSilver`, used by `money_transfer`, tributes, obligations and
cargoes sold in a far power's coin) arrives less the exchange rate's difference (silver content times premium) and
`CHANGERS_FEE_BPS = 150`; the cut leaves by the `abroad` door as a second line, so the audit balances. A sum inside one
coinage moves whole.

**Debasement.** `coinage_debase` is a fiscal act through the same wiring as `tax_policy_set`, only the issuer's own
government. A step is at most `MAX_DEBASE_STEP_BPS = 2_500`, never below 4,000 or above 11,000 of the standard, and no
oftener than `COINAGE_COOLDOWN_DAYS = 60`. Debasing credits the treasury a **seigniorage** through its door: a
`RECOINED_SHARE_BPS = 3_000` share of the coin in the issuer's countries times the fall in silver; re-coining costs the
same. `packages/sim/src/coinage.ts`, in the monthly pass, moves the **price level** toward the ratio of standard to
silver (slowly at first, up to a tenth of the gap a month, half that downward; bounds 5,000 to 30,000) and the
**premium** a tenth of the way a month toward what the issuer's trade balance, war, arrears and price level make it,
within `MAX_PREMIUM_BPS = 1_500`. For a fifth off Rome's coin, the treasury gains 104,072 at once, prices stand at 102,
115 and 122 per hundred after 3, 12 and 24 months (heading for 125). An issuer at war and behind on debts is told once a
year its coin is strained; nothing is debased for it.

### Mercenaries and the coin

A hired company (`ServiceContract` role `mercenary`, `packages/shared/src/world/mercenary-pay.ts`) is paid in its employer's coin
and judges it by its silver. Its wage is indexed to what the coin was struck to hold (`silverShortfallBps`: a coin a fifth short
costs a quarter more units), plus 5% of the wage for each period gone unpaid, to +50% (`mercenaryWageBps`, applied in the
obligations pass of `tick.ts`); a late wage is waited for two periods in sound silver and one fewer for each tenth of silver lost,
none at a fifth (`mercenaryGracePeriods`, `contracts.ts`: past it the company walks and its force goes back to its captain); while
it waits, its morale and desertion run faster by `mercenaryTemper` (1 + deficit/50%) and it has none of an army's patience. The named
men's shares of an army's pay now pass the money-changers into their purses like any other sum crossing coinages. Test:
`a-mercenary-wants-good-silver.test.ts`. What it follows: Carthage struck its first coin in Sicily about 410 BCE to pay the soldiers
it hired there (the Siculo-Punic tetradrachms of the "Camp" mint, probably Entella, on the Attic weight because Greek and Italian
mercenaries were used to Greek silver; some struck at Carthage and shipped over); the Mercenary War (241-238) began as arrears of
pay owed some twenty thousand foreign soldiers after the peace of 241, with 3,200 talents owed Rome (Polybius 1.65-68), and by its
end the treasury struck billon; Rome's stipendium was two obols a day to a foot soldier, twice that to a centurion, a drachma to a
horseman, less stoppages (Polybius 6.39). Sources: Hoover, *Handbook of Greek Coinage: Sicily*; the Coinweek and Australian
Numismatic Society notes on Carthaginian coinage; Polybius; Wikipedia, "Pay (Roman army)".

## Grain bought, and bread by contract (v58)

**The treasury buys grain in a dearth** (`packages/sim/src/grain-purchases.ts`). A dole out of the chest was money given to nobody. The aediles' dole (`magistrates.ts`, `theAediles`; `apply/benefaction.ts`) is now, where the hub is at `RELIEF_PRICE_BPS` (120 in a hundred of the base) or more and the markets round it hold more than they need, grain bought: `sourcesFor` takes the hubs within `BUYING_REACH_KM` that hold more than their target, are not shut by a siege, a blockade or an occupation, are not an enemy's and are not closed by a pact or an embargo on grain, the cheapest landed first (`CARRIAGE_PER_100_KM` on the price); `buyGrain` draws on their stock (their prices rise by what is taken, one buyer taking at most `BUYERS_SHARE_OF_SPARE` of a hub's spare) and pays each leg through the `market` door; the grain is a `GrainShipment` in the economy's memory, on the way for the days the road says (`SHIP_KM_PER_DAY`, `HANDLING_DAYS`), and `landShipments` (in the tick beside the convoys) puts it into the hungry hub's stock, or loses it if the hub has been shut by then. At most `RELIEF_MONTHS` of what the hub's country uses is bought. Where nothing can be bought the dole is given as it always was. `the-treasury-buys-grain.test.ts` pins it, with the money audit.

**An army is fed by contract** (`packages/sim/src/army-victualling.ts`, `force_provision` with `how: "contract"`). The armies of the Republic were victualled by the companies of the publicani: the Spanish armies of 215 were fed by companies that undertook it for a price and were paid when the treasury could (Livy 23.48-49), and the same companies were found out in the false wrecks of 214 (Livy 25.3). The officer who feeds the armies (`theSupply`) lets the feeding of an army of `CONTRACT_FROM_MEN` or more that has run hungry to a firm of its own power that has the means (`housesFor`), for `CONTRACT_DAYS` (six months), a smaller army still being bought for by the chest. The contract is a service contract of the role `victualler`, the head of the firm the man hired, the treasury the employer, the price for every thousand man-days of bread that reaches the army fixed that day at the market's price and `MARGIN_BPS` (fifteen in a hundred). Each month (`keepVictualling`, after the firms' cargoes) the pay is reckoned on what arrived and the obligation's amount set to it, so bread taken or lost is not paid for, and the firm buys the next month's bread from the cheapest hubs it can reach (the same `buyGrain`, out of its own purse, never more than `HOUSE_SHARE_OF_PURSE` of it) and sends it as a convoy of the contract. The convoy goes by the same road and the same risks as any (`grain.ts`: an enemy at the army's door takes it, the more surely if the army is penned, and a firm's ship has the chance of loss any cargo of a firm has, `voyageLossBps`); a loss is the firm's, and is written against it (`losses`). If the chest cannot pay, the firm waits the periods a hired company waits in sound silver (`mercenaryGracePeriods`; none once the coin is debased) and then stops: `keepContracts` lapses the contract, as it lapses any hired man's, with its own words, and the firm is out of what it laid out. The army's own officers fall back to the chest's purchase if the bread is three weeks late (`SUPPLY_LATE_DAYS`). The act is judged as spending (`competence-gate.ts`: the amount is the term's), so a six-month contract is the Senate's to vote where the consul may not do it alone. Example (`scripts`' probe of the opening): the field army of 8,860 men, a month's bread 24,985, a six-month contract 149,910 out of the chest at 94 for every thousand man-days; the publicani of the Aerarium buy a month's bread for 22,391 and are paid 24,985 for it when it arrives. About a millisecond a month a contract, and one search of the hubs about as much. `a-house-victuals-the-army.test.ts` pins it, with the money audit over the term.

## Firms and their names (v58)

The code keeps `MerchantHouse` and `HouseKind`. What a player or a model reads does not say "house" of a firm: a gens and a royal house own the word (`docs/plans/gentes.md`), and a firm is called what its own people called it (`firmNameFor(kind, culture)`, `packages/shared/src/world/firm-names.ts`; `firmCultureOf` reads the culture from the power whose law the firm lives under). **Rome**: the *publicani* (a *societas publicanorum*, a company that takes the state's contracts, rents and taxes: Polybius 6.17, Livy 23.48-49), the *negotiatores* (merchants, who lent on the side), the *argentarii* (private bankers, who take deposits, change money and act at auctions; the *mensarii* were the state's, the *nummularii* assayers) and *mercatores* (small traders, often freedmen). **The Greeks**: *emporoi* (merchants who sail with their goods), *naukleroi* (shipowners, in the main emporoi who own hulls), *trapezitai* (bankers, from the *trapeza*, the table), *sitonai* (buyers of grain; at Athens an office of the city too), *telonai* (tax-farmers). **Carthage and the Phoenician cities**: the Greek and Latin writers call their merchants *emporoi* and *mercatores* and the sources give no Punic name for a firm; the one Punic word sometimes read as "merchant" (*gugga*, in Plautus, and perhaps an inscription of Cirta) is doubtful and is not used; a Punic firm is "merchants", "shipmen" or "grain-merchants", with the doubt carried in the table (`uncertain`). **Egypt**: banking was the king's, the royal bank (*basilike trapeza*) under the *dioiketes*, with private *trapezitai* licensed beside it; the firm of bankers at Alexandria is a licensed one, never the crown's bank. The seventeen firms of the opening are named so (the emporoi of Kallias, the naukleroi of Lysis, the sitonai of Dion, the trapezitai of Neapolis, the merchants of Bodashtart), and a firm founded by rule or without a name is "The {folk} of {owner}" (`firmTitle`); refusals and news say firm and company. Sources: https://en.wikipedia.org/wiki/Banking_in_ancient_Rome, https://www.worldhistory.org/article/974/banking-in-the-roman-world/, https://brewminate.com/business-and-commerce-in-ancient-rome/ (the Roman words); https://bmcr.brynmawr.edu/?p=85372, https://www.degruyterbrill.com/document/doi/10.1515/jah-2015-0005/pdf, https://www.penn.museum/sites/expedition/traders-and-trading/ (emporos and naukleros), https://www.worldhistory.org/article/115/trade-in-ancient-greece (the sitones); https://en.wikipedia.org/wiki/Punic_people and https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5245619/ (the Phoenician and Carthaginian merchants). `the-firms-keep-their-period-names.test.ts` pins it.

## Scenario versions

v47 puts money at the age's scale and tags every door; v48 adds development, scars and tax regimes (Syracuse opens on a
tithe); v49 adds goods, hubs, flows, customs and Rome's two pacts; v50 adds the coinages. v51 (taxes by province in
`punic-wars-taxes.ts`) sits on them, v52 sets the income to the army-cost rule and v53 gives the allies chests; v54 seats the merchant houses and v55 writes who may do what (government, H1). Notes for each are in `packages/db/src/built-in-versions.ts`.

## Where things live

- Shared types and rules: `packages/shared/src/world/economy.ts` (memory, pay, prices), `world/markets.ts`,
  `world/agreements.ts`, `world/coinage.ts`, `material/province-material.ts`, `material/tax-policy.ts`,
  `material/taxation.ts`.
- Engine: `packages/sim/src/economy.ts` (calendar), `markets.ts`, `trade-flows.ts`, `customs.ts`, `treaties.ts`,
  `coinage.ts`, `money-audit.ts`, `trade-summary.ts` (the slice's trade lines and news), `slice.ts`.
- Readers for the treasury: `packages/shared/src/material/regions-view.ts`, `trade-view.ts`, `books.ts`.
- Scenario data: `packages/db/src/punic-wars-scenario.ts`, `punic-wars-taxes.ts`, `punic-wars-houses.ts` (the merchant houses).
- What it spends: `packages/sim/src/the-upkeep-of-a-state.ts` (the two bills), `keeping-the-state.ts` (the month's pass and the contracts), `public-works.ts` (which work, where), `packages/shared/src/world/keeping.ts` (what is remembered).
- The people who manage it: `packages/sim/src/fiscal-officers.ts`, `merchant-houses.ts`, `house-voyages.ts`, `house-succession.ts`, `house-seat.ts`; the kit for their tests is `fiscal-test-kit.ts`.
- The sanity run: `scripts/economy-sanity.mts` (`npm run sanity:economy -- 10 [--war]`) runs the real monthly tick with a
  model that never acts and checks the targets together: nothing unexplained, populations steady, grain in band,
  development diverging, price levels bounded.

## Extending it

- **A new good:** add its id to `good-ids.ts`, a `GoodSpec` to `GOODS`, and a land-haul figure to
  `LAND_HAUL_BPS_PER_100_KM`; `GOOD_COUNT`, hubs, flows, views and the audit follow. Tests: `a-market-sets-a-price`.
- **A new tax regime:** add it to `TaxRegime` (`material-state.ts`), the `tax_policy_set` enum, `regimeFactor`,
  `REGIME_RESENTMENT_BPS` and `REGIME_LEAK_SCALE`; mind the open decision below. Test: `a-tax-regime-is-chosen`.
- **A new agreement term:** add it to `TradeTermsSchema`, read it in `tradeTermsBetween` (and `customsOn` if it is a
  tariff), and show it in `trade-view.ts`. Tests: `a-trade-pact-lowers-tariffs`, `an-embargo-cuts-trade`.
- **A new door for money:** add it to `EXTERNAL_MONEY_KINDS` and `money-audit.ts`; `the-books-balance` must stay clean.

**The `men` regime and the allies' chests (v53).** `men` yields the overlord no money, but it is not the end of the
holder's own taxes: a city of the foedus kept its own chest, magistrates and land levy, and sent men on top. In a `men`
province the holder raises its ordinary land levy (`moneyRateBps`, always `DEFAULT_TAX_RATE_BPS`; the policy's own rate is the
rate of the tribute of men) times 0.6, for its own treasury; the other two fifths (`MEN_LEVY_RESERVE_SHARE = 0.4`) is what
the call-up consumes. The money leaks with distance as a land levy; the men do not. v53 gives each of the eight allies a
treasury (four months of levy), a levy source (Etruscans 100,000 a month, Apulians 116,000, Umbrians, Picentes and Marsi
40,000, Lucanians and Bruttians 48,000, Samnites 21,000, each about 0.30 of what its provinces bear) and an upkeep
obligation of four fifths of it; `an-ally-keeps-its-own-chest.test.ts` pins it. A consequence: allies now have a
`taxBurdens` entry, so the manpower shift a tribute of men gives the rolls (`provinceManpowerShift`, applied in
`tick.ts`) now reaches their provinces, which it never did while they had no burden. A `men` province's resentment is
unchanged.

## Who manages the economy (v54)

Until v54 the economy ran itself: the world AI made wars and peaces and had nothing to say about money, a power's tax rate stood
where the scenario left it, and trade was an invisible aggregate between hubs. Two rule-based layers, with no model call, now
manage it. Both are deterministic (`stableHash` only), aggregate (a handful of rows, not a person a province) and bounded.

**Fiscal officers** (`packages/sim/src/fiscal-officers.ts`). Once a month, in the world AI's pass (`statecraft.ts`, step 4,
`decideFiscal`), every power nobody plays has the man who keeps its books read them: the head of the department that holds
the tax roll (a quaestor of the Treasury of Saturn, an officer of the Carthaginian Accounts), else any man of it, else the
ruler. Never for the player's own power or one he rules (`excludedPolityIds`). A man the model is playing keeps his books by the rules too, as his standing business (Hiero at Syracuse and the chief of the Mamertines are their own officers), unless the model has itself set the money of that power in the last 60 days: its act is on the competence gate's marks (`ActMark`) and the rules give way until the season has run (`played-ruler-books.ts`, `a-played-ruler-keeps-his-books`). He reads cover
(the chest over what the power pays a month), arrears, the deficit, war, grain in its hubs, the share its rate asks of what the
land can bear (`taxBurdens`), the trade flowing in, and its coin:

| Act | When | Bounds |
| --- | --- | --- |
| tax (`tax_policy_set`, polity) | strained (arrears, or under 2 months of pay in the chest and a deficit): raise a step; flush (over 8 months, surplus, peace): ease a step back toward the ordinary rate, no lower (only a restless people takes it lower, to 800); a famine in a third of its markets under a land levy: a tithe; none for a people that owes men (`men`) | steps of 200 bps (250 or 400 for a poor officer); ceiling the customary 1,200 in peace, 1,800 in war, 2,200 in extremis; never past 0.8 of what the provinces can bear; 90 days between raises, 180 before easing |
| customs (`tax_policy_set`, customs) | bread dear in a quarter of its hubs: cut a step; strained and trade strong: raise a step | 250 bps, 0 to 1,500, 60 days |
| credit (`loan_open`) | at war, strained, under a month of pay, a deficit: borrow from the merchant houses of its own power (under a third of a house's purse, 1.5 to 2% a month), the rest from bankers abroad (2.5%) | 150 days between; stops at 6 months of pay owed |
| coin (`coinage_debase`) | in extremis only (war, arrears, under half a month, the tax at its ceiling): strike 15% lighter, never below 0.6 of the standard; at peace with 6 months in the chest, re-strike a tenth better | a year between |
| trade (`agreement_open` pact, `agreement_close` embargo) | two powers nobody plays, at peace, trade of 25,000 a month each way, both laying customs above 6%: a pact capping them at 6%; an embargo older than 18 months at peace is lifted | one new pact a month in the world |

**The man matters.** His quality is his skill at the tax roll plus `officeTemper` (up to 14 points either way). A poor one acts
late (the chance of acting in a month is `35 + 0.65 q` per cent, 25 more in an emergency), in coarse steps (250, 400 bps), and lands
off the rate he meant by up to 150 bps. His greed is the existing mechanic's: what passes through a greedy officer's hands is
skimmed (`departments.ts`) and an audit finds it; here he is only named in the news, with "Men do not trust his hands" for a
greed of 60 or more. The act is his: the burst applies a fiscal decision as the power's standing business (`ProposalPass.sanctioned`,
`sanctionedDeltas`), because a quaestor's office holds the proposal and not the rate: the same rules of money, reach and the audit,
with the authority taken as given. One decision a power a month, one fact at most (and only for a power with something live in it,
`liveProvinceIds`; pure customs nudges make none); the log keeps what was done (`STATECRAFT_LOG_MAX`) and the cooldowns are read off
it. One line in the slice (`accountsNote`, "Its accounts: ...") for two months after, for whoever is given that power's page.

**Merchant houses** (`packages/sim/src/merchant-houses.ts`, `house-voyages.ts`, `packages/shared/src/world/houses.ts`,
`packages/db/src/punic-wars-houses.ts`). Seventeen houses in `economy.houses`, each a head (an ordinary character with a purse: the
house's capital), an heir he names, a home market and a lean: Rome's publicani and a banker of Neapolis; four Carthaginian houses of
the Tyrian-descended families (Carthage, Utica, Hadrumetum, Lilybaeum); Gades, Syracuse (two), Massalia, Rhodes, Athens, Alexandria,
Tyre, Tarentum, Ephesus. Capital 95,000 to 380,000 (3.3 million in all; a senator's purse is 24,000). Names where the sources are
silent are generic.

Once a month (from the tick, after the markets and customs) a house with room (at most `MAX_VENTURES_PER_HOUSE = 3` afloat, two
opened a month) and money to spare (a reserve of 35% of its purse, a cargo at most 28% of it and 36,000) reads a price table once,
takes the pairs of ports within 1,700 km of its trading hub in both directions, drops those closed by war, embargo, blockade or
occupation, and ranks the rest by the gap in the best good's price (only goods the hub has stock to spare of), the voyage's days, the
risk and the duty. It buys the goods out of the hub's stock (`drawStock`), sends them as an ordinary `TradeVenture` with a `cargo` (a
single sailing), and when it lands the far hub's stock gains them (`addStock`). Landing (`cargoes.ts`) gives a house's cargo what a
voyage had: a chance of loss (90 to 400 bps by sea and days, 350 more where war has reached either end; the cargo is gone and the
venture closed), the crew's share (6%, the `the_unnamed` door), and the duty of the power it lands in, less any pact (the `market`
door both ways, and into `customsDue`). Houses pay a household (1.1% of the purse a month, `the_unnamed`) and a liturgy to their
treasury (6% of what each cargo clears over its cost, an ordinary transfer: a power's tax rolls count none of it) so their capital stays bounded. The head ages and dies by the ordinary mortality; the estate
passes by `settleEstate`; the house goes on under the heir he named, and is wound up with nobody to follow him (and who is named, below). Cargoes sold or lost
two months ago are dropped from the world's list.

**Who follows the head** (`packages/sim/src/house-succession.ts`, looked to once a month before the cargoes, for any head whose named heir is
dead, carried off or gone to another power, so the second head of a house has an heir named within the month if a man can be had):

1. *A kinsman.* The nearest living man of the head's blood or marriage in the family graph (sons, brothers, cousins and nephews, sons-in-law, to the third
   degree; of full age, not past 58, of the head's power, not barred) who is fit for a counting-house (`merchantFit`: 30% wealth drive, 25% honesty,
   30% stewardship, 15% care for risk; at least 36) with honesty 28 or more, and whom the head thinks no ill of (his opinion above -25). Sons before brothers,
   brothers before the rest, then the fitter, then the elder. He is named heir; nothing else changes.
2. *Adoption.* Where there is no such kinsman the house asks, at most eight in turn: the man who keeps its books under a `steward` or `agent` contract; its
   freedmen; its clients (social links); then the men of its power with no office, no army, no sons of their own and no great standing (those of its own city
   first). Each must be younger than the head, fit (48), honest (28) and not disliked (opinion above -20). Each answers by his own nature: a willingness of
   35 + 0.45 (wealth - 50) + 0.35 (status - 50) + 0.2 (family - 50) + 0.15 (duty - 50) + half his opinion of the head (to 30) + a bond (freedman 20, steward 15,
   client 10), and he accepts when a roll fixed by the house, head and man (not drawn afresh each month) falls under it. The man who accepts takes the head's
   name (Rome: his own praenomen with the head's nomen and cognomen, and the order the name gives; elsewhere "son of" the head), becomes the head's child in the
   family graph, is tied to him by a `kin` social link and a life contract of `adoption_or_heir_designation`, is paid a son's portion out of the head's purse (3%,
   400 to 6,000: a transfer between purses) and his contract of service ends. The head names him heir. When the head dies the estate goes to the heir he named, and
   so the purse and every cargo afloat are his; the house is his from that month and he, in turn, has an heir named within the month.
3. *A new man*, which is the rare branch: only where there is neither, only after the head has gone half a year unfollowed, and then by one throw a year weighted
   by what the house is worth and the head's standing (1,200 + capital/80 + prestige/8 of 10,000: about three in ten for a house of 150,000, never under 5 or over
   60 in a hundred). On a pass the head either takes a factor found in his market by the hiring-market machinery (`hireAtThePlace`, younger than the head, adopted as
   in 2) or sends for a young man of another branch of the family (19 to 24, with 3,000 of his own, tied to the head as a relative and named as in 1; the brief asked for a minor
   kinsman: a boy could not keep the books, so he is of age). Each arrives with an endowment, the one door by which the books let a man bring money into the world.
4. *Wound up.* A head who dies with nobody named leaves an estate with nobody to take it: `settleEstate` pays his creditors first (below), sends what coin is left to
   his power's treasury, closes the cargoes, and the house is ended. So is a house whose head's heir abstained from an estate that owed more than it held (`estateWasSoldUp`). A head who is the last of his line is therefore ended only by his death, never by his having no heir yet.

Since v57 each of the seventeen houses also has the man at its books, seeded with a purse (1,500) and a contract of service: at Rome a freedman who bears his patron's praenomen and
nomen (`Titus Sicinius Philargyros`, `ownerCharacterId` the head, `steward`), at the Greek and Punic firms a factor (`Nikon son of Apollodoros`, `agent`), 31 to 39 years old, able and honest. Adoption
asks him first, so a house with no son has a man before it looks further, and the new-man branch is rarer than it was.

In the Punic opening a house is made of a head and an heir with no family about them, so kinsmen exist only where the engine has made them (the kinsmen brought in
under 3, whose families then become kin to the house). Sixty months of the Punic opening, with the lives as they fall: two heirs died among the seventeen houses and
both were made good (one adopted, a man of Carthage; one a young man of another branch brought in); no head died, so none was wound up. The worst case, every house's heir
dead in the second month and every head in the twentieth: three adoptions, one kinsman (of the family a new man had founded) and twenty-five new men over the sixty months
(the pools of men free of office and army are thin in a world whose people are mostly notable), fourteen houses followed their heads, and three were wound up (their new men
had not come by the throw before the head died).

**Houses are founded** (`packages/sim/src/house-founding.ts`, the `house_found` delta). A world with seventeen houses and nobody to found another lost one with each wind-up for ever. Two doors, one row:

- *By rule*, once a month (`economy.housesLookedToAtStep`, run from `keepMerchantHouses`; cost O(characters) with the cheap tests first). A man who is free, male, 25 to 66, no soldier, not the head or
  heir of a house, and not the man the model plays, whose purse is past `18,000 + 700 x (age - 25)` (to 40,000), who has a merchant's mind (`merchantFit` 52 or more, a wish for wealth 55, honesty 30,
  risk 25 to 85) and lives in a port town of a power that acts as a state (cohesion 5,000 or more: a confederation of tribes has no counting-houses), has each month a chance of 1.5% to 8% (by fit and by wish for wealth) of founding, by `stableHash` of him and the month. A man
  with an office, or a figure of the state (standing past 4,500), founds it under an agent: at Rome the lex Claudia of 218 BCE that barred senators from sea-going trade is later than the age and is not applied,
  but a magistrate's trade went through his freedmen and clients all the same, so a freedman is made (a factor elsewhere) to keep the books, tied to him by a `patron` link and a `steward`/`agent` contract, and
  60% of the patron's purse (at most 120,000) is moved into the freedman's purse (a transfer). Any other man is his own head and his purse is the house's capital; his kin are looked to for an heir at once
  (`findKinsman`), else by the line's own rules (`house-succession.ts`).
- *By order*: `{ op: "house_found", name, kind, headRef?, heirRef?, homeProvinceId?, capital, reason }`. Always a private man's act out of his own purse: a power cannot (it has no purse that is not the
  state's), nor can a man for another's purse, a slave, a head or heir of a house already, nor at a place with no market and no port within 260 km; the capital is at least 5,000 and a man who keeps the
  books himself puts his whole purse behind it. It is the actor's own business (`own-business.ts`): no breach is recorded.

Limits: one founding a month and two a year for any power by rule (three a month in all), 60 houses trading at once (`MAX_TRADING_HOUSES`; the list holds 80, wound-up houses are dropped after two years). One fact for
each founding (`house_founded`, significance 28). The founded house has its `actedAtStep` set to the day, so its first cargo comes a month later; from then on it is a house like the rest, in `houseFolkOf` and out of the
model's room. Tests: `a-house-is-founded.test.ts`.

**The creditors are paid first** (`packages/shared/src/characters/estate-creditors.ts`, called from `settleEstate` for every dead man, not only house heads). Before his heirs or the treasury have anything:

1. *What he owed and left.* The loans on his purses against his coin, his land (ten years' rent) and the cost of the cargoes he had afloat.
2. *Accept or abstain.* An heir takes an estate that covers its debts (Rome's universal successor, who answered for them, here to the extent of the estate). Where the debts are more than the estate holds, or there is no heir, the estate
   is sold to the creditors (the `sui heredes` could abstain by the praetor's `ius abstinendi`; any other heir could refuse, and the creditors had it sold up, `bonorum venditio`). The heir who abstains keeps the name and
   the friendships and feuds it carries, and the dependants, and nothing else; a house whose head's heir abstained is wound up.
3. *The order, out of his coin:* the secured first (a loan with land pledged for it; in a sale the creditor also takes the pledge at its value, rents and all), then the public debts (a power's treasury: the fiscus's privilege), then the private
   loans, men's and foreign bankers', in proportion to what each is owed. A payment is a transfer between purses; a foreign banker's leaves by the `credit` door, so the audit is where it was.
4. *In a sale* what coin did not cover is met out of the land and the cargoes, given to the men still owed, the largest claim first, at their value (a treasury is paid in coin, or by a pledge's rents, not by land).
5. *What is left.* A debt beyond the estate in a sale is lost to the creditor (the loan is `defaulted`, its instalments end); where the heir took the estate he takes the rest of each loan with it, the loan and its instalment now on his purse
   (and an authored rule that forgives debts loses it to the creditor instead). What the dead man lent goes to his heir, else to his power.

One fact per death with loans (`estate_creditors`): what was owed, how it was settled, what the creditors had, what was lost. Tests: `the-creditors-are-paid-first.test.ts`.

**Where the house sits** (`packages/sim/src/house-seat.ts`). A house is its head's. Each month its `polityId` is the power its head belongs to (so a
head who changes his allegiance takes the house's lending, its liturgy and its customs with him: lending reads `polityId`, a cargo's liturgy and duty read the
owner's), and its seat follows the city it trades from. The house remembers who held its city (`seatPolityId`); when that is no longer who holds it:

- the head's own power holds it now, or it is an ally's garrison in a city whose owner is still the head's: nothing moves;
- a power at war with the head's has taken it: the head and his named heir go to the nearest port market of his own power that is not occupied (the house is seated there)
  and the move costs an eighth of the purse (freight, bribes, goods left on the quay, by the door of the men nobody names); where the power has no such market the
  house is plundered and ended, half of the head's purse to the treasury of the power that took the city (a confiscation) and the cargoes lost;
- a power not at war with the head's holds it (ceded, sold, left by a peace): the house stays, and the head's allegiance and his heir's go with the city, so
  it lends, pays its liturgy and its customs to the new holder; but a head whose duty is 65 or more will not change his power and goes, as above, to a market of his own.

Tests: `a-house-finds-an-heir.test.ts`, `a-house-follows-its-city.test.ts`.

**Merchants improve the trade, not only their purses.** A hub with houses has a *lift*, `1 + 0.5 x min(1, capital / 800,000)`
(`merchantLiftByHub`): trade flows (`trade-flows.ts`) carry up to that much more on its routes and what its merchants can send out
grows with it, and the haul is cheaper by `0.55 x (lift - 1)` (credit, insurance, better ships): a fifth at the most. The houses' own
cargoes move real goods between stocks, and the officers ask them for credit.

**Out of the model's room.** House heads and heirs are `background` people to the cognition policy unless the player's own circle
touches them (a relation, a letter, a loan he took: `cognition-policy.ts`), and in no cast unless salience puts them there; they add
nothing to the slice.

**Performance** (the Punic opening, this machine, noisy): the monthly tick averaged about 52 ms without houses and 70 ms with them
(the houses themselves 1 to 2 ms a month; the rest is landing seventeen houses' cargoes through `cargoes.ts` and more people to
age); the officers' whole pass is about 6 ms; a year of the land is unchanged. The budgets are held by
`the-books-are-kept-in-good-time.test.ts` beside `a-thousand-provinces.test.ts`'s.

**What it did** (24 months, houses against none, same seed): 667 cargoes (20 lost, 3.0%) worth 13.0 million drachmae of goods bought out of the
hubs' stocks; cross-power trade +1.9%; the treasuries +0.1% (Rome), +0.6% (Carthage), +0.4% (Syracuse) from customs (252,000) and
liturgies (93,000); crews and households took about 1.0 and 1.1 million from the houses' purses, and the houses' capital grew from 3.3 to 4.2 million. A shortage
at Utica is made good in nine months where it took twelve.

**Not built:** buying grain for a hub from the treasury, and supply contracts for armies (`service_contract`); the officers' remedy
for bread is a lower tariff and a tithe, and the houses carry grain to the dear hubs by the price gap (a dear-grain gap is given a
bonus).

## Who may do what (H0)

An act of the economy -- the rate of the tribute, the customs, the silver in the coin, a loan, bread for the people, a pact, an embargo, the levy, war, peace, an appointment, a draw on the chest -- is
no longer anybody's whose office looks fiscal. Whether a man may do it is read from his power's constitution (`competenceOf`, `packages/shared/src/authority/competence.ts`): **alone**, **with a colleague**
(either may act, the other may stop it), **by the body** (laid before the chamber that holds that power) or **forbidden**, from the chambers' powers (now with `coinage`, `treaties`, `finance` and `levy`), the offices'
kind, seats and vetoes, the levers of the department he staffs and his treasury reach. The details, the per-power readings and what is not yet built are in `docs/plans/government.md`, "H0 as built".

The player reads all of it for his own office in the seal case, on the ribbon **Your charge** (`readOffice`, `packages/shared/src/authority/office-view.ts`; `docs/plans/government.md`, "H5 as built"): what is his alone, with his colleague, the chamber's and not his, the figure within custom, the year's allowance, and each act drafted as an order for the desk.

What it changes in the acts above (in `apply-deltas.ts`, through `apply/competence-gate.ts`):

| Act | Within his charge | Beyond it |
|---|---|---|
| `tax_policy_set`, rate | a treasurer or a head, with his colleagues, up to 12 in a hundred (`CUSTOMARY_TAX_RATE_BPS`) | laid before the chamber that holds the taxes (the Senate; Carthage's council); a king holds it alone |
| `tax_policy_set`, customs | a head up to 15 in a hundred, a treasurer up to 10 | the chamber's |
| `coinage_debase` | a king; no republic's magistrate | the chamber that holds the coin (the old bundle of taxes) |
| `loan_open` (the state borrows) | a head 3 months of what the power takes in, a treasurer 1 | the chamber's |
| `public_benefaction` dole | an aedile or a head, 1 to 2 months | the chamber's |
| `agreement_open` / `_close` (pact, embargo, war, peace) | a king; the head of a power no chamber holds it in | laid before the chamber, as a war always was |
| `force_provision` bought or sent, `project_create` paid from the chest (H2) | the same allowance: a consul feeds his army and begins a work within his two months; a man with no office of the power is not weighed | the Senate's decree, laid for the player's order |
| `force_create` (the levy, H2) | a consul with his colleague, a praetor, a general; Syracuse's king | the chamber: Carthage's suffetes ask the Elders |
| `money_transfer` from the chest, or a hiring paid from it | `spend_without_vote` is an allowance of 2 months a year for a head, 1 for an officer, for each office | the Senate's decree; a department the Senate gates (the Treasury of Saturn) has none |

One decider to a season (the rate 90 days, the customs and the coin 60, a loan, bread or a pact 30): when one man has settled an act, another of equal or lower office may not settle it again until the season is out,
and what the chamber decreed no magistrate alters. A colleague who has interceded, or who thinks ill of him, stops a collegial act; a tribune stops the levy, the purse, the tribute, the coin and bread. What a vote has
carried, and the fiscal officers' own decisions, are not weighed again (they are recorded, so the next man's act finds the season taken). `mayAct(world, characterId, act)` is the helper for any pass that must act inside
a man's competence.

**Five charges**, levers a department may be given (`customs`, `mint`, `markets`, `credit`, `census`), each a multiplier near one by the skill of the men who keep it, and exactly one where nobody has been given it:
the share of the duty that reaches the chest (up to a fifth either way: `customs.ts`); the gain from a coin struck lighter, and how much of its bad name sticks to its premium (`apply-deltas.ts`, `coinage.ts`); how far a
hub's prices stray, and the hoards a famine price brings out (`markets.ts`); the interest the state is asked (`loan_open`); and what the tax roll and the muster count of the people (`material/taxation.ts`). Tests: `the-new-levers-bite`.

### Per culture (H1, v55)

The table above is the common run; the research's charges (`docs/plans/government.md`, "H1 as built") are written over it as data on the offices (`packages/db/src/punic-wars-charges.ts`) and on the form templates
(`sim/src/constitutions.ts`). What the player and the rules meet in each:

- **Rome.** The consul lays the tribute within custom beside his colleague; a rate past custom, a *new* tax (a tithe where there was a land levy), the tariff, every loan, the coin, bread and the treaties are the Senate's:
  he moves them there. The quaestors keep the books (the rate within custom; every draw is the Senate's), the censors the tariff within a tenth, the census and the harbour dues, the aediles the city's bread and the markets,
  the dictator all but the chest. No department keeps the mint (none existed in 270). Allies of the foedus have no war or peace of their own.
- **Carthage.** The head of the state is the two suffetes, who carry everything to the Council of Elders (the tribute, the coin, the loans, the chest, the treaties and the war); the officers of the accounts keep the books, the
  harbour dues, the census and the mint within custom; the commander in Sicily is a general (the levy, the army's coin, the field chest; the peace is the elders').
- **Kings.** Hiero and the Ptolemies hold it all alone; Egypt's dioiketes keeps the royal revenues, the dues, the royal bank and the rolls within custom and no further, its oikonomoi the granaries. A tribal chief has no
  standing tax and tolls his own route.
- **The men at the books** (`fiscal-officers.ts`) do only what their charge lets them: what is the chamber's they lay before it as a motion (a consul puts it), carry out what it carries and leave what is none of theirs.
  A quaestor of Rome cannot strike the coin lighter; a rate past custom is asked of the Senate, and the Senate may refuse it. Tests: `the-quaestor-asks-the-senate`, `a-magistrate-lays-no-new-tax`,
  `the-charges-follow-the-constitution`, `every-power-has-a-head-who-can-act`, `the-charges-match-the-sources`.

### The magistrates and the bodies (H2, H3)

The charges above are no longer only read when somebody writes an order: the men who hold them act, once a month, by rule (`sim/src/magistrates.ts`; docs/plans/government.md, "H2 as built"), through the ordinary deltas
and inside `mayAct`: the aediles' bread and games, the consul's *dilectus*, the allies' contingents and the bread bought for a hungry army, the praetor's case against a man an audit found out, the pontiffs' festival, the
censors' lustrum (a fresh roll counts the people a hundredth better, a stale one up to four in a hundred worse: `material/taxation.ts`), the consul's motion for lighter coin, the envoys a losing power sends. What is beyond a man's
charge is laid before the chamber (the same motion the quaestor moves); a greedy hand keeps a share (`skimTheHand`, found by audits); one who thinks ill of the head or is proud may refuse or delay (`defianceOf`).
The bodies sit (`sim/src/bodies.ts`, "H3 as built"): a chamber puts so many questions to a sitting and no more, does not sit with its city shut, holds at most ten open; the tribunes take sides by rule and a veto
stops the question; an augur's ill omens put off the people's business a month; war, peace and alliances of a republic are laid before the Senate (or the Elders) by its consul or suffete and made the month after they carry, the people
ratifying the war; a king's friends counsel, and he takes it or overrules it, paying in legitimacy when he goes against them. Tests: `an-aedile-watches-the-grain`, `a-consul-musters-the-levy`, `a-praetor-hears-the-case`,
`a-censor-takes-the-roll`, `an-embassy-is-received`, `a-magistrate-exceeds-his-charge`, `the-senate-sits-and-votes`, `a-tribune-vetoes-a-levy-in-session`, `an-augur-stops-the-business`, `a-war-needs-the-senate`,
`the-king-overrules-his-friends`, `the-104-judge-a-general`, `a-government-month`.

## What the model is left to

The model's calls are for the human drama. The routine government of a state is kept by its officers, by rule, and a person the model plays is neither shown it nor
allowed to settle it (`packages/sim/src/kept-by-the-officers.ts`):

- **Taken off the menu.** The cognition prompt says so in a short paragraph (`KEPT_BY_THE_OFFICERS`: tribute and customs, bread, the mint, upkeep, the merchant houses, loans and
  pacts between states are the officers'; a person's own work is ambition, rivalry, plots, marriages, patronage, factions, oaths, treachery, war counsels, letters, rhetoric, love and
  grudges), and the delta schema it carries no longer lists `tax_policy_set`, `coinage_debase`, `holding_create`, `holding_improve`, `trade_venture_open`/`_close`, `loan_settle`,
  the terms of a trade pact, or the offer of a state's loan (`ROUTINE_OPS`). The parser still reads them. The prompt came to 73.9k from 77.4k; its ceiling is 74.5k.
- **Set aside, quietly.** If he writes one anyway, `burst.ts` drops it before it is applied (no repair call, no refusal told to the model) and writes one line to the burst's
  `skipped` log with the stage `officers` ("a loan to a state: the officers keep it, by rule"). Dropped: the tax and customs, the coin, estates, ventures, a loan of or to a
  state (a `foreign` or `polity` lender, or a power's chest as borrower), a trade pact or embargo between powers neither of which is the player's, the works of a structure
  (`project_create` with a `structure` outcome), and the ending of a pact or embargo. Not dropped: `money_transfer` (bribes, patronage, ransom), `loan_open` between private men,
  `public_benefaction` (a dole given to win a city is patronage), war, peace, alliance, letters, plots, beliefs, marriages, offices, the levy and armies.
- **Never the player's.** The player's own order is read with the full schema and prompt, and a man he has put an order to (an attempt issued, received, accepted or delayed) keeps
  the whole menu while he serves it. Only the cognition pass is filtered (`ProposalPass.byModel`): the rules' own acts (the statecraft pass, the fiscal officers' `sanctioned` acts) are not. The orchestrator's `worldDeltas`
  are held to it by the engine too (`the-orchestrator-keeps-out.ts`, called where `burst.ts` applies them): the tax, the coin, a state's loan, a pact or embargo between powers, estates, ventures and the works of upkeep are set aside,
  logged under `officers` ("... not the world's to settle for another state"), unless the books are the player's: his own power's, a power he rules, or a man he has put an order to. The player's order (`deltas`) is untouched, and so are war, peace, letters, threads and bribes.
- **Not told the charges.** A model-played person's portrait does not list "In charge of: the tax roll ..." (`describeCharge`, `routineIsKept`); his own purse, debts, estates and
  pressures stay, as motives of ambition. Nor of the books' worries: in a played man's section the government's "worried about" lines and its "means to" lines that are about money, bread, tax, tribute, customs, the coin or the works
  are left out unless the state is in a crisis (below); the political ones (rivals, plots, legitimacy, war, faith, factions) stay (`management-talk.ts`). The orchestrator's STANDING AIMS lose the same lines for every power but the player's.
- **A crisis, when it is one.** The chest and the granary are told to a ruler, and to a captain of the power's armies, only when they have become a quarrel
  (`stateCrisisLine`): the soldiers' pay a month or more behind (`CRISIS_ARREARS_MONTHS`), bread at a famine price in a third of its markets, the coin holding under 85 in a hundred
  of its silver. Said once, in words of the age, with no figures but the arrears.

### Appointments by rule

The ambitions `wantDepartments` lays on a ruler (to hand part of the government on, to seat a treasurer, a watch, a keeper of grain) are no longer shown to a man the model plays (`describePlans`, `routineIsKept`); the player's own
section, when he rules the power, still has them as thoughts. The officers see to the charge themselves (`packages/sim/src/appointed-by-rule.ts`, called from `tick.ts` in the month's review, before `fillAppointments`):

- **Who.** Every organised power (cohesion past `LOOSE_COHESION_BPS`, three provinces or more) whose ruler is not the player, whether or not the model plays him: it is the officers' work, and the model is no longer told of it.
- **Why.** In this order: the chest in debt with nobody over the tax roll (a treasurer: `tax_roll`, `credit`); hunger with unrest and nobody over the grain (a keeper of the grain); a plot against the state's men found out or carried off and nobody
  keeping watch; a ruler whose workload is -9 or worse (he gives away first the purse, then the grain, the host, the harbour dues, the watch, the courts, whichever nobody keeps); and, for a king only and a year apart, the charges a kingdom has (the finance officer, the
  harbour dues where it has ports, the host).
- **How.** A king names his officers himself, so the ruler founds the department (`carryOutDepartment`, the same path an order takes, origin `pressure`, forming in 30 days, 60 for more than two levers or in a war) with one new office, in a Greek court's words
  (Dioiketes, Sitophylax, Epistates of the Harbours, Strategos of the Host, Archiphylakites, Epistates of the Courts) or a plain court's (Treasurer of the Realm, Keeper of the Granaries, Warden of the Harbours, Marshal of the Host, Master of the Watch, Chief Judge);
  `fillAppointments` then names the ablest man of the power to it the same day, by the lever aptitude of the work and his temper (never the ruler, the player or a man already sitting in a magistracy; none left, nothing is founded). The ruler's ambition for it is marked done.
  A power with a chamber that elects or assigns its magistrates invents no office: where its ruler's appointments are the chamber's (`mayAct`: Rome's consuls, Carthage's suffetes, grade "by the body") nothing is done, and where the head may name (a league's strategos, a republic's
  head with a colleague) the work is given to a post the power already has and has not placed in a department, if its name says one.
- **Rate and news.** At most one charge a power in 90 days and five in all, four across the world in a review (the powers shuffled by month, so the cap does not favour a few); one fact to the power ("X set up The Revenues to take charge of ... because ..."), and the
  department's own formed-fact when it takes its work. Pay is honorary, as an order's department is unless it says otherwise.

Tests: `the-model-is-left-to-its-plots`, `appointments-by-rule`, `the-orchestrator-keeps-out-of-other-states-books`.

## Where the money goes

Until this section the chests of the great powers only grew: in a peace nothing spent the surplus, and the sanity run's five years left Rome at 27.8 millions and Carthage at 113.9. Three sinks now stand against it, in one monthly pass
(`keepTheState`, `packages/sim/src/keeping-the-state.ts`, called from `tick.ts` after the merchant houses). Nothing in the pass makes money: every payment is a transfer between two accounts or a passage out through
`the_unnamed` (the masons, carters, clerks, public slaves and criers nobody names). Tax and pay are unchanged and nothing caps a chest.

**What it leaves in the chest.** A power keeps a floor, the larger of three months of what it owes by obligation and one month of what it takes in, and pays out of what is above it, in this order: the costs of government,
the upkeep, then the contractors. The army's pay and the offices' (`tick.ts`) are paid on their own days from the same chest, before any of it.

### 1. Upkeep (the general maintenance of what the power holds)

`upkeepByPolity` reads the provinces once, for every power at once (no pass for a province alone): for each province held and not occupied, **roads and bridges** (`ROAD_PER_DEVELOPMENT = 620` for each whole point of
development), **streets, drains, granaries, aqueducts, temples and halls** (`TOWN_PER_SETTLED = 92` for each unit of settled size, by `0.4 + development`, so a richer land has more to keep), **walls and watch-towers**
(`WALL_PER_LEVEL = 780` a level of each settlement's `fortificationLevel`), **harbours** (`650 + 38 x size` for each port) and, for a maritime power, **the docks** (`DOCK_PER_HULL = 70` for each warship at dock in a port; the crew's
pay is the army's). The month's bill is held to 15 in a hundred of what the power takes in (`UPKEEP_CAP_SHARE`): a people who owe the keeping of their land in labour and not in silver (the tribes, the allies who send men) are not
asked for more silver than they have. At the Punic opening: Rome 46,700 a month (9.3 of a hundred of its 500,000), Carthage 185,600 (12.7 of 1,457,000), Syracuse 22,900 (11.9), the Mamertines 12,100 (22, held to 15).

**Neglect.** A month in which under nine tenths of the upkeep was paid counts against the power (`StateKeeping.behindMonths`, kept in `economy.keeping`, one row a power); a month fully paid takes two back. After six months behind the
ceiling of development of every province it holds sinks a quarter of a point a month, to six points at most (`neglectShiftBps`, read by `provinceTargetsFrom` through the standing-effects hook `developmentShiftBps`): a province above
its ceiling sinks toward it a little each month (`ABOVE_CEILING_FALL_BPS`), so the decay is slow and it recovers the month the upkeep is paid. A year and a half behind, a wall slips a level (`fortificationLevel`, the most fortified
place of the power, once a year), and the power is told once a year when it has lost nine months (only a power with something live in it makes news). Test: `a-state-keeps-its-roads`.

### 2. The costs of the state

`costsByPolity`: the **apparitores** (lictors, scribes, criers) of each magistracy seat, more for the higher rank (`RETINUE_PER_SEAT = 200 x (1 + rank/4)`); **public slaves and clerks** (1.1 of a hundred of what it takes in); the **house of
each council and its keeper** (`800 + 70 x root of the chamber's weight`); the **games and the festivals** (`340 x root of the capital's settled size`, a half more where the power has aediles); the **rites and the priests' share**
(`150 x root of each priesthood's seats x 2`); the **lodging and the gifts of the envoys** of other powers (640 for each who wrote in the last month, at most ten, and 130 a month for each power it has an understanding with);
and a **king's court** with the keep of his friends (1.1 of a hundred of takings and 420 for each seat of an advisory council: Syracuse and the monarchies only). A Roman senator was unpaid, and so is none paid here: the
Senate costs its house and its clerks, not a salary for a seat (`the-state-has-its-costs` puts three hundred more seats in it and finds nothing changed); the pay of an officer of the accounts and of a department's men stays in the departments'
own pay (`departments.ts`) and is not counted twice. The bill is held to 6 in a hundred of takings. Rome pays about 27,000 a month (5.4 of a hundred); Carthage about 26,000 (1.7: its
constitution names few offices); Syracuse 11,500 (5.5); the Mamertines 3,300 (6).

### 3. Public works, let to the houses

When the chest has cover above a reserve (eight months of what is owed on top of the floor above, a half as much again in a war), the power has begun fewer than its year's share (`worksAYear`: none under 300,000 a year of takings, one,
two from 2.4 millions, three from 12; half as many at war), has fewer than two in hand and somebody who is not the player keeps its works (`whoLetsTheWorks`: the head or a man of the department that holds `public_works_cost` --
the Censorship at Rome, the Office of the Accounts at Carthage, the king's steward under a king), a contract is let, no oftener than every 75 days, and costing no more than half the cover. The Senate's and the Elders' leave is the standing
one of the budget: the rules start a work only inside a chest the treasury already holds. The player may still order any work as before: the project machinery is unchanged (a player's `project_start` is paid, overseen and completed as it was).

*Which work, and where* (`planWork`, deterministic by `stableHash`, only for a power that is due): the place first, by score: the capital (+3,000), the agglomeration of big towns around it (up to +2,000), the scar of war (0.6 of it), the settled size,
the room left to build (below development 6,000), less 1,500 for each lasting work already standing or in hand there; then the sort the place lacks and the age built there, by weight: a road (3; the Via Appia of 312 is the pattern), an aqueduct
(2, from a town of 24; the Aqua Appia of the same year), a harbour with its docks (2, a port), walls (1, where a city, port or fortress is under level 6; more where the place is scarred), a temple (2, from a town of 10; the vow from booty is
the capital's and the scarred places'), public granaries (2, a hub or a town of 12) and a forum with its halls (1, from a town of 30). Never two of a sort in a place (two temples may stand).

*Cost.* A share of a year of what the power takes in, by the sort: a road 8.5 in a hundred, a harbour 7.5, an aqueduct 7, walls 5.5, a forum 4, a temple 3.5, granaries 3, times 0.8 to 1.3 for the place's size (the capital's a tenth more), at least 6,000;
it takes 6 months (granaries) to 18 (an aqueduct) and is paid by instalments, one the day it is let and one a month after. Rome's opening takings of 6 millions a year make a road about 520,000.

*Contractors.* The house of the power (the publicani and the banker of Neapolis at Rome; four at Carthage; two at Syracuse), chosen by `stableHash`, is paid the price (the cost and 12 in a hundred, `CONTRACTOR_GAIN_BPS`) by an ordinary transfer from the treasury and
pays the cost out to the men who do the work (`the_unnamed`), keeping the gain; where the power has no house (the Mamertines) the whole cost goes to the men nobody names. A payment the chest cannot make in a month is made the next. A work
whose house has gone is paid on to the men nobody names, and a contract a year past its day with something owing is forgiven, so none is carried for ever. State: `economy.works`, one row a contract (80 at most).

*What stands.* On its day a structure is raised with a made thing's lasting effects (`world/standing-effects.ts`, `MADE` in `public-works.ts`): a road and a harbour lift the ceiling of development of their province by a marked 700 points, an aqueduct
and a forum a slight 300 (with a slight calm), a temple a slight calm and a slight legitimacy once, walls a slight defence and calm (and a level of `fortificationLevel`, which makes good what neglect let slip), granaries a slight food security and supply.
The trade flows already read development at both ends of a route (`trade-flows.ts`: a quarter dearer at no development to a quarter cheaper at the most), so a road or a harbour makes the haul cheaper by lifting the development of the hubs it serves, with
no other input. No `upkeep` is written on the structure: its keeping is the general upkeep above. **News:** one fact when a power lets a work and one when it stands, only for a power with something live in it, in the words of the age ("The Censorship
of Rome let the contract for ...", "... stands"); no line a province. Test: `a-censor-lets-a-contract`.

### What it comes to

Shares of what the power took in, by the sanity run (peace, a model that never acts, years 2 and 3; `scripts/economy-sanity.mts`): Rome upkeep 9.8, costs 5.4, works 3 to 7 (about 20 in all); Carthage upkeep 11.5, costs 1.6, works 12 to 16 (about 27);
Syracuse upkeep 11.5, costs 5.5, works 7 to 10 (about 25); the Mamertines upkeep 16, costs 6.5, works 5 (about 28, their upkeep held to the cap). The five-year chests, before / after (millions of drachmae):

| | Rome | Carthage | Syracuse | Mamertines |
|---|---|---|---|---|
| start | 2.79 | 18.6 | 1.61 | 0.78 |
| year 1 | 8.1 / 6.8 | 37.4 / 32.5 | 3.6 / 2.9 | 1.2 / 1.0 |
| year 3 | 17.9 / 14.1 | 75.7 / 59.4 | 7.6 / 5.5 | 2.1 / 1.6 |
| year 5 | 27.8 / 22.8 | 113.9 / 86.7 | 10.3 / 8.4 | 2.8 / 2.0 |

(The "before" run's Syracuse fell to 13 provinces by year 5; the "after" run's did not: that is the model-played books above and the world's own chance, not the sinks.) A peace's surplus is still large, because the sanity run raises no army and pays no
war: a chest of 3 millions in a real game is the Republic after its armies' pay, and there the cover above the reserve is what limits the works. Money audit over the five years: nothing unexplained (`the-books-balance`, the 36-month case).
The monthly pass costs about 3 ms on the Punic map (65 ms once, to read the map's sites, and again whenever walls are raised or slip, when the map's provinces are replaced).

**Not built:** a fortification level is the only thing neglect takes besides the ceiling (no road or aqueduct falls into ruin as a made thing); a work cannot be stopped by the Senate once let; and the player's own works are not let to a house (a player's order
is paid as it always was, through the project machinery).

## Tests that pin behaviour

All under `packages/sim/src` unless noted: `the-books-balance`, `a-market-sets-a-price`, `a-market-moves-grain`,
`a-province-trades-in-its-nearest-market`, `a-siege-starves-a-market`, `a-blockade-stops-the-sea-trade`,
`a-cargo-follows-the-markets-gap`, `a-war-torn-region-lags`, `a-tax-regime-is-chosen`, `taxes-the-land-can-bear`,
`the-office-and-the-roll`, `a-tariff-bites`, `a-trade-pact-lowers-tariffs`, `an-embargo-cuts-trade`,
`war-suspends-a-pact`, `a-power-hears-of-its-trade`, `a-coin-is-debased`, `a-foreign-payment-is-changed`,
`the-treasury-reads-the-land` and `a-thousand-provinces` (the cost budget). v54: `a-quaestor-keeps-the-books`, `a-house-follows-the-gap`,
`the-market-has-merchants`, `the-houses-stay-out-of-the-room`, `the-books-balance-with-houses` and `the-books-are-kept-in-good-time`. the model's own work: `the-model-is-left-to-its-plots`. H0: `a-treasurer-decides`, `a-consul-cannot-draw-the-treasury-alone`, `two-consuls-do-not-both-tax`, `a-tribune-stops-a-levy`, `the-senate-decrees-the-tribute`, `a-reform-changes-who-may-act`, `the-new-levers-bite` and `no-modern-words`. Where the money goes: `a-state-keeps-its-roads`, `a-censor-lets-a-contract`, `the-state-has-its-costs`, `a-played-ruler-keeps-his-books` and the 36-month case of `the-books-balance`.
