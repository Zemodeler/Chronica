# Operational warfare (docs/14 Phase 3, ADR-0031)

`warfare/battle.ts` already declared the full shape of a deterministic
combat system -- `BattleSchema`, `BattleResultSchema`, recorded random draws
for replay -- but nothing computed a `BattleResult`. A battle's actual
outcome went through the AI verdict/workflow path instead, which conflicted
with the redesign's core invariant (docs/14 §6): deterministic systems alone
decide material facts. This phase closes that gap, and adds the intra-province
positions the redesign's operational layer needs.

## Intra-province positions

A force's `locationId` said which province it was in, never where. Two
forces sharing a province could not be distinguished for rendering, and
nothing modeled a siege line as different from an open field. `Position`
(`PositionSchema`, `world/map.ts`, alongside `Province` to avoid a schema
import cycle) is that missing place: `settlement | outskirts | camp | pass |
road_approach | river_crossing | coast | harbour | siege_line | battlefield |
interior`, with a signed `combatModifierBps` (a siege line or a fortified
settlement favors whoever holds it) and an optional `capacity`.

`Province.positions` is optional -- a scenario may author positions that
matter. `warfare/position.ts`'s `fallbackPositionsFor` generates a
deterministic list for any province that doesn't: one `settlement` position
per settlement (its combat modifier scaled from `fortificationLevel`), a
generic `camp`, and a catch-all `interior`. `resolveForcePosition` always
returns a real position -- the force's own valid assignment, or the
province's default (its first settlement, or the interior) -- so assignment
never depends on iteration order and a replay always lands the same place.
`Force.positionId` (new, nullable, defaulted to `null`) is the only new
field on `Force`; no migration is needed for either addition.

Positions are deliberately not yet a player-facing "choose a position"
control -- the redesign brief is explicit that no tactical-unit UI should
exist. They currently matter only as an input to battle resolution below;
authoring them, and letting an order reference one (encamp at the pass, hold
the siege line), is real follow-on work.

## The deterministic battle engine

`warfare/battle-resolver.ts`'s `resolveBattle` is the function that was
missing: it takes real troop counts (by category, weighted by the
scenario's `TroopCategoryDefinition` when authored, a flat fallback
otherwise), commander skill and health, terrain (a small fixed defender
bonus by `terrainId`, pending scenario-authored terrain rules), position
(`combatModifierBps`, defender-only -- an attacker is by definition on the
move), a coarse supply signal (`Force.provisionStatus` plus, when
available, the province's `foodSecurityBps` from Phase 2's material layer),
and posture: `start_battle` accepts an optional `attackerPosture`/
`defenderPosture` (`offer_battle | avoid_battle | defend | hold`, docs/14
Phase 1's `OngoingAction.posture` narrowed to what the engine actually
understands), forwarded verbatim into the auto-queued `resolve_battle`
invocation. A side ordered to avoid battle fights half-heartedly if forced
into one anyway (a real strength penalty, and the contact phase's own
summary says so -- "forced into battle despite orders to avoid one"); a side
ordered to defend or hold fights with real resolve, stacking with terrain
and position. Every random element -- contact friction, commander fate -- is drawn from a
seeded PRNG (`createRng`, a small mulberry32) and recorded as a
`RecordedRandomDraw`, so calling it twice with the same seed and inputs
produces the exact same `BattleResult`, casualty ids included (an earlier
draft used `crypto.randomUUID()` for casualty-history ids and failed its own
determinism test; ids are now derived from `battleId:forceId:categoryId:kind`
instead).

