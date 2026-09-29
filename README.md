# Chronica

Chronica is a single-player historical world game. Play one person in a curated scenario, talk to the people they can reach, give orders in ordinary language, and read the Chronicle of what the world actually did.

```
write an order → the world carries it out and time passes → read what happened → write the next one
```

The world moves only when you send an order. Between them it is perfectly still.

The game accepts ambitious, conditional orders instead of a menu of verbs. The AI interprets intent and decides what the world does about it; the engine owns the arithmetic, the calendar, entity identity and the record, so consequences persist and stay consistent. The map is the world's stage, not a management screen.

## Documentation

- [Vision](docs/VISION.md) — the AI-native grand-strategy design this project is building toward.
- [Simulation Loop v1](docs/SIMULATION-LOOP-V1.md) — the engine that exists today: the AI↔code contract, the burst loop, and the reasoning behind each boundary.
- [Deletion plan](docs/plans/delete-chronicle-orders-turns.md) — a historical record of what the pre-loop wipe deleted and why.
- [Product guide](docs/product.md) — what the game is and how it plays today.
- [Architecture guide](docs/architecture.md) — how the system is put together.
- [Design](DESIGN.md) — how the interface looks and why: the lamplit room, its tokens, type and parts.

The documentation intentionally describes the current direction, not a chronological record of replaced proposals. Anything not yet built says so at the top.

## Run locally

On macOS or Linux, run `./hosted.sh`. On Windows, run `hosted.bat`. Each launcher installs the locked dependencies when needed and starts the website at http://localhost:3000. Stop the server with `Ctrl-C`.
