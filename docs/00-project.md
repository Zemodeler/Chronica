# Project overview

## Product

Chronica is a single-player, AI-driven grand strategy game played as an individual inside a living historical-style world. The player makes political, military, and personal decisions through conversations and natural-language orders. Rules resolve material outcomes; AI helps interpret intent, simulate bounded social consequences, and write the resulting history.

The main screen is an atmospheric, map-first world view. Small panels open from buttons along the left-middle edge for conversation, orders, Chronicle, character, and world status. The map communicates the state and consequences of the world; it is not a management screen and Phase 1 never issues orders through it.

## Core player experience

1. Enter a character name or short description.
2. The server uses the OpenAI model and scenario knowledge to draft a historical or fictional character context; there is no live web lookup in Phase 1.
3. Confirm or lightly edit that profile, then enter the world.
4. Speak with reachable characters, assess the situation, and submit ordinary-language orders.
5. Review the AI-resolved turn through the map, status, conversations, and Chronicle; the game autosaves.

Time advances flexibly: a turn covers the days or weeks needed to resolve the submitted orders, not a fixed calendar interval.

## Design lesson, not a template

Pax Historia demonstrates the value of making player actions legible on a changing map and letting AI-controlled actors react, so outcomes become history rather than a fixed narrative path. [Its launch description](https://www.ycombinator.com/launches/PMu-pax-historia-user-ai-powered-gaming-platform) describes map changes after actions and AI responses by other actors. Chronica applies that lesson through original art, writing, systems, and interface: character-centered play, validated state, and rules-backed material outcomes.

## Phase 1 boundaries

Phase 1 is a playable prototype with character creation, one-player games, conversations, natural-language orders, turn resolution, a visual map, provinces, realms, settlements, forces, wars, occupation, destruction, persistent memory, and a Chronicle. It does not include map orders, tactical battle control, live historical research, or a required road layer.
