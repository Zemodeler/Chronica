# Character simulation, phase 2: perception, relationships, and motives

Phase 1 made every consequential character canonical and gave dialogue one
replayable boundary — the `CharacterSocialEvent` ledger — into simulation.
Every character was still psychologically identical, though: no drives, no
pressures, one flat opinion score, and a proven bug where the Character
Director's own private-state filter hid a character's private goals and
plots from that same character's advisory context. Phase 2 gives every
character a private mind, pressures, multidimensional relationships, and an
individually-owned belief store — and answers, for any reply, "why did this
character respond this way?"

## Four kinds of state, one boundary

**World truth** lives on `Character` inside `WorldState`
(`packages/shared/src/characters/character.ts`): identity, life state,
location, office, directed relations, and now `mind`
(`packages/shared/src/characters/mind.ts`) — drives, temperament,
risk tolerance, values, taboos, and a bounded pointer cache into the
character's active pressures. `world.characterPressures[]`
(`pressures.ts`) and `world.socialLinks[]`
(`relationship-dimensions.ts`) sit alongside it as their own top-level
arrays, the same pattern `characterGoals`/`characterPlots` already used —
no new table, just an additive, `.default([])`-guarded field, so an
archived snapshot from before this phase still parses.

**Shared knowledge pools** (`packages/shared/src/dialogue/dialogue.ts`,
`SharedKnowledgebaseEntrySchema`) remain a discovery/performance mechanism —
a durable record of what was said and where. They are never themselves
knowledge: sharing a pool entry no longer means every resolved NPC can speak
it.

**Individual beliefs** (`packages/shared/src/characters/beliefs.ts`,
`world.characterBeliefs[]`) are what a character actually, authoritatively
knows. A belief is granted only through a named `KnowledgeChannel`
(`direct_witness`, `event_participant`, `public_announcement`,
`trusted_report`, `ordinary_rumour`, `private_disclosure`,
`intercepted_secret`), each with its own default confidence and visibility
and its own recipient rule (`resolveRecipients`). A secret's channel never
resolves a broad recipient list — that is what keeps "never universally
known merely because it exists in a world event" true rather than aspirational.

**Relationship causes** (`RelationCauseSchema`, extended) still never
collapse into a bare score. Each cause may now also carry a `dimensions` map
— `trust`, `affection`, `fear`, `respect`, `obligation`, `reputation` — so a
threat and a kindness move different things. A pre-phase-2 cause with no
`dimensions` map is read as contributing its bare `score` to `affection`
only (the documented legacy default); nothing is deleted or rewritten to
backfill this — the migration is a read-time interpretation rule, not a data
rewrite. Typed `SocialLink`s (`kin`, `spouse`, `friend`, `patron`, `client`,
`rival`, `commander`, `subordinate`, `creditor`, `debtor`, `ally`, `enemy`)
sit alongside the causal ledger for durable role-shaped ties; multiple kinds
between the same pair are normal.

## The boundary, extended

Dialogue still cannot mutate a `Character`, a pressure, or a belief
directly. `CharacterSocialEvent` (`packages/shared/src/characters/social-events.ts`)
gained `proposedBeliefs` and `pressureChanges` alongside Phase 1's
`relationCauses`/`commitmentProposal`; `applySocialEvents`
(`apply-social-events.ts`) validates and applies all four through the same
per-event accept/reject loop and the same DB-level
`WHERE status = 'proposed'` idempotency guard. A belief proposal is rejected
outright if it names a recipient with no connection to the event (not a
participant, not a witness); a pressure change is rejected if it references
an unknown character. No new application pathway exists.

