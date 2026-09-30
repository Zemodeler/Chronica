# Chronica: complete Clepsina run audit, updated through 6 July 270 BC

**Updated:** 30 September 2026, after the “Secure Messana / Blue Olive” order and the subsequent letter to Hanno. **Game:** `6f3c4541-d900-410e-abd5-4e52e901f891`. **Player:** Gaius Genucius Clepsina.

**Verdict:** additional detail successfully creates some subordinate work, but does not repair the core transport failure or give the player a faithful account of the order. The game can create an independent audit and a confidential spy mission, yet omit both from the Chronicle and the Council's work list. It can also record explicit failure facts and then narrate a passage that leaves the failures out. The run therefore violates both halves of the vision: simple intent does not reliably become competent continuing work, and additional detail does not reliably produce visible, attributable benefits.

This is the consolidated report: **R01–R64 retain the original historical findings; R65–R81 add or refine findings from the new order.** These 81 finding IDs are an issue register, not 81 proven independent root causes. Reproductions and consequences overlap where the same defect affects several surfaces. **C01–C09 separately describe Chronicle architecture risks and mechanisms**, rather than inflating the count of confirmed run defects.

The controlling vision remains: **any intelligible free-text order should be enough; routine staffing and logistics belong to the simulation; useful detail should improve control and outcomes.** Political refusal, insufficient resources, travel time and failed espionage are legitimate outcomes. Silent omission, false progress, invented conduct and demands for routine follow-up commands are not.

## Updated evidence and limits

The refreshed read-only extraction contains **16 orders, 87 Chronicle entries, 791 facts, 36 audit rows, 20 scheduled events and the same 14 chat messages**. The diagnostic order generated **12 entries and 133 facts**, ran for approximately **198 seconds**, used **34 counted model calls**, including **13 Chronicle calls**, and stopped at `budget_exhausted`. Its saved world advances from day 114, 23 June, to day 127, 6 July. The subsequent Hanno letter takes the deterministic path with zero model calls.

The live Office, Council and Chronicle were inspected at 6 July. The Council still displays only the 27 May transport pursuit under “Under way.” The Office shows four matters wanting your word in the header but two marked room objects; this remains an unexplained difference in counting units, not proof that two decisions are lost. The navy remains unpaid according to the arms rack. The Chronicle displays the diagnostic order's twelve passages but not the subsequent stored Hanno letter in the observed view.

Database state establishes what happened behind the UI. It is privileged audit evidence, not information that should automatically be exposed during gameplay. The underlying application has uncommitted changes: current source analysis establishes present mechanisms, but does not prove that every earlier passage ran through exactly the same revision. Historical findings below explicitly retain their original 23 June snapshot.

Opening reading panels may update their read markers; no order was submitted, time advanced, message sent or simulation state edited by this audit.

## What the diagnostic order actually achieved

| Requested matter | Saved result by 6 July | What the player was told | Assessment |
|---|---|---|---|
| Carry Legio I to Messana with existing Roman ships | Legio I still in Latium, 7,100 men; navy still at Messana; no executable Legio I transport project | A clause says the existing transport order will be used; old pursuit still “Under way” | Core execution failure reproduced |
| Delegate logistics and routine administration | Two binding orders to Tiberius Coruncanius are accepted; no transport completion or linked consequences | No separate progress or accepted-delegation entry | Acknowledgment exists; continuing execution/reporting does not |
| Keep punitive legion supplied and paid | 95 treasury purchase buys bread at day 114; provisions extend to day 174; existing pay executes at day 123 with no arrears | Neither supply purchase nor continuing pay is reported in the twelve entries | Successful work hidden |
| Seek up to 3,000 treasury authorization | Senate passes 72–0, 28 abstentions, at day 124 | Three funding-related passages culminate in authorization | Authorization works; no resumed transport or controlled allocation is evidenced |
| Independent examination of diversion accusation | Fabricius appointed; household audit under way from day 114, due day 174 | Audit omitted from Chronicle and Council work list | Real partial success; public-account scope is not represented |
| Confidential “Blue Olive” intelligence | New espionage plot and agent; 20 from personal purse; resolves day 144 | No acknowledgment in Chronicle or Council | Started and still pending; reporting and payer disclosure fail |
| Ceasefire without automatic escalation | Public letter sent day 114; arrives day 132, reply due day 147; explicit no-escalation clause retained | Ceasefire offer reported | Faithful initial execution; response not yet due |
| Separate progress reports grounded in evidence | Failure facts exist, but five requested matters receive no complete outcome summary | Ceasefire mixed with transport and Aristodemus's family negotiations; politics dominates | Explicit reporting instruction not satisfied |

Important qualifications: “Blue Olive” has **not** failed merely because no intelligence arrived yet. Its resolution is 17 days after the audited current date. The independent audit is not overdue: its due date is 47 days away. Hieron cannot yet have received the new ceasefire offer: delivery is five days away. No second Roman fleet was created by this order. “Blue Olive” was not found in the twelve Chronicle passages, so there is **no demonstrated public disclosure of this mission in this test**. The earlier spy-thread assassination framing is reproduced internally, but the actual mission remains `espionage`.

## New and refined findings from the diagnostic order

### R65 — [P0, confirmed evidence; qualifications stated] The Chronicle suppresses explicit failure evidence while retaining its reassuring order clause

**Evidence:** Facts `…-35` and `…-36` are `order_part_unanswered`: one says no crossing or arrival is recorded; the other says nothing came of delegation. Both appear in the ceasefire entry's stored fact IDs. Its body instead says Clepsina ordered the existing transport order used, and omits both failed outcomes. Current `MUST_TELL` includes `order_part_unanswered`, but protects an entry from being cut, not the failed clause from being omitted inside it.

**Impact and correction:** The player receives a materially incomplete account of the result even when the engine has identified the failure. Preserve every requested matter's outcome as a required grounded statement; successful prose generation must not erase failure facts.

### R66 — [P0, confirmed evidence; qualifications stated] The no-duplication instruction preserves an inert pursuit as if it were an executable transport project

**Evidence:** The accepted instruction to Coruncanius says “do not duplicate the existing transport project.” The current world contains the old generic pursuit with no linked entities, and no military transport project carrying Legio I. The legion and navy remain separated at days 114 and 127. This strengthens R01–R03: deduplication now prevents creation of the missing operational work.

**Impact and correction:** An instruction intended to avoid waste becomes a reason to keep doing nothing. Distinguish an intention record from a mission with executable stages. Reuse or repair genuine work; create missing stages when only a pursuit exists.

### R67 — [P1, confirmed evidence; qualifications stated] Funding authorization does not resume the already authorized operation

**Evidence:** The Senate funding procedure resolves passed at day 124. Its result explicitly says “what it allows waits on somebody's order,” although the player already ordered execution, prerequisite authorization, alternatives and delegation together. No new transport project, funding reservation or downstream event appears by day 127. The procedure has empty `resultingEventIds`; no dedicated allocation appears in the saved reservations.

**Impact and correction:** The game treats authorization as the end of an isolated task rather than a satisfied prerequisite of a standing mission. This is not a claim that exactly 3,000 must be spent immediately. Resume the existing mission under a maximum spending envelope and show authorized, reserved and spent amounts separately.

### R68 — [P1, confirmed evidence; qualifications stated] Accepted delegation has no traceable execution consequences or reliable progress state

**Evidence:** Two orders to Coruncanius, transport administration and punitive provisioning, are accepted with positive recipient responses. Both have `decidedAtStep: null` and empty `consequenceFactRefs`. A day-116 military-administration fact confirms acceptance, but no corresponding transport work starts and the Council exposes neither assignment.

**Impact and correction:** The player cannot distinguish “someone agreed” from “someone is doing it.” Attach accepted assignments to operational work, prerequisites, progress and eventual consequences, and update decision timestamps consistently. Provisioning did occur; the failure is not that all delegation had zero effect.

### R69 — [P1, confirmed evidence; qualifications stated] The delegated report targets a nonexistent player identity and fires as an instruction rather than an account

**Evidence:** The scheduled administrative report names `gaius-genucius-clepsina`, while this save's player character is `declared-323fbcc4-9f4b-4fa6-b800-f66666032889`. It fires at day 119 as the instruction “Report transport or provisioning obstacles to the consul and account for the routine arrangements made.” No player-addressed completed report or Chronicle outcome follows.

**Impact and correction:** A scheduled reminder is mistaken for delivered work, and an invalid identity can break the route to the player. Resolve actual character IDs before scheduling; fire a report workflow that records observed results and delivers them to the valid recipient.

### R70 — [P1, confirmed evidence; qualifications stated] A real independent audit is invisible in both the Chronicle and the active-work list

**Evidence:** `audit-…-15` is under way, started day 114, auditor `gaius-fabricius`, due day 174. None of the twelve diagnostic entries mentions the appointment or investigation. Council “Under way” contains only the old navy pursuit.

**Impact and correction:** The additional detail did improve delegation, but the player has no accessible confirmation in these primary surfaces. Acknowledge the appointment and show the audit's scope, status and expected review privately where appropriate. Do not falsely call the pending audit a failed or completed investigation.

### R71 — [P1, confirmed evidence; qualifications stated] The diversion inquiry narrows to the household without preserving the public-account comparison

**Evidence:** The new audit scope is `{kind:"household", id:player}` with `departmentId:null`. The order requests examination of public and household accounts concerning public-fund diversion. No separate public-account audit or linked reconciliation record is created.

**Impact and correction:** Clean household books alone cannot establish whether public money was diverted. Preserve the allegation, public ledger, household ledger and comparison needed for a finding. The evidence establishes missing represented scope; it does not establish that Fabricius has already reached a wrong verdict.

### R72 — [P1, confirmed evidence; qualifications stated] A confidential operation has no private acknowledgment or visible pending status

**Evidence:** “Blue Olive” is a saved espionage plot opened day 114, resolving day 144, `outcome:null`, `targetWarned:false`. Its mission name is preserved in cover text. Neither Chronicle nor Council acknowledges its creation. Current phase is brewing.

**Impact and correction:** Secrecy should limit the audience, not erase the sponsor's ability to manage an operation. Show a private mission receipt, agent identity, cost, reporting route and pending status. No premature intelligence result is required.

### R73 — [P1, confirmed evidence; qualifications stated] The intelligence mission silently charges the player's personal purse

**Evidence:** Transaction `txn-…-17` spends 20 from `gaius-purse`, visibility private, cause `blue_olive`. The visible report contains no payer or cost. The transport operation has a requested public maximum and an explicit separation of personal money, but the intelligence clause does not separately specify a payer.

**Impact and correction:** The unambiguous defect is undisclosed personal spending; the wording leaves whether that expense violated the intended overall payer constraint partly open. Maintain separate ledgers, apply sensible payer defaults and report the selected payer and amount. Do not silently reinterpret a public appropriation as personal financing.

### R74 — [P1, confirmed evidence; qualifications stated] A second indistinguishable Publius Nerius is created for repeated intelligence work

