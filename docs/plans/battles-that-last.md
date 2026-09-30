# Battles that last: engagements, standoffs, sieges and seasons

Settled with the user on 2026-09-29. Replaces the contact rule built earlier the
same day (`sim/src/contact.ts`), which started a battle whenever two enemy
armies shared a province. The user's rule: **armies do not fight until an order
says so; once they do, they fight until one side is defeated.**

## Why

Two faults, one from each side:

- Before the contact rule, Legio I and Hieron's army stood in the same province
  for a season and nothing happened, because a battle needed an order and
  nobody gave one.
- With the contact rule, any two enemy armies fought on the day they met,
  whatever their orders said. The player's own order ("march on Syracuse, do not
  engage until he answers") would have been overridden.

A battle was also one exchange, resolved in an instant: one Chronicle entry,
whether it was a skirmish at a ford or Cannae. A real battle of the period is a
story that runs over days.

## How the period fought (what the design follows)

- **Standoffs lasted days, weeks, even a whole summer.** Armies camped within a
  few miles, behind fortified camps (a Roman one every night). Most days one side
  drew up and offered battle, and the other came out or stayed on its hill.
  Light troops and horse skirmished over water, fodder and foragers. Examples:
  Ilipa (206, several days drawn up before Scipio changed his hour and order),
  Fabius shadowing Hannibal through 217, and the days of manoeuvre before Cannae.
- **The pitched battle was usually one day, a few hours.** Ausculum (279) ran
  into a second day. Most of the dead fell in the rout and pursuit, not while the
  lines held.
- **Night ended the day's fighting, but night actions happened.** Scipio burned
  the camps at Utica (203). Hannibal escaped the Ager Falernus (217) with torches
  on cattle. Night attacks were high-risk and high-reward: confusion, lost ways,
  alert camps.
- **Refusing battle was a strategy with costs.** Fabius was called "the Delayer"
  as an insult, and Minucius was raised to equal command. The refuser's
  foragers were cut up, the allies' fields burned in sight, and supply ran down.
- **Sieges lasted months or years.** Agrigentum (262–261) took about seven
  months, Lilybaeum (250–241) nearly a decade, and Syracuse (214–212) two years.
  A siege was a string of events: lines drawn, blockade, engines, breach,
  sorties, disease, relief, runners, treachery, terms.
- **Sea battles were short; naval campaigns were long.** A sea battle lasted
  hours (the corvus at Mylae and Ecnomus, ramming on the Carthaginian side).
  Fleets beached nightly, kept a season from spring to autumn, and storms sank
  more ships than battles did (255, 249). The long part was blockade and
  pursuit.

## Decisions

1. **No fighting without an order.** Enemy armies in one province stand facing
   each other. That is news: a Chronicle entry, and a question put to each
   commander ("the two armies have faced each other across the river six days").
2. **An order opens an engagement.** Any army's order to attack an enemy in its
   province opens one. The order can be the player's, an NPC commander's (the
   model playing him), or given in advance (an ambush, a contingency, a fleet
   set to guard a crossing). The army attacked defends without an order of its
   own.
3. **An engagement runs until a side is defeated.** Defeated means broken and
   fled, destroyed, surrendered, retreated out of the province, or (see 5) put
   on hold on the attacking side.
