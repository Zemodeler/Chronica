# Chronica: wider engine gaps behind the Clepsina run

**Reviewed:** 30 September 2026. **Scope:** the original run, the diagnostic order through 6 July 270 BC, its follow-up letter, and the current local engine source. This supplements the [81-finding run report](./270-bc-clepsina-run-audit-updated-2026-09-30.md); it does not replace its individual evidence and qualifications.

## Verdict

Yes. Many of the visible errors are different consequences of the same engine gaps. The central gap is that **the engine represents activity more reliably than it proves fulfillment of intent**. An accepted assignment, a passed vote, a new fact, a completed object and a narrated passage can each look like progress without establishing that the player's requested result happened.

The vision needs a continuous chain:

**Free-text intent → understood goals and constraints → competent delegation → executable work → prerequisites satisfied → verified effects → appropriately informed people → faithful player account.**

Several individual links exist. The problem is the contract between them. The run shows a transport intention surviving without transport, authorization without resumed execution, successful provisioning without reporting, failure facts without failure prose, and private intentions entering public news.

This is not evidence that the engine has no mechanics. It already has projects, travel, political procedures, accounts, audits, skills, commitments, knowledge and reference validation. More prompts or more mechanics alone will not repair the missing connections.

## Evidence and limits

The preceding report contains the saved run evidence, including 16 orders, 87 Chronicle entries, 791 facts and 14 chat messages. This review also inspected the current checkout and ran seven small local function checks. No provider calls, new orders or game-state changes were made.

**The checkout contains substantial uncommitted changes.** These include new order persistence, deterministic outcome reporting, crossing preparation and permission retries. A failure in the historical run is not proof that its exact implementation remains unfixed. Conversely, new source and unit tests do not prove this saved campaign has recovered. The analysis below explicitly separates observed failures, present code behavior and wider risks.

The checks exercise function contracts with controlled inputs. They are not seven newly observed campaign incidents. In particular, normal reference validation may prevent a nonexistent force from reaching the status function; that check exposes how the projection behaves if stale or incomplete work reaches it.

| Local check against current source | Result | What it establishes |
|---|---|---|
| Order part references a nonexistent force | `done` | Force references are treated as completion without examining the force or goal. |
| Assignment is accepted, with no linked operational work | `started` | Acceptance is enough for a progress label. |
| Only order fact records acceptance of administration | `carriedOut: true` | The outcome evaluator can credit acknowledgment as execution. |
| Entry links that acceptance fact and narrates only acceptance | `inChronicle: true` | Entry presence establishes coverage, not goal/outcome coverage. |
| Generic promise followed by an unrelated letter | Promise treated as kept | Contact is used as a substitute for the promised deed. |
| Actor claims a plan step and its answer changes something | Step marked done | The step's requested effect is not tested by this function. |
| Due audit's auditor is dead | Audit becomes `cleared` | Inability to investigate is conflated with exoneration. |

Saved results: [engine-gap probe output](./270-bc-clepsina-engine-gap-probes.json).

## E01 — Completion has no consistent, purpose-specific proof

**Observed:** Coruncanius accepts transport administration, but Legio I stays in Latium. Funding passes, but no executable transport appears. Failure facts exist, yet the Chronicle does not state the failed transport outcome.

**Current mechanism:** [orderPartStatus](/Users/andreidodu/Chronica/packages/shared/src/world/orders.ts:132) aggregates the lifecycle status of referenced objects. A passed procedure counts as done; any settled audit or plot counts as done; force/entity references count as done without testing the requested effect. With no surviving work references, any linked fact can make the part done. [outcomeOfOrder](/Users/andreidodu/Chronica/packages/sim/src/order-outcome.ts:33) uses the existence of a qualifying non-private fact to score execution. These are useful activity signals, but weak fulfillment tests.

**Wider consequence:** The same pattern can affect marches, delivery, construction, investigations, intelligence and promises. An object can finish while the mission fails; permission can pass while the mission has not started. Terminal status, success and useful partial progress need separate meanings.

**Required change:** Store the intended result and the observable evidence required to establish it. For transport, success means the specified force arrives at the specified destination through valid movement. For an audit, completion means the represented scope was examined and an evidence-based finding produced. Acceptance is acknowledgment; authorization is a prerequisite. Keep these events visible without calling them fulfillment.

This is the highest-priority gap because it contaminates status, NPC planning, reporting and evaluation at once.

## E02 — Mission continuity across prerequisites remains incomplete

**Observed:** The player orders execution and authorization together. The Senate later passes the funding, yet the saved result says another order is needed. The old generic pursuit is reused under the no-duplication instruction even though it contains no executable crossing.