**Evidence:** The original `character-dc356199-…-17`, named Publius Nerius, remains in the world. The new mission creates `character-333cc94d-…-16`, also Publius Nerius, with a creation reason that an agent is required. These are different IDs, not two records for the same entity.

**Impact and correction:** The player cannot reliably identify the agent, past experience or conversation history. Reuse an appropriate existing agent, or deliberately create and visibly distinguish another person. A new agent can be legitimate; indistinguishable generated identity is the defect.

### R75 — [P1, confirmed evidence; qualifications stated] A private foreign intention becomes a public fact and is grafted onto the player's answer

**Evidence:** Aristodemus has a private intention to seek a family-approved marriage match. Fact `…-24` says the family began arranging a marriage and that he intends private negotiation, but its visibility and discovery are public. That fact is included in the player's ceasefire entry and its change list announces Aristodemus entering the record under the League of the Islanders.

**Impact and correction:** The fact gate cannot protect an intention already mislabeled public upstream. A public family development may be legitimate news; the private intention has no demonstrated discovery path here, and belongs nowhere in the ceasefire answer. Split public observation from private motive at fact creation, then group causally.

### R76 — [P1, confirmed evidence; qualifications stated] The world invents a private retaliatory intention for the player

**Evidence:** A new proposed private player intention, `intent-…-12`, says “Privately consider how to undermine the rival who has opposed me, while keeping my involvement concealed,” targeting Marcus Fabius. A related hidden-rivalry storyline is attempted and rejected by the thread limit. The diagnostic order requests an evidence-based independent audit and contains no covert action against Marcus.

**Impact and correction:** Autonomous logistics must not become autonomous choice of the player's motives or a revenge policy. Keep unsolicited pressures and opportunities distinct from player intentions. This is a proposed intention, not evidence that sabotage executed.

### R77 — [P1, confirmed evidence; qualifications stated] Construction is narrated as started while both matching project milestones remain pending

**Evidence:** The 28 June entry says Dentatus began the Anio water works and quotes “Bring the water to Rome.” The new `construction_started` fact asserts that event. In the day-127 world, both Anio-related projects retain pending “Begin construction” milestones and personal `curius-purse` funding, with no new construction project or matching construction expenditure in this burst.

**Impact and correction:** The discrepancy begins before the historian: an asserted simulation fact does not match project state. Tie construction announcements to validated material state changes; distinguish a decision or order to begin from construction actually begun. A same-day authorization then commencement is not itself a contradiction.

### R78 — [P2, confirmed evidence; qualifications stated] The deterministic Hanno letter prints the same message twice

**Evidence:** The subsequent zero-call order stores a recorded entry body: `"We are withing our right, Messena is our protectorate" -- We are withing our right, Messena is our protectorate`. The statement is both subject and repeated text.

**Impact and correction:** Quick actions create visibly redundant prose outside the historian path. Derive a concise subject independently or print the body once. Preserve player wording while making the record readable.

### R79 — [P2, confirmed evidence; qualifications stated] The observed Chronicle is stale relative to the subsequent committed Hanno letter

**Evidence:** The Hanno letter is committed at day 127 and has a stored Chronicle entry. The observed live Chronicle says “You have read everything recorded” and starts with the 4 July fleet arrival; it does not show the Hanno entry. Council “Since your last order” still lists the twelve passages from the previous diagnostic burst.

**Impact and correction:** The UI can make a successful quick action look missing and retain the wrong last-order context. Check fast-path state publication, cache invalidation and latest-report selection. This confirms a snapshot discrepancy, not permanent database loss; a deliberate reload was not used to erase or conceal the observed stale state.

### R80 — [P1, confirmed evidence; qualifications stated] The complex order again exhausts cognition while the world continues to impose consequences

**Evidence:** The 198-second burst uses 34 counted model calls and stops budget-exhausted. Its skipped list records 44 unasked actor slots across 30 June–6 July, including the final stop; these are slots, not necessarily 44 distinct people. The world still advances thirteen days, and plans fall behind, starvation facts accumulate and the Carthaginian fleet arrives.

**Impact and correction:** Additional useful detail consumes finite execution attention without ensuring protected coverage of the player's requested matters. Allocate calls to essential order work before ambient events and repeated speeches; distinguish engine capacity limits from historical delay. Record pending work durably so a budget stop does not strand it.

### R81 — [P1, confirmed evidence; qualifications stated] Public money is spent before the requested authorization and the player gets no meaningful authority explanation

**Evidence:** The punitive legion's 95 treasury purchase executes on day 114, before the new 3,000 authorization passes on day 124. A same-day private `authority_breach` fact names Clepsina but gives no action or cause. Current Chronicle `NEVER_PUBLISHED` excludes authority-breach facts. The visible report explains neither spending nor any authority issue.

**Impact and correction:** The evidence does not prove that the purchase caused this breach or that existing authority could not cover bread. The confirmed problems are missing attribution of the breach, undisclosed spending and no player-facing resolution of the requested authorization prerequisite. Bind each authority assessment to its action and expose an understandable consequence or lawful route, without raw engine jargon.

## Chronicle structure: diagnosis and required behavior

A Chronicle is one continuous record. A submitted order produces a burst; a burst produces time windows; each window selects facts the player may know, groups those facts into matters, chooses entries, then asks the historian to narrate each selected matter. The frontend also groups the newest report by burst ID. Therefore **one Chronicle containing the whole reign is appropriate; one paragraph combining everything caused by a player order is not**. Likewise, one continuing operation spanning several orders is appropriate, provided each order's change and each task's outcome remain traceable.

### C01 — Entity overlap is too weak a definition of a matter

`splitIntoThreads` unions facts through shared entities and follows their transitive links. It excludes the player's own polity, a sensible protection against Rome joining all Roman business. It does not exclude the player character as an equivalent common hub. Transport, an accounts inquiry and diplomacy may thus connect through Clepsina, then absorb other events through another shared actor. Procedure facts receive special question-based grouping and fight days receive day-based grouping; most other work has no equally strong semantic identity.

Use stable operation, task, procedure, conversation, intelligence-report and event IDs. People and places should aid discovery and filtering, not independently prove causal sameness. One diplomatic negotiation can have several people and letters; two separate tasks can involve the same person. Shared time, actor, world-generation call or burst is not a sufficient grouping key.

### C02 — The main-answer heuristic compresses separate player tasks

`answerAmong` chooses the thread with the most order facts. Smaller player-order threads can be folded into that answer; smaller home business can become a digest. Other requested matters compete for remaining entry space. This is an editorial shortcut rather than a complete order-outcome contract.

Compression should combine stages within a task, not different tasks. Preserve a mandatory compact outcome for every interpreted clause: started, completed, blocked, refused, pending authority, awaiting delivery or unanswered. The diagnostic order explicitly requested separate reporting; its ceasefire entry still absorbs transport and a foreign family matter.

### C03 — Visibility must be correct before the Chronicle gate

The current distant-news fallback explicitly blocks unknown `private` facts. That is real protection and should not be described as absent. It cannot stop a private intention materialized as a `public` summary, as Aristodemus demonstrates. Existing chat leaks also bypass the Chronicle entirely: setup metadata and hostile private intentions become dialogue.

Apply knowledge boundaries when constructing facts, dialogue, account lines, event payloads and storyline descriptions. Separate what happened publicly from what an actor privately wanted. For each claim, preserve who learned it, through which source, and when. The same audit boundary must govern every player-facing surface.

### C04 — A visible fragment can admit a whole attached account

Narrative and friction lines qualify when any linked fact is firsthand visible, or when their actor is the player. A line attached to several facts can therefore carry details whose own supporting facts are hidden. Thread membership similarly admits a line by any matching fact ID. This is a current-code leakage route, not proof that every mixed entry exposed a secret.

Use atomic evidence-bound claims or redact unavailable claims within an account before narration. Passing an entire multi-topic paragraph because one fact is visible is not sufficient. Audit battle accounts, quotations and descriptive character context by the same principle.

### C05 — One firsthand fact removes the whole thread's hearsay label

`thread.reported` is true only if every fact in the thread is reported news. Mixed-source threads can consequently read as firsthand history. The earlier Hieron passage has an actual private spy-report source available to Clepsina, so unauthorized disclosure there remains unproven. Its provenance and uncertainty are nevertheless missing.

Track certainty and source per assertion: observed movement, agent's report, intercepted letter, public rumour and inference. Narrative can express these distinctions naturally; a single thread-wide boolean cannot.

### C06 — “Must tell” protects entry existence, not factual completeness

The new test supplies a direct reproduction: both failure facts belong to the published entry, but neither failure appears in its prose. The prompt also asks the historian to leave out absences, which can conflict with the player's need to learn that an ordered crossing did not occur. Structural JSON validation cannot establish that consequential requested results survived narration.

Require claim coverage for failed or unanswered clauses. Use deterministic short outcome lines when narration omits them. Historical colour must not add an unsupported deed, motive, location, amount or direct quotation. R24 remains the decisive fabrication example: generic breach becomes “You are a traitor.” The current quotation check can reject some borrowed attribution, but does not require exact utterance provenance for every generated quote.

### C07 — Concurrent composition weakens carry-forward and repetition control

Windows compose concurrently and publish in order. A later composition can begin before an earlier window has returned carried facts or added its published titles to `said`. Late leftovers can miss the final window, and the closing fallback only runs when nothing was published. The code explicitly leaves some late carry untold to avoid an additional serial closing pass.

This is an architectural omission/repetition risk. The refreshed run proves missing requested reporting, but not that concurrency caused each omission. Make evidence selection and outcome coverage deterministic before parallel prose generation, or retain mandatory carry across bursts and publish it through a guaranteed outcome pass. Parallel writing must not decide whether requested work gets reported.

### C08 — Dates and change lists need their own evidence boundaries

Entries sort by knowledge arrival, but stored ranges derive largely from fact event times; publication clamps later entries so they cannot be dated before already published ones. The interface gives a date without consistently distinguishing occurrence, discovery and publication. A late report can therefore blur when an event happened versus when the player learned it.

Change lists use causal/entity matching against world diffs. The ceasefire entry's visible change is Aristodemus “entering the record,” not the actual ceasefire letter, audit, supply or intelligence work. Entity creation is often implementation bookkeeping rather than a consequence the player needs. Show meaningful, known changes attributable to the matter, and label event versus receipt dates where travel matters. Do not claim the current change-list filter is wholly absent; it exists but cannot repair a wrongly grouped matter.

### C09 — The UI indexes entries and bursts, but does not fulfill the order's reporting contract

`latestReport` returns entries sharing the newest entry's burst ID. The annals present entries across the reign, with subject filters inherited from all included facts. Thus Aristodemus gains a filter under the ceasefire headline and a private mission may have no accessible progress even though its world object exists. The observed Hanno quick-path discrepancy also leaves the prior burst as “Since your last order.”

