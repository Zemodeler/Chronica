# War plans: aims, orders, plans of battle

An audit found that an army the rules led decided every month from a stateless list (`conductOfWar`, `packages/sim/src/statecraft.ts`): offer
battle if the odds are good, fall back if outnumbered, lay siege, or march on the best-scoring thing in reach. Armies changed their
objective month to month, the general's nature mattered only through `commandersTemper`, a war record had no aims, nobody ever sent an
army anywhere, the engine's plan of battle was never set, the manoeuvres were never picked, fleets were skipped, and supply and winter
were nobody's decision. This is what replaces that. Everything is by rule and deterministic (`stableHash`, never `Math.random`);
a model is asked about nothing, and only a man the model plays may overwrite it.

## The two records

`packages/shared/src/world/war-plan.ts`, kept in the world as `warPlans` and `campaigns` (both defaulted, so every old save parses).

- **`WarPlan`** (one per power per war): `aims` (`hold_province`, `take_province`, `break_army`, `sue_for_peace`, `raid`, `blockade`),
  `theatres` (the aims' ground in at most three clusters; one is the `mainEffort`; each has the armies allotted to it and the man who
  leads them), `posture` (`attrition`, `decisive`, `defend`), an optional `navalPlan` (`escort`, `blockade`, `seek_fleet`),
  `aimsSetAtStep` (the last time the plan was rebuilt) and `aimsChangedAtStep` (the last time the set of aims differed), and who laid it.
- **`CampaignPlan`** (one per army): the `objective` (a province or an enemy army), the `mode` (`seek_battle`, `refuse`, `siege`, `raid`,
  `garrison`, `winter`), the base it is fed from and the fallback it gives way to, who sent it (`issuedByCharacterId`), and the day the
  orders run out. Plans name provinces and armies, never roads: the road is found when the army marches.

They are written by two acts, `war_plan_set` and `campaign_plan_set` (`packages/shared/src/sim/war-plan-deltas.ts`, applied in
`packages/sim/src/apply/war-plan-apply.ts`). The rules write them by these, and so does a man the model plays, under the same bounds: the
power must be at war with the one named, provinces and armies must exist and be the power's own, orders are for no more than 240 days and
name one object. The act tells a fact in the power's own words when the orders or the plan change ("Gaius Genucius sends the first legion
against ...").

## Grand strategy (`packages/sim/src/grand-strategy.ts`)

Once a month the head of each power at war builds, or carries on, the plan of each war:

1. **Aims** from what he can see: ground of his own that the enemy holds (`worthOf`: a town, a capital, our own ground lost), the enemy
   armies that he could beat, ground to hold where an enemy army stands or is near the capital, and peace where the war has worn the people
   (`warWeariness`) or gone against him (`warStanding`). Each aim is scored by worth for the march; one already held is worth a third more,
   so the plan is not changed for a trifle. A war's aims are only its own enemy's ground (`alliesLedBy`), and the bigger enemy has the
   first claim on the armies.
2. **Theatres** by clustering the aims (350 km, at most three), the main effort to the one with most aim value per km marched.
3. **Posture** by the odds and the ruler's nature (`dispositionOf`: nerve, greed, fear): `defend` on his own ground when he is not the
   stronger or when he is much the weaker, `decisive` when he is the stronger by a fifth and has the stomach, `attrition` otherwise.
4. **Allotment**: Rome's is the Senate's and the lot's (`annual_*` command tenure): the strongest army to the main effort by decree and the
   others as the lot falls (`stableHash` of the game, the man and the year), kept for the year; Carthage's (`indefinite_answerable`) is a
   strategos to a theatre, the nearest first, kept for a season; a king's is his own.
5. **Hysteresis**: aims are kept `AIM_KEPT_DAYS` (90) unless something happens that a man would answer: a province lost, a battle fought,
   an army near the capital, weariness at 60, a new ally, the turn of the season (`shiftTriggers`). Aims that are met are struck off.
   Followers by foedus have no war of their own: they are given the leader's main army's orders, as their own, and keep to them.

## Campaign orders (`packages/sim/src/campaign-orders.ts`)

`issueCampaign` is the head (or, for a strategos' army, the theatre's commander) sending an army: supply and the season first (to a town of
its own in winter, or when the bread runs short, unless he is a bold man with a good quartermaster and his army fed; to ground that will
feed him where there is no town); then to hold a town and refuse battle where the posture is to stand, or the enemy is too strong, or the
man is a careful one (`temperOf`: boldness against caution); then to meet the enemy's army where the aim is to break it or the man is
bold; then to take ground, by siege where it has walls and by harrying where it has none. Orders stand until they run out, their object is
taken, or something a sensible man would answer happens: a stronger army near (`superiorNear`), the bread gone (`critical`), the aims of
the war changed, the season turned. Orders are renewed as they stand when they near their end.

