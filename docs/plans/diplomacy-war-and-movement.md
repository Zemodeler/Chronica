# Plan: diplomacy, war, movement, the map's conflicts, and the sea

**Status:** executed, 2026-09-18, on branch `narrator-seeds`. All five stages are built and
covered by tests. Where the implementation departed from the proposal below, the proposal is left
as written and the difference is noted in the stage it belongs to — the reasoning is what this
document is for.

Five gaps found by auditing [`docs/VISION.md`](../VISION.md) against the code after Simulation
Loop v1 and the living-world work. They are one plan rather than five because they share a spine:
every one of them is a place where the world's *state* stops at the edge of what the player's own
army is doing, and the model has been papering over the hole with prose.

The order below is the order to build them in. Each stage is useful on its own, and each later one
is easier for the earlier ones existing.

## Constraints that apply to all five

- **Scenario definitions are immutable per version.** Anything that changes `punic-wars-scenario.ts`
  or `built-in-scenarios.ts` needs a new `scenarioVersions` row and a `currentVersion` bump in
  `ensureBuiltInScenarios`, or it changes nothing for any save. This has bitten the project three
  times.
- **The map is not to be redrawn.** Provinces, edges, settlements and the GeoJSON stay as they are.
  Stage 3 and Stage 5 *read* the map graph that already exists; they do not author a new one.
- **The delta union stays closed and narrow.** The engine's whole bet is that a small validated set
  beats a wide tool registry. Every arm proposed below earns its place by being something the model
  currently has to fake with `generic_entity_create` or prose.
- **Nothing new gets a model call of its own.** Diplomacy, war, movement and blockade are all
  resolved inside the calls the burst already makes.

---

## Stage 1 — Diplomacy as an object

### What exists

[`packages/shared/src/world/diplomacy.ts`](../../packages/shared/src/world/diplomacy.ts) is
complete and unused. It defines `DiplomaticMessage` — kind (letter, alliance offer, peace offer,
trade offer, tribute demand, ultimatum, warning, protest…), sender polity *and* sender character,
recipient, subject, terms, `replyDueByStep`, status, answer, answer text, `inReplyToMessageId`,
visibility — plus `PolityStance` (a directed trust score) and `applyDiplomaticAnswerToStance`,
which moves the sender's trust in the recipient by how their approach was answered.

`WorldState.diplomacy` holds the messages. **No code in `packages/sim` reads or writes it, and no
delta arm can create one.** Its own header comment describes the gap it was written to close — "a
player writing to a neighbouring king had nothing his order could become" — and that gap is still
open. Today such an order becomes a project, a generic entity, or a sentence in a fact.

### What to build

**Two delta arms** in `packages/shared/src/sim/deltas.ts`:

- `diplomatic_message_send` — `localId`, `kind`, `fromPolityRef`, `fromCharacterRef`, `toPolityRef`,
  optional `toCharacterRef`, `subject`, `terms`, `replyWithinDays`, `visibility`. The engine assigns
  the id and converts days to a step, as everywhere else.
- `diplomatic_message_answer` — `messageRef`, `answer` (accepted/refused/countered/ignored),
  `answerText`, optional `counterLocalId` pointing at a `diplomatic_message_send` in the same
  payload. Applying it calls the existing `applyDiplomaticAnswerToStance`.

**Authority.** Sending is an act like any other and goes through `checkAuthority`: a consul writing
to Syracuse in Rome's name is acting for Rome and is scoped to it; a senator doing the same
privately is a breach and should be recorded as one, because private correspondence with a foreign
power is exactly the kind of act §12 exists to make expressible.

**The slice** ([`slice.ts`](../../packages/sim/src/slice.ts)) gains a `LETTERS` section: what is
unanswered, from whom, what it asks, and how long the sender said they would wait. §27 asks for
"diplomatic commitments" in the orchestrator's slice and this is half of it (Stage 2 is the other
half).

**Cognition** ([`cognition.ts`](../../packages/sim/src/cognition.ts)) renders a recipient's
unanswered messages in their own section. This is what makes an answer *theirs*: the recipient
decides with their own knowledge, temperament and outlook, not the orchestrator's.

**Attention** ([`attention.ts`](../../packages/sim/src/attention.ts)) scores an unanswered message
addressed to a character the way it already scores an unanswered order — it is the second most
likely reason in the world for someone to want to act.

**The queue.** Sending schedules a `diplomatic_reply_due` event at `replyDueByStep`. When it fires
and the message is still unanswered, that is itself a fact: silence is an answer, and
`TRUST_SHIFT_BY_ANSWER.ignored` is the harshest shift in the table.

**Player decisions.** A message whose recipient is the player's own polity and whose kind is
`peace_offer`, `alliance_offer`, `ultimatum` or `tribute_demand` is the canonical §24 interruption.
The orchestrator should raise a `playerDecision` for it rather than answering on the ruler's behalf,
and the decision's options are accept / refuse / counter.

### How it is proved

