import { describe, expect, it } from "vitest";
import { WorldDeltaSchema, economyOf, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { housesFor, MARGIN_BPS, victuallerOf } from "./army-victualling";
import { putInABid, standingBids } from "./bids";
import { createIdFactory } from "./ports";
import { definition, government, withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";
import { bidClause } from "./trade-templates";

/**
 * A man who heads a firm may bid for the army's bread, and the best bid takes it: the lowest margin, the more reliable first. The contract was let to a house
 * picked by lot among those of the power; a private man could not bid at all.
 */
const ARMY = "roman-field-army";
const treasuryOf = (world: WorldState): string => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!.id;
const atWarWorld = (): WorldState => withWar(stockedWorld(150, 2.2, [], 3_000_000), "rome", "carthage");
const letTheContract = (world: WorldState) => {
  const consul = world.material.officeSeats.find((seat) => /consul/.test(seat.officeId) && seat.holderCharacterId !== null)!.holderCharacterId!;
  return applyDeltas(world, [WorldDeltaSchema.parse({ op: "force_provision", forceRef: ARMY, how: "contract", days: 180, fromProvinceId: null, payAccountRef: treasuryOf(world), reason: "The consul lets the feeding of the army to a house." })], {
    now: { day: world.instant.day, minute: 540 }, actorRef: { kind: "character", id: consul }, offices: government.offices, successionRules: government.successionRules,
    warfare: definition.warfare, ids: createIdFactory("bid"), gameId: "game-bid", actsForTheWorld: true,
  });
};

describe("a firm wins the army's bread", () => {
  it("takes the contract at its own, lower margin, with a line saying so; and a dearer bid does not", () => {
    const world = atWarWorld();
    const houses = housesFor(world, "rome");
    expect(houses.length).toBeGreaterThan(1);
    // Whichever the lot would not have chosen bids low.
    const plain = victuallerOf(letTheContract(world).world, ARMY)!.victuals!.houseId;
    const bidder = houses.find((house) => house.id !== plain)!;
    const bidding = putInABid(world, bidder, "army_bread", 900, null, world.elapsedStep);
    expect(standingBids(bidding, "army_bread").map((bid) => bid.houseId)).toEqual([bidder.id]);
    const result = letTheContract(bidding);
    expect(result.rejected).toEqual([]);
    const contract = victuallerOf(result.world, ARMY)!;
    expect(contract.victuals!.houseId).toBe(bidder.id);
    // Paid at the market's price and his margin, not the usual one.
    const usual = victuallerOf(letTheContract(world).world, ARMY)!.victuals!.pricePerThousand;
    expect(contract.victuals!.pricePerThousand).toBeLessThan(usual);
    expect(result.factProposals.some((fact) => fact.kind === "bid_won" && /best of/.test(fact.summary))).toBe(true);
    // Spent: the bid is retired once it has won.
    expect(standingBids(result.world, "army_bread")).toEqual([]);
    // A bid above the usual margin loses to the lot.
    const dear = putInABid(world, bidder, "army_bread", MARGIN_BPS + 500, null, world.elapsedStep);
    expect(victuallerOf(letTheContract(dear).world, ARMY)!.victuals!.houseId).toBe(plain);
  });

  it("is a bid the order templates read, and refused to a man with no firm", () => {
    const world = atWarWorld();
    const head = economyOf(world).houses.find((house) => house.status === "trading")!.headCharacterId;
    const clause = bidClause(world, head, "Bid for the army's bread at 8 percent over cost");
    expect(clause?.deltas[0]?.op).toBe("generic_entity_create");
    expect(clause?.note).toMatch(/8 in the hundred/);
    const nobody = world.characters.find((character) => character.polityId === "rome" && !economyOf(world).houses.some((house) => house.headCharacterId === character.id))!;
    expect(bidClause(world, nobody.id, "Bid for the army's bread")?.part.whyNot).toMatch(/no firm/);
    expect(bidClause(world, head, "Take the contract for the temple")?.deltas[0]?.op).toBe("generic_entity_create");
  });
});
