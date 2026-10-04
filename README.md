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

### Develop using your Codex allowance

In the browser, open **Account → Local AI provider → Switch**, select **Codex allowance**, choose a model (GPT-6 Luna by default), and save. Chronica installs the CLI and reuses your login or opens ChatGPT sign-in before saving the choice. The selection applies to all games on this local server and persists across restarts. You can switch back to a configured OpenAI or Anthropic API provider in the same dialog. This setting is restricted to developer/admin accounts on local development servers.

Run `npm run dev:hand` (optionally `-- --model gpt-6-luna`), or set `CHRONICA_AI_MODE=hand` in the root `.env.local` and start the server normally. Chronica automatically downloads its own pinned Codex CLI on first startup and reuses an existing ChatGPT CLI login when available. Otherwise it opens ChatGPT sign-in. Sign in once; subsequent starts reuse that login. No global CLI installation or API key is needed. The existing Node/npm and database requirements still apply.

Requests are answered automatically by `gpt-6-luna`, with a fresh session for each request. To select another available Codex model, set `CHRONICA_HAND_MODEL`. This consumes your shared Codex allowance. Errors or exhausted limits never fall back to a paid API. The server logs installation, sign-in, readiness, and pending prompt paths.

Reasoning defaults to **low**. API and CLI simulation calls share prompt preparation, reasoning selection, strict output schemas, JSON normalization, and one malformed-answer correction. An existing selection or `CHRONICA_HAND_EFFORT` still overrides that default; operation overrides apply to both transports, including `CHRONICA_AI_CHRONICLE_EFFORT`. Orchestration, NPC decisions, Chronicle writing, and reconciliation return JSON objects directly. Each uncached CLI attempt logs its duration and token usage. NPC decisions use up to three balanced parallel groups, avoid reconsidering unchanged circumstances, and request compact answers. Context trimming retains unique news and active obligations. Plans can track approved projects through actual completion without another decision about that work. The three-minute target concerns completing the work, rather than cutting a turn off. The latest uncached 30-day CLI sample took 8m54s; earlier samples took 5m55s and 7m18s. These individual runs have not established a speed gain from the latest changes, and the target remains unmet. See `docs/plans/simulation-speed-baseline.md` for measurements and reproduction instructions.

The CLI and any new subscription login live under `.cache/chronica-codex` in the server's working directory. Existing ChatGPT CLI logins are reused from `CODEX_HOME` or `~/.codex` without copying credentials or changing that configuration. Prompts and answers live in `CHRONICA_HAND_DIR` (default `eval-out/hand`). Identical requests replay from disk. System instructions and model selection are included in automatic cache keys. Delete the answer directory to obtain fresh answers. Automatic hand mode is development-only.

For manually authored fixtures, set `CHRONICA_HAND_RESPONDER=manual`. Evaluation scripts retain their manual default unless explicitly configured otherwise.
