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

- `deltas.ts` — `WorldDeltaSchema`, a discriminated union of **46 operations**. The complete set of
  ways the world can change: money, income, obligations, loans, projects, forces, battle, characters,
  beliefs, intentions, pressures, social events, generic entities, authority grants, order decisions,
  diplomatic stances, polity outlooks, legitimacy, province material, political procedures, support
  positions, estates bought, granted, improved and transferred, and the threads of history the world
  follows.
- `proposal.ts` — what an actor returns: `narrativeSummary`, `frictions`, `deltas`, `facts`,
  `discoveries`, `delegations`, `schedule`. The orchestrator and NPC cognition return the *same*
  shape, which is how VISION §10's symmetric agency falls out of one contract instead of a parallel
  NPC system that drifts.
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

An order none of whose acts stood is answered by the engine itself: a private `order_given` fact
saying what was ordered and what stood in the way. It fires when nothing of the order reached its
giver, and also when every act of the order was refused whatever else the answer said -- the
orchestrator writes the world's doings in the same breath as the order's, and an embassy the engine
refused to send once left no trace because a fire in Latium and a quarrel between the consuls were
written beside it and counted as the order being seen.

### Why lack of authority does not block an act

`applyDeltas` runs `checkAuthority` on every delta and then **applies it anyway**, recording a
breach. VISION §12: a general who marches without orders has not performed an invalid action, he has
committed insubordination. Coups, embezzlement and unauthorised wars are only expressible if
"unauthorized" is a property of an act rather than a veto.

**Five** bugs here have manufactured *false* insubordination, which is the worst failure available
to a system whose whole point is that real insubordination means something. Every one was found by
playing, not by reading:

1. A character held no authority over their own purse — office grants cover an office's named
   treasury and nothing else. Fixed by `deriveOwnerGrants`.
2. Unscoped deltas were judged against `map.polities[0]`, so a Roman consul was checked against
   Carthage and breached for everything. Fixed by an actor-relative scope fallback.
3. The orchestrator speaks for the **whole world**, not only for the ruler whose order it is
   answering: it gives the Boii a chieftain and decides what Carthage privately wants. One tax order
   produced ten breaches, most of them things the consul had nothing to do with. The exemption
   follows *who is speaking* — `ApplyContext.actsForTheWorld` — so a person acting through their own
   cognition still answers for everything, and a Carthaginian moving a Roman legion still breaches,
   which is the whole of §12.
4. `checkAuthority` matches scopes exactly unless the caller supplies a containment rule, and nothing
   ever had. A grant over Rome covered nothing *in* Rome, so a consul with authority over his own
   republic was insubordinate for putting a motion to its own Senate.
5. Meaning to do something was treated as doing it. An intention has no scope of its own, so it fell
   back to the whole polity and an official who merely resolved to act had exceeded his authority.

The recurring shape: authority is about what a person may **cause**, and anything that is not a
person causing something — the world describing itself, a thought, a country's private aims — must
not be weighed on that scale.

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
   7. stop evaluation             code    §22: does this need the player?
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

Two things the tick now does that are decisions only in the sense a calendar makes them: it collects
a power's taxes **no faster than its lands can bear**, and it keeps **elective offices filled** —
ending terms, calling elections nobody called, and counting the votes. Both are in §5b.

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

A burst stops when it needs the player — not when something worth telling has happened. Those were
once the same test: significance accumulated past a threshold and the burst ended, so a won battle,
an ally mobilizing, any news at all handed control back. Playing it, a campaign that should have been
one order took six, and four of them asked the player nothing. Worse, the player's *own order* was
weighed the same way, so a forceful order crossed the threshold on the day it was given and the world
never moved at all; the only way to advance the calendar was to say something unimportant.

Interesting and actionable are different things. What is merely interesting earns a Chronicle entry —
and the Chronicle now tells several threads of a span at once, so nothing is lost by carrying on.
The stops are: a decision only the player can make, somebody wanting to answer with no model call
left to pay for it, the calendar holding nothing more to wake for, or the scenario's maximum span.

Time is walked in **hops**, and a hop nobody answers costs nothing but arithmetic. Only a cognition
call spends the budget. That is what lets one order carry a forty-five-day march to its arrival
instead of creeping forward two days at a time.

An order that is not finished when it is given says what would finish it. The orchestrator sets a
**watch** — `world/watch.ts`'s closed predicate union, which had been defined for years with nothing
reading it — and the burst runs until that predicate holds (`watch_condition`) rather than stopping
at the first quiet moment. Evaluating one is free and deterministic (`sim/watch.ts`), which is the
whole reason the language is a union and not a sentence: a watch tested by a model would be charged
for on every hop of every span.

### The world elsewhere

`routeAttention` is purely reactive — it needs a triggering fact, and an actor who can see it — so
anybody with no connection to the player's order scored nothing and stayed dormant. Syracuse never
moved on Messana, Carthage negotiated with no one, and every Chronicle was a single thread about the
player, because the player was the only person in the world doing anything.

`routeAmbientActors` is the other half: a small rotating cast chosen from their **own** standing
business — an office to run, a promise outstanding, a pressure on them, a storyline they are in, a
government with stated intentions. Cognition is batched, so they ride along in the call the reactors
were already making: a living world costs prompt tokens, not model calls.

They must be told which they are. A person handed a cognition section and asked what they make of
the news, when nobody has brought them any, sensibly answers "nothing" — so `RoutedActor.impetus`
distinguishes a reaction from someone's own business, and the prompt says plainly that a month of
their own is not nothing.

Significance is still scored **by the actors, as a field on each fact they emit**, and accumulated by
code: it decides whether there is a Chronicle to write and orders the threads within it.

`DEFAULT_BUDGET`: `maxIterations 4`, `maxModelCalls 20`, `maxSimulatedDays 90`, `maxCausalDepth 3`,
`maxFocusedActors 4`, `maxAmbientActors 6`, `maxHops 64`, plus the scenario's own `maxSpanDays`.
Anything unresolved at the stop becomes a scheduled event — stable pending state, never dropped.

The number that matters for how alive the world feels is `maxIterations`: it decides how many rounds
the world gets per order, and therefore how many times the people elsewhere are asked what they are
doing. Four buys a round after the calendar has jumped, which is when a foreign king has anything
worth recording; three only ever asked him two days after the order, when the honest answer was that
nothing had changed yet.

`maxModelCalls` is no longer the same measure, and is now a runaway guard rather than a budget. A
round's cast is dealt onto up to three calls that run at once rather than one that generates ten
people's answers end to end, so a round costs three calls and the same tokens — six would have ended
the burst after its first round and lost the rest for no saving at all. The Chronicle is written the
same way, a passage per call, six at a time.

### Calls the burst decides not to make (`burst.ts`, plan §1 E)