**Current improvement:** [arrangeCrossing](/Users/andreidodu/Chronica/packages/sim/src/apply/apply-deltas.ts:1269) now creates preparatory movement and crossing work. [resumeWaitingOrders](/Users/andreidodu/Chronica/packages/sim/src/burst.ts:785) retries certain stored acts when a procedure passes. These directly address parts of the historical failure.

**Remaining gap:** That continuation is a specific stored-delta retry, not a general representation of an operation's dependencies. A mission can involve authorization, delegation, money availability, rendezvous, supply, fleet capacity and a report, spread across different parts and actors. A passed vote is only one dependency. Replaying one act does not automatically reconcile the whole mission.

**Required change:** A durable mission owns its stages and dependencies. Routine missing stages are generated or repaired; completed stages are reused. Permission, available resources and arrivals wake the dependent stages. Failures trigger proportionate alternatives under the existing instructions. A pursuit records intention; an executable mission records what will change the world.

**Acceptance case:** “Bring Legio I to Messana using our ships; seek funding if needed” should continue after funding without requiring another player command. Real political refusal or unavailable ships can stop it, with a truthful explanation.

## E03 — Causal ownership relies too much on prose similarity

**Observed:** Separate matters collapse into one Chronicle entry. Delegation has no linked execution consequences. A report uses a plausible player name rather than the player's actual identity. New work can appear without an accountable originating assignment.

**Current mechanism:** [partOfAct](/Users/andreidodu/Chronica/packages/sim/src/burst.ts:575) matches acts to order parts using word overlap. Order recording and delegation credit use those matches; unmatched work can be assigned by fallback. This can help recover messy model outputs, but synonym changes, shared logistics vocabulary and multi-purpose acts make it an unreliable primary causal link.

**Wider consequence:** Work can be credited to the wrong clause, completed work can fail to close the right assignment, and a new order can incorrectly supersede an old one. Reporting then inherits the mistaken association. Record and work-reference caps also need explicit retention behavior so long-running obligations are not silently lost.

**Required change:** Stable order, part, mission and stage IDs must survive delegation, emitted effects, procedures, events, facts and reports. Text matching should flag uncertain recovery for reconciliation rather than silently establish causality. All recipient and actor references should resolve through canonical IDs before scheduling.

## E04 — Facts and authoritative state can disagree about what happened

**Observed:** The Anio passages describe construction starting while the relevant saved projects retain their prior milestones and funding arrangements. Order facts describe acceptance, whereas the requested operation remains absent. Narration can turn an intention into an accomplished deed.

**Mechanism:** The engine accepts proposed facts as well as state-changing acts. A valid fact reference or plausible summary does not establish that its claimed event occurred. Structural validation protects the shape of records; it cannot by itself prove “construction started” or “the legion crossed.”

**Wider consequence:** Actors, history and future decisions can consume an asserted event that lacks a matching mechanical effect. Once that claim enters memory, later scenes can reinforce it.

**Required change:** Mechanically testable facts should be emitted from validated effects. Model-authored statements need explicit categories such as proposal, testimony, belief or rumor, with provenance and certainty. A completed event must refer to its confirming effect. Contradictions need reconciliation, not another layer of prose.

This is related to E01 but distinct: E01 asks whether the goal was achieved; E04 asks whether an asserted event happened at all.

## E05 — Chronicle composition is missing a reliable causal and knowledge boundary

**Observed:** The ceasefire answer also contains transport and Aristodemus's family negotiations. Explicit transport-failure facts are linked to it but omitted from the body. A private foreign intention is classified as public upstream. Successful private work is omitted from the sponsor's accessible account.

**Current improvement:** [matterKeys](/Users/andreidodu/Chronica/packages/sim/src/chronicle.ts:817) groups facts using the new order parts, and deterministic outcome lines are being added. These are meaningful improvements over grouping solely by the current burst.

**Remaining gap:** Grouping cannot repair incorrect causality or visibility upstream. A public flag cannot prove a discovery path. An entry's fact IDs cannot prove every material claim reached the player. A player's order and independent world developments may share a simulation window without belonging in the same passage.

**Required change:** Compose separate mission accounts and independent news items from causally linked facts. For each claim, retain source, audience, certainty, location and discovery route. Verify that each requested matter has a faithful outcome or pending-state statement. Confidential work needs an appropriate private receipt and status; secrecy must not erase it from its sponsor's management view.

**Leak qualification:** Blue Olive was not disclosed in the diagnostic order's twelve public passages. That specific leak is not demonstrated. The confirmed leak is the private foreign intention entering a public fact without a demonstrated discovery path.

## E06 — Simulation time can outrun execution capacity

