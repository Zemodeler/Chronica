# AI world-matters runtime

**Status: substantially implemented; broader-domain expansion remains.**

## Completion status

The shared world-matter runtime is now in place and exercised by the current
test suite. The roadmap is substantially complete through Phase 6; Phase 7 is
started, rather than complete.

| Roadmap phase | Status | Implemented scope |
| --- | --- | --- |
| 1. Identity and persistence | Complete | Canonical `WorldMatter` schema, migration from developments, stable identities, idempotent detection, lifecycle state, and replay coverage. |
| 2. NPC routing | Complete | Live recipient resolution, bounded priority selection, NPC/star-context projections, offer recording, intent links, and player intervention routing. |
| 3. Disposition and standing plans | Complete | State-backed dispositions, fact links, partial resolution handling, standing-plan continuations, and invalidation checks. |
| 4. Fiscal foundation | Complete | Polity treasury bootstrap, income and obligation detectors, provenance-aware collection/payment/transfer workflows, and actor-scoped financial reads. |
| 5. Institutions and supply | Complete | Term and supply detectors, procedure safeguards, lightweight supply state, and supply-management workflows. |
| 6. Chronological integration | Complete | Matter-review events in the persistent queue, chronological offers, fact-scoped reactions, and intervention handling. |
| 7. Broader domains | In progress | Diplomatic messages, household needs, provincial scarcity/reconstruction/civic work, and war burdens have producers. Treaty, commitment, legal, health, and environmental domains still need their own complete state, reads, response workflows, completion rules, and end-to-end Chronicle tests. |

Verification on the current working tree: `packages/shared` (1,019 tests),
`apps/web` (158 tests), and `packages/db` (35 tests) all pass -- 1,212 tests
total. Both `packages/shared` and `apps/web` typecheck cleanly via
`tsc --noEmit --rootDir .` (invoking `tsc` without `--rootDir .` hits a
pre-existing, unrelated `TS2209` "ambiguous project root" error from this
repo's package `exports` maps, reproducible on the unmodified base commit via
`git stash` -- environmental, not a regression from this work).

[Back to world cycles](../README.md)

Time should make responsibilities, needs, opportunities, and disputes impossible for the simulation to forget. It should not decide their outcomes. The existing AI character simulation remains the source of judgment: NPCs decide what they want, the shared interpreter turns their intentions into actions, validated workflows change canonical state, and the Chronicle reports the facts those workflows produced.

This document defines the supporting runtime that connects scheduled world concerns to that existing path. Its core unit is a **world matter**: a durable, inspectable statement that something in the world now deserves attention. A matter is offered to characters who possess the authority, responsibility, interest, knowledge, or opportunity to address it. It persists until the world actually answers it.

The intended causal chain is:

```text
world state and calendar
        |
        v
detect or refresh a world matter
        |
        v
select responsible and interested NPCs
        |
        v
NPC judgment and declared intent
        |
        v
shared interpretation and validated workflows
        |
        v
canonical mutations and factual events
        |
        +----> fresh-context NPC and star-context reactions
        |
        v
Chronicle selection and narration
```

In short:

> Cycles create matters. Matters select actors. Actors create intents. Workflows create facts. Facts create the Chronicle.

## The boundary

The runtime owns memory, timing, routing, validation, and continuity. The AI owns judgment.

The runtime may determine:

- that an office term is approaching or has passed its recorded end;
- that an income source is ready for its next assessment;
- that army pay, tribute, a pension, a loan, or another obligation is due;
- that a force has gone longer than expected without a recorded supply action;
- which accounts, offices, forces, provinces, procedures, commitments, and characters the matter concerns;
- which living characters hold relevant authority or responsibility;
- when a matter was last offered, deferred, escalated, or answered;
- whether a proposed workflow is lawful and whether its claimed resources exist;
- what concrete state changes an accepted workflow made.

The runtime must not determine:

- how much a province yielded merely because a formula produced a number;
- whether an NPC chooses to collect a tax, pay an army, stand for office, break a promise, or ignore a crisis;
- who wins an election as an automatic consequence of a deadline;
- whether a delayed convoy arrived, was stolen, or never departed;
- what an office-holder, commander, creditor, debtor, candidate, or rival thinks the situation means;
- narrative consequences unsupported by an executed workflow or factual event.

Some deterministic mechanisms remain necessary. Account arithmetic, authority checks, identities, dates, event ordering, deduplication, reservation conflicts, and atomic persistence cannot be matters of interpretation. These mechanisms keep AI decisions coherent; they do not replace those decisions.

## Design goals

The system should accomplish all of the following:

