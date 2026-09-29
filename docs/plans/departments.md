# Departments: skills through the person in charge

Settled with the user on 2026-09-27; built 2026-09-27/28 (uncommitted). The
display side is left out on purpose: the user is reworking the UI and will
decide where this is read.

## As built

Where the build differs from the design below, the build is what holds:

- **Code:** `shared/src/world/departments.ts` (levers, the reader, pay, graft
  and audit schemas), `shared/src/world/war-weariness.ts`,
  `sim/src/departments.ts` (forming, experience, pay and graft each tick,
  audits, the founding measure), `sim/src/trials.ts`, `sim/src/skill-decline.ts`,
  `sim/src/sue-for-peace.ts`.
- **Households** are run through service contracts with the new roles
  `steward` (everything) and `agent` (trade only), not household offices.
  An owner's estates are his until he hires one.
- **A college nobody was ever named to** (four quaestors, a hundred and four
  judges: an office with no seats) runs at 50 plus its experience, not
  as vacant. `VACANT_SKILL` (25) is for seats that exist and stand empty.
- **The measure's shape for the model:** `enacts.department` =
  `{ departmentRef?, name?, levers?, headOfficeId?, officeIds?,
  deputyOfficeIds?, pay?, effects?, abolish }`. Offices it names that do not
  exist are made with one empty seat, labelled from their ids. With no
  levers named, the name is read for them (`leversNamedBy`). If it says
  nothing either, a standing effect of the people's favour is the floor.
- **Audits** are the op `audit_open`, a fixed 60 days.
- **Courts and grain** make order and food come back faster or slower
  (`ProvinceTargets.*RecoveryScale`), not a new level. A new level would have
  changed how every province in the world settles.
- **Public rites** move legitimacy up to ±40 bps a month, in the monthly
  society review.
- **Public works** cost ±15% for projects paid from a power's chest.
- **A tax pressed past what the land bears:** a good collector brings in more
  only as far as the land has room (`tick.ts`), so the ceiling holds.
- **Gates** are recorded on departments. Only `judge_commander` acts: a
  power whose court judges generals tries a commander who lost, with death
  asked for a routed army. The `spend` gate is not enforced beyond the
  treasury permissions offices already have.
- **Pressure** gives the ruler of an organised power with three or more
  provinces an ambition to hand work off (when his workload is −9 or worse)
  or to appoint a treasurer (when his chest is in debt).
- **Built 2026-09-28** (characters pass):
  - insubordination, decided when an order is given (`sim/insubordination.ts`):
    loyalty, fear, duty, conscience, ambition, faction, a salaried post and
    the giver's reputation make a chance the man answers by his own temper
    (refuse, delay or subvert) before the model is asked; an officer who
    hates his ruler also drags down his department's lever (`SULK_*`);
  - grumbling ambitions against an officer whose lever runs badly or whose
    hand was found in the chest (`sim/grumbling.ts`);
  - the plot-uncovered and famine pressures (`wantDepartments`);
  - the refuser's gain in confidence: less fear of the giver and a `defied`
    lesson that makes him bolder at his next life review;
  - the courts holder's say in how fair a trial is (`trials.ts`
    `judgmentLean`): a fair court follows the evidence, an unfair one its
    judge's opinion and cruelty; the accused's reputation counts either way.
- **Not built:** the refused peace offer's confidence and arrogance causes
  (a refused offer still only costs trust between the powers).
- **Scenario v35** seeds Rome's and Carthage's departments and the new office
  `carthaginian-accountant`.
- **Orchestrator prompt limit** raised 66.5k → 67.5k (`prompt-smoke.test.ts`).

## Why

The finer skills (strategist, taxation, espionage…) now move real numbers,
but they reach a power by guesswork:

- `taughtBy` in `packages/sim/src/tick.ts` reads what an office does from
  its **name** (`/quaestor|treasurer|censor/` is "taxation").
- A power's taxes are gathered by its **best** tax man among all its
  magistrates (`collectorOf`, same file), so a fool sitting beside him costs
  nothing, and a king's own skill never counts.