**Observed:** The diagnostic burst uses 34 counted model calls, including 13 Chronicle calls, stops at `budget_exhausted`, and advances thirteen days. Many unsolicited actor opportunities compete with the player's unresolved operation. Earlier bursts also run out of budget.

**Wider gap:** Physical time, scheduled obligations, NPC attention and narrative generation share limited execution capacity without sufficiently strong guarantees that essential mission work gets processed. The world can punish missed deadlines or report stagnation even when the responsible actor did not receive enough simulation opportunity to act.

**Required change:** Budget essential causal work before optional scenes and narration. Preserve unprocessed obligations in a durable queue, distinguish missed simulation opportunity from an actor's decision not to act, and reconcile overdue work before applying consequences that depend on that decision. Use bounded or batched narration to avoid consuming the execution budget on repeated accounts of one topic.

The world should continue independently. The fix is coherent scheduling and consequence attribution, not freezing every actor until the player acts.

## E07 — Institutional permission, money and mission budgets are not sufficiently connected

**Observed:** The 3,000 authorization passes but does not produce resumed work or an evidenced allocation. Public and household accounts are not both represented in the inquiry. Intelligence spends 20 from the player's purse without visible payer disclosure.

**Wider gap:** Permission, access to an account, a maximum budget, reservation and expenditure are different states. Representing one does not establish the others. A spending constraint written in a sentence must remain attached to later delegated work and alternatives.

**Required change:** Store an authorization envelope with purpose, payer, cap, conditions and accountable executor. Connect reservations and transactions to it. Audit the relevant public and household flows together when the allegation concerns diversion between them. Report authorized, reserved and spent amounts distinctly.

**Qualification:** The espionage clause's payer is ambiguous, so the run proves undisclosed personal spending rather than conclusively proving that specific charge breached the transport cap. Unauthorized action can also be legitimate simulated corruption or insubordination; it should have attributable consequences. The missing guarantee is faithful implementation of the player's constraints, not a universal ban on illegal acts.

## E08 — Promises and diplomatic conditions lack precise event semantics

**Observed:** Conditional commitments acquire deadline consequences that do not faithfully match their meaning. An ultimatum's trigger is distorted. Protectorate acceptance does not establish the player's additional material terms.

**Current mechanism:** [keptOnTheRecord](/Users/andreidodu/Chronica/packages/sim/src/promises.ts:53) treats any later letter between the parties as evidence for generic or information-sharing promises. Political support can be matched to any beneficiary-sponsored question. Conditional occasion detection uses broad action categories, with some uncertainty treated as an occasion having occurred. New restraint handling improves specific cases but does not establish exact contract semantics.

**Required change:** Represent trigger, duty, target, scope, deadline origin, evidence and negative constraints separately. “If attacks resume, retaliate” needs an attack event, not merely a refusal. “Do not accuse without proof” needs an accusation and a proof condition, not a generic contact deadline. Treaty terms need individually accepted obligations linked to their eventual work.

**Probe:** An unrelated greeting fulfills an `other` promise. This is a reproducible present contract weakness, not just a narration defect.

## E09 — Investigations can mistake absence of evidence for clearance

**Observed:** The requested diversion inquiry represents the household scope without the requested public-account comparison. Its eventual outcome has not yet occurred.

**Current mechanism:** [resolveAudits](/Users/andreidodu/Chronica/packages/sim/src/departments.ts:484) tests matching diversion records with skill-dependent discovery. That is a real mechanic. However, a missing or dead auditor immediately produces `cleared`, and no discovered diversion yields prose that the books were in order.

**Wider consequence:** An incomplete examination, missing scope or failed investigator can become exoneration. Legal, financial and relationship consequences may then rest on a stronger finding than the evidence supports.

**Required change:** Separate unable to investigate, incomplete coverage, no discrepancy found, proven diversion and substantiated clearance. Preserve reviewed scope and evidence quality. Replace an unavailable auditor or report the interruption. Never settle an allegation solely because its investigation could not run.

## E10 — Structural validity is stronger than cross-system world consistency

**Observed:** The original punitive force and hostile garrison do not have a clear personnel transfer; office appointment and actual fleet control differ; generated identities duplicate an existing agent; territorial labels and locations conflict.

**Current protection:** Schema checks, reference validation and per-delta rollback exist. These are valuable and must be preserved. Some current identity and player-agency guards address historical failures.

**Remaining gap:** Valid records can still describe an incoherent world. Two valid forces can double-count personnel. A valid office seat can disagree with effective command. A generated person can be indistinguishable from an existing person. Concurrent projects can each depend on the same fleet without a shared reservation policy.

