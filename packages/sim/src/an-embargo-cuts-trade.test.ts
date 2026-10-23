import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, expireDatedAgreements, mayTradeGood, tradeTermsBetween, type GoodId, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { SOVEREIGN_AGREEMENTS, nobodyListens } from "./apply/nobody-listens";
import type { ApplyContext } from "./apply/context";
import { freshIds } from "./fresh-ids-test-kit";
import { HUBS, POWERS, agreement, bookOf, flow, inflowOf, opening, outflowOf, priceOf, setStock, withAgreements } from "./trade-test-kit";

/**
 * An embargo cuts trade (phase D of the economy rework).
 *
 * One power may forbid all trade with another, or trade in the goods it names,
 * without any war: a merchant of either cannot sell in the other's markets
 * until the embargoer closes it or its term runs out. It is one power's act,
 * so it is ordered (the embargoer first), but it shuts the road both ways. The
 * grain that crossed from Carthage's hub of Agrigentum to hungry Syracuse
 * stops, and Syracuse's bread is dearer for it.
 */

const { syracuse, agrigentum } = HUBS;
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
// Ids the world acted on has not used: one seed reused made two rows with one id (`ids.unique`).
const context = (world: WorldState): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  actsForTheWorld: true,
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: freshIds("embargo", world),
  gameId: "game-embargo",
});
const apply = (world: WorldState, raw: Record<string, unknown>) => applyDeltas(world, [WorldDeltaSchema.parse(raw)], context(world));

/** What crossed the border between Carthage and Syracuse in a month, in drachmae, by whichever way. */
const acrossTheBorder = (lanes: ReadonlyMap<string, number>): number =>
  [...lanes.entries()].filter(([key]) => key === `${POWERS.carthage}>${POWERS.syracuse}` || key === `${POWERS.syracuse}>${POWERS.carthage}`).reduce((sum, [, value]) => sum + value, 0);

/**
 * Syracuse short of grain and of cloth, a month of trade. Its neighbours are Carthage's Agrigentum across the border
 * and the Mamertines' Messana, which is a power it is not embargoed with.
 */
function month(world: WorldState, shortOf: readonly GoodId[] = ["grain", "textiles"]) {
  const book = bookOf(world);
  for (const good of shortOf) setStock(book, syracuse, good, 0.35);
  const result = flow(world, book);
  return { book, result, border: acrossTheBorder(result.lanes), grain: inflowOf(book, syracuse, "grain"), cloth: inflowOf(book, syracuse, "textiles") };
}