4. **Each day of an engagement is a round.**
   - **Offering battle:** the attacker, or either side, offers battle each day.
     The other accepts or refuses.
   - **Pitched battle (accepted):** one day, the whole resolver. If night falls
     with neither line broken, the engagement runs on to the next day.
   - **Skirmishing (refused):** a small exchange of light troops and foragers.
     Losses are small, and the day adds fatigue and supply pressure.
   - **Refusing only works from a strong, fed camp:** hills, a river in front,
     walls behind, a Roman camp, or days spent digging in, and food in store.
     With a weak camp or an empty granary the defender must fight, retreat or
     starve.
   - **Forcing a battle** is an order: storm the camp, starve it, provoke it
     (burn the allies' fields), lure it (feigned retreat, bait), catch it away
     from camp (on the march, at a river), attack at night, or march round it on
     something it must defend.
5. **Hold** is a standing order on an army, with two effects:
   - (a) an army on hold that is already fighting breaks off attacking and
     defends; if the whole attacking side holds, the engagement ends unwon;
   - (b) an army on hold will not start a battle, even when an order to attack
     reaches it (the attack order is refused while the hold stands; lifting the
     hold is its own order).
6. **Breaking away without orders:** an army attacked by a side more than three
   times its strength may pull back without orders if it has a road out, on any
   day the odds are that bad.
7. **Joining needs an order.** Another army of the attacker's side must be
   ordered in (the attacker's own commander's armies are his to order).
   Armies of the side attacked defend with it. Standing idle while your own
   side fights nearby costs:
   - the abandoned commander's opinion, and a grievance;
   - your standing, more if the battle is lost;
   - a trial where the courts judge commanders;
   - treaty faith for allies bound to help.
   NPCs decide by temperament. For the player it is always a turning point.
8. **Both sides eat.** Supply comes from stores, foraging (season, how stripped
   the land is, the skirmishes over foragers), supply lines (by road or sea,
   raidable), the locals (bought or squeezed), and captured depots. Either side
   can lose the race. Cutting supply is an order.
9. **Night attacks and night withdrawals** are orders of their own. Their odds
   come from surprise, skill, discipline and the camp.
10. **The engine owns the numbers; the model owns the story and the NPC
    commanders.** The model can invent manoeuvres; the engine prices them from
    skill, surprise, ground and condition.
11. **A notable day is a Chronicle entry of its own**, and quiet days fold. The
    player is asked only at turning points:
    - morale wavering, a wing breaking;
    - the commander killed or captured;
    - enemy reinforcements, or a nearby army of ours not yet ordered in;
    - terms offered, a truce asked;
    - the enemy breaking (pursue or not);
    - battle offered to us, or refusal growing expensive (food low, supply cut);
    - won or lost.
12. **Sieges** become multi-month engagements of the same kind, with their own
    events. **Sea:** a battle is one day plus pursuit, and a blockade is a
    multi-month engagement. Fleets keep a campaigning season, with storm risk out
    of season growing daily, and an order to overwinter in port.

## Phases

1. **The engagement (built first).**
   - `world.engagements`: province, sides, who attacked, the day it began,
     today's phase (skirmish or pitched), and a log.
   - `force_engage` opens or joins one and fights its first round at once.
   - The tick fights one round a day for every open engagement, walking each
     day of a jump.
   - Accept or refuse is decided by rule (camp strength, food, the commander's
     caution) until Phase 3 hands it to the model.
   - The resolver takes an intensity (skirmish or pitched).
   - Hold (`Force.stance`), the one-in-three break-away, and "facing each
     other" news.
   - The contact rule is removed.
2. **Supply in the standoff.** Consumption for both sides, contested foraging,
   supply lines and convoys, requisition, depots, and the cut-supply order.
3. **Turning points and commanders.** The burst stops for the player at turning
   points; NPC commanders are asked by the model at theirs; tactics change
   mid-battle; a notable day is a Chronicle entry of its own.
4. **Forcing moves and duties.** Storm, provoke, lure, go round, night attack
   and night withdrawal; the penalties for standing idle.
5. **Sieges and the sea.** Sieges as event strings; blockades; the fleet
   season and overwintering.

## As built

### Phase 1 (2026-09-29)

- **Code:** `shared/src/world/engagement.ts` (the record, `world.engagements`)
  and `sim/src/engagements.ts` (`openEngagement`, `fightRound`,
  `fightEngagements`, `acceptsBattle`, `noteWhoFaces`). `sim/src/contact.ts` is
  deleted.
- **Facing** is a record of its own (`status: "facing"`), made the first day
  enemies share ground, with an `armies_facing` fact that day and again seven
  days on. An order to attack replaces it.
- **`force_engage`** opens or joins an engagement and fights its first round at
  once. The order's `tactic` becomes the army's `battlePlan` for every day of
  it. `offer_battle` seeks battle; any other posture only harasses.
- **Each round:**
  - the attacking side is those ordered in, less any on hold;
  - the side attacked is its lead and every friendly army on the ground;
  - the one-in-three withdrawal is checked first;
  - an offered battle is accepted unless the defender can and will refuse.
- **Who can refuse, by rule until Phase 3:**
  - an army that is starving (`provisionStatus: "critical"`) or on the march
    cannot refuse;
  - one on hold always refuses;
  - a commander with caution under 35 takes the battle;
  - otherwise he fights only when more than 10% the stronger.
- **Refusal costs morale:** 150 bps a day, halved at best by the commander's
  authority. Below 4,000 the refusers leave camp by night, if they have a road,
  or must fight.
- **A skirmish day** costs each side up to 0.8% of its men, weighted by the
  other side's strength, plus 250 bps of fatigue. The first skirmish day is
  significance 55, later ones 25.
- **A pitched day** is the whole resolver. The engagement is decided when one
  side has nobody left on the field; an undecided battle goes on the next day.
- **Hold:** `Force.hold` and `force_modify.hold`. `force_engage` from an army on
  hold is refused; an attacking side all on hold ends the engagement
  `broken_off`.
- **The model** sees `IN THE FIELD` in the slice, and "under orders to hold" on
  its armies. Principle 10 of the orchestrator prompt now says a fight happens
  only on an order and goes on daily until a side is beaten. The prompt is
  68,197 of 68,500.
- **Tests:** `sim/src/battles-that-last.test.ts`. Battle tests elsewhere make
  their commanders rash (`readyToFight`) so that they still test the battle.

### Phase 2 (2026-09-29)

Smaller than planned, because `sim/src/campaign.ts` already fed armies from
home ground, depots, their own ships or foraging, and starved them when none of
these reached them.

- **Penned:** the side attacked in an open engagement is kept to its camp. The
  country does not feed it, and a depot outside the province cannot reach it. It
  eats from a walled town of its own side in the province, a depot on the spot,
  its own ships, or what it carries. The attacker holds the open country and
  forages as before, stripping it as he goes. So cutting the enemy's supply is
  what any attack order does; a "harass" order is the order to do nothing else.
- **Hunger feeds Phase 1's rules:** an army with no food left
  (`provisionStatus: "critical"`) cannot refuse battle, and hunger's morale loss
  leads to the night withdrawal. The `force_short` fact says when an army is
  short because it is penned.
- **The camp taken:** when a side is driven off or falls back, the winners are
  fed for 12 more days on its stores, and its power's depots in the province
  pass to the winners' power (`takeTheCamp`, a `camp_taken` fact).
- **Not built:** requisition and buying grain from the locals as an order of its
  own (foraging a hostile country already squeezes it), and convoys as things
  that can be ambushed on the road.

### Phase 3 (2026-09-29)

- **Turning points** (`engagement.awaiting`, `TurningPointKind`):
  - `battle_offered`: to a player defending who could refuse, the first time;
  - `reinforced`: a new enemy army on the field;
  - `hungry`: the player's side off full rations;
  - `wavering`: morale under 4,500 after a day of battle;
  - `commander_lost`: killed or captured.
  - For the player's side, the fight stops (`fightEngagements` skips an
    engagement that is awaiting), a turning-point fact is written, and the burst
    ends on the question (`engagement-decisions.ts`, checked beside
    `playerPlight`).