- Nothing lets a ruler hand a job to someone, or make a new office that
  changes anything.

The rule this plan puts in place: **whatever a power (or a household) does
is done as well as the person in charge of it can do it.** A king with no
ministers runs everything on his own gifts. Once he appoints someone, that
person's gifts count instead.

## Decisions

1. **The engine owns a list of levers; departments are made of levers.** A
   lever is something the engine can actually compute: the tax take, plot
   detection, march speed and so on. A department is a named bundle of
   levers, staffed by offices.
2. **Departments come about during play.** The model names each one and
   picks its levers. No fixed list of ministries exists.
3. **Every department does something real.** A department order is never
   refused. It gets its effect from its levers, else from a
   `write_mechanic` rule, else from a standing project (§4).
4. **Each lever has one holder per power.** If no department holds a lever,
   the ruler does (a republic's chief magistrates: in Rome, both consuls).
5. **Creating a department takes its levers from whoever held them.** The
   ruler drops out of those levers entirely unless he makes himself its head.
6. **An empty seat runs badly.** The lever stays with the empty department
   and works at a low fixed skill until someone is appointed. It goes back
   to the ruler only by a constitutional change or an order that goes
   through.
7. **Several officers are averaged.** The department's standing effect is
   the average of its officers' skill.
8. **The head lifts everything in the field.** Every mission in the
   department's field gets the head's bonus, up to ±15%, on top of the
   skill of whoever runs it.
9. **A new department takes time to organise.** Until it has formed, the
   old holder keeps the levers.
10. **Households work the same way.** A man's estates and ventures are
    levers of his household. He runs them until he appoints a steward or an
    agent.
11. **Senates and councils keep their historical powers,** as gates (§6),
    not as skill averages.
12. **Only Rome and Carthage start with departments,** named once when the
    scenario version is built. Every other power starts with the ruler
    holding every lever.
13. **Honesty is the existing `mind.temperament.honesty`,** not a new trait.
    Its derived spread is widened (§9).
14. **Graft goes to the officer's own account or to his faction's** (§9).
15. **Pay grows with rank and the department's budget.** A consul, a
    treasurer and a senator are never paid alike (§7b).
16. **Skills fall with disuse, age and illness,** down to a floor of half
    the peak (§12).
17. **NPC powers sue for peace on their own.** They seek a truce first. A
    peace party at home can force talks (§13). Mediators are left out for
    now.
18. **The orchestrator prompt stays within its limit if possible.** It is at
    61 084 of 63 000. This plan is folded into the existing twelve
    principles, and the limit is raised only if that can't be done.

## 1. Levers

A lever reads one finer skill (or two, averaged) and moves one thing the
engine already computes. The list lives in code, in
`packages/shared/src/world/departments.ts`. The model can only combine
levers from it.

Each lever belongs to a **family**. Families are what workload counts (§3),
and they are the implicit portfolios the ruler holds before any department
exists.

| Lever | Family | Skill | Moves | Reads today at |
|---|---|---|---|---|
| `tax_roll` | treasury | taxation | ±15% on the power's levied income | `tick.ts` `collectorOf` / `handling` |
| `public_works_cost` | treasury | stewardship | ±15% on the cost of public projects | project costing in `tick.ts` |
| `audit` | treasury | taxation + espionage | chance an audit finds graft (§9) | new |
| `watch` | watch | espionage | discovery of plots against the power and its officers | `plots.ts` (defender's side) |
| `covert` | watch | manipulation | odds of plots the power sponsors | `plots.ts` (hand's side, as head bonus) |
| `supply` | war | logistics | march speed of the power's forces | `apply-deltas.ts` quartermaster |
| `levy` | war | authority | men raised by a levy, and desertion on the march | levy and desertion code |
| `foreign_letters` | foreign | rhetoric | how letters in the power's name warm their reader | letter reception |
| `peace_talks` | foreign | arbitration | bargaining in peace talks | `peace.ts` envoy/asker |
| `public_rites` | religion | rites | monthly legitimacy drift from the gods' favour | `material/legitimacy.ts` |
| `courts` | justice | arbitration | unrest from disputes; the fairness of trials (§9) | new |
| `grain` | provision | logistics + stewardship | grain shortfall and the unrest from it | where the engine models grain |
| `estate:<id>` | household | stewardship | ±15% on one estate | `handling` (owner branch) |
| `venture:<id>` | household | stewardship + logistics | ±15% on one venture | `handling` (venture branch) |

The following **stay personal** because they are missions, not standing
work. Each is judged by the man doing it (§5):

- a commander's battle, desertion in battle, his risk of death and his
  men's morale;
- a senator's speech;
- a letter written in a person's own name;
- a plot's hand.

Adding a lever later means one row here and one reading site. Nothing else
changes.

## 2. Departments

```ts
Department {
  id, polityId | householdOwnerId,       // a power's, or one man's household
  name,                                  // model-chosen
  levers: LeverId[],                     // at least one, unless it has a rule or a standing project
  officeIds: OfficeId[],                 // the offices that staff it; seats come from officeSeats
  headOfficeId: OfficeId | null,         // the head, where it has one
  deputyOfficeIds: OfficeId[],
  pay: "honorary" | "salaried",          // salaried reads Office.incomeSourceId
  foundedAtStep, formsAtStep,            // formsAtStep > now: still organising (§4)
  experienceYears,                       // institutional memory (§3)
  mechanicRuleId: string | null,         // §4 step 2
  standingProjectId: string | null,      // §4 step 3
  gates: Gate[],                         // §6
  origin: "scenario" | "order" | "pressure" | "reform",
  abolishedAtStep: number | null,
}
```

Departments are stored in `world.departments`. They are part of the
constitution: the constitution record (`world/constitution.ts`) lists them,
and creating or abolishing one writes a `ConstitutionChange` to its history.
The offices themselves stay in `offices`, and their holders in
`material.officeSeats`, as today.

**Replacing the name guessing:**
- `taughtBy`, the name-reading function, is **deleted**. A term in an office
  teaches the skills of its department's levers, +2 split across them.
- An office in no department still teaches nothing new, beyond what its
  missions teach.
- `collectorOf` is **deleted** and replaced by `leverSkill(world, polityId,
  "tax_roll")`.

## 3. How a lever's skill is worked out

`leverSkill(world, holder, lever)` returns a number from 0 to 100, which is
then fed to the existing `skillShare(value, reach)`.

```
officers   = living holders of the department's seats (head included)
if the department is still forming      → the previous holder's leverSkill
if no officer                           → VACANT_SKILL (25)
base       = average over officers of (aptitude(officer, lever.skill) − workload(officer))
memory     = min(10, experienceYears)                  // +1 a year, up to +10
friction   = −5 per pair of rival colleagues, down to −15
skill      = clamp(0, 100, base + memory + friction)
```

- **Ruler-held levers** use the same formula with "officers" being the ruler
  (or both consuls). There is no memory bonus, because there is no
  institution.
- **Workload** counts the families a person holds across everything:
  - each department he serves in counts once per family among its levers;
  - each family he holds as ruler counts once;
  - his household counts once;
  - holding more than three families costs 3 per family past three, down to
    at most −25.

  A Hellenistic king holding all seven families of the state's work is at −12
  on every lever (−15 if he also runs his own estates)
  until he appoints ministers. That penalty is the reason to delegate at all.
- **Institutional memory:**
  - it grows by one year per year the department exists and has at least one
    officer (a vacant year doesn't count);
  - abolishing the department loses it, and a newly created one starts at 0;
  - seeded departments start with their historical age (Rome's quaestorship
    is long established, so +10).

## 4. Creating, forming, abolishing

**Who can create one:**
- **By order.** The player or an NPC orders it, through whatever the
  constitution requires: a king decrees; a Roman consul needs a senatus
  consultum; in Carthage, the Elders. The question carries the
  `new_office` concern, so blocs already lean on it.
- **By pressure.** The engine notices a pain it can measure and gives a
  motivated NPC (the ruler, or whoever holds the lever now) an ambition to
  fix it:

  | Pressure | Ambition |
  |---|---|
  | A plot against the power uncovered, or one that succeeded, with no `watch` holder besides the ruler | set up a watch |
  | Treasury in debt three months running | appoint a treasurer |
  | Grain shortfall with unrest | a grain commissioner |
  | A ruler's workload past −9 | hand off his weakest family |
  | Several ventures abroad in one household | an agent for them |

  These go through the NPC plan machinery (`npc_plans`), so they become plan
  steps, not instant acts.

**The model turns the order into a department:**
- It chooses the name, the levers, the head and the officers' offices, and
  whether the department is paid or honorary.
- It uses the existing offices where they fit. Otherwise it creates new ones
  through offices on demand.
- Vague orders get their details filled by the model. The Chronicle records
  what the department was given.

**It is never refused.** The engine checks the result in order:

1. **Levers.** If the order matches levers, the department takes them.
2. **A rule.** If nothing in the lever list fits, the department carries a
   `write_mechanic` rule instead. For example, "a board of weights and
   measures" gets market income in its cities up by an amount its officers'
   stewardship decides. The rule fires each tick, like the rules on
   arrangements do now. The rule's warrant comes from the department.
3. **A standing project.** If even a rule can't say it (say, "curators of
   the aqueducts"), the department runs an ongoing delegated project. It has
   a monthly budget from the treasury and a monthly skill check through
   `delegation.ts`, and records its results: works built, repairs done, the
   people's favour.

So a department always has a lever, a rule or a project.

**Forming:**
- A new department forms over 30 days, 60 if it takes more than two levers
  or is set up in wartime.
- Until then, the previous holders keep its levers. The Chronicle records
  the day it forms.

**Abolishing:**
- It needs the same authority as creating.
- Its levers go back to the ruler, unless the measure names another
  department to take them.
- Its offices lapse and its experience is lost.

**Moving a lever between existing departments** is the same measure,
formally a reform. The lever loses its memory bonus for the receiving
department's first year.

## 5. Missions and the head's bonus

A mission is any bounded piece of work a named person runs:
- a plot;
- an embassy or peace talks;
- a delegated project;
- a levy raised in person;
- a march;
- a battle;
- an audit.

**The mission leader's skill decides the mission,** as today:
- `plots.ts` reads the hand;
- `peace.ts` the envoy;
- `delegation.ts` the delegate, on its own skill and the job's finer skill
  together;
- `battle.ts` the commander.

**The head of the department whose field the mission falls in** adds
`skillShare(aptitude(head, lever.skill), 0.15)` to the mission's outcome:
- plots sponsored by the power, under `covert`;
- peace talks, under `peace_talks`;
- a march's speed, under `supply`;
- a delegated project, under whichever lever matches its kind.

If the field has no department, the ruler's skill gives the bonus, minus
workload. A fool at the head is a −15% on everything in his field, and
that's a reason to replace him.

**Battles:** the commander keeps the effects he has now. The war
department's head bonus applies to supply and the levy, not to the fighting
itself, so a general's own gift still decides the day.

## 6. Gates: the Senate's historical powers

A gate says which body must approve which act in a department:

```ts
Gate { institutionId, act: "spend" | "make_war" | "make_peace" | "assign_command" | "receive_embassy" | "judge_commander" | "create_or_abolish" }
```

**Rome:**
- the Senate gates `spend` from the treasury (quaestors pay nothing out
  without a senatus consultum), `receive_embassy` and `assign_command`: a
  consul gets his army only when the Senate names his province;
- the assemblies keep war and elections, as in v31–v33.

**Carthage:**
- the Council of Elders gates `make_war` and `make_peace`;
- the Hundred and Four gate `judge_commander`, as below.

**Monarchies** have no gates. The advisory council's non-binding vote works
as it does now.

**Gates and the existing powers:** gates run through the institutions'
existing `powers` and the questions/votes machinery. A gated act becomes a
question with the right concerns. The chamber's own weight comes from blocs
and speeches, as now. Its members' skills never average into a lever.

**`judge_commander`** is new: a commander who loses a battle, or surrenders,
is put on trial. The outcome is chosen by vote:
- acquittal;
- a fine;
- exile;
- death (crucifixion, in Carthage).

The `courts` lever's holder shapes how fair the trial is. Blocs and the
man's standing do the rest.

**Removing a gate** is a constitutional change. A dictatorship is a
government that does without the gates for a term.

## 7. Terms, growth, deputies

- **Terms stay** as `Office.termDays` has them. Short terms (Rome's year)
  spread skill wide and shallow across the elite. Lifelong ministers grow
  deep and old. The two kinds of competence come from the constitution, not
  from a rule.
- **Finishing a term** gives +2 split over the skills of the office's
  department's levers. This replaces the name-read `taughtBy`.
- **Missions** grow their leader's skill as today:
  - a battle: +2 strategist, +1 martial for a win;
  - a speech: +1 rhetoric;
  - plus +1 in the lever skill for a mission completed as leader.

  The ceiling from practice stays at 90.
- **Deputies learn from their head.** Once a year, each deputy's skill in
  each of the department's lever skills moves +1 toward the head's, while
  the head is higher. It stops at the head's level minus 5, and never goes
  past 90. A great quaestor trains his successors.

## 7b. Pay

**A post's pay depends on its rank and the size of the department's
budget.** A consul, a treasurer and a senator are never paid the same.

**Rank** comes from the post's place in the power, not from its name:

| Rank | Who | Rate on the budget | Floor a month |
|---|---|---|---|
| 1 | Ruler or chief magistrate (king, consul, suffete) | 2% | 400 |
| 2 | Head of a department | 1.5% | 200 |
| 3 | Officer of a department | 1% | 100 |
| 4 | Deputy | 0.4% | 40 |
| 5 | A seat in a council or senate, not in a department | — | a flat sitting stipend, or nothing |

**The budget** is the money the post's department handles each month,
averaged over the last three months so pay doesn't jump from month to
month:
- for a treasury, the tax it collects;
- for a war department, the army's pay and supply;
- for a works board, its project budget.

A ruler's budget is the sum across the families he still holds himself,
plus the largest department he heads.

**How the numbers combine:**
- **Collegial seats are not split.** Each of two consuls is paid the full
  rate. A college costs more than one man, and that cost is a real reason
  not to multiply offices.
- **The formula gives the pay the rank expects:**
  `expected = max(floor[rank], budget × rate[rank])`. Rates and floors are
  in the scenario's money and are first guesses, tuned in the hand-played
  run.
- **Pay is drawn monthly** from the power's treasury through the office's
  existing `incomeSourceId`. A treasury that can't pay leaves the post
  unpaid that month, and that counts as honorary for graft (§9).

**Honorary posts** are paid nothing, as Rome's magistrates historically
were. Their expected pay still counts: it measures how tempted an unpaid
man is.

**Pay can be changed by order:** raised, cut or abolished, through the
constitution's gate for `spend`. A power that underpays its treasurer saves
money and gets stolen from.

**Households** use the same rule on the estate or venture's income. A
steward is paid at rank 2 on the estates he runs, an under-steward at
rank 3. A slave steward costs his keep, which is the floor.

## 8. People: patronage, rivalry, insubordination, competence

**Patronage:**
- Appointing someone gives him a lasting relation cause toward the
  appointer: +trust, +obligation.
- Appointing against the office's `expectedBlocId` costs standing, as now.
- A department staffed from one faction adds that faction's leader to those
  who learn what the department learns. Knowledge flows to his side through
  the existing acquaintance rules: a watch full of your rival's clients tells
  him your secrets.

**Rivalry:**
- Two colleagues in one department count as rivals when either condition
  holds:
  - their mutual relation is below −25;
  - they lead or belong to opposed blocs on the department's concerns.
- Each rival pair costs −5 of friction, down to −15.
- A quarrel between them reaches the Chronicle once, when it begins.

**Insubordination:**
- An order given to a department is carried out by its head, or its officer
  in charge. A hostile officer may slow it, botch it or refuse it.
- The chance rises with low loyalty to the one giving the order, low
  honesty, and an order that hurts his own faction.
- The chance falls with high duty and a salaried post.
- A refusal is a typed outcome the order records, never a silent drop. That
  keeps "orders never dropped" true: the order reaches the Chronicle as
  refused, and the player can dismiss the man.

**Competence is read, not shown:**
- NPC briefings already name standout gifts. Now they also describe how a
  department is doing: "the tax take from Campania is down, though the
  harvest was good".
- An officer whose lever runs well below its expected result becomes the
  target of grumbling: an ambition, for anyone who dislikes him, to have
  him replaced.

## 9. Corruption

**Appetite** is how much a man would steal given the chance, 0 to 1:

```
greed    = (100 − honesty) × 0.5 + drives.wealth × 0.3 − drives.duty × 0.2   (then 0–100)
         + 10 if the "deceitful" trait, − 10 if "dutiful"
appetite = greed / 100
         × (1.3 − 0.3 × min(1.5, paid / expected))    // §7b: unpaid ×1.3, paid in full ×1.0, well paid ×0.85
         × (1 + 0.1 × provinces from the capital, up to ×1.6)
```

**Opportunity** is what flows through his hands. Only levers that handle
money can leak:
- `tax_roll`;
- `public_works_cost`;
- `grain`;
- the budget of a standing project;
- a household's `estate:` and `venture:` levers.

**Leakage:**
- Each tick, each officer diverts up to `appetite × 12%` of his share of
  that flow. That means `flow / officers`, less whatever part colleagues'
  honesty stops, split evenly among the honest ones.
- It moves as a **real `MoneyTransaction`** of a new kind, `diversion`. It
  goes to his personal account, or to his faction leader's account if he
  owes that man more loyalty than his own gain is worth to him (a family or
  obligation relation above a threshold).
- Transactions are the audit trail. Nothing is hidden except from the
  player's view (the display is out of scope here).

**Honesty spread:**
- `deriveDefaultMind` sets `honesty = 50 − (intrigue−50)/4`
  (`characters/mind.ts:107`), which only spans about 37 to 62.
- It gets the same stable ±15 hash spread as `spreadSubSkills`. Hand-written
  historical values stay as written.

**Signs of graft:**
- When a lever's actual take falls more than 10% below what its skill
  predicts, the shortfall is recorded as a world fact.
- Briefings and letters carry it as rumour. The engine never names the thief
  outright.

**Audit:**
- An audit is a mission, ordered like any other. It is run by the `audit`
  holder or a named man, over a named department or household, for 30–90
  days.
- Odds = the auditor's (taxation + espionage)/2 against the suspect's
  (intrigue + manipulation)/2, plus the head bonus of the `audit` lever's
  department. Distance lowers them.
- **Found:** the diversion transactions become evidence, a fact naming the
  sum and the man.
- **Cleared:** records nothing. A cleared honest man gains a little trust;
  a cleared thief grows bolder.

**Prosecution:**
- Evidence lets a charge be brought through the constitution's `judgment`
  power:
  - Rome: a tribune before the people;
  - Carthage: the Hundred and Four;
  - a monarchy: the king's word.
- A conviction can mean repayment, a fine, exile or removal from office.
  The `courts` holder shapes how fair the trial is.
- Rivals can use evidence as a weapon, and they will.

## 10. Households

A household is a small department system of its own owner:

- **Levers** are `estate:<incomeSourceId>` and `venture:<incomeSourceId>`.
  The owner holds them all, and his household counts as one family of
  workload.
- **The owner appoints a steward** (the Roman *vilicus*, often a slave or a
  freedman), a venture agent (the *institor*) and under-stewards on distant
  estates. These are household offices, created through offices on demand
  with `householdOwnerId` set.
- **Pay** is from the owner's account. A slave steward costs his keep and
  counts as `salaried`. An honorary friend managing as a favour counts as
  `honorary`.
- **The same rules apply:** averaging, a vacant seat running badly
  (`VACANT_SKILL`), forming, the head bonus for a chief steward over
  under-stewards, workload, corruption and distance, audits, and deputies
  learning.
- **Inheritance:** when the owner dies, the household's departments pass to
  his heir with their experience intact.
- `handling` in `tick.ts` reads `leverSkill(world, household, "estate:…")`
  instead of the owner's stewardship.

## 11. Seeds

**Rome and Carthage** get departments in the next scenario version. The
model names them in a hand-played pass while the version is built
(`CHRONICA_AI_MODE=hand`), and they are stored in the scenario.

**What the pass is given:** the historical government.

- **Rome's offices:** the consuls (war, levy), quaestors (treasury, under
  the Senate's gate), censors (the census, audit, public contracts), aediles
  (grain, works, markets), the urban praetor (courts), the pontiffs and
  augurs (rites).
- **Carthage:**
  - the suffetes;
  - the generals, whose trial is judged by the Hundred and Four;
  - the commissions of five (the pentarchies);
  - the treasury and its chief accountant;
  - the priesthoods.

  Names and levers are left to the pass, except that each department it
  makes must be one the sources support.

**Every other power** starts with the ruler holding every lever. Its
departments come from play.

**Staffing:** seated officers become the officers of their department.
Rome's collegial offices (two consuls, the quaestors' college) average their
named members only. The implied rest of a college carries no weight.

## 12. Skills that decline

Two new fields go on `CharacterSkills`:
- `peaks`: the best each finer skill has been;
- `lastUsedAtStep`: per finer skill, the last time it was read. That covers
  any mission or lever reading the skill, and each month a man holds a
  lever that reads it.

The yearly life review (`reviewLives`) applies:

- **Disuse.** A finer skill above 60, unused for a year, loses 1 point a
  year, down to 60. Old skill stays; the edge goes.
- **Age.**
  - From 55, prowess and endurance lose 2 a year, and logistics 1.
  - From 65, every other finer skill loses 1 a year.
  - Theology, scholarship, rites and arbitration never decline with age.
    Old priests and judges stay sharp.
- **Illness.** A serious ailment, once passed, takes 1–3 points of
  endurance for good.
- **Floor.** Nothing falls below half its recorded peak.
- **Parent skills** (martial, stewardship…) are not decayed directly. A
  finer skill missing from `subSkills` is written out by `spreadSubSkills`
  the first time it is decayed, so the decline has a number to act on.

Briefings name a notable decline ("age has slowed him") and a peak well
above today's value ("once the finest speaker in Rome").

## 13. NPC peace

`peace_offer` letters and `concludePeace` exist (`world/diplomacy.ts`,
`sim/peace.ts`), and so does a dated `truce` agreement
(`world/agreements.ts`). But an NPC war ends only when the model happens to
think of it. Peace becomes pressure-driven, in the engine.

**War weariness:** per power, per war, recomputed monthly, 0 to 100, from
these parts:

| Part | Weight |
|---|---|
| Men lost / men under arms at the war's start | up to 30 |
| Its provinces held by the enemy | up to 20 |
| Treasury in debt, and months of it | up to 15 |
| Battles lost in the last year, net of won | up to 15 |
| Months at war past twelve | up to 10 |
| Unrest and grain shortfall at home | up to 10 |

It is stored in `world.warWeariness`.

**A truce first:**
- Past weariness 40, the power's `peace_talks` holder (or ruler) gets a plan
  step: seek a truce of 3–12 months, to bury the dead or for the winter.
- It is sent as a letter of the existing kind, with terms of a truce
  agreement. It is gated by `make_peace` where the constitution has one.

**Then peace:**
- Past 60, or when a truce ends with weariness still above 40, the step
  becomes a peace offer.
- **Terms follow the war.** A power losing badly offers land or tribute; a
  stalemate offers the status quo. The existing arbitration bargaining in
  `peace.ts` improves the terms, and the `peace_talks` head bonus adds to
  it.

**The other side answers the same way.** Its own weariness, war aims and
ambitions decide whether it accepts, counter-offers or fights on. If the
offer is to the player's power, it lands in the letters awaiting their
answer, as a peace offer does now.

**After a refusal:**
- The offering side's weariness keeps rising, and its next offer is more
  generous.
- The refusing side gains confidence (a legitimacy cause), and a
  reputation for arrogance with the offering side (a relation cause on its
  ruler).

**The peace party at home:**
- Past weariness 50, a `peace` organic group forms in the power's chambers,
  as the organic groups in `docs/plans/constitutions.md` do. It carries the
  interests of commons, merchants and landed, leaning on `peace`, and
  dissolves below 30.
- Where a chamber holds the `make_peace` gate or the `war` power, the group
  can put a question for talks. If it carries, the ruler must send an
  offer, even against his will. That is the Senate against the consul. A
  ruler who ignores a carried question pays in legitimacy, as with the
  advisory councils now.

**Mediators** are left out.

## 14. The model's side

**The orchestrator prompt:** each item folds into an existing principle,
not a new section.
- "What a power does is done by whoever holds that duty." This joins the
  principle on offices and reach.
- The department order's shape joins the principle on offices on demand.
- The truce-first rule and the three-step fallback live in the engine and
  its validators, not in the prompt.

**The NPC cognition briefing gains:**
- the NPC's own duties;
- his workload in words;
- his department's standing in words ("the treasury you run is short");
- rumours of graft he has heard.

**One new call shape for creating a department,** validated like
`write_mechanic`:
- name;
- levers, from the enum;
- offices, existing or new;
- head;
- deputies;
- pay;
- optionally a rule or a standing project.

## 15. Build order

1. **Levers and `leverSkill`:** the lever table, families, workload, vacancy
   and averaging. `collectorOf` and `taughtBy` are deleted, and every
   reading site in §1 moves to `leverSkill`. At first every power's ruler
   holds everything. Tests: a king with no ministers, a king stretched thin,
   a vacant seat, two quaestors averaged.
2. **Departments as data:** `world.departments`, constitution integration,
   forming, abolition, experience, gates. The department-creation call and
   its three-step fallback.
3. **Missions and the head bonus** across plots, peace, delegation, supply
   and levy.
4. **Seeds:** the hand-played naming pass for Rome and Carthage, and a new
   scenario version.
5. **Households:** stewards, agents, under-stewards, `handling` rewired.
6. **Corruption:** the honesty spread, diversion transactions, shortfall
   facts, audits, prosecution, `judge_commander`.
7. **People:** patronage, rivalry, insubordination, deputies learning,
   grumbling ambitions, briefings.
8. **Skill decline:** peaks, `lastUsedAtStep`, decay in `reviewLives`.
9. **Peace:** weariness, truce-first plan steps, the peace organic group,
   refusals.
10. **Prompt and cognition changes,** measured against the 63 000 limit.
11. **A hand-played run** of a Messana opening, 24 months, checking:
    - Rome's treasury moves with its quaestors;
    - Hieron appoints someone once stretched;
    - a watch set up after a plot catches the next one;
    - a skimming aedile is found by a censor's audit;
    - an NPC war ends by truce and then peace.

    `--live` is used only with a go-ahead.

Each step is tested on its own before the next. Steps 1–3 change no
numbers for a scenario whose rulers hold everything, except for workload.
The workload effect gets its own tests.

## Open

- `VACANT_SKILL` at 25 and the workload constants are first guesses, to be
  tuned in the hand-played run.
- The pay rates and floors in §7b.
