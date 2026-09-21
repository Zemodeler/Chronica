# AI-Native Grand Strategy Engine --- Design Document

## 1. Vision

The goal is an AI-native historical/grand-strategy simulation inspired
by the freedom of games such as Pax Historia, but with substantially
deeper persistent systems: money, monthly income and expenditure,
armies, politics, diplomacy, administration, NPC agency, intrigue,
information, projects, and long-term consequences.

The central design principle is:

> **The AI is the powerhead of the simulation. Software is responsible
> for memory, arithmetic, consistency, scheduling, and persistence.**

The game should not be a conventional deterministic grand-strategy
ruleset with an LLM attached as an event generator. The AI should have
genuine authority over causality: it interprets intentions, decides how
actions are carried out, creates plausible consequences, lets NPCs
strategize, and can dynamically create mechanics or entities when the
evolving world requires them.

At the same time, the AI must not be trusted to remember or recalculate
the entire world on every interaction. Structured state and conventional
code preserve continuity.

A concise formulation:

> **A persistent grand-strategy world in which the LLM is sovereign over
> causality, while software is sovereign over memory, arithmetic,
> scheduling, and consistency.**

------------------------------------------------------------------------

## 2. Core Player Experience

The player should interact with the world through extremely simple
natural-language orders.

Examples:

-   `Raise two new legions.`
-   `Repair the Via Appia.`
-   `Send an embassy to Syracuse.`
-   `Defend Sicily.`
-   `Raise two legions, but do not borrow money.`
-   `Raise two legions from Campania, funded through an extraordinary levy on senatorial estates, and have them assemble at Rhegium.`

The player specifies **intent**, not implementation details.

The engine determines the bureaucracy and execution that would naturally
sit underneath the order.

For example:

> **Player:** Raise two new legions.

The AI may determine that recruitment should occur in Latium and
Campania, treasury reserves should be used first, short-term merchant
credit should cover the remainder, equipment contracts should be issued,
officers need to be appointed, and recruitment will take several months.

The player should not have to manually specify those details unless they
want to.

### Delegation principle

> **The shorter the order, the greater the discretion delegated to
> NPCs.**

Therefore:

`Raise two legions.`

gives administrators broad discretion.

`Raise two legions, but do not borrow money.`

removes financing discretion.

`Raise two legions from Campania, funded entirely by a levy on senatorial estates.`

is a highly interventionist order.

All variants use the same underlying action-resolution system.

------------------------------------------------------------------------

## 3. AI Authority vs. Deterministic Code

The engine should be deliberately hybrid.

### AI owns

The AI determines:

-   interpretation of player intent;
-   plausible implementation;
-   NPC decisions;
-   political reactions;
-   diplomatic reactions;
-   military decisions;
-   economic consequences of changing circumstances;
-   social consequences;
-   project characteristics;
-   newly required entities;
-   newly created institutions;
-   significance of events;
-   whether actors react;
-   what actors know;
-   plausible quantities when they are not already determined by state;
-   emerging mechanics;
-   causal relationships;
-   narrative explanation.

### Software owns

Conventional code guarantees:

-   arithmetic;
-   dates;
-   persistence;
-   event scheduling;
-   transaction application;
-   ownership;
-   unique entity identity;
-   army continuity;
-   treasury continuity;
-   debt continuity;
-   project continuity;
-   treaty continuity;
-   casualty persistence;
-   state invariants;
-   historical records.

Example:

The AI decides:

-   recruitment costs 220 talents immediately;
-   it adds 31 talents/month of expenditure;
-   recruitment takes approximately four months.

The engine performs:

``` text
treasury -= 220
monthly_expenditure += 31
schedule(recruitment_milestone)
```

The AI establishes reality. Code makes that reality persist correctly.

------------------------------------------------------------------------

## 4. Scenario Philosophy

Scenarios should be deliberately sparse.

A scenario supplies only the historical anchors necessary to begin
simulation.

### Scenario-provided data

Primarily:

-   starting date;
-   polities;
-   territorial/geopolitical situation;
-   a few important starting NPCs;
-   a few important starting armies/fleets;
-   essential starting diplomatic relationships;
-   enough high-level context for the AI to understand the starting
    world.

The scenario should **not** attempt to pre-author the entire simulation.

It should avoid defining thousands of:

-   minor NPCs;
-   officials;
-   merchants;
-   factions;
-   organizations;
-   estates;
-   settlements unless relevant;
-   trade relationships;
-   modifiers;
-   projects;
-   political blocs;
-   administrative positions.

Those are generated dynamically.

------------------------------------------------------------------------

## 5. Dynamic World Generation

The simulation follows:

> **Generate on demand → persist permanently → allow emergent
> importance.**

Suppose the player orders two legions raised and the simulation needs an
official responsible for financing recruitment. If no suitable NPC
exists, the engine may generate:

``` text
Marcus Fabius Varro
Office: Military Quaestor
Age: 38

Traits:
- Methodical
- Politically cautious
- Financially competent

Generated because:
Responsible for financing the current mobilization.
```

From that moment, Marcus is a real persistent NPC.

He may later:

-   gain promotion;
-   become corrupt;
-   accumulate wealth;
-   develop political allies;
-   become indebted to merchants;
-   oppose another NPC;
-   become praetor;
-   be prosecuted;
-   become important enough for direct player interaction;
-   die.

The same principle applies to:

-   minor nobles;
-   merchants;
-   officers;
-   diplomats;
-   tribal leaders;
-   factions;
-   conspiracies;
-   companies;
-   estates;
-   religious groups;
-   institutions;
-   political movements;
-   administrative offices.

The world therefore becomes more detailed precisely where history causes
detail to matter.

------------------------------------------------------------------------

## 6. Persistent World State

The database is the authoritative memory of the world.

A polity could contain state resembling:

``` text
ROME

Treasury: 1,240 talents
Monthly income: 185
Monthly expenditure: 151
Debt: 420

Political stability: 71/100
Senate support: 63/100
Popular support: 58/100

Military:
- 4 legions
- 18,400 available manpower
- 42 ships

Trade:
- Sicilian grain
- Etruscan metals
- Greek luxury imports

Relations:
- Carthage: hostile
- Syracuse: cautious
- Macedon: neutral

Active developments:
- Southern road construction
- Naval expansion
- Grain shortage in Latium
```

These values inform and constrain the AI, but they should not become a
rigid rules engine that decides every possible action in advance.

------------------------------------------------------------------------

## 7. Economy

The game should have persistent grand-strategy economics without
becoming a spreadsheet simulator.

At minimum, polities can have concepts such as:

``` text
Monthly income
Taxes              92
Trade              44
Tribute            31
State estates      18
----------------------
Total             185

Monthly expenses
Army               81
Navy               27
Administration     19
Debt service       11
Projects           13
----------------------
Total             151

Monthly surplus    +34
```

Once established, ordinary accounting should be deterministic.

If nothing changes:

``` text
treasury += monthly_income - monthly_expenditure
```

There is no reason to invoke an LLM merely to calculate a monthly
surplus.

### AI changes economic structure

The AI becomes involved when circumstances alter the economy.

Examples:

-   new taxation;
-   conquest;
-   blockade;
-   crop failure;
-   corruption;
-   debt crisis;
-   mobilization;
-   trade agreement;
-   infrastructure;
-   monetary reform;
-   political seizure of assets.

For example:

> **Player:** Double taxes on the wealthy.

The AI might determine:

``` json
{
  "treasury_change": -8,
  "monthly_income_change": 21,
  "stability_change": -3,
  "senate_support_change": -9
}
```

It could explain that enforcement is imperfect, implementation costs
money, elite opposition increases, and approximately 21 additional
talents/month are expected.

Once committed, `+21/month` becomes persistent state.

------------------------------------------------------------------------

## 8. Impossible or Overambitious Orders

Actions should rarely resolve as a simple binary `allowed/not allowed`.

Example:

> Build 200 warships within six months.

Rather than:

`ERROR: insufficient resources`

the AI might conclude:

-   the government authorizes the program;
-   existing shipyards cannot meet the deadline;
-   only 74 vessels can initially be commissioned;
-   Greek shipwrights are recruited;
-   timber prices rise;
-   the treasury takes on substantial expenditure;
-   expected completion becomes 11--18 months;
-   Carthage becomes alarmed.

This can become a persistent project:

``` text
PROJECT: Roman Naval Expansion

Requested: 200 ships
Currently commissioned: 74
Completion estimate: 11–18 months

Upfront expenditure: 310
Monthly expenditure: 43

Consequences:
- Timber prices rising
- Greek shipwright immigration
- Carthaginian concern increasing
```

