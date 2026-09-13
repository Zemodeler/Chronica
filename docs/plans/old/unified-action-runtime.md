# Unified action and time runtime

**Status: completed and archived.** This design is implemented. The maintained description of the live order-to-resolution loop is [Turns and resolution](../../../architecture.md). This document is retained as the original implementation plan and acceptance record.

Player and NPC actions should travel through the same simulation path. The player supplies their character's intent directly; an NPC agent declares its character's intent. After that difference at the point of authorship, interpretation, planning, scheduling, execution, persistence, reactions, and factual reporting are the same.

The runtime should not stop merely because the next event belongs to the player. It should continue through scheduled work and relevant reactions until the world genuinely needs a new player decision. At that point it commits everything that has happened, dates the Chronicle at the stopping instant, and returns control to the player.

## The target loop

One resolution window follows this sequence:

1. **Collect intentions.** Treat each new player directive as an intent declared by the player's character. Relevant NPCs and represented institutions may also declare intents from their own knowledge, pressures, commitments, and authority.
2. **Interpret intentions.** The shared interpreter turns every intent into an `ActionPlan`: one or more concrete stages, their dependencies, actors, resources, conditions, and expected durations. It does not give player text a more privileged mutation path than NPC text.
3. **Validate and schedule.** Ready stages go through the same workflow schemas, authority checks, resource checks, and world-integrity validation. An action with duration schedules phase events on the world clock instead of applying its final effect immediately.
4. **Resolve the next event.** Take the earliest due event by `WorldInstant`, apply only that phase, and emit facts describing what actually changed.
5. **Refresh context.** Select only the characters and star contexts affected by those new facts. They reason against the world as it exists after the event, not against the snapshot from the start of the turn.
6. **Interpret reactions.** Reactive intents use the same plan and workflow path. Immediate reactions may schedule an event at the current instant; slower reactions schedule their realistic future instant.
7. **Decide whether to stop.** Evaluate player-intervention rules after the event and its immediate reaction window. If intervention is not required, continue from step 4 with the next event.
8. **Commit at a decision point.** When intervention is required, or the unattended-time safety bound is reached, atomically commit the world, plans, facts, event queue, audit trail, and Chronicle. The next player turn opens at that exact world date.

The loop is chronological, not round-robin. “NPC 1” and “NPC 2” do not each receive a ceremonial turn. Whoever is affected by the next real event gets an opportunity to respond, and later actors see all effects already resolved at earlier instants.

## One action model for every actor

The only special property of a player directive is that its wording came directly from a human and remains immutable evidence of intent. It does not bypass interpretation or execution rules.

Every player, NPC, institution, force, polity, or world-originated action should have:

- an issuer and acting principal;
- immutable source intent and revision history;
- a desired outcome and any stated method, posture, secrecy, conditions, or spending limit;
- one or more stages with stable identities;
- dependencies and required procedures;
- reserved people, forces, accounts, and other resources where applicable;
- an estimated duration range and a selected likely duration;
- a scheduled start or next phase instant;
- status, progress, blocking reason, and facts produced so far;
- a causal link to the event or directive that prompted it.

The interpreter may infer ordinary implementation details, but it must not invent a consequential target, delegate, political commitment, or spending authority. A contradicted world premise cannot become the basis of a stage. Material ambiguity creates a requested player decision rather than a guessed action.

The same intent may produce an immediate action, a long-running project, a conditional plan, or a refusal. Those are outcomes of interpretation and validation, not different systems selected according to whether the actor is human-controlled.

## Duration and milestones

Every action receives a duration, including actions that are effectively immediate. Duration comes from the action definition's estimate, adjusted by grounded circumstances such as scale, available labour, distance, season, infrastructure, opposition, and resources. The resulting choice must stay inside a game-appropriate range: historically plausible enough to make logistics matter, compressed enough to preserve momentum.

Long work is represented by meaningful phases, not by one event per day and not by an instant final mutation. As a default:

- an immediate or routine action has one completion event;
- a short action may have a start and completion event;
- a substantial project normally has three player-visible milestones: commencement, one meaningful progress or complication update, and completion;
- extra milestones exist only when something changes the expected outcome, duration, cost, ownership, or player decision;
- repeated “work continues” updates with no new fact are not Chronicle events.