Keep the Chronicle as readable history, with a concise matter-level result for the current order. Council should list actual active tasks rather than only generic pursuits. The player should be able to discover their own confidential work privately without opening every NPC. A task receipt and truthful progress are enough; routine personnel selection and implementation remain delegated.

## Leakage verdict: what is proved and what is not

| Case | Verdict | Boundary that failed |
|---|---|---|
| Marcus says “Fictional senatorial associate” | Confirmed internal metadata leak | Dialogue construction |
| NPC asks Clepsina for material to secretly weaken Clepsina | Confirmed adversarial-intention disclosure | Initiative/chat recipient and content selection |
| Aristodemus's private negotiation intention appears in public fact and ceasefire prose | Confirmed private-intention/public-fact mismatch; no discovery justification recorded | Fact creation, then grouping |
| Hieron's secret concerns in earlier Chronicle | Missing provenance confirmed; unauthorized disclosure unproven because spy report exists | Source attribution |
| “Blue Olive” appears in the player's private saved mission | Correct; the sponsor is entitled to know it | No violation established |
| “Blue Olive” reaches public Chronicle or Hieron in new test | Not observed; targetWarned remains false | Still requires later recipient tests |
| Visible account linked to both visible and hidden facts | Current-code risk | Claim-level account filtering |
| Fabricius accusation and exact quotation | Confirmed fabricated information, not merely secret information disclosed | Narration grounding and promise evaluation |

## Corrections to the original snapshot and fair credit

- The original self-audit still exists, but the new order adds Fabricius as an independent auditor. Do not continue claiming that the only investigation is a self-audit. The new audit's public-account scope and visibility remain defective.
- The new order creates Blue Olive successfully and maintains its pending confidential state. Its internal storyline still says “Whether Hieron II lives out the year,” reproducing R42's assassination framing; it is not evidence the actual espionage mechanic became assassination.
- The punitive legion receives real provisions and continuing pay. The Roman Navy's own missing pay remains visible and unresolved; it is a different force and was not explicitly included in the order's pay clause.
- The Anio funding vote now resolves. R39–R40's earlier delay remains a historical observation; the current issue is unsupported construction narration and duplicate project continuity, not a still-pending funding vote.
- Allied supply deteriorates during the new burst, then resupply facts appear for the Bruttian levy at day 118 and Apulian, Gaetulian and Lucanian levies at day 123. Do not assert these levies are all still starving at day 127. Starvation losses and poor response continuity remain historical harms.
- No new ceasefire answer is due yet. Its no-escalation condition survives in the saved letter. Earlier wrongful war activation is not undone merely by proposing a ceasefire.
- The twelve entries comprise **five Anio entries, three Messana-funding entries, one mixed ceasefire entry, two games entries and one fleet-arrival entry**. The audit and intelligence receipt are absent.

## Fix order for the combined run

1. **Make interpreted orders durable and executable.** Each requested task needs an accountable delegate, valid references, prerequisites, budget and continuing workflow. A pursuit is not a transport project. Existing assignments should resume when authorization arrives.
2. **Make the player-facing result truthful.** Mandatory clause outcomes survive narration. Separate acknowledgment, acceptance, preparation, execution, arrival and completion. Include successful audit/spy creation as well as blocked transport.
3. **Enforce information boundaries upstream and across surfaces.** Facts, motives, dialogue, accounts, event payloads, quotes, storylines and changes share a knowledge contract. Repair derived memories and relationships from fabricated accusations.
4. **Replace entity-based editorial grouping with matter identity.** Connect task stages causally; keep independent tasks distinct even when Clepsina or Blasio participates in both. Use compact digests only for genuinely routine low-stakes events.
5. **Bind institutions and money to implementation.** Resolve approval into a spending envelope and continuing mission; preserve payer separation; ground audits in the alleged transfer; make construction update real project state.
6. **Protect core work from model-call exhaustion.** Essential tasks and player receipts take precedence over ambient world generation and repetitive speeches. Budget exhaustion leaves durable pending work and an honest summary.
7. **Repair identity and UI continuity.** Resolve every player/NPC handle; prevent indistinguishable duplicate agents; route reports correctly; refresh fast-path entries and last-order context; expose actual active work.

## Acceptance tests for this exact order

- A transport mission begins or reports a real consequential block, chooses the requested Roman fleet, arranges rendezvous and successive crossings, and has no duplicate fleet or duplicate mission. A standing pursuit alone does not pass.
- Every requested matter has a private or public receipt appropriate to the audience, with actual status and evidence. A thirty-day spy mission and sixty-day audit can remain pending, but neither disappears.
- A passed appropriation wakes the mission without a second routine command. Authorization, reservation and spending stay distinct, with the 3,000 maximum enforced and the payer disclosed.
- Fabricius investigates the alleged public-to-household diversion through linked records; the audit reports its limits and resolves only when due and evidenced.
- Blue Olive reuses or distinguishes an agent, stays unknown to uninformed actors, delivers its later report to the actual player ID and distinguishes observation, rumour and inference.
- The ceasefire letter retains the protection/self-rule/no-escalation clauses. Lack of a reply before delivery is not rejection or breach.
- `order_part_unanswered` facts cannot be converted into an apparently positive order recital. Runtime rejection messages and ambient private motives cannot masquerade as historical developments.
- A direct quote has a real utterance/message record belonging to the same matter. Promise breach requires the promised trigger and evidenced conduct, never passage of time alone.
- New tasks show under way; inert tasks show blocked; fast-path letters appear immediately in both annals and the correct newest report.

## Exact new orders and generated entries

### O15 — 333cc94d-945b-4add-9526-b257d3bce8b3

```text
Secure Messana using the forces and ships Rome already has. Arrange for the Roman Navy to collect Legio I from its present location and carry it to Messana, using successive crossings if necessary. Keep the Rhegian Punitive Legion supplied and paid. Delegate the commanders, embarkation arrangements, provisioning and routine administration to suitable people.
Seek any necessary Senate authorization and allocate up to 3,000 from the Roman treasury for this operation, keeping my personal money separate. Do not raise another fleet or duplicate an existing transport project. If a practical obstacle arises, arrange a reasonable alternative within these limits; bring me only decisions requiring additional authority or money.
Separately, appoint someone independent of me to examine the accusation that I diverted public funds. Give them access to the relevant public and household accounts, and require a finding based on evidence.
Privately send an agent to learn Syracuse’s military strength and intentions. Call this mission “Blue Olive”; keep its existence, agent and reports confidential. Send findings to me privately and distinguish observation from rumour.
Publicly seek a ceasefire with Hieron while maintaining our protection of Messana and its self-rule. Refusal or silence does not authorize further escalation.
Report the progress of transport, funding, the accounts inquiry, intelligence and diplomacy separately. Record what was ordered, what actually happened, and what remains unresolved. Quote only words someone actually said or wrote.
```

Status: committed; stop: budget_exhausted; model calls: 34.

### O16 — 97ab16b9-0a95-4700-9c92-91861be26367

```text
Write to Hanno of Carthage: We are withing our right, Messena is our protectorate
```

Status: committed; stop: order_applied; model calls: 0.

**Entry 1: Lucius Atilius Wins Goodwill with Public Games**

Lucius Atilius paid for costly public games in south-eastern Samnium, earning local goodwill and modest standing.

**Entry 2: Kaisaros of the Vaccaei Pays for a Costly Spectacle**

Kaisaros of the Vaccaei paid for a costly spectacle attended across the Uplands of the Mourbogoi. It won him substantial public standing and strengthened local cohesion.

**Entry 3: Gaius Genucius Clepsina Offers Syracuse a Ceasefire**

The Roman consul Gaius Genucius Clepsina wrote to Hieron II, king of Syracuse, proposing a ceasefire at Messana. Rome would continue to protect the city from attack while respecting its self-rule and local laws, and both sides would refrain from hostilities during talks. Clepsina also ordered that the existing naval transport order be used to carry Legio I to Messana in successive crossings if needed. Meanwhile, Aristodemus’s family began arranging a marriage, and he intended to seek a suitable match through private negotiation.

**Entry 4: Lucius Papirius Cursor Spoke for Funding the Anio Water Works**

In the Senate, Lucius Papirius Cursor argued for public authorization and funding for the Anio water works.

**Entry 5: Gaius Fabricius Luscinus Supports Funding for the Anio Water Works**

Gaius Fabricius Luscinus publicly supported authorization and funding for the Anio water works. In the Senate, Spurius Carvilius Maximus argued for the works, saying that Rome would still need water when the war ended.

**Entry 6: Lucius Postumius Megellus Opposes Funding for the Anio Water Works**

Tiberius Coruncanius publicly supported authorization and funding for the Anio water works. In the Senate, Lucius Postumius Megellus opposed them, arguing that wartime funds should go to immediate military needs.

**Entry 7: Senate Authorizes and Funds the Anio Water Works**

The Senate approved public authorization and funding for the Anio water works by 76 votes to none, with 24 abstentions. The patrician houses and landed families supported the measure, as did the Fabrician, Curian, Fabian, Coruncanian, and Claudian circles; the plebeian new men abstained. Lucius Papirius Cursor, Gaius Fabricius Luscinus, Spurius Carvilius Maximus, and Tiberius Coruncanius spoke for it, while Lucius Postumius Megellus spoke against it. The vote granted leave and funding, and the works awaited a further order to begin.

**Entry 8: Gaius Fabricius Luscinus Urges Treasury Funding for the Messana Operation**

In the Senate, Gaius Fabricius Luscinus spoke in support of authorizing up to 3,000 from the treasury for the Messana operation. He argued that the strait had to be held and the treasury should answer for it.

**Entry 9: Manius Curius Dentatus Begins the Anio Water Works**

After the Senate authorized and funded the Anio water works, the admiral Manius Curius Dentatus began construction.

**Entry 10: Lucius Papirius Cursor and Quintus Fabius Maximus Gurges Back Messana Funds**

In the Senate, Lucius Papirius Cursor supported authorizing up to 3,000 from the treasury for the Messana operation, arguing that Rome had to hold the strait. Quintus Fabius Maximus Gurges also supported the measure, but urged the Senate to keep the treasury’s cost in view.

**Entry 11: The Senate Authorizes Treasury Funds for the Messana Operation**

The Senate authorized up to 3,000 from the treasury for the Messana operation; seventy-two voted for the measure and twenty-eight abstained. The patrician houses and the circles of Fabricius, Curius, Fabius, Coruncanius, and Claudius supported it, while the plebeian newcomers and landed families abstained. Gaius Fabricius Luscinus, Lucius Papirius Cursor, and Quintus Fabius Maximus Gurges spoke in its favor.

**Entry 12: Carthaginian Fleet Enters Mamertine Land on the Northeastern Sikeloi Coast**

The Carthaginian fleet reached the northeastern coast of the Sikeloi and entered land belonging to the Mamertines of Messana without their leave.

## Retained original report: historical snapshot at 23 June

