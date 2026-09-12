# Architecture guide

## Source of truth and authority

The committed `WorldState` is canonical. AI is the sole authority for interpreting intent and choosing NPC or political responses, but it is never the authority on what the database says or on bypassing world integrity. However many agents speak during a turn, they share one `GameMasterSession`, and that session — not any agent — is what decides whether a proposed change is lawful. It works on a discardable copy of the world. Workflows are MCP-style tools for interacting with world data: each exposes a capability and input contract, the AI chooses the appropriate tool and supplies its context, and the engine validates parameters, actor, authority, scope, references, and the resulting world before accepting a staged change. A workflow may be built in or defined during a campaign. One transaction commits the final world, factual events, audit information, memory, and Chronicle entries.

This gives each question one owner:

- The Game Master interprets intent, judges feasibility where the world cannot decide it mechanically, and chooses lawful actions.
- Workflow code owns preconditions and state changes.
- The scenario and committed state establish facts, people, places, and resources.
- The clock and scheduler decide how time is represented and when play should stop.
- The Chronicle renders facts after resolution; it cannot alter them.

No generic state-patch tool is exposed. Unsupported intent is recorded through `request_capability` for developer review, without changing the world. The older runtime-defined-action mechanism remains disabled in normal play; it is not part of the supported action surface.

## Turn resolution

The resolver prepares the world, runs the agent tool loop, resolves due deterministic procedures, builds facts and Chronicle entries, then commits. Tool calls are bounded so an otherwise successful turn can commit useful work even when a budget is reached.

A turn resolves through the multi-agent dispatcher: the relevant NPC and star-context actors selected for this decision point each decide and declare, then the intent interpreter carries out every declared intent, then a closing pass that reads the stage back and submits the report. Every one of them runs against the same `GameMasterSession`, so there is one staged world and one set of validation rules no matter how many agents speak. This is the only turn-resolution architecture; the deprecated single-call Game Master this superseded is gone.

Only the interpreter changes anything. No actor calls a workflow directly: the player's own directive stands as their declared intent (registered when the turn begins, so the player's exact wording is never paraphrased by a model call), an NPC states what it means to do through `declare_intent`, and the interpreter afterwards works out which validated actions each declared intent amounts to. The separation is what lets a character have the player's full reach without being handed the player's tool belt — an actor bounded by which tools it is offered ends up wanting only what the catalogue can express, whereas an actor bounded by authority can want anything and get exactly as much of it as the world allows. An intent nothing lawful satisfies stays uncarried, which is a real outcome and is reported as one rather than quietly becoming a smaller adjacent act.

The interpreter is bound by an `interpreter` principal that may act only for characters that actually declared something this turn, checked against the session's own record. It cannot invent an actor, and it cannot end the turn. Intents are declared and interpreted in the reaction path too, on the event queue's own timeline, so a reaction is decided the same way a turn is.

Read tools expose compact, factual views of the world, characters, forces, provinces, polities, conflicts, history, and actor memory. Built-in workflows expose familiar data interactions; `define_action` lets the AI define a reusable, campaign-local interaction when the catalogue does not fit. System-only workflows, such as deterministic battle resolution, are never offered to the Game Master as tools.

Each accepted action produces a factual event with its actor, parameters, material consequence, summary, and state deltas. A failed action leaves staged state unchanged and returns the exact rules-backed reason to the caller. Whole-world validation and delta reference checks prevent a workflow from introducing dangling identifiers while still allowing legacy snapshots to load and be repaired.

A failure caused by how a call was written, rather than by anything in the world, is repaired before it is reported. When an action fails on an id that resolves to nothing, the session looks for what that id could have meant; if the world leaves exactly one candidate of the kind the parameter requires, the call is made again with the real id. The repair is all-or-nothing and never runs on a genuine refusal, so an ambiguous guess fails visibly instead of quietly becoming a different order. Anything still unresolved after that is pushed back to the acting agent twice — once to correct it, once to either define an action for it or report it plainly as not carried out — and then the report stands rather than spending the whole tool budget on one call.

## Plans, interpretation, and conflicts

`ActionPlan` and `ActionPlanStage` are the common model for player, NPC, and world-originated work. Stages retain their status and fact references. They can wait on dependencies, recur when explicitly scheduled, and reserve named resources. Terminal stages never reopen, and revising a plan never reverses a committed effect.

An order's text is immutable evidence of intent. Interpretation records claims separately from stages. A contradicted world premise is refused; a request for clarification does not modify stages. The feasibility service is intentionally advisory: it reports only checks the engine can honestly perform, such as a living actor, known location, resource control, workflow support, and a contradicted premise. It cannot become a second mutation authority.

Conflict handling is deterministic where resource identity is clear. Its precedence is new instruction, revision, existing plan, delegated work, NPC self-direction, then world background. Preemption interrupts or supersedes unfinished work and releases reservations; it leaves completed and failed work intact. Semantic conflict that cannot be grounded in a contended force, office, account, or character remains a Game Master judgment rather than a fabricated rules engine.

