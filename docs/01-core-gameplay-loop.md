# Core gameplay loop

## One turn

1. **Orient.** The player reads the map, current status, prior Chronicle entries, and available conversations.
2. **Converse.** The player opens or searches for any NPC conversation, then asks AI-controlled characters about facts, risks, resources, or political support. Conversation can create knowledge and history, but material commitments require an order.
3. **Order.** The player writes one or more natural-language orders with priorities and conditions.
4. **Validate and resolve.** The game converts viable intent into rules-backed actions. It applies movement, forces, supply, morale, terrain, control, and other material limits before AI produces bounded political and narrative consequences.
5. **Persist.** The game commits the next structured world snapshot and immutable turn events, then autosaves.
6. **Reveal.** The map updates, relevant conversations react, and the Chronicle records the turn. The player begins the next decision.

## Resolution principles

- The player may attempt any plausible plan; AI does not invent armies, territory, or victories.
- Combat is high-level and narrated, not a player-facing tactical battle system.
- World events advance alongside the player's theatre when their storylines are active.
- Generated prose explains outcomes but cannot replace the stored facts that caused them.

## Chronicle format

Each significant event is an in-world historical record: a concise title followed by a third-person narrative paragraph. It names concrete actors, places, actions, reactions, and implications. Confirmed outcomes are written as fact; uncertain reports are identified as rumor or incomplete knowledge.
