# Plan: delete Chronicle, Orders, and Turns; keep Chat NPCs standalone

**Status:** executed on branch `wipe-legacy-turn-system`, more aggressively than originally
scoped below. See "What was actually executed" at the bottom of this document for the real,
final decisions -- the plan phases below are the original proposal and are kept for the reasoning
they record, not as a description of the current codebase.

**Note:** the vision and reasoning this document originally pointed to (`docs/CORE-VISION.md`) has
been superseded by [`docs/VISION.md`](../VISION.md), which does not cover the deleted
elastic-time/plan-stage/Chronicle reasoning. This plan is kept below purely as a record of what was
deleted and why, not as a pointer to still-current design rationale.

## Why this is a bigger cut than "drop three tables"

Turns are not a self-contained feature next to Chronicle and Orders — they are the persistence
backbone the whole app currently reads and writes through:

- `worldSnapshots`, the table holding the **entire canonical `WorldState` document**, is 1:1 keyed
  by `turnId`. `getWorldView`/`persistOpeningWorld` (`packages/db/src/queries/turns.ts`) — the
  functions *every* code path uses to read or write world state, including the Chat NPC dialogue
  service — are implemented entirely in terms of `worldSnapshots` joined to `turns`.
- `createGame` inserts the game's first `turns` row as part of game creation; there is currently no
  other way a game acquires a starting world.
- The Chat NPC system's own consequences (relationship deltas, beliefs, commitments from a
  conversation) are written as `CharacterSocialEvent` rows with `status: "proposed"` and are
  **only ever applied to canonical state by turn resolution's `pipeline.ts`**. Today, a
  conversation's effects sit pending until the player submits an order and a turn resolves — chat
  is not yet a standalone real-time loop.
- "An NPC wants to talk to you" currently reaches the player through a Chronicle entry's
  `initiatedDialogue` field, sourced from a GM tool fired during turn resolution.

So this plan is really: **(1) build the two small pieces of standalone infrastructure Chat NPCs
need so they stop depending on turn resolution, (2) delete the turn-resolution engine and
everything that only exists to feed it (Orders, the multi-agent dispatcher, workflows-as-executed,
the Game Master session), (3) delete Chronicle, (4) delete the `turns` table and lifecycle itself,
(5) clean up everything left pointing at any of the above.** Order matters — doing this out of
sequence breaks Chat NPCs partway through, which the user explicitly does not want.

## Non-negotiable constraint

**Chat NPCs must work, uninterrupted, as a standalone feature after every phase below.** They must
remain "actual characters," not a stateless chatbot (canonical world record, durable per-player
knowledgebase, relationship ledger, beliefs/pressures/mind read into the prompt, commitment ledger,
canonical identity for newly discovered NPCs, historical grounding). None of
`packages/shared/src/characters/*` is touched
by this deletion except where explicitly called out below, and none of it should need to be.

---

## Phase 0 — Re-home world-state persistence off `turns` (prerequisite, blocks everything else)

This has to happen first: it's the only reason `worldSnapshots`/`turns` can't simply be dropped.

1. Add a new table, e.g. `game_states` (or similar) — one row per game, holding the current
   canonical `WorldState` JSON, `schemaVersion`, `stateHash`, `updatedAt`. Decide during
   implementation whether history is needed (an append-only revision log) or only the current state
   is needed (a single row upserted in place); nothing found in this research requires history to
   be retained once Chronicle/turn replay is gone, so a single-row-per-game design is the simpler
   default unless something else surfaces a need for it.
2. Rewrite `getWorldView` and `persistOpeningWorld` (`packages/db/src/queries/turns.ts`) to read
   and write this new table instead of joining `worldSnapshots` to `turns`. These two functions are
   the load-bearing wall — every caller (dialogue service, map/overlay routes, admin inspectors)
   goes through them, so once they're re-homed, most callers need no further change.
3. Rewrite `createGame` to seed `game_states` from the scenario's `initialWorld` directly, with no
   `turns` row involved.
4. Confirm every other caller of `getWorldView`/`persistOpeningWorld` still compiles and behaves
   the same (grep for both names across `apps/web` and `packages/db`).

**Verification for this phase alone:** a game can be created and its world read back with no
`turns` row in existence. Existing dialogue tests keep passing unmodified.

## Phase 1 — Make Chat NPC consequences and initiation independent of turn resolution

