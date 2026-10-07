import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, customsOn, economyOf, tradeTermsBetween, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { PEACE_TRADE_TARIFF_CAP_BPS, treatyOf } from "./peace-table";
import { trustOf } from "./treaties";
import { HUBS, POWERS, agreement, bookOf, flow, opening, priceOf, setStock, withAgreements, withCustoms } from "./trade-test-kit";

/**
 * A trade pact lowers tariffs (phase D of the economy rework).
 *
 * `trade_pact` was a word nothing read. It now carries terms the markets
 * read: a cap on the customs either power may lay on the other's goods, goods
 * let in free, and most-favoured status (the lowest rate either has agreed
 * with anyone). A pact does nothing for a third power's goods, and it does not
 * raise a rate that was already below the cap. Where a power has laid a
 * heavy tariff, a pact with a neighbour is what lets the neighbour's grain in.
 */

const { syracuse } = HUBS;
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  actsForTheWorld: true,
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("pact"),
  gameId: "game-pact",
});
const apply = (world: WorldState, raw: Record<string, unknown>) => applyDeltas(world, [WorldDeltaSchema.parse(raw)], context());
const pact = (capBps: number | null, more: { mostFavoured?: boolean; exempt?: ("grain" | "textiles")[] } = {}) =>
  agreement("trade_pact", POWERS.carthage, POWERS.syracuse, { trade: { tariffCapBps: capBps, mostFavoured: more.mostFavoured ?? false, exempt: more.exempt ?? [], goods: [] } });

/** Syracuse, with a heavy tariff, short of grain: what it took in from Carthage, in customs, and what its bread costs after. */
function month(world: WorldState) {
  const book = bookOf(withCustoms(world, POWERS.syracuse, 3_000));
  setStock(book, syracuse, "grain", 0.6);
  const result = flow(withCustoms(world, POWERS.syracuse, 3_000), book);
  const fromCarthage = result.lanes.get(`${POWERS.carthage}>${POWERS.syracuse}`) ?? 0;
  const fromMamertines = result.lanes.get(`mamertines>${POWERS.syracuse}`) ?? 0;
  return { fromCarthage, fromMamertines, duty: result.duties.get(POWERS.syracuse) ?? 0, price: priceOf(book, syracuse, "grain") };
}

