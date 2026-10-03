# A living world: powers that act, a cast that speaks, a world that pushes back

Settled with the user on 2026-10-02, after two hand runs showed a world that
moves only when the player pushes it. The user's goal, in their words: the world
should "actually feel dynamic and alive", and so should the changes.

## Why

Two hand runs, both in hand mode with no provider spend:

- **Observer run** (`eval-out/rank-observer`): a passive grain merchant, 13
  turns, 1 Mar 270 to 25 Mar 269. No war opened that the engine did not drag in
  by alliance. 77% of cognition answers were empty.
- **Soldier run** (`eval-out/rank-soldier`): a tribune who became consul, 54
  turns, 1 Mar 270 to 18 Nov 267. Every one of the six wars in its world file
  involved Rome, and the player started each one. 89% of cognition answers were
  empty. Carthage watched Rome take Messana and did nothing; Rome absorbed ten
  peoples in six months and nobody reacted.

What the code showed:

1. **Almost no power wants anything.** The scenario gives aims to 6 of 168
   powers (`packages/db/src/punic-wars-scenario.ts:705`), and rivalries only for
   the Italian allies toward Rome. Ptolemy's prompt mentions no Antiochus, no
   Syrian war, no Coele-Syria.
2. **Aims are overwritten by wars.** `aimsAtWar` and `aimsFromState` put "press
   the war with X" first, so the Italian allies pulled into Rome's war with
   Rhegium had that as their only aim, for a war they could not fight.
3. **The same people are asked every time.** 4 reactors and 6 ambient seats a
   round, one ambient-only round per chain, a rotation bonus of 0-11 against
   +20 to +30 for every letter, thread and nearby enemy. 47 of 280 people were
   asked all year in the observer run; Antiochus, Antigonus, Alexander of
   Epirus, Areus and Chremonides were asked 0 times.
4. **The narrator measures the player's power for the whole world.**
   `readTension` uses `ownPolityId`; Rome's war with Rhegium never closed, so
   every brief said "there is a war on" and the war seed was halved everywhere.
   Half the seeds were personal troubles for the passive player; world seeds
   went to the quietest corners (omens on the Caspian steppe).
5. **The prompt invites passivity.** The cognition system prompt opens with
   "Most people, most of the time, do nothing of consequence". Ambient actors
   get the last six facts they heard, not the ones that concern them.
6. **Dead business jams the calendar.** Wars with powers that hold nothing do
   not close; letters to a government go "refused by silence" because nobody
   there is woken to read them.
7. **Nobody is a villain.** 280 characters carry 1 cruel and 1 deceitful trait;
   2 have cruelty of 65 or more.
8. **Taking ground is owning it.** A fallen siege flips `controllerPolityId`
   at once (`sim/src/sieges.ts:342`, `apply/apply-deltas.ts`); the map schema has
   `occupationRecords` that nothing writes.

## Decisions

1. **Powers decide by rule.** Every power, near or far, makes its big moves
   (war, peace, alliance, raid, demand, subsidy) in a deterministic monthly
   pass. The engine carries them out. The model gives voice: letters, speeches,
   headlines, and the people around the player.
2. **History weights, circumstances decide.** Historical leanings (Ptolemy
   against the Seleucids, Athens and Sparta against Macedon, Carthage over the
   strait) are biases in the score, never scripts. When the situation changes,
   the choice changes.
3. **Far news reaches the player only when it is genuinely interesting.**
4. **The world pushes back, hard.** Alarm, coalitions, balancers, opportunists,
   reputation, and resentment at home.
5. **Difficulty is chosen at game creation.** It scales the player's
   advantages and the pushback. It does not change the cast size.
6. **Occupation is not ownership.** An army on enemy ground occupies it: held,
   but paying nothing to anyone. Ownership changes only at peace.
7. **A peace table**, after Hearts of Iron IV. It still opens through a letter
   ("let us discuss peace"). A player with no authority can bribe the
   negotiators.
8. **Real villains, fully played.** Massacres, slaving, assassination, coups and
   embezzlement happen in the world, with their consequences, not only in the
   record.