The following complete original report retains R01–R64, all fourteen earlier orders and the fourteen chat messages. Its use of “current,” “now” and “current state” refers to the **23 June snapshot**, not 6 July. Use the updated status table and corrections above when assessing the present save. Source locations refer to the inspected implementation and are navigation aids, not proof of unchanged code between snapshots.


**Audited on:** 30 September 2026. **Game:** `6f3c4541-d900-410e-abd5-4e52e901f891`, Punic Wars. **Player:** Gaius Genucius Clepsina. **Verdict:** the run fails the intended free-text/delegation experience and contains independently serious continuity, diplomacy, narration, and status-reporting defects.

The most important failure is that the game understands what the player wants but does not reliably turn it into continuing work. The player repeatedly writes variations of “take Legio I to Messana”; the game knows the destination, owns a navy, has appointed an admiral, and can describe transport prerequisites, yet leaves the legion in Rome. Meanwhile the calendar advances, wars open, and unrelated deliberations produce many speeches. This teaches the player to troubleshoot the implementation rather than govern Rome.

## Benchmark and scope

The user's vision is the controlling benchmark: **any intelligible free-text order is sufficient; routine assignments and implementation belong to the simulation; additional detail should improve control and rewards.** This does not mean every order succeeds, ignores resources, or defeats political opposition. It means an order gets a faithful interpretation and either competent execution, persistent delegated preparation, or an explicit consequential obstacle. A routine prerequisite is work to arrange, not a demand for a second player command.

Evidence examined:

- The complete pasted Chronicle and all **74 stored Chronicle entries**.
- All **14 saved order bursts**, including exact order text, timing, call counts, stop reasons, and skipped operations.
- All **14 saved chat messages**, across four conversations, including unsolicited NPC messages.
- **657 historical facts**, **29 delta-audit records**, **16 scheduled events**, and the current world snapshot. Relevant records are retained beside this report in `270-bc-clepsina-run-evidence.json`.
- The live Chrome UI at **23 June 270 BC**: Chronicle, Office, writing desk/Council, army and navy lists, expanded Roman Navy, Letters and Marcus Fabius conversation, treasury, player character sheet, and Map.
- Targeted implementation reads for transport, promises, accepted offers, refused ultimatums, pursuit fallback, underway status, and covert-plot thread creation.

Database inspection used a read-only transaction scoped to this game. No orders were submitted, time advanced, messages sent, or save state repaired during the audit. Existing working-tree changes were left alone. A duplicate naval project is already cancelled in the current snapshot; that is reported as a historical failure with a partial repair, not as two active navies today. Other repair scripts for older saves are **not evidence that their failures happened in this run**.

**Confidence:** “confirmed” means directly demonstrated in text, state, UI, or code; “inference” identifies a likely mechanism or product-quality conclusion whose full causal path is not proven. **Priority:** P0 blocks the core task or fabricates consequential reality; P1 materially undermines play or consistency; P2 creates confusion, friction, or weak feedback; P3 is presentation polish. Priorities here are gameplay priorities, not a claim of a measured WCAG compliance score.

**Finding count:** 64 distinct findings — 7 P0, 47 P1, 9 P2, 1 P3. Some findings share a root cause; related player impacts are separated so fixes can be verified individually.

## Findings at a glance

| Failure | Concrete example | Why it matters |
|---|---|---|
| Routine prerequisites become player work | Transport rejects with “They must be ordered nearer first.” | The player must arrange fleet rendezvous themselves. |
| Cosmetic persistence substitutes for execution | The 27 May transport order is an inert `pursuit`, shown as “Under way.” | Waiting appears productive when no transport is progressing. |
| Details are lost | Money, manpower, and war participation are absent from the protectorate's agreement terms. | More detailed orders fail to buy more control. |
| Time produces false betrayal | Fabricius's non-accusation promise expires; Chronicle invents “You are a traitor.” | Relationships are damaged by fabricated conduct. |
| Conditional threats change meaning | Syracuse maintains its pause but rejects Rome's claim restriction; war opens. | Refusing wording substitutes for continuing attacks. |
| Narration and reality diverge | Admiral Dentatus exists, but Roman Navy remains under Clepsina. | The player cannot trust appointments or reports. |
| Political process dominates execution | Many nearly identical speeches; approved inquiries have no corresponding investigation. | The game simulates talking more reliably than doing. |
| Model limits shape history | Seven of nine substantial simulation bursts stop at `budget_exhausted`. | Incomplete cognition and technical limits masquerade as historical pacing. |

## A. Orders, delegation, and military execution

### R01 — [P0, confirmed] A complete strategic transport order does not launch the prerequisite work

**Evidence:** Orders O11, O12, and O14 explicitly ask the Roman navy to carry Legio I to Messana. Both O11 and O14 attempt a `military_transport` project and are rejected because ships are not near enough. Current state has no active project carrying Legio I or arranging its embarkation; it remains at `it-l865w`, Rome's province.

**Impact:** A sufficient intent becomes a dead end requiring manual logistics. **Fix:** persist a transport mission that arranges embarkation, fleet gathering, loads, provisions, and escort, with an accountable executor. Only genuine policy choices should return to the player.

### R02 — [P1, confirmed] Repeating the same intent does not resolve or consolidate it

**Evidence:** O10 promises to send Legio I, followed by O11 on 17 May, O12 on 27 May, and O14 on 9 June. At 23 June, 37 days after O11, the legion is still in Latium. Later orders neither repair nor replace the stalled mission with an executable plan.

**Impact:** The player is encouraged to hunt for magic wording and pays for repeated attempts. **Fix:** recognize the standing mission, update its constraints, and resume its next valid step; report how the new instruction changed the plan.

### R03 — [P0, confirmed] A transport order can fall through to an inert pursuit

**Evidence:** O12's audit explicitly says “The order left nothing in the world; recorded as a pursuit.” Its entity has a label and `sinceDay: 87`, no linked entities, and no transport milestones. The mechanic writer then judges the pursuit “no rule.” `burst.ts` explicitly says the fallback “does nothing and costs nothing.”

**Impact:** Remembering an intention is presented as undertaking it. **Fix:** an ordinary supported military order must produce an executable mission or an explicit blocked state. Reserve descriptive pursuits for genuinely open-ended activities with a defined progress/review mechanism.

### R04 — [P1, confirmed] Transport feedback recommends a different fleet from the one requested

**Evidence:** The player names Roman Navy; the rejection singles out the nearer Allied Greek hulls, capacity 540, rather than the Roman Navy, which the live UI lists as 150 ships and capacity about 4,500.

**Impact:** The player receives an incomplete explanation of their available means and is nudged toward the small fleet. **Fix:** honor the explicitly selected navy, evaluate gathering it, and explain the named fleet's location, capacity, and mission sequence. Additional usable fleets can be optional alternatives.

### R05 — [P1, confirmed] Route descriptions contradict their own embarkation plan

**Evidence:** O14's refused project is titled “Bring the Roman Navy to Rome to embark Legio I,” but its first milestone says sail to Rhegium and rendezvous with Legio I. The legion is in Rome; no march to Rhegium is created. O11 likewise describes a march south inside a project that is rejected as a whole.

**Impact:** A superficially plausible plan contains an impossible rendezvous. **Fix:** validate every leg against predicted locations and schedule missing prerequisite legs as real work.

### R06 — [P1, confirmed] Delegating navy leadership creates a title without the operational assignment

**Evidence:** O07 says “task someone to be in charge of it.” Dentatus takes the admiral seat at step 60. Roman Navy's commander and controller remain Clepsina, and the expanded force UI says “Under Gaius Genucius Clepsina.”

**Impact:** The player made the delegation decision but still owns execution. **Fix:** connect the appointment to the intended fleet, authority, mission responsibility, and reporting. Distinguish strategic control from operational command when both remain meaningful.

### R07 — [P1, confirmed] The raised navy has no routine pay arrangement

**Evidence:** Roman Navy has `payObligationId: null`; the Office flags “nobody has undertaken to pay them.” O02 requested a navy, and O07 requested continued support and a person in charge. Neither produced a navy pay obligation.

**Impact:** A routine administrative requirement comes back as player micromanagement after ships are declared ready. **Fix:** creating a usable fleet must include crews, maintenance, provisions, and an affordable funding plan, or explicitly make it a partially funded fleet.

### R08 — [P1, confirmed] Reduced punitive-legion pay is set without a useful explanation of its consequences

**Evidence:** O09 succeeds in establishing Rome-funded punitive pay of **35 Drachmae every 30 days**. Chronicle says only that wages were sharply reduced. The force grows to 3,500 men; the report does not explain adequacy, likely discontent, or the comparison with ordinary legion pay.

**Impact:** The player supplied a deliberate policy detail but receives little strategic feedback or visible reward/tradeoff. **Fix:** report the adopted pay level, savings, sustainability, and resulting troop response. Low pay need not be forbidden, but it should have legible consequences.

### R09 — [P1, confirmed] The surrendered garrison persists alongside its replacement punitive force

**Evidence:** After surrender and punitive reorganization, the old Campanian legion remains a 3,600-fit-man force under Decius and `rhegium-campanians`. The new Roman punitive force separately reaches 3,500. No state record explains how the original men were transferred, divided, retained, or demobilized.

**Impact:** The same settlement appears to leave two military populations and two command structures. Actual duplication of individual soldiers cannot be proved without personnel identity records; the continuity gap itself is confirmed. **Fix:** conversion should conserve personnel and record the disposition of every part of the old force.

### R10 — [P1, confirmed] A punitive service force is implemented as fresh reinforcement without a clear source

**Evidence:** The new punitive force begins at 1,000 men and receives reinforcement increments of 833, 833, and 834. The surrender concerns the existing garrison, not a request to recruit new civilians. The old garrison is not reduced correspondingly.

**Impact:** Sentence, recruitment, and military conversion become interchangeable. **Fix:** transfer surrendered personnel into the service force, preserve origin and legal status, and explain any losses or exemptions.

### R11 — [P1, confirmed] Ten-year service and restored citizenship lack an executable obligation

**Evidence:** The player's exact letter and Decius's acceptance include ten years under Clepsina's command and restored citizenship afterwards. There is no matching `lifeContract`, service-release scheduled event, or structured expiry in the retained state; later summaries reduce the deal to ordinary Roman command and provision.

**Impact:** The most detailed terms can disappear before their future consequence is due. **Fix:** persist service start/end, command, legal status, citizenship restoration, and responsibility for release. Keep negotiated changes explicit.

### R12 — [P1, confirmed] “Protect and hunt” becomes tactical prose without continuing field work

**Evidence:** O11 says both legions will protect Messana and hunt Syracusan armies. Both forces receive `battlePlan` rationales about locating an enemy first. The punitive legion arrives, but the retained state has no linked patrol/scouting mission or continuing hunt project; there are no engagements, blockades, or sieges.