Turn resolution (`apps/web/lib/resolution/pipeline.ts`) integrates pressures
at two points: `advancePressureLifecycle` runs immediately after applying
social events, before Character Director selection, reviewing/decaying/
expiring anything due; `derivePressureTriggers` runs after workflows execute
and commitments resolve, deriving this turn's own pressures — an injury
(a sharp `healthBps` drop), a debt (an account crossing negative), a public
humiliation (an applied `insult` event, or a commitment broken because its
promiser died), a military emergency (the character's polity at war), or a
political opportunity (an office vacated matching another character's
ambition) — purely from outcomes already validated and applied this same
turn. These become visible to *next* turn's character selection and
director context, the same committed-then-consumed-next pattern
`characterRelevance`/`chronicleChains` already use.

## Subjective context

**Dialogue** (`apps/web/lib/dialogue-prompt.ts`, `dialogue-service.ts`) now
builds the speaking NPC's own mind/temperament/pressures and their own
beliefs (via `queryBeliefs`, ranked by confidence) into the system prompt.
The old unconditional "things your network knows" dump is gone; a pool entry
is speakable only once the NPC actually holds a matching belief. The
structured AI output that used to propose only relation causes and a
commitment now also proposes beliefs (with an explicit channel) and a
pressure change on the speaking NPC alone — validated the same way: an
unknown recipient or an unknown character is rejected before persistence.

**The Character Director** (`apps/web/lib/resolution/character-director-prompt.ts`)
had a real bug: `characterContext()` filtered every goal, plot, and
encounter by `visibility !== "private"` unconditionally, including when
building a character's own context block — a character's own private plot
was invisible to their own advisory reasoning. The filter is now `visibility
!== "private" || characterId === charId`: private state is visible only in
the block belonging to that same character, still invisible in every other
character's block (the function is called once per selected character, for
that character). The block also now carries that character's own
drives/temperament/active pressures/top beliefs.

## Scenario authoring

`mind`, `traits`, `characterPressures`, `socialLinks`, and
`characterBeliefs` are plain fields any scenario file can populate directly
— no new authoring-schema layer, matching how `Character[]` and `WorldState`
are already authored as literals in `packages/db/src/built-in-scenarios.ts`
and `punic-wars-scenario.ts`. `punic-wars-scenario.ts` now authors a small,
deliberately differentiated set: Hieron II (cautious, status- and
duty-driven, an authored `political_danger` pressure and a `suspicion`
belief about Roman intervention) and the Mamertine spokesman (bold,
security- and revenge-driven, an authored `military_emergency` pressure),
linked by a `rival` social link and directed relation causes with
dimensioned fear/trust/respect deltas — proving the fields are authorable
without hardcoding any engine behavior to them.

## Diagnostics

`buildCharacterInspectorView` (`packages/shared/src/characters/inspector.ts`)
assembles one character's canonical identity, mind, traits, active
pressures with provenance, every meaningful relationship (all six
dimensions plus strongest causes), beliefs, commitments, and continuity
tier. It is exposed only via an admin-gated diagnostics route,
`GET /api/admin/character-mind/[gameId]/[characterId]`
(`apps/web/app/api/admin/character-mind/[gameId]/[characterId]/route.ts`),
following the same admin-role-gated pattern as the existing invented-workflow
admin routes. It is never linked from ordinary player UI.

## Migration

No new database table: `mind`, `characterPressures`, `characterBeliefs`,
and `socialLinks` all live inside the existing `worldSnapshots.state` JSONB
blob, additive and `.default(...)`-guarded, so `WORLD_SCHEMA_VERSION` did
not need to change (it exists to mark a shape change that needs a reader-side
upgrade; a purely additive, default-filled shape needs none). The one actual
DB migration, `0028_character_social_beliefs_pressures.sql`, adds
`proposed_beliefs`/`pressure_changes` JSONB columns (default `'[]'`) to the
Phase 1 `character_social_events` table, hand-written for the same reason as
Phase 1's migration (this environment's drizzle-kit needs an interactive TTY
it doesn't have).

`backfillCharacterMinds` (`packages/db/src/queries/backfill-character-minds.ts`,
run via `scripts/backfill-character-minds.ts`) is the mind-specific
counterpart to Phase 1's `backfillNpcCharacters`: idempotent, it replaces any
character whose `mind` is still exactly the flat `NEUTRAL_MIND` schema
default with one `deriveDefaultMind` computes from their role, skills,
office, age, and culture, and leaves every other character — one already
authored, or already backfilled — untouched.

## Known gap carried forward

Autonomous goal scoring or planners, factions/voting, family/marriage/
succession, and player-facing secret inspection are explicit non-goals of
this phase, deferred to later phases. Dialogue's prompt-building still reads
some flavor text (biography, backstory) from the legacy per-player
`npcChatKnowledgebases` row rather than `character_profiles` — the same
carried-forward gap Phase 1 noted; none of this phase's canonical-state work
(mind, pressures, relationships, beliefs) depends on that read moving.