9. **A standing cast.** NPCs run on rules until their salience crosses a
   threshold, then the model plays them every turn, like the nemesis today.

## The design

### 1. The board: what every power can see and wants

A deterministic reading per power, recomputed monthly (`sim/src/board.ts`):

- **Strength**: fielded men (sum of `fit` over its forces) plus a share of its
  levy pool (`availableManpower` over its provinces), with allies' strength
  discounted by distance.
- **Neighbours**: powers across a province edge, with rough strength, where
  their armies stand, who they are at war with, and the agreements between.
- **Grievances**: stance trust (`polityStances`), ground lost and still held
  (`groundToRetake`), claims (`map.claimRecords`), historical rivalry.
- **Openings**: a neighbour or rival that is weaker, distracted (at war
  elsewhere, army far from the border, a new or child ruler, provinces in
  distress), or holds ground this power claims.
- **Fear**: alarm toward each neighbour (section 5).

The board feeds the world AI, the cast's options, the narrator's adversary
choice, and a "neighbourhood" block in a ruler's cognition portrait.

**Data**, in the scenario: aims, rivals and claims for about 25 major powers
(Hellenistic first, then Iberian, Gallic, Numidian, Illyrian), and historical
leanings as weighted pressures for the eastern Mediterranean (the Syrian war
over Coele-Syria, the Chremonidean rising against Macedon, Galatian raids in
Asia Minor, Epirus and Macedon, the Bithynian succession). `aimsFromState`
derives aims for every power with ground and keeps the model's own aims under
a war instead of pushing them out.

### 2. The world AI

Each month, after `reviewLives`, every power with a ruler runs one decision
pass (`sim/src/statecraft.ts`):

1. **Candidates** from the board: declare war on X, sue for peace with Y,
   offer or join an alliance, raid across a border, demand tribute or a
   province, pay an enemy's enemy, break a treaty, revolt from a leader
   (an ally bound by foedus, while the leader is busy).
2. **Score** each by gain, odds and risk, weighted by the ruler's temperament
   and traits (bold, cautious, treacherous, greedy, cruel), the power's risk
   tolerance, historical leaning, alarm, and difficulty.
3. **Act** on the best if it clears a bar set by temperament (a bold ruler acts
   on a lower score), with a small weighted roll so rulers are not perfectly
   predictable. At most one big move per power per month.
4. **Carry it out** through the existing machinery: `openWar`, letters through
   `diplomacy`, marches through the force movement code, peace through
   `concludePeace`. War AI for armies already at war: march on the nearest
   enemy ground or army it can beat, besiege, relieve, retreat when outmatched.