1. **Real-time social event application.** `applySocialEvents`
   (`packages/shared/src/characters/apply-social-events.ts`) is already a pure function, decoupled
   from turns — it just currently has no caller except `pipeline.ts`. Give it a new caller: apply a
   `CharacterSocialEvent` right after `dialogue-service.ts` proposes it (or on a lightweight
   synchronous step immediately following `insertCharacterSocialEvent`), instead of leaving it
   `"proposed"` until a turn resolves. This is what makes conversations have immediate, not
   turn-deferred, consequences — arguably an improvement over today's behavior, not just a
   workaround.
2. **Replace the Chronicle-sourced "NPC wants to talk to you" signal.** `flag_npc_initiated_dialogue`
   and `getInitiatedDialogueFromChronicleEntry` go away with Chronicle (Phase 3). Two options,
   to decide during implementation rather than in this plan:
   - (a) Drop NPC-initiated contact entirely for now and revisit it once a new pacing mechanism
     exists (simplest; matches "don't build speculative replacements").
   - (b) Add a minimal standalone table (e.g. `pending_npc_initiations`: gameId, characterId,
     topic, openingLine, createdAt) that something can insert into directly, independent of any
     event queue or turn concept, and have the conversations UI poll/check it the way it currently
     checks Chronicle.
   Recommendation: (a) for this deletion, since inventing a new mechanism is out of scope for a
   deletion plan — track it as a follow-up in the "Deferred / out of scope" section below rather
   than building it now.
3. Confirm `dialogue-service.ts` and its API routes never call anything in `pipeline.ts`,
   `dispatch.ts`, `orchestrator.ts`, `game-master.ts`, or `gm/session.ts` — the research pass found
   no such call today; re-verify at deletion time since code may have shifted.

**Verification for this phase:** open a conversation, say something that would previously have
produced a `CharacterSocialEvent`, and confirm the relationship/belief change is visible without
ever submitting an order or resolving a turn.

---

## Phase 2 — Delete the Orders system

Delete outright:

- `packages/shared/src/actions/orders.ts`, `order-projection.ts`, `operations.ts`,
  `player-intent.ts`, `verdict.ts`, `ai-routing.ts`, and their tests
  (`orders.test.ts`, `order-projection.test.ts`).
- `apps/web/app/api/games/[gameId]/orders/route.ts`.
- `apps/web/app/api/admin/order-operation-inspector/[gameId]/route.ts`.
- `apps/web/app/games/[gameId]/components/orders-panel.tsx` and its mount points in
  `game-shell.tsx`.
- `orders` DB table, `players.standingOrder`, `players.autoPass`, `players.watchConditions`.
- `interpret_plan`, `execute_plan_stage` tool definitions in `packages/shared/src/gm/tools.ts`
  (they exist only to interpret order text during turn resolution).
