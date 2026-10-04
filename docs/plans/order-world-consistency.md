# Orders, letters and world consistency

Opened 3 October 2026 from the player's March–July 270 BC chronicles and a read-only inspection of campaign `9499c930-646e-434d-ad2b-77f072ecf620`, revision 6, day 130.

The saved Campanian legion has 3,600 fit men, no personnel-loss history and no recorded battle against Rome. The chronicle's statement that it was found and killed is false. Historical narration and current code are separate evidence: changing the engine does not retrospectively correct stored prose.

## Confirmed problems and first changes

| Problem | Evidence | Work in this first patch |
|---|---|---|
| Facts count as completion | The first kill part has no goals, no executed acts and an associated march fact, yet says done. | Removed fact-only completion. Added regression against the campaign's record shape. |
| An irrelevant goal counts as killing | The second kill part tests whether the Roman army exists. | Explicit named killing orders get a personnel-death goal independent of the proposed acts. Existence-only legacy goals cannot override an explicit nonexecution explanation. |
| Player decisions are replaced | The attack instruction becomes holding to honour safe passage, attributed to Clepsina. | Preserve the requested outcome in the ledger; report a substitution as unfulfilled. Updated interpretation instructions to execute an intentional treaty breach through the proper actions or explain a real obstruction. Real-model obedience remains to be evaluated. |
| The chronicle invents a killing | It announces a killed legion despite the world retaining it. | Extended contradiction checks to killings and destruction and replaced contradictory headlines as well as bodies. This does not constitute general factual validation of every sentence. |
| Conquest becomes watching | Two thousand men were requested to claim Campanian territory; no land transfers and no operational mission is evidenced. | Explicitly named territorial intentions retain ownership goals. Continuing detachment, scouting, conquest and reporting workflows still need implementation/evaluation. |
| A purpose becomes a separate failed task | “Bring this war to an end” becomes its own unsuccessful order part. | Interpretation instructions distinguish mission purpose from an additional diplomatic action. Needs real-model evaluation. |
| Settled negotiations remain unanswered | Decius's initial peace-talks request lapses after Blasio accepts a separate peace exchange. | Accepted, recorded bilateral peace resolves earlier requests to open talks, at acceptance, turn loading and ticking. Later talks, third parties and independent demands stay open. No broad equivalence of unrelated letters. |
| Treaty prose omits executable duties | The accepted offer promises withdrawal and restoration, but contains only Rome's protection undertaking. | Undertakings can carry observable completion goals. Interpretation instructions require both parties' duties and deadlines. Completeness validation and automatic continuing withdrawal work remain open. |
| Safe passage is prematurely fulfilled | Rome's guarantee was marked kept before the garrison withdrew. | New safe-passage undertakings track the protected force's actual departure and loss history; proximity and “prepared” assertions cannot satisfy them. Waiting for withdrawal does not itself make Rome breach the guarantee. Attribution of harm still needs review rather than automatic blame. |
| Political commitments are ordinary correspondence | Carthage accepts withdrawal/open-strait terms in a plain letter without an agreement or executable duties. | Clarified interpretation instructions. General detection/repair of incomplete political instruments remains open. |
| Reinforcement reports disagree | Narration says nothing came of reinforcement while receipts and changes show competing 9.9k/10k figures. | Existing strength goals remain required; no blanket victory from facts. Event-time strength accounting and narration still need a targeted reproduction. |
| Appointments are done and ineffective | Meritocratic reorganisation is done in the receipt; the chronicle says the officers were not appointed. | Force renaming and command changes now have property-specific goals rather than mere existence. The actual officer/authority discrepancy remains to be reproduced and fixed. |
| Processing stops before consequences | All three order reports end with the budget-exhaustion message. | Confirmed processing interruption, not legitimate world resistance. Continuation, priority and complete delivery across interrupted turns remain open; preserve concurrent performance work. |
| Old narration survives engine fixes | Existing saved chronicles continue to contain fabricated results and confusing negotiation timing. | No campaign or history mutated. A separate backed-up correction must preserve real events and avoid fabricating battles, deaths or consent. |

## Validation

`packages/sim/src/the-rhegium-orders.test.ts` exercises unexecuted fact-backed orders, substitute hold actions, legacy existence goals, actual death evidence, prohibition wording, contradictory narration, safe-passage evidence and superseded peace talks. Existing order, chronicle, treaty, promise and provider-schema checks are run alongside it.

No paid model calls, campaign orders or campaign writes are required by these regressions. Prompt improvements alone do not establish that a real model will execute the intended operations.

The final focused run passes 165 tests across 12 files, including the new regressions, existing order/chronicle/peace checks and provider-schema compatibility. The wider 256-file run did not pass: it reported 40 failures (many five-second timeouts under concurrent load), an empty test file, and other assertion failures. It is not evidence of a clean full suite. The prompt-size regression introduced during this work was corrected by narrowing treaty completion goals and omitting parser defaults from the textual schema; the existing size limit was preserved.