5. **Log the reason** with the act ("Antiochus's army in Bactria; Coele-Syria
   lightly held; old claim") so the cast's dossiers and the news can tell it.

Near powers decide the same way. A ruler in the cast (section 4) has the
pass's best options put to the model instead, and the model's answer replaces
the rule's choice for that ruler that turn.

### 3. Occupation

- An army standing on enemy ground with no defending army in the province
  **occupies** it after a few days (open country) or after a siege (a walled
  city). Writes an `occupationRecords` entry; `controllerPolityId` stays the
  owner.
- An occupied province pays no tax or levy to its owner, and none to the
  occupier. The occupier may forage (feeds its army) or plunder (money and
  unrest).
- Occupation is what war score is made of: `warStanding` counts occupied
  ground rather than ground "taken".
- Ownership changes only at peace: ceded provinces change owner, the rest go
  back. Occupation ends when the occupier leaves, is driven out, or peace is
  made.
- The map hatches an occupied province in the occupier's colour.
- Many occupied provinces over-stretch the occupier: garrison needs, unrest,
  armies tied down.
- Risings (`unrest.ts`) and total conquest (submission, `polity-end.ts`) keep
  their own rules: a rising that holds ground is a power; a power that
  submits is gone.

### 4. The cast

Three tiers:

| Tier | Who | How they act each turn | Cost |
|---|---|---|---|
| Background | Minor chiefs, far magistrates, ordinary senators | Folded into their power's decision. Age, die, marry, hold office. | Nothing |
| Rule-driven | Anyone with something going on: rulers, generals, officials, plotters, villains | Their own decision pass. The best option is taken if it clears a bar. | Nothing |
| The cast | The 8-12 who matter most now | The rules work out their options; the model decides, speaks and invents. | Prompt tokens in a batched call |

**Salience**, recomputed each turn (weights are a first guess):

| Reason | Weight |
|---|---|
| The player's direct superior, or someone the player commands | +40 |
| The player's rival, enemy or nemesis | +35 to +50 |
| Kin of the player, or in active correspondence with them | +25 |
| Ruler of a great power | +25 |
| Ruler of a power bordering the player's | +15 |
| Inside a live thread, plot, war or negotiation | +20 |
| A villain with a scheme running | +20 |
| Just did something big | +15, fading over two months |
| Far from anything the player touches | -10 to -30 |

- **Promote** at 60 or more; **demote** below 40 for two turns. **Minimum
  stay** three turns.
- **Seats** (with 10): 1 nemesis, 2-3 for the player's chain, 2 for the wider
  world, the rest open. When full, the lowest scorer past its minimum stay
  steps down.
- **Starting cast**: the nemesis, the player's superior, the rulers of the
  powers next door, and villains created on purpose.
- **Once per turn.** The cast takes one standing look per burst, not one per
  round. Within a burst a member is asked again only when news lands on them,
  which the reaction router already handles.
- **The rule proposes, the model disposes.** Each member gets a dossier and the
  top three options from the rules, each with its odds. The model takes one,
  invents a better one, or chooses "nothing" against named alternatives.
- **Dossier**: traits and temperament, wants, grudges, what they are doing,
  "lately" from the rule log (decision and reason), and the options.
- **Handoffs**: promotion builds the dossier from the rule log; demotion turns
  the model's last plan into a rule-driven plan with steps.
- **Visible**: a "who matters now" list for the player.
- Stored as `world.cast` (members, entry day, salience history) and
  `world.ruleLog` (bounded).

**Cost**, measured on the observer run's cognition prompts (268 sections):
median section 3,754 characters (~950 tokens), average 4,312 (~1,100), 90th
percentile 7,252 (~1,800). With the dossier and options a member is about
**1.5k tokens**; ten are **~15k prompt tokens**. The cognition system prompt is
69,323 characters (~17k tokens) per call, paid whether a call carries one person
or ten; a second shard pays it again (less with caching). On gpt-6-luna ($0.10
in, $0.50 out per million):

| Item | Tokens | Cost |
|---|---|---|
| 10 sections | ~15k in | ~$0.0015 |
| An extra shard's system prompt, if needed | ~17k in | ~$0.0017 |
| Answers, if 6 of 10 act at ~500 tokens | ~3k out | ~$0.0015 |
| **Extra per turn** | | **~$0.003-0.005** |

Against the $0.015-per-turn target that is a fifth to a third of the budget.
Output is the variable to watch: answers averaged 226 bytes when nobody acted.
**Start the cap at 8**, measure tokens per section, the share who act and
answer length in the first hand runs, then set the cap from the measured cost.
Cast size is a budget setting (small / normal / large), separate from
difficulty.

### 5. Pushback

The rule: the world organises against power in proportion to how fast and how
roughly it grows, and always warns first.

**Abroad**

- **Alarm** per power toward each neighbour: rises with conquests, absorptions,
  broken treaties and sacked cities, more when the victims shared its people or
  gods; fades over years. Stored as `world.alarm`.
- **Coalitions**: alarmed powers whose combined strength is a match form a
  defensive league (an `alliance` with a coalition flag). Attacking a member
  brings in all of them. Warned in the news first ("a league is spoken of among
  the Samnites") and in cooler letters.
- **Balancers**: a great power acts when the balance tips: Carthage answers
  Messana; Ptolemy pays Rome's enemies, hires them mercenaries, opens his ports.
- **Opportunists**: when a power's armies are far away, neighbours raid or
  invade.
- **Reputation**: broken promises and treachery lower trust everywhere and
  harden terms.

**At home**

- **The conquered resent**: occupation unrest, risings, old peoples
  remembering they were free.
- **Allies want their share**: refused often enough, Italian allies who want
  citizenship rise (the Social War).
- **Envy**: fast-won standing breeds rivals, prosecutions, vetoes and plots.
- **War weariness**: long wars cost legitimacy and stir the assemblies.

**Difficulty**, chosen at game creation and stored on the game: scales the
player's advantages (starting standing, money, the odds of the player's own
rolls) and the pushback (alarm gain, coalition threshold, opportunist
appetite, how many open cast seats go to hostile people).

### 6. Villains

- **Generation**: vices distributed by culture and station: greedy, cruel,
  treacherous, cowardly, paranoid, envious, wrathful, corrupt, zealous. Applied
  to scenario characters without hand-written traits and to everyone the
  engine creates.
- **Vices drive the rules**: a treacherous king breaks a treaty when the numbers
  favour it; a greedy official embezzles (the department graft rules); a cruel
  general sacks the city and enslaves its people (alarm, reputation, unrest);
  an ambitious and deceitful man plots a coup (`covertPlots`); a paranoid ruler
  purges.
- **Archetypes** the narrator can create: the usurper, the warlord, the pirate
  king, the corrupt governor, the fanatic, the turncoat.
- **Fully played out**: massacres, slaving, assassination, coups and purges are
  acts the engine carries out with material consequences, not prose.
- **Nemesis choice** leans toward people with real vices.
- The cognition prompt's "play people as they are" goes into one of the
  existing principles, not a new rule ([[feedback-generalize-prompt-rules]]).

### 7. Death and succession

Rulers age, sicken and die, with historical dates as weights (Areus around 265,
Antiochus I around 261). Successions can be contested: brothers, a regent for a
child king, a general who refuses the heir. Each one makes openings for the
world AI and stories for the news.

### 8. The peace table

- Opens from a letter: "let us discuss peace", accepted by the other side.
- A full screen: the map with every occupied province, each side's war score,
  and clauses. The existing clauses (cession, indemnity, hostage,
  force_transfer, submission, undertaking) plus release a people, return
  occupied ground, tribute, break an alliance, become a client, a demilitarised
  border, trade rights.
- War score is a budget of points; each clause costs points (`priceOf`
  extended).
- Turns around the table; in a coalition war each ally claims its share.
- The AI side accepts, counters or walks out by rule (war score, weariness, what
  is asked against the budget, `willingToGive`); the model writes the envoy's
  words.
- Authority still applies: a consul's terms go to the Senate for ratification.
- **Bribery**: a player without authority can pay a negotiator or a senator to
  push a clause, at the risk of being found out.
- Sessions take game days; fighting goes on, so a battle mid-conference moves
  the budget.

### 9. News that reaches the player

A deterministic score: importance (a war, a ruler's death, a great battle, a
city sacked, a coup, a border moved) times relevance to the player (distance,
trade routes they use, ties to their power, their career) times novelty. Only
what clears a high bar arrives, after a travel delay, sometimes first as
rumour, as a few lines a month. Far elections and harvests never make it.

### 10. The far world in the player's life

Wars abroad move prices, close trade routes, make mercenaries plentiful or
scarce, and send refugees and exiles. A grain merchant feels Egypt's war in his
ledger.

### 11. Measuring it

Every run reports, per year: wars opened and closed, and how many did not
involve the player; rulers changed; borders moved; distinct powers acting;
coalitions formed; villains' deeds; cast tokens per section, share acting and
answer length. Targets: several wars a year that do not involve the player, a
few headlines a month worth reading.

## Faults from the two runs, fixed on the way

- **Crash**: `sim/src/elections.ts:378` builds `election_held` affectedRefs from
  every candidate; the 16-seat military tribune college gives 17, over the
  Fact cap of 16. Blocks every run past 20 Apr 269.
- Wars with a power that holds no ground and has no army do not close.
- Letters to a government "refused by silence" because no reader was woken.
- Narrator tension and war halving read the player's power for the whole world.
- Personal seeds every burst for a passive player; the purse refusal published
  as a chronicle fact.
- Far elections on one day (60 at once); wrong office names for the culture.
- Stale aims after a war is won; regime-change opportunities for powers with no
  contact.

## Order of work

| Phase | What | Depends on |
|---|---|---|
| P0 | Unjam: the election crash, dead wars, narrator tension per target, purse refusal not a fact | - |
| P1 | The board, scenario agendas, rivals, claims, historical leanings; `aimsFromState` for every power | P0 |
| P2 | The world AI: war, peace, alliance, raid, demand, revolt; army AI for wars | P1 |
| P3 | Occupation vs ownership, war score from occupation, map hatching | P2 |
| P4 | The cast: salience, seats, dossier, options, once per turn; cognition prompt rework | P1, P2 |
| P5 | Alarm and pushback; difficulty at game creation | P2, P3 |
| P6 | Villains: vices, vice-driven rules, archetypes, atrocities played out | P2 |
| P7 | Death and succession | P2 |
| P8 | The peace table UI, bribery | P3 |
| P9 | News that reaches the player; consequence channels | P2 |
| P10 | Liveliness metrics in the harness; hand runs (no provider spend) | each phase |

Each phase is tested deterministically, then hand-played (`CHRONICA_AI_MODE=hand`,
`npm run play`). No `--live` run without a go-ahead.

## Progress

- 2026-10-02: plan written.
- **P0 done.** Election refs capped at 16 (`elections.ts`); a landless power whose
  every army is starving ends after 90 days, and a held city counts as ground
  (`polity-end.ts`: the Campanians hold Rhegium inside a Bruttian province);
  narrator war halving and the seed's reason read the target's power, not
  Rome; personal seeds are a third of the count, not at least one. The
  "letters refused by silence" fault was the harness's auto-empty answers,
  not the engine. The "purse" line is a private engine-rejection record.
- **Harness fault found:** `scripts/hand-played-burst.mts` and
  `eval-out/rank-run.mts` never passed `life`, `wealth` or
  `historicalPressures`, so no hand run ever had ageing, deaths, births or the
  age's pressures. Both now pass them, as `apps/web/lib/burst-runner.ts` does.
- **P1 done.** `sim/src/board.ts` (strength = fielded + 5% of the levy pool,
  whole foedus blocs, borders, rivals within 1 200 km, distractions,
  grievances, claims); `db/src/punic-wars-politics.ts` (scenario v43: 51
  stances, 2 standing peaces, 218 claims, 21 more outlooks, 5 eastern
  pressures); `aimsFromState` derives aims from the board; a leader's war is
  "send its men to", not "press the war"; rulers' portraits show their
  neighbourhood. `scripts/read-board.mts` prints it.
- **P2 done.** `sim/src/statecraft.ts`, run monthly from the burst as the
  world's business: war, revolt, raid, alliance, levy, peace by rule (winner
  dictates, both spent, or claims held), armies at war (attack, fall back,
  besiege walled towns, march, retake own ground at even odds), letters to
  far powers answered by rule. Scores are a monthly chance, no wars before
  day 45, at most 3 new wars a month, a season between raids on the same
  neighbour. The player's power is never acted for. Ledger:
  `world.statecraft`.
