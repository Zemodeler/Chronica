# What the engine cannot do yet

A brief for the next stretch of work on `player-as-a-character`.

**The main focus is two things: simulation speed (section 1) and invented mechanics (section 2).**
Section 3, the prompt ceiling, is there only to make room for section 2. Sections 4 and 5
(competence, and people who plan) are secondary: do not start them until sections 1 and 2 meet
their "done when". If time or prompt space runs short, they are what gives way.

Each section says what is true today, what to build, and how to know it is done.

Read `docs/VISION.md` §1, §7, §10, §13 and §20 and `docs/SIMULATION-LOOP-V1.md` first.

## Ground rules

These were earned the hard way; ignore them and the work will look finished and not be.

- **Rewrite, never shim.** When a piece of the old shape is in the way, change it or delete it. Do
  not wrap it.
- **No per-feature rules in the orchestrator prompt.** Fold anything new into one of the existing
  principles. The prompt is at 63,000 characters against a ceiling of 63,000 (`prompt-smoke.test.ts`).
- **Decide it in the engine, not the prompt.** The model does not reliably obey structural
  instructions (which list a delta goes in, the shape of a ref). Every time that mattered, the fix
  that held was code: `salvage.ts`, `bare-refs.ts`, `apply/misfiled.ts`, `apply/fill-gaps.ts`.
- **Play a campaign before calling anything done.** Every serious bug on this branch passed
  `npm test` first. Twelve real orders found more than the whole suite. Use the eval corpus and a
  live save, and read `npm run audit:deltas --order` after.
- **A label map gets a test that iterates the enum.** When rolling back rejected state, ask what else
  was mutated first. Never swallow a schema-parse failure of persisted state.
- **The checkout is shared.** Another session may be editing `apply-deltas.ts` and `deltas.ts`. Make
  targeted edits; never rewrite those files wholesale.
- **Migrations 0035 to 0039 are in the journal again** (2026-09-25), so `npm run migrate -w @chronica/db`
  applies them; they are idempotent, and a database that had them by hand is only re-registered.
- **The test machine overloads.** Rerun a package alone before believing a red timeout.
- **Scenario rules are versioned (v27).** A running save pins its version and must be repinned to see
  new scenario data. Prefer engine constants to scenario data where old saves should benefit.

---

## 1. Simulation speed

**Today.** A turn takes 81–134 s wall clock. A measured turn was 19 model calls, 169 s of provider
time, and 2.1× overlap. The ground truth is `simulation_bursts.started_at/ended_at`, read by
`scripts/burst-timings.mts`; per-stage seconds are logged per turn as `[burst <id>] …`. The burst
runs inside the HTTP request (`apps/web/app/api/games/[gameId]/simulate/route.ts`).

**What costs the time, in order:**

1. Cognition generating up to ten people's answers in one call. It is already split onto two
   concurrent calls past a cast of six.
2. Repair calls: every schema rejection buys a second full-price call. `salvage.ts` brought repairs
   from 4 in 10 to near 0 in the runs measured, but `repair-deltas.ts` and `reconcile-facts.ts`
   still run in series after the main call (`burst.ts:433`, `burst.ts:528`).
3. Everything in a burst is sequential after orchestration (`burst.ts:1022`, `burst.ts:1184`):
   orchestrate → apply → cognition → apply per actor → chronicle.

**Build, in this order:**

1. **Baseline.** Run five turns on a fixed save and record the numbers from `burst-timings.mts`
   before changing anything. Every later step reports against them.
2. **Move the burst off the request.** `simulation_bursts` was built for this. The route starts the
   burst and returns; the client polls or streams its status. This gives no speedup in seconds,
   but it removes the hard bound problem and lets the next step work.
3. **Stream the Chronicle.** Show the Chronicle as it is composed rather than when the burst ends.
   Most of the wait becomes reading time.
4. **Overlap what does not depend on each other.** Cognition for actors routed by the order does not
   need to wait for fact reconciliation, and the chronicle does not need to wait for the last
   actor's deltas to be applied if they touch nothing it narrates. Map the real dependencies in
   `burst.ts` first and write them down in the file; do not guess.
5. **Skip calls that have nothing to do.** A step with no routed cast should cost no cognition call.
   A step whose facts are all already reconciled should cost no reconcile call. Log every skip.
6. **Split cognition finer when the cast is large.** Two shards past six is a guess; measure three
   and four.

**Done when:** the median turn is under 60 s wall clock and the slowest of the five is under 120 s,
with the same number of orders carried out. The Chronicle starts appearing within 20 s of the order.

---

## 2. The world invents mechanics, and the engine runs them

This is the main piece. VISION §1 says the AI "can dynamically create mechanics or entities when the
evolving world requires them". It can create entities. It cannot create mechanics.

