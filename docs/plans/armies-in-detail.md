# Armies in detail: establishments, formations, doctrine and reform

Settled with the user on 2026-10-02. **Built the same day, all five phases** (uncommitted, on
intent-to-proof; existing saves ignored, as the user asked). See "Status" at the end.

The user's three rules:

- **Detail where somebody stands.** A player who serves as a legionary, a
  centurion or a tribune has a place in the army, people around him, a career
  and a fate of his own. The army must be detailed enough for that to be a good
  game.
- **Orders stay simple.** A consul leading an army says "attack" and that is the
  whole of it. Formations, lines, doctrine and drill are resolved inside the
  engine; nobody has to name a maniple to fight a battle.
- **Reforms are open.** The Marian reforms are an example of how far a reform
  can reach, not a menu item. Players will invent reforms nobody wrote down, and
  the engine must be able to carry them.

Decisions taken:

1. Formations are always stored; the units inside them are derived from a
   template and stored only once something particular happens to them.
2. Doctrine gives a real edge per man, within a cap the engine sets.
3. The major powers first: Rome, Carthage, Syracuse, Macedon
   (`macedon`), the Seleucids (`seleucid-empire`) and the Ptolemies
   (`ptolemaic-egypt`). Every other power keeps the flat army it has now, and
   flat armies go on fighting exactly as they do.

## Why

What an army is today (`packages/shared/src/material-state.ts`, `ForceSchema`):
a commander, a flat list of `{categoryId, label, fit}` rows, and morale,
cohesion and fatigue for the whole force. The scenario has three categories
(`infantry`, `cavalry`, `warship`); the label is flavour. Found while
investigating:

- **A soldier is a name on a list.** A declared legionary is appended to
  `memberCharacterIds` of a 7,100-man army. He has no century, no centurion, no
  line and no comrades, and his fate in battle is rolled at the whole army's
  casualty rate (`sim/src/battle.ts`, `memberFates`). A centurion or tribune is
  the same name on the same list and commands nothing.
- **Quality does not exist.** All infantry fights the same per head; a minted
  category is capped below the baseline (`warfare/troop-categories.ts`).
  `steadinessBps` is never read by the resolver. `mobilityBps` is only ever a
  `>= 8 000` test.
- **Training is a number the model writes.** Rest restores morale and cohesion
  only to 7 000 (`RESTED_BPS`, `sim/campaign.ts`); above that, only
  `force_modify.cohesionBpsDelta`, which moves up to ±10 000 at once, free and
  instant. Men never become veterans; only commanders learn.
- **No reform has anything to change.** There is no army template to amend.
- **The scenario's armies are thin.** The Roman field army has no horse and no
  velites; the Carthaginian field force is "Infantry 3 000"; the Hellenistic
  kingdoms open with no army at all.

## How the period organised its armies (what the design follows)

- **Rome (manipular legion).** Per legion about 4 200 foot and 300 horse:
  1 200 velites; hastati, principes and triarii in three lines of ten maniples
  each (maniples of about 120, 120 and 60, two centuries each, each century with
  a centurion and an optio, each maniple with standard-bearers); ten turmae of
  thirty under decurions. Six military tribunes per legion, those of the first
  four legions elected by the people. Allied alae of about the same foot and
  triple the horse, under Roman prefects, with picked extraordinarii. Annual
  levy (dilectus) of men above a property floor, who arm themselves; pay with
  stoppages for food and kit; up to sixteen campaigns for foot, ten for horse;
  ten campaigns required before standing for office. A fortified camp every
  night. Rewards (civic crown, mural crown, phalerae) and punishments
  (fustuarium, decimation) are attested in Polybius.
- **Carthage.** Citizen generals appointed by the council and judged by the
  Hundred and Four; armies of mercenaries and subjects by nation, each under
  its own captains: Libyan heavy foot, Numidian horse, Balearic slingers,
  Iberians, Gauls, Greeks. Paid in coin, and dangerous when unpaid (the
  Mercenary War). Elephants appear in the 260s.
- **Syracuse.** Hieron II's citizen hoplite phalanx, raised after he rid himself
  of his untrustworthy mercenaries, beside new mercenaries and horse; a royal
  fleet.