`conductByPlan` is the general carrying them out: he meets an enemy where the odds are his (stricter when his orders are to refuse), keeps
within the walls on hold with his plan of battle laid when a stronger army is before a town of his own, falls back on the fallback when
it is not, lays siege with works of his own choosing, harries by `force_raid`, marches to his object. An army with no orders (a new levy,
a war with only a follower) is led by the old rules, which stay (`conductOfWar`).

## Plans of battle and manoeuvres (`packages/sim/src/battle-plan.ts`)

`chooseBattlePlan` asks the engine's own judge (`judgeTactic`) what the field bears out for the side choosing (numbers, horse, rough ground,
a prepared position, a scouted field, a second army) and claims exactly that and no more, with a factor that suits the man; so a plan
is never worth more than the field shows and the engine's cap on what a plan may add is the same for everybody. It is written on the
army when it holds a town (`force_modify battlePlan`) and given with the order to give battle (`force_engage.tactic`). `chooseManoeuvre`
is picked only where the enemy would refuse (`acceptsBattle`): the bold and the strong storm the camp, the clever and bold go in by
night, the clever and careful lure, the bold and hard burn the country in sight of it; the man's bent weights the choice by a hash.

## Sieges (`besiegerOrder`)

The man outside the walls reads his bread, the garrison, the breach and the danger of a relief. He raises the siege rather than be
caught between the walls and an army half as strong again as his own (if he is not a rash man), or when his bread is gone; storms a
breached city when he is bold and the stronger by half, or when a relief or his own hunger is hurrying him; otherwise he starves it,
building lines where a relief may come, rams if he is bold, towers if he is skilled.

## Fleets (`packages/sim/src/naval-orders.ts`)

A fleet seeks the enemy's when it is the stronger and the man is bold or the posture is to have it out; blockades an enemy port-province
when it has no fleet to meet (or the power is at the defence and none is near); stands ready as escort where an aim lies over water (the
engine arranges the crossing of an army from the hulls of its power: `passagePlanFor`); gives battle to ships on the same water at six to
five, otherwise draws off to a harbour; and keeps to harbour when the sea is shut (`sailingSeason`). Boarding: the Ptolemaic great ships
have the `boarding` lever; Rome's boarding-bridge (the corvus) is not in the scenario's doctrines on purpose (Rome has no fleet in 270, and the corvus is of 260,
Polybius 1.22): it is a way of war a rule-led Rome puts to the Senate once it has ships (see "Rome at sea", below).

## Rome at sea (`packages/sim/src/a-fleet-by-decree.ts`, playtest fix batch 2)

