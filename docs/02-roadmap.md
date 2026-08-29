# Implementation roadmap

## Phase 1 — Functional Map Game with AI

Goal: a playable single-player prototype in which a player-created character acts in a world represented by a living visual map.

1. Character prompt, AI-generated context, light player confirmation, and single-player game start.
2. Scenario loading, base image, aligned GeoJSON, map overlays, zoom, and read-only hover/focus behavior.
3. NPC search and chat: generate three circumstance-based contacts at game start, let the player find existing NPCs by role or name, and create a persistent, scenario-appropriate NPC when the requested role has no holder.
4. Conversations, natural-language orders, flexible turn clock, and rules-backed military resolution.
5. Persistent snapshots, event log, autosave, map changes, and Chronicle presentation.
6. First Punic War demo scenario for testing only; no game behavior is hardcoded to it.

Phase 1 is complete when a valid scenario visibly represents political control, settlements, forces, and the consequences of war without turning the map into a detailed management interface.

## Phase 2 — Character continuity and world expansion

Goal: deepen the personal and political simulation. Relationships, friendships, rivalries, family, ambitions, long-term personality, schemes, secrets, blackmail, diplomacy, internal politics, reputation, and legitimacy are potential features. Relationships and ambitions are the first priority; intrigue and politics are secondary additions. None are Phase 1 commitments until designed and approved.

## Phase 3 — Intentionally open

The first candidate direction is deeper simulation: administration, economy, logistics, or culture could make realm decisions more consequential. Other possible directions are more curated scenarios and eras for replayability, or creator tools for authored worlds. Select the direction after Phase 2 evidence establishes the player value and implementation cost.
