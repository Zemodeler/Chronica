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
have the `boarding` lever; Rome's boarding-bridge (the corvus) is not in the scenario's doctrines and is not invented here (it would be
scenario data, Polybius 1.22, and a version bump).

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
`a-defender-chooses-the-ground`, `a-general-obeys-his-heads-order`, `a-cast-general-overrides-the-plan`, `a-besieger-starves-or-storms`,
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