Three, each logged in `BurstResult.skipped` and on the `[burst]` line as `skipped: cognition ×n,
reconcile ×n, repair ×n`, never silent (2026-09-25). A cognition round in which nobody is *pressing*
— no reaction, no narrator priority, no antagonist, no order or letter to answer, no thread in
crisis (`RoutedActor.pressing`) — is the rotation alone, and a burst pays for `maxAmbientOnlyRounds`
of those (one); past that the round is skipped and counts as nobody asked, so a quiet span stops at
its minimum rather than at `maxIterations`. Fact reconciliation is asked only about facts that name
what was refused (`factsNamingRefusals`: a handle or id the refused delta carries, a name it
repeats, the owner of an account it names, and for the order's own refusals the ruler and his
power); a letter refused as already answered no longer sends the whole round's facts back at a call
apiece. A repair is not spent on a refusal no correction can cure (`worthRepairing`, a deny-list
grown only from `audit:deltas` evidence, starting with the player's-purse rule). Two measuring knobs
live beside them: `CHRONICA_COGNITION_SHARDS` (how many calls a large cast is dealt onto) and
`CHRONICA_AI_MODEL_<OPERATION>` / `CHRONICA_AI_EFFORT_<OPERATION>` (one operation's model or effort,
ahead of the selected local model), with `createTimedPort` printing each operation's wall span beside
its summed seconds.

### The Chronicle (`chronicle.ts`, `chronicle-windows.ts`)

**Written in time order, while the burst runs** (2026-09-25). A burst walks time forward in hops and
the clock never moves backwards, so everything written before the clock moves is dated at or before
that instant, and nothing written afterwards can land before it. The burst hands out a
`WindowSnapshot` each time the clock is about to leave a window — the order is a window of its own,
and after that a window is cut only once a cognition round has happened, so a run of quiet hops is
one window — and `createWindowWriter` composes each window as it closes, side by side, and publishes
the passages in window order. The page shows them as they land; the commit writes the same passages
in the same order, followed by the ledger entries, and nothing already shown is ever reordered or
edited. A fact belongs to the window in which the reader could first know it, so a battle on day 5
that reaches the court on day 20 is told on day 20, as news. Each window has its own bar: the
order's answer (the one thread holding most of the order's facts and naming the reader's side) and
any battle always pass, the reader's own business must weigh at least `OWN_BUSINESS_FLOOR`, the
other bands keep their thresholds, and at most `WINDOW_MAX_ENTRIES` (three) pass beyond the answer
and the battles. What a window does not tell is carried into the next window's candidates; the last
window, which closes when the world settles, has room for six and takes whatever the pool carried to
it, and only a record that would otherwise be blank gets a closing pass. The last window waits for
nothing: a matter left by a window still being written when the burst ended stays untold, since a
second compose after the last window ran in series with it and was most of the turn's tail. A thread
the historian declines as a repeat is dropped, not printed as bare facts. The first passage reaches the player once the order has been
applied and its window composed — about thirty-five seconds on gpt-6-luna, most of it the
orchestration call — rather than when the whole turn is over.

Written only from what the player could know. The constraint is enforced by **what the historian is
handed**, not by an instruction in the prompt: a prompt asking the model not to mention secrets would
eventually be disobeyed and nobody would notice.

The same gate covers the actors' accounts. Facts were filtered from the start; the narrative lines
beside them were not, and every NPC's account of its own reasoning went into the player's record — a
Roman consul read that a Carthaginian admiral "quietly investigated whether the Roman campaign created
an opening". An account now travels with the facts it describes and is published only if one of them
is.

A burst covers a span, not a subject, so the visible facts are **split into threads** — connected
components over the people, armies and countries they name — and each thread becomes its own entry
with its own model-written title. One model call writes them all. Splitting is deterministic code:
the war the player is fighting is one entry however many sides it has, and a Carthaginian
deliberation nobody else is part of is its own. What the historian is shown is stripped of the
engine's handles first, and the prompt forbids the register that produced "the Boii now possessed
recognized war-chiefs" and "took no consequential action": no non-events, no administrative
vocabulary.

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

### Births (`births.ts`)

Every other way into `world.characters` is somebody needing a person. Nobody was ever born, so a
house without a son stayed without one and primogeniture found no heir. A birth is now rolled at the
mother's own life review in `reviewLives`, hashed on that review so a replay is the same world. It
needs a living husband by a `spouse_or_partner` tie, in the same province. The mother must be aged
15–44, and at least 450 days must have passed since her last child. The rates are the engine's (40%
a year at 20–29), not the scenario's, so saves begun before them have children too. They come to
about five children in twenty years of marriage.

The child takes the father's power, culture, faith and house. They get the parents' averaged skills
and a third of the father's standing, and both parents are recorded as parents. The eldest son is
named for his father; the others are "Second son of …" until somebody names them better. Childbed
kills 1.5% of mothers outright, or opens a peril for one whose death would be an event.

The opening world records no marriages, so nobody is born until one is made in play (`family_tie_set`,
`character_create` with `kin`, or a declared wife). A declared partner is now the player's opposite
sex; every generated person used to be a man.

---

## 5a. The world makes trouble

The world elsewhere moved, once `routeAmbientActors` existed — but only through people, and only
with what they already had. Nothing ever *started* anything. No plague fell on a quiet province, no
governor began skimming, no pretender appeared; the six pressures the scenario authored were the
whole of the drama the player had not caused. `WorldStoryline` had been modelled for exactly this —
phase, stakes, a next development — and was written by nobody, shown to no model, and worth twelve
points of ambient score.

`narrator.ts` is the other half of §32's "a world that moves on its own", built on the same pattern
as `population.ts` and for the same reason: **code decides that and where, the model decides what,
in the call it was already making.** Once per burst, before the orchestrator, it reads the ruler's
comfort — treasury runway, arrears, legitimacy, provincial order, the war and how it goes — and
decides by `stableHash` over the game and the seed's ordinal whether something stirs, of what kind
(a problem handed to a person, a thing that befalls the world, a new actor), where, how badly, and
whether in secret. The slice states it as a directive — *"THE WORLD STIRS"* — naming the target by id
and the exact deltas that would make it real, and orchestrator rule 19 makes it an obligation of the
same answer. No extra model call.

It is a dramatic director, and honest about it. A comfortable reign gets seeds more often and worse;
a collapsing one is left to collapse. The model is never told this: it sees a scale and a target,
never a motive, so there is nothing a Chronicle could expose. Trouble lands at home more often when
things are easy, but never only at home — a bonus for the ruler's own realm turned out to outscore
every quiet province abroad, so the split is rolled outright.

**What had to change for a seed to be real.** Almost all of it was epistemics, and all of it was
found by tracing a secret through the loop rather than by playing:

- Nothing could hand anyone a problem. `social_events` demands two participants and a debt has one,
  and its pressure changes were hardcoded empty. `character_pressure_set` is the arm for a
  circumstance that befalls one person.
- A private fact was born known to nobody, its author included, so a plotter could never be woken by
  their own plot. `knownToRefs` on a fact proposal is the discovery ledger's first entry, written
  with the fact — a later `discoveries` item could not have named a fact still unassigned.
- The orchestrator's `narrativeSummary` reached the Chronicle by *identity*: it was applied under the
  ruler's ref, and an account by the observer was always publishable. Attached to the visible facts
  instead, it still told the ruler what the Boii had been given and what a plotter had begun, because
  one sentence describes the order and the secret together and no gate splits a sentence. The world's
  own account is now kept for inspection and attached to nothing: the facts carry what happened, and
  the actors' own accounts still travel with theirs.
- Every scheduled event fired as public news naming nobody, so a secret's next step was an
  announcement and the router had nothing to route on. The queue's payload now carries visibility,
  weight, who knows, its subjects and its thread.
- A breach was computed and dropped at the app boundary. It is now a private fact known to the one
  who committed it — which is what an audit later discovers.
- A pressure at seventy walked up to the ruler and confessed itself, whatever its visibility.

The three bookkeeping arms — `storyline_open`, `storyline_advance`, `character_pressure_set` — are
exempt from authority outright. A thread is the world's record and a circumstance is nobody's act;
judged against the consul's office they would have been the sixth false insubordination, on the
first seed to land at home.

**The ledger lives in the world document**, not in the fact window: `listRecentFacts` had ordered
ascending under a limit, so a long game was handed its oldest hundred and twenty facts and called
them recent. That is fixed, but pacing must not depend on a window at all. A seed ignored by the
model is offered once more under the same key, then dropped; one taken up is done.

Storylines are now shown to the orchestrator (*"OPEN THREADS"*, secret ones included, for the reason
it sees every power's outlook), to their participants in cognition (*"Caught up in"*, with stakes and
what comes next), weighted by phase in the ambient router — whose reason string now says what is
pending rather than that something is — and hinted to the historian as part of a longer matter when
the observer could know of it. A thread untouched for half a year closes in the tick. The scenario's
two frozen storylines are real threads again.