1. **Make durable things real.** Polities have actual treasuries, forces have persistent pay and supply state, offices have real terms, and obligations survive beyond one prompt.
2. **Make time visible to the AI.** A due matter enters the relevant actor's context even if nobody mentioned it in the player's latest directive.
3. **Route judgment to characters first.** A fiscal, military, political, or social matter goes to plausible NPCs before any general world-level fallback is considered.
4. **Preserve character agency.** An NPC may address, exploit, delegate, postpone, contest, refuse, or ignore a matter according to its own goals and circumstances.
5. **Use the unified action path.** NPCs declare intents; they do not receive a special scheduler mutation path. The shared interpreter and workflow validation remain authoritative.
6. **Remember unfinished business.** A matter not resolved in one resolution window remains open and is reconsidered later. Silence never means completion.
7. **Support standing decisions.** Routine administration may continue from an AI-authored persistent plan without requiring the AI to repeat an unchanged judgment every period.
8. **React to change.** Material changes invalidate or interrupt stale assumptions and return a standing matter to AI attention.
9. **Keep the Chronicle factual.** A reminder is not history. Only actual actions, refusals, outcomes, and material consequences may become Chronicle entries.
10. **Avoid Chronicle noise.** Routine bookkeeping remains inspectable without displacing battles, political changes, crises, and player-relevant developments.
11. **Scale across domains.** The same attention and routing mechanism should support finance, institutions, logistics, diplomacy, households, law, health, and other time-sensitive concerns.
12. **Remain replay-safe.** Re-running a detector or event at the same instant must not duplicate a matter, payment, collection, pressure, procedure, or Chronicle fact.

## Non-goals

This is not a complete formula-driven economy, a daily resource simulation, an automatic story generator, or a second Game Master.

It does not require:

- modelling every taxpayer, merchant, field, ration, coin, or cart;
- calculating one objectively correct revenue or supply outcome;
- giving every open matter an AI call at every step;
- forcing an NPC to act because the scheduler selected them;
- publishing every ledger entry in the Chronicle;
- resolving a political procedure merely because its deadline arrived;
- using random tables as a substitute for character judgment;
- routing ordinary character decisions directly to a central manager.

## The canonical world matter

`WorldDevelopment` currently proves the basic pattern: it stores a scheduled cause, creates or refreshes character pressure, and supports reserved actor selection. It is currently too narrow for the full job because it owns one `actorId`, has only five kinds, and cannot record authority requirements, multiple stakeholders, attempts, deferrals, standing plans, or resolution evidence.

The next model should generalize that pattern rather than create an unrelated scheduler for each domain. A representative shape is:

```ts
interface WorldMatter {
  id: string;
  kind: WorldMatterKind;
  sourceRef: EntityRef;

  status: "upcoming" | "due" | "overdue" | "addressed" | "cancelled";
  visibility: "public" | "polity" | "private";
  summary: string;
  urgency: number;

  createdAt: WorldInstant;
  dueAt: WorldInstant | null;
  nextReviewAt: WorldInstant;
  lastReviewedAt: WorldInstant | null;

  requiredAuthority: AuthorityRequirement[];
  responsibleScopeRefs: EntityRef[];
  stakeholderRefs: EntityRef[];
  relevantFactIds: string[];

  standingPlanId: string | null;
  supersedesMatterId: string | null;
  parentMatterId: string | null;

  offers: MatterOffer[];
  dispositions: MatterDisposition[];
  resolutionFactIds: string[];
}
```

The exact schema may differ, but several distinctions are essential.

### The source is not the actor

The source identifies why the matter exists: an income source, money obligation, office seat, force, treaty, commitment, household, province, or scheduled event. Actors may change while the source persists.

An army-pay obligation does not disappear when a quaestor dies. An election does not disappear when the presiding official leaves office. Actor selection must be recomputed from current state whenever the matter is reviewed.

### Responsibility is not interest

A responsible actor has authority or a recognized duty to address the matter. An interested actor may benefit from influencing it without possessing that authority.

For an election, the presiding magistrate may be responsible while the incumbent, candidates, patrons, and rivals are interested. For army pay, a treasury holder may be responsible while the commander and an ambitious rival are interested.

These roles affect selection priority and context wording, but neither guarantees action.

### A matter is not a fact

A matter states that attention is due. It does not state that an event occurred. Creating, refreshing, offering, or escalating a matter must remain internal scheduling and character-context state.

This preserves the existing Chronicle rule in `chronicle-from-facts.ts`: scheduler pressures such as `world_development` are deliberately excluded because a pressure is not evidence that anyone acted.

### A matter is not a plan

A matter records the problem or opportunity. An `ActionPlan` records what an actor intends to do about it. Several characters may create competing plans in response to the same matter, and one plan may address several related matters.

The matter links to plans and resulting facts without absorbing their responsibilities.

## Matter identity and deduplication

Every detector must derive a stable identity from the underlying source and due period. Re-running detection at the same world instant must refresh the same record rather than create another.

Examples:

```text
income-assessment:sicilian-taxation:year-3-autumn
obligation:legio-i-pay:period-12
office-term:roman-consul-seat-a:term-7
supply-review:legio-i:campaign-phase-4
treaty-review:rome-syracuse:clause-tribute:year-5
```

