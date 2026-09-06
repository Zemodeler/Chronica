# The command contract and taxonomy

The Game Master ([docs/24](24-game-master.md)) decides what matters and what
should happen next. Everything downstream of that decision — whether a change
is legal, and exactly what it does — is deterministic code. This document
states that boundary as a binding rule, names the three kinds of thing on the
deterministic side, and records where the boundary is still imperfect.

## The command contract

A **command** is a registered workflow in `WORKFLOW_REGISTRY`
([workflows/types.ts](../packages/shared/src/workflows/types.ts),
[workflows/registry.ts](../packages/shared/src/workflows/registry.ts)). Every
command must:

- Have typed inputs (`parametersSchema`), preconditions checked before any
  mutation, a deterministic result, and a concise factual summary
  (`WorkflowResult.summary`).
- Make one coherent domain mutation — not a batch of unrelated changes.
- Return structured effects through its result and refusal (`refuse(reason)`):
  what changed, or exactly why nothing did. A refusal reason is read by an AI
  and, when nothing recovers it, by a player — it must describe the world
  ("no settlement of that id exists"), never the code.
- Be idempotent or explicitly reject a duplicate invocation. (Exact-duplicate
  detection currently lives in the session layer —
  `workflowInvocationKey`/`seenInvocationKeys` in
  [gm/session.ts](../packages/shared/src/gm/session.ts) — rather than being
  intrinsic to each command; see "Known gaps" below.)
- Validate its own authority and invariants: `invokerAuthority`,
  `scopeLimit`, and whatever the command's own `apply` checks against world
  state. `workflows/policy.ts`'s `validateCandidate` runs these before any
  mutation.

A command must **not**:

- Decide whether an actor "would want" to act, select targets, invent
  motives, or narrate outcomes. That is the Game Master's job, reading
  context the command has no access to.
- Modify display-only state. There is no such state to modify: see the
  worked example below.
- Accept arbitrary state paths, patches, templates, or untyped parameters. The
  one narrow, disfavoured exception is described in "Runtime-defined
  actions" below.

### Worked example: `start_war`

```
start_war(actorId, polityAId, polityBId)
  -> validates both polities exist and are not already at war
     (workflows/definitions/political.ts)
  -> adds one entry to WorldState.conflicts.wars
     (world/world-state.ts)
  -> returns a summary; the map derives red shared borders from the relation
     (apps/web/.../political-geometry.ts), never a stored "this border is red"
```