- **Macedon (Antigonus Gonatas).** The sarissa phalanx in syntagmata of 256,
  hypaspists, Companion horse; Thracian and Illyrian light troops; mercenaries.
- **The Seleucids (Antiochus I).** A phalanx of military settlers (katoikoi),
  Companion and agema horse, Indian elephants (the "Elephant Victory" over the
  Galatians), mercenaries and subject levies of Asia.
- **The Ptolemies (Ptolemy II).** A phalanx of cleruchs, men given land for
  service; Greek mercenaries; African elephants, newly hunted; the largest navy
  of the age. Native Egyptians were kept out of the phalanx until Raphia (217),
  a reform waiting to happen.

Reforms of the age to seed and to measure the design against: Hieron's citizen
army; Xanthippus retraining Carthage's army (255); Rome copying a captured
quinquereme and adding the corvus (260); the gradual move to cohorts; Rutilius
Rufus's drill (105); and the bundle called the Marian reforms (107 onward) —
recruiting the landless, state kit, the cohort, the eagle, light baggage, land
for veterans. Historians now read much of the last as gradual. That is the
point: a reform here is a set of changes, each with a cost, pushed by
pressure, and the consequences arrive years later as armies loyal to their
generals.

## Principles

- **Nouns open, verbs closed.** The rule `standing-effects.ts` already follows.
  A reform, a formation, a rank and a doctrine can be called anything and
  described in any words. What each one *does* is chosen from a closed list of
  levers the engine simulates, in bands (`slight`, `marked`, `great`), and the
  engine decides what each band is worth. A model allowed to set the number
  would set it high.
- **Every edge has a price.** A doctrine that raises a lever pays for it: by
  lowering another, by upkeep, by retraining time, or by political cost.
  The engine prices a doctrine that names only gains.
- **The engine shapes men into formations.** A levy, a reinforcement or a new
  army is formed according to its power's establishment automatically. The
  model never lists maniples.
- **The model sees only what it needs.** The world slice gains one short line
  per army, in words ("two legions and two alae; manipular; steady"). Units,
  posts and service records reach the prompt only for the player's own chain
  of command.
- **No new ops.** Fields on existing ops: `force_modify`, `force_engage`, the
  enactment a vote carries, and the model-free bursts the map already uses.

## Data

### Military establishment (per power)

`world.establishments[]`, one per power that has one, seeded by the scenario
for the major powers. A power without one keeps flat armies.

```
MilitaryEstablishment
  polityId
  label                 "The manipular legion"
  formations[]          templates (below)
  ranks[]               rank templates (below)
  recruitment           basis: property_class | citizens | settlers | volunteers | mercenary | subject_levy
                        floor band (who qualifies); annual | standing
  equipment             self | state
  serviceCampaigns      foot / horse
  discharge             none | cash | land
  doctrines[]           adopted doctrine ids (below)
```

`FormationTemplate` (open noun, closed shape):

```
id, label               "Legion", "Ala of the allies", "Syntagma", "Libyan foot"
categoryId              which troop category its men are
line                    1 | 2 | 3 | screen | wing | reserve | afloat
size                    men at establishment strength
unit                    { label: "maniple", size, sub: { label: "century", count } }
```

`RankTemplate`: `id, label, level (army | formation | unit | sub | ranks),
grade (order within a level), filledBy (appointed | elected | seniority |
valour | purchase | hereditary), payBand`.

### Doctrine (the open part)

```
Doctrine
  id, label, description          anything: "Triplex acies", "Gladiatorial drill", "The corvus"
  origin                          scenario | reform | practice
  appliesTo                       formation template ids, or all
  effects[]                       { lever, direction, band }   (closed levers)
  upkeep                          band, from the paying account
  refitDays                       engine-set from the effects
```

The closed levers, each read by one engine path:

| Lever | Read by |
|---|---|
| `frontal_weight` | resolver, effective strength in the engagement phase |
| `steadiness` | resolver, cohesion loss under pressure |
| `line_relief` | resolver, cohesion loss while reserve lines stand |
| `rough_ground` | resolver, terrain modifier for this formation |
| `screen` | resolver, contact phase |
| `pursuit` | resolver, rout and pursuit |
| `boarding` | resolver, naval engagements |
| `siege_craft` | sieges, progress and assault |
| `march_speed` | travel and passage |
| `supply_need` | campaign, rations per man |
| `drill_ceiling`, `drill_rate` | campaign, training |
| `muster_speed`, `levy_cost` | levies |
| `manpower_basis` | levies, the share of people who may be called |
| `service_length` | discharge and experience retention |
| `loyalty_to_general` | society, `OWN_ARMY_DAYS` |
| `veteran_claim` | discharge, the veterans party |
| `pay_discipline` | tick, arrears morale and desertion |
| `detachment_size` | force splitting |

**The edge cap.** The combat levers (`frontal_weight`, `steadiness`,
`line_relief`, `rough_ground`, `boarding`) across every doctrine a formation
holds, together with its training and experience, sum to at most +25 % of a
baseline formation. A world cannot win by stacking doctrines. The cap is the
engine's, not the scenario's.

### On the force

- `ForcePersonnelCategory` gains an optional `formationId`. A personnel row
  *is* a formation's men, so the roughly sixty readers of `personnel` keep
  working, and a flat army is a force whose rows have none.
- `Force.formations[]`: `{ id, templateId, label ("Legio II"), trainingBps,
  experienceBps, doctrineIds (this army's own practice), standardId?,
  units: saved units }`.
- A saved unit: `{ unitId, label, fit, history }`, written only when a named man
  serves in it or it has taken losses of its own. Unsaved units are derived
  from the template, the formation's fit and a stable seed, and always add up
  to the row.
- `Force.posts[]`: `{ formationId, unitId | null, rankId, characterId }`, only
  for posts somebody named holds.
- `Force.drilling: boolean`, a standing order beside `hold`.

### On the character

`Character.service`: `{ forceId, formationId, unitId, rankId, enlistedAtStep,
campaigns, battles, wounds, decorations[], punishments[], dischargeDueStep }`.

## Orders

**The consul.** "Attack the Carthaginians at Messana" is one `force_engage`,
exactly as now. The resolver reads the formations, lines, doctrine, training
and experience internally. "Raise two legions" is the levy it is now; the men
are formed into two legions and two alae by the establishment. "Drill them
through the winter" sets `drilling`; the engine does the rest over days.

**The officer.** `force_modify` and `force_engage` gain an optional `unitRef`.
With it, drill, discipline, a unit's battle instruction or a detachment
apply to that unit only, and only for the man who holds its post: the station
learns unit ids, and a centurion ordering the legion is a breach, as a consul
overstepping is now.

**The soldier.** His conduct in the next battle (keep your place, seek
glory, hang back) is set from his sheet through a model-free burst, as renaming
an army is. Camp life comes from personal narrator seeds.

**The reformer.** Two routes, both existing:

- *State reform*: the enactment a vote carries gains `military`: adopt or drop
  doctrines, replace a formation template, change recruitment, equipment,
  service or discharge. It passes through the constitution's chambers like any
  law.
- *Army practice*: a commander adopts a doctrine for his own army through
  `force_modify.doctrine`, without a law. If his army wins with it, rivals'
  openings may copy it, and a state may later adopt it.

A reform is never applied to an army in a day. Each existing formation is
refitted by a project (money, `refitDays`, a cohesion dip, part of its training
lost); new levies come in the new form; mixed armies exist meanwhile.

## Battle from the line

Force-level arithmetic stays. Added:

- **Exposure by phase and line.** Contact falls on screens, missile troops and
  horse; the engagement on the first line most, the second less, the third
  rarely; pursuit on whoever breaks. Losses are shared among formations by
  exposure × strength, replacing `shareAmong`'s share by strength alone.
- **Line relief.** An army with standing reserve lines loses cohesion more
  slowly, scaled by `line_relief`. `steadiness` (category and doctrine) is read
  at last.
- **Unit fates.** A named man is rolled at his unit's loss rate. His report
  says what his unit did: "Your maniple held the first line for two hours and
  lost a fifth of its men. Sextus Aelius fell beside you. The principes came up
  through the gaps."

## Quality

Per formation:

