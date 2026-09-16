# Chronica

Chronica is a single-player historical world game. Play one person in a curated scenario, talk to the people they can reach, give orders in ordinary language, and read the Chronicle of what the world actually did.

```
choose a character → converse → give orders → world advances → read the Chronicle → act again
```

The game accepts ambitious, conditional orders instead of a menu of verbs. The AI interprets intent and decides what the world does about it; the engine owns the arithmetic, the calendar, entity identity and the record, so consequences persist and stay consistent. The map is the world's stage, not a management screen.

## Documentation

- [Vision](docs/VISION.md) — the AI-native grand-strategy design this project is building toward.
- [Simulation Loop v1](docs/SIMULATION-LOOP-V1.md) — the engine that exists today: the AI↔code contract, the burst loop, and the reasoning behind each boundary.
- [Deletion plan](docs/plans/delete-chronicle-orders-turns.md) — what the pre-loop wipe deleted, relocated, and left broken.
- [Product guide](docs/product.md) and [Architecture guide](docs/architecture.md) — still describe the pre-wipe Chronicle/Orders/Turns loop; due for a rewrite against the current codebase.

The documentation intentionally describes the current direction, not a chronological record of replaced proposals. Anything not yet built says so at the top.

## Run locally

On macOS or Linux, run `./hosted.sh`. On Windows, run `hosted.bat`. Each launcher installs the locked dependencies when needed and starts the website at http://localhost:3000. Stop the server with `Ctrl-C`.