**Played** (four orders, 198 days, live model, through the terminal driver, now `scripts/play-turn.mts`): three seeds. A
minor outbreak in the Marsian highlands on day 18 — province shifted, public fact, a reassessment
scheduled and fired. A grave rivalry against Manius Curius Dentatus on day 108 — the orchestrator
invented Marcus Fulvius Luscus, opened the thread under the seed key, planted a 90-point pressure,
and Fulvius then privately recruited supporters in cognition, known to himself alone. A serious
prophetic movement in Etruria on day 198, secret, its fact known only to the prophet and the movement.
Every defect was, once again, the model naming something the engine had not said it could:

- It listed `rome`, a province and the movement itself among a thread's *participants*, and the
  whole `storyline_open` was refused — which threw away the plague's thread. Things that exist but
  are not people are now dropped from the participant list; a name that is nothing is still refused.
- It wrote hyphenated local handles (`clepsina-continues-march`), because every id it reads is
  hyphenated, and lost every cognition batch of the first two orders to a rule that bought nothing.
  Hyphens are allowed.
- It named a fact's subject as `{"kind": "storyline"}`, which the party-ref vocabulary lacked.
- A scheduled event carried `"local:marsi_outbreak"` as its thread when that thread never opened.
  A handle nothing in the batch created now resolves to null, never to itself.

Also visible once breaches were facts: Hieron of Syracuse and Hanno of Carthage were recorded as
breaching when they negotiated for their own powers, because the scenario gave neither an office and
authority derives from offices. Scenario version 20 seats the King of Syracuse, the Leader of the
Mamertines and Carthage's commander in Sicily. And COUNTRIES WITH NOBODY IN THEM now names the land
each country holds, because told only that the Numidians had no army the model raised one in a
province called "numidian-kingdoms".

---

## 5b. Offices, taxes and land

Three gaps with one shape: the fields existed, a model could write to them, and nothing held them to
anything. A consul's term ended and nobody was elected. A tax could be set to any number and was
collected in full. A private citizen had no land, and no lawful way to get or improve any. Each is
now kept by code, and the model's part is reduced to what it is good at: who stands, who backs whom,
what is built on the land.

### Elections (`elections.ts`)

`termExpiresAtStep` had been on every office seat since the character system was written. The tick
learned to end terms, and then nothing followed: on day 365 the consul laid down his office, and the
republic had no consul for the rest of the game, because no one had been handed the question of an
election. The second consulship was never filled at all.

An office whose succession rule is `elective` is now kept by the calendar, at the end of every tick
(`holdElections`):