It resolves the five phases `BattlePhaseSchema` already declared --
`contact, engagement, cohesion, withdrawal, aftermath` -- with a simple,
auditable exchange model: effective strength per side at contact; casualties
split dead/deserted/wounded (wounded feeds `ForcePersonnelCategory.unavailable`
with `causeKind: "wounds"`, eligible to recover at a real future step, never
just erased); a cohesion check against the scenario's `routCohesionBps`
threshold that can break a formation; a withdrawal phase that also allows an
orderly retreat for a side taking clearly disproportionate losses even
without breaking; and an aftermath that decides the outcome, rolls each side's
commander fate (a losing commander risks capture or death; a winning one
rarely does), and -- only on a decisive victory with heavy defender losses --
weakens (never flips) the defending province's `controlFirmnessBps`, since an
open-field defeat is not the same as losing a siege, and (docs/23) nudges
both polities' `PolityLegitimacy`. "Heavy defender losses" means
`defenderCasualtyRate > 0.15`: the exchange formula above caps a side's own
casualty rate at 0.20 as its opponent's strength share approaches 1, so this
threshold was originally set at an unreachable 0.25 -- fixed once testing
the legitimacy effect surfaced that it could never fire.

**Scope, stated plainly:** this does not yet accept `TacticalModifierProposal`s
-- a player or NPC's novel tactic. Every proposal a caller doesn't pass in
simply never reaches the engine, so `acceptedTactics` is always empty for
now. Wiring tactics in is real follow-on work, not a shortcut taken here.

## Wiring: `resolve_battle`

`workflows/definitions/battle-resolution.ts` registers `resolve_battle`
(category `"military"`, `invokerAuthority: ["system"]`). No
`WorkflowCandidateSource` maps to `"system"` in `workflows/policy.ts`'s
`SOURCE_TO_INVOKER`, so **no AI candidate can ever propose it** -- it can
only run the way `pipeline.ts` runs it: spliced directly into
`invocationsToExecute` immediately after every accepted `start_battle`,
bypassing `runWorkflowManager` entirely, the same precedent the existing
battle-proximity `move_force` auto-insertion already set. This is what makes
a battle's outcome unconditionally the engine's, never an AI's.

The workflow itself: looks up the battle's two forces and their commanders
from canonical state, the province and its adjacent provinces (for a retreat
destination) from the map graph, calls `resolveBattle`, then applies every
part of the result -- casualties, morale/cohesion/fatigue, retreats,
commander deaths/wounds/captures, the control-firmness change -- and removes
the battle from `conflicts.battles`. `summarizeBattleResult` turns the
structured result into one deterministic, chronicle-ready paragraph, used as
the workflow's own result summary; a fuller structured "battle brief" handed
directly to the Chronicle narrator (rather than a pre-flattened paragraph) is
Phase 4's job.

**Scope, again stated plainly:** only an exactly-two-participant battle (what
`start_battle` always creates today) is supported; a battle is required to
have both forces already co-located (the existing move-before-battle logic
guarantees this for the auto-queued path). Multi-force battles are a real
future extension, not assumed away by accident.

## Map rendering: offset and grouping

Two forces sharing a province do not automatically fight (docs/14's core
rule) -- so the map must not visually suggest they do just because their
markers would otherwise land on the same pixel. `map-dynamic-geometry.ts`'s
new `resolveMapForcePlacements` resolves every force's marker at once:

- Forces that are part of the **same deliberate group** -- both sides of a
  battle, or several forces jointly besieging one settlement -- keep the
  exact same placement and collapse to one marker with a count badge
  (`map-canvas-entities.ts`'s `drawForces` draws only the group's primary
  member, plus the badge; `geo-map.tsx`'s hit-target list does the same, so
  clicking the marker activates the group's primary force).
- Forces that merely happen to land on the same point, with no such
  relationship, get a small fixed-degree offset, fanned out around the point
  in a stable order (sorted by force id), so the same set of co-located
  forces always fans out identically across reload and replay.

A lone defender in a siege (only one force on that side) is never grouped --
grouping only ever combines forces that are genuinely acting together.

## What this phase deliberately does not do

No tactical-unit controls, no army-management screen, no player-facing
position-selection UI, no tactic-proposal integration, no multi-force battle
support. Each is real, identified follow-on work, not silently dropped scope.
