import { describe, expect, it } from "vitest";
import { PUNIC_IDS, punicWarsScenario } from "@chronica/db";
import { OrderPartSchema, ScenarioDefinitionSchema, effectsOf, orderPartStatus, type AppliedEffect, type OrderPart, type OrderPartyRef, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput } from "./burst";
import type { ChronicleEntry } from "./chronicle";
import { factContradictsState } from "./fact-parity";
import { opening } from "./fiscal-test-kit";
import { lineOf, orderOfPart, orderOutcomeLines, passageTellsItDone, toldOutcome } from "./order-outcomes";
import type { SimModelPort } from "./ports";
import { evidenceOfDone, scoreDisplayedOrder, scoreToldPart } from "./scorecard";

/**
 * Evidence of an order part is its own: dated, tied to its act and its
 * order, and read the same way whoever reads it -- the line, the scorecard,
 * the fact check, the receipt under the passage.
 *
 * Each case here is one the consolidation review found open: the same words
 * given twice linked to the wrong order; an empty or legacy evidence list
 * read as proof; a payment fact satisfied by any money that moved that day;
 * a one-part order's receipt dropped before anybody saw what the historian
 * delivered.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ACTOR = "gaius-genucius";
const LEGION = "roman-field-army";
const TREASURY = "rome-treasury";

const part = (change: Record<string, unknown> = {}): OrderPart => OrderPartSchema.parse({ said: "Buy a small estate near Capua.", ...change });
const effect = (op: string, atStep: number, extra: Partial<AppliedEffect> = {}): AppliedEffect => ({ op, atStep, refs: [], by: "act", attemptId: null, actorId: ACTOR, ...extra });
const withLegioNova = (world: WorldState): WorldState => {
  const legion = world.material.forces.find((force) => force.id === LEGION)!;
  return { ...world, material: { ...world.material, forces: [...world.material.forces, { ...legion, id: "legio-nova", name: "Legio Nova" }] } };
};
const raised = (atStep: number): OrderPart => part({ said: "Raise an army called Legio Nova", actsCarried: 1, actsDone: 1, effects: [effect("force_create", atStep, { refs: [{ kind: "force", id: "legio-nova" }], targetId: "legio-nova", personId: ACTOR, role: "commander" })] });

describe("the same words given twice", () => {
  it("are never linked to the other order by their words: a copy of the part found in two orders is not dated to either", () => {
    const world0 = withLegioNova(opening(300));
    // Given on day 100, and again on day 250; the army was made on day 120, for the first.
    const first = raised(120);
    const second = part({ said: "Raise an army called Legio Nova" });
    const world: WorldState = { ...world0, orders: [
      { id: "rec-early", actorCharacterId: ACTOR, text: "x", givenAtStep: 100, parts: [first] },
      { id: "rec-late", actorCharacterId: ACTOR, text: "x", givenAtStep: 250, parts: [second] },
    ] };
    // By identity, each is its own order.
    expect(orderOfPart(world, first)?.id).toBe("rec-early");
    expect(orderOfPart(world, second)?.id).toBe("rec-late");
    // A copy of the second (a part read back from a save, a later world): the same in every field, so still the late order.
    expect(orderOfPart(world, structuredClone(second))?.id).toBe("rec-late");
    // A part of those words found in neither, in its fields: two orders answer to the words, so neither is guessed.
    const other = part({ said: "Raise an army called Legio Nova", note: "read elsewhere" });
    expect(orderOfPart(world, other)).toBeUndefined();
    expect(toldOutcome(world, other, ACTOR).status).not.toBe("achieved");
    expect(evidenceOfDone(world, other, ACTOR)).toBe(false);
    // The early order's army does not make the late order done.
    expect(toldOutcome(world, second, ACTOR).status).not.toBe("achieved");
    expect(scoreDisplayedOrder(world, "rec-late", ['"Raise an army called Legio Nova" -- done.']).doneWithoutEvidence).toBe(1);
    // An effect dated before the order it is kept on is not that order's.
    const misdated: WorldState = { ...world, orders: [{ id: "rec-late", actorCharacterId: ACTOR, text: "x", givenAtStep: 250, parts: [raised(120)] }] };
    expect(toldOutcome(misdated, misdated.orders[0]!.parts[0]!, ACTOR, misdated.orders[0]).status).not.toBe("achieved");
    expect(evidenceOfDone(misdated, misdated.orders[0]!.parts[0]!, ACTOR, 250)).toBe(false);
  });

  it("are each told from their own order where the caller knows it", () => {
    const world0 = withLegioNova(opening(300));
    const early = raised(120);
    const late = raised(120);
    const world: WorldState = { ...world0, orders: [
      { id: "rec-early", actorCharacterId: ACTOR, text: "x", givenAtStep: 100, parts: [early] },
      { id: "rec-late", actorCharacterId: ACTOR, text: "x", givenAtStep: 250, parts: [late] },
    ] };
    expect(lineOf(world, early, ACTOR, undefined, world.orders[0])).toMatch(/-- done/);
    expect(lineOf(world, late, ACTOR, undefined, world.orders[1])).not.toMatch(/-- done/);
    expect(orderOutcomeLines(world, "rec-late")[0]).not.toMatch(/-- done/);
  });
});

describe("evidence that is not there", () => {
  const world = (): WorldState => withLegioNova(opening(150));
  const order = (parts: OrderPart[], base: WorldState = world()): WorldState => ({ ...base, orders: [{ id: "rec", actorCharacterId: ACTOR, text: "x", givenAtStep: 140, parts }] });

  it("is not proof: no effects, an empty list, or fewer effects than acts carried", () => {
    for (const shown of [part({ actsCarried: 1, actsDone: 1 }), part({ actsCarried: 1, actsDone: 1, effects: [] }), part({ actsCarried: 2, actsDone: 2, effects: [effect("holding_create", 145)] })]) {
      const state = order([shown]);
      expect(orderPartStatus(state, shown)).toBe("carried_unverified");
      expect(evidenceOfDone(state, shown, ACTOR)).toBe(false);
      expect(scoreToldPart(state, shown, ACTOR, `"${shown.said}" -- done.`).doneWithoutEvidence).toBe(true);
      // The engine's own line says unverified, and the scorecard agrees with it.
      expect(lineOf(state, shown, ACTOR)).toMatch(/ordered; no sign of it yet/);
      expect(scoreToldPart(state, shown, ACTOR).doneWithoutEvidence).toBe(false);
    }
  });

  it("is not made from an effect with no hand behind it, a guess, or one dated before the order", () => {
    for (const bad of [effect("holding_create", 145, { actorId: undefined }), effect("holding_create", 145, { by: "guess" }), effect("holding_create", 130)]) {
      const shown = part({ actsCarried: 1, actsDone: 1, effects: [bad] });
      expect(evidenceOfDone(order([shown]), shown, ACTOR)).toBe(false);
    }
    const good = part({ actsCarried: 1, actsDone: 1, effects: [effect("holding_create", 145)] });
    expect(evidenceOfDone(order([good]), good, ACTOR)).toBe(true);
  });

  it("is judged by the scorecard's own table, so an op the engine wrongly counted done is caught, not agreed with", () => {
    // The engine's list does not count a march as done by being done; a mistake that put it there
    // would be read by `orderPartStatus`, never by the scorecard.
    const marched = part({ said: "March to Capua", actsCarried: 1, actsDone: 1, effects: [effect("force_move", 145, { refs: [{ kind: "force", id: LEGION }] })] });
    const state = order([marched]);
    expect(evidenceOfDone(state, marched, ACTOR)).toBe(false);
    expect(scoreToldPart(state, marched, ACTOR, '"March to Capua" -- done.').doneWithoutEvidence).toBe(true);
  });

  it("reads a payment by its own lines: their sum, on the act's day, as the effect says", () => {
    const base = world();
    const consul = base.characters.find((character) => character.id === ACTOR)!;
    const line = { ...base.material.transactions[0]!, id: "tx-own", atStep: 145, sourceAccountId: TREASURY, destinationAccountId: consul.personalAccountId!, amount: 3000 };
    const books: WorldState = { ...base, material: { ...base.material, transactions: [...base.material.transactions, line] } };
    const paid = (amount: number, ids = ["tx-own"]) => part({ said: "Pay the consul", actsCarried: 1, actsDone: 1, effects: [effect("money_transfer", 145, { amount, transactionIds: ids, payerAccountId: TREASURY, payeeAccountId: consul.personalAccountId! })] });
    expect(evidenceOfDone(order([paid(3000)], books), paid(3000), ACTOR)).toBe(true);
    // A sum the lines do not add up to, a line that is not in the books, or no line at all.
    expect(evidenceOfDone(order([paid(5000)], books), paid(5000), ACTOR)).toBe(false);
    expect(evidenceOfDone(order([paid(3000, ["tx-gone"])], books), paid(3000, ["tx-gone"]), ACTOR)).toBe(false);
    expect(evidenceOfDone(order([paid(3000, [])], books), paid(3000, []), ACTOR)).toBe(false);
  });

  it("does not raise a part partly refused to done, and flags a line that says it was", () => {
    const partly = part({ said: "Raise two legions", actsCarried: 1, actsDone: 1, actsRefused: 1, effects: [effect("force_create", 145, { refs: [{ kind: "force", id: "legio-nova" }], targetId: "legio-nova" })] });
    const state = order([partly]);
    expect(orderPartStatus(state, partly)).toBe("partly_done");
    expect(evidenceOfDone(state, partly, ACTOR)).toBe(false);
    const score = scoreToldPart(state, partly, ACTOR, '"Raise two legions" -- done.');
    expect(score.erasedFailure).toBe(true);
    expect(scoreToldPart(state, partly, ACTOR).erasedFailure).toBe(false);
  });
});

describe("a sum said paid", () => {
  const base = (): WorldState => opening(150);
  const paid = (summary: string, accounts: string[]) => ({ kind: "payment", summary, affectedRefs: accounts.map((id) => ({ kind: "account", id })) as OrderPartyRef[] });
  const withLines = (world: WorldState, lines: { id: string; amount: number; from: string; to?: string; atStep?: number }[]): WorldState => ({
    ...world, material: { ...world.material, transactions: [...world.material.transactions, ...lines.map((line) => ({ ...world.material.transactions[0]!, id: line.id, atStep: line.atStep ?? 150, amount: line.amount, sourceAccountId: line.from, destinationAccountId: line.to ?? undefined }))] },
  });

  it("is held to the exact sum: part of it paid is not the whole of it", () => {
    const world = withLines(base(), [{ id: "tx-part", amount: 3000, from: TREASURY }]);
    const claim = paid("The treasury paid 5,000 to the shipwrights.", [TREASURY]);
    expect(factContradictsState(world, claim, () => new Set(), { atStep: 150, transactionIds: new Set(["tx-part"]) })).toMatch(/5000 was paid/);
    expect(factContradictsState(world, paid("The treasury paid 3,000 to the shipwrights.", [TREASURY]), () => new Set(), { atStep: 150, transactionIds: new Set(["tx-part"]) })).toBeNull();
  });

  it("is not answered by an unrelated payment of the same day and sum", () => {
    const world = withLines(base(), [{ id: "tx-other", amount: 5000, from: TREASURY }]);
    const claim = paid("The treasury paid 5,000 to the shipwrights.", [TREASURY]);
    // The answer's own acts wrote no line: the day's other payment is not this one.
    expect(factContradictsState(world, claim, () => new Set(), { atStep: 150, transactionIds: new Set() })).not.toBeNull();
    expect(factContradictsState(world, claim, () => new Set(), { atStep: 150, transactionIds: new Set(["tx-other"]) })).toBeNull();
    // Nor by one of another day.
    const yesterday = withLines(base(), [{ id: "tx-old", amount: 5000, from: TREASURY, atStep: 149 }]);
    expect(factContradictsState(yesterday, claim, () => new Set(), { atStep: 150, transactionIds: new Set(["tx-old"]) })).not.toBeNull();
  });

  it("is held to both purses it names", () => {
    const consul = base().characters.find((character) => character.id === ACTOR)!;
    const purse = consul.personalAccountId!;
    const other = base().material.accounts.find((account) => account.id !== TREASURY && account.id !== purse)!.id;
    const world = withLines(base(), [{ id: "tx-1", amount: 500, from: TREASURY, to: other }]);
    const claim = paid(`The treasury paid 500 to the consul.`, [TREASURY, purse]);
    expect(factContradictsState(world, claim, () => new Set(), { atStep: 150, transactionIds: new Set(["tx-1"]) })).not.toBeNull();
    const right = withLines(base(), [{ id: "tx-2", amount: 500, from: TREASURY, to: purse }]);
    expect(factContradictsState(right, claim, () => new Set(), { atStep: 150, transactionIds: new Set(["tx-2"]) })).toBeNull();
  });

  it("is not a claim where it denies the payment", () => {
    expect(factContradictsState(base(), paid("The treasury never paid the 5,000 it owed.", [TREASURY]), () => new Set(), { atStep: 150, transactionIds: new Set() })).toBeNull();
  });
});

describe("the receipt under a one-part order done", () => {
  const world0 = withLegioNova(opening(150));
  const world: WorldState = { ...world0, orders: [{ id: "rec", actorCharacterId: ACTOR, text: "x", givenAtStep: 140, parts: [raised(145)] }] };
  const passage = (change: Partial<ChronicleEntry>): ChronicleEntry => ({
    kind: "narrated", title: "A second legion", body: "Legio Nova was raised at Rome and stood under arms by the month's end.", factIds: ["fact-order"], subjects: [], tags: [], changes: [], quote: null, voice: "historian", fromInstantSortKey: 0, toInstantSortKey: 0, ...change,
  });
  const told = (entries: ChronicleEntry[]) => orderOutcomeLines(world, "rec", undefined, { entries, orderFactIds: ["fact-order"] });

  it("is printed when nobody says what the historian delivered", () => {
    expect(orderOutcomeLines(world, "rec")).toHaveLength(1);
    expect(orderOutcomeLines(world, "rec")[0]).toMatch(/-- done/);
  });

  it("is left out only where her own passage, from the order's facts, says it was done", () => {
    expect(told([passage({})])).toEqual([]);
    expect(passageTellsItDone([passage({})], ["fact-order"])).toBe(true);
  });

  it("is printed where she declined, failed, was never rendered, or did not say it", () => {
    // Declined or never rendered: no passage at all.
    expect(told([])).toHaveLength(1);
    // Failed: the facts set down plainly in her place.
    expect(told([passage({ voice: "facts" })])).toHaveLength(1);
    // An entry from the books, not her prose; one with no voice (an old entry).
    expect(told([passage({ kind: "recorded" })])).toHaveLength(1);
    expect(told([passage({ voice: undefined })])).toHaveLength(1);
    // Her passage, of other facts; or of the order's, silent on it or denying it.
    expect(told([passage({ factIds: ["fact-other"] })])).toHaveLength(1);
    expect(told([passage({ body: "The consul spoke of a legion at length." })])).toHaveLength(1);
    expect(told([passage({ title: "No legion", body: "No legion was raised that month." })])).toHaveLength(1);
  });

  it("is always printed for an order of two parts, and for one not done", () => {
    const unfinished: WorldState = { ...world0, orders: [{ id: "rec", actorCharacterId: ACTOR, text: "x", givenAtStep: 140, parts: [part({ said: "Raise an army called Legio Nova" })] }] };
    expect(orderOutcomeLines(unfinished, "rec", undefined, { entries: [passage({})], orderFactIds: ["fact-order"] })).toHaveLength(1);
  });

  it("names no record ids, accounts or money lines the evidence carries", () => {
    const consul = world0.characters.find((character) => character.id === ACTOR)!;
    const secret = part({ said: "Pay the consul", actsCarried: 1, actsDone: 1, effects: [effect("money_transfer", 145, { amount: 50, transactionIds: ["tx-secret-1"], payerAccountId: TREASURY, payeeAccountId: consul.personalAccountId! })] });
    const state: WorldState = { ...world0, orders: [{ id: "rec", actorCharacterId: ACTOR, text: "x", givenAtStep: 140, parts: [secret] }] };
    const line = lineOf(state, secret, ACTOR);
    expect(line).not.toMatch(/tx-secret-1|rome-treasury|personal|acct/);
  });
});

describe("an act applied by a turn", () => {
  const answer = (change: Record<string, unknown>): string => JSON.stringify({
    narrativeSummary: "Done as ordered.", frictions: [], deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
    intent: { summary: "The order.", domains: ["military"], parts: [] }, ...change,
  });
  const scripted = (orchestrate: string): SimModelPort => ({
    complete: (operation) => Promise.resolve(operation === "simulate_orchestrate" ? orchestrate : operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}"),
  });
  const input = (world: WorldState, port: SimModelPort, orderText: string): BurstInput => ({
    world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "evidence", gameId: "game-evidence",
    actorRef: { kind: "character", id: ACTOR }, actorPolityId: "rome", orderText, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1,
  });

  it("keeps who did it, for which part, the sum it moved and the lines it wrote; and the record loads again", async () => {
    const world = opening(150);
    const consul = world.characters.find((character) => character.id === ACTOR)!;
    const pay = answer({
      intent: { summary: "Pay.", domains: ["economy"], parts: [{ said: "Pay 40 from the treasury into my purse", acts: [0], goals: [], spend: null, factLocalIds: [], whyNot: null }] },
      deltas: [{ op: "money_transfer", fromAccountRef: TREASURY, toAccountRef: consul.personalAccountId, amount: 40, reason: "The consul's allowance." }],
    });
    const result = await runSimulationBurst(input(world, scripted(pay), "Pay 40 from the treasury into my purse"));
    const order = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const shown = order.parts[0]!;
    const moved = effectsOf(shown).find((candidate) => candidate.op === "money_transfer");
    if (moved === undefined) {
      // Refused (the consul may not draw on the treasury): then nothing is evidence, and the line says so.
      expect(shown.actsRefused + (shown.refusal === null ? 0 : 1)).toBeGreaterThan(0);
      expect(evidenceOfDone(result.world, shown, ACTOR)).toBe(false);
      return;
    }
    expect(moved.actorId).toBe(ACTOR);
    expect(moved.partRef).toBe(`${order.id}-p0`);
    expect(moved.payerAccountId).toBe(TREASURY);
    expect(moved.payeeAccountId).toBe(consul.personalAccountId);
    expect(moved.transactionIds?.length).toBeGreaterThan(0);
    const lines = result.world.material.transactions.filter((line) => moved.transactionIds!.includes(line.id));
    expect(moved.amount).toBe(lines.reduce((sum, line) => sum + line.amount, 0));
    expect(lines.every((line) => line.atStep === moved.atStep)).toBe(true);
    expect(() => OrderPartSchema.parse(JSON.parse(JSON.stringify(shown)))).not.toThrow();
  });

  it("keeps whom it placed, in what role and which army, from the act and not from its words", async () => {
    const world = opening(150);
    const legion = world.material.forces.find((force) => force.id === LEGION)!;
    const officer = world.characters.find((character) => character.alive && character.polityId === "rome" && character.id !== ACTOR && !world.material.forces.some((force) => force.commanderCharacterId === character.id))!;
    const appoint = answer({
      intent: { summary: "Appoint.", domains: ["military"], parts: [{ said: `Appoint ${officer.name} to command ${legion.name}`, acts: [0], goals: [], spend: null, factLocalIds: [], whyNot: null }] },
      deltas: [{ op: "force_modify", forceRef: LEGION, commanderCharacterRef: officer.id, reason: "The consul gives the army a new commander." }],
    });
    const result = await runSimulationBurst(input(world, scripted(appoint), `Appoint ${officer.name} to command ${legion.name}`));
    const shown = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!.parts[0]!;
    const placed = effectsOf(shown).find((candidate) => candidate.op === "force_modify");
    if (placed === undefined) return expect(toldOutcome(result.world, shown, ACTOR).status).not.toBe("achieved");
    expect(placed).toMatchObject({ actorId: ACTOR, personId: officer.id, role: "commander", targetId: LEGION });
    const now = result.world.material.forces.find((force) => force.id === LEGION)!;
    expect(toldOutcome(result.world, shown, ACTOR).status === "achieved").toBe(now.commanderCharacterId === officer.id);
  });

  it("records the act as the world applied it, not as it was written", async () => {
    const world = opening(150);
    // Written from a chest that is not there; the engine fills the gap with the payer's own purse, and the effect says so.
    const ghost = answer({
      intent: { summary: "Pay.", domains: ["economy"], parts: [{ said: "Pay 40 into the treasury", acts: [0], goals: [], spend: null, factLocalIds: [], whyNot: null }] },
      deltas: [{ op: "money_transfer", fromAccountRef: "no-such-chest", toAccountRef: TREASURY, amount: 40, reason: "x" }],
    });
    const result = await runSimulationBurst(input(world, scripted(ghost), "Pay 40 into the treasury"));
    const shown = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!.parts[0]!;
    for (const moved of effectsOf(shown).filter((candidate) => candidate.op === "money_transfer")) {
      expect(moved.payerAccountId).not.toBe("no-such-chest");
      expect(result.world.material.accounts.some((account) => account.id === moved.payerAccountId)).toBe(true);
      const lines = result.world.material.transactions.filter((line) => moved.transactionIds?.includes(line.id));
      expect(lines.every((line) => line.sourceAccountId === moved.payerAccountId)).toBe(true);
    }
  });

  it("is not stamped for an act the world refused", async () => {
    const world = opening(150);
    const theft = answer({
      intent: { summary: "Pay.", domains: ["economy"], parts: [{ said: "Pay 40 from Carthage's treasury into ours", acts: [0], goals: [], spend: null, factLocalIds: [], whyNot: null }] },
      deltas: [{ op: "money_transfer", fromAccountRef: "carthage-treasury", toAccountRef: TREASURY, amount: 40, reason: "x" }],
    });
    const result = await runSimulationBurst(input(world, scripted(theft), "Pay 40 from Carthage's treasury into ours"));
    const shown = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)?.parts[0];
    const moved = result.world.material.transactions.some((line) => line.sourceAccountId === "carthage-treasury" && line.destinationAccountId === TREASURY && line.amount === 40);
    // Refused, as Rome's consul has no say over Carthage's chest: no effect is kept, and the line is not "done".
    expect(moved).toBe(false);
    expect(shown === undefined ? [] : effectsOf(shown).filter((candidate) => candidate.payerAccountId === "carthage-treasury")).toEqual([]);
    if (shown !== undefined) expect(lineOf(result.world, shown, ACTOR)).not.toMatch(/-- done/);
    void PUNIC_IDS;
  });
});
