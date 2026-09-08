# Architecture guide

## Source of truth and authority

The committed `WorldState` is canonical. The Game Master is the sole AI authority for interpreting intent and choosing NPC or political responses, but it is never the authority on what the database says or on bypassing rules. A Game Master session works on a discardable copy of the world. Every material mutation goes through a typed workflow; its parameters, actor, authority, scope, references, and result are checked before the staged state is accepted. One transaction commits the final world, factual events, audit information, memory, capability requests, and Chronicle entries.

This gives each question one owner:

- The Game Master interprets intent, judges feasibility where the world cannot decide it mechanically, and chooses lawful actions.
- Workflow code owns preconditions and state changes.
- The scenario and committed state establish facts, people, places, and resources.
- The clock and scheduler decide how time is represented and when play should stop.
- The Chronicle renders facts after resolution; it cannot alter them.

No generic state-patch tool is exposed. Unsupported intent is recorded through `request_capability` for developer review, without changing the world. The older runtime-defined-action mechanism remains disabled in normal play; it is not part of the supported action surface.

## Turn resolution

The resolver prepares the world, runs the Game Master tool loop, resolves due deterministic procedures, builds facts and Chronicle entries, then commits. Tool calls are bounded so an otherwise successful turn can commit useful work even when a budget is reached.

Read tools expose compact, factual views of the world, characters, forces, provinces, polities, conflicts, history, and actor memory. Action tools are generated from the registered workflow catalogue. System-only workflows, such as deterministic battle or life-event resolution, are never offered to the Game Master as tools.

Each accepted action produces a factual event with its actor, parameters, material consequence, summary, and state deltas. A failed action leaves staged state unchanged and returns the exact rules-backed reason to the Game Master. Whole-world validation and delta reference checks prevent a workflow from introducing dangling identifiers while still allowing legacy snapshots to load and be repaired.

## Plans, interpretation, and conflicts

`ActionPlan` and `ActionPlanStage` are the common model for player, NPC, and world-originated work. Stages retain their status and fact references. They can wait on dependencies, recur when explicitly scheduled, and reserve named resources. Terminal stages never reopen, and revising a plan never reverses a committed effect.

An order's text is immutable evidence of intent. Interpretation records claims separately from stages. A contradicted world premise is refused; a request for clarification does not modify stages. The feasibility service is intentionally advisory: it reports only checks the engine can honestly perform, such as a living actor, known location, resource control, workflow support, and a contradicted premise. It cannot become a second mutation authority.

Conflict handling is deterministic where resource identity is clear. Its precedence is new instruction, revision, existing plan, delegated work, NPC self-direction, then world background. Preemption interrupts or supersedes unfinished work and releases reservations; it leaves completed and failed work intact. Semantic conflict that cannot be grounded in a contended force, office, account, or character remains a Game Master judgment rather than a fabricated rules engine.

## Workflows and command rules

Every registered workflow declares its schema, authority, deterministic `apply` behaviour, and, when appropriate, an estimated duration. The catalogue distinguishes:

- Agent actions, which the Game Master may invoke for a living actor.
- System effects, which only deterministic resolution may invoke.
- Projections, which derive information and never mutate state.

The same policy protects all invocations: valid parameters, living actor, permitted authority and scope, resource access, and duplicate protection. Commands should distinguish a meaningful refusal from an idempotent no-op and explain the specific blocking fact. New UI-visible effects should be based on small pure projections of committed state rather than copied state.

## Clock and elastic simulation

Legacy `elapsedStep` remains supported. `WorldTime` adds authoritative day projection and the database stores nullable day boundaries, stopping facts, and a requested player decision so old turns remain readable. Workflows own duration ranges, with a single shared estimator.

`decideElasticStop` currently runs in shadow mode. It records what would stop the simulation according to this priority: mandatory player decision or clarification; an irreversible player-involving event; a watch condition, plan interruption, or scenario threshold after the minimum span; or the maximum unattended span. It does not yet replace the live one-step resolution boundary. Treat the day fields and shadow decision as diagnostic foundations until a deliberate cutover wires plan lifecycle signals and multi-day advancement into the live path.

## Memory, narration, and persistence

Campaign memory folds forward from factual events, retaining recent turns in detail and compacting deep history. Open threads are derived from current state. Chronicle prose is downstream: factual events provide the material result; the turn report may group and frame entries but cannot invent a cause, result, or institutional explanation.

Turn persistence is atomic. Schema evolution is additive where possible, with pure upgraders and compatibility reads for prior snapshots until replay coverage permits removal. Tests focus on replay safety, workflow policy, action plans and conflicts, feasibility, clock projections, scheduling, factual Chronicle construction, and turn persistence.

## Map source assets

The map uses Natural Earth public-domain source material and geoBoundaries gbOpen administrative boundaries. `natural-earth-50m-admin0-countries.geojson` is a global 1:50m country source; `natural-earth-ii-blue-oceans.png` is a label-free equirectangular base image. `europe-north-africa-geojson.ts` normalizes the selected geoBoundaries layers to Chronica province features in WGS84. Germany uses ADM2 districts; other selected countries use ADM1. Preserve geoBoundaries attribution metadata when redistributing, because country licences vary.

`roman-spqr-banner.svg` is by Ssolbergj and used under CC BY 3.0. The other army-standard SVGs are original reconstructions based on attested motifs; they are source assets, not authoritative scenario data. Natural Earth sources: <https://www.naturalearthdata.com/about/terms-of-use/>, <https://github.com/nvkelso/natural-earth-vector>, and <https://www.shadedrelief.com/NE2/>. geoBoundaries metadata: <https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/>.

## Development

Use Node.js 22+ and npm 11+. Run `npm run dev` for local development, or use `hosted.sh` on macOS/Linux and `hosted.bat` on Windows. The latter launchers install locked dependencies when needed and start the web application on localhost.
