import { describe, expect, it } from "vitest";
import { PUNIC_IDS } from "@chronica/db";
import {
  WorldDeltaSchema,
  economyOf,
  ensureMarkets,
  hubOf,
  marketEntry,
  marketGeography,
  marketPriceBps,
  modernWordsIn,
  stockIn,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";
import { landShipments, sourcesFor } from "./grain-purchases";
import { definition, government, opening, withChest, withWar } from "./fiscal-test-kit";
import { stockedWorld, withGrain } from "./grain-test-kit";

/**
 * The treasury buys grain in a dearth (v58).
 *
 * A dole out of the chest was money given to nobody. Now it is spent at the markets: the grain is bought out of the hubs that hold more than they need,
 * the cheapest once carried first, paid for through the market door, and sent to the hungry hub, where it lands when the road says and its price falls.
 */

const ROME = PUNIC_IDS.rome;

function setUp(): { world: WorldState; hungry: string } {
  const probe = ensureMarkets(withChest(opening(150), "rome", 3_000_000));
  const hungry = hubOf(probe, ROME)!;
  // The markets of the world stocked well past their needs; Rome's own is the one that is short.
  return { world: withGrain(stockedWorld(150, 2.2, [hungry]), hungry, 0.3), hungry };
}

const dole = (world: WorldState, provinceId: string, amount = 60_000) => {
  const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!.id;
  const aedile = world.material.officeSeats.find((seat) => /aedile/.test(seat.officeId) && seat.holderCharacterId !== null)!.holderCharacterId!;
  const delta = WorldDeltaSchema.parse({ op: "public_benefaction", payerAccountRef: treasury, amount, kind: "dole", provinceId, reason: "The aedile gives bread out of the chest: it is dear." });
  return applyDeltas(world, [delta], {
    now: { day: world.instant.day, minute: 540 }, actorRef: { kind: "character", id: aedile }, offices: government.offices, successionRules: government.successionRules,
    warfare: definition.warfare, ids: createIdFactory("dole"), gameId: "game-dole", actsForTheWorld: true,
  });
};

describe("the treasury buys grain in a dearth", () => {
  it("spends the dole at the markets: the cheapest first, the stock drawn from them and the money through the market door", () => {
    const { world, hungry } = setUp();
    const before = stockIn(world, hungry, "grain");
    const priceBefore = marketPriceBps(world, hungry, "grain");
    expect(priceBefore).toBeGreaterThan(12_000);
    const sources = sourcesFor(world, "rome", hungry);
    expect(sources.length).toBeGreaterThan(1);
    // Cheapest landed first, and no hub is counted twice.
    for (let index = 1; index < sources.length; index += 1) expect(sources[index]!.landed).toBeGreaterThanOrEqual(sources[index - 1]!.landed);
    const result = dole(world, ROME);
    expect(result.rejected).toEqual([]);
    const shipments = economyOf(result.world).shipments;
    expect(shipments.length).toBeGreaterThan(0);
    expect(shipments.every((row) => row.status === "on_the_way" && row.toHubId === hungry && row.arrivesAtStep > world.elapsedStep)).toBe(true);
    // The first bought is the cheapest of the sources.
    expect(shipments[0]!.fromHubId).toBe(sources[0]!.hubId);
    // The sources were drawn on; the hungry hub has not yet had it.
    for (const row of shipments) expect(stockIn(result.world, row.fromHubId, "grain")).toBeLessThan(stockIn(world, row.fromHubId, "grain"));
    expect(stockIn(result.world, hungry, "grain")).toBe(before);
    // The money left the chest by the market door, and by no other way.
    const treasury = (state: WorldState) => state.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!.balance;
    const spent = treasury(world) - treasury(result.world);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(60_000);
    expect(shipments.reduce((sum, row) => sum + row.paid, 0)).toBe(spent);
    const audit = auditMoney(world, result.world);
    expect(audit.unexplained).toEqual([]);
    expect(audit.doors.market.out).toBeGreaterThanOrEqual(spent);
    expect(result.factProposals.some((fact) => fact.kind === "public_benefaction" && /bought/.test(fact.summary))).toBe(true);
  });

  it("lands the grain when the road says, and the hungry hub's price falls by it", () => {
    const { world, hungry } = setUp();
    const sent = dole(world, ROME).world;
    const last = Math.max(...economyOf(sent).shipments.map((row) => row.arrivesAtStep));
    // Not before it is due.
    const early = landShipments(sent, last - 1);
    expect(stockIn(early.world, hungry, "grain")).toBeLessThanOrEqual(stockIn(sent, hungry, "grain") + economyOf(sent).shipments.filter((row) => row.arrivesAtStep <= last - 1).reduce((sum, row) => sum + row.units, 0));
    const landed = landShipments(sent, last);
    const units = economyOf(sent).shipments.reduce((sum, row) => sum + row.units, 0);
    expect(stockIn(landed.world, hungry, "grain")).toBeGreaterThan(stockIn(sent, hungry, "grain"));
    expect(stockIn(landed.world, hungry, "grain") - stockIn(sent, hungry, "grain")).toBeLessThanOrEqual(units);
    expect(marketPriceBps(landed.world, hungry, "grain")).toBeLessThan(marketPriceBps(sent, hungry, "grain"));
    expect(landed.facts.some((fact) => fact.kind === "grain_shipment_landed")).toBe(true);
    expect(economyOf(landed.world).shipments.every((row) => row.status !== "on_the_way")).toBe(true);
    // Said in the words of the age.
    expect(landed.facts.flatMap((fact) => modernWordsIn(fact.summary))).toEqual([]);
  });

  it("buys nothing from an enemy's markets, nor where the hub is shut by a siege, and is lost if the hub is shut by the time it lands", () => {
    const { world, hungry } = setUp();
    const all = sourcesFor(world, "rome", hungry).map((source) => source.hubId);
    const enemyHub = all.find((hub) => world.map.provinces.find((province) => province.id === hub)?.controllerPolityId === "carthage");
    expect(enemyHub, "a Carthaginian market is among the sources in peace").toBeDefined();
    const atWar = withWar(world, "rome", "carthage");
    expect(sourcesFor(atWar, "rome", hungry).map((source) => source.hubId)).not.toContain(enemyHub);
    // A market that holds only its own needs sells nothing.
    const bare = withGrain(world, all[0]!, 0.5);
    expect(sourcesFor(bare, "rome", hungry).map((source) => source.hubId)).not.toContain(all[0]);
    // The hub is under siege on the day the grain comes: it is lost.
    const sent = dole(world, ROME).world;
    const sieged: WorldState = { ...sent, sieges: [...sent.sieges, { id: "siege-x", forceId: "roman-field-army", provinceId: hungry, settlementId: null, besiegerPolityId: "carthage", defenderPolityId: "rome", startedAtStep: 100, pressedToStep: 150, reportedAtStep: 150, pressureBps: 1_000, awaiting: null, works: [], told: [], status: "active", endedAtStep: null, endedReason: null }] };
    const lost = landShipments(sieged, Math.max(...economyOf(sent).shipments.map((row) => row.arrivesAtStep)));
    expect(lost.facts.some((fact) => fact.kind === "grain_shipment_lost")).toBe(true);
    expect(stockIn(lost.world, hungry, "grain")).toBe(stockIn(sieged, hungry, "grain"));
  });

  it("gives the dole as it always was where no market has grain to spare, or the hub is not dear", () => {
    const { world, hungry } = setUp();
    // Every other hub as bare as it opens: nothing to buy.
    let bare = world;
    for (const hub of marketGeography(world).hubs) if (hub !== hungry) bare = withGrain(bare, hub, 0.9);
    const given = dole(bare, ROME);
    expect(given.rejected).toEqual([]);
    expect(economyOf(given.world).shipments).toEqual([]);
    expect(auditMoney(bare, given.world).unexplained).toEqual([]);
    // A hub that is not dear is not relieved.
    const calm = withGrain(world, hungry, 1);
    expect(economyOf(dole(calm, ROME).world).shipments).toEqual([]);
  });

  it("is the same on every run", () => {
    const { world } = setUp();
    expect(JSON.stringify(economyOf(dole(world, ROME).world).shipments)).toBe(JSON.stringify(economyOf(dole(world, ROME).world).shipments));
    expect(marketEntry(world, ROME, "grain")).toBeDefined();
  });
});