1. **The opening.** A seat that was never filled is filled at once, by the eligible man of most
   standing (`resolveEligibility` against the seat's requirements, then prestige). The player is
   never handed an office unasked; with the player as Curius, the chair goes to Ogulnius.
2. **A vacancy.** The men who could win it — eligible, not holding a seat, at least half renown — get
   an `opportunity` pressure: *the office stands vacant; he could call the Senate to an election, and
   stand himself.* That is what brings them into the next round, because `routeAmbientActors` picks
   people up by their pressures. They are told once per vacancy (the pressure id names it).
3. **The election is called** as soon as somebody puts a man forward — a `nomination` or
   `appointment` of a person, in words naming the office (`labelNamesOffice`) — or when the 30-day
   canvass runs out, or at once if there is nobody of standing to call it. The engine opens it as a
   `vote` procedure on the seat, before the office's institution, presided over by a sitting
   colleague if there is one, and announces it publicly with its polling day.
4. **Polling day** (20 days on) decides it in code. The candidates are whoever called it, whoever
   was put forward, and — if that is fewer men than seats — the Senate's own choice of the likeliest.
   Each scores `prestigeBps` plus net declared influence (the latest `SupportPosition` of each
   supporter on his candidacy: for, less against). Seats go to the top scorers; ties break by id,
   the same way every time. Winners are seated for the office's term, the election and the winning
   candidacies pass, the rest fail, and a public fact names who won over whom.

The model argues; it does not count. `political_procedure_resolve` on an election is refused — it
used to close the procedure and seat nobody, since that handler only seats the subject of an
appointment, and the engine then called the same election again. The orchestrator's rule 9 says so in
one clause: a man stands by a nomination naming the office, and the count decides.

The player may stand and win; he is simply never put forward for. A test has him beat Ogulnius on
declared backing, and another has backing carry Ogulnius past him.

**Terms.** `Office.termDays` says how long a holding lasts — a consulship's 365, null for an office
held for life. A save from before offices said so infers it: an office with a held seat carrying an
expiry, or one emptied by an expired term, runs by terms of a year. A leader acclaimed for life has
none: the Mamertine leader is elected only if his seat falls vacant some other way. Every holding of
a termed office gets its term from the day it began, however it was seated.

This found a bug in `seatCharacterInOffice`, which every appointment goes through: it never touched
the seat's expiry. A seat vacated by an expired term keeps that date, so a consul seated into it by
a vote the model resolved was unseated again by the very next tick. Seating now sets the new holder's
own term, or none.

### What the land can bear (`material/taxation.ts`)

A tax was a number the model wrote. "Double the tributum" doubled the revenue; "multiply it by ten"
multiplied it by ten, collected in full every month from a province in revolt as readily as from a
contented one. Every province carried a `taxCapacity` and a stability that were printed in the slice
and bounded nothing, and `applyTaxationDraw` — the one function that would have tied them together —
had no caller. It is deleted.

Now a power's **domestic revenue** — `tax`, `land` and `tribute` income paid into its own treasury,
with no foreign counterparty — is weighed each tick against what its held provinces can bear:

- **Bearable** is 10% (`TAX_EXTRACTION_BPS`) of each held province's `taxCapacity × stability`,
  summed. Disorder pays less.
- **Asked** above bearable is not collected: every domestic source is paid in the same proportion
  (`collectedShare`), and a `tax_shortfall` fact tells the government its collectors came back short.
- **Asked above half of bearable** (`CUSTOMARY_TAX_BURDEN`) lowers the stability the power's
  provinces settle to — a level, through the same `ProvinceTargets` a temple uses, not a one-off blow.
  4,000 bps of settling point per whole multiple of bearable past the customary, at most 6,000.
  Lower order lowers what can be borne, so over-taxing feeds on itself.

Trade is not a levy on anybody's land and is left alone; war and blockade already bound it.
Estates' yields go to private purses and are not a government's revenue.

The slice shows whoever can open the treasury one line: *asked of bearable, in words, and what
pressing does*. Without it a model triples a tax whose cost it cannot see.

Measured over a year of Roman taxation at the new scenario rates:

| Tributum | Monthly revenue | Roman stability after a year |
| --- | --- | --- |
| as authored (1 100) | 1 800 | 70% |
| doubled | 2 790 | 69% |
| tripled | 3 780 | 53% |
| five times | 5 390, falling to 1 155 | 10% |

A tax raised moderately pays; raised hard it pays and costs order; raised past what the land can give
it collapses both. The extraction rate is set so every power in the opening asks under the customary
half — Syracuse, one province carrying a city's whole treasury, is the tightest at just under it.

### Land a man owns (`material/estates.ts`)

`Holding` had been in the schema since the character system, with a legal holder, physical control,
an income source and an inheritance rule — and the scenario's list of holdings was empty. A senator
was a purse and an opinion. A private citizen ordering "I develop my estate" had no estate; ordering
"I develop this province" touched a government's province, which is a breach — and since the men and
money did not answer to him, `nobodyListens` usually meant it did not happen at all.

Two ops, both priced by the engine:

- **`holding_create`** — an estate of a band (`slight`, `marked`, `great`) in a province, for a
  holder. Bought from an account (`priceFromAccountRef`), or granted out of the public land (null).
  It yields 0.2%, 0.5% or 1.2% of the province's monthly tax capacity to the holder's own purse every
  month, and costs 20 months of that yield. A smallholding in Latium yields 40 and costs 800.
- **`holding_improve`** — works on an estate (`works` says what, in words), paid from an account now:
  0.1%, 0.25% or 0.5% of the province's capacity added to the yield, at 30 months of the addition. No
  estate yields more than 3% of its province, however much is spent on it.

The shares are an order of magnitude below a market's (3%, 8%, 15% in `standing-effects.ts`) because
an estate is a man's living, not a town's trade. The price is far below what land ever fetched —
deliberately: at twenty years' rent no senator in the game could buy a farm with everything he owned.

**Authority follows the money.** Both ops are weighed against the account paying for them, not the
province. A man buying or improving land with his own purse holds his owner's grant over it and needs
nobody's leave; improving his farm out of the treasury is spending money that is not his. A grant of
public land is disposing of the state's property, so it is weighed against the treasury of the power
holding the province: a consul, who may spend from it, grants lawfully; a private man breaches.
Developing a whole province is still a government's act.

The scenario's leading men now own estates, each at the yield `holding_create` would set for that
size in that province, so land authored and land bought are the same kind of thing: Curius's famously
modest Sabine farm (40 a month), the Genucian estates and the Ogulnian lands in Campania, Hanno's and
the Gisconids' in the African hinterland, and Leptines' outside Syracuse. The slice shows our people's
estates with their holder's id and, to whoever can open the purse it pays into, their yield.

### Income comes from something

The estates were priced by the engine, and then `income_source_upsert` let the model write any figure
into any purse. Authority is judged against the account receiving the money, and a man holds
authority over his own purse — so "he trades grain to Rome" could lawfully hand a private man five
thousand a month, an estate's engine-set yield could be rewritten to anything, and a government's
revenue could be pointed at somebody else's treasury by naming the new recipient.

Now a figure may only be written into a **government's** treasury, where the tick bounds what its
lands bear. Into a person's purse or an army's chest it is refused, and so is changing an income
whose origin is an estate or whose recipient is private, and moving an income to a different
recipient. The refusals are `reference` rejections, not the world's, so the repair pass puts the
order the right way: a person's income comes from an estate, an office's pay, a venture standing in
the world (`generic_entity_create` with an income effect), or a payment somebody makes him
(`obligation_upsert` naming him as recipient). Updating an income also no longer resets its origin
to "polity", which quietly turned an estate's yield into state revenue.

### A merchant's trade (`material/ventures.ts`)

A declared merchant got a purse and nothing else. Trade was an income with a label; he could not own
a ship without breaching his whole country's military authority, and one raised for him came out as
four hundred infantry; lending his own money to his own government was recorded as a breach of its
treasury; and the only thing that could cut his trade was a blockade of any port his country held,
anywhere.

- **`trade_venture_open`** puts money into trade between two provinces (each must have a town). The
  engine sets the monthly return — 0.3%, 0.8% or 1.8% of the *poorer* province's tax capacity, since
  trade is no richer than its thinner end — and a price of 15 months of it: faster to pay back than
  land, and riskier. A venture between two ports goes by sea. The far end's power, if foreign, is
  the income's counterparty. **`trade_venture_close`** winds it up; the capital is not returned.
- **What stops it.** A war with the counterparty (the same cut every foreign revenue has), or an
  enemy fleet — at war with the owner's power — off *either of its own ports*. A fleet off some other
  harbour of his country no longer touches him; the polity-wide blockade still applies to a
  government's own trade. Stopping and resuming are each a fact his side knows, and
  `TradeVenture.interruptedBy` says why.
- **His route is his business.** Both ends of every running venture join his station's provinces,
  and the attention router counts news there as *"it happened where their trade runs"*.
- **Ships of his own.** `force_create` takes a `categoryId` from the scenario's troop categories
  (`warship`), and a force paid through an obligation on a *person's* purse is weighed against that
  purse, not the state's army. A purse's owner holds a latent command grant over it
  (`owner:…:company`) — command of men his own money pays — which reaches nothing else, and which the
  station's list of powers leaves unsaid, because owning a purse is not leading men.
- **Lending.** A `loan_open` whose lender is a person is weighed against the lender's purse when the
  lender is the one acting; taken by a government's official, it is the borrowing that is judged.
- **Project income.** A project whose outcome is an income may not pay a private purse (a private
  work that pays is a building with an income effect), and what a finished one pays a treasury is
  capped at a great market's share (15%) of the province it stands in.

### A man in the ranks

A force was a commander and headcounts. So a man commanded an army or was nowhere in it: a player
who declared himself a legionary was handed four hundred retainers and made their commander, only
commanders rolled for their fate in battle, nobody near him had reason to notice him, and there was
nothing to desert. `Force.memberCharacterIds` now names the people serving in its ranks.

- **Declaring.** A role naming soldiering (`soldier`, `legionary`, `hoplite`, `rower`, `mercenary`
  and so on — `RANKS_ROLE_WORDS`) enlists the player in an army of his own power, the one where he
  stands or else the largest, and puts him where it stands. A role that also names a command ("a
  veteran centurion") still commands.
- **Battle.** `memberFates` gives each named man his own fate from his army's actual losses: killed
  as often as the men around him died, wounded as often as they were, and three in ten of the
  wounded maimed with an `INJURIES` entry. The roll is hashed from the battle and his name, outside
  the resolver's random sequence, so replays match and no existing battle changes. A soldier's fate
  is a fact known to his own side — named with his army's polity, since a polity fact is known only
  to those whose polity it names — and the battle account the historian reads lists every named man
  and what became of him.
- **Death and promotion.** A dead man is struck from every army's ranks, and a dead commander is
  succeeded from his own ranks first — which `killCharacter`'s comment had always claimed and could
  not do.
- **What he sees.** The army he serves in is in his station's `forceIds`, so its strength, morale and
  whereabouts are his to see and it is his own business in the Chronicle. Its chest stays the
  commander's.
- **Who notices.** The attention router scores nearness for the first time: an army of one's own
  involved (+20), a comrade in the same army touched (+25), news happening where one stands (+15).
- **Enlisting, discharge, desertion.** `force_membership_set`. Taking service is nobody's authority
  to grant. A discharge is the commander's. A desertion is a breach — of the deserter only; written
  by whoever is telling the world's story about someone else, it would have been recorded as the
  teller's, the tenth way this check could manufacture insubordination — and marks him `deserter`,
  with a fact his side knows and his army is named in, which brings his commander to it.

"I fight bravely in the front line" still changes nothing: courage is not a premise a battle weighs.

### The economy they run in

Measured against the engine's own wage rate — 0.075 a man a month, so a 4 000-man legion costs 300
— Rome's 920 a month left one new legion eating most of its surplus. Scenario **version 27** roughly
doubles every power's revenue (Rome to about 1 800: the tributum, the allies' contributions and the
public land) and gives every power thousands in its chest: the Mamertines go from 600 to 2 500, with
strait tolls that now pay their soldiery. That retires a built-in crisis — they used to run dry in the
eleventh month — and `unpaid-armies.test.ts` now sets up the broke garrison it tests.

Version 27 also carries the consulship's term and the estates. Running saves stay pinned to their own
version and keep their old economy and empty land; elections (with the inferred term) and the tax
ceiling apply to them anyway.

---

## 5c. Every station a person can hold — the plan

**Status, 2026-09-24: all eight phases are built** (uncommitted, branch player-as-a-character). What
landed, and where it differs from the plan below:

- **Phase 4.** `Character` has `legalStatus`, `gender`, `ownerCharacterId` and `peculium`. Scenario
  faiths are named and set on every character. The player's declared faith, age (worked out at
  declaration), gender and status are kept, and a declared slave gets no office and no command.
  `legal_status_set` covers freeing (the owner becomes patron), selling, a peculium, and enslaving
  only someone already captive. `notHisToSpend` refuses a slave's spending without a peculium, and
  a slave leaving without leave is recorded as a public runaway. Offices require free birth and
  male, the Vestals female. `character_create` takes `gender` and `legalStatus`.
