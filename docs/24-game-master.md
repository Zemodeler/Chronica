# The Game Master

One AI agent simulates a turn. It is the director of the world and the referee
of intent; it is not the authority on what is true. Deterministic code is, and
it stays that way by construction: the agent can only act by calling typed
tools, and every tool runs against a staged copy of the world that is thrown
away unless the turn commits.

This replaced the resolution committee — `assess_orders`, `adjudicate`,
`reaction_director`, `simulator`, `character_director`, `world_director`, and
`workflow_manager`. Those operations remain in the AI operation schema so
archived turn rows and routing profiles still parse, but nothing in normal play
routes to them.

## The turn

```
committed snapshot + compact campaign memory + scenario constitution
+ player orders (as attempts) + NPC goals, beliefs, pressures, commitments
                              |
                        Game Master
                              |
        read tools  <-------> staged world <-------> action tools
                              |
              each tool result returned as exact fact
                              |
                    structured turn report
                              |
              validate, then commit atomically
```

`apps/web/lib/resolution/pipeline.ts` runs the deterministic work around it, in
this order:

0. Pending dialogue social events and the pressure lifecycle.
1. Working set: directive ids, and one bounded character selection reused by
   both character agency and the agent's prompt.
2. Life review — ageing, health, incapacity, death, estates, office vacancies.
3. Character agency — candidate generation, scoring, conflict resolution, and
   the rules-backed commitment lifecycle.
4. **The Game Master.**
5. Due political procedures, resolved by their declared mechanism.
6. Procedures that became due during this same turn.
7. Chronicle, built from the factual event log.
8. Commit.

Life review and character agency run *before* the agent rather than after the
player's actions were previewed, so a death or a formed intention is part of
the world the agent reads and can answer within the same turn.

## What the agent can do

`packages/shared/src/gm/tools.ts` builds the whole tool surface:

- **Read tools** (`gm/read-tools.ts`): `inspect_world`, `inspect_force`,
  `inspect_province`, `inspect_polity`, `inspect_character`,
  `inspect_active_conflicts`, `inspect_recent_history`,
  `inspect_chronicle_chain`, `inspect_actor_memory`. Each returns a compact,
  factual, bounded answer. Records a scenario marks `private` are withheld
  unless the session is opened with `privateInformation: "allow"`.
- **Action tools**: every registered workflow, generated from the registry, so
  a workflow added there is immediately available with the same parameter
  schema and the same deterministic `apply`. Each takes an `actorId`, because
  every mutation is somebody's act. Workflows only `system` may invoke —
  `resolve_battle`, the life-event workflows — are not offered at all.
- **`request_capability`**: the capability-gap safeguard, below.
- **`finish_turn`**: the structured turn report that ends the turn.

There is deliberately no generic patch or set-state tool, and an unregistered
action id has no execution path anywhere in the engine. `define_action`/
`invoke_defined_action` exist in code as a narrower, reviewed exception, but
are off by default and not part of the normal-play tool surface —
[docs/27](27-command-contract-and-taxonomy.md) has the full rationale, the
feature flag, and the removal criterion.

## Why the tool loop uses the Responses API

A reasoning model refuses function tools on `/v1/chat/completions`:

> `Function tools with reasoning_effort are not supported for <model> in
> /v1/chat/completions. To use function tools, use /v1/responses or set
> reasoning_effort to 'none'.`

Setting `reasoning_effort: 'none'` works and is the wrong trade: deciding a
whole turn against tool results is the operation in this codebase that most
needs to think. So `callWithTools` uses `/v1/responses`, which supports both.

Each step returns an opaque `providerItems` — the model's own output items,
reasoning included — and the loop replays it verbatim on the next step. Without
that, the agent re-derives its plan from scratch after every tool result.
Providers with no such state leave the field undefined and the adapter
reconstructs the calls instead.

`call()` still uses chat completions: those are single-shot, schema-bound, and
carry no tools.

## The staged session