**Impact:** Waiting for reconnaissance becomes indefinite because no one is assigned to do it. This does not prove a battle ought to have happened. **Fix:** translate the standing mission into patrol, intelligence, contact, and engagement rules, with a next report even when no enemy is found.

## B. Diplomacy, geography, and sovereignty

### R13 — [P0, confirmed] The protectorate discards the player's added terms

**Evidence:** O08 accepts protection in exchange for money, manpower, and participation in Rome's wars. The active protectorate contains the Mamertines' incoming request for protection and self-rule instead. No matching tribute/manpower obligation records the reply's added clauses. `bindTheAcceptance` builds `agreement_open.terms` from `message.terms`, not the acceptance text.

**Impact:** Free-text negotiation details do not become treaty reality. **Fix:** reconcile the incoming offer and reply into a final agreement; material additions require counterpart acceptance or a clearly pending counteroffer. Persist each accepted obligation.

### R14 — [P1, confirmed] Acceptance of protection is treated as final while negotiations keep reopening its existence

**Evidence:** The protectorate is active from 3 May. Blasio says “Rome will protect you” on 21 May, then “I cannot pledge Roman protection without terms” on 1 June. Messana repeatedly asks whether Rome will protect it while the agreement is already active.

**Impact:** The player cannot distinguish a binding commitment, its practical implementation, and renegotiation. **Fix:** all diplomats should reason from the existing agreement and discuss unresolved clauses explicitly rather than repeatedly restarting the same question.

### R15 — [P0, confirmed] The war trigger does not preserve the player's condition

**Evidence:** O11 threatens war if Syracuse continues hostilities. Hieron's actual answer says Syracuse will maintain its present pause, but refuses the demand as renouncing its claim/right to negotiate. The game opens war on 5 June because `onRefusal === "war"`. The Chronicle says this is what the warning required.

**Impact:** Rejection of wording is substituted for continued attacks. **Fix:** persist and evaluate the actual trigger—renewed hostile action versus refusal of a claim restriction. A conditional ultimatum must not become an unconditional refusal-to-war switch.

### R16 — [P1, confirmed] War with Carthage is introduced without a clear player-facing decision chain

**Evidence:** O12 asks for transport. Its opening facts assert Rome's crossing caused war with Carthage. There is an active war from step 87, but no player decision record; the later Carthaginian protest and Hanno's ongoing stated goal of neutrality do not clarify who declared war, what hostile act constituted it, or what conditions ended neutrality.

**Impact:** A major geopolitical consequence feels mechanically inserted rather than causally earned. Autonomous war is valid; opaque causality is the defect. **Fix:** record the deciding actor, declaration or attack, knowledge arrival, and reason, and narrate the transition to war before subsequent diplomacy treats it as settled.

### R17 — [P1, confirmed] Diplomatic reasoning does not consistently update after war

**Evidence:** After the Carthaginian war begins, Hanno's plans still describe keeping Carthage neutral and consultation without intervention. Syracuse's conversations repeatedly negotiate pauses without clearly responding to its new war with Rome.

**Impact:** War is a state flag that does not reliably change actors' strategy. **Fix:** invalidate or revise plans and assumptions when war opens; allow continued negotiations, but make their new purpose explicit.

### R18 — [P1, confirmed] Two alternative Rhegium settlements are accepted without reconciliation

**Evidence:** Dentatus's earlier offer demands delivery of killers for judgment. The player's later offer says the “only punishment” is ten years' service and restoration of citizenship. Decius's acceptance combines service with delivery for judgment, and the active peace agreement retains the earlier terms.

**Impact:** The player cannot tell which promise governs punishment and what discretion Rome retained. **Fix:** version the settlement, identify superseded clauses, and surface incompatible terms before treating the combined text as a final deal.

### R19 — [P1, confirmed] An accepted settlement keeps being administratively renegotiated

**Evidence:** Acceptance appears on 21 March and 5 April; possession occurs 17 April; Blasio again agrees to terms on 9 May. The Rhegium storyline is still `resolving` and expects Senate deliberation about punitive administration.

**Impact:** Successful settlement does not close its completed business, encouraging repeated player intervention. **Fix:** separate “agreement,” “handover,” “service administration,” and genuinely disputed judgment; close each completed stage and retain only unresolved work.

### R20 — [P1, confirmed] Rhegium's province is mislabeled as the southwest coast of Sicily

**Evidence:** The saved province `it-5sjyb` contains Rhegium and coordinates 38.0654, 15.7646, but is named “South-western coast of the Sikeloi.” Both the Chronicle and naval list repeat this label. Messana's distinct province is `sic-q659z`.

**Impact:** The player is told a mainland surrender gained a Sicilian coast; embarkation geography and distance reports become misleading. **Fix:** reconcile province labels with geometry and settlement identity, then refresh dependent presentation. This is a label/identity mismatch; this audit does not establish that the geometry itself moved.

### R21 — [P1, confirmed] The surrender transfers a province from Bruttians rather than the surrendering Campanian polity

**Evidence:** The 17 April change records `it-5sjyb` passing from Bruttians to Rome while the peace is with `rhegium-campanians`; the old Campanian force remains there. Province control, settlement control, and garrison occupation are not explained together.

**Impact:** The conquest/settlement appears to dispossess a third party without a reason. **Fix:** distinguish sovereignty, occupation, city control, and garrison surrender. If Rome also gains Bruttian territory, make that an explicit, justified consequence.

### R22 — [P1, confirmed] Diplomacy repeatedly fails on invented or corrupted references

**Evidence:** Audit records include `mamertines-of-messana` instead of the existing polity, a letter to Rhegium addressed to Mettius, mixed-burst message IDs, and O12 reply IDs whose UUID contains `a70d` instead of the real `a70b`. Some remain uncorrected after the budget runs out.

**Impact:** Plausible NPC responses silently fail, leaving diplomacy in loops. **Fix:** use resolved entity handles, retrieve the actual target message, and validate identity before generation. Repairs for the player's active causal chain should have priority over unrelated cognition.

## C. Chats, promises, investigations, and personal life

### R23 — [P0, confirmed] A promise to refrain from accusing expires as though it were an unfinished task

**Evidence:** Fabricius promises “I will not call you a traitor without proof.” It is marked overdue and broken at step 67 with reason “He let its day pass twice.” `promises.ts` treats `other` as fulfilled by writing a diplomatic letter; lack of such a deed eventually becomes breach.

**Impact:** Keeping a negative promise by doing nothing becomes betrayal. **Fix:** represent prohibitions and conditional commitments separately; breach requires the prohibited act and failure of its exception, not elapsed time.

### R24 — [P0, confirmed] The Chronicle invents an accusation and direct quotation

**Evidence:** The 7 May entry cites only `fact-dc356199-...-64`, a generic `promise_broken` fact. It expands this into Fabricius calling Clepsina a traitor on the Almo and quotes “You are a traitor.” The saved chat says the opposite; no corresponding accusation fact supports the scene.

**Impact:** An engine bookkeeping error becomes a fictional deed, place, and verbatim speech. **Fix:** direct quotations and consequential claims must be grounded in an actual speech/message/action record. Narration may explain a breach record but cannot manufacture the missing act.

### R25 — [P1, confirmed] The false breach changes relationships and personal learning

**Evidence:** On a time-based breach, `promises.ts` adds grievances, trust/reputation penalties, kin reactions, and teaches the beneficiary that they were “betrayed.” Both saved promises are broken with the same generic time reason.

**Impact:** The erroneous record contaminates later NPC behavior, not just a paragraph. **Fix:** require evidence before sanctions and provide a correction path that reverses derived relationship and memory effects as well as fixing narration.

### R26 — [P1, confirmed] Blasio's conditional support is evaluated against a generic clock

**Evidence:** His promise concerns a defensive levy/navy and not prematurely proclaiming Carthage an enemy. It is marked broken on 23 April because its day passed twice. It does not identify the promised procedure or demonstrate refusal when that procedure was presented. His earlier support for the legion is retained, but predates the chat promise and therefore cannot establish later fulfillment.

**Impact:** A context-dependent promise is judged without the context needed to decide breach. **Fix:** attach it to the qualifying measure and trigger. If its conditions never occur, leave it pending or expire it without betrayal.

### R27 — [P1, confirmed] Character setup metadata leaks into NPC dialogue

**Evidence:** Marcus Fabius's unsolicited first message is “I will say it to your face, since you will hear it anyway: Fictional senatorial associate.” This is visible in the live chat, not merely a database annotation.

**Impact:** The game breaks character and presents no meaningful accusation for the player to answer. **Fix:** ensure personality/relationship setup fields are never used as spoken event text; generate an actual in-world line or omit the message.

### R28 — [P1, confirmed] A secret adversarial plan is delivered to its own target as a friendly request

**Evidence:** Gaius Genucius privately wants to weaken Clepsina without exposing the inquiry. His unsolicited message to the player says: “I have a favour to ask of you, as a friend: Find material that could weaken Clepsina without exposing the inquiry..”

**Impact:** A covert antagonist reveals the scheme to the intended victim, and asks the victim to execute it. **Fix:** validate recipient against goal/plot roles and secrecy; only disclose the plot if an actual discovery or deliberate confession occurred.

### R29 — [P1, confirmed] The identity of the accuser is not made clear

**Evidence:** The Senate inquiry and player's counter-investigation center on Dentatus, while Marcus Fabius speaks as a theft accuser and later withdraws his accusation. These are distinct people; the Chronicle does not explain whether Marcus supplied the original charge, repeated it, or made another accusation.

**Impact:** The player can win a conversation without knowing whether it resolved the political problem. **Fix:** track allegation identity, originator, repeaters, evidence, and withdrawal separately; link every related conversation and inquiry to that case.

### R30 — [P1, confirmed] Withdrawal of the accusation does not visibly resolve the case

**Evidence:** Marcus explicitly admits no proof and withdraws the charge. A private conversation fact records this, but the active “Senate accusation of diverting public funds” pressure remains at intensity 65. No Chronicle entry closes or materially revises the accusation on that basis.

**Impact:** Chat success lacks a clear consequence. Marcus's withdrawal need not cancel Dentatus's separate inquiry; that distinction must be explained. **Fix:** update the relevant allegation and report which investigations remain and why.

### R31 — [P1, confirmed] An approved investigation becomes permission without execution

**Evidence:** The Senate approves investigation of Dentatus 100–0 on 18 April. The retained world has only one audit, of Clepsina's household; there is no separate Dentatus investigation/audit or assigned investigator corresponding to that authorization.

**Impact:** “Launch an investigation” gets interpreted as “ask permission,” after which the player must arrange the rest. **Fix:** a launched investigation should continue automatically after approval with scope, investigator, evidence gathering, due report, and resolution.

### R32 — [P1, confirmed] The supposedly independent books inspection is a self-audit

**Evidence:** Chronicle says the books were opened “for an auditor.” The audit names Clepsina as both ordered-by and auditor, clears at step 107, and narrates only that he found his own estates in order.