- **P3 engine done, map hatching not yet.** `Province.ownerPolityId`
  (`world/occupation.ts`): war takes ground as occupation (sieges,
  `province_control_set`, `settlement_control_set`, and open country by
  `sim/src/occupation.ts`, an army's patrols holding undefended unwalled
  ground within 80 km, never contested ground); occupied ground pays tax and
  levy to nobody; peace settles by uti possidetis (cessions by the owner);
  orphaned occupations settle in the tick. War score counts ground as a share
  of the loser's land (60 for all of it) and battles won on land and at sea
  (`recordBattle`, 6 a battle, 9 large, 12 great, capped at 30).
- Engine bug found on the way: a battle's encounter text overflowed 400
  characters and every NPC battle batch was refused.
- `npm run world:alone -- 24` runs the world with a silent model and prints a
  liveliness summary. Two years, nobody acting by model: Macedon beats Epirus
  and dictates peace; the Seleucids open the second war for Coele-Syria,
  occupy Phoenicia and Galilee, and Egypt marches up and wins at the Magoras;
  Athens and Sparta, the Boii and Insubres, Egypt and Bithynia ally.

- **Mid-build rules from the user:** battles won on land and at sea count
  toward the war score; cities count heavily, each worth more the fewer a
  power has, and the capital is the single greatest prize. War score now:
  open country up to 25 by share, cities up to 40 by share, the capital 35,
  battles up to 30. Peace prices (`provinceWorth`) use the same measure. A
  power with no army is beaten only after 120 days without raising one:
  counted from day one, every war with a levy-raising people was won at once.
