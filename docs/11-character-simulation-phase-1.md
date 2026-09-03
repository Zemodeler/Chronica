# Character simulation, phase 1: one canonical character

Before this phase, a runtime-discovered NPC (one found through dialogue's contact
search) lived only in `gameNpcRecords` and `npcChatKnowledgebases` — tables the
Simulator, Character Director, World Director, and Chronicle casting never
read. A dialogue insult changed a per-player `relationshipScore`; it never
touched the `RelationCause` ledger those directors actually consult. The two
halves of "the same person" could drift apart, and nothing a player said in
chat could ever be replayed as part of a committed turn.

Phase 1 establishes one rule and one boundary that close that gap.

## The rule: `WorldState.characters` is the only canonical character

Identity, life state (`alive`/`diedAtStep`), location, polity, office, assets,
directed relations, and agency eligibility all live on `Character` inside
`WorldState` (`packages/shared/src/characters/character.ts`) — the same
document the Simulator, Character Director (`selectRelevantCharacters`), World
Director, and Chronicle casting already read. Nothing else may hold a second
copy of any of those fields.

Dialogue-only descriptive material — biography, voice, presentation, a role
label — is cacheable and disposable, so it lives in its own projection:
`character_profiles` (`packages/db/src/schema/character-social.ts`,
`packages/shared/src/characters/character-profile.ts`), keyed by
`(gameId, characterId)`. It is never consulted by a director, and it never
carries relationship score, availability, or location — those are always
derived from the canonical `Character`.

`gameNpcRecords` is deprecated as a runtime source. `dialogue-service.ts` no
longer reads or writes it; the query function survives only as a read-only
path for the backfill script below.

## The boundary: `CharacterSocialEvent`

Dialogue can never mutate a `Character` directly. It can only propose a
`CharacterSocialEvent` (`packages/shared/src/characters/social-events.ts`):
a stable id (allocated once, at proposal time — never during replay), its
participants, a `kind` (`conversation` | `promise` | `insult` | `favour` |
`deception` | `discovery` | `rumour`), visibility and who already knows about
it, the relation causes and knowledge claims it would add, and — for a
`discovery` event only — the brand-new `Character` and `CharacterProfile` it
introduces.

The event has no field for a material, office, or territory effect. That is
structural, not a runtime check: a proposal that tried to grant money would
fail to parse.

Turn resolution (`apps/web/lib/resolution/pipeline.ts`, start of
`resolveTurn`) is the only place an event is ever applied:

1. Load every `proposed` event for the game (`listUnappliedCharacterSocialEvents`).
2. Validate every referenced character id against canonical `world.characters`
   (`applySocialEvents`, `packages/shared/src/characters/apply-social-events.ts`)
   — a reference to an unknown character is rejected, not silently dropped.
3. Apply the deterministic deltas: append each relation cause onto the
   subject's directed view of the target, append one `EncounterMemory`, and —
   for `discovery` — append the introduced character (idempotent by id).
4. That resulting world is what the rest of the turn (Simulator, Character
   Director, World Director, Chronicle casting) actually runs against.
5. After `commitResolution`, flip each event to `applied` with the committing
   `turnId` — guarded by `WHERE status = 'proposed'`, so a concurrent or
   repeated attempt to apply the same event is a no-op. This is the entire
   "cannot apply twice" guarantee; it lives in the query, not in application
   logic that could be bypassed.

A discovered NPC follows the same path: `discoverContact` builds a full
`Character` and `CharacterProfile` and proposes a `discovery`-kind event
instead of writing to `WorldState.characters` itself. The candidate pool for
"who can I contact" already includes that event's `introducedCharacter` before
resolution runs, so the same dialogue session can keep talking to them; the
next turn resolution is what makes them a first-class member of
`world.characters` for every director and for Chronicle casting.

## Dialogue reads canonical state, not a second store

- **Reachability**: `isCharacterReachable` (`packages/shared/src/characters/reachability.ts`)
  checks `character.alive` and, for an in-person channel, location — never the
  legacy `npcChatKnowledgebases.isAvailable` flag alone. A dead or
  out-of-reach character is rejected before any AI call.
- **Opinion**: `computeOpinion` (`packages/shared/src/characters/opinion.ts`)
  folds a character's directed `RelationCause`s into one number. The dialogue
  prompt reads this, not `npcChatKnowledgebases.relationshipScore`.
- **Consequences**: `proposeAndPersistSocialEvents` (`dialogue-service.ts`)
  replaces the old regex `detectConsequences` and the ad hoc relationship
  patch inside knowledge extraction with one structured, Zod-validated AI
  call. Every relation cause it proposes must name one of the two people
  actually in the conversation — anything else is rejected outright, which is
  what makes "excessive relationship changes" and "impossible knowledge"
  unrepresentable rather than merely discouraged.

`npcChatKnowledgebases` keeps only what genuinely is per-player, per-session
state that was never simulation truth: conversation memory, interaction
counts. It is not dropped in phase 1, but nothing new is written into its
`relationshipScore`, `isAvailable`, or biography-shaped fields.

## Migration

`scripts/backfill-npc-characters.ts` (`packages/db/src/queries/backfill-npc-characters.ts`)
is idempotent: for every game, it appends any `gameNpcRecords` character
missing from the latest world snapshot, initializes their continuity as
`ordinary`, and writes a matching `character_profiles` row — then recomputes
that snapshot's `stateHash`, the same in-place data-correction pattern the
existing coin-denomination migration (`0009_account_coin_wallet.sql`) used,
rather than minting a synthetic turn. Running it twice changes nothing the
second time: a character already present is counted as a duplicate and
skipped. `verifyNpcBackfill` re-scans afterward and reports any duplicate
character id or any legacy record still missing. Nothing is deleted from
`gameNpcRecords`.

## Known gap carried forward

Dialogue's prompt-building (`dialogue-prompt.ts`) still reads flavor text —
biography, goals, backstory — from the legacy `npcChatKnowledgebases` row
rather than from `character_profiles`, for a newly-enriched NPC. The
canonical-state changes in this phase (identity, reachability, opinion,
relation causes, discovery) do not depend on that read moving; a later pass
can repoint presentation entirely at `character_profiles` without touching any
of the simulation-truth boundary described above.

## Replay-safety fix carried alongside this work

`create_character_goal` and `create_character_plot`
(`packages/shared/src/workflows/definitions/character-agency.ts`) minted their
ids with `crypto.randomUUID()` inside `apply()` — non-deterministic across a
replay of the same recorded invocation. Both now derive their id from data
already fixed by the deterministic replay inputs (`world`, `params`, `atStep`)
instead. The one same-class case in the turn pipeline itself (a Chronicle-cast
brand-new character's id) is fixed the same way.