The goal is neither "the game rejects ambitious actions" nor "the AI
allows anything."

The world should attempt to carry out the intent and generate realistic
friction.

------------------------------------------------------------------------

## 9. Dynamically Created Mechanics

The engine should not require every possible grand-strategy mechanic to
exist beforehand.

If the player establishes a new institution, law, organization, or
economic arrangement, the AI can create a persistent mechanic
representing it.

Example:

``` text
LEX AGRARIA
Introduced: 263 BC

Effects:
- Smallholder population gradually increasing
- Elite loyalty reduced
- Recruitment pool expected to improve over several years
- Agricultural productivity uncertain
- Political polarization increasing
```

Or:

``` text
ROMAN PUBLIC CREDIT OFFICE

Capital: 480 talents
State ownership: 60%
Lending capacity: 900
Current loans: 170

Effects:
- Government borrowing becomes easier
- Commercial investment increasing
- Exposure to financial crises increased
```

The game did not need a pre-programmed "State Bank mechanic."

The AI created the institution because history created the institution.

------------------------------------------------------------------------

## 10. NPCs Are Full Strategic Actors

NPCs should have substantially more authority than NPCs in simpler AI
strategy simulations.

The core rule is:

> **Important NPCs and the player operate through the same fundamental
> action language and world-resolution system.**

NPCs can:

-   issue orders;
-   delegate;
-   negotiate;
-   recruit;
-   command armies;
-   spend resources they control;
-   borrow;
-   invest;
-   lobby;
-   plot;
-   deceive;
-   investigate;
-   bribe;
-   form factions;
-   make alliances;
-   correspond secretly;
-   initiate projects;
-   react to other NPCs;
-   react to the player;
-   exceed their legal authority;
-   disobey.

The asymmetry between player and NPC comes from:

-   formal authority;
-   resources;
-   position;
-   information;
-   personality;
-   relationships;
-   political legitimacy;
-   institutional constraints.

Not from separate gameplay rules.

------------------------------------------------------------------------

## 11. NPC Cognition

Important NPCs should possess internal state such as:

-   personality;
-   ambitions;
-   loyalties;
-   fears;
-   relationships;
-   offices;
-   wealth;
-   controlled resources;
-   knowledge;
-   secrets;
-   current plans;
-   plots;
-   political alignment;
-   risk tolerance;
-   memories of important events.

A polity or leader can also maintain strategic intentions.

Example:

``` text
CARTHAGINIAN STRATEGIC OUTLOOK

Primary objective:
Preserve western Mediterranean commercial dominance.

Concerns:
Roman expansion: HIGH
Numidian instability: MEDIUM
Treasury pressure: LOW

Intentions:
- Avoid a major Roman war for now
- Strengthen Sicily
- Expand Iberian revenue
- Seek Numidian guarantees

Risk tolerance:
Moderate
```

These intentions are not permanent scenario data. They evolve as
circumstances change.

------------------------------------------------------------------------

## 12. NPC Authority

NPC actions must be constrained by what the character can plausibly
cause to happen.

Examples:

-   a king can mobilize state armies;
-   a general can maneuver forces under their command;
-   a governor can exercise considerable provincial authority;
-   a wealthy senator can finance political allies;
-   a merchant can manipulate credit and supplies;
-   a spy can conduct covert operations;
-   an ordinary official cannot simply command the entire treasury.

However, authority is **not an absolute prohibition**.

A general may march somewhere without authorization.

That is not an invalid game action.

It may be **insubordination**.

This distinction allows coups, mutinies, unauthorized wars, corruption,
illegal seizures, and political crises to emerge naturally.

------------------------------------------------------------------------

## 13. Delegation as Gameplay

Orders are usually given to people, not directly to game objects.

If a ruler says:

> Defend Sicily.

The responsible general determines:

-   troop concentrations;
-   patrols;
-   supply arrangements;
-   defensive positions;
-   whether to request reinforcement;
-   whether and when to engage;
-   winter quarters.

The player can intervene more specifically if desired.

This makes administrative competence meaningful.

Two officials receiving:

> Find the money for two new legions.

might behave differently.

A competent conservative official could:

-   reorganize spending;
-   secure Senate approval;
-   negotiate manageable credit.

An ambitious corrupt official could:

-   pressure tax contractors;
-   raid politically vulnerable funds;
-   arrange expensive loans from friendly merchants;
-   conceal unfavorable contracts.

