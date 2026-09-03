# Background material society (docs/14 Phase 2)

Phase 1 gave every order and NPC action a universal, persisted shape. Phase 2
closes the gap identified alongside it: nothing in the simulation modeled a
province materially. `Settlement.size` was, by its own comment, "coarse on
purpose" flavor text nothing read; there was no population, manpower, food
security, tax capacity, stability, displacement, or war damage anywhere in
the repository.

## The model

`ProvinceMaterialSchema` (`packages/shared/src/material-state.ts`) is one
compact, canonical record per province, added to `MaterialWorldStateSchema`
as `provinceMaterial: ProvinceMaterial[]`, defaulted to `[]` so no migration
is required -- the same additive-jsonb pattern every phase so far has used.
Two kinds of field, matching the redesign brief:

- **Counts:** `population`, `availableManpower`, `displacedPopulation`.
- **Basis points (10 000 = full baseline):** `productiveCapacityBps`,
  `foodSecurityBps`, `stabilityBps`, `warDamageBps` -- so every update moves
  a province by a *proportion*, not an absolute amount tuned per scenario.

`taxCapacity` is a money amount: the most a province's economy can plausibly
yield to taxation before diminishing returns (via `stabilityBps`) set in.

This does not model individual civilians, markets, or prices, and is not
meant to: it is a bounded pressure gauge that connects population and
production to food, wealth, taxes, manpower, and supply, which in turn
connect to army readiness, casualties, unrest, and eventually character
motives and Chronicle -- the chain from the redesign brief.

## Deriving and backfilling

`packages/shared/src/material/province-material.ts`'s
`deriveDefaultProvinceMaterial` derives a sensible starting record from a
province's settlements (`population = Σ settlement.size × 400`, manpower at
8% of population, tax capacity at half of population, and baseline
capacity/food/stability). `ensureProvinceMaterial` idempotently backfills any
province missing a record -- covering both a pre-Phase-2 snapshot (every
province is missing one) and a scenario that adds a province later. It is
called once per turn in `pipeline.ts`, before any workflow runs, so every
workflow this turn can rely on every province already having one.

## Detailed vs. coarse updates

Per the redesign brief: run detailed updates only for provinces actually
affected this turn; use a cheap, bounded, deterministic update everywhere
else.

- **Recruitment** (`applyRecruitmentToMaterial`) draws down
  `availableManpower` and briefly dents `productiveCapacityBps`, proportional
  to how large a share of the population was just recruited.
- **Taxation/requisition** (`applyTaxationDraw`) collects against
  `taxCapacity`, scaled down by current `stabilityBps` -- an unstable
  province simply cannot yield what its capacity alone suggests -- and the
  draw itself costs further stability, more so the larger a bite it takes.
- **War** (`applyWarDamage`) reduces population, food security, stability,
  and productive capacity, and raises war damage and displaced population,
  scaled by a per-event `severityBps`.
- **Recovery** (`applyCoarseRecoveryTick`) is the "elsewhere" pass: bounded
  per call regardless of how long a province went unattended (never an
  instant full heal after a long absence), it nudges food/stability/capacity
  back toward baseline, decays war damage, and resettles a small share of
  displaced population. The same tick also applies **food-shortage
  pressure** (docs/14 Phase 6): a province below `FOOD_SHORTAGE_THRESHOLD_BPS`
  keeps eroding its own stability and displacing a small trickle of
  population every idle turn, independent of any fresh attack -- famine is
  its own ongoing pressure, not only a consequence of the turn it started.
  Evaluated against the pre-recovery food level, so a province simultaneously
  healing from war damage and still hungry gets both effects, not one
  cancelling the other.

`advanceProvinceMaterial(world, atStep, affectedProvinceIds)` is the one
per-turn entry point `pipeline.ts` calls: it backfills, then applies the
coarse recovery tick to every province *not* in `affectedProvinceIds` --
provinces already updated at the point that affected them (a workflow's own
`apply()`, or the war-damage pass below) are left alone, so nothing is ever
double-applied.

## Connecting to treasury, recruitment, and war

Two new workflows (`packages/shared/src/workflows/definitions/material.ts`),
registered under a new `"material"` category:

- **`recruit_from_province`** reinforces an existing force from its own
  province's `availableManpower`, paid for from a real treasury account at a
  flat per-head levy-and-equipment cost (matching `create_force`'s own
  `size * 2` pay-obligation scale). It fails outright -- no partial effect --
  unless the force is actually located in that province, the province's
  controller matches the force's polity, the recruiting actor belongs to
  that same polity, enough manpower is available, the payer's account can
  afford it, and the actor actually has spending access to that account
  (the same `accountAccess`/`spend_without_vote`/`propose_spending` check
  `workflows/policy.ts` already applies to `remove_gold`/`transfer_gold`).
  This is what makes "a force can be raised only from valid recruitment
  areas" and "recruitment requires valid authority, procedure, territorial
  access, funds, stability, and capacity" real constraints rather than
  narration.
- **`collect_emergency_taxation`** levies against a province's tax capacity
  into a real treasury account, using the exact same transaction-ledger
  pattern `add_gold` already uses, and requires the collecting actor's
  polity to control the province. When the unrest it inflicts is meaningful
  (`>300bps` of stability, not a token draw), it also costs the collecting
  polity legitimacy (`material/legitimacy.ts`'s `adjustPolityLegitimacy`,
  shared with the battle resolver's own decisive-victory effect, docs/19) --
  taxation has a political cost, not only a provincial one.

Both route through the same `runWorkflowManager` → executor gate as every
other action (docs/14 Phase 1's invariant), so an unauthorised or
unaffordable attempt becomes a grounded `OrderRefusalFact` and Chronicle
entry, not a silent failure.

`pipeline.ts` also applies coarse war damage for this turn's successful
military workflows (`start_battle`, `start_siege`, a captured `end_siege`,
`blockade_port`), striking exactly the province the event happened in via
`applyWarDamageForExecutedWorkflows`, before running the coarse recovery
pass everywhere else. The severities used there are fixed placeholders --
Phase 3's deterministic battle/siege engine is expected to replace them with
severities derived from the real engagement; until then, a province that
reacts to war at all is preferable to material state that never moves.

## What this phase deliberately does not do

No individual civilians, no per-settlement markets, no commodity trading, no
global price solver -- exactly as the redesign brief specifies. No new
DB migration: `provinceMaterial` lives inside the same versioned jsonb
snapshot as everything else, defaulted for old saves.