describe("a trade pact lowers tariffs", () => {
  it("caps what a power may lay on its partner's goods, and lets more of them in", () => {
    const without = month(opening());
    const capped = month(withAgreements(opening(), pact(500)));
    // Without it a thirty in a hundred tariff keeps Carthage's grain out at this gap; with the cap it is five.
    expect(without.fromCarthage).toBe(0);
    expect(capped.fromCarthage).toBeGreaterThan(0);
    expect(capped.price).toBeLessThan(without.price);
    // The duty on what came across the border was the cap, to the drachma; on the Mamertines' goods, the full rate.
    expect(capped.duty).toBeCloseTo(capped.fromCarthage * 0.05 + capped.fromMamertines * 0.3, 3);
  });

  it("does nothing for a third power's goods", () => {
    const without = month(opening());
    const capped = month(withAgreements(opening(), pact(0)));
    // Messana's grain pays the full thirty in a hundred either way.
    expect(capped.fromMamertines).toBeCloseTo(without.fromMamertines, 3);
    expect(capped.duty).toBeCloseTo(capped.fromMamertines * 0.3, 3);
  });

  it("lets goods named in it in free of customs", () => {
    const freeGrain = month(withAgreements(opening(), pact(null, { exempt: ["grain"] })));
    expect(freeGrain.fromCarthage).toBeGreaterThan(0);
    expect(freeGrain.duty).toBeCloseTo(freeGrain.fromMamertines * 0.3, 3);
  });

  it("does not raise a rate that was already below the cap", () => {
    const world = withAgreements(opening(), pact(500));
    const terms = tradeTermsBetween(world, POWERS.carthage, POWERS.syracuse);
    expect(customsOn(terms, 200, "grain")).toBe(200);
    expect(customsOn(terms, 3_000, "grain")).toBe(500);
    expect(customsOn(terms, 3_000, "textiles")).toBe(500);
    // With no pact, the rate is the rate.
    expect(customsOn(tradeTermsBetween(opening(), POWERS.carthage, POWERS.syracuse), 3_000, "grain")).toBe(3_000);
  });

  it("gives a most-favoured partner the lowest rate either has agreed with anybody", () => {
    const base = withAgreements(
      opening(),
      pact(800, { mostFavoured: true }),
      // Syracuse has agreed Rome a cap of three in a hundred.
      agreement("trade_pact", POWERS.syracuse, POWERS.rome, { trade: { tariffCapBps: 300, mostFavoured: false, exempt: [], goods: [] } }),
    );
    expect(tradeTermsBetween(base, POWERS.carthage, POWERS.syracuse).pact?.tariffCapBps).toBe(300);
    // Without the flag Carthage has what was written.
    const plain = withAgreements(opening(), pact(800), agreement("trade_pact", POWERS.syracuse, POWERS.rome, { trade: { tariffCapBps: 300, mostFavoured: false, exempt: [], goods: [] } }));
    expect(tradeTermsBetween(plain, POWERS.carthage, POWERS.syracuse).pact?.tariffCapBps).toBe(800);
  });

  it("is opened by agreement_open with its terms, which the markets then read", () => {
    const opened = apply(opening(), { op: "agreement_open", localId: "pact-1", kind: "trade_pact", polityId: "carthage", otherPolityId: "syracuse", terms: "Customs of no more than five in a hundred.", trade: { tariffCapBps: 500, exempt: ["grain"] }, forDays: null, sourceMessageRef: null, visibility: "public", reason: "A pact." });
    expect(opened.rejected).toEqual([]);
    const placed = opened.world.polityAgreements.find((entry) => entry.kind === "trade_pact" && entry.polityId !== "rome" && entry.otherPolityId !== "rome")!;
    expect(placed.trade).toEqual({ tariffCapBps: 500, mostFavoured: false, exempt: ["grain"], goods: [] });
    expect(tradeTermsBetween(opened.world, "syracuse", "carthage").pact?.exempt).toEqual(["grain"]);
    expect(opened.factProposals.some((fact) => fact.kind === "trade_pact_opened")).toBe(true);
    // The same pact twice is one pact.
    expect(apply(opened.world, { op: "agreement_open", localId: "pact-2", kind: "trade_pact", polityId: "syracuse", otherPolityId: "carthage", terms: "Again.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Again." }).rejected.length).toBe(1);
  });

  it("is made from a trade offer's terms when the letter is accepted", () => {
    const world = opening();
    const sender = world.characters.find((character) => character.polityId === "carthage" && character.alive)!;
    const receiver = world.characters.find((character) => character.polityId === "syracuse" && character.alive)!;
    const sent = apply(world, { op: "diplomatic_message_send", localId: "offer", kind: "trade_offer", fromPolityId: "carthage", fromCharacterRef: sender.id, toPolityId: "syracuse", toCharacterRef: receiver.id, subject: "A pact of trade", terms: "Customs of five in a hundred at most, most favoured.", replyWithinDays: 30, trade: { tariffCapBps: 500, mostFavoured: true }, visibility: "public", reason: "Opening trade." });
    expect(sent.rejected).toEqual([]);
    const message = sent.world.diplomacy.at(-1)!;
    expect(message.trade?.tariffCapBps).toBe(500);
    // Ten days later, when the letter has arrived.
    const answered = applyDeltas({ ...sent.world, elapsedStep: 12 }, [WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: message.id, answer: "accepted", answerText: "Agreed.", reason: "Agreed." })], { ...context(), now: { day: 12, minute: 0 }, actorRef: { kind: "character", id: receiver.id } });
    expect(answered.rejected).toEqual([]);
    const placed = answered.world.polityAgreements.find((entry) => entry.kind === "trade_pact" && entry.polityId !== "rome" && entry.otherPolityId !== "rome")!;
    expect(placed.trade).toMatchObject({ tariffCapBps: 500, mostFavoured: true });
  });

  it("is ended by an embargo, which is a breach that costs the embargoer a little trust, unless the pact was closed first", () => {
    const base = withAgreements(opening(), pact(500));
    const trustBefore = trustOf(base, POWERS.syracuse, POWERS.carthage);
    const embargo = { op: "agreement_open", localId: "embargo-1", kind: "embargo", polityId: "carthage", otherPolityId: "syracuse", terms: "No trade.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "A quarrel." };
    const breach = apply(base, embargo);
    expect(breach.rejected).toEqual([]);
    expect(breach.world.polityAgreements.find((entry) => entry.kind === "trade_pact" && entry.polityId !== "rome" && entry.otherPolityId !== "rome")!.status).toBe("ended");
    expect(trustOf(breach.world, POWERS.syracuse, POWERS.carthage)).toBeLessThan(trustBefore);
    expect(trustOf(breach.world, POWERS.syracuse, POWERS.carthage)).toBeGreaterThanOrEqual(trustBefore - 15);
    expect(breach.factProposals.find((fact) => fact.kind === "embargo_laid")?.summary).toMatch(/breaks/);

    // Closed first: no breach.
    const closed = apply(base, { op: "agreement_close", agreementRef: base.polityAgreements.find((entry) => entry.kind === "trade_pact" && entry.polityId !== "rome" && entry.otherPolityId !== "rome")!.id, reason: "The pact lapses by consent." });
    const clean = apply(closed.world, embargo);
    expect(trustOf(clean.world, POWERS.syracuse, POWERS.carthage)).toBe(trustBefore);

    // And a pact opened over an embargo lifts it.
    const lifted = apply(clean.world, { op: "agreement_open", localId: "pact-over", kind: "trade_pact", polityId: "syracuse", otherPolityId: "carthage", terms: "Trade again.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Peace in trade." });
    expect(tradeTermsBetween(lifted.world, "syracuse", "carthage").closed).toBeNull();
    expect(lifted.world.polityAgreements.find((entry) => entry.kind === "embargo")!.status).toBe("ended");
  });

  it("is what a peace's trade term writes, with a modest mutual cap", () => {
    const made = treatyOf(opening(), [{ kind: "trade" }], "syracuse", "carthage");
    const open = made.besides.find((delta) => delta.op === "agreement_open")!;
    expect(open.op === "agreement_open" && open.kind).toBe("trade_pact");
    expect(open.op === "agreement_open" && open.trade?.tariffCapBps).toBe(PEACE_TRADE_TARIFF_CAP_BPS);
    const placed = apply(opening(), open as unknown as Record<string, unknown>).world.polityAgreements.find((entry) => entry.kind === "trade_pact" && entry.polityId !== "rome" && entry.otherPolityId !== "rome")!;
    expect(placed.trade?.tariffCapBps).toBe(500);
  });
});
