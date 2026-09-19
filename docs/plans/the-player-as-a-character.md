# Plan: make the player a character the world can see, reach, and answer to

**Status:** planned, not executed. Branch `player-as-a-character`, off `chronicle-as-history`.

Chronica's premise is that the player is *a character* — a consul, a merchant, a soldier — and that
the world around them differs accordingly. Measured against the code, it does not. This plan is the
work of making the premise true, in the order that makes each step visible when it lands.

---

## 1. What was measured

Two slices were built from the same Punic Wars world and diffed: one for **Gaius Genucius Clepsina**
(consul, `officeId: roman-consul`), one for **Manius Curius Dentatus** (same polity, `officeId: null`).

> **One line of 143 differs.** The `ACTING FOR:` line.

The private citizen with no office is shown the consul's purse, the field army's strength and morale,
Rome's standing aims, the Senate's internal weights, every diplomatic letter to and from Rome, and
every open political procedure.

Every scoping decision in [`packages/sim/src/slice.ts`](../../packages/sim/src/slice.ts) filters on
`ownPolity`. The actor's own identity is read in exactly two places: `factsKnownTo` for fact
visibility — which itself falls back to the polity for polity-scoped facts — and the one-line `actor`
field at `slice.ts:698`, which carries `{id, name, office, polityId}` and nothing else. `office` is
the raw office **id**, not its label, so the model is told `roman-consul` rather than "Roman consul".

The rest of the picture, from the same trace:

- **The player is excluded from everything that happens to people.** `routeAttention` and
  `routeAmbientActors` exclude them ([`burst.ts`](../../packages/sim/src/burst.ts)), so they never
  get cognition, never form an intent, never update a belief. The narrator excludes them as a target
  (`narrator.ts:294`), so every one of the thirteen ways the world makes trouble is for other people.
- **Nobody ages or dies.** `nextLifeReviewAtStep` is null for the player *and* for every canonically
  created NPC, and `dueForLifeReview` is not called from the sim at all.
- **Age is hardcoded to 35**, health 10000, prestige 3000, `traits: []`, in
  [`player-materialization.ts`](../../packages/shared/src/characters/player-materialization.ts).
- **Nothing the player has ever done has moved anyone's opinion of them.** Across every save in the
  dev database, every relation an NPC holds toward a declared player has exactly one cause: the seed
  written at character creation, step 0, no dimensions map, `decayPerYearBps: 0`.

## 2. What is already right, and must not be rebuilt

This is not a greenfield. Most of the machinery exists and is simply unaimed.

- **Authority is correctly derived and correctly checked.** `deriveOfficeGrants`,
  `deriveCommandGrants` and `deriveOwnerGrants` already give a person exactly the power their office,
  their command and their own purse confer. `actorIsAnswerableFor` already judges any delta scoped to
  the actor's own polity, so **a Roman player moving a Roman legion without a command grant already
  records a breach today**. The gaps are that the breach is a private fact nobody reads, the act
  succeeds anyway, and nothing ever told the orchestrator what the player may do.
- **Skills already bite once.** `battle-resolver.ts:92` reads a commander's `skills.martial` as a real
  modifier. The pattern to extend is that one, not a new subsystem.
- **The social graph is complete and idle.** Six relation dimensions, a cause ledger,
  `deriveRelationDimension`, `deriveReputation`, `relationshipLabelFor`, and `applySocialEvents` to
  write causes — reachable from the `social_events` delta arm. Only conversations call it.
- **Traits are read where it matters.** `TRAIT_REGISTRY` carries `dialogueGuidance` and
  `decisionModifiers` per trait, and `renderActor` prints them into an NPC's own prompt. They are
  only ever *written* at `character_create`.
- **`whoSeeksThePlayer` is genuinely character-led** — driven by orders the player issued, promises
  owed to them, and their own pressures.
- **Starting money is already asked for by backstory.** The declaration prompt demands funds
  "appropriate to the character's role, social class, culture, period". What is missing is
  calibration, not a rule.