Both may accomplish the order while producing completely different
long-term consequences.

------------------------------------------------------------------------

## 14. Objective Reality vs. Knowledge

The simulation should distinguish between:

### Objective World State

What is actually happening.

### Player Knowledge State

What the player and their government currently believe is happening.

### NPC Knowledge States

What individual actors currently know, believe, suspect, or
misunderstand.

Therefore an NPC can secretly:

-   embezzle taxes;
-   cultivate army loyalty;
-   correspond with an enemy;
-   finance a faction;
-   prepare a conspiracy.

The action enters objective state immediately.

It enters the player's knowledge only if information reaches the player.

This creates natural systems for:

-   intelligence;
-   espionage;
-   deception;
-   misinformation;
-   rumors;
-   secrecy;
-   discovery;
-   uncertainty.

Chronicles should report known/observable history, not omniscient hidden
state.

------------------------------------------------------------------------

# 15. No Conventional Simultaneous Turns

The game should **not** use:

``` text
Player orders
→ Rome acts
→ Carthage acts
→ Macedon acts
→ everyone resolves
→ next turn
```

Instead, it should behave as a continuous event-driven simulation.

Example:

``` text
Day 0
Player orders two legions raised.

Day 2
Recruitment is delegated.

Day 4
Treasury officials arrange financing.

Day 9
Merchants notice major equipment contracts.

Day 13
Equipment prices rise.

Day 17
Carthaginian agents report Roman mobilization.

Day 21
Carthaginian leadership considers a response.

Day 24
Carthage secretly reinforces Sicily.

Day 31
Syracuse learns of Roman mobilization.

Day 36
Syracuse dispatches an envoy.
```

There is no "Carthage turn."

Actors act when they have:

-   reason;
-   information;
-   authority;
-   opportunity.

------------------------------------------------------------------------

## 16. Continuous Time Underneath

Internally, events should have real timestamps.

For example:

``` text
264-03-01 Player issues order
264-03-03 Recruitment authorized
264-03-08 Contracts issued
264-03-19 Carthaginian intelligence report
264-03-23 Carthaginian response
264-04-02 Syracuse dispatches envoy
264-04-11 Envoy reaches Rome
```

Several causal chains can exist simultaneously.

The player might issue:

-   raise two legions;
-   repair the Via Appia;
-   send an embassy to Syracuse.

Those processes proceed concurrently and can interact.

The UI presents meaningful decision moments rather than conventional
turns.

------------------------------------------------------------------------

## 17. Event Queue

Every resolved action may create:

-   immediate state changes;
-   information signals;
-   future scheduled events;
-   projects;
-   NPC intentions;
-   new entities;
-   reactions.

The event queue is critical for performance.

If recruitment will take four months, the simulation does not need to
reason through all four months immediately.

Instead it establishes the process and schedules milestones.

Example:

``` text
Recruitment begins
→ financing committed
→ equipment contracts created
→ first recruitment milestone scheduled
→ expected completion window scheduled
```

The process wakes when:

-   its scheduled time arrives;
-   another event interferes;
-   circumstances change;
-   a relevant actor intervenes.

------------------------------------------------------------------------

## 18. Signals and the Attention Router

The engine must not call the LLM for every NPC after every event.

Events generate **signals**.

Example:

``` text
EVENT
Rome begins major military recruitment.

Domains:
- Military
- Finance
- Diplomacy

Location:
Central Italy

Visibility:
Moderate

Potential observers:
- Roman political elite
- Roman military establishment
- Carthaginian intelligence
- Nearby Italian communities
- Syracuse
```

The Attention Router determines who plausibly:

1.  could know;
2.  would care;
3.  has enough agency to respond;
4.  needs actual AI cognition.

Example:

``` text
18,421 NPCs exist
        ↓
137 potentially affected
        ↓
31 could plausibly know
        ↓
7 might reasonably react
        ↓
3 require AI cognition
```

This is one of the primary performance mechanisms.

------------------------------------------------------------------------

## 19. NPC Activity Levels

Most NPCs should not be actively reasoning most of the time.

Conceptual states:

### Dormant

Exists persistently but requires no active reasoning.

### Relevant

Connected to current events but does not need an independent decision.

### Active

Has goals, actions, or current involvement.

### Focused

A major actor currently requiring detailed strategic cognition.