- **Training** rises each day the army is drilling, paid, fed and not
  marching, faster under a commander with authority and strategy, up to
  `drill_ceiling`. It fades slowly when neglected and partly resets in a refit.
- **Experience** rises from battles survived and seasons served; recruits
  dilute it by headcount; discharge takes it away.
- Both raise steadiness and the cohesion a rested army settles at, and count
  towards the edge cap. The muster reads them in words: raw, trained, steady,
  old soldiers.
- `force_modify.moraleBpsDelta` and `cohesionBpsDelta` become bands
  (`slight`, `marked`), so the model never writes the number.

## Ranks, posts and careers

- Posts are filled by named people only where it matters: the player's chain
  (his tentmates, his centurion, his tribune, his general) is made into
  characters; the rest stay unnamed posts.
- Vacancies come from losses. A vacancy is filled by the rank's `filledBy`:
  appointment weighs deeds, standing and the appointer's regard; seniority the
  service record; election the existing procedures.
- Decorations raise standing; punishments lower it and may kill.
- Rome's ten campaigns before office joins the eligibility ladder as a
  requirement (`req-ten-campaigns`), waived the way other requirements are.
- Discharge when the campaigns are served: a veteran, with what the
  establishment grants, feeding the veterans party already in `society.ts`.

## The soldier's and the officer's experience

- **A Service sheet** in the Office for anyone with `service`: where he stands
  (formation, unit, line), the chain of command by name, his unit's strength
  and losses, his tentmates, his record, pay and stoppages, campaigns still
  owed, and what is being said in camp.
- **Camp incidents** aimed at him by the narrator: sentry duty, a quarrel, a
  centurion's favour or grudge, debts, a foraging party ambushed, pay day.
- **The officer's council.** Tribunes rotate command as Polybius describes and
  sit in the council of war; the general asks, ignores, and is sometimes wrong.
- **A reform seen from the ranks**: new kit, a maniple merged into a cohort, a
  new centurion, a land promise, the eagle.

## Phases

Each phase is hand-played before it is called done.

1. **Establishments and formations.** Schema; establishments for the six major
   powers; their armies formed, with horse and light troops for Rome and
   Carthage and field armies for Macedon, the Seleucids and the Ptolemies;
   levies formed by the establishment; losses by exposure; unit fates; the
   muster and the slice read formations. A declared soldier or officer is
   placed in a unit with a named centurion and tentmates. Scenario v42, and a
   save migration that forms the major powers' existing armies.
2. **Ranks, posts and careers.** Posts, service records, promotion on vacancy,
   decorations and punishments, discharge, the ten-campaign rule.
3. **Quality.** Training and experience, `drilling`, the doctrine levers read
   by the resolver, levies and campaign, the edge cap, banded morale and
   cohesion deltas.
4. **Reforms.** `military` on enactments, army practice, template replacement,
   refit projects, establishment changes, pressures that open reform
   proposals (a levy short of qualified men, service past a season, defeat by a
   lever the enemy has), imitation after victories, and the consequences
   through loyalty, the veterans and civil war.
5. **Soldier and officer play.** Battle conduct, `unitRef` and unit-scoped
   authority, the tribunes' council, camp seeds, the unit's own Chronicle
   lines, the Service sheet.

## Not in this plan

- Other powers' establishments (after the major powers).
- Units below the century, and individual tactics inside a battle.
- Naval crews as people: a ship stays a hull with men per hull.

## Status (2026-10-02)

Built:

- **Schemas.** `Force.formations`, `Force.posts`, `Force.drilling`, `personnel[].formationId`
  (`material-state.ts`); `Character.service` (`character.ts`); `world.establishments`,
  `world.doctrines`; `warfare/establishment.ts` (templates, ranks, honours, levers, worth,
  the edge cap, `MilitaryReformSchema`); `warfare/formation.ts` (`formArmies`, `readFormation`,
  `unitsOf`, `forceLever`, `polityLever`, exposure); `warfare/service.ts` (`serveInArmy`,
  ranks, `readService`, `campaignsOf`).
- **Battle.** Strength per head by formation (training, experience, doctrine, capped at
  +25 %), losses by line exposure (`ENGAGEMENT_EXPOSURE`), category steadiness and line
  relief in cohesion loss, mobility as a scale in pursuit, rough-ground / screen / boarding
  levers. `CasualtyResult.formationId`; `sim/battle.ts` applies losses to the formation that
  bore them and rolls a named man at his own formation's rate, varied by unit and conduct.