**As built.** Both arms landed as proposed. Silence is handled in the deterministic tick rather
than as a scheduled event: a letter whose term runs out is answered `ignored` by the passage of
time itself, which costs nothing and cannot be forgotten. Unanswered letters also score in both
routers — a reaction for the person they were put to, and standing business for the ambient cast.

- A letter sent, unanswered at its deadline, produces the "ignored" fact and the trust shift.
- A recipient in cognition answers a message the orchestrator never saw the terms of.
- An ultimatum addressed to the player stops the burst with `player_decision`.
- A senator writing privately to Carthage is applied *and* recorded as a breach.

---

## Stage 2 — War, truce and treaty as state

### What exists

Only two things, and neither is a state of war: `PolityStance` (a trust number from -100 to 100) and
`map.politicalRelations`, which is scenario-authored, has exactly one kind — `alliance` — and is
never written at runtime.

So "are Rome and Carthage at war?" cannot be answered from the world. It is inferable from trust,
from facts, and from whether armies happen to be fighting. §3 puts "treaty continuity" squarely
under what software owns, and §27 asks the slice to carry ACTIVE WARS. Neither is true today.

### What to build

**A `polityAgreements` collection** on `WorldState` — one record per standing relation between two
powers: `kind` (war, truce, peace, alliance, tributary, trade pact, non-aggression), the two
parties, `sinceStep`, optional `untilStep` for a dated truce, `terms` in plain language, the
`sourceMessageId` when a message produced it, and visibility. A war is a record like any other; what
makes it a war is its kind.

**Two delta arms**: `agreement_open` and `agreement_close` (with a reason). Accepting a peace offer
closes the war and opens the peace in one payload, which is the case the `inReplyToMessageId` chain
from Stage 1 already sets up.

**Authority and procedure.** In a republic, declaring war is not a thing a consul simply does — it
is a question for the Senate. The political-procedure machinery already models exactly this
(`political_procedure_open` → `political_support_set` → `political_procedure_resolve`), so
`agreement_open` for a war in a polity whose government defines such a requirement should be
expected to follow a carried motion. The scenario's `government` block is where that requirement
belongs, so it stays scenario data rather than hardcoded Roman constitutional law.

**The slice** gains ACTIVE WARS and STANDING AGREEMENTS, replacing the current bare trust list as
the diplomacy section's substance.

**Consequences that should key off it**, once the state exists:

- Trade: an income source naming a counterparty is cut while at war with that counterparty. The
  data to do this already exists — income sources carry a counterparty precisely so a war can cut
  them — and nothing does it.
- Attention: a power newly at war is a reason for every neighbour to care.
- Battle: two forces of polities at peace should not resolve an engagement by accident. The engine
  already refuses an engagement across two provinces; refusing one across a peace, unless the
  attacker is deliberately breaking it (and is recorded as having done so), is the same shape.

### How it is proved

**As built.** `polityAgreements` on `WorldState`, with `agreement_open` / `agreement_close` and
the helpers `atWar`, `enemiesOf`, `agreementsBetween`. Opening an agreement closes what it
contradicts, so accepting terms is one act. Two consequences are wired: war cuts income sources
naming the enemy as counterparty, and two powers at peace cannot give battle until somebody
declares the war. The Senate-procedure requirement is *not* built — the machinery exists and the
scenario has nowhere to declare the requirement yet, so it stays a scenario-data question.

- Accepting a peace offer closes the war, opens the peace, and restores a cut trade route.
- A consul who declares war without the Senate is applied and breached.
- A war between two other powers appears in the player's slice.

---

## Stage 3 — Movement that respects the map

### What exists

`force_modify` with a `locationId` checks only that the province exists
([`apply-deltas.ts:510`](../../packages/sim/src/apply/apply-deltas.ts:510)). It never consults
`map.edges`, never consults the crossing type, and never asks how far it is. **An army can move from
Latium to Carthage in one delta.**

The map graph is fully specified and entirely unread by the simulation: edges carry a `crossing`
(land, river, strait, pass, sea lane) and a distance, and terrains declare which crossings they
admit — with the rule, already written down in `map.ts`, that an edge is legal only when both sides'
terrain admits its crossing.

The orchestrator prompt tells the model to make a long march a project with a `force_move` outcome,
and the model mostly complies. That is prose discipline standing in for a rule.

### What to build

**A reachability helper** in `packages/shared/src/world/map.ts`: given a world, a force and a
destination, return the legal path and its distance, or the reason there is none. One function,
pure, used by both the validator and the projects system.

**Validation in `applyDeltas`**: a `force_modify` that moves a force must name a province adjacent
to where it stands, across an edge whose crossing both terrains admit, and which the force is able
to use (Stage 5 makes the sea a real answer to that last clause). Anything further away is rejected
as a *world* rejection — not a reference error — with a reason the player deserves to read: "the
army cannot reach Sicily in a day; it is four provinces away and the strait must be crossed."

**Journeys become projects, mechanically.** The tick already materialises a project's
`completionOutcome` of kind `force_move`. Distance and the scenario's own pace should set the
milestone dates rather than the model's guess, so a march from Rome to Rhegium takes as long as the
road is, every time.

