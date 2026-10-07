# NPCs that feel human: letters, moods, quirks, dispatches

Status: built on branch `chronicle-order-truth`. Tests: `letters-by-rule`, `letter-voice`, `perceive`,
`moods`, `quirks`, `dispatches`, `nature-binds`, `rulers-differ`, `every-seat-votes`, `lessons-of-state`.

## The rule

| Letter between | Written by | Model calls |
|---|---|---|
| NPC and NPC (any two powers) | Rules, from templates, in a voice the writer's mind chooses | none |
| Anyone and the player's circle | The model, as a person; the rules have already decided the substance | `voice_letters`, one batched call, at most `VOICE_CAP` (4) letters and dispatches a turn |

The model words a letter; it never decides what is in it. Every voiced letter is checked
(`keepsTheSubstance`): a named deadline must still be named, a threat of war must still say so, and a
letter that fails keeps its template. When the model answers a letter for an NPC on a large matter it
is told the answer his nature has already chosen, and `bindAnswerToNature` replaces a contrary answer
with the rule's own words.

## What each module does

- `disposition.ts` -- the ruler's whole mind as ten 0-1 numbers (greed, grudge, honour, fear, nerve,
  pride, steadiness, cruelty, sociability, vigour), read by every rule. Moods are added on top.
- `statecraft.ts` -- the world AI. War scores weigh each reason by the part of the ruler that answers to
  it; `roadToWar` writes complaint -> demand -> ultimatum first (a ruler of little honour gives no
  warning; a hot-tempered one starts at the ultimatum); `answerByRule` answers letters.
- `letter-verdict.ts` -- what a person would say to a letter, before anyone words it. Used by the rules
  (templates), by the model's prompt (so it words, not decides), and by the engine (to bring a model
  answer into line).
- `letter-craft.ts` -- templates: six tones (courteous, blunt, threatening, pleading, cold, evasive),
  sixteen intents, wording picked by a hash of the writer, so each man always sounds like himself.
- `letter-voice.ts` -- the model call for the player's letters and his own people's dispatches.
- `perceive.ts` -- what a ruler believes of a neighbour's strength: truth + a per-quarter error that grows
  with distance and shrinks with intelligence, plus pride and fear. Nobody knows exactly.
- `moods.ts` -- anger, grief, fear, elation, shame; put on a man by what happens to him, halve every 30
  days, move how the rules read him. Fed from `teach()` (every lesson) and from letter outcomes.
- `quirks.ts` -- two settled habits per man, fixed by his id (suspicious, generous, superstitious,
  stubborn, tender-hearted, long-winded, proverbial, devout, grudge-bearer, loyal friend).
- `dispatches.ts` -- the player's own commanders and treasurer write to him from real state (hungry,
  unpaid, outnumbered, wavering, treasury empty). A dishonest man may play it down or make it worse;
  the ledger never records which.
- `nature.ts` -- `conductInWords` (the model's "how you decide"), `natureObjects` (the gate on large
  acts), `bindAnswerToNature`.
- `ballots.ts` -- every chamber of every power votes seat by seat; a bloc is a faction's pull.
- `state-lessons.ts`, `mind-drift.ts` -- what a state's life teaches its ruler; ageing is personal.

## What is deliberately not visible

A ruler who says yes and never meant it is recomputed (`intendsToBreak`) from his id and the letter; it
is stored nowhere and no fact says it. A subordinate who shaded a dispatch is likewise not recorded.

## Not built

- Marriages and other kin-based diplomacy (the `marriage_offer` letter kind exists but nothing writes it).
- NPC rulers do not yet act on dispatches from their own commanders; only the player reads them.
- Counter-offers on peace terms between NPCs (the peace table handles those with the player).
