# Chronica

Chronica is a single-player historical world game. Play one person in a curated scenario, talk to the people they can reach, give orders in ordinary language, and read the Chronicle of what the world actually did.

```
choose a character → converse → give orders → world advances → read the Chronicle → act again
```

The game accepts ambitious, conditional orders instead of a menu of verbs. AI interprets intent and directs the living world through workflows: MCP-style tools for reading and changing the world's data. A workflow defines the capability and its input contract; the AI decides when and why to call it. The engine validates the resulting world so records, references, and replay remain sound. The map is the world's stage, not a management screen.

## Documentation

- [Product guide](docs/product.md) — player experience, scope, content, and current priorities.
- [Architecture guide](docs/architecture.md) — authoritative rules, turn resolution, plans, time, data, and development notes.
- [Workflow reference](docs/workflows.md) — every built-in MCP-style world-data tool and its input contract.

The documentation intentionally describes the current direction, not a chronological record of replaced proposals.

## Run locally

On macOS or Linux, run `./hosted.sh`. On Windows, run `hosted.bat`. Each launcher installs the locked dependencies when needed and starts the website at http://localhost:3000. Stop the server with `Ctrl-C`.