`packages/shared/src/gm/session.ts` is the only place a tool becomes a world
change. Each action call runs deterministic policy first — registered action,
valid parameters, actor exists and is alive, invoker authority, scope, treasury
access, no exact duplicate — then the workflow's own `apply`, then a full
re-validation of the resulting world document. The stage is reassigned only on
success, so a failed call leaves it exactly as it was, and an `apply` that
throws is reported as a failure like any other.

Refusals are returned to the agent verbatim, and that exact wording is what the
Chronicle carries. The agent never supplies its own reason for a refusal.

A started battle is fought immediately, in the same call, by the deterministic
resolver, and the result — including a derived brief of casualties, retreats,
and outcome — comes straight back. The agent reacts to a real battle rather
than deciding one.

Budgets bound the turn: 24 world-changing calls, 60 tool calls, 12 model steps.
Hitting one is not a failure; the work the tools already did is real and is
committed with a deterministic account.

## The capability-gap safeguard

`executeWorkflow` has no runtime-template path, and migration 0029 disables
every persisted invented workflow — existing rows stay readable for review,
never executable. The narrower, code-level invented-action escape hatch
(`define_action`/`invoke_defined_action`) is off by default for the same
reason; see [docs/27](27-command-contract-and-taxonomy.md) for why it still
exists in code and what would need to be true to remove it outright.

The supported path is `request_capability`: when nothing in the tool list can
do what an actor is attempting,
the agent calls `request_capability` with the intent, why no tool fits, the
actor and targets, a proposed tool name and typed parameters, the expected
state effect, safety constraints, and scenario context. Nothing is mutated. The
attempt is recorded as unresolved in `capability_requests` and on the factual
event log, the Chronicle may report only the factual limitation, and a
developer decides offline whether to write a real typed workflow.

A request that contains a patch path, a JSON-patch operation, a world-state
pointer, an entity selector, or a template placeholder is rejected outright: a
model must not be able to smuggle a mutation through the text of a request for
one.

## Memory

`WorldState.campaignMemory` holds a durable summary, the last six turns in
detail, and character notes. It is folded forward deterministically from the
factual event log — never from Chronicle prose, which is downstream of both and
carries a narrator's voice. Older turns compact into one line each as they fall
out, so the record converges on "the recent past in detail, the deep past in
outline" without an AI call and without unbounded growth.

`deriveOpenThreads` reads everything still unfinished — wars, battles, sieges,
standing relations, open causal chains, unresolved commitments, procedures
mid-passage, live pressures, standing operations — straight out of committed
state, capped per kind.

## Chronicle

Downstream, always. `apps/web/lib/resolution/chronicle-from-facts.ts` builds
every entry body from the factual event log: an executor summary for an applied
mutation, or the exact limitation text for an unsupported attempt. The turn
report contributes framing only — which facts belong together, who was
involved, where, how prominent, and which directive it answers.

Player directives, refusals, and unsupported attempts are kept out of the
narrator pass entirely, so no rewrite can attach an invented institutional
explanation to a refusal or recast a completed action as an unfinished one. A
fact the report forgot is still recorded rather than lost.

## Cross-collection references

Zod validates each collection's shape. It does not check that the ids one
collection holds resolve in another — a character's province, polity, purse, or
heir, a force's province, commander, or controller. Those checks used to live
only in the invented-workflow patch applier, which no longer runs.

`world/references.ts` now owns them, and `executeWorkflow` enforces them as a
**delta**: a workflow is refused if it *introduces* a dangling reference, and
tolerated if it merely inherits one. It is deliberately not a
`WorldStateSchema` requirement — a snapshot committed before this existed may
already carry breakage, and a hard schema rule would make those games
unloadable rather than repairable.

The repair runs each turn beside `ensureProvinceMaterial`:
`ensureCharacterAccounts` opens the purse any legacy character was declared to
own (empty, private, owner-accessible), or repoints them at one they already
own. It is a no-op on a current game.

## Atomicity

The committed snapshot is written once, by `commitResolution`, in a single
transaction carrying the final world, the workflow audit, the Game Master
report and factual event log, capability-gap requests, Chronicle entries, and
the updated campaign memory. Anything that throws before that leaves the
committed world untouched and the staged world discarded.