Some concerns are continuous rather than periodic. Scarcity, occupation, an unfilled vacancy, and interrupted trade should use one stable source identity while the underlying condition remains active. They should resolve when the condition ends and may reopen as a new occurrence if it later returns.

Idempotence must exist at three levels:

- the detector does not duplicate the matter;
- the interpreter does not carry the same declared intent twice;
- the workflow does not collect, pay, appoint, or otherwise settle the same due occurrence twice.

## Matter lifecycle

### 1. Detection

Cheap state-backed detectors run at relevant clock instants and after factual changes that can create or remove concerns. They inspect canonical state only. They do not ask an AI what happened.

A detector may create or refresh matters such as:

- an assessment period opening for an income source;
- an obligation reaching its due date;
- a treasury becoming unable to cover near-term recorded obligations;
- a term approaching expiry;
- a seat becoming vacant;
- a force exceeding its expected supply interval;
- a truce, treaty clause, promise, loan, or ransom reaching review;
- food insecurity, war damage, or displacement requiring attention;
- a persistent plan losing authority, resources, or a required premise.

Detection should usually create an `upcoming` matter before it becomes `due`, so actors can plan rather than discover every problem after the deadline.

### 2. Contextualization

The matter receives only grounded context:

- the current source state;
- the entities it directly concerns;
- the latest relevant factual events;
- any current plan already addressing it;
- the authority or responsibility needed to act;
- whether it is new, approaching, due, overdue, disputed, or blocked.

The scheduler must not write a speculative explanation such as "the governor embezzled the missing revenue." It may say that revenue remains uncollected and that the governor held responsibility during the period. Embezzlement becomes history only if discovered or established through the normal simulation.

### 3. Actor selection

Matters supplement the existing relevance selector rather than bypass it. Selection proceeds from the live world at the current instant:

1. holders of authority that can directly address the source;
2. recorded office-holders, commanders, owners, debtors, creditors, promise-makers, beneficiaries, and delegates responsible for it;
3. directly affected characters;
4. characters whose active goals, commitments, plots, relationships, or pressures materially intersect it;
5. a representative star context when an institution, force, province, polity, or region has no suitable character representative.

Selection remains bounded. A matter supplies a relevance reason and may reserve a limited slot; it does not summon every remotely interested character. Related matters should be bundled by actor and decision context when one coherent decision can address them.

The player character is never run as an autonomous NPC. If a matter requires the player's judgment, it becomes a candidate intervention or dispatch item under the unified runtime's player-intervention rules.

### 4. Offer

An offer is the record that a particular actor received the matter in usable context. It should include the actor, time, role, knowledge basis, urgency, and result:

```ts
interface MatterOffer {
  actorRef: EntityRef;
  offeredAt: WorldInstant;
  role: "responsible" | "affected" | "interested" | "representative";
  knowledgeFactIds: string[];
  outcome: "pending" | "intent_declared" | "deferred" | "declined" | "no_action";
  intentIds: string[];
}
```

The NPC prompt should present a matter as part of that character's circumstances, not as an instruction from the engine. For example:

```text
What requires attention:
Legio I's recorded pay is due. Rome's treasury cannot cover the full amount.
You hold fiscal authority over the treasury.

What you know:
The treasury contains 340 denarii.
The recorded obligation is 500 denarii.
The legion has one earlier missed period.
```

The NPC remains free to inspect more, declare an intent, explicitly defer, or do nothing.

### 5. Intention and interpretation

An NPC responding to a matter uses `declare_intent`, exactly as it would for any other objective. The matter ID becomes causal metadata on the intent. It does not dictate the action.

Possible responses to the same pay matter include:

- pay what the treasury can afford;
- seek a legislative grant;
- borrow from a wealthy patron;
- delay payment and make a promise;
- dismiss part of the force;
- accuse the commander of inflating the rolls;
- refuse to empty the treasury during another emergency;
- exploit the unpaid force for personal advantage;
- take no action.

The shared interpreter converts declared intent into ordinary `ActionPlan` stages and validated workflow calls. It does not decide which response the NPC ought to choose. This preserves the existing separation: actor agents decide; the interpreter acts.

### 6. Execution

Only accepted workflows mutate canonical state. Each workflow revalidates current authority, identity, resources, timing, scope, and prerequisites against the shared `GameMasterSession` at execution time.

Every accepted material mutation emits factual events with:

- the actor and acting principal;
- the source matter or plan where applicable;
- affected entities;
- the concrete state delta;
- a factual summary;
- visibility and eligible reaction scopes;
- the actual world instant;
- intervention signals where appropriate.

A malformed or unauthorized call is not an in-world resolution. A genuine refusal may become a fact; an executor failure remains unresolved.

### 7. Disposition

After execution, the runtime evaluates the matter from state and facts, not from prose. A matter may be:

- **addressed:** its completion predicate is satisfied;
- **partially addressed:** some result occurred but the source remains open;
- **deferred:** an actor recorded a future decision or dependency;
- **transferred:** responsibility moved to another actor or institution;
- **blocked:** a specific required authority, resource, reply, or condition is absent;
- **contested:** incompatible plans or claims now concern it;
- **overdue:** the due instant passed without a sufficient disposition;
- **cancelled:** the underlying source ceased to exist or no longer requires attention.

The completion predicate must be domain-backed. A money obligation is not addressed because an NPC said "I will pay"; it is addressed when the ledger records the required settlement, an accepted restructuring changes the obligation, or another valid workflow closes it.

### 8. Reaction and continuation

Facts emitted by the response enter the unified runtime's fresh-context reaction path. Affected-agent selection sees only characters and star contexts actually named or covered by eligible reaction scopes.

This permits causal continuation:

```text
treasurer partially pays army
        |
        +--> commander reacts to remaining arrears
        +--> senate context reacts to treasury depletion
        +--> rival may exploit the public shortfall
```

Later reactions are scheduled at plausible information and action times. Immediate reaction chains remain bounded as specified by the unified runtime.

If no fact resolves the matter, it persists to its next review. It is not recreated from scratch and its previous offers, decisions, and partial results remain available.

## Escalation without forced outcomes

Neglect should increase attention, not silently manufacture an outcome. An overdue matter may:

- increase urgency;
- become visible to additional stakeholders;
- be offered to a superior or alternate authority-holder;
- create or refresh a character pressure;
- trigger a demand, accusation, petition, or inquiry opportunity for another NPC;
- raise its intervention score when the player's interests are materially threatened;
- split into a consequence matter when canonical state now supports one.

Escalation must still distinguish a warning from a consequence. "The troops have not been paid" is a ledger fact once a payment period passes unpaid. "The troops mutiny" requires AI judgment and an executed result; it is not an automatic label applied at an arrears threshold.

Thresholds may change what becomes salient. They must not decide inherently political, social, or narrative outcomes for the AI.

## Standing plans and routine continuity

Requiring a fresh model judgment for every routine collection, salary, convoy, or meeting would be expensive and would reward repetitive prose. The unified runtime already treats unfinished plans as canonical state; world matters should use that capability.

An actor may create a standing plan such as:

> Collect the ordinary Sicilian revenues each autumn and remit them to Rome unless control is lost, serious war damage occurs, or the Senate changes the arrangement.

The plan records:

- its author and authority basis;
- affected sources and accounts;
- cadence or triggering conditions;
- the authorized method and any amount or range the actor actually chose;
- spending limits and resource reservations where relevant;
- exceptions requiring reconsideration;
- expiry, review, cancellation, and succession behaviour.

When the next matter becomes due, the runtime may schedule continuation of that already-declared plan. This is not a new engine judgment. It is the execution of a persistent AI decision through the same plan and workflow path.

A standing plan returns to AI attention when:

- its actor dies, becomes incapable, or loses relevant authority;
- ownership or control of a required source changes;
- a referenced account, force, office, route, or institution changes materially;
- required funds or supplies are unavailable;
- another plan reserves the same exclusive resource;
- the plan's explicit exception or spending limit is reached;
- a relevant stakeholder contests it;
- the plan reaches its review or expiry instant;
- continuing it would cross the player-intervention threshold.

The engine may continue exact instructions. It must not expand them. A standing order to collect ordinary revenue does not authorize emergency confiscation when ordinary revenue fails.

## Treasury and monetary provenance

### Polity treasuries

Every represented polity should have one canonical polity-owned account unless the scenario explicitly models a different arrangement. Office authority may grant characters access to that account without transferring ownership. Losing office removes the derived authority while leaving the treasury and its history intact.

Creating missing treasury accounts is setup or migration bookkeeping, not a Chronicle event. A scenario authors opening balances for new campaigns. Existing campaigns require an explicit migration policy and must never receive unexplained retrospective wealth.

### How a treasury increases

A treasury balance increases only through an accepted money workflow with named provenance. There are two broad cases.

**Transfers from represented owners** move existing tracked money:

- tribute paid by another polity;
- a loan from a character or institution;
- a gift or grant;
- a fine, ransom, confiscation, or sale where the payer is represented;
- repayment from another account.

These debit one account and credit another atomically.

**Revenue from an abstract economy** crosses the boundary from untracked activity into a tracked account:

- provincial taxation;
- customs and port duties;
- rents from holdings;
- trade or resource concessions;
- mint or domain revenue explicitly allowed by the scenario.

The game does not need an account for every taxpayer. Instead, the transaction must cite a recognized `IncomeSource`, jurisdiction or holding, collection period, deciding actor or standing plan, and grounded reason. Generic `add_gold` must not remain an unrestricted way to conjure funds.

### Revenue assessment flow