**Today.** An act that fits no op is kept (`apply/keep-as-arrangement.ts`) as a
`generic_entity_create` whose effects come from a closed list: ten quantities (`stability`,
`food_security`, `productive_capacity`, `manpower`, `legitimacy`, `income`, `recruit_skill`,
`defense`, `supply`, `conversion`), three bands, and two scopes (`StandingEffectSchema` in
`shared/src`). An order that leaves nothing gets a `"pursuit"` arrangement per person (`burst.ts`).
Both are recorded in `delta_audit` as `kept` and `pursuit`. The world remembers the act happened,
but the act does nothing unless it happens to look like a venture.

**Build: a mechanic is data the model writes once and code runs forever.**

1. **The shape.** Extend the arrangement, do not add a parallel entity. An arrangement gains:
   - **A trigger:** each month, on a fact of a given kind, or when a condition becomes true. Reuse
     `WatchPredicateSchema` (`world/watch.ts`) for conditions, and extend its arms rather than
     inventing a second predicate language. Remember the trap that an already-true watch fires at
     once; guard every arm.
   - **Conditions:** comparisons against world values the engine can already read (a province's
     order, a purse, a relation, a price, a force's strength).
   - **Effects:** templates of delta ops the applier already runs, with amounts written as bands or
     as bounded expressions over the conditions' values. The same caps apply as for everything
     else: the tax ceiling, a venture's yield ceiling, the `VENTURE_PRICE_MONTHS` pricing in
     `priceTheYield`.
   - **An end:** a condition, a term, or its owner's death.
2. **Where it is written.** When an act is about to be kept as an arrangement or a pursuit, the model
   is asked to write the mechanic for it, with the act, the actor's slice and the list of ops and
   readable values. That is one extra call only on the orders that need it; measure how many do
   in the eval corpus first.
3. **What the engine does with it.** It validates the mechanic: paths exist, effects are ops it
   accepts, amounts are within bounds, and the owner can afford the price. Then it prices it,
   stores it, and runs it in the monthly tick with no model involved. A refused mechanic falls back
   to today's arrangement, never to nothing.
4. **Reuse.** Mechanics are keyed by what they do. A second person who sets up the same kind of
   business reuses the first mechanic's shape at their own price instead of paying for a new
   call. Store the shapes on the world, not the scenario.
5. **Visible.** Every firing writes a fact to its owner's record. The Chronicle can say that the
   cutlery stall paid, or was closed by the aediles.

**Test cases:** the `kept` and `pursuit` rows in the local `delta_audit` table, plus the
`trade-rome`, `trade-syracuse` and `private-life` chains in the eval corpus. Add orders nobody
designed for: a toll on a bridge, a grain dole bought with private money, a school, a protection
racket, a cult.

**Done when:** at least half of the acts that are kept today become mechanics that change a number
over months of play. None of them breaks a ceiling. A two-year campaign ends with no mechanic that
fires on nothing or fires every month for no reason.

---

## 3. The prompt ceiling: only as much as section 2 needs

**Today.** The orchestrator prompt is 63,000 characters, most of it generated JSON schema of the
delta union. Space has been bought by naming repeated schemas as `$defs` (`Money`, `SignedBps`,
`Name`, `Days`, `Id`, `PartyRef`, `Ref`, …), and that trick is close to used up. Section 2 adds
schema, and it will not fit as things stand.

**Do not start here.** Start section 2, find out exactly how much schema it needs, and then pick the
smallest of these that makes room:

1. **Take the schema out of the prompt.** Both providers accept a response schema outside the
   prompt (Anthropic `output_config.format`, OpenAI `json_schema` strict). This also removes most
   repair calls, which helps section 1. The risk is that a union of about 80 ops exceeds the
   providers' schema-complexity limits. Try it with one real call on each adapter before building
   anything on it. Dev runs on the OpenAI adapter (`gpt-5.6-luna`); both must keep working.
2. **Group the ops.** Group the delta ops into families. The orchestrator is shown the full list of
   op names with one-line descriptions, and the full schema only for the families the slice makes
   relevant (no armies in the slice, no army ops). The applier's validation does not change.
3. **Two passes.** A cheap first call names the op families the order needs, and a second call
   carries only those schemas. This costs a call and works against section 1, so it is the last
   resort.

**Done when:** section 2 fits, `prompt-smoke.test.ts` passes, and the repair rate in
`audit:deltas` is no worse than today.

---

# Secondary: only after sections 1 and 2 are done

## 4. Competence and corruption decide how an order is carried out (VISION §13)

**Today.** Skills are printed into an actor's cognition prompt ("Capable at: …",
`cognition.ts:376`) and a few of them unlock instruments (`cognition.ts:384–389`). Code reads them
in only a handful of places:

- `battle-resolver.ts:109`: a commander's `martial`.
- `plots.ts:128`: `intrigue` on both sides of a plot.
- `apply-deltas.ts:2902`: a physician's `learning` when healing.
- `apply-deltas.ts:3293`: `martial` and `body` in a duel.
- `apply-deltas.ts:1873`: training raises skills.

Everywhere else, two governors given the same order produce the same world. The roles plan
(`SIMULATION-LOOP-V1.md` §5c, phase 5) left "an engineer's skill sets a project's pace" unbuilt.

**Build:**

1. **One place that answers "how well was this done".** A function over the person carrying out an
   act and the domain of the act, returning a deterministic modifier seeded from
   `shared/src/determinism.ts`. Follow the shape of the battle and plot rolls, not a new idea.
2. **Apply it where outcomes are numbers, in the applier, not the prompt:**
   - `stewardship`: project pace, tax actually collected against the ceiling, yield of an estate or
     venture they manage, and the cost of raising an army.
   - `diplomacy`: how far a relation moves after a conversation or letter, and the chance an
     agreement's counterparty accepts.
   - `martial`: recruitment quality, drill, and march attrition (battles already done).
   - `learning`: discovery and project pace for engineers (healing already done).
3. **Corruption.** A person who handles public money, with a strong wealth drive and low loyalty to
   the payer, skims. The skim is a real transaction to their own purse and a private fact that can
   be discovered, not a silent loss. The drives and loyalty exist in `characters/mind.ts` and the
   relationship dimensions.
4. **Say who did it.** Every act that was done well, badly or skimmed carries the actor in its fact,
   so the Chronicle can name the incompetent governor and the player can replace him.

**Done when:** the same order given to two officials of different skill yields measurably different
numbers, in a test that iterates every skill domain. A live campaign shows at least one skim being
discovered. Nothing here grows the orchestrator prompt.

---

## 5. People and powers plan, not only react

**Today.** The world acts through two routers. `routeAttention` is reactive: people answer what the
player did. `routeAmbientActors` (`attention.ts:319`) picks a small rotating cast from their own
standing business: an office, a promise, a pressure, a storyline, a government's intentions. The
narrator can give someone priority for one round, and a nemesis is always asked.

What they pursue is free text:

- Characters have `ambitions` (label, kind, target, status; `characters/character.ts:83`).
- Governments have `intentions`: up to six strings (`world/outlook.ts:42`).

Nothing tracks a step, a precondition or a deadline. So a man is asked what he does this week with
his ambition in the prompt, and whether he makes progress over two years depends on whether he keeps
being routed and keeps remembering.

**Build:**

1. **A plan is an ambition with steps.** Extend `AmbitionSchema` and the government's intentions
   rather than adding an entity. Each gains a short list of steps. Each step is an act written as
   an order would be, with an optional precondition (a `WatchPredicate`) and a date by which it
   should have happened. Written through the existing `character_state_set.ambitions` path, not a
   new op.
2. **The engine keeps the plan.** It checks preconditions in the tick, marks steps done when the
   facts show them done, and when a step comes due it puts its owner into the next burst's ambient
   cast through the same slot the narrator uses (`priorityCharacterIds`). The model decides what
   the step becomes; the engine decides when it is time.
3. **Failure is information.** A step that misses its date, or whose precondition becomes
   impossible, wakes the owner to replan. That is an event in their record, and reachable by
   anyone who could learn of it.
4. **Governments too.** A power's intentions become plans held by the person who can carry them
   out: the office holder, or the council. Syracuse moving on Messana is a plan with steps, not a
   hope that the rotation lands on Hieron in the right week.
5. **Keep the cast small.** A due step replaces a rotation slot; it does not add one. Section 1's
   gains are not to be spent here.

**Done when:** a two-year run with the player only waiting (`spanDays`, "let a month pass") shows at
least three powers each carrying a plan through three or more steps. The Chronicle reads as several
people's threads, not the player's alone. The share of NPC acts that belong to a plan is logged per
burst.

---

## Order of work

1. Section 1, steps 1–3: baseline, burst off the request, streamed Chronicle.
2. Section 2: measure the schema it needs and how many eval orders would need a mechanic. That
   decides section 3.
3. Section 3: the smallest option that fits. If it is option 1, it also counts toward section 1.
4. Section 2, built and played.
5. Section 1, steps 4–6, measured against the baseline with section 2's extra call in place. A
   mechanic call must not push a turn past section 1's targets.
6. Only then: section 4, then section 5.

After each section: run a live campaign, read `audit:deltas`, update
`docs/SIMULATION-LOOP-V1.md`, and fix the stale "Not in the game yet" section of
`docs/product.md` (combat, diplomacy and espionage exist now).