The middle milestone need not be exactly halfway. It belongs where the project becomes meaningfully established, consumes another tranche of resources, encounters a risk, or becomes visible to other actors. The final material entity is created only at completion unless the action definition explicitly produces usable partial output.

Duration estimates may change after a factual disruption. Rescheduling records the cause and preserves completed phases; it never silently rewrites the original estimate.

### Example: build a large Roman navy

An order such as “Build a large fleet for the Sicilian war” might become:

1. **Establish construction** — obtain the required authority and funding, reserve timber and shipyards, appoint supervision, and create a navy-construction project. Chronicle fact: the yards begin work.
2. **Construction established** — several months later, consume the next resources and report a substantive state: work is broadly on schedule, delayed by timber, accelerated by captured designs, sabotaged, or otherwise changed. If nothing important changed, this phase may remain an internal fact rather than a prominent Chronicle entry.
3. **Commission the fleet** — around a year after commencement, if the required work and resources remain available, complete the project and create the usable naval force.

“A year” is illustrative, not a universal constant. Scenario period, fleet size, existing maritime capacity, urgency, and gameplay pace determine the actual estimate. The purpose is to make a major fleet feel built without making the player read twelve monthly copies of the same update.

Army raising, fortification, travel, sieges, diplomatic missions, investigations, and political campaigns use the same shape. A levy might assemble quickly; a professional army or siege train might require several phases. The completed force appears when the workflow's completion conditions are met, while intermediate mobilisation remains real, inspectable state that rivals may discover and react to.

## Persistence and continuation

An unfinished action remains canonical world state across resolution windows. It continues automatically when its next phase becomes due; neither a player nor an NPC must restate it every turn.

An unfinished plan leaves automatic continuation only when one of these occurs:

- it completes;
- its actor explicitly cancels or abandons it;
- a newer intent explicitly revises or replaces it;
- a newer intent materially contradicts it;
- its objective becomes impossible;
- a required actor, resource, authority, or premise is lost and the plan is failed rather than merely blocked.

A temporary obstacle blocks or interrupts a plan and schedules reconsideration; it does not erase it. Completed phases and their effects remain history. When the obstacle clears, the same plan resumes from its next unfinished phase.

Contradiction must be grounded, not guessed from topical similarity. A new order contradicts existing work when both cannot be honoured together because they demand incompatible outcomes or exclusive use of the same actor or reserved resource. “March the army to Syracuse” contradicts its unfinished order to remain at Messana; “write to Carthage” normally does not. The newer explicit instruction wins, and the displaced action is marked interrupted, superseded, or cancelled with a recorded reason. If compatibility is genuinely ambiguous and the consequence matters, request player intervention.

These rules apply equally to NPCs. Their unresolved plans remain in memory and continue on the clock unless later decisions or world facts contradict them.

## Fresh-context reactions

Every resolved phase emits facts before reactions are selected. Selection is fact-scoped: directly affected characters, holders of authority over an affected force or institution, and unrepresented affected contexts may react. An actor is not selected merely for existing nearby.

Reacting actors see:

- the world after the triggering phase;
- the triggering facts at their visibility level;
- their own beliefs, goals, pressures, commitments, relationships, and authority;
- their existing unfinished plans and resource reservations.

They may do nothing. If they declare an intent, it enters the same interpreter, validation, duration, and scheduling path as every other action. A reaction cannot mutate the past or occur before information could plausibly reach the actor. Communication delay therefore matters: physical witnesses may react at the same instant, while a distant ruler reacts only after news reaches them.

Reaction chains are bounded for safety. After three immediate causal layers, further reactions must be scheduled at a later instant. This prevents an unbounded cascade while retaining the causal chain in world state for the next event.

## Player-intervention threshold

The simulation should continue by default. It stops when continuing would make a meaningful choice for the player, violate the player's stated latitude, or carry the world too far past something the player reasonably needs to know.

Some conditions are hard stops and require intervention regardless of score:

- the interpreter needs consequential clarification;
- another actor presents the player with a direct choice, demand, negotiation, appointment, trial, or ultimatum that only the player character can answer;
- the next action would exceed or contradict an explicit player condition, budget, posture, or commitment;
- two player-owned plans conflict and no explicit newer instruction determines precedence;
- the player must choose among materially different responses before an irreversible action can proceed.

For other events, compute an intervention score from 0 to 100:

| Factor | Points | Meaning |
| --- | ---: | --- |
| Irreversibility | 0–30 | Death, permanent loss, war, surrender, removal from office, or another outcome that cannot simply be revised later. |
| Deviation from plan | 0–25 | The expected method, cost, timing, target, or likely outcome has materially changed. |
| Direct player involvement | 0–20 | The player character, their command, office, household, or expressly reserved resources are directly affected. |
| Strategic consequence | 0–15 | Territory, a major force, treasury solvency, an alliance, or a principal objective is at stake. |
| Uncertainty requiring judgment | 0–10 | Several lawful continuations exist and the standing plan does not clearly choose among them. |

**A score of 60 or more stops the simulation.** A lower score records the event and continues unless a watch condition says otherwise. Scenario rules may adjust the threshold, but one campaign must keep its selected threshold stable and auditable.

The score does not let the engine pause before every setback. A small delay, ordinary expense, routine refusal, or expected progress report should normally remain below threshold. Conversely, hard stops cannot be averaged away by a low numeric score.

The runtime also stops after a configured maximum unattended span even if nothing reaches the threshold. This is a pacing and cost safety valve, not an implication that the player must decide anything; the dispatch may simply say that time has passed and summarise ongoing work.

## Chronicle and return to the player

The Chronicle is built from the facts accumulated since the previous player decision. Entries retain their actual event dates even though the batch is committed together. Milestones with no player relevance or material change may remain inspectable facts without taking a prominent Chronicle slot.

When the intervention threshold is reached:

1. finish immediate reactions at the same instant, subject to the causal-depth cap;
2. leave later reactions and ongoing action phases scheduled;
3. commit the exact stopping `WorldInstant`;
4. publish the dated Chronicle and current dispatch;
5. state the decision, changed assumption, or new danger that needs the player;
6. open the next player turn at that date.

The player may answer with a new instruction, revise or cancel existing work, or let standing plans continue. Unmentioned compatible work continues automatically.

## Deterministic boundaries

AI owns interpretation, character judgment, milestone framing, and choosing a plausible duration within an action's declared range. The engine owns chronological ordering, identity, authority, resource reservations and spending, status transitions, event deduplication, reaction depth, intervention-score calculation from recorded classifications, and atomic commit.

No prose changes state. Every phase and reaction still requires a validated workflow or world tool. A failed call changes nothing; a genuine refusal becomes a fact; a malformed call is repaired or reported as unresolved rather than invented into history.

## Completed implementation scope

The completed implementation includes:

- route player directives through the same declared-intent and shared-interpretation contract used for NPCs, while retaining the player's exact wording;
- make `ActionPlan` the canonical plan type for player, NPC, and world work instead of continuing to execute player-only `PlayerPlan` records;
- schedule player and ordinary NPC action phases on `WorldInstant` rather than applying most of them immediately at one `elapsedStep`;
- feed newly scheduled same-window reaction events back into the active event loop after the transaction-local stage, rather than waiting for a later turn;
- run affected-agent selection for facts produced by ordinary player and NPC workflows, not only for events that entered through the queue;
- replace the current batched NPC-decision pass with event-scoped, fresh-context decisions where chronology matters;
- activate elastic stopping using the hard stops and threshold above, replacing the current unconditional one-step return;
- enforce stated spending limits and reservations mechanically rather than treating them only as prompt guidance;
- surface clarification questions and the requested player decision directly in the player UI;
- preserve newly submitted intentions safely if the AI provider fails, so a failed resolution cannot consume a turn while dropping its staged plans.

Focused verification on 13 September 2026: the action-plan, clock, intervention-score, and event-loop suites passed (69 tests). This archive should not be used as the current product or runtime reference.
