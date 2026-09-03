# Chronicle depth and structured battle facts (docs/14 Phase 4)

Before this phase, every Chronicle entry -- a distant, consequence-free
rumor and the player's own decisive battle alike -- was narrated as exactly
one paragraph (`buildChronicleNarratorPrompt`'s prior instruction: "Rewrite
each event as one paragraph... max 300 words"). And a resolved battle
(docs/19 Phase 3's `resolve_battle`) had **no Chronicle entry at all**: it is
spliced directly into execution rather than proposed by any director, so
none of the existing Chronicle-producing streams (player directive,
character suggestion, reaction, simulator) ever picked it up. This phase
fixes both.

## Depth tiers

`packages/shared/src/chronicle/depth.ts`'s `deriveChronicleDepth` is the one
shared policy every Chronicle-producing stream now goes through:

- The player's own action, or anything explicitly flagged a major event
  (a resolved battle), or anything scored `playerRelevance: "high"` -> a
  **scene** (150-450 words: atmosphere, named participants, a decisive turn).
- `"medium"` relevance, or anything with a material consequence and at least
  some relevance -> a **paragraph** (50-180 words).
- Everything else -> a **dispatch** (8-40 words: a compact notice).

This is the concrete, Chronicle-facing piece of "unify the three
level-of-detail schemes" the redesign calls for. It does not merge the
Simulator's star/near/far/coarse polity tiers, the Reaction Director's
geographic adjacency, and the Character Director's continuity tiers into one
internal scheme -- those three still separately decide *whether* an event is
generated at all, and unifying that is real, larger follow-on work. What
this phase unifies is *how much space a generated event earns once it
exists*, regardless of which of those three produced it.

`buildChronicleNarratorPrompt` (`apps/web/lib/resolution/prompts.ts`) tags
every event line with `[DEPTH: <tier>, <word range>]` and instructs the
narrator to respect it per-entry rather than forcing uniform length; the
"each entry max 300 words" rule is gone, replaced by per-entry ranges.

Depth is wired for the player-directive, character-suggestion, reaction,
simulator, order-refusal (docs/14 Phase 1), and battle (below) streams.
Political-procedure, life-event, command-change, family-event, and
commitment entries do not yet set an explicit depth and default to
`"paragraph"` -- their prior, uniform behavior -- rather than guess at a
policy for each without dedicated attention; wiring them through
`deriveChronicleDepth` too is a small, identified follow-on.

## The missing battle chronicle

`pipeline.ts` now derives a `battleChronicle` array directly from this
turn's executed workflow log: for every successful `resolve_battle`, it
reconstructs attacker/defender, casualties, and retreat by diffing forces
before and after (the same pattern `commandChangeChronicle` already used for
command changes), and uses the resolver's own deterministic
`summarizeBattleResult` paragraph as the entry's body. Every battle entry
gets `depth: "scene"` and a real title -- `"Battle of <province>"` -- never
a generic template.

## The structured battle brief

Rather than handing the narrator only the pre-flattened summary string, a
battle entry now also carries a `battleBrief`: province, both sides' names
and commanders, the outcome, casualty counts, and who retreated -- the exact
facts `resolveBattle` decided, nothing more. The narrator prompt renders
this as its own `BATTLE BRIEF` line with an explicit instruction: use
exactly these facts, invent no tactic, unit, or result beyond them. This is
the "bounded structured battle narrative brief" the redesign calls for --
built from real battle inputs/outputs, not from the AI's own reading of a
prose summary.

## What this phase deliberately does not do

It does not give every Chronicle stream an explicit depth policy (see
above), and it does not merge the three directors' internal LOD schemes.
Both are identified, scoped follow-on work, not silently dropped.
