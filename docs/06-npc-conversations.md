# NPC conversations

## Phase 1 capability

The player can start a conversation with any NPC in the current game. The conversation panel supports two searches:

- **Name search** finds an existing character directly, including historical characters such as Hamilcar Barca or Scipio when that character already exists in the scenario or game world.
- **Role search** finds the person who holds a described role, such as `Legio X guard captain`.

At game start, the AI generates exactly three initial contacts appropriate to the player's confirmed character, social position, location, and immediate circumstances. They give the player immediate people to consult without limiting later conversations.

## Resolving a search

1. Normalize the player query and search the authoritative character records by name, known role, office, and scenario identity.
2. If one character matches, open a chat with that character.
3. If multiple candidates match, show the small candidate list and let the player choose.
4. If a role has no holder, create one scenario-appropriate NPC, give them a period- and culture-appropriate name, and persist their character record before opening the chat.
5. If the request cannot plausibly be reached, explain the limitation without exposing hidden world information.

For example, a search for **Legio X guard captain** opens the existing captain if that office already has a named holder. If it does not, the AI creates a named captain with a persistent character record and opens a provisional conversation. A later search finds the same captain rather than generating a duplicate.

## Character records and personality

Every chat target has a stable ID and record containing at least their name, role, location, political affiliation where applicable, public situation, relevant memories, and personality context. The record is part of the authoritative world state once committed; chat messages and meaningful encounters become immutable events and continuity inputs.

When an existing historical character is present, the AI uses the scenario's historical context and model knowledge to portray a recognizable personality, priorities, and circumstances. It does not claim perfect historical certainty or use live web retrieval. For fictional NPCs, it creates a consistent personality suited to their role, culture, position, and current pressures. Neither personality grants knowledge or power beyond the validated game state.

## Boundaries

- Conversation can disclose knowledge, establish promises, change relationships, or create narrative consequences.
- Speech cannot itself move resources, grant offices, transfer territory, or conclude material agreements. Those effects require validated orders and turn resolution.
- The player may request any plausible contact; the game does not promise that every request is immediately reachable.
- NPC search and creation belong to Phase 1. Phase 2 expands the resulting relationships with deeper ambitions, rivalries, families, secrets, and political networks.

## Current-contract alignment

The repository already models a contact request as either a target character ID or a role query, returns available/choice/unavailable contactability, and supports a provisional contact. Initial generated casts already require three to five contacts. Phase 1 implementation should extend that boundary into player-visible search, reliable role-holder creation, durable NPC records, and personality context rather than introduce a separate NPC store.