This is already how the codebase works, not a change this document proposes.
`conflicts.wars` is a war *relation* (`{polityAId, polityBId}`,
`map-presentation.ts`'s `MapWarSchema`) — a fact about two polities, not about
a border. Border colour is read off that relation at render time. There is no
`isAtWar`/`borderColor`/`redBorder` field anywhere in `packages/shared/src`,
confirmed by search. Every future command that produces a UI-visible
consequence should follow the same rule: store the fact, derive the
presentation.

### Projections in practice: `deriveWarBorderPaths`

The frontend already has a concrete, correct instance of the `projection`
class: `deriveWarBorderPaths`
([political-geometry.ts](../apps/web/app/games/[gameId]/components/political-geometry.ts))
takes the province-ownership state and `conflicts.wars` and derives the war
border SVG path fresh, every call — a pure function, unit-tested directly
([political-labels.test.ts](../apps/web/app/games/[gameId]/components/political-labels.test.ts)),
with exactly one call site
([game-shell.tsx](../apps/web/app/games/[gameId]/components/game-shell.tsx)).
Nothing caches a war-derived value separately from `conflicts.wars`, and
nothing else in the frontend re-derives war/border state independently. This
is the shape every future projection should take: one small, named, pure,
tested function, not logic inlined into a rendering component.

## The three-class taxonomy

- **`agent_action`** — a command the Game Master may call. In
  `WORKFLOW_REGISTRY` terms: `invokerAuthority` is undefined, or names any
  invoker other than exclusively `"system"`. `start_war`, `sign_treaty`,
  `move_force`, `appoint_to_office` are all `agent_action`s. Exposed to the
  model by `gm/tools.ts`'s `buildActionTools`.
- **`system_effect`** — a command only the deterministic pipeline/executor may
  invoke: `invokerAuthority` is exactly `["system"]`. Battle resolution, life
  events, and procedure resolution are `system_effect`s — the Game Master
  never sees them as tools, so it can never hand-resolve a battle or a death.
- **`projection`** — a read-only derivation with no `WORKFLOW_REGISTRY` entry
  at all: the `gm/read-tools.ts` inspection tools, and rendering/derived state
  such as war borders, siege markers, or political relations on the map.
  Never mutates; a projection that starts storing its own copy of a fact
  instead of deriving it has stopped being a projection.

Both `agent_action` and `system_effect` are the same
`WorkflowDefinition` shape; the distinction is which invokers may call it, not
a separate mechanism. This taxonomy is now one function, not two independent
checks:

```ts
// packages/shared/src/workflows/types.ts
export function commandKindOf(definition: AnyWorkflowDefinition): "agent_action" | "system_effect" {
  const authority = definition.invokerAuthority;
  const isSystemOnly = authority !== undefined && authority.length > 0 && authority.every((kind) => kind === "system");
  return isSystemOnly ? "system_effect" : "agent_action";
}
```

Before this, `gm/tools.ts`'s tool-surface filter and `workflows/policy.ts`'s
authority check each computed "is this workflow system-only" independently,
with slightly different phrasing (`every kind === "system"` vs. `some kind !==
"system"`). Both now call `commandKindOf`, so the two places that must agree
on this classification cannot silently drift apart.

No new field was added to any of the ~90 individual workflow definitions —
`invokerAuthority` already carried this information; this only makes reading
it explicit and shared instead of duplicated.

## Runtime-defined actions are a reviewed exception, not a fourth class

`gm/tools.ts` also defines `define_action`/`invoke_defined_action`
([workflows/invented-workflow.ts](../packages/shared/src/workflows/invented-workflow.ts)):
a way for the Game Master to describe a brand-new, named, parameterised action
as a list of patch operations, then use it. Every use is re-validated against
the whole world document exactly like a built-in command — the same
whole-world re-parse, the same dangling-reference check, the same protected
roots (`elapsedStep`, `pins`, `schemaVersion`, `playerPlans`,
`actorActivities`). It cannot call code and cannot reach outside the world
document. That is real, and it is why the mechanism is safe enough to keep in
code at all — but it is still a way for the model to manufacture a new kind of
mutation at runtime, which the command contract above says a command must not
be. It is not a fourth taxonomy class; it is a narrow, off-by-default,
developer-reviewed exception.

As of this document, `define_action`/`invoke_defined_action` are gated behind
`allowInventedActions` (`GameMasterSessionOptions`, default `false`; threaded
from `CHRONICA_ALLOW_INVENTED_ACTIONS=true` in
[pipeline.ts](../apps/web/lib/resolution/pipeline.ts)):

- Off (normal play): neither tool is offered to the model
  (`gm/tools.ts`'s `buildGameMasterTools`), and a call to either by name is
  refused without touching the staged world (`gm/session.ts`'s `invoke`
  dispatch) — defense in depth in case a stale tool list or a plan stage still
  names one. The supported path for an unanticipated player intent is
  `request_capability` ([gm/capability-request.ts](../packages/shared/src/gm/capability-request.ts)):
  it records the intent, why no registered command fits, and what a developer
  might build, and it changes nothing.
- On (developer rollout/testing only): both tools work exactly as before.

Existing invented-workflow definitions from earlier campaigns are historical
data, not a live capability: migration
[0029_game_master.sql](../packages/db/migrations/0029_game_master.sql) already
flips every persisted `invented_workflows` row to `status = 'disabled'`, and
`listActiveInventedWorkflows` therefore returns none for any campaign
regardless of the flag above. A campaign's own defined actions passed into a
session (`GameMasterSessionOptions.definedActions`) remain stored for lookup,
but `invokeDefinedAction` refuses to execute against them while
`allowInventedActions` is false.

**Removal criterion**: delete `define_action`/`invoke_defined_action`,
`applyInventedWorkflow`, and the `allowInventedActions` plumbing once no
active campaign has unreviewed defined actions and `request_capability` volume
shows the escape hatch isn't needed. Until then, this document — not
`docs/24`'s prior wording — is the accurate statement of what the mechanism
does and why it still exists.

## Refusals that correct a mistake, not just report one

A command's refusal is read by an AI that may still recover the turn — so it
must name the specific blocking fact, not fall back to a generic message.
`start_siege` ([military.ts](../packages/shared/src/workflows/definitions/military.ts))
was already the reference example: every failure names the settlement, force,
or province involved. `start_war`
([political.ts](../packages/shared/src/workflows/definitions/political.ts))
and `move_force` (same file) did not meet that bar, and now do:

- `start_war`'s already-at-war path calls `refuse()` naming both polities
  (`"${a.name} and ${b.name} are already at war."`) instead of `return null`,
  which previously degraded to the executor's generic "cannot be applied to
  the current world state."
- `move_force` moving a force to the province it already occupies now returns
  a `noOp: true` result naming where the force already is, rather than
  silently mutating nothing and reporting a move that didn't happen. This is
  the no-op idempotency case, not a refusal: no world change either way, but
  the caller can tell the two apart.
- `inspect_active_conflicts` ([gm/read-tools.ts](../packages/shared/src/gm/read-tools.ts))
  now gives a siege the same front-province field a battle already had, so a
  reaction doesn't require a second lookup from `settlementId` alone.

**Deliberately not done here**: `move_force` still has no adjacency, distance,
or route validation — moving a force to any province on the map still
succeeds regardless of where it starts. That is map-mechanic design (the
migration's own "map and control" domain step), not a refusal-wording pass,
and inventing a movement rule here risks one the domain migration then has to
redesign around. Likewise, `inspect_active_conflicts` still has no "possible
legal next actions" field — that needs an eligibility/authority computation
(who may end this siege, sign this treaty) that doesn't exist yet in reusable
form; building one ad hoc inside a read tool would be inventing a rules engine
in the wrong place.

## Idempotency and audit, made uniform

Exact-duplicate rejection is idempotency's enforcement mechanism here (docs/27
top): a command that already ran with the same actor and parameters this turn
is refused, not re-applied. That check is now `workflows/policy.ts`'s exported
`createInvocationDuplicateGuard()` — a small, source-agnostic guard any caller
can hold — rather than a private `Set` inside `GameMasterSession` gated to
`source === "game_master"` only. The gate previously meant a `system`-sourced
splice (the pipeline's own `resolve_battle` follow-up to `start_battle`) had no
duplicate protection at all; it now goes through the same guard as everything
else.

`GameMasterSession`'s per-call audit entries (`WorkflowAuditEntry` —
policy violation, dry-run/execution outcome, final invocation) are now
persisted: `turns.game_master_audit`
([schema/game.ts](../packages/db/src/schema/game.ts), migration
[0030](../packages/db/migrations/0030_game_master_audit.sql)), written by
`commitResolution` in the same transaction as the world snapshot.

**Correction (docs/29):** the sentence that used to stand here claimed
"nothing in the current pipeline populates" `turns.workflow_audit`. That
overstated it. `pipeline.ts`'s `finalWorkflowAudit.candidates` *is* populated
every turn — seeded from `gameMasterOutcome.auditEntries`, then extended with
the military-emergency fallback's and political-procedure-resolution's own
invocations — and is written to `workflow_audit` at commit. Only
`novelActionProposals` (the older Workflow-Manager blob's other field) is
hardcoded empty, which is what Step 3's [docs/28](28-diplomacy-and-map-control-audit.md)
was actually about. `game_master_audit` above is not a duplicate of this: it
carries only the current GM tool loop's own entries, without the fallback/
procedure entries `workflow_audit.candidates` mixes in, which is what makes
`workflow_audit.candidates`'s `sourceRef` field the right place to read a
military-emergency-fallback firing from (see docs/29).

## Known gaps (not fixed by this document)

- **No before/after world diff** is stored per call, anywhere, except the
  one-off `battleBrief` computed specifically for `resolve_battle`. A full
  diff per call is heavy (every command, every turn) for a benefit mostly
  covered already by the refusal message plus the executor's own summary;
  deliberately left out rather than added speculatively.
- **Structured effects are still informal**: a `summary` string plus whatever
  the command mutated in place and the now-persisted `WorkflowAuditEntry`, not
  a typed list of created/changed entity ids, conflict ids, or warnings.
  `start_war`'s refusal names the existing conflict, but nothing returns "war
  id X" as a structured field a caller could act on without re-reading the
  world.
- **Movement rules** (`move_force` adjacency/distance/route) and **legal next
  actions** (`inspect_active_conflicts`) are deferred with reasons above, not
  silently dropped.
