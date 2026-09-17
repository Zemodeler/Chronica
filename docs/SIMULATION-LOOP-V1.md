# Simulation Loop v1 — what was built, and why

The engine built to satisfy [`docs/VISION.md`](VISION.md) §33, which named **Simulation Loop v1** as
the thing to get right before economy, combat, diplomacy or intrigue are attempted — so those
systems plug into one resolution architecture instead of growing separate incompatible ones.

Written for whoever picks this up next. It explains the reasoning behind each boundary, not just the
shape, because the shape is recoverable from the code and the reasoning is not. Where a decision was
forced by something that went wrong, it says so: several of the sharpest constraints here exist
because a live model found the soft version of them first.

---

## 1. What this had to solve

The commit before this work deleted the entire previous engine — Chronicle, Orders, Turns, the
multi-agent dispatcher, the Game Master tool-loop, and a workflow registry of roughly 97 tools. That
was deliberate, and it left the repository in a half-state: the domain types survived, but **nothing
persisted a world at all**. `getWorldView`, `persistOpeningWorld` and `createGame` had all lived in
the deleted `queries/turns.ts`, so game creation and the Chat NPC system were both severed from
their runtime.

So this had two jobs at once: build the loop, and give the world somewhere to live again.

The principle it serves:

> The LLM is sovereign over causality. Software is sovereign over memory, arithmetic, scheduling and
> consistency.

Everything below is an attempt to make that sentence load-bearing rather than decorative.

---

## 2. The contract

**The model never mutates the world. It proposes a transaction, and deterministic code validates,
arbitrates, assigns every id, and applies it atomically.**

In `packages/shared/src/sim/`:

- `deltas.ts` — `WorldDeltaSchema`, a discriminated union of **14 operations**. The complete set of
  ways the world can change.
- `proposal.ts` — what an actor returns: `narrativeSummary`, `frictions`, `deltas`, `facts`,
  `delegations`, `schedule`. The orchestrator and NPC cognition return the *same* shape, which is how
  VISION §10's symmetric agency falls out of one contract instead of a parallel NPC system that
  drifts.
- `refs.ts` — the `local:` handle scheme.

### Why a closed union rather than a tool registry

The deleted engine gave the model ~97 bespoke workflow tools and still could not keep the books
straight. The lesson: a **narrow closed set plus one honest escape hatch beats a wide one**, because
every arm of a narrow set can actually be validated. The escape hatch is `generic_entity_create`,
backed by `WorldState.genericEntities` — VISION §9's "dynamically created mechanics" works by
recording a novel institution as a first-class-but-untyped entity rather than pre-authoring a
mechanic for every idea.

### Why the model never supplies an id

A model that invents ids will eventually invent one that does not exist, and a hallucinated id that
reaches storage is indistinguishable from a real one afterwards. So it gets a scratch namespace: it
declares `localId: "legion_v"` on the delta that creates a thing and writes `"local:legion_v"` to
refer to it later in the same payload. The engine assigns every real id and resolves the handles; a
reference that resolves to nothing is rejected.

Enforced structurally — every delta arm is `.strict()`, so a payload carrying an `id` fails to parse
rather than being quietly ignored.

### Why time is always days

The model never states a date. It says `dueInDays: 60`. Date arithmetic is the engine's job, and a
model asked to do it will eventually schedule something into its own past.

### Why rejection is friction, not failure

VISION §8 is explicit that "build 200 warships in six months" must not return
`ERROR: insufficient resources`. `applyDeltas` returns `{ world, applied, rejected, breaches }`: a
delta that cannot apply is rolled back individually, the rest of the batch still applies, and the
rejection becomes a fact. An over-ambitious order partly succeeds and the player learns why.

Rejections carry a `kind`. **"world"** means the world genuinely could not comply — the treasury was
short — and the player should hear about it. **"reference"** means the proposal named something that
does not exist, which is the engine catching a malformed payload. The distinction exists because
without it, "no province called Latium existed" appeared in a Chronicle as though it were history.

### Why lack of authority does not block an act

`applyDeltas` runs `checkAuthority` on every delta and then **applies it anyway**, recording a
breach. VISION §12: a general who marches without orders has not performed an invalid action, he has
committed insubordination. Coups, embezzlement and unauthorised wars are only expressible if
"unauthorized" is a property of an act rather than a veto.