**Impact:** The player is given reassuring prose without an independent evidentiary resolution to the Senate charge. **Fix:** assign an appropriate auditor by default or openly label it a personal review; distinguish personal reassurance from institutional exoneration.

### R33 — [P1, confirmed] Clearing the books does not close the accusation or counter-investigation

**Evidence:** The audit is `cleared`; the accusation pressure remains active and its review date is long past. The Dentatus inquiry has no resolution. Chronicle reports clean books on 16 June but no verdict, reputational recovery, or next step.

**Impact:** Narrative threads persist beyond the event that ought to change their status. **Fix:** propagate the finding to the allegation, Senate case, interested actors, and player status; explain residual uncertainty instead of leaving stale danger unchanged.

### R34 — [P1, confirmed] Serious illness remains active for months without legible progression

**Evidence:** Clepsina's grave illness starts at day 0, review day 14, intensity 82; it is still active at day 114. Blasio has another grave-illness pressure from day 63, review day 93, also active. Their activity continues without a clear recovery, worsening, treatment, or incapacity report. The inspected primary player-sheet facts do not show Clepsina's illness.

**Impact:** Severe personal events feel like disconnected random flavor or hidden stale state. **Fix:** give illness a tracked progression, treatment responsibility, functional effects, and understandable resolution/status.

### R35 — [P1, confirmed] Ruinous debt exists as pressure without a financial contract

**Evidence:** A private creditor calls in a debt beyond Clepsina's means. Current material state has no loans, and the pressure supplies no creditor, principal, interest, repayment obligation, or exact shortfall. His personal money is 9,243 Drachmae in the UI.

**Impact:** The player cannot understand or act on the purported ruin through the financial systems. **Fix:** instantiate the debt and creditor or explicitly make it an unverified demand; give the player an amount, deadline, consequences, and delegated negotiation options.

## D. Politics, projects, AI continuity, and intelligence

### R36 — [P1, confirmed] Named supporters do not correspond to the vote result, without explanation

**Evidence:** Four named senators speak for raising Legio I, but the vote has zero support. Blasio speaks against the accounts inquiry, which passes 100–0. Stored vote outcomes are based on bloc weights, while individual support positions are reported alongside them.

**Impact:** The player cannot tell whether persuading these characters affects votes or merely produces speeches. This is not proof that every speaker must count as a separate voter. **Fix:** show the connection between individual influence and bloc position, and explain non-voting speech, failed persuasion, abstention, or defection where relevant.

### R37 — [P1, confirmed] The first fleet vote is narrated before it is actually resolved

**Evidence:** A 1 March entry says the Senate voted to raise the fleet, while the procedure resolves at step 2, 3 March. On 1 March all three blocs are described as backing the limited proposal; the final tally instead has patricians for, plebeians against, landed families abstaining.

**Impact:** Proposals and projected approval are published as accomplished acts. **Fix:** write “proposed/supported/pending” until the deterministic vote fact exists, then report the actual changed positions.

### R38 — [P1, confirmed; partially repaired] One navy request produced two construction projects

**Evidence:** O02 creates two projects with identical label and 150-ship completion outcomes, cost 925 and 935. One completes; the other is now cancelled. The completed project's linked force ID derives from O07 rather than O02, so identity continuity was also revised.

**Impact:** Duplicate projects risk double spending and contradictory readiness. **Fix:** make proposal-to-project enactment idempotent and retain provenance for repairs. Current state has one Roman Navy; this finding must not be described as two active fleets.

### R39 — [P2, confirmed] Later fleet authorization reopens business already approved and nearing completion

**Evidence:** The navy is authorized 3 March, construction completes 28 April, and a new fleet debate opened 3 April passes 3 May. The second procedure explicitly gives leave and begins nothing by itself.

**Impact:** The player may infer the earlier navy still needed permission, or that the second vote creates another fleet. **Fix:** identify whether the motion changes scope, budget, or use of the existing fleet. A restated request should strengthen or amend the current project instead of starting an ambiguous parallel permission loop.

### R40 — [P1, confirmed] The Anio survey is duplicated and authorization milestones finish before authorization

**Evidence:** Two open Anio projects share Dentatus, survey work, and construction aims. Their “secure/seek public authorization and arrange funding” milestones are marked completed at steps 107 and 108, while the real authorization procedure remains gathering support until its deadline at step 119.

**Impact:** Project progress claims prerequisites were satisfied while the polity still deliberates. **Fix:** deduplicate continuing work and bind authorization milestones to the actual procedure outcome, not just elapsed offsets.

### R41 — [P1, confirmed] “Use Roman silver” is planned against an individual's purse without a disbursement outcome

**Evidence:** Senate aid passes 1 June. The resulting subsidy project starts 13 June, is funded from `ogulnius-purse`, has two zero-cost milestones, and `completionOutcome: null`. It does not specify recipients, amounts, or an actual payment instruction.

**Impact:** Public aid can appear underway while no state mechanism will deliver the silver. **Fix:** assign treasury funding, recipients, amounts, and transfer outcomes, or a real preparatory phase that produces those decisions before disbursement.

### R42 — [P1, confirmed] The spy mission's thread is framed as an assassination

**Evidence:** The covert plot is correctly `kind: espionage` and resolves `learned`. Its generated storyline says “Something laid against Hieron II,” stakes “Whether Hieron II lives out the year,” and next development “Whether the hand gets near enough.” This text is hard-coded for covert plots regardless of kind.

**Impact:** An information-gathering order acquires murderous stakes that can distort future narrative/cognition. **Fix:** create mission-specific thread text and closure. This audit found no actual assassination or lethal espionage result.

### R43 — [P2, confirmed] Successful intelligence is not clearly attributed to the requested spy

**Evidence:** The spy-report fact at step 93 is private and known to Clepsina. The 2 June Chronicle describes Hieron's goals, secret concerns, and administrative overload as an entry about Hieron, without saying this is Publius Nerius's report or indicating its reliability.

**Impact:** The player cannot connect their order to the result or distinguish agent intelligence from ordinary public news. **Fix:** report that the agent returned information, identify confidence/source, and separate observations, hearsay, and inference.

### R44 — [P1, confirmed] Diplomatic negotiation loops repeat nearly equivalent proposals without closing them

**Evidence:** The Messana storyline repeatedly records requests for notice, consultation, meetings, written pauses, and practical guarantees. Multiple similar accepted messages coexist; late history still asks for terms already discussed. Gaetulian testimony is likewise collected/comparing/recollected through several fired scheduled events.

**Impact:** NPC agency spends time generating procedure rather than materially changing the crisis. **Fix:** track unresolved questions and novelty; accepting a consultation timetable should finish that negotiation unless a new dispute arises. Give repeated inquiry a new evidence result or explicit dead end.

### R45 — [P1, confirmed] Duplicate generated people appear in the same polity

**Evidence:** The Letters directory lists two “Abd al-Malik of Gerrha — Gerrhaean ruler” contacts. The live world also retains Taymu, an existing Gerrha ruler; O04's generated Abd al-Malik rationale says Gerrha had no named ruler. Britomaros appears separately under Sequana peoples and Sequani.

**Impact:** Entity generation does not consistently reuse existing identities, and the player cannot distinguish duplicates from legitimate multiple office holders. The Britomaros pair is a suspected identity collision, not proven to be one person. **Fix:** resolve existing characters before generating another; provide distinguishing office/identity context when names legitimately repeat.

### R46 — [P1, confirmed] AI schema failures drop meaningful operations and plans

**Evidence:** Saved skipped lists include `plan`, `stepsTaken`, diplomatic sends, facts, affected references, and whole deltas. O07 retains one fact naming refused work after reconciliation is denied by the budget. Seven unrelated audit openings fail because no audit scope was supplied.

**Impact:** The visible history can outlive or diverge from the work it claims happened. **Fix:** validate structured handles/required fields earlier; reconcile facts with accepted deltas before publication. Preserve a useful blocked explanation where correction is impossible.

### R47 — [P1, confirmed] Unsupported routine NPC actions repeatedly consume the repair budget

**Evidence:** O02 contains seven separate “An audit goes through a department's books or a household's; name one” refusals from unrelated rulers. Other failures repeatedly omit an institution for a vote. These are ordinary administrative acts, not fundamentally impossible actions.

**Impact:** The world's implementation gaps compete with execution of the player's actual mission. **Fix:** infer or create the appropriate scope/institution within authority, constrain generation to supported forms, and prioritize repair of consequential work over repeated low-value attempts.

## E. Supply, finance, pacing, and consequences

### R48 — [P1, confirmed] Allied mobilization does not include enough routine supply management

**Evidence:** Treaty mobilization produces roughly 26,000 men for Rome's Carthaginian war. The Lucanian Tribal Levy later reaches critical supply and suffers eight hunger deaths and twelve desertions at day 114. No convoy or delegated provisioning work is retained for it.

**Impact:** Broad war/mobilization creates routine logistical chores without competent follow-through. Attrition can be valid, but it should result from an actual constraint or failure of an assigned supply plan. **Fix:** levy creation should include supply responsibility, projected exhaustion, sourcing, and an escalation before avoidable deaths.

### R49 — [P1, confirmed] Navy readiness feedback contradicts its dated provision record

**Evidence:** Roman Navy's `provisionedThroughStep` is 88, current day is 114, yet `provisionStatus` remains `provisioned` and the UI says “fed.” It is also unpaid.

**Impact:** A readiness view can reassure the player about an overdue supply window. Local replenishment could legitimately explain this, but no renewed through-date is recorded. **Fix:** make the status and dated record agree, and distinguish ship stores from local replenishment and crew pay.

### R50 — [P2, confirmed] Hunger reporting omits losses that have already happened

**Evidence:** The 20 June Chronicle says short rations beneath Mons Vultur. By the current day, the levy is critical and the saved personnel history includes 20 men lost. The current main force panel covers the two Roman legions, so this allied deterioration is not summarized there.

**Impact:** A known supply crisis does not give the player a current picture of severity or loss. **Fix:** update the report or allied situation summary when condition changes; distinguish first warning from later casualties.

### R51 — [P1, confirmed] The treasury surplus excludes an unfunded navy's obligations

**Evidence:** UI reports treasury 11,448 and surplus 1,161 per month, while the 150-ship navy has no pay obligation. No corresponding navy wage appears among recorded regular expenditure.

**Impact:** The player sees money “to spare” because a major force's routine commitment was never booked. The arithmetic may be correct for recorded obligations; the financial model is incomplete. **Fix:** show committed, funded, and still-unfunded costs separately and establish ordinary force liabilities at creation.

### R52 — [P1, confirmed] Technical budgets dominate when substantial orders stop

**Evidence:** Seven of nine nontrivial simulation bursts end `budget_exhausted`; all 14 bursts are stored as `committed`. Skipped records explicitly leave actors unasked, abandon reconciliation, and stop reaction chains at the call limit.

