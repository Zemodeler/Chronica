# Hanno of Carthage, commander in Sicily: nineteen months of an order that wants a war he may not make, model answered by hand (UI round 5)

Run: `eval-out/ui-run5` (goals, notes, answer scripts `ans/t1..t5.mjs`, `c1..c3.mjs`), hand directory `apps/web/eval-out/ui-run5/hand`, port 3301, game `17ba1589-97da-4faf-bb56-285dccaf3ce4`.
Prompt: `docs/playtests/ui-hand-playtest-prompt-5.md`. Rules kept: nothing in `packages/`, `apps/`, `scripts/` edited during play, except one fix made mid-run (section 5, bug 1, named there); every prompt answered in queue order; player and model kept apart.

## 1. Verdict

The seat is right (Hanno's field force reads "Under Hanno of Carthage"), and the first four orders did things: Mettius accepted a protectorate, Hieron gave way to an ultimatum and to a tribute demand, Gauls were hired, the force marched. But the round did not reach its bar: **about 569 days (1 March 270 to 21 September 269 BC) and 5 orders, not 10**; the war I meant to fight was never fought, because the engine, correctly, said a commander in Sicily may not make war ("that is for the Council of Elders"), and my two Council motions were dropped by my own malformed answer. So **no siege, no battle, no decision card, no alarm, no truce, no chamber vote were exercised**. Of prompt 5's nine items, two are done, one partly (section 4).

What the run did find is real and mostly about orders that depend on other orders:

1. An order held for something that only itself could do waited for ever (fixed mid-run, test added).
2. A fact the model wrote for an act the engine refused stayed in every character's history (fixed after, test added).
3. When the war part of an order was refused, the siege that followed it sat "Waiting" for 90 days, then "failed", and the page asked for my word twice. It should have been told at once.
4. The strongbox and the order sheet still disagree about pay, as in round 4.
5. Standing orders are listed twice.

## 2. What was played

Hanno of Carthage (declared character), start 1 March 270 BC. Army sheet checked first: the Carthaginian field force, 3,000 men, "Under Hanno of Carthage"; the arms rack lists 7,800 men and 110 ships in 5 forces (the whole Carthaginian military, not only his), as in earlier rounds.

| Turn | Order | What happened |
|---|---|---|
| 1 (month, to 31 Mar 270) | cross to Sicily, hire Gauls, march to Messana | Mettius accepted Carthage's protectorate (no counsel printed in the cognition prompt: 1). The march was held "once the field force is at the north-eastern coast of the Sikeloi, then march on Messana" — **waiting on its own arrival** (bug 1). |
| 2 (season, to 29 Jun) | march, ultimatum to Hieron, pay | Hieron "followed counsel: yes (gave way)". Strongbox purse fell 12,000 to 2,530; "Going out" read 0 though the Gauls cost 2,500 a month. |
| 3 (season, to 27 Sep) | tribute demand of 30,000 a year, "if he refuses declare war, march, lay siege" | Hieron accepted the tribute (followed counsel, second time); the conditional order read "Completed". No war followed, which was right. |
| 4 (season, to 24 Dec) | "Declare war on Syracuse. Lay siege to Syracuse with the Carthaginian field force." | **Refused by the engine**: "Carthaginian commander in Sicily may not make war: that is for the Council of Elders." The siege waited for the force to reach Syracuse and failed on day 300. |
| 5 (to 21 Sep 269) | two motions to the Council of Elders: war on Syracuse, 40,000 for the pay | Both dropped (section 5, bug 8: my answer). The page said "nothing came of it" for both. |

Between turns 4 and 5 two seasons passed with no order, by my mistake with the buttons (bug 9).

Prompts answered by hand: 8 `simulate_orchestrate` (one per turn plus split parts), 110 `compose_chronicle` (42 written, 68 empty: far-off news, repeats, ailments of strangers), about 41 `simulate_cognition` (3 held for letters of mine and answered, the rest stubbed `{"actors":[]}` by the watcher), 1 `declare_character`, 5 `write_mechanic` (stubbed). No `dialogue_*`, `propose_social_events` or `extract_knowledge` this round: no letter of a character's came to me and I wrote none in the tray.

## 3. First-time experience

Declaring the character, the first orders and the first burst were as in rounds 3 and 4 (slow room load of 10 to 12 seconds on a fresh page; a "Sending for your records…" chip). The one new thing: with an order typed, **"Let a season pass" does not send it; "Send" does** (bug 9).

## 4. Checklist of prompt 5, section 2

1. **A tribute demand and a protest addressed to me, stopping a burst** — *not done.* I sent the tribute demand; none came to me. No letter arrived from a king the whole run; the tray's newest from Hieron is "They wrote, 3 July 270 BC", from the ultimatum round.
2. **A truce within 30 days of ending** — *not done* (no war was ever made).
3. **The pay line against the ledger and the strongbox** — *done, still wrong.* Strongbox: "720 a month to spare", the figure it showed at the opening, unchanged after hiring Gauls at 2,500 a month and paying; the order sheet: "The hired men of Hanno's field force, in Carthaginian pay — In Hanno of Carthage's hands. 0 paid down; 38,000 a month" and "Hasdrubal's army … 0 paid down; 52,000 a month"; ledger stand: "1,324,322 a month to spare". Three numbers for pay, none of them the pay I ordered. Arms-rack tooltip not opened.
4. **Map and tooltips against a decision card's odds; the army sheet during a siege** — *not done.* No card was asked and no siege was laid.
5. **A reload mid-season** — *done, good.* After `navigate` to the game, the Council said "Reading the record…" and never "Nothing has been recorded yet". From `/` not tried.
6. **A secret plot against me** — *done up to the first half.* My hand seeds made Hieron's silver for Hamilcar a private thread ("Hieron's silver for Hanno's enemy") and a private fact. Matters in hand at 27 September 270 read only "and lay siege to Syracuse — Stalled"; the title was nowhere on the page. Not told to me later, so "after it is told" is unseen.
7. **A chamber vote of money to spend** — *not done* (bug 8).
8. **A card answered, then a reload** — *not exercised*: no card came.
9. **Two saves, newest created vs last played** — *not done.*

Section 3 (still open), instances seen:

1. Outcome lines against the books: "The hired men of Hanno's field force … Under way … 0 paid down" beside the hand-written Chronicle line about the paymaster re-arming the army; round-2's pay order read "nothing came of it (none spent yet)" beside "only 6259 could be found".
2. "Refused" for a decision the engine took: not seen (no card).
3. An order I never typed reported as failed: not seen.
4. Repeated headlines: the same failed-siege fact came to compose in two windows ("could not go ahead… 90 days"), and again as a re-ask.
5. A truce lapsing unseen: not exercised.
6. The monthly "Ugly stories" rumour: not seen this round.

## 5. New bugs

1. **An order held for its own arrival waits for ever** *(fixed mid-run; test `a-march-held-for-nothing-is-not-held-for-itself.test.ts`)*. "Cross, hire Gauls, then march on Messana" became "Once the Carthaginian field force is at the north-eastern coast of the Sikeloi, then march on Messana": the wait was for the march itself. Fix in `burst.ts`: `releaseUngroundedMarches` moves a deferred force move into the acts when nothing earlier in the order could bring the force there.
2. **A fact written for a refused act stays as history** *(fixed after the run; `facts-of-refused-acts.ts`, test `a-fact-of-a-refused-act-is-not-history.test.ts`)*. The engine refused the war ("may not make war: that is for the Council of Elders") but "Hanno of Carthage declared war on Syracuse and ordered the field force against King Hieron" went into the record and into every cognition prompt as known history (Hieron's, Himilco's). A part whose every act was refused now drops the facts only it cites. Checked on pure inputs; I could not make the scenario's gate refuse an act in a unit test, so the wiring in `burst.ts` is covered by the type-check and the neighbouring order tests (132 passed), not by a refused act end to end.
3. **A part that follows a refused part is not told at once.** The siege was "waiting until Carthaginian field force reaches Syracuse (since day 210, lapses day 300)" when the war it followed had been refused on day 0; it failed ninety days later with "never reached Eastern Syracusia". The order sheet listed both "Declare war on Syracuse — Needs your word — Refused" and "Lay siege … Needs your word — Failed". *Open; lead:* in `burst.ts` the held stages carry `afterParts`; when a part named there ends refused, its dependents should settle "cancelled: <part> was refused" the same day.
4. **Strongbox, order sheet and ledger do not agree on pay** (section 4, item 3). The strongbox "Going out" omits mercenary pay; it read "720 a month to spare" before and after hiring. *Open.*
5. **Standing orders are listed twice.** After turn 4 the Council's standing orders held "Once 'Thirty thousand a year for Messana's protection' is refused…" twice (both Completed) and "Once the field force is at Eastern Syracusia, lay siege to Syracuse" twice (both Cancelled); the held-order failure fact was also told twice in one compose prompt. One order is recorded as two. *Open; lead:* two stored order records for one said text, probably from the split order (`splitOrder`) and the whole-order record both storing the part.
6. **The same failure, retold, is rejected.** My first retelling of the siege ("The Siege That Never Began") was refused by the harness: "Your passage said more was done than the world shows." That is the harness doing its job; noted as good.
7. **The "Active" tab holds refused and failed parts as "Needs your word".** "Declare war on Syracuse — Refused" waits there for a word the player cannot give (the Council must). Nothing says whom to ask.
8. **My Council motions were dropped by my own answer** (not an engine bug): `political_procedure_open` without `reason`, and an invented `spenderRef` on `enacts.budget`. The server's line: "dropped 3 thing(s) to keep the answer … Invalid input: expected string, received undefined". The facts of my answer ("Hanno put to the Council a motion…") stayed anyway, and the parts read "nothing came of it": the page was right, the Chronicle line I wrote was not — and bug 2's fix now covers this case too only when the engine *refuses*; a dropped (invalid) act is not a refusal. *Open:* a part whose acts were all dropped as invalid should lose its facts too.
9. **"Let a season pass" with an order typed passes the time and keeps the draft** ("Draft saved. You can put this down and consult another document."). It is clear to a patient reader, but I idled two seasons believing the order sent. Worth a confirm or a different label when the box is not empty.

## 6. Waiting

Per season: 20 to 40 prompts, most of them compose. About 90 percent of compose prompts were far-off news or ailments of strangers (Roman senators "worse", Etruscan and Samnite elections, Macedonian armies arriving). The engine asked for the same facts again in the next window rather than once.

## 7. The Chronicle on the page

Not read as a whole this round (the Chronicle panel was opened for "Reading the record…" only). From the hand side: the headlines I could write were thin because the engine gave little of my own business: after the refusal, the news for Hanno was a temple, an aqueduct, a road contract and his own ailment.

## 8. As a player: what I could not tell

- Why the war was refused before I typed it: nothing on the page said a commander may not make war until I tried.
- Whether Hieron had become tributary. The agreement "tributary (ours)" shows only in the model prompt; the page showed Completed for the conditional order.
- Whether anything was under way after turn 4: "4 orders under way · 2 stalled".

## 9. What worked

- The competence gate said who may make war, in words, and routed it to the Council.
- Hieron gave way twice by following his own counsel; no war was forced on the page.
- "Reading the record…" on reload.
- The compose harness refused a retelling that said more than the books.
- The secret thread did not reach Matters in hand.

## 10. How far to trust this run

Short of the bar (569 days, 5 orders). Single seat, single seed. No siege, no card, no alarm: those items are *untested*, not passed. My hand answers had errors (bug 8, a cognition left to the stub for some actors); where an effect rests on a hand answer, section 5 says so. The strongbox figures come from the page, not the database.

## 11. Fixes made after this run (loop 3, "Fix")

- `burst.ts`: `releaseUngroundedMarches`, and the held goal no longer counts as its own dependency (bug 1; test above; made during the run once the deadlock was seen, the run's later turns used it).
- `burst.ts`, `facts-of-refused-acts.ts`: a fact written only for refused acts is not told (bug 2). Tests: `a-fact-of-a-refused-act-is-not-history.test.ts` (3 cases). `tsc` clean in `packages/sim`; 25 targeted tests plus 132 order, narrator, negotiation and peace tests passed.

Not fixed (leads in section 5): 3 (dependents of a refused part), 4 (pay lines), 5 (duplicate standing orders), 7, 8 (dropped acts keep facts), 9.

## 12. Verdict in three lines

The engine refused, in plain words, what a Carthaginian commander may not do; the page then kept the dependent siege waiting for ninety days and the refused fact in history, and the pay lines still do not add up. Items 1, 2, 4, 7, 8 and 9 of prompt 5 were not reached.
Most worth fixing first: (1) a part that follows a refused or failed part is told on the same day, with whom to ask; (2) the one pay story across strongbox, order sheet and ledger; (3) one record per order, not two.