Two bugs here manufactured *false* insubordination, which is the worst failure available to a system
whose whole point is that real insubordination means something. A character held no authority over
their own purse (office grants cover an office's named treasury and nothing else), and unscoped
deltas were judged against `map.polities[0]` — so a Roman consul was checked against Carthage and
breached for everything. `deriveOwnerGrants` and an actor-relative scope fallback fixed both.

---

## 3. The loop

`packages/sim/` is a pure package: `WorldState` plus a model port in, a committed world and
everything it recorded out. No database, no network, no Next.

```
apps/web route ──load──▶ packages/db ──▶ world + known facts + pending queue
      │
      ▼
runSimulationBurst(input)
   0. runDeterministicTick(...)   code    catch up: revenue, wages, milestones
   1. buildWorldSlice(...)        code    §27 bounded projection
   2. orchestrate(...)            MODEL   intent, deltas, facts, delegations, schedule
   3. applyDeltas(...)            code    refs → authority → arithmetic → commit
   4. advance + tick              code    walk to the next moment that matters
   5. routeAttention(...)         code    §18 funnel to ≤3 actors
   6. runCognition(...)           MODEL   batched, per-actor knowledge only
   7. pressure + caps             code    §22 stop evaluation
      ▼
 CONTINUE       CHRONICLE ──▶ MODEL (knowable facts only)       DECISION ──▶ player
```

**Three model calls, everything else deterministic.** Attention routing, arithmetic, authority, id
assignment, scheduling, information filtering, pressure and termination are all code — which is what
makes VISION §29's two-to-four calls per interaction achievable.

### Why the world moves only during a burst

Between orders the world is perfectly still. That is the intended game: it is the player's, paced by
them, and nothing happens behind their back while they read.

This makes the burst responsible for carrying the world far enough to be worth the asking. It takes a
short first step — so word can travel and the people the order touched can answer — then jumps to
whatever is next on the calendar, bounded by the scenario's maximum span. One order can span days or
months depending on what is pending, which is what lets a sixty-day levy mature instead of creeping
forward two days per order forever.

A burst that ends in a momentous order hands control straight back without advancing at all. The
minimum span exists to avoid waking the player for trivia; it must not delay news that already
matters, so it gates only the quiet stop.

### The deterministic tick (`tick.ts`)

Everything that happens because time passed and for no other reason: revenue collected, wages paid,
project milestones reached. VISION §7 says there is no reason to invoke a model to calculate a
monthly surplus, and nothing does — a burst spanning sixty days collects two months of revenue and
pays two months of wages in one free pass.

It decides nothing. A treasury that cannot meet the army's wages accrues arrears and emits a fact;
whether that becomes a mutiny is for an actor to judge. Note the asymmetry: revenue arriving as
expected emits **no fact at all**, because a treasury filling on schedule is not history and a fact
per tax payment would drown every Chronicle in bookkeeping. An unpaid army emphatically is.

Without this the queue was write-mostly — a milestone came due, was mentioned to the orchestrator,
and was retired whether or not anything happened. "Raise two legions" scheduled legions that could
never arrive.

### Why `packages/sim` is its own package

The old engine lived in `apps/web/lib/resolution/` and was untestable for exactly that reason. The
new one depends on `@chronica/shared` **only** — deliberately not on `@chronica/ai`, which depends on
`@chronica/db`. A simulation core that transitively requires a database cannot be unit-tested without
one. So it declares its own port:

```ts
export interface SimModelPort {
  complete(operation: SimOperation, systemPrompt: string, userMessage: string): Promise<string>;
}
```

`apps/web/lib/simulation-service.ts` supplies a closure over `callWithCoinGate`; tests supply a
scripted fake.

### The slice (`slice.ts`)

`WorldState` is far too large to send. `buildWorldSlice` projects the part that matters under hard
caps, so the slice does **not** grow as a campaign runs — a slice that grew with the world would make
the loop more expensive the longer you play, which is exactly backwards.

Two rules, both learned the hard way:

**Everything it shows, it shows by id.** The model writes back what it reads. When the treasury
section printed `Marcus Atilius's purse: 980` without an id, the model paid from
`"Marcus Atilius's purse"`. When PLACES printed province names without ids, it wrote `Latium`. When
projects showed a milestone label without its id, it guessed. This class of bug recurred three times
before the rule was stated.

**It must not be filtered to the player's own polity.** It was, on every axis — so an order to invade
was carried out by a model that could not see the enemy's armies, leaders, or even that they had
none. Filtering foreign *secrets* is right; filtering the existence of the army marching at you is
not.

History in the slice is filtered through `factsKnownTo` for the ordering actor, so the orchestrator
speaks for a government that knows what that government knows — and no more.

### The attention router (`attention.ts`)

Deterministic, four gates mirroring VISION §18:

1. **Inside the causal horizon, and the news has arrived.** A fact past `maxCausalDepth` cannot wake
   anyone (§21 — otherwise every reaction breeds another forever), and neither can one whose
   `discovery.knowableAtInstant` is still in the future.
2. **Could they know?** `factsKnownTo` for that character and their polity.
3. **Would they care?** Direct involvement, their polity, live pressures, open commitments, an
   unanswered order.
4. **Could they act?** An office, a command, or a standing grant.

Top scorers become `focused` (≤3, model cognition); the next tier `active`, who record what they mean
to do deterministically and for free — without that the middle tier was computed and discarded every
burst. Activity level is derived per burst, not stored, because importance here is emergent from what
a character is currently entangled in.

A router that asked the model "who should react?" would answer "everyone interesting" and defeat its
own purpose.

> The focus threshold is set at the exact score of someone who can know, has cause to care, and holds
> authority (10 + 20 + 25). Writing the router's tests found it one point above that, so an ordinary
> public event woke nobody at all and the router was moot. `maxFocused` is what bounds the cost.

### Cognition (`cognition.ts`)

One batched call covers every focused actor, and each actor's section is built **only** from their own
knowledge. Handing one model the omniscient world and asking it to play several characters produces
one narrator wearing masks — precisely what §28 says to avoid — and it leaks: a general who has not
been told of the treaty starts acting as though he had.

### Delegation (`burst.ts`)

An instruction aimed at someone who could refuse is **not** a delta. It becomes an `OrderAttempt`,
and that person decides separately — via `decideOrderAttempt`, which already forces an unauthorised
"accept" to be recorded as `subvert`, so a breach can never silently acquire the standing of a lawful
order. Delegations resolve through the same id map as deltas, and an order to someone who does not
exist is not recorded at all.

### Stopping

Significance is scored **by the actors, as a field on each fact they emit**, and accumulated by code.
That is how §22 gets contextual judgment of what matters without a model call of its own.

`DEFAULT_BUDGET`: `maxIterations 3`, `maxModelCalls 4`, `maxSimulatedDays 90`, `maxCausalDepth 3`,
`maxFocusedActors 3`, `pressureThreshold 100`, plus the scenario's own `maxSpanDays`. Anything
unresolved at the stop becomes a scheduled event — stable pending state, never dropped.

### The Chronicle (`chronicle.ts`)

Written only from what the player could know. The constraint is enforced by **what the historian is
handed**, not by an instruction in the prompt: a prompt asking the model not to mention secrets would
eventually be disobeyed and nobody would notice.

---

## 4. Knowledge, and who has it

VISION §14 asks the world to distinguish what is true from what is known. `Fact` carries a
`visibility` (`public` / `polity` / `private`) and a per-observer `discovery` ledger with travel time.

`factsVisibleTo` — which survived the wipe — cannot resolve polity membership. Its own comment says
so and leaves it to the caller. **Every caller forgot.** The result was that the entire `polity` tier
was invisible to everyone, that polity included: a consul's own diplomatic dispatch never reached the
consul, the orchestrator could not see its own government's recent history, and nobody could be woken
by their polity's business. Playing it produced a Chronicle reading *"Nothing of note was recorded in
this period"* for the burst in which Rome delivered an ultimatum to Messana.

`factsKnownTo` is what callers should have had: public as before, private still only by discovery,
and polity-scoped facts known to those the polity covers. The Chronicle, the slice and the attention
router all use it.

One more subtlety: `factsVisibleTo` treats every public fact as visible the instant it exists. That is
right for "is this a secret" and wrong for "has word reached Carthage yet", so the router applies
`knowableAtInstant` as a separate gate — that is what carries VISION §16's travelling news.

---

## 5. The world populates itself

A sparse scenario (VISION §4) names a dozen peoples and gives almost none of them a character. That
is the intended starting point — but nothing ever required them to be filled in, so they stayed names
on provinces that could not resist, negotiate or react. An invasion of the Boii found no Boii, and
the orchestrator reached for `generic_entity_create` to produce "Boii lands", a placeholder for
ground it had no id for.

`population.ts` finds the gaps deterministically and free: countries holding land with no leader or
no forces, ranked by whether the player is dealing with them now (read from recent facts), whether
they border us, and how much they hold. The slice states it plainly — *"COUNTRIES WITH NOBODY IN
THEM"* — and the orchestrator fills it in the call it was already making, through the
`character_create` and `force_create` it already had. No extra model call, no new contract surface.

Bounded to two per burst so one order is not swamped; a world fills in over a few orders, with
whoever the player is actually engaged with first.

Played: "Invade the Boii lands" now produces Catamandus of the Boii with a 5,200-strong tribal host —
outnumbering Rome's field army — along with Bellovesus of the Insubres, Apuanes of the Ligurians and
Dumnorix of the Veneti, each with forces and a commander that resolves to a real person.

---

## 6. Conversations are part of the record

A proposed `CharacterSocialEvent` used to wait for a turn to apply it. Turns were deleted, so nothing
ever did: every relationship change, belief, pressure and promise from every conversation reached the
ledger and stopped there.

`applyConversationConsequences` applies them as the conversation happens, through the character
system's own `applySocialEvents` — and records the conversation in the fact ledger, which the old
path never did. What was said is history, so the attention router can wake someone because of a
promise and the Chronicle can report a conversation the player actually had.

The discovery ledger keeps it honest: a private exchange is marked discovered by the people in the
room and nobody else, so they can act on it while the rest of the world cannot see it until someone
tells them.

Deliberately *not* a burst: a conversation is not an order, costs no simulation model call, and does
not advance the clock or wake the world on its own.

### NPCs who seek the ruler out

NPC-initiated contact previously reached the player through a field on a Chronicle entry. When that
went, the capability survived with nothing to trigger it. `whoSeeksThePlayer` is the replacement:
deterministic, free, bounded to two, drawn from what the world already knows — who owes the ruler an
answer to an order, whose promise has come due, who is in serious trouble in the ruler's own polity.
The opening line only has to be true; the character's own voice takes over the moment the player
replies.

---

## 7. Time

Time used to be a turn counter: `elapsedStep` was authoritative, a step meant "a season", and
`WorldInstant` was a finer clock derived *inside* one turn's resolution window.

VISION §15 removes turns and §16 asks for real timestamps, so the relationship is reversed:

- **`WorldState.instant` (day + minute from the scenario epoch) is authoritative**, and required.
- **`elapsedStep` is maintained as exactly `instant.day`** — a schema invariant, changed only through
  `advanceWorldTo`, which refuses to run backwards.

`elapsedStep` was kept rather than deleted because roughly forty schemas across material state,
projects, authority and the character system store `*AtStep` fields, and every one stays meaningful
when a step is a day. What changed is only what a step *means*.

Consequences: `ScenarioClock` lost `stepLabel`/`stepsPerYear`/`minSpan`/`maxSpan` and gained a
**required** `epoch` plus `minSpanDays`/`maxSpanDays`; `currentAgeYears` reads days against
`DAYS_PER_YEAR` instead of taking a scenario's steps-per-year; scenario data was rescaled (a consular
term of `4` seasons became `365` days). `formatWorldDate` converts an instant to a real date
("1 March 264 BC") using proleptic Gregorian arithmetic with astronomical year numbering, so deep BCE
and the BCE→CE boundary are both correct.