**Impact:** Historical outcomes depend on which tasks fit the technical allowance. “Committed” does not mean all requested parts were answered. **Fix:** persist unfinished work and resume it; reserve player-visible stopping for a meaningful state, explicit technical interruption, or requested time span.

### R53 — [P1, confirmed] Straightforward order retries are slow and paid

**Evidence:** O12 takes 245.3 seconds and 33 counted model calls while its transport request produces an inert pursuit. O14 takes 182.6 seconds and 26 calls while transport is again rejected. Nine substantive bursts take 51.8–245.3 seconds. The run totals 240 counted calls; UI reports 0.402556 coins spent, last order about 0.054.

**Impact:** The player pays in time and coins to repeat an unresolved intent. **Fix:** reuse the existing plan, bound irrelevant reaction work, and make technical failure distinguishable from a meaningful game-world refusal. Call totals include historian work; they are not all orchestration calls.

## F. Chronicle and UI truthfulness

### R54 — [P0, confirmed] The UI labels the inert transport pursuit “under way”

**Evidence:** The desk shows one order under way: “Order the Navy to take Legio I and the Punitive Legion to Messana. Since 27 May 270 BC.” Both failed transport attempts are absent as actionable blocked missions. `under-way.ts` unconditionally sets pursuit `stalled: false`.

**Impact:** Waiting appears to be the correct next action when no executable transport is advancing. **Fix:** distinguish intent recorded, planning, queued, active, blocked, and completed. Status must follow actual work, with executor and next milestone.

### R55 — [P1, confirmed] The selected mission is not the UI's main actionable problem

**Evidence:** The Office chiefly highlights a protest and unpaid navy; the top status previews the Anio vote. The writing desk's transport pursuit has no blocked reason, owner, arrival estimate, capacity plan, or repair action.

**Impact:** The player who wants Legio I moved must reconcile Chronicle, force list, and Council themselves. **Fix:** give the player's current order a compact, truthful result and next-step summary. Keep routine remedies delegated; expose only decisions requiring the player.

### R56 — [P1, confirmed] Silence is presented as a letter the player wrote

**Evidence:** The Letters list says “You wrote” to Mettius on 22 June and to the Mamertine envoy on 23 June. Their latest answer records are actually `answer: ignored`, `answerText: No answer came.`, at steps 113 and 114. `correspondence.ts` creates an answer page with reversed `fromYou` even for ignored letters; the chat panel then renders it as “You wrote.”

**Impact:** Not answering is falsely represented as an authored outgoing message. **Fix:** render silence as a status on the incoming letter, never as a speech or outgoing page. Keep actual personal and delegated authorship explicit for real letters.

### R57 — [P2, confirmed] Chronicle entries mix unrelated matters and attach misleading headlines/quotes

**Evidence:** A Senate vote entry also reports Iazygian hunger; the Rhegium handover includes a Sequani marriage; the levy request includes Numidian and Gerrhaean force generation. The 5 April headline concerns religious signs but quotes Decius accepting service. The 23 April broken-Blasio-promise entry quotes Fabricius's separate promise.

**Impact:** Headlines, subject filters, and memorable quotations cease to identify the event being reported. **Fix:** split independent developments and bind quotes to the entry's main fact. A shared date or model call is not a causal connection.

### R58 — [P2, confirmed] Repeated speeches crowd out decision-relevant changes

**Evidence:** Fleet support gets multiple entries from 28 April through 3 May; allied silver support repeats through 27–31 May, then votes 1 June. Similar sentences recur without changed coalition, amendment, new evidence, or execution progress.

**Impact:** The player reads a large amount of text to learn little, while transport and inquiry execution remain obscure. **Fix:** aggregate unchanged positions and report only changed support, decisive argument, bargain, vote, or implementation milestone.

### R59 — [P2, confirmed] The live status bar uses contradictory timing language and counts

**Evidence:** At 23 June it previews “Decided by now: public authorization and funding for the Anio water works” **in 5 days**. The header says **3 want your word**; the Office's accessible list says **2 things want your word**, with two marked objects.

**Impact:** Overdue versus upcoming and total decisions versus marked objects are unclear. The count difference may be legitimate grouping, but the presentation does not explain it. **Fix:** distinguish “decision due in five days,” “overdue,” and “resolved,” and make the attention count's unit explicit.

### R60 — [P2, confirmed] Correspondence briefly shows a false empty state while loading

**Evidence:** Opening Letters first shows “Nobody yet. Find someone nearby to speak with,” then loads existing chats, waiting correspondence, and the contact directory. Selecting Marcus first shows “Finding what was said…” with an enabled-looking composition area.

**Impact:** A populated save initially appears to have lost its contacts. **Fix:** distinguish loading, empty, and failed states; preserve prior data while refreshing. The observed loading transition is confirmed; a persistent empty-list failure was not found.

### R61 — [P2, confirmed] The letters directory exposes a huge global list and duplicate identities

**Evidence:** The loaded accessibility tree contains more than 1,300 indexed elements, listing distant polities and rulers before the selected conversation, including the duplicated Gerrha ruler.

**Impact:** The correspondence panel asks the player to navigate the world's cast while they need a small set of relevant actors. **Fix:** prioritize recent, local, mission-related, and incoming contacts; progressively reveal the broader directory. Keep search and “find someone else” for intentional exploration.

### R62 — [P2, confirmed] The map exposes little entity information to accessibility inspection

**Evidence:** The observed map tree exposes an image/interaction layer and zoom buttons, but no named province/force controls; the screenshot visibly contains many province labels and standards. The current camera places Messana and its clustered forces at the right edge.

**Impact:** Map-only strategic information is not exposed equivalently in the inspected accessibility surface, and the current mission is difficult to scan at this framing. **Fix:** provide a keyboard-accessible entity list/inspector and an affordance to focus the map on the mission. Keyboard traversal and full WCAG testing were not performed, so this is a verified exposure gap, not a complete compliance verdict.

### R63 — [P3, confirmed] Raw implementation vocabulary and naval-inappropriate language reach the player

**Evidence:** Chronicle says Dentatus “takes up `rome:admiral`”; the navy “marches” under a standard, and the Carthaginian fleet's project is called a march. The player sees long descriptive province names instead of Rhegium/Messana in several force views. Wallet and spend values use six decimal places in prominent UI.

**Impact:** Internal schema and awkward precision break the historical voice and make reading harder. **Fix:** render office labels, nautical movement verbs, settlement aliases alongside provinces, and readable currency precision while retaining exact values in details.

### R64 — [P1, confirmed behavior; UX failure inferred] Default order advancement can consume diplomatic reply windows

**Evidence:** O12 and O14 advance the world through multiple days until model-budget exhaustion. Incoming requests for concrete protection and practical terms lapse with “No answer came,” including the two now mislabeled as outgoing messages. There are no player-decision records in this run.

**Impact:** A player trying to complete logistics can incur diplomatic silence while the engine spends time on unrelated business. Choosing to wait may validly carry that risk; the default “as long as it takes” path does not visibly distinguish it from progress toward the mission. **Fix:** make meaningful incoming deadlines salient, have authorized officials answer routine implementation questions, and stop or explicitly warn before unresolved player-level choices lapse.

## G. Systemic interpretation

These are not 64 unrelated bugs. Several failures share the same missing contracts:

1. **Intent → accountable work.** The parser recognizes orders, but dependency planning, executor assignment, funding, and continuation are not reliably committed together. R01–R12, R31, R41, R48, and R54 are manifestations.
2. **Words → final terms.** Incoming letters, acceptance text, conditions, clauses, and resulting agreements do not share one canonical negotiated result. R13–R19 follow from this gap.
3. **Evidence → fact → narration.** A generic breach or approval can become a concrete deed the record never established. R23–R25, R37, and R57 show why prose validation must be semantic, not just schema validation.
4. **State change → updated dependent beliefs.** War, surrender, exoneration, and office appointment do not consistently revise all related plans, pressures, commands, and threads. R06, R09, R17, R19, R30, R33, and R40 expose this.
5. **Status → truthful next action.** The interface reports existence of an object as existence of progress, and mixes personal authorship with polity authorship. R54–R61 show the resulting burden on the player.
6. **Technical work budget → persistent unfinished work.** Budget exhaustion drops cognition/repairs rather than preserving an honest continuation boundary. R22, R46, R47, R52, and R53 recur together.

“More details equals more rewards” should be implemented as better constraints, execution quality, speed, efficiency, political leverage, or strategic outcomes where the details make sense. It should not reward word count, require a player to name a nonexistent administrative object, or make a vague but clear order inert. This run already demonstrates that **more words alone do not solve the problem**: the detailed transport plan, negotiated service, and protectorate reply all lose essential meaning.

## H. Recommended fix order and acceptance checks

| Order | Concrete change | Acceptance check using this run |
|---|---|---|
| 1 | Make military transport a persistent delegated mission with prerequisite legs | “Use the Roman navy to transport Legio I from Rome to Messana” creates a fleet rendezvous/embarkation/crossing plan without a second order. It handles multiple loads and real resource limits, shows commander and estimate, and moves both forces consistently. |
| 2 | Remove false execution status and bind narration to evidence | O12 cannot appear actively underway unless a real mission exists. Fabricius cannot acquire an accusation or quote from a timeout. A refused delta cannot support an accomplished-event headline. |
| 3 | Preserve conditional semantics in promises and diplomacy | A prohibition survives time while obeyed. A paused Syracuse does not trigger a “continued attacks” war. Incoming offer plus added reply terms produces a counteroffer or a complete agreed treaty. |
| 4 | Connect appointments, force conversions, and funding | Admiral appointment actually assigns naval execution. Punitive conversion accounts for all original personnel and their service expiry. New navy has funded or explicitly unfunded routine liabilities. |
| 5 | Reconcile completed work and changed world state | Cleared accounts update the allegation; approved investigation launches an investigator; war revises plans; duplicate Anio work merges; authorization milestones wait for the vote. |
| 6 | Preserve and prioritize technical continuation | Budget exhaustion leaves explicit resumable work and a truthful partial result. Invalid message/entity IDs do not consume unrelated world work until the player's mission loses its repair budget. |
| 7 | Clarify information presentation | Mission status gets priority; repeated speeches aggregate; spy intelligence has attribution; autonomous letters name their sender; the directory loads honestly and focuses relevant contacts. |

A useful end-to-end regression set should include **short, misspelled, and detailed variants** of the same intent, not only correctly formed structured deltas. Preserve the player's constraints and test committed state and displayed reports together. In particular: `Send Legio I to Messena`, `Take both legions to Messana by the navy`, and the detailed O11 should all launch coherent variants of the same supported operation. Added details should constrain or improve the plan, not determine whether any plan exists.

For UI follow-up, the relevant Impeccable actions are `$impeccable harden` for status/loading/identity consistency, `$impeccable clarify` for authorship and timing language, `$impeccable distill` for repeated Chronicle and contact-directory noise, and `$impeccable polish` after semantic fixes. Cosmetic work cannot repair simulation truth.

## I. What works and what is not established

