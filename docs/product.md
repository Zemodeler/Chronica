# Product guide

## The game

Chronica is a map-first, single-player historical strategy game experienced through one character. A campaign begins from a curated, validated scenario rather than an AI-generated world. The player can approach people, explore political and military circumstances, and give an order in natural language. The world persists: people remember, form commitments, pursue ambitions, suffer consequences, die, and may be succeeded.

The core loop is:

1. Read the current world and Chronicle.
2. Speak with reachable characters to discover information, make promises, or shape relationships.
3. Give one or more orders, including priorities and conditions.
4. Let the world resolve through the next meaningful stretch of simulated time.
5. Read the factual consequences in the Chronicle and decide what to do next.

Conversation can create knowledge and history, but material commitments become real only through a validated action. An order is evidence of intent, not proof that its assertions are true or that it is possible.

## Player experience and boundaries

The game does not restrict a player to a fixed verb menu. A player may ask for a surrender, a march if it is refused, supplies to be taken, and survivors to be recruited if victory allows it. The engine preserves the hard boundaries: entities, territory, force control, resource ownership, workflow preconditions, and replay safety. Within those boundaries, the Game Master judges human and political outcomes.

Version 1.0 is deliberately scoped to:

- Single-player campaigns.
- Curated historical or fictional scenarios.
- A persistent character, their contacts, and a living political world.
- Map, conversations, orders, character and world-status panels, and the Chronicle.
- Rules-backed military, political, social, and material effects.

It does not promise multiplayer, free-form AI world generation, a map-based command UI, or a new planning dashboard. The map remains visible and expressive; it is not a province-management surface.

## Scenario, map, and people

Scenario data establishes the provinces, polities, settlements, forces, characters, offices, resources, and initial conflicts. The map shows where events happen and how war, control, and movement affect the world. It supports geographic focus and force details without becoming an administrative interface.

Characters use one canonical world record. Their public circumstances, relationships, subjective beliefs, pressures, commitments, and memories are related but distinct kinds of state. Dialogue reads that state; it does not maintain a second character store. NPCs can initiate contact when a recorded event warrants it, and newly found scenario-appropriate characters receive stable identities rather than being disposable chat output.

The opening scenario can be a high-stakes historical decision: investigate a theatre through conversation, give a conditional order, and see genuine military and political consequences rather than a scripted choice. The precise scenario is content, not a product requirement.

## Orders and time

Orders become durable plans with stages. A plan can name delegates, constraints, dependencies, recurrence, personal-time use, and a discretionary spending cap. It remains available on later turns until it completes, fails, is abandoned, or is superseded. Newer instructions take priority over incompatible unfinished work, but never undo a completed effect.

When interpreting an order, the Game Master separates claims from intent. A contradicted world premise cannot be used as the basis of a stage. Materially ambiguous, dangerous, or irreversible instructions may require clarification; clarification never commits stages in the same operation.

The game is moving from fixed turn increments to elapsed in-world days and meaningful stopping points. Day-level fields and an elastic-stop decision already provide diagnostics in shadow mode; the existing live resolution still returns control after one step. That is intentional until the remaining lifecycle and UI integration are ready.

## Chronicle and memory

The Chronicle is a readable account of neutral facts, not a source of truth. It favours the player's theatre while retaining major distant developments that change their world. Refusals and unsupported attempts use the recorded limitation rather than invented narrative justification.

Campaign memory keeps recent turns in detail and compresses older history deterministically. Open wars, battles, commitments, procedures, pressures, operations, and causal threads are derived from committed state, so the world can continue coherently without unbounded prompt growth.

## Economy and future work

Coins fund AI use. Wallets, lots, holds, ledgers, game spending caps, gifts, provider-cost recording, and the payment adapter exist; a purchase flow is not yet a player-facing promise. Any displayed estimate must follow the active rate card.

Near-term work is to complete the universal plan/time lifecycle, activate elastic time only after shadow data validates it, connect UI to the existing plan model, and broaden carefully reviewed action coverage. Future features such as multiplayer, authored world generation, tactical controls, and richer playable scenes remain product choices, not implied commitments.