**Dependency:** this is the first stage that will visibly refuse something the model currently does
freely. It should land *after* Stage 1 and 2, when the orchestrator has other ways to reach across
the map than walking an army there.

### How it is proved

**As built.** `world/movement.ts` holds `canMoveTo`, `hopsBetween` and `crossingAdmitted`;
`force_modify` refuses anything further than one bordering province and says how far it actually
is. Terrains reach the engine through `ApplyContext.terrains`, passed from the scenario definition
by the simulation service, and are optional: a scenario declaring no terrain rules gets adjacency
enforced and crossings unjudged. Three existing tests had fixtures that marched armies across the
map; they were fixed rather than the rule weakened.

- A force ordered three provinces away moves one province and opens a project for the rest.
- A land force ordered across a sea lane is refused with a reason, not silently teleported.
- A replayed burst produces the same arrival day.

---

## Stage 4 — Conflicts the map can show

### What exists

`WorldState.conflicts` — battles, sieges, wars — is read by
[`world-view.ts`](../../apps/web/lib/world-view.ts) to mark besieged settlements and drive the map
overlay. **Nothing ever writes it.** Battles resolve in
[`battle.ts`](../../packages/sim/src/battle.ts), provinces change hands, and the overlay stays
empty: the player reads about a battle in the Chronicle and sees nothing on the map where it
happened.

### What to build

- `resolveEngagement` returns the overlay entry alongside the facts it already returns, and the
  burst folds it into `world.conflicts.battles`.
- A siege is a project against a settlement today. When such a project opens, record the siege in
  the overlay; when it completes or is abandoned, remove it. The `underSiege` flag the map already
  reads then means something.
- Wars from Stage 2 populate `conflicts.wars`, so the map can colour a front rather than a border.
- Entries expire: a battle is a moment, not a condition. A fought battle should linger on the map
  for a scenario-defined few days and then become history.

`MapConflictsOverlaySchema` already validates that a besieged settlement exists and appears once, so
the writing side has to be correct rather than careful.

### How it is proved

**As built, differently.** Rather than maintaining the overlay by hand, `sim/conflicts.ts`
derives it: wars from the agreements that *are* the wars, sieges from the projects prosecuting
them, recomputed every tick. There is one source of truth for each and no parallel bookkeeping to
drift. Battles are the exception — a battle is a moment rather than a condition, so the engagement
records it and the list is bounded to the last six.

- A battle resolved in a province appears in the overlay and is gone a week later.
- A siege project's life and the overlay's siege entry begin and end together.

---

## Stage 5 — The sea

### What exists

Nothing. Forces are land forces. §6 lists ships in a polity's state, §8's worked example is *"build
200 warships within six months"*, and the First Punic War is a naval war — but there is no fleet, no
sea movement, no transport, no blockade and no naval engagement. The scenario's `troopCategories`
could describe ships, and the map's terrains can already declare a water province with `water: true`
and a sea-lane crossing. The vocabulary is there; the mechanics are not.

### What to build

**A domain on forces**: `land` or `naval`, derived from the troop categories the scenario defines
rather than hardcoded. A naval force uses sea-lane and strait edges; a land force does not.

**Transport.** A land force crossing a strait or sea lane must be carried: the move is legal only
when a naval force of the same polity with sufficient capacity is in the province. This is the rule
that makes Sicily an island rather than another province of Italy, and it is the single most
important consequence of the whole stage.

**Naval engagement** reuses the existing battle resolver with naval categories and its own tactics —
the resolver is already scenario-driven and takes its weights from `warfare`, so this is scenario
data plus a domain check, not a second combat system.

**Blockade** is where the sea pays for itself politically: a naval force sitting on a coastal
province at war with its controller cuts the income sources that name that counterparty, and
pressures the settlements there. It reuses Stage 2's war state and the income-source counterparty
that already exists for exactly this.

**Scenario work** (new version): give the Punic Wars scenario a naval troop category, a fleet for
Rome and two for Carthage, and mark the strait crossings the map already has. No map redraw.

### How it is proved

**As built.** A troop category may declare itself `naval` and carry `transportPerHead`; a force
is naval if it has hulls in it. `warfare/sea.ts` answers what is naval, what it can carry, and
which fleet could carry a given army. An army at a water crossing needs a fleet of its own power
standing with it, and **the fleet crosses with it** — a fleet that ferries an army and stays
behind has not sailed. Ships and armies cannot give battle to each other. Blockade is in the tick:
enemy ships on a port province of a power you are at war with shut that power's sea trade.
Scenario version 19 makes the Messana strait a `strait` and the Africa passage a `sea_lane`, and
gives Carthage, Syracuse and Rome their hulls — Rome deliberately the fewest.

- A legion ordered to Sicily without transports is refused, with the reason.
- The same legion with a fleet in the province crosses, and the fleet is where it left it.
- A blockading fleet cuts the named trade income while the war lasts, and only while it lasts.

---

## What this leaves alone

Storylines and developments (audit item 6) are deliberately out of scope — see the note in the
session that produced this plan. They are dead state rather than a missing system, and the decision
to be made about them is whether to drive them or delete them, not how to build them.