Preserve the successful pieces: typos and mixed capitalization generally resolve to the intended entities; army rename and naval standard changes are fast and persistent; Rome-funded punitive pay is an actual obligation; one punitive-legion transport completes; the spy mission actually produces a private intelligence fact; the world records treasuries, troop losses, office seats, and agreements in inspectable state. The Office's unpaid-navy alert is useful, even though the underlying missing administrative work should normally have been delegated.

This audit does **not** prove that the rejected legion reinforcement was itself a bug: genuine Senate opposition after surrender is plausible. Nor does absence of a battle prove combat should have occurred. NPC counteroffers, autonomous politics, financial difficulty, illness, betrayal, and foreign world events are valid gameplay when supported by coherent causes and persistent consequences.

Unverified here: historical authenticity of every generated ruler, names, institutional title, coin scale, ship cost, army strength, and calendar convention; full financial transaction conservation over all 657 facts; responsive behavior outside the declared desktop context; contrast/keyboard/screen-reader compliance; visual clipping at every camera scale; every actor's private knowledge at every historical step. The supplied record and current snapshot cannot reveal every unlogged event or historical intermediate state. This report enumerates all substantiated defects found and labels uncertainty rather than claiming an impossible guarantee that no other defect exists.

The user-pasted Chronicle and the live UI are the player's evidence; privileged world records in this audit establish implementation inconsistencies and are not an invitation to expose secret NPC information in normal gameplay.

## J. Source locations for implementation follow-up

- `packages/shared/src/warfare/passage.ts`: transport availability, fleet gathering distance, capacity, and refusal guidance.
- `packages/sim/src/burst.ts`: pursuit fallback around line 1707; proposal application, repair, reconciliation, and skipped work.
- `packages/shared/src/authority/under-way.ts`: pursuit displayed with `stalled: false`, around line 113.
- `packages/sim/src/promises.ts`: fulfillment checks and generic overdue/break logic, particularly lines 34–82 and 169–186.
- `packages/sim/src/apply/apply-deltas.ts`: `bindTheAcceptance` around line 1368; `carryOutTheThreat` around line 1424; covert storyline creation around line 4800.
- `packages/sim/src/plots.ts`: actual spy report and `learned` outcome around line 616.
- `packages/sim/src/chronicle.ts`: evidence selection, grouping, narration, quotation, and final validation.
- `apps/web/app/games/[gameId]/components/chat-panel.tsx`: correspondence authorship labels around line 462; loading/empty contact state around line 511.
- `apps/web/lib/room-service.ts` and `packages/shared/src/authority/under-way.ts`: Office and Council mission status.
- `packages/shared/src/characters/correspondence.ts`: creation of outgoing answer pages even for ignored letters, around lines 87–100.
- `packages/sim/src/tick.ts`: expiry of diplomatic reply windows and “No answer came” records, around lines 1140–1190.

Line numbers refer to the working tree inspected on 30 September and may shift during ongoing work. Source-level mechanisms are named only where directly inspected; other findings specify the failing state contract rather than pretending to know the exact responsible function.

## Appendix A. Every recovered player order

These are the exact stored strings, including typos, capitalization, and the wrappers generated by letter/rename/standard UI actions. O01–O14 are used throughout this report. Dates are the world date at submission, not the final date reached by the burst. Durations measure stored burst start to end.

### O01 — 1 March 270 BC

```text
Rename Roman field army to Legio I
```

Burst `b37411fd-b16d-4808-94d8-0c08b9801d69`; 0.2 seconds; 0 counted calls; stop `order_applied`.

### O02 — 1 March 270 BC

```text
Find support in Rome among the senators for the roman navy
Petition the Senate to raise an a Navy of 150 strong.
```

Burst `020885bb-5f1e-474f-8846-1f3247a3470e`; 77.5 seconds; 28 counted calls; stop `budget_exhausted`.

### O03 — 19 March 270 BC

```text
Write to Decius Vibellius: Surrender and the only punishmenet you shall face is you and your men 10 years in a punitive legion for rome under my command. After these 10 years you shall become citizens again
```

Burst `bd5c3a78-993e-4893-9a32-08b655aa8f1d`; 0.4 seconds; 0 counted calls; stop `order_applied`.

### O04 — 19 March 270 BC

```text
Ask the senate to raise the men in Legio I to 10000. Reinforce it. 
Following that continue gathering support in Rome and warn everyone of an impending war
```

Burst `27e187ad-d6d1-4143-9754-0e3f6871cd2f`; 129.0 seconds; 33 counted calls; stop `budget_exhausted`.

### O05 — 3 April 270 BC

```text
Deny the charges against myself, tell everyone that such a thing did not happen. Raise an issue with the blatant corruption and misuse of power and launch an investigation into the accuser. 

Raise another issue with the Senate that Rome needs a fleet to defend it's interests. 
Talk with Pontifex and ask him if the gods are warning us of Carthage
```

Burst `dba4f410-c004-42ff-90d7-8fcc78bcdd23`; 146.9 seconds; 29 counted calls; stop `budget_exhausted`.

### O06 — 17 April 270 BC

```text
Sign the peace deal with Rhegium and raise the punitive Legion. 
Continue denying the accusations and inspect my own books, open them as I have done no wrong
```

Burst `5e377622-48d0-48ab-be85-b963038cc44d`; 51.8 seconds; 9 counted calls; stop `watch_condition`.

### O07 — 18 April 270 BC

```text
Continue to support the ROman fleet and task someone to be in charge of it
```

Burst `370f513a-5746-4a4d-90f7-3843f4badcff`; 119.5 seconds; 31 counted calls; stop `budget_exhausted`.

### O08 — 3 May 270 BC

```text
Answer Statius Mettius's letter "Protection for Messana" (accepted): We accept Messena's protectorate. We shall defend Messena whenever they call for us, in exchange we shall receive money and manpower as well as your participation in any war Rome is in
```

Burst `a624a4bf-4cbf-4853-b8dd-bb78c24fce17`; 0.8 seconds; 0 counted calls; stop `order_applied`.

### O09 — 3 May 270 BC

```text
Let Rome pay for the wages of the Punitive legion, even if incredibly diminished compared to other Legions. 

Send a spy in Syracuse to ask about the information
```

Burst `dc356199-a0c4-483d-a42d-b09098b3e5c5`; 134.7 seconds; 25 counted calls; stop `budget_exhausted`.

### O10 — 17 May 270 BC

```text
Answer Statius Mettius's letter "Protection for Messana’s self-rule" (accepted): Very well we shall send Legio I to defend you
```

Burst `29a2c47c-a7c1-4e27-91f0-484684462c13`; 0.9 seconds; 0 counted calls; stop `order_applied`.

### O11 — 17 May 270 BC

```text
As Messena is under attack by Syracuse, Legio I and the punitive Legion shall embark on the Roman fleet and sail to Messena. They will protect the area and hunt down any Syracusian army. 
Send a letter to Syracuse telling them to cease hostilities or invite open war
```

Burst `ab5877a8-a1a1-47e9-bcfd-263f1dd5fb0a`; 122.1 seconds; 26 counted calls; stop `watch_condition`.

### O12 — 27 May 270 BC

```text
Order the Navy to take Legio I and the Punitive Legio to MEssena
```

Burst `d02453fe-3092-45b1-a70b-2d5f3a1e3c37`; 245.3 seconds; 33 counted calls; stop `budget_exhausted`.

### O13 — 9 June 270 BC

```text
Give Roman Navy the Rostrum and dolphin
```

Burst `b71c0154-5651-48b9-a7c0-50941c3661da`; 0.4 seconds; 0 counted calls; stop `order_applied`.

### O14 — 9 June 270 BC

```text
Use the Roman navy to transport Legio I from Rome to Messena
```

Burst `3993fd62-4e08-495d-81d0-fbae1e59d7cc`; 182.6 seconds; 26 counted calls; stop `budget_exhausted`.

## Appendix B. Every recovered chat message

Messages are in stored chronological order. The named NPC identifies the conversation; “Player” and “NPC” identify the speaker. These are separate from diplomatic letters.

**C01 — Marcus Fabius / Marcus Fabius**

> I will say it to your face, since you will hear it anyway: Fictional senatorial associate

**C02 — Gnaeus Cornelius Blasio / Player**

> I fear a war with Carthage is coming. Messena and Sicily is not safe, i need your support to raise more armies and a navy to prepare

**C03 — Gnaeus Cornelius Blasio / Gnaeus Cornelius Blasio**

> You shall have my support in asking the Senate for a defensive levy and ships fit to guard the straits. But let us not proclaim Carthage our enemy before she gives us cause; a fleet raised openly for Sicily may turn fear into war. I will stand with you when we put the measure before the Senate.

**C04 — Gaius Fabricius Luscinus / Player**

> Do you believe I have taken funds from Rome? I am no traitor

**C05 — Gaius Fabricius Luscinus / Gaius Fabricius Luscinus**

> No, Clepsina; I have no grounds to believe you have taken Rome’s funds, and I will not call you a traitor without proof. Let the accounts be examined plainly—an honest man should not have to hide from the reckoning.

**C06 — Gaius Fabricius Luscinus / Player**

> Very well

**C07 — Gaius Fabricius Luscinus / Gaius Fabricius Luscinus**

> Good. When the accounts are opened, I shall judge what is written there—not what men whisper.

**C08 — Marcus Fabius / Player**

> Why do you accuse me so plainly of theft? do you have something against me or are you plotting to take my position?

**C09 — Marcus Fabius / Marcus Fabius**

> I called it theft because I suspect goods were taken under your authority—but suspicion is not proof, and I have no witness to your own hand. I have no design on your consulship, Clepsina; it is shared with Blasio for this year, not mine to snatch. If you ask what grounds my suspicion, I’ll name them plainly—or withdraw the charge if I have none.

**C10 — Marcus Fabius / Player**

> Name them

**C11 — Marcus Fabius / Marcus Fabius**

> I cannot name them, Clepsina. I have only suspicion that goods were taken under your authority; no witness to your hand, and no proof. I spoke too strongly. I withdraw the charge against you.

**C12 — Marcus Fabius / Player**

> Thank you

**C13 — Marcus Fabius / Marcus Fabius**

> Keep your thanks, Clepsina; I owed you the truth once I had no proof. Let us leave the matter there.

**C14 — Gaius Genucius / Gaius Genucius**

> I have a favour to ask of you, as a friend: Find material that could weaken Clepsina without exposing the inquiry..

## Appendix C. Evidence navigation

The accompanying JSON preserves the scoped burst/chat/Chronicle/fact/audit/event records and the relevant current-state collections. It excludes connection credentials, account authentication data, billing-account rows, and unrelated saves. Search a burst UUID from Appendix A to follow its rejected deltas, skipped work, facts, and narrated entries. For the strongest reproduction, compare O12's pursuit audit, its `genericEntities` entry, and the current Council label; compare C05 with the Fabricius commitment and the 7 May Chronicle entry.