- `packages/shared/src/gm/player-plans.test.ts`, `packages/shared/src/gm/session.test.ts` (audit —
  keep only what doesn't depend on the deleted plan/order machinery, if anything does).

Keep, unmodified: the claims-classification discipline (`world_premise`/`actor_belief`/
`deliberate_message`/`preference`/`condition`) is a *concept*, not code that needs to survive this
deletion, though it is no longer documented anywhere in this repo.

## Phase 3 — Delete turn resolution: the multi-agent dispatcher, Game Master session, and workflow execution's caller

This is the largest single chunk. Delete:

- `apps/web/lib/resolution/pipeline.ts`, `dispatch.ts`, `game-master.ts`, `game-master-prompt.ts`,
  `elastic-scheduler.ts` (and its test) — elastic time's shadow-mode implementation is turn-scoped
  by construction and is not preserved elsewhere in this repo.
- `apps/web/lib/resolution/agents/orchestrator.ts`, `reaction-runner.ts`, `interpreter-agent.ts`,
  `npc-agent.ts`, and their tests.
- `packages/shared/src/gm/session.ts`, `memory.ts` (+ `campaign-memory.ts` if separate),
  `turn-report.ts`, `world-diff.ts`, `capability-request.ts`.
- `declare_intent` and the turn-resolution-only parts of
  `packages/shared/src/character-agency/*`, `packages/shared/src/star-context/*` — verify at
  deletion time whether anything outside turn resolution imports these; if truly turn-only, delete
  alongside.
- `packages/db/src/queries/resolution.ts` (commitResolution, claimTurnForResolution,
  updateTurnProgressStep, failTurn, getQueuedTurn, markChronicleRead) and its test.
- `apps/web/app/api/games/[gameId]/resolution/stream/route.ts` (SSE progress) and any
  `resolution/retry` route present at deletion time.

**Decide explicitly, don't assume:** `packages/shared/src/workflows/*` (the ~97 MCP-style tools)
are, per the research, a general world-mutation capability registry, not inherently an
Orders/Turns mechanism — but their only current caller is the orchestrator being deleted in this
phase. Options: (a) delete the execution engine's caller but keep the tool *definitions* as a
dormant, well-documented registry for whatever resolves actions next; (b) delete both. This plan
recommends (a) — the schemas and validation logic are real engineering investment independent of
how they get invoked — but flags it as a judgment call to confirm with the user before executing,
since "completely delete everything that has to do with ... turns" could reasonably be read either
way for code that is turn-adjacent but not turn-specific in nature. Ask before deleting workflows
outright; don't delete them by default.

**Verification for this phase:** nothing in `apps/web` still imports any file deleted here (a
repo-wide `tsc --noEmit` catches this immediately, since these modules are heavily typed). Chat NPC
tests and manual chat flow still pass — this is the phase most likely to accidentally break Chat if
a shared dependency turns out to be less separable than the research pass found.

## Phase 4 — Delete the Chronicle system

- `apps/web/lib/resolution/chronicle-from-facts.ts` (+ test), `chronicle-schedule.ts` (+ test).
- `packages/shared/src/chronicle/*` (`causal-chain.ts`, `depth.ts`, `dispatch.ts`, `knowledge.ts`,
  `political-procedure-description.ts`, `voice.ts`) and their tests.
- `packages/shared/src/world/chronicle-chains.ts` — first confirm nothing outside Chronicle/memory
  needs causal-chain derivation; campaign memory is being deleted in Phase 3, so this should be
  fully free to delete too, but re-check at deletion time.
- `chronicleEntries` DB table.
- `apps/web/app/api/games/[gameId]/chronicle/route.ts`,
  `apps/web/app/api/games/[gameId]/chronicle/read/route.ts`,
  `apps/web/app/api/admin/chronicle-inspector/[gameId]/route.ts`.
- `apps/web/app/games/[gameId]/components/chronicle-panel.tsx` and its mount in `game-shell.tsx`.
- `getChronicleForLatestTurn`, `getInitiatedDialogueFromChronicleEntry`,
  `getChronicleInspectorView`, `markChronicleRead` (`packages/db/src/queries/turns.ts` /
  `resolution.ts` — most of these files are already gone by this point per Phase 3, confirm nothing
  remains).
- `player_game_ui_state.chronicleReadSequence` column — **column-level drop only**; keep
  `selectedThreadId` and `generatedCast`, which are Chat-relevant.
- `phase-banner.tsx`'s `"news"` phase copy; audit `game-shell.tsx` for the `chronicleOpen` state and
  display-patch wiring tied to it.

**Verification for this phase:** Chat NPC initiation no longer references Chronicle at all (Phase 1
already removed the functional dependency; this phase removes the dead code it pointed at).

## Phase 5 — Delete the `turns` table and lifecycle itself; rework what was built on top

By this point nothing should be reading or writing `turns` except vestigial FKs and `games`-level
lifecycle config. Now:

1. Drop the `turns` table and `turnStatus` enum.
2. Drop `turnNewsReadiness`.
3. Decide `worldSnapshots`: either drop it (Phase 0's `game_states` replaces its function) or keep
   it repurposed as the new state store if Phase 0 chose to build on it directly instead of a new
   table — don't end up with both.
4. Decouple, don't necessarily delete, tables that merely reference `turnId` for audit/bookkeeping
   whose *populating code* was already deleted in Phase 3: `characterClaims.introducedAtTurnId`,
   `pendingWorkflowProposals`, `inventedWorkflows.createdTurnId`, `inventedWorkflowUses`,
   `capabilityRequests`. Since their populators (orchestrator, GM session) are gone, these tables
   are very likely fully dead and safe to drop outright — verify no other code path writes to them
   before assuming that, but expect "drop," not "rework," to be the right call for most of these.
5. `worldEvents.scheduledForTurnId`, `worldFacts.turnId` — make the columns nullable-and-unused or
   drop them, but **keep the `worldEvents`/`worldFacts` tables themselves**. These were the standing
   candidate substrate for whatever eventually paces the world going forward, and they cost nothing
   to leave in place, dormant, versus rebuilding later from scratch.
6. `games` table: drop `turnMode`, `turnTimeoutSeconds`, `newsTimeoutSeconds`,
   `agentArchitectureVersion` (all turn-lifecycle config with no remaining reader).
7. Rework `apps/web/lib/game-repository.ts` (1139 lines): remove `submitOrders`, `getOrdersStatus`,
   `getNews`, `NewsViewModel`/`OrderBatch`/`OrdersStatusResponse` schema usage, and the `uiState`
   fixture shape's `chronicleReadSequence`/`submittedBatch` fields, from **both** the
   `fixtureGameRepository` and `postgresGameRepository` implementations of the shared
   `GameRepository` interface. Keep `getWorld` and character-declaration methods — they're
   consumed by pages unrelated to Orders/Chronicle.
8. Audit every page that imports `game-repository.ts` for now-removed methods/types:
   `apps/web/app/actions.ts`, `page.tsx`, `admin/page.tsx`, `worlds/page.tsx`, `account/page.tsx`,
   `games/new/page.tsx`, `games/[gameId]/page.tsx`, `games/[gameId]/declare/page.tsx`,
   `api/games/[gameId]/{map,overlay}/route.ts`. Most of these only need `getWorld`/character data
   and should be unaffected; `games/[gameId]/page.tsx` is the one most likely to need real UI
   rework since it's the shell that mounted both deleted panels.
9. New migration(s) for all of the schema changes above, generated the normal way
   (`packages/db/migrations`), reviewed for irreversible data loss before applying anywhere with
   real campaign data.

**Verification for this phase:** `npm run typecheck` clean across the whole repo; `npm run
test`/`vitest run` clean; a fresh game can be created, a character declared, and a conversation had
with an NPC, entirely without a `turns` table existing.

## Phase 6 — Docs cleanup

- Rewrite `README.md`'s pitch — it currently is literally
  "choose a character → converse → give orders → world advances → read the Chronicle → act again."
- Rewrite `docs/product.md` and `docs/architecture.md` — both describe Turns/Orders/Chronicle as
  the primary loop throughout; do this only after the code changes above land, so the docs describe
  what's actually true rather than a plan.
- Re-scope (don't necessarily delete — they describe unbuilt future work) `docs/world-cycles/*`,
  since they assume the Chronicle exists as their "the player would notice" delivery channel.
- Delete or archive `AI-HANDSHAKE-PROMPTS/issue-{01..09}-*.md` if present — these are engineering
  specs for turn-dispatch durability that were never implemented (no worker script/route exists in
  `main` today); confirm that's still true at deletion time before removing them, since another
  branch (`world-matters`) has since started implementing a durable turn worker — do not delete
  specs for something that has since landed elsewhere without checking first.
- Update this repo's root docs list once `docs/product.md`/`architecture.md` are rewritten.

---

## Deferred / explicitly out of scope for this deletion

- Designing the actual replacement pacing mechanism (what makes the world feel alive between
  conversations, once Chronicle/Orders/Turns are gone) is separate, future work.
- A replacement for NPC-initiated contact (Phase 1, option (b) if chosen later).
- Any redesign of `packages/shared/src/workflows/*` beyond disconnecting its turn-resolution caller
  (Phase 3's explicit judgment call — confirm with the user before deleting workflow definitions
  outright).
- Multiplayer, authored world generation, tactical controls — already out of scope per
  `docs/product.md` and unaffected by this deletion either way.

## Suggested execution order and checkpoints

Phases 0 and 1 are prerequisites and should be a single reviewable change, verified against the
non-negotiable constraint (Chat NPCs keep working) before touching anything else. Phases 2–4 can
follow in sequence or be combined, since Orders/turn-resolution/Chronicle are tightly coupled to
each other and loosely coupled to Chat once Phase 1 lands. Phase 5 (dropping `turns` itself) should
be the last code change, once nothing references it anymore — this is also the only phase with an
irreversible database migration, so it should get its own explicit go-ahead before running against
any environment with real data. Phase 6 (docs) should be last, so it documents the true end state.

---

## What was actually executed (branch `wipe-legacy-turn-system`)

The user reviewed this plan and gave three instructions that changed its scope and character:

1. **Delete the workflow-execution engine too** (`packages/shared/src/workflows/*`, `world-tools/*`,
   `gm/*`), resolving Phase 3's open judgment call in favor of deletion, not preservation.
2. **This is a clean wipe, not a staged migration.** A new system will be designed and built
   afterward; do not spend effort building the Phase 0/Phase 1 replacement plumbing (a new
   world-state persistence table, real-time social-event application, a Chronicle-free
   NPC-initiation channel). Broken imports in areas that depended on the deleted persistence layer
   are expected and acceptable -- they are exactly the thing "a new system" will replace.
3. **Chat NPCs stay intact as source** -- their files (`packages/shared/src/characters/*`,
   `apps/web/lib/dialogue-service.ts`, `dialogue-prompt.ts`, the `conversations/*` API routes,
   `chat-panel.tsx`/`character-panel.tsx`) were not deleted or rewritten, even where their imports
   now point at something removed. "Intact" means the character-simulation model and dialogue logic
   survive as a foundation, not that the feature runs end-to-end today without further work.

Given (2) and (3) together, the actual execution differs from the plan above in one important way:
**no Phase 0/Phase 1 replacement infrastructure was built.** `getWorldView`/`persistOpeningWorld`
(the sole world-state read/write path, previously in the now-deleted `packages/db/src/queries/turns.ts`)
were deleted along with `turns`/`worldSnapshots`, and nothing replaced them. This is deliberate,
per instruction (2), not an oversight.

### What was deleted, beyond the original plan's Phases 1–4

- **All of `packages/shared/src/workflows/`** (executor, registry, policy, diagnose, all ~30
  definition files under `workflows/definitions/`) and **`packages/shared/src/world-tools/`** (the
  typed dispatch layer over the workflow registry).
- **All of `packages/shared/src/gm/`** (session, memory, campaign-memory, tools, turn-report,
  world-diff, capability-request, read-tools) -- the Game Master tool-loop engine.
- **`packages/shared/src/actions/`** (orders, plans, operations, feasibility, conflicts,
  reservations, player-intent, verdict, ai-routing, activity) -- the Orders/plan machinery.
- **`packages/shared/src/character-agency/`** and **`packages/shared/src/star-context/`** -- the
  turn-resolution-only autonomous NPC/star-context agent selection and political-resolver modules.
- **`apps/web/lib/resolution/`** in its entirety (pipeline, dispatch, orchestrator, reaction-runner,
  interpreter-agent, npc-agent, player-agent, closing-agent, star-context-agent, game-master,
  game-master-prompt, elastic-scheduler, event-loop, action-phase-tick, project-tick, midnight-tick,
  world-development-scheduler, world-dynamics, chronicle-from-facts).
- **`apps/web/lib/game-repository.ts`** and **`apps/web/lib/world-view.ts`** -- both fundamentally
  Orders/Chronicle/turn-shaped view-model projections; deleting them breaks every page that imported
  them (see "Known breakage" below) but building their replacement is explicitly out of scope here.
- **DB**: `turns`, `orders`, `turnNewsReadiness`, `worldSnapshots`, `chronicleEntries`,
  `pendingWorkflowProposals`, `inventedWorkflows`, `inventedWorkflowUses`, `capabilityRequests`,
  `worldEvents`, `worldFacts` tables; `turnStatus`/`workflowProposalStatus`/`inventedWorkflowStatus`
  enums; `players.standingOrder`/`autoPass`/`watchConditions`; `games.turnMode`/
  `turnTimeoutSeconds`/`newsTimeoutSeconds`/`agentArchitectureVersion`;
  `characterClaims.introducedAtTurnId`; `player_game_ui_state.chronicleReadSequence`. The
  `worldEvents`/`worldFacts` event-queue tables were dropped too -- the original plan argued to keep
  them as elastic time's future substrate, but instruction (2) means that's now a decision for
  whoever designs the new system, not something to preserve speculatively here.
- All test files and admin API routes (`order-operation-inspector`, `chronicle-inspector`,
  `workflow-proposals`, `invented-workflows`) exclusively covering the above.

### What was relocated rather than deleted, because surviving code needed it

A handful of small, self-contained schemas that happened to live inside a deleted module turned out
to be load-bearing for code this plan says must survive (`WorldState` itself, `authority/*`,
`warfare/*`, `continuity/*`, the character system). Each was moved, not reinvented:

- `OrderPartyRefSchema`/`OrderPartyRef` (was `actions/orders.ts`) → new file
  `packages/shared/src/world/party-ref.ts`. A generic "who or what" reference used by authority
  grants, order attempts, facts, projects, and generic entities -- never actually Orders-specific.
- `BattlePhaseSchema`/`TacticalPreconditionSchema`/`ResourceCostSchema`/
  `TacticalModifierProposalSchema` (was `actions/verdict.ts`) → new file
  `packages/shared/src/warfare/tactical-modifier.ts`.
- `StateDeltaReferenceSchema` (was `actions/verdict.ts`) → inlined directly into
  `packages/shared/src/continuity/continuity.ts`, its only consumer.
- `Commitment`/`createCommitment`/etc. (was `character-agency/commitments.ts`, 362 lines) and
  `CharacterIntent` (was `character-agency/intents.ts`) → moved to
  `packages/shared/src/characters/commitments.ts` and `.../intents.ts` respectively, along with
  their tests. These were miscategorized under the turn-resolution-only `character-agency/`
  directory but are genuinely part of the character model -- the commitment/promise ledger that
  makes an NPC an "actual character."
- `AiOperationSchema`/`AiOperation` (was `actions/ai-routing.ts`) → rewritten in-place in
  `packages/shared/src/coins.ts`, trimmed from ~30 turn-resolution operation kinds down to the 8
  Chat/character operations actually still issued anywhere in the codebase (`resolve_contact`,
  `enrich_npc_profile`, `dialogue_ordinary`, `dialogue_principal`, `extract_knowledge`,
  `propose_social_events`, `declare_character`, `confirm_character`).
- `AiTier` (was `@chronica/shared`'s `actions/ai-routing.ts`) → became a package-local type in
  `packages/ai/src/adapter.ts`, since only the two AI adapters need it now.

`WorldState` itself lost the fields whose types lived in deleted modules and had no consumer outside
`world-state.ts`: `playerPlans`, `plans`, `actorActivities`, `actions` (OngoingAction),
`operations`, `characterGoals`, `characterPlots`, `nemesis`/`nemeses`, `characterRelevance`,
`chronicleChains`, `commitments`/`characterIntents` moved instead of dropped (see above),
`lastTurnSummary`, `campaignMemory`. `orderAttempts` was kept (the surviving `authority/order-attempt.ts`
module needs it and isn't itself Orders-specific).

`packages/shared/src/authority/authority-grant.ts`'s `officeIdToDomainPowers` used to classify an
office's authorized action ids by looking up their category in the now-deleted `WORKFLOW_REGISTRY`.
It now unconditionally returns `[]` with a comment explaining why, rather than guessing a
replacement classification -- three existing tests asserting the old behavior are marked
`it.skip` with an explanation rather than deleted, so the intended behavior stays documented for
whoever rebuilds this. The equivalent `WORKFLOW_REGISTRY` check in `world/project.ts` (validating
`linkedWorkflowId`/`completionWorkflowId`) was removed the same way, and its now-meaningless test
cases were deleted outright (there was no meaningful "old behavior" left to document once the
validation itself is gone).

### Known breakage left for the new system (deliberately not fixed)

Per instruction (2), these are left broken rather than patched:

- `apps/web/lib/character-service.ts` and `apps/web/lib/dialogue-service.ts` both import
  `getWorldView`/`persistOpeningWorld` from `@chronica/db`, which no longer exist. **This means Chat
  NPCs do not currently run end-to-end** -- the source and character-simulation model survive
  intact (per instruction 3), but the runtime path is severed until a new persistence layer is
  built. This is the most important thing for whoever picks this up to know.
- `apps/web/app/api/admin/{character-mind,life-inspector,political-inspector}/[gameId]/[...]/route.ts`
  -- same `getWorldView` dependency.
- `apps/web/app/api/games/[gameId]/conversations/initiate/route.ts` -- imports
  `getInitiatedDialogueFromChronicleEntry`, which no longer exists (Chronicle is gone).
- Every page importing the deleted `apps/web/lib/game-repository.ts`: `app/actions.ts`,
  `app/page.tsx`, `app/admin/page.tsx`, `app/worlds/page.tsx`, `app/account/page.tsx`,
  `app/games/new/page.tsx`, `app/games/[gameId]/page.tsx`, `app/games/[gameId]/declare/page.tsx`,
  `app/api/games/[gameId]/{map,overlay}/route.ts`.
- `apps/web/app/games/[gameId]/components/game-shell.tsx` -- still imports the deleted
  `./orders-panel` and `./chronicle-panel`, and the deleted `GamePhase` type.
- `apps/web/app/account/page.tsx` imports `listInventedWorkflows` from `@chronica/db`, also gone.

Everything else -- `packages/shared`, `packages/db`, `packages/ai`, `packages/billing`, and every
test in those four packages -- typechecks and passes (`npx tsc --noEmit` clean in each; `vitest run`
green, 3 tests in `authority-grant.test.ts` explicitly skipped as above). `apps/web`'s own test
suite (`vitest run`) is fully green too -- the breakage above only surfaces under `tsc --noEmit`,
since no existing test exercises the broken runtime paths.
