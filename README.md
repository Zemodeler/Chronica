# Chronica

**A historical world game where you play one person and can attempt anything.**

Chronica 1.0 is a single-player game. Choose a character in a curated historical scenario, speak with the people they can reach, and write several orders in ordinary language. The AI turns those orders into usable plans; the world then advances and the Chronicle records what happened.

```
choose a character → chat → write orders → world advances → read the Chronicle → act again
```

The player does not choose from a menu of permitted verbs. An order can be a long plan with priorities and conditions: demand surrender, march if it is refused, take supplies, and recruit survivors if victory makes that possible. The AI interprets that plan internally. Combat, movement, force control, territory, and hard resource limits remain rules-backed. Within typed limits, AI decides non-combat consequences such as negotiations, political reactions, recruitment, local conditions, and new events.

The world is active without waiting for the player. Each turn advances several persistent storylines—wars, tribal unions, rebellions, court factions, coups, alliances, expeditions, and crises. The Chronicle favours the character's theatre but includes major distant developments that can reshape their world.

## 1.0 boundaries

- **Single player first.** Multiplayer is a later implementation, not a 1.0 feature.
- **Curated scenarios first.** Built-in or validated authored worlds start games. AI world generation remains an authoring track.
- **Characters persist.** People remember encounters, carry relationships and ambitions forward, and can die or be succeeded.
- **Chat informs action.** Speech can reveal knowledge and create history; material commitments resolve through orders.
- **AI is bounded.** AI output names existing entities, records causes, and stays within scenario-defined limits. It cannot invent an army, hand over a province, or declare a battle result.

## Documentation

- [Documentation index](docs/README.md)
- [Project overview](docs/00-project.md)
- [Core gameplay loop](docs/01-core-gameplay-loop.md)
- [Implementation roadmap](docs/02-roadmap.md)
- [AI and game memory](docs/03-ai-and-game-memory.md)
- [World map](docs/04-world-map.md)
- [Phase 1 scenario](docs/05-phase-1-scenario.md)
- [NPC conversations](docs/06-npc-conversations.md)
- [Billing and coins](docs/07-billing-and-coins.md)
- [Open decisions](docs/08-open-decisions.md)

The repository contains a playable foundation. These documents define the intended product and identify where current contracts already support it; they do not claim every documented Phase 1 feature is complete.
