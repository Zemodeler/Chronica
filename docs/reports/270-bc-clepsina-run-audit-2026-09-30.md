# Chronica: Clepsina run audit, 1 March–23 June 270 BC

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