- **P4 done.** `world.cast` (`world/cast.ts`, `sim/src/cast.ts`): salience,
  seats (1 nemesis, chain, 2 world, open), enter at 40, stay above 25 (the
  plan's 60/40 left the opening cast empty), minimum stay 3 reviews, world
  seats kept filled from 15. Reviewed once a burst; each member asked once,
  with a dossier (lately, from the rule log; options from
  `rulerOptions`: wars, risings, peace, armies). The rules stand back from
  cast members. Ambient people are shown the news that concerns them first.
  The cognition prompt's opening principle reworded ("nobody is here by
  accident... play people as they are"), not a new rule. Opening cast for the
  consul: Hanno, Blasio, Vibellius.
- **P5 done.** `sim/src/pushback.ts`: alarm from a year's growth, wars begun
  and peaces broken; rumours at fear; leagues (`PolityAgreement.against`) and
  calls to arms; balancers' subsidies; reputation for a broken peace; allies
  souring in a leader's long war. Alarm feeds war appetite. Difficulty
  (`world.difficulty`, chosen on the begin page: gentle, normal, hard,
  merciless) scales alarm and leagues against the player's power, appetite
  against it, hostile cast seats, the player's purse and standing at entry,
  and a morale edge in the player's own battles.
- **P6 done.** Vices (`characters/vices.ts`, seven new traits): drawn by
  station for everyone without a written nature, scenario and engine-made
  alike (31 cruel people in the opening world, from 2). Coups, usurpation,
  purges (`sim/src/villainy.ts`), sacks by cruel or wrathful commanders
  (`sieges.ts`: people killed and sold, plunder, alarm), villain archetypes
  for the narrator (warlord, corrupt governor, turncoat), nemesis choice
  leaning to vice. Offices are read from seats: generated officials carry
  none on themselves.
- **P7 done, lightly.** Deaths follow the scenario's life rules and true ages
  (the harness now passes them). Contested successions: an ambitious general
  whose army outweighs the loyal ones seizes a new ruler's seat
  (`seizeThrones`); otherwise he plots. No scripted historical death dates.
- **P8 done, not checked in a browser.** `world.peaceTables`
  (`world/peace-table.ts`), the "peace_talks" letter kind, `sim/src/peace-table.ts`
  (prices, rule answers, counters, demands, walk-outs, bribery),
  `apps/web/lib/peace-table-service.ts` and its route, the "Peace table" tab
  in the standing panel (`peace-table-sheet.tsx`).
- **P9 done.** `sim/src/far-news.ts`: far facts below the telling bar stay
  their own powers' news. Trade (`routeOpenBps`) earns a third at an end at
  war, a fifth where occupied or blockaded. Refugees and mercenary markets
  not built.
- **P10:** `npm run world:alone -- 30 [--save world.json]`. Thirty silent
  months: 10 wars, all away from the player, 4 ended; 5 alliances; 20 powers
  acting; a Roman plot against the consul; no act refused. All suites at
  their pre-existing baseline; failures that appear only under the full
  parallel run pass alone. No model-answered hand run yet: the next step.
- **Known gaps:** a cast member's war waits on the model (fine in play, idle
  under a silent harness); a far power's seat-takings and harvests still
  crowd its rulers' "recent events"; the peace table needs a browser pass;
  historical death dates and refugee flows are not modelled.
