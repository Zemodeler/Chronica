# Institutional cycles

**Status: designed, not built.**

Offices whose terms actually end, and the elections that follow.

## The bug this starts from

`OfficeSeat.termExpiresAtStep` exists, and both shipped scenarios author it as `4`. The vacancy causes include `"term_expired"`. Nothing ever produces it.

The only thing that reads `termExpiresAtStep` is `deriveOfficeGrants`, which copies it onto the derived `AuthorityGrant` as `expiresAtStep`. So what actually happens past step 4 in a shipped campaign is this: **the consul still holds the seat, and silently loses every authority the office gave him.** He is consul in the character record, in the UI, and in every prompt that lists office-holders — and the authority index quietly answers no to everything he tries. Nobody is told. No election happens. No successor appears. The office simply stops working while continuing to exist.

That is not an economy problem, but it is the same shape as the fiscal one: a complete data model, an authored value, and no runtime.

## What exists today

A `PoliticalProcedure` is already the generic "intent, then authorised outcome" record, and it is good. It carries a `type`, a `stage` running from `proposed` through `gathering_support`, `deliberating`, `voting_or_deciding` to a terminal state, a `resolutionMechanism` (`vote`, `appointment_authority`, `seniority`, `decree_authority`, `sponsor_discretion`), an optional `deadlineStep`, and — the important part — a `linkedWorkflowId` with `linkedWorkflowParams`. A procedure is a promise that *this specific workflow* runs with *these parameters* if the procedure passes.

The lifecycle workflows all exist: `sponsor_procedure`, `nominate_candidate`, `pledge_support`, `withdraw_support`, `call_vote`, `resolve_procedure`. Resolution is deterministic and already correct — `resolveByVote` reuses the institution's own quorum, threshold and denominator rules; `resolveByAuthority` compares net support weight with a stable-hash tie-break. On passing, `buildInvocation` produces exactly the invocation to run.

Offices change hands through `appoint_to_office`, which writes the character's `officeId` and the seat, setting `termStartedAtStep` and — when it creates a seat — `termExpiresAtStep: null`. `remove_from_office` vacates with cause `"removal"`. Death vacates through succession.

### What is missing

**`Office` has no term length field at all.** `OfficeSeat` has an expiry, but nothing says how long the office's term *is*, so a new appointment cannot compute its own expiry and defaults to never expiring.

**Nothing schedules anything.** Every procedure must be sponsored ad hoc by some character who thought of it. The single exception in the whole codebase is the `opposition_motion` that `collect_emergency_taxation` auto-opens when legitimacy drops — which is the proof that auto-opening a procedure is both possible and already an accepted pattern.

**`resolveDueProcedures` is never called in production.** Only `dueProcedures` is, and only to list due procedures for a read tool. The `resolve_procedure` workflow computes the resolution and then *discards the invocation*, telling the caller in prose to go and invoke `linkedWorkflowId` themselves. The `authorization: { procedureId }` parameter that gets passed along is decorative — `appoint_to_office` records it and never verifies that the procedure actually passed.

**`order_deadline` events are declared and unhandled.** The event kind exists, the handler slot exists, and there is no handler and no enqueuer — which is precisely the mechanism a term expiry or a voting deadline would use.

## The design

### Terms become a property of the office

Add a term length to `ScenarioGovernmentRules.offices` — authored per office, because a consulship, a censorship and a lifetime priesthood are different constitutional objects and the scenario is where that belongs. `appoint_to_office` then computes `termExpiresAtStep` from it rather than defaulting to `null`.

A null term stays meaningful: it is how you author an office held for life.

### An expiring term is an event, not a silent lapse

Schedule an `order_deadline` event (finally giving that kind a handler) at each seat's `termExpiresAtStep`. When it fires:

1. Vacate the seat with `vacancyCause: "term_expired"` — producing that cause for the first time.
2. Auto-open the succession procedure the office's rules call for, following the `opposition_motion` precedent: a procedure whose `linkedWorkflowId` is `appoint_to_office` and whose params name the seat, with the `resolutionMechanism` the office authored — a vote for a consulship, `appointment_authority` for a governorship in the gift of a king, `seniority` where the constitution says so.
3. Give it a `deadlineStep`, so an election that nobody attends to still resolves rather than hanging open forever.

The character who held the office learns they no longer hold it the same way they learn anything else — through the Chronicle and their own read tools. An incumbent who wants to keep the office has to do something about it, which is the entire point.

### Elections resolve on their own

Close the loop `resolve_procedure` currently leaves open. A procedure that has reached its deadline should resolve without a character needing to remember to resolve it, and a procedure that passes should *execute its linked workflow*, not merely advise someone to.

That means calling `resolveDueProcedures` from the tick, and having a passing resolution run `buildInvocation`'s output through `executeWorkflow` with a system actor — the same path `advanceProjectsTick` already uses to execute a milestone's linked workflow. The `authorization: { procedureId }` parameter should then be verified rather than decorative: `appoint_to_office` accepting an authorisation should check that the named procedure exists, passed, and links to this appointment.

This is the single highest-value fix in this document, because it is the difference between a political system that runs and one that runs only when an AI happens to remember it exists.

### Consuls, annually

With the above, "consuls are elected every year" stops being a special case. The Roman scenario authors a one-year term on the consulship; the seat expires; the procedure opens with a vote mechanism against the Senate's existing quorum and threshold rules; candidates are nominated and supported through the workflows that already exist; the deadline forces a resolution; the appointment executes. Nothing in that chain is Rome-specific.

It also removes one of the two hardcoded Rome-isms in `world-dynamics.ts` — the `atStep % 2` senate scrutiny pressure — by giving the Senate a real calendar to have opinions about.

## What this unlocks

An office with a real term is a clock every ambitious character can see. Standing for election, blocking a rival's candidacy, extending a command past its expiry, refusing to lay down an office when the term ends — these are the substance of a republican political game, and none of them are expressible while terms silently lapse into nothing.

The last of those is worth naming: a character who declines to vacate at term end is not a bug to prevent but the most interesting thing the system can produce. The design should make it *possible* and *illegitimate* rather than impossible — the seat's authority grant expires on schedule regardless, so an office-holder who stays is holding an office whose powers no longer answer to him, which is exactly the position a usurper is actually in.

## Open questions

**What happens to in-flight campaigns?** Both shipped scenarios author `termExpiresAtStep: 4` and have almost certainly passed it in any long-running save, with the silent-lapse bug already in effect. Firing every overdue expiry at once on the first tick after deploy would vacate offices en masse. Either backfill expiry dates forward from the current step, or treat a term that expired before this feature existed as never having been set.

**Does an election need candidates to exist?** `nominate_candidate` sets a procedure's subject. An auto-opened election with no nominations and a deadline needs a defined outcome — the incumbent continues, the seat stays vacant, or seniority decides. Probably the office's own `resolutionMechanism` should answer this, with vacancy as the honest default.

**Who sponsors an auto-opened procedure?** `buildInvocation` uses `sponsorCharacterId` as the actor for the linked workflow. A procedure the calendar opened has no sponsor, and the system actor is the obvious answer — but `appoint_to_office` executed by "system" needs to be legitimate in a way the authority checks accept without opening a general-purpose bypass.
