# Continuing plans and personal time

The Orders panel accepts only multiline freeform plan text -- method, conditions, secrecy, named delegates, and any cap on spending from one personal account are never entered on a form; the player writes them into the plan in their own words. Submitted plans become authoritative `playerPlans` in the world snapshot. Existing saves load without either this collection or the new `actorActivities` collection.

The GM uses `interpret_plan` to produce up to twelve concrete stages and to read the plan's method, conditions, secrecy, named delegates, and any spending cap out of its own text, passed back as that call's `options`. It must never invent a delegate or a sum the player did not name, and once a plan has spent anything it must keep the same budget account on every later reinterpretation. Each stage has an executor, dependencies on earlier stages, optional earliest turn and executor-location conditions, and optional explicit recurrence. Raw player instructions and revisions remain alongside the interpretation. The GM must preserve every completed stage when reinterpreting. Arbitrary prose conditions remain part of the instructions; if they cannot be established, the GM can use `defer_plan_stage` to record the obstacle without inventing a result.

`execute_plan_stage` calls the existing registered or defined action through the staged session. A successful call records its factual reference and completion; a failed or premature attempt stays blocked. Active plans are supplied on future turns without another submission. Empty order batches advance existing plans and the world. Recurring stages reopen only on their scheduled turn, and only when explicitly requested in the player order.

Players can review the interpretation and stage status in Orders, then revise the original instructions or cancel. Revisions retain completed work, the original explicit limits, and spending already incurred, but require delegates to answer the revised assignment again. Cancellation prevents further stages and cancels linked ongoing orders/operations; it cannot undo their past effects. A materially different objective should be submitted as a new plan. Up to 32 active plans and 64 recently closed plans remain in the snapshot; the submitted order rows also retain the original text.

Delegation requires a player-named person and an explicit NPC answer through `respond_to_plan_assignment`. That answer should reflect their interests and circumstances. Acceptance grants no additional office, money, or resource permissions. A delegate's actions consume their own personal capacity. New delegates are selected from living people in the player's polity or current province.

## Capacity and spending

Each character has one turn of personal capacity. Current coarse costs are:

- Reading and narrative bookkeeping: no personal time.
- Personal travel: the full turn.
- Military and material actions: one quarter of a turn.
- Ordinary administrative, economic, and social actions: one eighth.
- Novel defined actions: one half, or a full turn for anyone actually relocated by their effects.

These are coarse fractions of the existing turn, not a new daily calendar. They replace the NPC relevance action-count ceiling; relevance still selects the active cast and allocates model attention. Failed actions do not consume time. The actor ledger is saved and checked again on subsequent calls; the next turn resets available capacity. Custom actions cannot patch plans or this ledger.

A plan's spending cap is checked against actual account debits before an action commits. An over-budget action changes no resources or time. The cap is cumulative across stages and recurrences, and permits spending only from the selected account. Existing resource and authority validation still applies. Autonomous expenses outside plan execution, such as existing force upkeep, remain governed by their existing systems rather than this discretionary-action cap.

Natural-language interpretation -- including which method, secrecy, delegates and spending cap the text actually asked for -- and delegate willingness are AI judgments. Typed stage dependencies, dates, locations, executor identities, recorded completion, personal time, and discretionary spending limits are engine checks: a named delegate must be a living contact (same province or polity) and a named budget account must belong to the player, or `interpret_plan` refuses. The UI does not yet support editing the underlying stage graph; revise the plan's own instructions, or create a new plan.