Rome had the hulls of its allies (`socii-navales.ts`) and no fleet. A power by rule that is at war with a sea power (a war of ninety days or more, the enemy holding forty
warships or more) and has no warship of its own and no shipbuilding work begun lays a motion before the chamber that holds the purse (`weigh`, as the books' motions are
laid): "that a fleet of a hundred quinqueremes and twenty triremes be built" (Polybius 1.20). The motion carries the work with it (`enacts.project`), which begins the day it
carries: three stages, due 60, 110 and 150 days after it begins (timber and keels; hulls; rowers trained on benches), 12,000 a hull out of the chest, never more than three-fifths of the chest in a
season (a poor power builds fewer hulls and says so), the hulls raised out of the country's men on launching (`tick.ts`, `raiseLevy`) and paid by a standing obligation. The Senate's lean on a fleet is helped by the war's need (`the-sea-is-lost.ts`, +35 on every bloc where the enemy holds the sea): without it the sanity run saw the motion rejected at every asking for a year, with it carried the month after it was moved. The consul
may carry it alone only within two months of the year's takings (his charge, `mayAct`); 120 hulls are more. A king builds at once. Once there are ships, and the war goes on against a
sea power, the corvus is moved the same way, and only by a power whose enemy has the better seamen (the Carthaginians, whose crews raise what drill can come to), with the reform it enacts (`THE_CORVUS`: boarding up a band, the ships' speed down a band, for warships), which the military-reform machinery carries out and
refits over months. The player's own "build a fleet" or "build sixty ships" is a template (`fleet`, `order-templates.ts`) read as the same work, which the competence gate puts to the Senate where
the chest is not his to open. Tests: `rome-builds-a-fleet-by-decree`, `the-corvus-makes-boarding`.

## The rules' orders and a man the model plays (playtest fix batch 2)

An army the model's man commands was left to him, and a model asked about a consul's army answers that he does nothing: the Roman field army sat at the Almo for years under "orders" the
rules had written in his name, and "winter" orders written in March stood in May because a played head's orders stand until they run out. Now an order the rules write carries `byRule`
and `forCommanderId` (`CampaignPlan`): the rules keep carrying it out for a played general, it is looked at again like any rule-made order (the season, the bread, the road), and it is written
afresh when the man who commands the army changes (a new consul takes up the plan, in his own name); the theatre's commander is part of the allotment, so a plan is written again when he changes.
What a played man orders himself (`campaign_plan_set` by his own hand) still stands, as before. An order the army cannot carry out (no road to its object, no ships for the water) is
cancelled: the new order says so ("the order for X could not be carried out, there being no road and no ships to it"), and the army keeps its quarters until a road or ships are found.
Tests: `a-consular-army-marches-within-a-month`, `a-new-consul-takes-up-the-plan`, `an-impossible-order-is-replaced`.

## The war with Carthage (playtest fix batch 2)

Carthage's army is in Sicily in the opening (`punic-wars-sicily.ts`, `docs/plans/scenario-notes-batch2.md`): a strategos' army at Lilybaeum and garrisons at Panormus and Agrigentum, so a Roman army that
crosses meets one. The war itself comes by the rules the old way (a power's appetite, its fear, its cause) and, new, by appeal (`the-appeal-goes-to-the-people.ts`): a people hard pressed in its war
(under seven in ten of its enemy's men) writes once in three hundred days to the two strongest powers near it that are not its enemies (`decideCallsForHelp`); a request for aid or an
alliance from a people at war with a power, or with that power's army on its ground, or an ally of ours at war with it, is a cause that adds to a power's score for war on that power; and where the Senate has refused a
war on such a cause, the consul takes the question to the assembly that holds the power of war within sixty days, the people vote it by their blocs and gentes, and what they carry stands as carried (the war is made the
month after, by the consul, as a war the Senate carried is: `decideTheAppealWar`). The people's refusal ends it. A request for peace or a truce has a term of its own, sixty days, where its writer named none, so that it is answered by the man it is
written to, or refused by his silence (`PEACE_REQUEST_ANSWER_DAYS`). A legate or a proconsul who proclaims war or peace is refused with the reason (only the chamber could decide it, and nobody acted on his word); an
order of his to the same end is moved in the chamber for him (`layBeforeTheChamber`), as before. Tests: `messana-calls-and-rome-answers`, `a-truce-request-is-answered`, `carthage-holds-western-sicily`.

## The model's general

`rulerOptions` shows a ruler the plan of his war in one line (`warPlanLine`) and his armies' orders in place of the old per-army lines
(`campaignLine`); a general who is not the ruler is shown his own orders and the war's stance in one line (`generalsLine`). The rules stand
back from armies a played man commands; armies he sends keep to the orders he gave them (`campaignStillGood` keeps what a played man
ordered until it runs out or its object is gone), and a played ruler's plan stands for 180 days. The player's own armies are not
touched. The orchestrator is not shown the two acts (his armies ignore plans); a person is shown them compactly
(`shownWarPlanVariant`), the prompt ceilings paid for by trimming prose in the cognition prompt.

## Historical shapes hosted (270-241 BCE)

- *Hold and defend*: Carthage at Drepana and Lilybaeum: posture `defend`, mode `garrison`/`refuse` in a walled town, battle refused by
  `hold` and the plan laid.
- *Seek the decisive battle*: a bold consul at the head of the stronger army: posture `decisive`, mode `seek_battle`.
- *Raid and harass*: Hamilcar from Eryx: aims of kind `raid`, mode `raid`, `force_raid` every month the ground still has something.
- *Siege and blockade*: Agrigentum 262: mode `siege` with works, a fleet's `blockade`.
- *Naval*: Mylae, Ecnomus: `seek_fleet`; Regulus 256: an aim over water with the fleets as `escort`.
- *Shadow and cut supply*: an army ordered `refuse` keeps a town in the enemy's way; not a separate mode yet (see open decisions).

## Tests

`a-war-has-aims-and-a-main-effort`, `a-consul-keeps-to-his-theatre`, `a-cautious-general-holds-his-towns`, `a-bold-general-seeks-the-battle`,
`a-defender-chooses-the-ground`, `a-general-obeys-his-heads-order`, `a-cast-general-overrides-the-plan`, `a-besieger-starves-or-storms`, `a-consular-army-marches-within-a-month`,
`a-new-consul-takes-up-the-plan`, `an-impossible-order-is-replaced`, `rome-builds-a-fleet-by-decree`, `the-corvus-makes-boarding`, `messana-calls-and-rome-answers`,
`an-army-winters-in-a-town`, `a-fleet-escorts-and-blockades`, `war-plans-are-deterministic`, and a ten-army plan within a time bound in
`a-thousand-provinces`. `npm run sanity:war` (`scripts/war-sanity.mts`) runs the Punic opening model-less with a Rome-Carthage war
opened at month 6 and reports per year the wars, battles, sieges, march orders and flips, plan shifts, naval moves, men under arms and
the cpu of the month.

## Open decisions

- A power at war with two enemies at once gives the bigger enemy the first claim on the armies; the smaller war's plan is made and has
  few or no armies. A split by distance would be better.
- The shadowing of an army to cut its supply is not a mode of its own.
- The constitutions' lists of what a magistrate may do (`IMPERIUM`) do not name the two acts: a model-played consul writes them as the
  world's own business, not as a breach.