`WORLD_SCHEMA_VERSION` went to 2. There was **no migration burden** — nothing persisted a world at the
time — which is exactly why that was the moment to do it.

---

## 8. Persistence

Six tables, split by lifetime rather than by turn (migration `0034_simulation_loop.sql`):

| Table | Holds |
| --- | --- |
| `game_worlds` | the live world document, one row per game, with a `revision` token |
| `world_facts` | the append-only record, with visibility, discovery and significance |
| `scheduled_events` | the future queue |
| `simulation_bursts` | one run of the loop, for inspection afterwards |
| `chronicle_checkpoints` | what the player was shown |
| `player_decisions` | forks needing the player's own authority |

Facts live **outside** the world document on purpose: what is true and who knows it are different
questions, and the record must be queryable by time and visibility without loading a world.

`commitBurst` writes all of it in one transaction under one revision bump, behind
`pg_advisory_xact_lock`. Partial commits are the failure worth designing against — a world that
advanced without its facts, or facts describing a world that was never saved, are both unrecoverable
by inspection. The advisory lock matters because the conversation path writes world state too.

Scenario definitions and their starting worlds live in `scenario_versions`, and **those rows are
immutable**. Changing a scenario file does nothing to an existing database until a new version is
published in `ensureBuiltInScenarios` and `currentVersion` is bumped. This has bitten twice.