describe("an embargo cuts trade", () => {
  it("lets goods cross the border where nothing forbids it", () => {
    const open = month(opening());
    expect(open.border).toBeGreaterThan(0);
    expect(open.grain).toBeGreaterThan(0);
    expect(open.cloth).toBeGreaterThan(0);
  });

  it("stops every good between the two powers when it names none, whichever of them laid it", () => {
    const free = month(opening());
    for (const [by, on] of [[POWERS.carthage, POWERS.syracuse], [POWERS.syracuse, POWERS.carthage]] as const) {
      const embargoed = month(withAgreements(opening(), agreement("embargo", by, on)));
      // Nothing crossed the border, in either direction, and Syracuse got less than it would have: only what Messana sent.
      expect(embargoed.border).toBe(0);
      expect(embargoed.grain).toBeLessThan(free.grain);
      expect(embargoed.cloth).toBeLessThan(free.cloth);
    }
  });

  it("stops only the goods it names, and lets the rest cross", () => {
    const free = month(opening());
    const grainOnly = month(withAgreements(opening(), agreement("embargo", POWERS.carthage, POWERS.syracuse, { trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: ["grain"] } })));
    expect(grainOnly.grain).toBeLessThan(free.grain);
    // The cloth is untouched, to the unit.
    expect(grainOnly.cloth).toBe(free.cloth);
    expect(grainOnly.border).toBeGreaterThan(0);
  });

  it("shuts the road both ways: the power embargoed cannot sell to the embargoer either", () => {
    const run = (world: WorldState) => {
      const book = bookOf(world);
      setStock(book, agrigentum, "grain", 0.3);
      return acrossTheBorder(flow(world, book).lanes);
    };
    expect(run(opening())).toBeGreaterThan(0);
    expect(run(withAgreements(opening(), agreement("embargo", POWERS.syracuse, POWERS.carthage)))).toBe(0);
  });

  it("leaves the trade of the two with everybody else alone", () => {
    const world = withAgreements(opening(), agreement("embargo", POWERS.carthage, POWERS.syracuse));
    // Syracuse short, Agrigentum shut out, and Messana (the Mamertines') still sends it grain.
    const book = bookOf(world);
    setStock(book, syracuse, "grain", 0.4);
    flow(world, book);
    expect(inflowOf(book, syracuse, "grain")).toBeGreaterThan(0);
    expect(outflowOf(book, agrigentum, "grain")).toBe(0);
    expect(tradeTermsBetween(world, POWERS.rome, POWERS.syracuse).closed).toBeNull();
    expect(tradeTermsBetween(world, POWERS.rome, POWERS.carthage).closed).toBeNull();
  });

  it("makes the bread of the power it shuts out dearer, month after month", () => {
    const run = (world: WorldState): number => {
      const book = bookOf(world);
      setStock(book, syracuse, "grain", 0.4);
      for (let step = 0; step < 6; step += 1) flow(world, book);
      return priceOf(book, syracuse, "grain");
    };
    const embargoed = run(withAgreements(opening(), agreement("embargo", POWERS.carthage, POWERS.syracuse)));
    const free = run(opening());
    expect(embargoed).toBeGreaterThan(free);
  });

  it("is read from the powers' sides: a power's foedus allies are shut out with its leader", () => {
    const world = withAgreements(opening(), agreement("embargo", POWERS.rome, POWERS.carthage));
    // Rome's allies by foedus follow its foreign policy, trade's included.
    expect(tradeTermsBetween(world, "samnites", POWERS.carthage).closed).toBe("embargo");
    expect(tradeTermsBetween(world, "samnites", POWERS.syracuse).closed).toBeNull();
    expect(mayTradeGood(tradeTermsBetween(world, "samnites", POWERS.carthage), "grain")).toBe(false);
  });

  it("is laid and lifted by agreement_open and agreement_close, and runs out when its term does", () => {
    const laid = apply(opening(), { op: "agreement_open", localId: "embargo-1", kind: "embargo", polityId: "rome", otherPolityId: "carthage", terms: "No Carthaginian merchant is to sell in Rome's markets.", forDays: 90, sourceMessageRef: null, visibility: "public", reason: "A tariff war." });
    expect(laid.rejected).toEqual([]);
    const placed = laid.world.polityAgreements.find((entry) => entry.kind === "embargo")!;
    expect(placed.polityId).toBe("rome");
    expect(placed.otherPolityId).toBe("carthage");
    expect(tradeTermsBetween(laid.world, "carthage", "rome").closed).toBe("embargo");
    // One line of news, an embargo laid.
    expect(laid.factProposals.some((fact) => fact.kind === "embargo_laid")).toBe(true);
    // The same embargo twice is one embargo; the other way round is another, Carthage's own.
    expect(apply(laid.world, { op: "agreement_open", localId: "embargo-2", kind: "embargo", polityId: "rome", otherPolityId: "carthage", terms: "Again.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Again." }).rejected.length).toBe(1);
    expect(apply(laid.world, { op: "agreement_open", localId: "embargo-3", kind: "embargo", polityId: "carthage", otherPolityId: "rome", terms: "In kind.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "In kind." }).rejected).toEqual([]);

    // Its term runs out by itself.
    const later = { ...laid.world, polityAgreements: expireDatedAgreements(laid.world.polityAgreements, 91) };
    expect(tradeTermsBetween(later, "carthage", "rome").closed).toBeNull();

    // Or the embargoer lifts it.
    const lifted = apply(laid.world, { op: "agreement_close", agreementRef: placed.id, reason: "Trade resumes." });
    expect(lifted.rejected).toEqual([]);
    expect(tradeTermsBetween(lifted.world, "carthage", "rome").closed).toBeNull();
  });

  it("names the goods it forbids on the agreement, and an embargo of everything names none", () => {
    const laid = apply(opening(), { op: "agreement_open", localId: "embargo-g", kind: "embargo", polityId: "rome", otherPolityId: "carthage", terms: "No Carthaginian oil or wine.", trade: { goods: ["oil_wine"] }, forDays: null, sourceMessageRef: null, visibility: "public", reason: "Rome protects its own groves." });
    const terms = tradeTermsBetween(laid.world, "rome", "carthage");
    expect(terms.closed).toBeNull();
    expect(terms.forbidden).toEqual(["oil_wine"]);
    expect(mayTradeGood(terms, "oil_wine")).toBe(false);
    expect(mayTradeGood(terms, "grain")).toBe(true);
  });

  it("is a sovereign act, like war and peace: nobody in the field binds his power's markets on his own word", () => {
    expect(SOVEREIGN_AGREEMENTS.has("embargo")).toBe(true);
    expect(SOVEREIGN_AGREEMENTS.has("trade_pact")).toBe(true);
    const delta = WorldDeltaSchema.parse({ op: "agreement_open", localId: "embargo-field", kind: "embargo", polityId: "rome", otherPolityId: "carthage", terms: "No Carthaginian merchant is to sell in Rome's markets.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "On his own word." });
    const world = opening();
    const roman = world.characters.find((character) => character.polityId === "rome" && character.alive)!;
    const told = nobodyListens(delta, world, roman.id, (ref) => ref, new Set(), definition.government.offices);
    expect(told).toMatch(/proclaimed an embargo/);
  });
});