- **`knowledgebase.authority` is deliberately not canonical**, and
  `authority-projection.test.ts:45` asserts it is never read. Leave that alone; it is free text.

## 3. Non-negotiable constraints

1. **Do not veto the player.** VISION §12 makes insubordination a property of an act, not a
   validation failure — that is the only reason coups, embezzlement and unauthorised wars are
   expressible at all. A soldier who orders a legion about must be *refused by people*, not blocked
   by the engine.
2. **An order is always answered.** Whatever else changes, the player must never give an order and
   read nothing. A weight floor under the reign's own matters was tried during the Chronicle work and
   reverted for exactly this reason.
3. **No false insubordination.** Seven distinct bugs in this codebase have manufactured it, each
   found by playing rather than reading. Every change here that touches scope or authority gets a
   test that a *lawful* act records no breach.
4. **Symmetry.** The player and an NPC act through one contract (VISION §10). Anything built for the
   player that an NPC could have should be built for both — reuse `renderActor`'s body rather than
   writing a parallel one, or the two drift.
5. **The player must never be stuck.** Every pressure the narrator puts on them has to come with
   something they can do about it, or leniency means only "no death".

---

## Phase 0 — Make the engine character-led at all

**This is step zero because without it nothing else is visible.** "You are a merchant" means nothing
while the merchant reads the consul's dispatches.

A **station filter** over the world slice: what a person sees follows from their office, their
command, their holdings and their relationships — not from their polity. The authority index already
computes all of it, so this is a filter, not a new model.

Sketch of the rule per section, to be settled during implementation:

| Slice section | Seen by |
|---|---|
| TREASURY | accounts they hold access to (`accountAccess`), plus any their office names |
| MILITARY | forces they command or control; others only as far as public knowledge goes |
| BEFORE THE COUNCIL, INSTITUTIONS | institutions they hold a seat or standing in |
| LETTERS | correspondence they sent, received, or their office handles |
| STANDING AIMS | their own government's, only if they are in a position to know it |
| PEOPLE, OTHER POWERS, PROVINCES | broadly public, as now |

The honest default for anything ambiguous is **public knowledge of the period**, not secrecy: a
merchant knows the consul exists, knows roughly where the legions are, and does not know what the
Senate said in private session.

**Done when** the two-slice diff that produced "1 line of 143" produces a slice for the private
citizen that is materially shorter and missing the things he has no business knowing — and when a
consul's slice is unchanged from today.

## Phase 1 — Put the player in the slice properly

The other half of the same gap. Replace `{id, name, office, polityId}` with the section `renderActor`
already builds for an NPC: mind, drives, temperament, skills, pressures, relations, health, standing.
Reuse the function body so the two cannot drift.

Two small fixes alongside:

- Resolve `officeId` to its **label** via `input.offices`.
- Add a **"WHAT THIS PERSON MAY DO"** section, built from `buildAuthorityIndex`: the grants they
  actually hold, in words.

That last line is the highest-leverage change in the plan. "A soldier cannot order armies" is not a
veto — it is telling the world who it is speaking for, which it has never been told.

**Done when** a prompt-smoke test shows a consul's and a merchant's `ACTING FOR` sections differing in
station, skills and permitted acts.

## Phase 2 — Authority created at declaration

`findOfficeSeatForRole`'s word-overlap match on `role` is the only path from a declared character to
real power. Add a **command path**: a declared soldier gets a force — an existing one with a vacant
commander seat, or a small one created for them — and `deriveCommandGrants` does the rest for free.

Most declarations should still end with neither office nor command. That is correct and already
happens; it becomes *meaningful* once Phase 1 tells the world about it.

## Phase 3 — The player as a cog

The check already fires. Three things are missing, and none of them is a blocker:

- **Surface the breach.** It is a private weight-25 fact nobody reads, and since the Chronicle work
  breaches are excluded from the record entirely — correctly, because their summary is an audit line
  about grants and account ids. The fix is for the *person who noticed* to write it: an official who
  finds the money moved without authority records that as a fact in their own words, which is both
  publishable and dramatic.
