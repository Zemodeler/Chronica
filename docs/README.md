# Chronica documentation

Chronica is a single-player, AI-driven grand strategy game seen through one character. These documents are the implementation guide for the first playable version.

1. [Project overview](00-project.md)
2. [Core gameplay loop](01-core-gameplay-loop.md)
3. [Implementation roadmap](02-roadmap.md)
4. [AI and game memory](03-ai-and-game-memory.md)
5. [World map](04-world-map.md)
6. [Phase 1 scenario](05-phase-1-scenario.md)
7. [NPC conversations](06-npc-conversations.md)
8. [Billing and coins](07-billing-and-coins.md)
9. [Open decisions](08-open-decisions.md)
10. [NPC social dialogue and commitments](10-npc-social-dialogue-and-commitments.md)
11. [Character simulation, phase 1](11-character-simulation-phase-1.md)
12. [Character simulation, phase 2](12-character-simulation-phase-2.md)
13. [Character simulation, phase 3](13-character-simulation-phase-3.md)
14. [Actions, orders, and the unified resolution architecture](14-actions.md)
15. [Background material society](18-material-society.md)
16. [Operational warfare](19-warfare.md)
17. [Chronicle depth and structured battle facts](21-chronicle-depth.md)
18. [Interrupt and the Chronicles button](22-interrupt-and-chronicles-ui.md)
19. [Scenarios, diagnostics, and the test matrix](23-scenarios-diagnostics-and-tests.md)
20. [The Game Master](24-game-master.md)
21. [Living world and expressive narration](25-living-world-and-narration.md)
22. [Continuing plans and personal time](26-player-plans-and-personal-time.md)
23. [The command contract and taxonomy](27-command-contract-and-taxonomy.md)
24. [Diplomacy and map/control: a command-contract audit](28-diplomacy-and-map-control-audit.md)
25. [Military reaction and political choice](29-military-reaction-and-political-choice.md)
26. [NPC action selection: from deterministic execution to AI choice](30-npc-action-selection.md)
27. [Legacy retirement: closing out the migration's final step](31-legacy-retirement.md)

Confirmed decisions are stated directly. Future possibilities and unresolved choices are kept in the roadmap or open-decisions document.

## Local development

Use Node.js 22+ and npm 11+, then run:

```sh
npm run dev
```

This starts the web application on localhost. For a local launcher, use `hosted.sh` on macOS/Linux or `hosted.bat` on Windows; both start the same development server.
