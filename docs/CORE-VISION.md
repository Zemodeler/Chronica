# Core vision (preserved before the Chronicle/Orders/Turns removal)

This document exists for one reason: `docs/plans/delete-chronicle-orders-turns.md` calls for
deleting the Chronicle, Orders, and Turns systems, and a large amount of the reasoning behind
where this project was headed lives only in code comments and doc prose attached to that code —
comments that cite an external "docs/32" planning document that is not even in this repository
anymore. Once the code is gone, that reasoning is gone unless it is written down somewhere that
outlives the deletion. This is that somewhere.

Nothing here is a claim about what the project must become after the deletion. It is a record of
what Chronica was building toward, so the decision to cut the turn-based scaffolding is made with
the full picture in view, and so the "elastic time" idea — which was most of the way to being real
— isn't lost.

## What Chronica is

Chronica is a single-player historical strategy game played as one persistent character inside a
curated, hand-validated scenario (never an AI-generated world). The thing that was meant to set it
apart from a normal turn-based 4X was never the map or the tech tree — it was that the player has
no verb menu at all. They talk to real people and give orders in ordinary language, and an AI Game
Master turns that intent into concrete world changes through a strictly validated tool interface
("workflows"), never by narrating whatever it wants. The world was meant to feel like it keeps
going whether or not the player is watching it: people remember conversations, form and break
commitments, pursue their own ambitions, age, die, and get succeeded by someone else.

The published pitch (`README.md`) put it as:

```
choose a character → converse → give orders → world advances → read the Chronicle → act again
```

Conversation was deliberately kept incapable of directly mutating the world — it can create
knowledge and relationships and promises, but only a validated workflow call, arbitrated by one
shared `GameMasterSession`, can change canonical state. That boundary (validated mutation vs.
narrated color) is a project-level invariant, not something specific to turns, and it should
survive regardless of what replaces the turn loop.

## Elastic time — the actual target, and how close it got

The single biggest unfinished idea in the codebase is **elastic time**. Chronica shipped with a
fixed cadence — the world advances by exactly one discrete "turn" per player submission, no matter
how much or how little actually happened — but that was always understood to be a placeholder.
`docs/product.md` said it outright: *"The game is moving from fixed turn increments to elapsed
in-world days and meaningful stopping points."*

The target model: simulated time should run for a variable, meaningful span — days, weeks,
whatever the situation calls for — and only hand control back to the player when something
actually happened that warrants their attention. Not "your turn is over," but "here is why you're
being interrupted." `docs/architecture.md` documented the intended priority order for what counts
as a reason to stop:

1. A mandatory player decision or clarification request (an NPC wants to talk to you now, or a
   plan has an open question that can't be resolved without you).
2. An irreversible, player-involving event (a direct attack, a death, a succession, a betrayal, a
   surrender touching the player).
3. After a scenario-defined minimum span has elapsed — so players aren't woken for trivia — a
   watch condition becoming true, a plan getting interrupted, or a scenario-authored salience
   threshold being crossed.
4. Otherwise, a maximum unattended span, so the world never silently runs away from the player
   even when nothing dramatic happened.

This was implemented as `decideElasticStop` in `apps/web/lib/resolution/elastic-scheduler.ts` — a
pure function that already encodes that entire priority list and the day-level math
(`elapsedDayStart`/`elapsedDayEnd`, driven by `daysPerStep`/`estimateWorkflowDurationDays`, which
let a workflow declare its own realistic duration instead of every action taking exactly "one
turn"). It ran in **shadow mode only**: every turn, it computed what an elastic scheduler *would
have* decided, and wrote that decision to new, previously-always-null columns on `turns`
(`elapsedDayStart/End`, `stoppingFactIds`, `requestedPlayerDecision`, `stopReason`) — without
changing what the live pipeline actually did, which was still resolve exactly one fixed step and
return control every single time. The intent (per the module's own comments, citing "docs/32
Phase 16") was to accumulate real shadow-mode data — how often would elastic time have kept running
past where the fixed cadence stopped anyway? — before ever cutting real players over to it.

Of the four stop-condition dimensions above, only two had real upstream detection wired in by the
time this doc was written: a mandatory player decision (sourced from the `flag_npc_initiated_dialogue`
GM tool and from plans with outstanding clarification questions) and the max-span fallback. The
other three — an irreversible player-involving event, a watch condition, a plan interruption — had
no detection anywhere in the codebase yet; `decideElasticStop` accepted them as caller-supplied
inputs, honestly defaulting to empty rather than inventing an answer, exactly the same stance
`feasibility.ts` and `conflicts.ts` already took about things they couldn't check.

The eventual engine for elastic time was never meant to be the turn table at all. It was meant to
be the **event queue** (`world_events` / `worldFacts` in `packages/db/src/schema/events.ts`) — a
persistent, causally-chained, minute-precision record, explicitly commented as "the multi-agent
living world spec's core runtime." `turns.instantDayStart/instantMinuteStart` were documented as
being populated "only once the event queue is actually driving resolution" — i.e., turns were
always the transitional scaffolding, and the event queue was the destination. That is the single
most important piece of context to carry forward: **the event queue is not turn-scoped
infrastructure, even though it currently gets driven from inside turn resolution.** It is the thing
elastic time was going to be built on. Deleting turns should not mean reflexively deleting it too.

## What "a plan with stages" was for

Orders were never meant to be fire-and-forget commands. `interpret_plan` turned an order's raw text
into an `ActionPlan` — up to twelve stages, with named delegates, dependencies, recurrence,
personal-time cost, and an explicit discretionary spending cap the plan's owner actually stated (the
Game Master was never supposed to invent a delegate or a sum nobody named). A plan persisted across
turns until it completed, failed, was abandoned, or was superseded — newer instructions could
outrank incompatible unfinished work, but were never allowed to undo something already done. Before
committing a stage, the interpreter had to classify every factual claim the order's own text made
(a world premise, an actor's belief, a deliberate message, a preference, or a condition) and refuse
to build a stage on a world premise it already knew was false. This claims-vs-intent discipline —
not the specific `orders` table — is the part of "Orders" worth remembering: it's what made the
Game Master's interpretation of natural language into world state trustworthy rather than
freeform narration wearing a data schema.

## What the Chronicle was for

The Chronicle was documented as "a readable account of neutral facts, not a source of truth" —
deliberately downstream of the world, never itself authoritative. Chronicle prose was built
strictly from already-committed factual events (`chronicle-from-facts.ts`); the turn report could
group and frame entries but was never allowed to invent a cause, a result, or an institutional
explanation that the facts didn't already contain. It carried a specific, deliberate distinction
that's easy to lose sight of once the code is gone: a **refusal** (someone with standing said no —
that's history, and gets written as such) versus something the engine simply **could not carry out**
(a guessed id, a rejected argument, a missing action — never narrated as "no one heard you," because
in-world, nobody ever did hear it). That refusal/unresolved distinction was executor-derived and
explicitly exempt from narrator embellishment on either side.

Two things rode on the Chronicle that have nothing to do with wanting a news feed: campaign memory
folded forward from committed factual events (open wars, pressures, procedures, causal chains) so
the world could keep going without unbounded prompt growth — that memory logic is derived from
`WorldState`/facts directly, not from Chronicle rows, so it's a separable concern. And, more
entangling: an NPC that wanted to initiate contact with the player surfaced that intent as a
Chronicle entry's `initiatedDialogue` field, which is the only channel through which "a character
wants to talk to you" currently reaches the UI. That coupling — a Chat feature's most important
proactive signal being sourced from the thing being deleted — is called out explicitly in the
deletion plan as something that needs a replacement, not just a removal.

## The other systems this project is built from

Turns, Orders, and Chronicle were the scaffolding that drove player-visible pacing. They were never
the whole game. What they sat on top of, and what should be unaffected by their removal:

- **World simulation core** (`packages/shared/src/world/*`) — the canonical `WorldState`, the
  fact ledger, the day/minute clock, watch conditions, diplomacy, scenario definitions, and
  causal-chain derivation.
- **Characters — the "actual characters" system** (`packages/shared/src/characters/*`) — this is
  the part explicitly called out to survive. Each NPC has one canonical world record (not a
  disposable chat persona): mind, traits, skills; beliefs and pressures that get read into the
  dialogue system prompt; a directed relationship ledger with causes, not a single opinion scalar;
  a durable per-(player, NPC) knowledgebase carrying biography, culture, faith, class, goals,
  backstory, and rolling salience-weighted conversation memory; family, inheritance, and succession
  state; and an explicit commitment/promise ledger the NPC's own account backs. A newly discovered
  character gets a real canonical identity and an AI-enriched profile — including grounding named
  historical figures against real biography — rather than being invented and forgotten the moment
  the conversation ends. This is the system the deletion plan is built around protecting.
- **Factions and political life** — procedures, votes, offices, legitimacy, treaties, tribute,
  vassalage, elections.
- **Military** — forces, battles, sieges, morale.
- **Economy** — wallets, ledgers, spending caps, provider-cost accounting that funds AI usage; this
  was never turn-scoped and needs no rework because of this deletion.
- **Workflows** — the ~97 MCP-style tools that are the *only* surface through which anything is
  allowed to mutate the world. This is a general capability registry, not an Orders/Turns
  mechanism, even though today its only caller is turn resolution's multi-agent dispatcher.
- **World cycles** (`docs/world-cycles/*`) — designed-but-unbuilt future work (fiscal runtime,
  income/awards, institutional term cycles) that assumed the Chronicle as its "the player would
  notice this" delivery channel. Not implemented, so nothing to delete, but its design assumption
  needs revisiting once Chronicle is gone.

## What replaces the function of what's being deleted

This document doesn't resolve the open design question of what the *next* pacing mechanism is —
that's future work, not something to retroactively decide here. But it's worth being explicit
about what gap the deletion opens up, so it isn't accidentally forgotten:

- Something has to replace "the player is told the world moved forward and here's what changed"
  — Chronicle's job — if the game is going to do anything beyond real-time chat.
- Something has to replace "an NPC can proactively reach out to the player" without routing through
  a Chronicle entry.
- The event queue (`world_events`/`worldFacts`) is the standing candidate substrate for whatever
  that becomes, per the elastic-time design above — it was built to outlive the turn cadence.
- The claims-vs-intent discipline from plan interpretation, and the refusal-vs-unresolved
  distinction from the Chronicle, are both worth reimplementing in whatever comes next, even though
  the specific `orders`/`chronicleEntries` tables are not.