- **Let people refuse.** An order outside the player's grants reaches its recipient's cognition as a
  request they may decline. `orderAttempts` exists, `whoSeeksThePlayer` exists, and the Chronicle now
  treats a refusal as an event. The legion does not move because a legate declines — and that is a
  headline, not an error message.
- **Test both directions.** A soldier ordering a legion produces a breach and a refusal; a consul
  ordering the same legion produces neither.

## Phase 4 — Money by backstory

The rule exists; add **calibration**. Wealth bands per `socioEconomicClass`, owned by the scenario —
it already owns the currency and the economy — passed into the declaration prompt and **clamped** on
the way out. Clamp rather than reject, so the model's judgment inside the band still counts.

A soldier's declared 5 000 gets pulled to the band a soldier lives in; a senator's 1 200 stays where
it is. The same bands should feed `character_create`'s `wealth` field, so an invented merchant is
plausible for the same reasons.

## Phase 5 — Skills that bite

No skill-check subsystem: that is a different game. Two mechanisms only.

- Skills reach the prompt (free, from Phase 1), so the world reasons about who it is dealing with.
- Where arithmetic **already happens**, extend the `battle-resolver.ts:92` pattern: diplomacy on
  negotiation outcomes, stewardship on project pace, intrigue on whether a secret is discovered. Each
  is one modifier on something the engine already computes.

## Phase 6 — The narrator may target the player, leniently

Remove the `character.id !== playerCharacterId` filter, then gate it.

- **Allowed:** illness, debt, family obligation, rivalry, opportunity.
- **Never:** conspiracy with the player as the plotter. They choose their own plots.
- **Structurally impossible:** grave illness, while `character_death` does not exist as a delta arm.
  That is the deferred arm from the narrator work, and leaning on its absence makes "no insta-kill" a
  property of the engine rather than a hope.

**And it must follow from what the player has done.** `chooseCharacter` scores NPCs by office,
command and quietness. For the player, score instead from **their own authored facts, their open
threads, and the orders they gave**: a rivalry lands on the man they overruled, a debt follows the
campaign they funded, an opportunity opens where they have been building standing. That is a
different selector for the player than for NPCs, and it should be.

The seed arrives as a pressure plus a fact. They read it in the Chronicle and answer with an order —
which is the escape hatch constraint 5 demands.

## Phase 7 — Traits shape how NPCs see them

When an order resolves, emit social events for the people it touched, through the existing
`social_events` delta arm, and let `applySocialEvents` write the causes. Overruling a commander,
spending a subordinate's money, keeping a promise — each is a cause with a dimension and a score.

The actor already answering writes them; the engine clamps. `renderActor` already prints how an NPC
feels about others, so the loop closes with no new prompt section and no new reader.

**Done when** a save's relation causes toward the player number more than one.

## Phase 8 — Traits evolve

Last, because it needs Phase 7's trail to mean anything.

A trait-set arm usable on a **living** character, written by the *world* rather than by the person: a
trait is what others observe of you, not what you claim. Trigger on accumulation from the player's
own authored facts — three risky choices and "bold" is observed of them — so it stays deterministic,
explainable, and writable in the Chronicle: *"men had begun to call him…"*.

---

## Order and why

```
0 → 1 → 2 → 3 → 4 → 6 → 7 → 5 → 8
```

0 and 1 are the same gap from two sides and land together. 2 and 3 are what make the player a cog
rather than a voice. 4 is self-contained and cheap. 6 makes things happen *to* them, which is what
makes the Chronicle about a person. 7 then has something to react to, and 8 needs 7's trail. 5 is
last of the mechanical ones because it is the least visible until the rest is in.

## What this plan deliberately does not do

- **It does not make the player omniscient again by another route.** Phase 0 narrows; nothing here
  widens.
- **It does not add a difficulty setting.** That was discussed and is a separate decision.
- **It does not touch `knowledgebase.authority`.** Free text, and a test says so.
- **It does not give the player cognition.** They are the one actor whose intent a person writes.
  Everything else about them becomes symmetric; that stays asymmetric on purpose.