```text
income source reaches its review instant
        |
        v
internal revenue-assessment matter
        |
        v
authorized governor, treasurer, or office-holder is selected
        |
        v
NPC judges collection policy and circumstances
        |
        v
collect_revenue workflow validates source, period, authority, and provenance
        |
        v
treasury credited; transaction and factual event recorded
        |
        v
matter addressed; next period scheduled
```

The AI chooses the amount or authorizes a standing assessment. The engine may show anchors such as recent receipts, population, stability, control, occupation, war damage, trade access, and authored source descriptions. Anchors support judgment; they do not secretly become the outcome.

An extreme departure from recent or scenario-grounded capacity may require the intent to cite relevant facts or may be returned for clarification. Validation should prevent incoherent values without reducing revenue to one mandatory formula.

### No action and partial action

If no authorized actor collects the revenue, no money appears. The assessment remains due and may become a political or administrative problem.

Partial payments and collections are first-class. The ledger records exactly what moved, while the remaining amount or unresolved assessment persists. Promises to pay create commitments or revised obligations; they do not alter balances.

## Supply and logistics

Supply should use concrete, lightweight continuity rather than a fully enumerated commodity economy. A force may record:

- last confirmed supply instant;
- ordinary source and route, if any;
- current broad status such as secure, strained, short, or critical;
- a responsible commander or logistics authority;
- related standing plan;
- known disruptions and the facts establishing them.

A scheduled supply review detects that the recorded situation requires attention. It does not subtract a fixed ration every day or automatically decide starvation.

The matter may be offered to commanders, governors, treasury holders, allied authorities, local leaders, and hostile actors who know of an exposed route. They may decide to purchase, convoy, requisition, forage, raid, reroute, withdraw, negotiate, or accept risk.

Accepted workflows then record real consequences: money spent, stores obtained, a route established, a province burdened, local stability harmed, movement delayed, or supply status changed. If scarcity is judged to cause disease, desertion, morale loss, or mutiny, that result must also be expressed through validated state-changing workflows and facts.

One abstract supply domain is sufficient initially. Separate food, fodder, weapons, ships' stores, clothing, and replacement equipment should be introduced only when distinct stocks produce meaningfully different player decisions.

## Institutional time

Office terms, sessions, appointments, elections, law sunsets, trials, and successions use the same matter lifecycle.

An approaching term creates an internal matter before expiry. It may be offered to:

- the authority responsible for convening or supervising succession;
- the incumbent;
- plausible candidates;
- characters with political goals or commitments touching the office;
- the relevant institution as a star context when no character represents it.

The engine does not automatically open and resolve an election as one deadline handler. A responsible actor or institution decides to convene it through the ordinary procedure workflows. Candidates decide whether to stand, patrons decide whom to support, and voters or appointing authorities exercise judgment through the AI system.

If the term expires without resolution, the recorded legal state changes only where the constitution defines a mechanical boundary, such as an authority grant expiring. The resulting vacancy, illegal incumbency, disputed authority, delayed election, caretaker arrangement, or refusal to leave office remains a live political matter for actors to interpret and contest.

Procedure deadlines should likewise create decision opportunities. They do not license the engine to discard `buildInvocation` results, invent a winner, or execute an appointment with decorative authorization. Any appointment authorized by a procedure must verify that the real procedure and its recorded disposition support that exact workflow.

## Expansion across the world

The core remains stable as new domain detectors, read projections, and workflows are added.

### Economic

- taxation, rents, customs, trade receipts, and concessions;
- army pay, salaries, pensions, upkeep, and construction tranches;
- loans, interest negotiations, collateral, and repayment demands;
- tribute, reparations, fines, ransom, confiscation, and plunder;
- scarcity, market disruption, corruption inquiries, and fiscal reform.

### Military

- supply reviews, exposed routes, requisition, and depots;
- muster deadlines, levy service expiry, and demobilization;
- reinforcement and replacement needs;
- command vacancies and disputed command;
- siege requirements, winter quarters, prisoners, and ransom.

### Political and legal

- terms, elections, appointments, confirmations, and vacancies;
- institutional sessions and required votes;
- law sunsets, emergency powers, and constitutional review;
- trials, appeals, petitions, investigations, and enforcement;
- legitimacy disputes and unlawful continuance in office.

### Diplomatic

- treaty, truce, guarantee, and alliance reviews;
- tribute and reparations deadlines;
- envoys or proposals awaiting answers;
- hostage exchanges and prisoner agreements;
- border incidents and obligations to allies.

### Character and household

- promises, patronage, debts, favors, and feuds;
- inheritance and guardianship questions;
- marriage negotiations and coming-of-age arrangements;
- funerals, triumphs, ceremonies, and religious obligations;
- household provisioning, illness, care, and displacement.

### Provincial and environmental

- harvest and seasonal assessments;
- food insecurity and relief;
- disease conditions and recovery;
- war damage, reconstruction, and resettlement;
- trade-route or infrastructure disruption;
- fires, floods, droughts, storms, and other impersonal developments.

