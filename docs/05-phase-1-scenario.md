# Phase 1 example — The Numidian decision

The First Punic War is a demo scenario for testing the Phase 1 loop, not a hardcoded game mode. The player may enter **Claudius Appius Caudex**, described as a Roman governor and military leader. The model drafts a context for player confirmation from scenario knowledge and model knowledge.

Caudex has consolidated Roman power in Africa after a long war and has prevented Carthaginian landings in Sicily, where his seat of power is located. He considers action against Numidia.

## Player turn

1. The player opens conversations with high command to assess forces, morale, logistics, terrain, and Numidian advantages.
2. The player contacts a co-consul in Rome to request reinforcements.
3. The player submits an order: demand peaceful surrender; if Numidia refuses, advance by the viable route, preserve supplies, and seek integration terms after victory.
4. The resolver checks available forces, movement, supply, terrain, and the response to the demand. It resolves resistance, battle, occupation, destruction, surrender terms, and voluntary or forced incorporation only where the committed state permits them.
5. The next turn records any changes to provinces, control, settlements, armies, material resources, character memory, and wider storylines. Gallic unrest in the north may advance separately if active.

## Player-visible result

- Conversations report the reactions of commanders, the co-consul, and Numidian leaders.
- The authoritative world state and event log capture the resolution.
- Army and province state changes update the map: movement, battle, siege, damaged settlement, occupation, or ownership tint as appropriate.
- The Chronicle gives the event a title and historical narrative, for example:

> **The Numidian Submission**  
> In the third week of the campaign, Caudex's columns crossed the frontier after Numidian envoys refused the Roman demand. The fortified camps held the supply road while the local cavalry withdrew inland, leaving the border towns to negotiate their submission. Rome gained a precarious foothold beyond its African holdings, even as reports from the north warned of renewed Gallic disorder.

The example demonstrates how one decision creates military, political, personal, and narrative consequences without requiring tactical map control.
