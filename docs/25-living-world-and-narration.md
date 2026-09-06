# Living world and expressive narration

The narrator can stage recorded events with sensory detail, pacing, and restrained gestures. Recorded quotations may appear as direct speech; without a source quotation, speech stays indirect. Scene entries can develop a moment, while dispatches remain short. Entries no longer need an invented cliffhanger. Material outcomes, promises, secrets, relationships, and the player's decisions still require recorded facts. Atmosphere is presentation and is never folded back into campaign memory as a new event.

`world-development-scheduler.ts` runs before character selection and the Game Master, through `advanceWorldDynamics`. Its optional `worldDevelopments` snapshot collection loads compatibly with old saves and persists review dates, source identities, responsible characters, intensity, and active/resolved status.

Current sources:

- Provincial food security below 4,000 creates provisioning pressure.
- War damage of at least 1,000 or displaced inhabitants create reconstruction pressure.
- Existing institutions receive recurring administrative reviews every four steps.
- Each side of an active war receives a supply/defense/diplomacy review every two steps.
- Active households in food-insecure provinces create private provisioning pressure for their living heads.

Reviews are deterministic and capped at twelve per turn, oldest due first. Unresolved acute needs gain bounded intensity. Removing a source resolves its associated pressure. The same source reuses its development and pressure identities if it recurs. Unchanged reviews remain in state without generating a new Chronicle entry. Household needs never emit public development events. Resolved development history is bounded to 64 records.

Up to three rotating background characters are added to the normal relevance selection, with at least two available actions each. The GM receives reviewed public concerns and is instructed to consider background responses before a long player plan. These allocations create opportunities; they do not guarantee that an NPC finds a viable action or that the model uses every allocation. Scheduled pressures advance even when no model action occurs. Existing provincial recovery/shortage mechanics continue to own population, food, stability, and displacement; this scheduler does not double-apply them or invent relief payments. Relief, political decisions, and military responses still require executed actions.

This implementation does not add a market-price model, trade routes, automatic marriages, or random harvest disasters. Those can supply new causes later, once their resource rules exist.

## Proposed playable scenes (not implemented)

A scene would be a durable encounter with location, participants, visibility, elapsed time, and an unresolved situation. The player could write speech or a physical attempt into one input. A scene director would route speech to the appropriate NPC and consequential attempts to the same validated action system used by orders.

After each exchange, accepted social events, beliefs, commitments, and material changes would commit together. Narration would render that accepted result, then wait for the player's next response. A pause or reload would resume the same encounter. A scene would never decide the player's feelings, words, or commitments for them.

Example: a feast order arranges the gathering; its scene opens with the actual attendees. The player questions a merchant, offers protection, or leaves. An NPC can counteroffer or withhold information. A promise becomes a persistent commitment, while any funding transfer needs a validated action. Ending the scene returns to the strategic map; the Chronicle summarizes its recorded events and later turns process the resulting obligations.

Scene time would accumulate on the world clock at defined boundaries, with appropriate background updates and interruptions. Repeated conversation would not provide unlimited actions while the rest of the world remains frozen.