- **Phase 5.** `service_contract_open` and `service_contract_close`, stored in `material.contracts`:
  - The advance is paid up front, and the monthly pay is a salary obligation. The contract lapses
    on the first missed month (`contracts.ts`, run each tick).
  - A mercenary company answers to whoever hired it. An envoy holds a delegated `negotiate` grant
    for the length of the contract.
  - A tax farmer pays for the farm and takes the province's customary share, and his take counts
    against the tax ceiling.
  - Walking out before the term costs 300 standing and the employer's trust.
  - Healing is capped at 500 without a physician. With `physicianRef` the engine rolls on the
    physician's learning.
  - Not built: an engineer's skill setting a project's pace, and a gladiator's games feeding
    standing.
- **Phase 6.** Plot kind `espionage`, outcome `learned`. A success writes a private report and
  beliefs to the sponsor: the target's secrets, intentions, commands, purse and relations, all of
  them on a full success. A failure is a public "spy caught".
- **Phase 7.** Personal narrator seeds (below). `isOwnPurseGrant` stops a person's own purse counting
  as authority in attention routing; a private man rides the ambient rotation below anyone with
  business. Successors are offered by closeness, with office holders last. The prompt says "the
  player", not "the ruler".
- **Phase 8, done differently.** `Force.outlaw` rather than a nullable `polityId`: about sixty
  readers of a force's power would each have needed checking. An outlaw band:
  - is its own side in battle, and fights with no war declared
  - raids its old country
  - is reached by no government's grant
  - can only be raised with a private purse
  - comes from a garrison going outlaw through `force_modify`, which is public news.
- **Prompt:** held at 63 000 by naming `Money`, `SignedBps`, `Name` and `Days` once. The slice
  ceiling moved to 14 700 for faith.

Built earlier the same day:

- **Phase 1** is `apply/own-business.ts`, consulted before the authority test. A letter of one of
  the personal kinds (letter, congratulation, warning, protest, marriage offer) in the writer's own
  power's name is never a breach, whoever it is addressed to. Foundations need no land of their
  own: what makes one private is that its keep comes out of the founder's purse. An arrangement's
  upkeep is now weighed against the account paying it, and needs the power to spend from it.
- **Phase 2** is `standingCause` on `character_state_set`, clamped per cause by
  `characters/standing-causes.ts`. The engine's own shifts (battle ±400, election +500) stand
  outside the clamp.
- **Phase 3** is scenario **v28**:
  - Each office has a `kind`, `seatCount`, `rank`, `cycleDays`, `vetoes` and
    `enrolsFormerMagistrates`.
  - New requirements: `min_age`, `held_office` and `not_held_within_years`.
  - Waivers live on `Character.eligibilityWaivers`, and tenure on `Character.officesHeld`, which
    `recordTenures` writes each tick.
  - A college bigger than the men it names is elected whole, once a cycle. Places nobody named
    wins go quietly to men of no note.
  - A man presiding over an election beneath him does not stand in it.
  - Rising lays down magistracies only.
- **Beyond the plan, at the user's request:**
  - A march of more than one province becomes a journey project automatically (8 days a
    province).
  - An order that nobody had to obey is carried out anyway when the one it depends on is kin, or
    thinks well enough of the man asking, or wanted it already (`listensAnyway`). It still breaches.
  - The narrator adds personal seeds (`personalSeeds`) beside the country's, measured on the
    player's purse, debts, health, standing and enemies. They land on him, his circle, or the
    ground he lives off.

Where it says "the restrictiveness work", it
means the concurrent session that is building `standing_shift`, `family_tie_set`, `character_death`,
civil strife between forces of one power, office and institution reform, re-election and the
`abroad` case in `nobody-listens.ts`. This plan uses those and doesn't rebuild them. A phase that
depends on one waits until it has landed.

### What a survey of 28 roles found

- **Work:** consul, general, soldier, merchant, landowner, anyone ordering an assassination.
- **Partly work:** king or chieftain, pirate, mercenary captain, rebel or pretender, banker,
  philosopher (through an academy), priest (through a temple), craftsman, envoy.