A minor aristocrat might remain dormant for decades.

If war reaches their region:

``` text
Dormant → Relevant → Active
```

They might collaborate with the invader, become an intermediary, gain
office, and eventually become a major NPC.

Importance is therefore emergent.

------------------------------------------------------------------------

## 20. NPC-to-NPC Causality

NPCs should react not only to the player but also to each other.

Example causal chain:

``` text
Player:
Raise two legions.
    ↓
Finance official:
Borrows heavily from merchants.
    ↓
Merchant:
Demands political concessions.
    ↓
Senator:
Discovers relationship and begins investigation.
    ↓
Finance official:
Attempts to conceal contracts.
    ↓
Other official:
Becomes suspicious.
```

Meanwhile:

``` text
Roman recruitment
    ↓
Carthage learns of mobilization
    ↓
Carthage reinforces Sicily
    ↓
Syracuse sees both sides mobilizing
    ↓
Syracuse secretly approaches Rome
```

The player only issued one short order, but the world generated
political, economic, military, and diplomatic consequences.

That emergent causality is a core goal.

------------------------------------------------------------------------

## 21. Preventing Infinite Reaction Chains

An event-driven agentic world can produce infinite chains:

``` text
A → B → C → D → E → F → ...
```

Therefore each simulation burst needs a **causal horizon**.

Continue processing while developments are sufficiently:

-   relevant;
-   temporally plausible;
-   causally connected;
-   significant.

Eventually, unresolved situations can become stable pending state:

``` text
Rome recruiting
Carthage observing
Syracuse considering diplomacy
Senate dispute unresolved
```

Those do not require immediate resolution.

They can be placed into future state/events.

The current simulation burst stops.

This controls:

-   latency;
-   token usage;
-   cost;
-   runaway agent behavior.

------------------------------------------------------------------------

# 22. Historical Pressure

There should be no requirement that a turn ends after a fixed period.

Instead, the engine maintains an internal concept of **Historical
Pressure** or accumulated significance.

Meaningful developments increase pressure.

Examples:

-   trivial administrative transaction → negligible;
-   political maneuver → small;
-   foreign mobilization → substantial;
-   major battle → very large;
-   monarch death → potentially immediate checkpoint.

The AI should assess significance contextually rather than relying
entirely on hardcoded points.

Conceptually:

``` text
Player order
    ↓
NPC actions
    ↓
Consequences
    ↓
NPC reactions
    ↓
World events
    ↓
Historical significance accumulates
    ↓
Threshold reached
    ↓
Checkpoint / Chronicle
```

Hard safeguards may still enforce sensible minimum/maximum simulation
horizons.

> **Provision (2026-09-18, from play).** Accumulated significance no longer
> *ends* a burst. Measuring it that way conflated two different questions --
> "has enough happened to be worth telling?" and "does this need the player?"
> -- and answering both with one threshold made every piece of news an
> interruption. A campaign that should have been one order took six, and four
> of those orders asked the player nothing. Worse, the player's own order was
> weighed on the same scale, so any forceful order crossed the threshold on
> the day it was given and the world never moved at all; the only way to
> advance the calendar was to order something unimportant.
>
> Significance is still assessed by the actors, still accumulated by code, and
> still decides whether there is a Chronicle to write and which threads of it
> matter most. What it no longer does is hand back control. A burst ends when
> it needs the player, when a reaction cannot be paid for, when the calendar
> holds nothing more to wake for, or at the maximum span. **What is merely
> interesting earns an entry in the Chronicle; only what is actionable earns
> the player's attention.**

------------------------------------------------------------------------

## 23. Three Simulation Outcomes

A simulation burst should end in one of three ways.

### A. Continue silently

Nothing requires player involvement and insufficient meaningful history
has accumulated.

The world continues processing.

### B. Chronicle checkpoint

Enough meaningful history has accumulated to justify returning strategic
control.

The player receives:

-   what happened;
-   what they plausibly know;
-   important state changes;
-   relevant strategic context.

The player can issue new orders.

### C. Immediate player interruption

A development requires sovereign/player judgment before the simulation
can reasonably continue.

Examples:

-   peace offer;
-   major diplomatic ultimatum;
-   request to abandon a critical theater;
-   succession choice;
-   extraordinary constitutional decision;
-   other major strategic forks.

This is different from an ordinary Chronicle.