Impersonal developments should first be judged by an appropriate regional, polity, force, or world star-context agent when no character can author the originating event. That assessment produces a grounded fact. Characters then receive and react to the fact through the normal affected-agent path. A central manager should be a last-resort coordinator, not the ordinary author of regional outcomes.

## NPC integration

### Context projection

`buildNpcAgentContext` should receive a bounded `matters` projection in addition to goals, plots, pressures, beliefs, commitments, pending orders, authority, and visible facts. Each projected matter should reveal only what that character plausibly knows.

The projection should state:

- why the matter concerns this character;
- what is approaching, due, overdue, or contested;
- the known entities and recent facts involved;
- the character's relevant authority or lack of it;
- any plan or commitment already addressing it;
- the last disposition if the matter has been offered before.

The prompt must not command a preferred response. It should ask the character to decide in its own interest, exactly as the current NPC agent does.

### Selection budgets

Matter-driven selection should merge with `selectRelevantActors`, not form a second unbounded NPC pass. Priority character IDs and explicit selection reasons can ensure genuinely due responsibilities compete fairly with general relevance.

Reserved matter slots should be small and deduplicated by character. One treasurer facing five related obligations should receive one coherent fiscal brief rather than five agent runs. Low-urgency background matters may wait; urgency and neglect determine future priority.

### Star contexts

Star contexts serve two distinct roles:

1. representing an institution, force, province, polity, or region with no suitable living character representative;
2. judging genuinely impersonal developments that no character caused, after reading grounded current conditions.

They should not replace an available office-holder merely because a star context is easier to route. Where a real NPC holds the relevant authority, offer the matter to that NPC first.

### The interpreter is not the decider

The interpreter may infer ordinary implementation detail from a declared intent. It may not fill the absence of an NPC decision by inventing what the NPC "must have meant" to do about an open matter.

No declared intent means no actor-authored action. The matter remains open.

## Chronicle integration

The Chronicle remains downstream of canonical facts. World matters improve what the AI remembers; they do not become a second narrative input capable of asserting events.

### Chronicle eligibility

The following are internal and normally ineligible:

- matter creation and refresh;
- selection and offer records;
- pressure creation or escalation;
- an approaching or missed review by itself;
- a scheduler stating that something requires attention;
- a plan that has not produced a factual result;
- an invalid or malformed attempted workflow.

The following may be eligible when supported by accepted facts:

- revenue actually collected or lost;
- money transferred, borrowed, confiscated, awarded, or paid;
- a genuine refusal or public deferral;
- an election convened, candidacy declared, vote held, office transferred, or result contested;
- supplies purchased, requisitioned, captured, or denied;
- concrete arrears, desertion, unrest, shortages, or treasury insolvency;
- a treaty honored, breached, revised, or allowed to lapse;
- another material state change produced through a workflow.

### Routine versus salient facts

All accepted transactions remain in the ledger, but not all deserve a prominent Chronicle entry. Chronicle selection should consider:

- deviation from recent expectations or a standing plan;
- material change in treasury solvency, military readiness, territory, authority, legitimacy, or relationships;
- direct player relevance;
- public visibility;
- creation or resolution of a significant dispute;
- irreversible consequences;
- whether several routine facts can be grouped into one period summary.

Routine revenue arriving exactly under a standing plan may remain inspectable only. A province producing half its recent revenue, a treasury becoming unable to pay an army, or a governor refusing remittance is Chronicle-worthy.

### Causal linkage

Chronicle facts should retain links from:

```text
source entity -> world matter -> offered actor -> declared intent
-> action plan/stage -> workflow invocation -> fact -> Chronicle entry
```

The Chronicle narrator may frame and group those facts but cannot introduce a cause, decision, amount, institutional explanation, or outcome absent from that chain.

### Dating and synchronization

Every fact keeps its actual `WorldInstant`. A resolution window may contain several scheduled matters, actor decisions, executions, and reactions at different instants. Chronicle entries retain those dates even when committed together at the next player decision point.

The current world snapshot, plans, matters, event queue, facts, audit trail, campaign memory, and Chronicle entries must commit atomically. The player must never receive a Chronicle entry for a payment absent from the committed ledger or see a new treasury balance whose transaction failed to persist.

## Knowledge and visibility

A matter's canonical existence does not grant universal knowledge.

- A treasurer may know the exact balance and obligations of an account they control.
- A commander may know their soldiers have not been paid without knowing the treasury's exact balance.
- A rival may know public rumors of arrears without knowing a private promise to a creditor.
- A distant institution learns only after information could plausibly arrive.
- Private household and personal-debt matters stay out of public Chronicle context unless disclosed or discovered.

Matter offers must be built through the same actor-relative knowledge rules as facts and read tools. Causal routing must respect communication delay. A matter may be due in Rome while a commander in Sicily remains unaware until news reaches them.

## Player intervention