- **The answer** is taken at the start of the next burst (`answerEngagement`):
  `fight`, `refuse`, `press`, `hold` or `fall_back`, with ids `fight-*`. No
  answer refuses an offer and presses anything else. `playerStance` keeps his
  come-out-or-keep-to-camp choice for the days after.
- **NPC commanders** get the same moments as `engagement_turning_point` facts
  naming them, which the attention router turns into the model's attention; the
  rule stands if they do nothing.
- **A new plan mid-fight:** a later `force_engage` joins the engagement, and its
  `tactic` becomes the army's `battlePlan`.
- **The Chronicle** keeps a fight's facts (`FIGHT_DAY_KINDS`) to their own day in
  `splitIntoThreads`, so each notable day is its own entry; quiet days go to the
  gathered passage.

### Phase 4 (2026-09-29)

- **`force_engage.manoeuvre`**, stored on `engagement.manoeuvre`. `provoke`
  persists until another order; the rest are tried once.
  - `storm_camp`: a pitched day regardless of refusal, fought over a rampart for
    that day (1,500 bps; the city's walls, up to 4,000, for a besieged city). A
    besieged city's garrison driven off leaves the siege at full pressure.
  - `night_attack`: succeeds on the attacker's generalship against the
    defenders' caution and discipline (10–80%). Success is a pitched day with a
    meaningful surprise and the defenders' order shaken; failure costs the
    attackers 3% of their men, morale and order.
  - `lure`: a feigned retreat. A rash defender is drawn onto prepared ground.
  - `provoke`: the country burned in sight of the camp. The defenders pay the
    refusal morale twice, and their commander loses 40 bps of standing a day.
  - `withdraw_by_night`: either side leaves. A vigilant enemy with horse cuts
    up the rear. It is allowed while on hold.
  - A defender side that orders an offensive manoeuvre becomes the attacker.
- **Standing by** (`stoodIdle`): an army of the attacking side idle on the same
  ground during a day of battle costs its commander 150 bps of standing (450 if
  the day was lost) and his colleague's trust, recorded as a grievance. For the
  player it is the `ally_fighting` turning point: `join` or `stay`.
- **The prompt:** principle 10 mentions `manoeuvre`. The prompt is under its
  68,500 ceiling.

### Phase 5 (2026-09-29)

- **Sea battles stay one day.** `force_engage` between fleets resolves at once,
  as before; a Phase 1 fault had made them end as "left the field".
- **Sieges** (`sieges.ts`, `siege.awaiting`, `siege.told`):
  - **runners:** the defender's own ships in the port, and none of the
    besieger's, halve the pressure;
  - **sorties** burn the works (−500 pressure, losses on both sides);
  - **treachery** at a gate once past the breach, likelier under a manipulative
    besieger;
  - **a breach** at 5,000 pressure;
  - **terms** offered at 7,500.
  - The breach and the terms are put to a player besieger
    (`siege-decisions.ts`: storm or wait; accept or refuse), or to an NPC by a
    fact naming him. A careful NPC (caution 40 or more) takes terms; a garrison
    on terms marches out alive (`marchOut`).
- **The fleet season** (`campaign.ts`): in winter a fleet not in friendly waters
  has a 2% daily chance of a storm that sinks 10–25% of it. A friendly harbour is
  safe, so moving there is the order to overwinter.
- **Tests:** `sim/src/sieges-and-seasons.test.ts`, plus the Phase 3–5 cases in
  `battles-that-last.test.ts`.

### Grain, siege works and blockades (2026-09-29)

- **`force_provision`** (`sim/grain.ts`), with `how`:
  - **buy:** from a market where the army stands. A penned army can buy only
    from a walled town of its own side. The price is half a day's pay per
    thousand men at the power's `soldierPayPerThousand`, up to three times that
    in a hungry country. It is paid by the account named, else the army's
    payer, else its treasury. The money leaves for the country at large, not
    into anybody's chest, and the province can spare 5% of a month's bread.
  - **requisition:** half as much again as a market would sell, free. It costs
    the province's stability, 800 bps on the power's own ground and 300 on
    enemy ground.
  - **convoy:** bought where it is sent from (the army's own ground, or a
    depot), plus carriage of 10% a province. It travels 3 days a province
    (`world.convoys`). On arrival it is taken by enemies on the spot: 35–80%
    when the army is penned, 15–45% otherwise, rising with the enemy's share of
    horse. The takers eat it.
- **Siege works** (`siege_lay.works`, `SIEGE_WORKS`, `siege.works`), paid from
  the besiegers' treasury by the thousand men:
  - rams: 8 days, pressure ×1.25;
  - towers: 20 days, ×1.35;
  - lines: 15 days, ×1.1, and sorties at half the chance;
  - mine: 30 days, then +2,500 pressure at once.
  - A sortie burns towers, then rams; a mine and lines cannot be burned. A later
    `siege_lay` at the same city adds works to it.
- **Blockades** (`sim/blockades.ts`, `world.blockades`): kept from the day an
  enemy fleet at war stands off a port to the day it goes, with news both ends.
  Tightness is the hulls on station against 25 for each port-town. A blockade
  under 5,000 no longer shuts the port's trade (`tick.ts`). A siege's runners
  now come from the defender's ships in or next to the province, and a blockade
  cuts them as tightly as it is kept. The order for a blockade is to sail the
  fleet there.
- **Prompt:** principle 10 names `force_provision`. The ceiling was raised
  68.5k → 69.5k for the new order and the works; the prompt is about 68,960.
- **Tests:** `sim/src/grain-works-and-blockades.test.ts`.

### Not built

- A siege assault by order uses `storm_camp` or the breach decision; there is
  no escalade as a separate kind.
- A blockade's effect on trade is all or nothing at 5,000 tightness; the
  monthly reckoning does not split an income.
- None of this has been hand-played.
