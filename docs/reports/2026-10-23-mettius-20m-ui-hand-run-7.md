# Statius Mettius, leader of the Mamertines: twenty months of a town held on sufferance, model answered by hand (UI round 7)

Run: `eval-out/ui-run7` (notes, goals, answer scripts `ans/r1..r5.mjs`, `c1.mjs`, `gen.mjs` with `o5..o10.json`), hand directory `apps/web/eval-out/ui-run7/hand`, port 3301 (`BETTER_AUTH_URL=http://127.0.0.1:3301`), game `21c7f2e7-9f9d-4160-aad7-8fe3cb9483bb`, same account as round 6 (`uirun6clepsina`), so two saves existed.
Prompt: `docs/playtests/ui-hand-playtest-prompt-7.md`. Rules kept: nothing in `packages/` or `apps/` edited while the server ran; the fixes of section 11 were made after both servers were stopped (one local server was started again once, to look at the home page, then stopped).

## 1. Verdict

The round reached the bar: **10 orders, 614 days (1 March 270 to 28 November 269 BC), one decision card, one tray answer (a refusal of an ultimatum)**. The alarm fix of round 6 worked as a player sees it: **an ultimatum put to the Mamertines stopped the burst on the day it arrived and was on the desk with its day** (section 3, item 1). The round also confirmed an old open item with certainty: **the home page features the newest save, not the last played**, and it found that the character card promises a purse the engine then cuts to a tenth.

From round 7 the compose and cognition answers were empties (a background responder), orchestrate answers and the card by hand: it ran about four times faster; the Chronicle was therefore not read as a whole.

## 2. What was played

Statius Mettius, "Under Statius Mettius" at the start (Mamertine garrison, 1,400 men, "Holding position"); purse 2,500.

| # | Order | What followed |
|---|---|---|
| 1 | letters to Hieron (leave Messana in peace) and to Clepsina (friendship) | Hieron "countered", and sent an ultimatum (no foreign garrison in Messana, 30 days, war on refusal) |
| – | tray: Refuse the ultimatum, with a reason | applied at once, no prompt |
| 2 | hire 200 Gauls; ask Hanno for a garrison | the letter to Hanno read "Stalled" for the want of an answer |
| 3 | take the garrison out against the Syracusan army and raid | card on 7 July 270: "Syracusan army is drawn up before your camp… nearly twice your strength" (1,400 against 2,800 to 3,500) |
| – | card: Fall back by night | the garrison went back |
| 4 | garrison back into Messana; pay from my purse | done |
| 5 | raise 500 citizens | levy |
| 6 | truce of six months and a gift of 2,000 to Hieron | |
| 7 | letter to Himilco: 3,000 a year for a Carthaginian garrison | |
| 8 | an extra month's pay and the walls repaired | |
| 9 | letter to the consul Rutilus for Rome's protection | |
| 10 | a word to the council: Messana will be held | "Needs your word — Nothing came of it. The word is given to the council in the town; it needs no act." |