- **Broken:**
  - senator and every magistrate below consul (the scenario has four offices in all)
  - pontifex, augur, Vestal (no priesthoods, and `faithId` is null on every character)
  - spy (no way to learn anything)
  - tax farmer (no contract to collect for the state)
  - physician (healing is a free `healthDeltaBps`)
  - poet and historian (standing can't move)
  - engineer, gladiator, peasant (no contract to be hired under, and nothing to do)
  - slave and freedman (no legal status)

The finding that matters most is that **ordinary private life goes on record as insubordination.**
`actorIsAnswerableFor` weighs a private man's talk, letters and foundations against his whole
power's authority, and he holds none of it. So a philosopher teaching or a senator speaking is
logged as a breach.

The eight mechanisms below are general. None of them is a patch for one role, and each phase can
ship on its own.

### Decisions settled with the user

| Question | Answer |
|---|---|
| Scope | All eight mechanisms, staged |
| Overlap with the restrictiveness work | Build on theirs; wait where it's shared |
| Which powers get real offices | Every power |
| Career ladder | Historical order, minimum ages and the ten-year gap before holding an office again, all checked in code; a passed law or a dictator can waive them |
| Senate, council of elders, the 104 | An office with many seats, held for life. Only named characters hold seats; the rest of the body is implied |
| Tribune's veto | Friction only: a fact and a line in the slice, with no code block |
| Standing | The model proposes an amount; the engine clamps it according to the cause |
| Legal status and gender | Code enforces three things: office eligibility, an owner's say over a slave, and manumission |
| Service contracts | An optional advance at signing, plus monthly pay made by the engine |
| Spying reveals | Secret facts, intentions, forces and money, relations: all four |
| Narrator and the player | **The same as NPCs, death included.** This overrides the "lenient" line in the 2026-09-19 plan |
| Private sphere | Speech and opinion, letters, one's own foundations, one's own household |
| Outlaws | A force with no polity, owned by a purse |
| Physician | Healing is a deterministic roll on skill, and the model no longer writes it |

### Prompt budget

The prompt budget comes first, because it rules out the obvious way to do this. The feedback rule
stands: no per-role paragraph in the orchestrator prompt. Across all eight phases the plan adds
**three ops**:

- `legal_status_set`
- `service_contract_open`
- `service_contract_close`

Everything else is one of these:

- **Data:** offices, eligibility requirements, faiths.
- **A new value in an existing enum:** the `espionage` plot kind, and standing causes.
- **An engine rule with no op.**

Each new op becomes a clause under the principle it belongs to. Contracts go under *pay*, legal
status under *standing*.

The slice ceiling of 14 500 is the tighter limit. There will be many more offices, so the slice
shows an office only when the viewer holds it, is eligible for it, or is in a procedure about it.

### Phase 1 — A private sphere

*Depends on the `abroad` check landing, since both edit `actorIsAnswerableFor` and `nobody-listens.ts`.*

One predicate, `isOwnBusiness(delta, actor, world)`, is consulted in `actorIsAnswerableFor` before
any scope by polity. When it's true, the act is judged against the actor alone. It is true for:

- **Speech and opinion.** `social_events` and `belief_set` where the actor is the speaker, and
  `political_support_set` inside a body the actor sits in.
- **Letters.** Writing to anyone. The recipient decides whether to answer, through their own
  cognition. This makes the access ladder's promised "you may always write" step real. Today it
  has nothing behind it.
- **The actor's own foundations.** `generic_entity_create`, `holding_create` and structures, when
  they are paid from the actor's own purse and stand on land the actor holds or buys in the same
  answer.
- **The actor's own household.** Their slaves (Phase 4), their clients, their family, and anyone
  hired under a contract with them (Phase 5).

It is still false for anything whose instrument answers to someone else. A private man founding a
school on public land, or paying for it from the treasury, is judged as before.

**Tests:**
- A philosopher teaches.
- A senator speaks against a motion.
- A private man writes to Hieron.
- A matron endows a shrine.

Each of these must produce zero breach facts. The negative case must still produce one: a private
man paying for his school from the treasury.

### Phase 2 — Standing that moves

*Depends on `standing_shift`.* This phase adds only the cause table and its feeders.

The model names a cause and proposes an amount. The engine clamps the amount to that cause's ceiling
and scales the ceiling by the size of the event:

| Cause | Ceiling (bps) | Scaled by |
|---|---|---|
| victory in the field | ±1 500 | enemy strength engaged |
| triumph or ovation | +1 000 | once per victory, and only after a victory |
| games given, public works | +800 | money spent against the giver's own standing |
| office held, priesthood entered | +500 | rank of the office |
| patronage, a client won | +300 | the client's standing |
| literary or learned work | +400 | learning skill |
| scandal, bribery exposed, defeat | −1 500 | a fact must exist first |

The bands are a first calibration. Tests pin them. Scaled by one's own standing means the same games
lift a nobody more than they lift a Curius.

`ELECTABLE_MIN_PRESTIGE_BPS` stops being one global 5 000. It becomes a `min_prestige` requirement on
each office: quaestor 3 000, aedile 4 000, praetor 5 000, consul 6 000, censor 7 500. That lets a
declared player, who starts at 3 000, stand for the first rung.

### Phase 3 — The real offices, for every power

*Depends on the other session's office and institution reform and re-election, since both change
`elections.ts`.* The office list itself is scenario data, which is **v28**.

Every power in the scenario gets offices:

- **Rome (264 BC):**
  - Magistrates: quaestor (8 seats), aedile (2 curule and 2 plebeian), praetor (1), tribune of
    the plebs (10), censor (2, an 18-month term, every 5 years), dictator (6 months, named by a
    consul and never elected).
  - Senate: a membership office.
  - Priesthoods: pontifex maximus and the pontifices, augurs, 6 Vestals.
- **Carthage:** two suffetes (annual), the council of elders and the 104 (both membership offices),
  and priesthoods of Baal Hammon and Tanit. The strategos stays.
- **Syracuse:** the king's council (membership), strategoi, and the priest of Olympian Zeus (annual).
- **Mamertines and the Campanians of Rhegium:** a meddix and an assembly.
- **Tribal polities:** one shared template of chieftain, council of elders and priest.

**How a seat is filled** is recorded per office through `successionRuleId`:

- Popular election: the elections that already exist.
- Co-optation: augurs and pontifices. The college's members choose, decided on the same prestige-and-support rule.
- Appointment: Vestals, chosen by the pontifex maximus. A dictator, named by a consul.
- Enrolment: the Senate. Censors enrol members through `office_seat_set`, and at the end of a
  term the engine seats every former magistrate who isn't already in.

**The career ladder** needs new eligibility requirement kinds: `min_age`, `held_office` (the
required earlier rung), `not_held_within_years` (the ten-year gap), `legal_status`, `gender` and
`faith_membership`.

- The waiver is a resolution clause on a passed law, using the reform machinery the other session
  is building, or an act by a sitting dictator. Either writes an `eligibility_waiver` onto the
  person for one office and one term.
- The engine keeps dropping sitting holders from their own election. Re-election belongs to the
  other session.

**Veto:** a tribune who intercedes writes a public fact onto the procedure, and the slice shows
"vetoed by X" beside it. Nothing in code stops the vote. It's friction the model is expected to
honour, and a vote that goes ahead over it is a scandal feeding Phase 2.

**Priesthoods** grant sacral acts through `authorisedActionIds`: taking the auspices (which can
delay a procedure the way a veto does), `belief_set` over the faith, and temple funds. They need
`faithId` set, which Phase 4 provides.

### Phase 4 — Legal status, gender, faith and age

- `Character` gains three fields:
  - `legalStatus`: `free` | `freed` | `enslaved`
  - `gender`
  - `ownerCharacterId`: a slave's owner, or a freedman's patron.
- Scenario v28 defines the faiths and sets `faithId` on every character.
- `player-materialization.ts` stops overwriting what the player declared. It keeps faith (resolved
  against the scenario's faiths), age (read from the declaration and clamped between 14 and 80),
  gender and status.
- Declared family is the other session's to investigate.

The engine enforces three gates:

1. **Office eligibility.** Free (or freed, where the office allows it), male, a citizen of that
   power. The Vestal is the exception and must be female.
2. **An owner's say.** An enslaved actor's purse, movement and contracts answer to the owner in
   `nobodyListens`. The owner can grant a *peculium*: a latent grant over the slave's purse, of the
   same kind a merchant's company already uses. Without one, a slave spending "his" money is
   refused, the same way a private man ordering a legion is.
3. **Manumission, through the new op `legal_status_set`.**
   - The owner frees the slave, who becomes `freed`. The patron tie is kept and a relation cause
     is written.
   - Enslavement comes only through capture in battle (`memberFates`), abduction, or a judicial
     sentence. It needs an existing fact, and the model can't simply write it.

### Phase 5 — Service contracts

The new ops are `service_contract_open` and `service_contract_close`. They are stored in
`material.contracts` with these fields:

- employer account
- employee character
- role
- advance
- monthly pay
- term in days
- duties (text)
- what's still owed

The engine behaves like this:

- **Signing.** The advance moves when the contract is signed, and has to be affordable.
- **Pay.** Monthly pay runs as an income source from employer to employee. Contracts become the
  fifth lawful source of private income under the *income comes from something* rule.
- **Missed pay.** When the employer can't pay, the contract lapses and the employee gets a fact
  saying so.
- **Walking out.** Leaving before the term ends is a breach by whoever walks. It writes a trust
  cause and a Phase 2 scandal.
- **Authority.** While the contract runs, the employee holds a grant scoped to the role, and the
  grant ends with the contract.

What the grant does, by role:

| Role | What the contract does |
|---|---|
| mercenary captain | the employer controls the force; pay comes out of the contract, not the war chest |
| hired assassin | the plot is `commissionedBy` the employer. Exposure lands on both |
| envoy | a grant to negotiate for the employing power, limited to the named counterpart |
| engineer | project pace reads the engineer's stewardship and learning |
| physician | may make healing rolls on the employer's household (below) |
| tax farmer | collects a province's tax for a fixed sum paid to the treasury and keeps the surplus. The tax ceiling applies to *his* demand, and the stability cost falls on him in standing |
| gladiator | fights at games; games feed Phase 2 for the giver and for the victor |

**Healing** becomes an engine roll. `character_state_set` loses the ability to add positive
`healthDeltaBps` unless the actor is the engine. A physician's treatment is a roll, by `stableHash`,
of learning against the severity of the open peril. The model writes that he treats the patient;
the roll writes the result.

### Phase 6 — Spying

- `espionage` joins `CovertPlotKindSchema`. It runs on the existing plot machinery: the intrigue
  skill, the time the plot takes, the chance of exposure.
- A success writes one report fact, visible to the spy and whoever commissioned him. It contains
  all four things the user asked for:
  - facts the target knows privately (the spy is added as a knower)
  - the target's current intent, ambitions and pressures
  - the true strength and position of the target's forces, and their treasury or purse
  - the target's strongest relations
- Failure exposes the spy: a relation cause against him and a Phase 2 scandal.
- This is also where the map overlay's leak becomes a feature rather than a bug. Once the
  restrictiveness work filters the overlay by station, spying is how a person gets to see past it.

### Phase 7 — The world reacts to minor stations

*Depends on the restrictiveness work's account of how the narrator's drama is measured.*

- Remove the `character.id !== input.playerCharacterId` exclusion at `narrator.ts:604`. At the
  user's choice, the player is a narrator target exactly like an NPC, death included.
  - Death still comes only through `mortality.ts` perils, which stay open long enough to be acted
    against, or through `character_death`.
  - The succession flow for a dead player already exists.
- The narrator's tension is measured on the person, not the power. For a private man that means
  his purse, his debts, his relations and his health, not Rome's treasury.
- Prompts stop calling the player "the ruler".
- A purse doesn't count as holding power. The owner grants that come from `owner:<account>` make
  nobody a figure of the state in attention routing, in the access ladder's peer test, or in the
  succession offer list.

### Phase 8 — Stateless forces

- `ForceSchema.polityId` becomes nullable. A null polity means the force answers only to the purse
  that pays it, through the latent company grant the merchants already use.
- Such a force:
  - can engage anyone (no same-side rule applies)
  - can raid, through `force_raid`
  - can be at sea, through a naval `categoryId`
  - can be hired under Phase 5
- Powers whose coasts it raids hold it as an enemy without any declaration.
- **The risk is every reader of `force.polityId`.** There are many (battle sides, taxation, the
  slice, the map overlay), and each one has to be audited for null. This phase goes last for that
  reason.

### What each role gets, and from which phase

| Role | Phases |
|---|---|
| senator, magistrate | 2, 3 |
| pontifex, augur, Vestal | 3, 4 |
| philosopher, poet, historian | 1, 2 |
| matron | 1, 4 |
| banker, peasant | 1, plus existing loans and estates |
| slave, freedman | 4 |
| spy | 6 |
| tax farmer, engineer, physician, gladiator, envoy, hired assassin, mercenary captain | 5 |
| pirate, bandit, freebooting admiral | 8, 5 |
| every minor station | 7 |

### Saves and verification

- Phases 1, 2, 5, 6 and 7 apply to running saves.
- Phases 3 and 4 (offices, faiths, status) need scenario v28, so they reach only new games.
- Phase 8 needs a migration default of `polityId` kept as it is.

Each phase gets one story test in the house style, for example:
- `a-quaestor-climbs.test.ts`
- `a-philosopher-teaches.test.ts`
- `a-slave-is-freed.test.ts`
- `a-contract-goes-unpaid.test.ts`
- `a-spy-comes-home.test.ts`

Per *bugs only play finds*, each phase is also played live once as its role before it's called done.

---

## 5d. The world invents mechanics, and the engine runs them

Built 2026-09-25 (plan §2 of `docs/plans/what-the-engine-cannot-do-yet.md`). VISION §1 says the AI
"can dynamically create mechanics or entities when the evolving world requires them". It could create
entities; an act that fitted no op was kept as an arrangement whose effects came from a closed list
of ten quantities, and a pursuit did nothing. Now an arrangement can carry a **rule**
(`GenericEntity.mechanic`, `packages/shared/src/world/mechanic.ts`): a trigger (each month, on a
kind of fact, or when a condition first becomes true), up to three conditions, one to four effects
and an end (a term, a condition, the owner's death, or never). Conditions are the watch's own arms
plus a mechanic's (a province's level, a purse, a relation, a power's trust, a war, an army's
strength), in one union read by one evaluator (`sim/watch.ts`); the orchestrator's `WatchPredicate`
is untouched, so the prompt does not grow. Effects are templates over five ops the applier already
runs — money moves, a province's level, legitimacy, a power's trust, a relation — with every sum a
band of the arrangement's scale or a share of a value the engine reads at firing, clamped per firing
(`mechanicWorth`), per purse (a tenth) and per burst (`MECHANIC_MAX_DEBIT_PER_BURST_BPS`, fifteen
percent of what a purse held when the burst began).

**Written once, by a separate call.** Every arrangement set going that is not a law — kept,
floored as a pursuit, or authored — is a candidate (audit `mechanic_candidate`). While the burst's
`maxMechanicCalls` allows (two by default, counted apart from `maxModelCalls`), `write_mechanic`
asks for the rule with the act, the owner's slice or portrait, and the list of ids the engine can
read for that arrangement (`mechanics/refs.ts`), which is also exactly what the validator accepts.
The engine validates it (`validate-mechanic.ts`), prices it — the model names a setup and a keep,
the engine clamps them into bands of the province's tax capacity and folds the keep into the
entity's own upkeep so `settleStandingEffects` charges and lapses it as before — and attaches it
with nothing due at once. A refused rule leaves the plain arrangement (`mechanic_refused`).

**Debits need a warrant.** A rule may take from an account its owner does not control only on a
basis found when it is attached and stored on it: the owner's authority over the treasury
(`checkAuthority`), an active contract in which the payer pays him, or the purse being his own. At
every firing the warrant is checked again (`mechanic_warrant_lapsed` when it no longer stands), and
`ApplyContext.firingMechanic` — settable by no schema the model writes — is what lets a warranted
debit past the player's-purse rule and the authority gate, and nothing else.

**Run by code.** `runMechanics` runs from the burst's `tickTo` after the deterministic tick, in
entity-id order, through `applyDeltas` with the full context the tick lacks. A monthly rule keeps
its next due day and never catches up a period whose conditions failed; a `when` rule keeps its last
reading and fires on the edge, as a contingency does; an `on_fact` rule sees each fact once. Every
firing writes a `mechanic_fired` fact private to the owner and to anyone whose purse it touched, and
a transaction row with `cause.kind "mechanic"` that the character panel shows. A rule that fires and
does nothing three times running is retired with a fact. A reuse path was built with it -- a rule
whose ids all cut to slots, stored by the arrangement's normalised kind and the rule's `stableKey`
and refilled for the next arrangement of that kind at no call -- and removed the same day: over the
corpus and a played campaign no two arrangements of one kind shared a rule (0 of 8 written), under
the plan's five percent line. `shapeKey` stays on a rule as its fingerprint.

Measured by `scripts/mechanic-rate.mts` (a played game) and `scripts/eval-orders/let-time-pass.mts`
(two years of nothing on an eval chain's world); the eval corpus gained a toll, a dole, a school, a
racket and a tithe.

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

### The second pass, played the same way

Every defect the second pass found was found by playing, and none by reading. The pattern held: the
loop was never wrong; the slice failed to show something, the prompt failed to say something, or
authority was asked a question it had no business answering.

- A Senate was shown without the blocs inside it, so the model recorded the Senate itself as a
  supporter — a Senate is a room, not an opinion. When it then named the right blocs, a voting bloc
  was not accepted as a supporter at all, though the blocs are precisely what decide a motion.
- Nothing told the model what this world's sums look like, so a tax worth eighty times the whole
  treasury read as ambition rather than a misread of the units.
- Revenue was banked from a measure still before a council.
- A forced march ran its milestones, reported itself complete, and left the army where it began.
- A merchant generated to lend the state money had an empty purse, so the loan was refused by the
  very person invented to make it.
- An intelligence mission finished and reported that findings had been transmitted. What a rival
  privately intends is not a fact anyone wrote down, so there was nothing to discover.

Afterwards, the same five orders run clean. A tax goes before the Senate with the patrician bloc
against it and the popular bloc behind it and no revenue banked until it carries; merchant credit
comes from a creditor the world invented and made rich enough to lend; two legions are raised by
projects that produce real forces; a forced march puts the army in the Middle Padus and the engine
resolves the battle there — 490 Roman casualties against 681 Boian, the host broken and streaming
into Etruria, its chief wounded; and a falsehood about Roman intentions is planted in Hieron's head,
privately, where his own cognition will read it.

---

## 13. What the world can now do that it could not

A second pass closed eight gaps between VISION.md and the engine. They shared one shape: in almost
every case **the data model already existed and was orphaned** — written by nobody, read by nobody,
reachable by nothing. What was missing was plumbing, so none of it cost a model call. The burst still
runs on two to four.

**Minds were never shown to their owners.** Every character carried drives, a temperament, a risk
tolerance, values, taboos, skills, ambitions and directed relations from the start, and cognition
printed none of it. An NPC was told their office and what they knew, and nothing about who they were,
which produced uniformly sensible strategists in a world containing timid, greedy and vengeful
people. Their section now says what they are like, what they want, what they can reach — with the ids
they would need to reach it — and how they see the people in front of them. Beliefs are filtered to
the ones still active and carry kind and confidence, so a half-credited rumour no longer moves
someone like an eyewitness account.

**Countries had no minds at all.** A polity was a name, a capital and a trust score. `polityOutlooks`
holds §11's standing objective, concerns, intentions and risk tolerance, rewritten as circumstances
change. It is secret: the orchestrator sees every outlook because it *is* the world and must drive
Carthage consistently with Carthage's own aims; nobody inside the world sees another power's. That is
what gives intelligence work a prize.

**A government could not be judged on anything.** §6's "political stability 71/100, senate support
63/100, 18,400 available manpower" was modelled in full and completely dead — not in the slice, not
reachable by any delta — so doubling taxes on the wealthy cost a government nothing but a sentence.
Five slice sections and six deltas reach it now, and the legitimacy and province helpers that had
been written, tested and never called are called rather than reimplemented. Support positions are
append-only, so the council's arithmetic takes each supporter's latest position once; summing the
rows would let one waverer outweigh a chamber.

**Projects produced nothing.** §8's naval expansion could run its milestones, spend its money, reach
its completion date and yield no ships. `completionWorkflowId` named an execution engine deleted with
the turn system and `linkedEntityIds` was never written. A project now declares its
`completionOutcome` when it is invented, and the tick creates the fleet, the fortress, the revenue or
the army's arrival on the day the last milestone falls. An outcome whose commander has since died
produces nothing rather than an invalid world.

**Arrangements were write-only.** A law the world invented was recorded and then invisible to the
model that created it. They are listed, changed through `generic_entity_update`, and kept on the
books when repealed, because a law's effects and its enemies outlive it.

**There was no such thing as debt.** Every amount is non-negative and the tick floors balances at
zero, so a treasury simply stopped at nothing and nobody was owed anything — §20's chain from
merchant credit to political concessions had no mechanism behind it. A loan is a liability record;
servicing is an ordinary obligation, so arrears, priority and missed periods behave exactly as they
do for army pay, and a debt crisis is modelled by whatever models an unpaid army. Its priority sits
below army pay, because a state short of money starves its creditors before its soldiers, and that
choice is what causes the crisis.

**Nothing could learn a secret or tell a lie.** §14's substrate was all there and no mechanism
reached it. A proposal carries `discoveries`: a fact already on record becomes known to a named
observer, after however many days the news takes. The fact is amended in place rather than
duplicated, because two records of one event with different audiences is how a Chronicle reports a
thing twice. `belief_set` is the other half — a belief is never checked against reality, so a planted
falsehood is exactly as storable as an eyewitness account.

**Two armies in the same field could not fight.** A complete, tested, deterministic resolver had sat
in `packages/shared/src/warfare/` with no callers at all. `force_engage` is the one delta whose
outcome its author does not decide: the model says who engages whom and how they mean to fight and
may propose a tactic the engine can refuse; casualties, morale, retreat, capture, death and ground
are the engine's, seeded from the burst so a replay fights the same battle. A model permitted to
author its own casualties would win every battle it cared about.

Unpaid wages finally reach the army they pay for, which is what makes the debt crisis a military one.

### The honest limit on §9

A dynamically created mechanic is **persistent, visible, and applied by the model** — not
deterministically simulated. The engine records the LEX AGRARIA and shows it back; the recruitment
pool it improves moves because the model moves it. Making the tick interpret arbitrary attributes
would be a second, weaker way of changing the world beside the delta union, and the union already
covers anything the model wants to do.

---

## 13a. What is still deliberately not done

- **Sieges and attrition.** Battles resolve; `SiegeOrControlChange` is an output shape, not a system,
  and there is no starvation clock or blockade.
- **Trade as geography.** An income source names the power it depends on, so a war can cut it. There
  are still no routes, no goods, and no prices.
- **Courage.** A man in the ranks shares his army's fortune, but how he fights is not weighed: a
  battle judges tactics by premises about the field, and bravery is not one.
- **Goods and prices.** A venture has a return, not a cargo: there are still no goods, no prices,
  and no piracy aimed at a particular route (the narrator's pirate seed is placed by country).
- **Estates beyond their yield.** An estate pays and can be bought, granted, improved and inherited.
  It does not yet feed the province it stands in, raise men, or carry debts of its own.
- **Multiplayer.** The burst assumes one sovereign. Multiplayer reintroduces exactly the
  turn-synchronisation problem §15 exists to avoid.
- **Games created before this work.** Their state lived in the dropped `world_snapshots`; they were
  deleted rather than half-resurrected. Worlds written at schema version 2 are likewise not carried
  to 3: they were playtests, and are recreated.
- **A death the world decides.** No delta sets `alive: false`, so the narrator never seeds a sudden
  death; a `character_death` arm is the follow-up.
- **Pirates and pretenders as their own power.** A new actor is filed under the polity whose land
  they rise in, because `force_create` needs a polity that exists. A `polity_create` arm would let
  them be a power of their own.

---

## 14. Known risks

**Prompt size and slice content, not loop logic.** `buildWorldSlice` is where this design succeeds or
fails. The system prompt is ~8,700 tokens (mostly the generated JSON schema, identical every call and
therefore cacheable) and the slice is ~1,050 on an opening world — both guarded by assertions in
`prompt-smoke.test.ts`, on the rule that a section which pushes past the budget gets its cap
tightened rather than the budget raised. Whether the slice carries *the right* bounded subset for a
given order remains the thing most likely to need iteration. Every defect in §12 was a slice or
prompt problem; none was a loop problem.

**Cognition has no repair retry, and a batch answer is all-or-nothing per actor.** A live run
returned four of six actors as strings rather than objects, and those four reactions were simply
lost. Orchestration repairs once because a failed orchestration means the player's order goes
unanswered; a failed cognition only means nobody reacted that iteration. Whether that trade is right
at six actors, rather than one, is untested.

**A seed the model narrates rather than carries out.** The narrator's pacing is unaffected — the
ledger records the offer either way, and an ignored seed is re-offered once — but the incident is
lost. Rule 19 states it as an obligation of the answer; whether a live model honours it is, like
every prompt question here, only provable by play. The system prompt ceiling moved from 42,000 to
48,000 characters for the three new arms, under the test's own rule that it moves for a genuinely new
capability and for nothing else.

**Burst duration against request scope.** A burst no longer runs inside the request that carried the
order (2026-09-25). The request prepares it — loads the world, checks the guards, opens the
`simulation_bursts` row — and hands the job to `apps/web/lib/burst-runner.ts`, which finishes it
after the response has gone (`after()` from `next/server`), in the same process, with its own pool.
The route answers `202 {burstId}` and the page polls `/api/games/<id>/bursts/<burstId>?after=<n>`,
which returns progress lines and the passages of the record written so far from `burst_progress`
(migration 0039). A running burst heartbeats every 20 s; a row that has not beaten for 90 s is
abandoned, reaped by the next order's preparation together with any coin hold older than six minutes
(`expireStaleHolds`), so a dev server killed mid-turn frees the game and the coins without waiting
fifteen minutes. A decision is closed in the same transaction as the world that heard the answer.
`scripts/play-turn.mts` runs the same two functions from a terminal, which is how turns are timed
without a browser session (`docs/plans/simulation-speed-baseline.md`).