- **Ranks.** `sim/ranks.ts` (`keepTheRanks`, before `keepTheField`): forming new men,
  drill and its fading, war experience, refits ending, doctrine keep and lapse, service
  records kept, campaigns counted, discharge, dead posts cleared, the player's chain named
  and his officer's vacancy filled by promotion. `recordTheFight` after every battle:
  battles, wounds, decorations, punishments, formation experience.
- **Levers wired.** Levies (`manpower_basis`, `levy_cost`, `muster_speed`, state kit),
  marches (`march_speed`), supply (`supply_need`), sieges (`siege_craft`), society
  (`loyalty_to_general`, `veteran_claim`), pay (`pay_discipline`), rest (`restedCeilingOf`).
- **Orders.** `force_modify.drilling | formationRef | doctrine | dropDoctrineRef`
  (`apply/army-practice.ts`), morale/cohesion/fatigue deltas banded (`bandedShift`) and
  cohesion capped by drill; `force_membership_set` `change: "conduct"`; officer's own
  formation is his own business (`own-business.ts`); "doctrine" is a commanding field
  (`nobody-listens.ts`); `enacts.military` carried out by `sim/military-reform.ts`
  (adopt/drop, recruit, standing, stateArms, campaigns, discharge, redraw a body).
  Principle 11 of the orchestrator prompt names them. No new ops.
- **Eligibility.** `min_campaigns` requirement kind.
- **Narrator and openings.** A camp incident for a player serving in the ranks
  (`campBrief`); reform openings (`reform-openings.ts`): levies running dry, a long war,
  a defeat by a doctrine the loser lacks.
- **Slice.** One line per army (`armyInWords`); the actor's `IN THE RANKS` line
  (`serviceInWords`).
- **Client.** The muster shows formations, doctrines and a drill toggle for the commander;
  a "Your place" tab for a man in the ranks with his chain, comrades, record and the
  battle-conduct choice. Model-free routes: `POST /forces/[forceId] {drilling}`,
  `POST /service {conduct}`.
- **Tests.** `sim/src/armies-in-detail.test.ts`.

Hand-played (2026-10-02, `npm run play`, new `--declare` option):

- **The consul** ordered drill and "march light": both parts done, the army drilling and
  practising its own doctrine. Found: Rome's yearly-levy doctrine capped drill below the
  veterans' opening training, so drill did nothing (eased to a slight ceiling); a fleet was
  said to "fight by" the triplex acies (the army line now lists only doctrines that reach
  its men, fights-by apart from kept-by; land doctrines scoped to land lines).
- **A declared legionary** of the hastati: "in the consul's army" made him Consul
  (possessives no longer name a rank; a rank that is an office needs the office); his
  centurion and tentmates had Gaulish names (Roman and Punic name stocks added, Rome,
  Carthage, Syracuse and the Campanians mapped to their peoples); "I mean to win glory"
  read as "nothing came of it" (a conduct or an enlistment is done the moment it is said).
- **The web**, on a throwaway e2e account with hand mode (`Chronica Web (hand, manual)` in
  `.claude/launch.json`): declaration, the Your place sheet, the conduct switch and the
  muster's formations all checked. Found: hand-mode saves failed every `/simulate` read
  (`noProgressAllowedMs` was 142,000 years, an unstorable date; now a century); the sheet
  printed ids in brackets and "the The civic crown"; "turmata" for turmae.
- Not adopted: Polybius' ten campaigns before office is a `min_campaigns` requirement
  (`req-ten-campaigns`) on no office, since the ladder of 270 was custom
  (`a-career.test.ts`); a law can impose it.

Known:

- The orchestrator and cognition prompts were already over their ceilings before this
  work (≈72.7k against 69.5k, ≈67.5k against 63k); this work adds ≈3k to each.
- No battle was hand-played: the enemy is at Rhegium, a month's march. The battle path for
  a named soldier is proven by `armies-in-detail.test.ts` (his place in the report, his
  battle counted, decorations for glory), not by a replay.