Hand-written: 11 orchestrate answers, 1 cognition (Hieron's ultimatum), 1 declaration (template, four relations), 1 card. About 300 compose and cognition prompts by empties.

## 3. Checklist of prompt 7, section 2

1. **An alarm after the fix — done, works.** Hieron's ultimatum: sent 5 March 270 (day 4), delivered 9 March (day 8), the burst stopped on 9 March. After a reload Matters in hand listed "An answer to Hieron II is due | in 30 days | Wants your word"; the tray thread read "An ultimatum, 5 March 270 bc … an answer within thirty days." with "Answer this letter" and "wanting an answer by 8 April 270 bc". *Not right:* the Matters sheet opened immediately after the burst still said "Nothing is open to you." until the page was reloaded (a stale agenda after a burst); and the tray's "Send your refusal" is greyed until a reason is typed, with no word that a reason is wanted.
2. **A truce within thirty days of ending** — *not done* (no truce was made).
3. **A secret plot told to me** — *half.* The thread I seeded (Lucania's word to a Syracusan factor) was not in "threads of history" before anything of it was told. After a hand-written reveal (a go-between taken at the gate with a Syracusan purse, told to the polity) it still did not appear in Matters in hand.
4. **Two saves, newest created against last played** — *done.* After an order in the older save (Clepsina, 5 November 269) the home page still featured Statius Mettius (28 November 269) and listed Clepsina under "Your other saves". *Fixed after the run.*
5. **An election in another power** — *not exercised* (no small leader died).
6. **A decision card, answered** — *done.* The card was answered; the order list showed no line for it, but the Chronicle was answered by empties, so the "Nothing came of it" fact could not be read.
7. **A siege seen from the army sheet** — *not done* (no siege).
8. **The pay line** — *done in part.* Purse 2,500 on the card and in the strongbox; the declaration draft said "30000 drachmae of your own" (bug 2).

Round 6's fixes: the demand told on arrival: **fixed**; a leader of a small power belongs to it: not exercised; a card's answer leaves no failed order: not seen on the page; "waiting for X to reach Y": not seen.

Prompt 7, section 4 (still open), instances:

1. "Ask Hanno of Carthage for a garrison — Stalled" (no answer had come: honest); "Tell the Mamertine council … — Needs your word — Nothing came of it. The word is given to the council in the town; it needs no act." (a part its own whyNot says needs no act).
2. The home page "The Chronicle last recorded 'Still open'" for both saves (a placeholder, not a recorded line); "It was said that Statius Mettius led the garrison out of Messana against the Syracusans" (the commander's own march as hearsay: fifth instance).
3. Matters in hand lists a "health of Statius Mettius" thread ("growing") beside nothing else; "Nothing is open to you." at the end although a letter to Hanno stood unanswered for a year.

## 4. First-time experience

Sign-up and declaration as in round 6. Declaring Mettius cost nothing in hand mode; the card read "Starting money: 2,500 Drachmae" above a draft that said "30000 drachmae of your own".

## 5. New bugs

1. **The home page features the newest save.** `listHostedGames` ordered by `games.createdAt`; the page took the first open save. *Fixed.*
2. **The confirmation draft names the purse the model asked for.** The engine clamps the starting purse to a band for the class (`clampWealth`); the model's draft kept its own figure ("30000") beside the card's 2,500. *Fixed:* the draft says the real purse.
3. **A matter's list is stale right after a burst.** "Nothing is open to you." until a reload, with an ultimatum on the desk. *Open.* Lead: the room is re-read on `roomStamp` (world revision, last burst, date); the Matters sheet seems to read the previous reading when opened at once.
4. **A tray answer needs a reason and does not say so** (the send button is greyed). *Open.*
5. **A revealed plot is not in Matters in hand.** *Open* (may be my hand reveal: a polity-visible fact, not a storyline step the player "knows").
6. **A part whose own text says it needs no act reads "Needs your word".** *Open.*
7. **The commander's own march told as hearsay.** *Open (rounds 5 to 7).*

## 6. Waiting

A burst on `a season` ran about 70 to 110 seconds with empties for compose, 20 to 45 prompts by hand before. The bottleneck is the model's compose call, not the engine.

## 7. The Chronicle on the page

Not read this round (answered by empties from order 2).

## 8. As a player: what I could not tell

- Whether the Syracusans would come: the card said "nearly twice your strength" and the Matters sheet said nothing about a war after the refusal.
- Where my wife's plot stood: the thread I was told of is nowhere on the page.

## 9. What worked

- The ultimatum: stopped the burst on its day, listed with "in 30 days", with an "Answer this letter" button, and a refusal applied at once.
- The card: three options, the odds in words, "Fall back by night" returned the garrison to Messana.
- The player's own letters in the thread: "A letter, 1 March 270 bc … Answered, 5 March 270 bc".

## 10. How far to trust this run

Single seat, single seed. Empties answered compose and cognition from order 2: no kings other than Hieron wrote or answered; no truce, no war was ever declared on the Mamertines; the only strong finds are the alarm path, the home page and the draft purse. A hand answer of mine named a wrong message id once in round 6; this round the id came from the prompt.

## 11. Fixes made after this run (loop 5, "Fix")

All in `packages/` and `apps/web/`, tests first or with the change:

1. `packages/db/src/queries/games.ts`: `listHostedGames` returns `createdAt` and `lastPlayedAt` (the world row's `updatedAt`).
2. `apps/web/lib/saves-by-last-played.ts` (+ test, 3 cases) and `app/(site)/page.tsx`: the shelf features the save last played. Checked live: after the change the home page featured Gaius Genucius Clepsina.
3. `apps/web/lib/purse-in-the-draft.ts` (+ test, 3 cases) and `lib/character-service.ts`: the draft names the purse the character will open with.

Not fixed: 3 to 7.

## 12. Verdict in three lines

The alarm works as a player sees it; the home page and the character card did not, and are mended.
Most worth fixing next: (1) the agenda read fresh when a burst ends; (2) a revealed plot on the desk; (3) one honest status for a part that needs no act.