A world matter does not automatically stop the simulation. NPCs should be given the first opportunity to handle matters within their authority.

The runtime should stop for the player when:

- the player holds the responsibility and no standing instruction answers it;
- an NPC directs a demand, negotiation, accusation, appointment, offer, or ultimatum to the player;
- continuing would spend or commit player-controlled resources beyond recorded latitude;
- a standing player plan encounters a material exception;
- competing player-owned plans require a choice;
- the resulting facts meet the unified runtime's hard-stop or intervention-score rules.

The dispatch should identify the concrete decision and relevant state. It should not merely say that a generic cycle fired.

## Manager and fallback policy

The ordinary route is NPC or represented institution first. A general manager must not decide a matter simply because it is due.

Fallback proceeds in this order:

1. a living character with direct authority or responsibility;
2. a directly affected or strongly interested living character;
3. an institutional or regional star context with a legitimate representative role;
4. persistence and later reconsideration if no immediate response is necessary;
5. a tightly scoped system action only for non-judgmental integrity work;
6. a central manager judgment only when the game explicitly requires a world-level assessment and neither a character nor appropriate star context can author it.

Permitted system actions include creating missing setup records, advancing dates and statuses whose meaning is defined by schema, deduplicating events, expiring authority exactly when an authored rule says it expires, and committing accepted facts. They do not include choosing winners, inventing payments, deciding motives, or resolving narrative uncertainty.

## Failure and recovery

Provider failure, tool-budget exhaustion, or an invalid invocation must not consume a matter.

- Declared intentions remain staged or persist according to the unified runtime's failure guarantees.
- A workflow that failed validation changes no canonical state and produces no success fact.
- An open matter remains available for the next resolution window.
- A completed workflow remains completed even if a later narrator call fails; its factual result can be rendered later.
- Replaying the same scheduled event cannot repeat an already accepted financial or institutional mutation.
- A change of responsible actor causes rerouting, not loss.

The system should distinguish "the character declined" from "the model or executor failed." Only the former is an in-world fact.

## Performance and pacing

The world may eventually contain thousands of potential matters. The system should control cost through:

- cheap deterministic detection and indexing;
- stable matter identities and refreshes rather than repeated creation;
- review instants rather than daily polling of every source;
- bundling related matters by actor and decision context;
- standing plans for routine continuation;
- urgency-based selection with reserved but bounded slots;
- star-context budgets;
- Chronicle salience and grouping;
- a maximum unattended span and reaction-depth limit;
- compact resolved-matter history while preserving linked factual records.

The game should spend AI judgment where circumstances changed, interests conflict, or a meaningful choice exists—not on restating unchanged administration.

## Relationship to current components

The design should extend the current architecture at its existing seams:

- `advanceWorldDevelopments` demonstrates cheap scheduled detection and pressure projection, but should evolve from one fixed `actorId` to source-backed matters with recomputed recipients.
- `selectDevelopmentActors` demonstrates reserved background selection, but matter priorities should merge into `selectRelevantActors` and its combined NPC/star-context budget.
- `buildNpcAgentContext` should project actor-visible offered matters alongside pressures, commitments, pending orders, authority, and facts.
- `runNpcAgent` remains a read-and-declare agent. It receives no new direct mutation privilege.
- `runIntentInterpreter` continues to carry all NPC decisions through shared plans and workflows.
- `GameMasterSession` remains the single staged mutator and revalidates every invocation against current state.
- the event loop supplies chronological phase resolution and fresh-context reactions.
- affected-agent selection routes the facts produced by accepted actions, not the internal matter that prompted them.
- `chronicle-from-facts.ts` continues to exclude pressures and scheduler notices and derives player-facing history only from eligible factual events.
- turn persistence commits world, plans, matters, facts, event queue, audit data, memory, and Chronicle atomically.

The current batched ordering—player reasoning, selected NPCs and star contexts, one interpreter pass, then closing—can host an initial version by seeding matter-driven priority actors before selection. The intended unified runtime should eventually offer and interpret matters at their actual event instants so later actors see earlier actions already resolved.

## Implementation sequence

### Phase 1: identity and persistence — complete

- Generalize or replace `WorldDevelopment` with a source-backed matter schema.
- Add stable identities, lifecycle statuses, review instants, offers, dispositions, and resolution links.
- Add pure, idempotent matter detectors.
- Persist matters inside the canonical world snapshot and include them in validation and replay tests.

### Phase 2: NPC routing — complete

- Resolve responsible actors from live authority, office, command, ownership, commitment, and affected-entity state.
- Merge priority recipients into the existing bounded actor selector.
- Add actor-visible matter projections to NPC and star-context contexts.
- Record offers and link declared intents to their originating matters.
- Ensure the player character is routed to intervention rather than autonomous execution.

### Phase 3: disposition and standing plans — complete

