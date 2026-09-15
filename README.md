# Chronica

Chronica is a single-player historical world game. Play one person in a curated scenario, talk to the people they can reach, give orders in ordinary language, and read the Chronicle of what the world actually did.

```
choose a character → converse → give orders → world advances → read the Chronicle → act again
```

The game accepts ambitious, conditional orders instead of a menu of verbs. AI interprets intent and directs the living world through workflows: MCP-style tools for reading and changing the world's data. A workflow defines the capability and its input contract; the AI decides when and why to call it. The engine validates the resulting world so records, references, and replay remain sound. The map is the world's stage, not a management screen.

## Documentation

- [Core vision](docs/CORE-VISION.md) — what this project is building toward (elastic time, the character system) and what the Chronicle/Orders/Turns/workflow-execution wipe removed and why.
- [Deletion plan](docs/plans/delete-chronicle-orders-turns.md) — what was actually deleted, relocated, and left broken for the next system to pick up.
- [Product guide](docs/product.md) and [Architecture guide](docs/architecture.md) — still describe the pre-wipe Chronicle/Orders/Turns loop; due for a rewrite against the current codebase.

The documentation intentionally describes the current direction, not a chronological record of replaced proposals. Anything not yet built says so at the top.

## Run locally

On macOS or Linux, run `./hosted.sh`. On Windows, run `hosted.bat`. Each launcher installs the locked dependencies when needed and starts the website at http://localhost:3000. Stop the server with `Ctrl-C`.