> **Provision (2026-09-18).** Outcome B is no longer reached by crossing a
> significance threshold -- see the provision under §22. A burst that ends for
> any reason other than a player decision produces a Chronicle of whatever
> happened on the way, and that Chronicle is now **several entries, one per
> thread of events**, rather than one passage covering a span. A span that held
> a war and an embassy is two entries with two titles, not one paragraph break.
>
> An order that is not finished when it is given may also name what would
> finish it -- a **watch condition** -- and the burst runs until that holds
> rather than stopping at the first quiet moment. "Wake me when the army
> reaches Boii country" is a sentence the engine can act on.

------------------------------------------------------------------------

## 24. Player Interruptions Should Be Rare

The simulation should not ask the player to decide mundane
administrative matters.

### Usually autonomous

-   which merchant provides routine credit;
-   precise equipment contracts;
-   routine troop logistics;
-   minor appointments;
-   where a general establishes camp;
-   ordinary administrative execution.

### Likely player decisions

-   accept/reject peace;
-   declare war;
-   major treaty terms;
-   abandon an important region;
-   constitutional transformation;
-   strategically decisive redirection;
-   decisions that specifically require the player's formal authority.

The player should feel like a ruler/decision-maker, not a clerk.

------------------------------------------------------------------------

## 25. Chronicles

Chronicles are historical reconstructions of what has occurred since the
previous checkpoint.

Example:

### March--April 264 BC

> Following the decision to expand the army, recruitment began
> throughout Latium and Campania. Two additional legions were ordered
> formed, financed through treasury reserves and short-term credit
> provided by prominent Roman merchants.
>
> News of the mobilization reached Sicily within weeks. Carthaginian
> authorities responded by quietly strengthening their forces in the
> west of the island, while Syracuse dispatched envoys to determine
> Rome's intentions.
>
> At Rome, the scale of military borrowing produced growing disagreement
> within the Senate, with several families questioning the terms granted
> to the city's creditors.

Chronicles must respect information boundaries.

They should **not** reveal hidden facts merely because the simulation
knows them.

For example, if a senator is secretly plotting against the player and
the plot remains undiscovered, the Chronicle should not expose it.

------------------------------------------------------------------------

# 26. Proposed Simulation Architecture

High-level architecture:

``` text
                  PLAYER
                     │
                     ▼
              INTENT INTERPRETER
                     │
                     ▼
              WORLD ORCHESTRATOR
              ╱      │       ╲
             ╱       │        ╲
        ECONOMY    ACTORS     EVENTS
                     │
                     ▼
               ATTENTION ROUTER
                     │
           ┌─────────┼─────────┐
           ▼         ▼         ▼
        NPC A      NPC B      NPC C
           │         │         │
           └─────────┼─────────┘
                     ▼
               CONSEQUENCES
                     │
              ┌──────┴──────┐
              ▼             ▼
         FUTURE QUEUE    NEW EVENTS
              │             │
              └──────┬──────┘
                     ▼
          PRESSURE / PAUSE LOGIC
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
    CONTINUE      CHRONICLE    DECISION
                                  │
                                  ▼
                               PLAYER
```

------------------------------------------------------------------------

## 27. World Orchestrator

The World Orchestrator is the central coordinator.

It should receive a compressed relevant world slice including:

``` text
CURRENT DATE
PLAYER ORDER
RELEVANT WORLD STATE
RECENT HISTORY
ACTIVE WARS
ACTIVE PROJECTS
DIPLOMATIC COMMITMENTS
ECONOMIC STATE
POLITICAL STATE
MILITARY STATE
RELEVANT NPC INTENTIONS
UNRESOLVED EVENTS
PENDING FUTURE EVENTS
```

Its job is not to personally roleplay every NPC.

Its job is to determine:

-   what the player meant;
-   which systems are affected;
-   what routine execution can be resolved immediately;
-   which entities must be generated;
-   which actors receive information;
-   which actors might react;
-   which decisions require deeper NPC cognition;
-   what state changes are proposed;
-   what future events should be scheduled;
-   whether simulation should continue or return to the player.

------------------------------------------------------------------------

## 28. Important NPC Cognition Calls

The engine should avoid one LLM call per NPC.

Routine actions can be resolved through the Orchestrator or batched
cognition.

Dedicated NPC cognition is reserved for situations where an important
actor faces a genuinely strategic choice.

Examples:

-   a major general deciding how to respond to an invasion;
-   a king deciding whether to enter a war;
-   a leading senator planning opposition;
-   an ambitious governor deciding whether to disobey;
-   Carthaginian leadership deciding how to answer Roman mobilization.

The NPC reasoning pass should receive **that actor's knowledge**, not
omniscient world state.

This prevents the system from becoming one omniscient AI pretending to
be everyone.

------------------------------------------------------------------------

## 29. Performance Target

A normal player interaction should ideally require approximately **2--4
major model calls**, not dozens.

A possible normal flow:

1.  intent interpretation + orchestration;
2.  batched important NPC cognition;
3.  consequence/state validation;
4.  Chronicle or player-facing output if required.

> **Provision (2026-09-18).** The working ceiling is **six**: orchestration,
> up to four rounds of batched cognition, and the Chronicle. A quiet order
> still costs three or four. The extra rounds are not spent on the player's
> own business -- they are what the rest of the world costs. A burst's later
> rounds happen after the calendar has jumped, which is the only point at
> which a foreign king has anything to do worth recording; asked two days
> after the order, he correctly answers that nothing has changed yet.
>
> The people elsewhere ride along in the cognition call the reactors were
> already making, so a living world is paid for in prompt tokens rather than
> in calls. Raising the number of them costs almost nothing; raising the
> number of rounds is what costs money.
>
> **Amendment (2026-09-21).** A call is no longer a good unit for any of this.
> A round's cast is dealt onto two calls issued at once, so a round is two
> calls and the same tokens, and the ceiling is twelve where it was six --
> which buys nothing new and costs nothing new. The measure that was always
> meant here is rounds, and that is still four.
>
> The reason for the change is that a call count says nothing about how long a
> player waits. Measured against the record the engine already keeps, a burst
> in September ran from seventeen seconds to eleven minutes on the same number
> of calls. What the player waits for is one cast's answers generated end to
> end, so the fix was to stop generating them end to end.

Exceptionally consequential situations may justify additional calls:

-   major battles;
-   coups;
-   civil wars;
-   succession crises;
-   major peace conferences;
-   large constitutional transformations.

Performance should primarily come from:

-   sparse scenario initialization;
-   dynamic generation;
-   dormant NPCs;
-   attention routing;
-   batched cognition;
-   future scheduling;
-   causal horizons;
-   deterministic accounting.

------------------------------------------------------------------------

# 30. Example End-to-End Interaction

Player:

> **Raise two new legions.**

### Step 1 --- Intent

The engine interprets:

``` text
INTENT
Increase Roman field strength by approximately two legions.
```

### Step 2 --- Authority

``` text
AUTHORITY
Valid under the player's current executive position.
```

### Step 3 --- Delegation

``` text
Recruitment → military administration
Financing → treasury officials
Equipment → quartermasters / contractors
Officer appointments → political and military leadership
```

### Step 4 --- Constraints

``` text
Treasury: strained
Manpower: adequate
War urgency: high
Political support: sufficient
```

### Step 5 --- Routine execution

The AI determines:

-   treasury reserves cover part of the cost;
-   merchant credit covers the remainder;
-   recruitment begins in Latium and Campania;
-   equipment contracts are issued;
-   appropriate minor officials are generated if necessary;
-   military expenditure rises.

### Step 6 --- State commit

The software applies:

-   treasury changes;
-   debt changes;
-   monthly expenditure changes;
-   new recruitment projects;
-   new NPCs/entities;
-   future milestones.

### Step 7 --- Signals

A signal is created:

``` text
Major Roman military mobilization
Visibility: moderate
Domains: military, finance, diplomacy
```

### Step 8 --- Attention routing

Possible outcome:

``` text
Carthage → high relevance
Roman Senate → high relevance
Syracuse → medium relevance
Macedon → low relevance, ignored
```

### Step 9 --- NPC cognition

Relevant actors react.

Possible outcomes:

-   Carthage secretly reinforces Sicily;
-   a Roman senator begins opposing the borrowing;
-   Syracuse becomes concerned.

### Step 10 --- Future events

The engine schedules:

-   recruitment milestones;
-   debt payments;
-   Carthaginian reinforcement progress;
-   possible political developments;
-   information arrival.

### Step 11 --- Continue or stop

If no player decision is required and historical pressure is low:

**continue silently.**

If enough important developments accumulate:

**Chronicle checkpoint.**

