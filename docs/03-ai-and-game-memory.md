# AI and game memory

## Responsibilities

Phase 1 uses a server-side OpenAI integration. It interprets player language, drafts character context, produces bounded reactions, and writes dialogue and Chronicle prose. It does not perform live web retrieval, and it must not be the authority for material facts.

When a player supplies a historical name, the model combines its knowledge with scenario facts to draft the character's historical context. When the player supplies an original description, it drafts a fictional character appropriate to the scenario. In both cases, the player confirms or lightly edits the short profile before play begins.

## Authority model

Structured, versioned world state plus an immutable event log are authoritative. A turn records entities, locations, forces, control, actions, relationships, material resources, and elapsed simulation time. AI context summaries, conversations, Chronicle entries, and display patches are derived artifacts.

This means a generated sentence cannot create an army, transfer a province, or contradict a committed event. If generated prose conflicts with state, state wins and the prose is regenerated or corrected.

## Turn pipeline

1. Load the saved scenario version and current world snapshot.
2. Construct the player-appropriate context from facts, memories, current actions, and active storylines.
3. Interpret dialogue or orders into constrained candidate actions.
4. Validate entity references and material limits; resolve deterministic rules.
5. Commit the next snapshot and immutable events.
6. Generate bounded dialogue, Chronicle, and map-display projections from the committed result.

Autosave after every committed turn. Save/load restores the latest valid snapshot and its scenario version; generated projections can be reproduced from that record.