- Define domain-backed completion predicates.
- Link accepted workflow facts back to matters.
- Support partial, deferred, transferred, blocked, contested, and addressed dispositions.
- Connect recurring matters to persistent `ActionPlan` continuations.
- Reopen AI judgment when authority, resources, conditions, or plan bounds change.

### Phase 4: fiscal foundation — complete

- Ensure polity-owned treasury accounts for new campaigns.
- Author safe migration behavior for existing campaigns.
- Close obligation-orphaning and force-pay inconsistencies.
- Restrict generic money creation.
- Add provenance-aware revenue collection and transfer workflows.
- Create income-assessment, payment-due, arrears, and treasury-risk matter detectors.
- Expose account history, recent receipts, obligations, and authority through actor-scoped reads.

### Phase 5: institutions and supply — complete

- Add office term rules and approaching/expired-term matter detectors.
- Route election and succession responsibilities to NPCs and institutional contexts.
- Verify procedure-backed workflow authorization.
- Add lightweight force-supply state and supply-review matters.
- Add purchase, convoy, requisition, forage, raid, reroute, and supply-assessment workflows as gameplay requires.

### Phase 6: chronological integration — complete

- Offer matters at their actual `WorldInstant` inside the unified event loop.
- Interpret relevant intents before advancing past decisions that can affect the next event.
- Run fact-scoped reactions after each accepted phase.
- Apply player-intervention and unattended-time stopping rules.
- Preserve actual dates through Chronicle construction and atomic commit.

### Phase 7: broader domains — in progress

- Add treaty, commitment, legal, household, health, provincial, and environmental matter producers incrementally.
- Reuse the common lifecycle and routing system.
- Add a new domain only with real state, actor-scoped reads, valid responses, completion predicates, and Chronicle eligibility tests.

## Validation and acceptance criteria

The feature is not complete merely because a due field is read. It should satisfy end-to-end cases.

### Treasury collection

- A polity treasury exists independently of its office-holder.
- A due income source creates one matter for one period.
- The matter reaches a currently authorized NPC.
- The NPC may declare a collection intent or decline to act.
- Only a valid collection credits the treasury.
- The transaction names its source, period, actor or standing plan, and target.
- Replaying the event does not credit it twice.
- Routine collection may remain ledger-only; a material deviation can reach the Chronicle.

### Army pay

- A due obligation reaches treasury and command stakeholders.
- Partial payment debits and credits exactly what the workflow accepted.
- The remainder stays legible and the matter stays open or becomes partially addressed.
- A promise alone does not change the balance.
- A commander may react from fresh state.
- Chronicle prose cannot claim full payment when the ledger records only partial payment.

### Election

- An approaching term reaches the responsible official, incumbent, and bounded relevant candidates.
- The scheduler does not select a winner.
- NPC intentions use the existing political-procedure workflows.
- Expiry and authority state remain internally consistent.
- An unresolved or contested election persists as a matter.
- Only actual nominations, procedures, votes, appointments, refusals, or disputes become Chronicle facts.

### Supply

- A force beyond its expected supply review creates one matter rather than daily duplicates.
- The matter reaches its commander and relevant supporting authorities.
- Different NPCs may choose different plausible responses.
- Supply state changes only through accepted workflows or a grounded star-context assessment.
- Money, province damage, stability, delay, and force condition remain synchronized with the action taken.
- The Chronicle reports material consequences, not the scheduler warning.

### Failure and replay

- Provider failure leaves matters and accepted prior mutations intact.
- Invalid workflows produce no material Chronicle claim.
- A changed office-holder receives the still-open matter on the next review.
- Replaying the same world instant yields no duplicate matter, transaction, procedure, fact, or Chronicle entry.
- World snapshot, ledger, plans, matters, facts, event queue, Chronicle, and memory agree after commit.

## Governing invariants

The implementation should be reviewed against these invariants:

1. A due matter is attention, not an outcome.
2. A pressure is motivation context, not historical evidence.
3. A character decision enters through declared intent.
4. The interpreter carries intent; it does not invent absent judgment.
5. No prose mutates state.
6. Every material change comes from an accepted workflow or explicitly non-judgmental integrity mechanism.
7. Money entering a tracked account has provenance.
8. A standing continuation cannot exceed the decision that authorized it.
9. Actor responsibility is derived from current state and may change without losing the matter.
10. The player character is never autonomously decided for.
11. The Chronicle is derived from facts, never from scheduler concerns or plans alone.
12. Chronicle dates and material state describe the same committed timeline.
13. Unresolved matters persist; technical failure does not masquerade as refusal or resolution.
14. Detection, execution, and persistence are idempotent and replay-safe.
15. Characters and represented institutions receive ordinary matters before a central fallback does.

This architecture lets the world remember that treasuries, terms, armies, promises, supplies, and institutions exist without turning them into a parallel deterministic simulation. Time makes the issue present. The AI decides what people do about it. The workflow ledger makes that decision real, and the Chronicle tells only the history that actually followed.