If Syracuse arrives with a treaty proposal requiring sovereign approval:

**immediate player interruption.**

------------------------------------------------------------------------

# 31. Emergent Example

One simple order could eventually create:

``` text
PLAYER
"Raise two legions."
        │
        ▼
Government needs financing
        │
        ▼
Finance official borrows from merchants
        │
        ├───────────────┐
        ▼               ▼
Merchant gains       Large military
political leverage   contracts appear
        │               │
        ▼               ▼
Senator becomes      Foreign intelligence
suspicious           notices mobilization
        │               │
        ▼               ▼
Investigation        Carthage responds
        │               │
        ▼               ▼
Finance official     Sicily reinforced
conceals contracts      │
                        ▼
                   Syracuse becomes
                      alarmed
                        │
                        ▼
                  Diplomatic approach
```

This is the desired behavior:

> **Small player intentions can produce large, coherent histories
> through autonomous actors and persistent causality.**

------------------------------------------------------------------------

# 32. Design Principles to Preserve

As development progresses, the following principles should be treated as
architectural constraints.

### AI-first causality

Do not reduce the AI to flavor text over a conventional rules engine.

### Persistent reality

Once the AI creates a meaningful consequence, it becomes durable world
state.

### Natural-language intent

Do not require the player to micromanage implementation.

### Delegation

NPC competence, personality, authority, and corruption should affect how
broad orders are executed.

### Symmetric agency

Important NPCs should be capable of fundamentally the same categories of
action as the player.

### Sparse beginnings

Scenarios define anchors, not the entire world.

### Dynamic detail

Generate world detail only when history requires it.

### Emergent importance

Minor generated entities can become major historical actors.

### Continuous causality

NPCs react to the player and to each other rather than waiting for
artificial turns.

### Information boundaries

Actors reason from what they know, not omniscient state.

### Rare interruptions

Only meaningful player-level decisions should halt simulation.

### AI judgment + deterministic bookkeeping

Use AI where judgment is valuable and code where exactness is valuable.

### Fast simulation

Do not wake every NPC or invoke the LLM for every monthly calculation.

### A world that moves on its own

Attention routing answers "who reacts to this?" It must not also be the only
way anyone acts, or the world outside the player's business is dormant by
construction: a country with nobody attending to it never negotiates, never
presses a siege, never does anything a Chronicle could report. A share of every
burst belongs to people pursuing their own standing business, chosen without
reference to what the player just did.

**Provision (2026-09-18).** The world does not only fill in where the player
looks; it also makes trouble where nobody is looking. A deterministic narrator
reads the ruler's comfort — treasury, arrears, legitimacy, order, the war — and,
on a cadence replayable from the game's own clock, hands the orchestrator one
seed: a problem for a person, a thing that befalls the world, or a new actor.
Code chooses where, what kind, how severe and whether it is secret; the model,
in the call it was already making, decides what it actually is. Comfortable
reigns get more and worse; a collapsing one is left to collapse. A seed may land
in the ruler's own realm, and a secret one is known only to its plotters until
discovery, betrayal or the strike. What can grow becomes a tracked thread with
phases, and the Chronicle is silent about it until it is known.

### Historical continuity

The world should remember consequences, relationships, promises, debts,
casualties, institutions, projects, and previous decisions.

------------------------------------------------------------------------

# 33. Recommended Next Development Step

Before building detailed economy, combat, diplomacy, or intrigue
systems, define the **Simulation Loop v1** precisely.

The next specification should describe what happens from:

``` text
PLAYER PRESSES "SEND ORDER"
```

through:

``` text
INTENT INTERPRETATION
→ RELEVANT STATE RETRIEVAL
→ ORCHESTRATION
→ DELEGATION
→ ROUTINE EXECUTION
→ NPC ATTENTION
→ NPC COGNITION
→ CONSEQUENCE GENERATION
→ STATE TRANSACTION
→ EVENT SCHEDULING
→ CAUSAL PROPAGATION
→ PRESSURE EVALUATION
```

until one of:

``` text
CONTINUE SIMULATION
CHRONICLE CHECKPOINT
PLAYER DECISION REQUIRED
```

Once this loop is stable, the major game systems---economy, military
operations, diplomacy, politics, intrigue, intelligence, administration,
projects, and dynamic world generation---can all plug into the same
architecture rather than developing separate incompatible resolution
systems.