**Required change:** Central invariants for personnel changes, ownership/control, resource assignment, geography, payer separation and canonical identity. Check them at transitions and after a burst. Reuse or deliberately distinguish existing characters before creating replacements. Fleet contention is an architectural risk to test, not a duplicate booking proved in this diagnostic run.

## E11 — Evaluation measures proxies that can certify the wrong result

**Observed:** Prior tests did not prevent this campaign's failures. The present local probes show why: an acceptance fact can count as carried out, a linked entry can count as Chronicle coverage, and any changed answer can complete a claimed plan step.

**Current mechanism:** [takeSteps](/Users/andreidodu/Chronica/packages/sim/src/plans.ts:157) requires a changed world before accepting an actor's claimed step, but it does not test whether the change fulfills that step. This prevents pure empty speech while still permitting unrelated activity to receive credit.

**Required change:** Campaign tests need independent world-state oracles, not reuse of the same status functions being tested. Check target arrival, payer/cap compliance, preserved conditions, correct recipient, and player-visible reporting against source evidence. Test paraphrases, reordered clauses, multiple prerequisites, private matters, delays, actor death and resource contention.

The seven probes are diagnostic evidence, not a comprehensive regression suite. No claim is made here that the entire current test suite passes or fails.

## E12 — New fixes do not automatically repair a campaign's accumulated state

**Observed:** The save contains old inert pursuits, stale pressures, reputational consequences, misleading facts and duplicated identity. These records can remain inputs to future reasoning even after their originating code changes.

**Current mechanism:** The new [world orders field](/Users/andreidodu/Chronica/packages/shared/src/world/world-state.ts:297) defaults to an empty array for older worlds. That permits loading; it does not reconstruct the earlier orders' mission links. There is no evidence from this review that all historical errors have been migrated or retracted.

**Required change:** Versioned reconciliation of existing saves: recover source orders, attach real work, identify unsupported facts and consequences, merge or distinguish accidental duplicates, and mark uncertain cases. Repair should retain an audit trail and avoid inventing completed work. Reversing a false accusation may require correcting affected beliefs and relationships, not merely deleting one fact.

## Why these gaps reinforce each other

| Chain | Result seen by the player |
|---|---|
| Weak completion proof → plan step credited → assignment appears started → mission is not revisited | An army remains in place under an apparently live order. |
| Prerequisite modeled separately → vote passes → no durable downstream stage wakes | The player must repeat an already sufficient command. |
| Fact asserted without effect → actor memory consumes it → Chronicle retells it | Plausible history diverges from saved state. |
| Prose-based causal matching → unrelated facts grouped → coverage scored by fact linkage | One reassuring passage mixes orders and omits actual failures. |
| Optional scenes consume capacity → calendar advances → deadline machinery runs | Simulation starvation can resemble personal neglect or betrayal. |
| Scope incomplete → nothing discovered → audit clears → relationship consequences settle | Missing investigation can masquerade as evidence. |

The Chronicle is especially revealing because it sits at the end of these chains. Its errors are partly composition defects and partly evidence that the upstream engine has lost intent, causality or knowledge provenance.

## Repair order and completion criteria

1. **Establish goal-specific outcome proof and stable causal IDs.** Make acceptance, authorization, progress, terminal failure and success distinct. These contracts should be shared by execution, planning, reports and tests.
2. **Make missions survive delegation and prerequisites.** Connect the existing mechanics into continuing work, including routine repair of inert or missing stages. Carry payer, cap, privacy and escalation conditions throughout.
3. **Protect world truth and knowledge.** Emit mechanical facts from verified effects; distinguish reports and beliefs; require a discovery path for private claims; reconcile inconsistent records.
4. **Make scheduling and reporting reflect real execution.** Prioritize essential work, preserve unprocessed obligations, and provide one faithful account per requested matter alongside independent world news.
5. **Harden contracts, audits and invariants.** Match exact conditions and scope; avoid clearance through inability; check shared personnel, fleets, identity and authority relationships.
6. **Validate both a fresh campaign and the damaged save.** A new engine path working once is insufficient if historical state continues to reproduce the failures.

The decisive regression is a simple order followed by the detailed diagnostic order. The simple version must initiate competent routine work without requiring executor micromanagement. The detailed version must preserve its extra conditions and improve measurable control: payer compliance, independent scope, confidentiality, alternatives and useful reports. A legitimate refusal or delay passes only when it is grounded, attributable and accurately communicated.

**Overall assessment:** The wider engineering priority is to preserve intent and prove its consequences across the whole engine. Better narration will help the experience, but it cannot make an accepted order executable, make permission resume a mission, or turn an unsupported claim into a real event.
