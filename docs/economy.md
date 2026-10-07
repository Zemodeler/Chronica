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
exponent 0.9, between 40% and 400%; slaves 50% to 300%). `marketPriceBps` is the single source; the army's bread, a
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

## Scenario versions

v47 puts money at the age's scale and tags every door; v48 adds development, scars and tax regimes (Syracuse opens on a
tithe); v49 adds goods, hubs, flows, customs and Rome's two pacts; v50 adds the coinages. v51 (taxes by province in
`punic-wars-taxes.ts`) sits on them, v52 sets the income to the army-cost rule and v53 gives the allies chests. Notes for each are in `packages/db/src/built-in-versions.ts`.

## Where things live

- Shared types and rules: `packages/shared/src/world/economy.ts` (memory, pay, prices), `world/markets.ts`,
  `world/agreements.ts`, `world/coinage.ts`, `material/province-material.ts`, `material/tax-policy.ts`,
  `material/taxation.ts`.
- Engine: `packages/sim/src/economy.ts` (calendar), `markets.ts`, `trade-flows.ts`, `customs.ts`, `treaties.ts`,
  `coinage.ts`, `money-audit.ts`, `trade-summary.ts` (the slice's trade lines and news), `slice.ts`.
- Readers for the treasury: `packages/shared/src/material/regions-view.ts`, `trade-view.ts`, `books.ts`.
- Scenario data: `packages/db/src/punic-wars-scenario.ts`, `punic-wars-taxes.ts`.
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

## Tests that pin behaviour

All under `packages/sim/src` unless noted: `the-books-balance`, `a-market-sets-a-price`, `a-market-moves-grain`,
`a-province-trades-in-its-nearest-market`, `a-siege-starves-a-market`, `a-blockade-stops-the-sea-trade`,
`a-cargo-follows-the-markets-gap`, `a-war-torn-region-lags`, `a-tax-regime-is-chosen`, `taxes-the-land-can-bear`,
`the-office-and-the-roll`, `a-tariff-bites`, `a-trade-pact-lowers-tariffs`, `an-embargo-cuts-trade`,
`war-suspends-a-pact`, `a-power-hears-of-its-trade`, `a-coin-is-debased`, `a-foreign-payment-is-changed`,
`the-treasury-reads-the-land` and `a-thousand-provinces` (the cost budget).
