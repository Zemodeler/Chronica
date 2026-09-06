# Diplomacy and map/control: a command-contract audit

The migration doc behind [docs/27](27-command-contract-and-taxonomy.md) asks
each domain to be inventoried before being called migrated: every direct
write to the domain's world-state fields, marked as belonging to a registered
command or not. This document is that inventory for two of the six domains —
diplomacy and map/control — reached by repo-wide search for every write site
of `WorldState.diplomacy` and `WorldState.map.provinces[].controllerPolityId`.

**Result: both domains were already compliant with the command contract
before this document.** Every strategic write in both goes through a
registered workflow's `apply()`; deterministic code only produces pressures,
resolves already-AI-chosen procedure invocations, or derives read-only diffs.
Two loose ends turned up along the way, addressed below rather than left
implicit.

## Diplomacy inventory

| Command | File | `invokerAuthority` → kind | What it does |
|---|---|---|---|
| `send_diplomatic_message` | [diplomacy.ts](../packages/shared/src/workflows/definitions/diplomacy.ts) | none → `agent_action` | Validates sender/recipient/polities, appends a new message (`status: "awaiting_reply"`). Content, kind, and target are AI-supplied parameters; nothing here decides what the message contains. |
| `answer_diplomatic_message` | diplomacy.ts | none → `agent_action` | Validates the message exists and is unanswered, records the AI-chosen `answer`/`answerText`. "Sending decides nothing… what the answer is belongs to whoever answers it" (the file's own comment). |
| `withdraw_diplomatic_message` | diplomacy.ts | none → `agent_action` | Marks an unanswered message `answer: "ignored"` at the sender's own choice. |
| `start_war` | [political.ts](../packages/shared/src/workflows/definitions/political.ts) | none → `agent_action` | Adds one entry to `conflicts.wars`. Hardened in Step 2 to refuse by name when already at war. |
| `end_war` | political.ts | `["system"]` → `system_effect` | Removes a war entry. Deliberately not AI-selectable: peace requires a passed political procedure naming this as its linked workflow (docs/14 Phase 6) — a deterministic vote outcome replays an already-AI-chosen invocation, it does not choose the terms. |
| `sign_treaty` | political.ts | none → `agent_action` | Also removes a war entry (if active) and records treaty terms. Directly AI-selectable, unlike `end_war` — a simpler direct diplomatic act rather than a procedure-gated one. Noted here as a real asymmetry between two commands with overlapping effect, not a contract violation: both are typed, validated commands either way. |
| `give_territory` | political.ts | none → `agent_action` | Transfers province control by cession. Requires an *accepted* diplomatic message between exactly the two parties named — refuses otherwise, naming the mismatch. |
| `vassalize_polity` / `revoke_vassalage` | political.ts | none → `agent_action` | Creates/deactivates a tribute obligation between polities. |
| `arrange_marriage_alliance` | political.ts | none → `agent_action` | Records an alliance relation between two characters' polities. |

Deterministic code touching this domain, and what it actually does:
- `apps/web/lib/resolution/world-dynamics.ts`'s `advanceWorldDynamics` — raises
  `military_emergency`/`political_danger` **pressures** on a polity's leader.
  Never itself declares war, forces surrender, or answers a message.
- `pipeline.ts`'s `deriveDiplomaticEscalations` — turns a message's growing
  `refusalCount` into a `political_danger` pressure with scaling intensity.
  Still only a pressure; `game-master-prompt.ts`'s `constitution()` rule 10b is
  the *prompted* instruction telling the GM itself to escalate (mobilize,
  ally, raid, siege, declare war) on repeated refusals — the pressure/prompt
  pairing this migration wants, not a deterministic auto-escalation.
- `character-agency/political-resolver.ts`'s procedure resolution — computes
  pass/fail deterministically from vote-bloc math (with a `stableHash`
  tie-break), then replays `procedure.linkedWorkflowId`/`linkedWorkflowParams`
  that were fixed when an AI sponsored the procedure. It never invents or
  alters treaty terms, only authorizes an already-chosen invocation.
- No direct/inline mutation of `WorldState.diplomacy` exists outside the three
  message workflows' `apply()` functions — confirmed by search; every other
  reference (`gm/memory.ts`, `polity-leadership.ts`, `give_territory`'s own
  authorization check) only reads the array.

## Map/control inventory

Every `map.ts` workflow, all `agent_action` (`commandKindOf` finds no
`invokerAuthority` restricted to exactly `["system"]`; `found_settlement`
restricts to `["world_director"]`, a non-system invoker, so it stays
`agent_action`):

`change_province_control`, `weaken_province_control`, `fortify_settlement`,
`rename_province`, `found_settlement`, `raze_settlement`, `cede_settlement`,
`split_province`, `merge_provinces`, `change_province_tier`,
`fortify_province_capital` — all in
[map.ts](../packages/shared/src/workflows/definitions/map.ts).

Plus, from other files: `give_territory` and `declare_independence`
([political.ts](../packages/shared/src/workflows/definitions/political.ts))
and `end_siege`'s successful-capture path
([military.ts](../packages/shared/src/workflows/definitions/military.ts)),
which validates that at least one living besieging force remains and that the
new controller was actually among the besiegers before flipping
`controllerPolityId`.

`change_province_control` itself is not an unguarded annexation path: it
refuses unless the ground is verifiably undefended (no living opposing force)
*and* the claiming polity already has a living force physically present — the
"unopposed advance" case, not a bypass of a real defender.

`resolve_battle` ([battle-resolution.ts](../packages/shared/src/workflows/definitions/battle-resolution.ts),
`invokerAuthority: ["system"]` → `system_effect`, correctly not AI-selectable)
only ever weakens `controlFirmnessBps` on a decisive victory
(`battle-resolver.ts`'s `siegeAndControlChanges`) — a field battle alone never
reassigns a province's controller outright; only a command can.

`pipeline.ts`'s `autoResolveDecidedStorylines` and `buildDisplayPatch` read
and diff `controllerPolityId`/force `locationId` before/after a turn, but
never write either — the first reacts to a control change a command already
made (resolving a storyline whose stakes were the province in question), the
second only builds a UI diff. Confirmed by search: no inline `.map(...)`
transform in `pipeline.ts` sets a province's controller or a force's
`locationId` outside `executeWorkflow`.

**Occupation, out of scope**: there is no stored "occupied" flag distinct from
a force's `locationId` today.
[region-control.ts](../packages/shared/src/world/region-control.ts)'s
`RegionControlGroundsSchema` already reserves `"occupation"` as a future
ground for a `change_region_control` workflow that does not exist yet ("ADR
pending" per its own header). Nothing currently violates the command contract
here because there is no field yet to violate it — noted so that workflow, if
and when it's built, is built as a proper typed command from the start rather
than retrofitted.

## The two loose ends

### 1. `military-emergency-fallback.ts` — a temporary, documented exception

[apps/web/lib/resolution/military-emergency-fallback.ts](../apps/web/lib/resolution/military-emergency-fallback.ts)
is a deterministic, non-LLM fallback: if nothing answered a
`military_emergency` pressure this turn, it deterministically picks
`move_force`/`create_force` (never `start_war`, never a diplomatic answer) so
an invaded polity always takes *some* legal response. This is precisely what
the wider migration plan itself names as an allowed, temporary exception:
*"Military emergency fallback: Remove once the AI reliably reacts to
incursions through commands. Keep it only as a temporary rollout safety
net."*

**Disposition**: kept, unchanged in behavior. Its header comment now states
the removal criterion explicitly — no code path change, since removing an
active safety net on the strength of a code-reading audit alone, with no
shadow-turn evidence the GM covers every invasion, would be a real gameplay
regression risk this document cannot verify.

### 2. `temporary-patch.ts` — dead code from the retired pipeline, removed

[workflows/temporary-patch.ts](../packages/shared/src/workflows/temporary-patch.ts)'s
`applyTemporaryWorkflowPatch`/`validateTemporaryWorkflowPatchReferences` was a
generic, four-operation-kind patch applier (`account_delta`,
`province_control`, `character_state`, `create_storyline`) built for the
retired Workflow-Manager/director-committee pipeline's "novel action
proposal" mechanism. Repo-wide search found **zero call sites** for
`applyTemporaryWorkflowPatch` anywhere — no production code, no test — and
the one path that could have reached it,
`NovelActionProposalSchema.temporaryPatch`
([manager-types.ts](../packages/shared/src/workflows/manager-types.ts)), is
also dead: `pipeline.ts` hardcodes `novelActionProposals: []` on every turn,
so no current turn ever produces one.

This was a second, unreachable "generic patch" capability of exactly the
shape the command contract forbids — unlike `define_action`, it was never
wired into the live GM tool loop, so there was no flag to gate; it was simply
dead code left over from the pipeline this architecture replaced.

**Disposition**: the two functions are deleted. The schema/type
(`TemporaryWorkflowPatchSchema`) stays, because `NovelActionProposalSchema`
still needs it to parse any pre-GM-refactor `novelActionProposals` rows a
campaign might carry — the same "keep the type, remove the executable path"
treatment `invented-workflow.ts` already received.