Migration 0034 also retires the turn era: the previous commit deleted the TypeScript schema but never
wrote a migration, so the database still carried `turns`, `orders`, `world_snapshots`,
`chronicle_entries`, `world_events`, `world_facts` (an older, colliding shape) and their enums and
orphaned columns.

---

## 9. Authority was un-stubbed

`officeIdToDomainPowers` had become a stub returning `[]` when the workflow registry it classified
against was deleted, taking office-derived authority with it (three tests were left `it.skip`'d).

Its replacement is the delta union: an office's `authorisedActionIds` are written in exactly the
vocabulary the world can be changed in. An office authorising `force_create` holds military command
power; one authorising `money_transfer` holds fiscal spend power. Fiscal authority stays scoped to the
office's own named treasury, so a governor authorised to spend does not reach the national treasury.
The three skipped tests are live again.

To break the resulting cycle — deltas are classified *by* domain, offices derive authority *from* the
delta vocabulary — the authority enums were extracted into `authority/vocabulary.ts`.

---

## 10. The page layer

`game-repository.ts` and `world-view.ts` were deleted with the turn system and are **rewritten rather
than restored**: the in-memory demo repository is gone, as are every Orders, News and turn method, and
the old projector's turn-indexed knowledge labels and hardcoded scenario overlay tables. What remains
reports what `WorldState` actually contains.

`createGame` came back with it, and now materializes the world immediately — its predecessor opened
turn 0 and let the scenario's `initialWorld` stand in until the first turn resolved, and there is no
longer a turn to stand in for it.

The council panel (`simulation-panel.tsx`) is the player's whole interface to the simulation: an order
box, the latest Chronicle, and the occasional decision. Chat needs the declared-character
knowledgebase to speak in the player's voice; giving orders does not, so the two are gated separately
— holding a character in the world is the whole qualification.

Answering a decision passes the prompt and the chosen option into the slice **as structure**. It used
to re-submit the sentence "you have chosen: accept", so the world resumed a decision without knowing
what had been asked.

---

## 11. What is reused rather than rebuilt

| Survivor | Serves |
| --- | --- |
| `world/facts.ts` — `Fact`, `FactDiscovery`, `emitFacts`, `factsVisibleTo` | §14 objective vs. known, §18 signals, §25 chronicle boundaries |
| `world/instant.ts` — `WorldInstant`, `addMinutes`, `worldInstantToSortKey` | §16 continuous time |
| `authority/order-attempt.ts` — issue→decide→carry-out | §13 delegation, §12 refusal and subversion |
| `authority/authority-grant.ts` — `buildAuthorityIndex`, `checkAuthority` | §12 authority as classification |
| `world/project.ts` — projects and milestones | §8 ambitious orders persist, §17 scheduling |
| `material-state.ts` — accounts, obligations, income, forces, office seats | §7 economy |
| `world/references.ts` — `findWorldReferenceViolations` | §3 code owns consistency |
| `world/scope.ts`, `world/watch.ts`, `clock.ts`'s `StopReason` | §18/§19 attention, §21/§23 stopping |
| `characters/*` including `applySocialEvents` | §10/§11 NPCs as real actors |

---

## 12. Verification

`packages/sim` has **89 tests**, all driven by a scripted model port — never a live adapter, because
a test that can disagree with itself run-to-run is worth nothing as a regression guard. Repo-wide:
**504 tests**, none skipped, and the whole repo typechecks.

The end-to-end case is VISION §30's own example. One order — *"Raise two new legions"* — produces, in
two model calls: money leaving the treasury, a persistent NPC generated because the mobilization
needed a financier, a recruitment `Project` with milestones, a recurring upkeep obligation, scheduled
milestones, an `OrderAttempt` still awaiting its recipient's answer, a public mobilization fact that
becomes knowable elsewhere after a day, a private borrowing fact that does not — and Carthage, woken
by the router, quietly reinforcing Sicily where the player cannot see it.

Other suites cover: money conservation and over-spending as friction, batch partial application,
unauthorised acts applying as recorded breaches, unresolved `local:` handles, dangling references,
every budget cap terminating a burst, a model answering with prose instead of JSON, revenue and
arrears across a multi-month span, projects completing across orders, the attention router's four
gates, polity-aware visibility, conversations as private history, and who seeks the ruler out.

### What playing it taught

Scripted tests prove the loop. Only playing proves the prompt. Every defect below was found by
running real orders against a live model, and none would have been caught otherwise:

1. **The model described the order instead of carrying it out** — intent, delegations and a schedule,
   with the treasury untouched. Fixed by an explicit rule: an answer with no deltas asserts the world
   did not move, which is rarely true of an order a government has accepted.
2. **It named things by label rather than id** — the purse, then provinces, then milestones. Three
   separate occurrences of one rule that had not been stated.
3. **It named people who did not exist** (`publius_scutarius`), and cognition invented `local:`
   handles for actors that already existed, itself included.
4. **A government could not see its own business** — the whole `polity` visibility tier was invisible
   (§4 above).
5. **The engine's own complaints reached the historian**, putting "no province called Latium existed"
   into a Chronicle.
6. **A one-participant `social_events` delta killed whole batches** — it produced an encounter with
   one participant, which fails `WorldState` validation, discarding every other delta with it.
7. **The council had no stylesheet.** The class names existed and nothing matched them.

Played across five orders after the fixes, "Invade the Boii lands" ran a campaign from 1 March to 30
May 270 BC with no engine rejections at all: a persistent project, a generated officer delegated the
provisioning, the army advancing into Umbria, the invasion completing through scheduled milestones,
Rome delivering an ultimatum to Messana through an envoy with no authority to concede — and Hieron of
Syracuse and Hanno of Carthage each manoeuvring on their own account, Hanno noting he held no office
with which to commit Carthage to anything.

---

## 13. What is deliberately not done

- **Combat resolution.** Two sides can now face each other — the Boii field 5,200 men against Rome's
  4,000 — but nothing resolves a battle between them. `packages/shared/src/warfare/` survived the
  wipe and has no caller.
- **Diplomacy, espionage and intrigue as systems.** The delta union is where each plugs in.
- **Economic depth.** Income, obligations and arrears work; trade, credit and monetary policy do not
  exist.
- **Multiplayer.** The burst assumes one sovereign. Multiplayer reintroduces exactly the
  turn-synchronisation problem §15 exists to avoid.
- **Games created before this work.** Their state lived in the dropped `world_snapshots`; they were
  deleted rather than half-resurrected.

---

## 14. Known risks

**Prompt size and slice content, not loop logic.** `buildWorldSlice` is where this design succeeds or
fails. The system prompt is ~4,600 tokens (mostly the generated JSON schema, identical every call and
therefore cacheable) and the slice is bounded — but whether it carries *the right* bounded subset for
a given order is the thing most likely to need iteration. Every defect in §12 above was a slice or
prompt problem; none was a loop problem.

**Burst duration against request scope.** A burst with a live model can exceed 45 seconds. A client
that gives up leaves a `simulation_bursts` row at `running` — harmless today, since nothing reads it,
but the row exists partly so that moving bursts to a background job later is cheap.