## Workflows and command rules

In Chronica, a workflow is an MCP-style tool the AI uses to interact with the world's data. It is not a story script or a fixed player verb: it exposes a capability and input contract, while the AI decides whether calling that capability serves the current situation. Built-in workflows declare their schema, authority, data transformation, and, when appropriate, an estimated duration. When no built-in operation fits, the AI can define a campaign-local workflow as a named, parameterised data capability. Defined workflows persist for that campaign and are audited like built-in ones.

The catalogue distinguishes:

- AI data interactions, which the Game Master may invoke for a living actor.
- System effects, which only deterministic resolution may invoke.
- Projections, which derive information and never mutate state.

The same validation protects all data interactions: valid parameters, living actor, permitted authority and scope, resource access, whole-world schema validity, reference integrity, and duplicate protection. Calls should distinguish a meaningful refusal from an idempotent no-op and explain the specific blocking fact. New UI-visible effects should be based on small pure projections of committed state rather than copied state.

## Clock and elastic simulation

Resolution runs on `WorldInstant` (day and minute), not a fixed one-step-per-turn boundary. A workflow's declared duration schedules an `action_phase` event on the shared queue, with a single shared estimator owning duration ranges: immediate and routine actions land within the turn that ordered them, while longer work reports its own commencement, an update, and a completion as those milestones actually resolve.

After the Game Master's own turn, `computeInterventionScore` decides whether to stop or keep going, in priority order: a mandatory player decision or clarification; an irreversible player-involving event; a genuine plan conflict; or a scored combination of irreversibility, deviation from plan, direct player involvement, strategic consequence, and uncertainty crossing the scenario's threshold. When none of these fire, one bounded pass resolves further due events and their reactions within the same call — up to a fixed per-turn cap or the scenario's own maximum unattended span — before control returns to the player. `stopReason`, `elapsedDayEnd`, `stoppingFactIds`, and `requestedPlayerDecision` are the live values a turn commits, not diagnostics; the Chronicle shows the requested decision and the facts that prompted it whenever a turn stops for the player specifically.

A plan stage claims the resources its own parameters name — a character's time, a named force, an account, an office — before it may run. A claim already held by a more recently instructed plan is preempted; a claim a stage cannot win refuses the stage outright, with the specific blocking claim as the reason. A plan's own stated budget is a mechanical cap, not advisory context: a call that would exceed it is refused and rolled back entirely, in both the immediate and the deferred (queued) execution path.

Turn resolution is crash-safe. A resolution claim carries a real, expiring lease, so a process that dies mid-turn leaves the turn reclaimable rather than stuck; a transient failure requeues the turn, bounded, rather than silently dropping the player's submitted orders.

## Memory, narration, and persistence

Campaign memory folds forward from factual events, retaining recent turns in detail and compacting deep history. Open threads are derived from current state. Chronicle prose is downstream: factual events provide the material result; the turn report may group and frame entries but cannot invent a cause, result, or institutional explanation.

The Chronicle separates an order the world refused from one the engine could not carry out. A refusal is history — someone with standing said no — and is written as such. A guessed id, arguments the call rejected, or an action the registry does not have is not history: the order is recorded as unresolved and still open, never as having found no ears, because nobody in the world ever heard it. Both wordings are executor-derived and exempt from the narrator, so no invented institutional cause can attach to either.

Turn persistence is atomic. Schema evolution is additive where possible, with pure upgraders and compatibility reads for prior snapshots until replay coverage permits removal. Tests focus on replay safety, workflow policy, action plans and conflicts, feasibility, clock projections, scheduling, factual Chronicle construction, and turn persistence.

## Map source assets

The map uses Natural Earth public-domain source material and geoBoundaries gbOpen administrative boundaries. `natural-earth-50m-admin0-countries.geojson` is a global 1:50m country source; `natural-earth-ii-blue-oceans.png` is a label-free equirectangular base image. `europe-north-africa-geojson.ts` normalizes the selected geoBoundaries layers to Chronica province features in WGS84. Germany uses ADM2 districts; other selected countries use ADM1. Preserve geoBoundaries attribution metadata when redistributing, because country licences vary.

`roman-spqr-banner.svg` is by Ssolbergj and used under CC BY 3.0. The other army-standard SVGs are original reconstructions based on attested motifs; they are source assets, not authoritative scenario data. Natural Earth sources: <https://www.naturalearthdata.com/about/terms-of-use/>, <https://github.com/nvkelso/natural-earth-vector>, and <https://www.shadedrelief.com/NE2/>. geoBoundaries metadata: <https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/>.

## Development

Use Node.js 22+ and npm 11+. Run `npm run dev` for local development, or use `hosted.sh` on macOS/Linux and `hosted.bat` on Windows. The latter launchers install locked dependencies when needed and start the web application on localhost.
