import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * "I make a business deal and start selling cutlery in the streets of Rome."
 *
 * The order names no purse and no province, and it should not have to: a man
 * doing something for himself pays for it from his own money, where he is.
 * The model, writing it down, has to put an account id and a province id in
 * the delta, and every wrong guess was an act refused as unreadable -- a
 * refusal the player is never told about, so the order simply did less than
 * it said. Now the engine answers those two questions itself, says that it
 * did, and still refuses to guess anything that is the order's substance.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const SYRACUSE = PUNIC_IDS.syracuse;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const as = (characterId: string, extra: Partial<ApplyContext> = {}): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`fill-${characterId}`),
  gameId: "game-1",
  ...extra,
});
const parse = (delta: unknown): WorldDelta => WorldDeltaSchema.parse(delta);
const balance = (world: WorldState, accountId: string) => world.material.accounts.find((account) => account.id === accountId)!.balance;

const STALL = parse({
  op: "trade_venture_open", localId: "the_stall", title: "Cutlery in the streets", ownerCharacterRef: "leptines-syracuse",
  fromProvinceId: "the-city-streets", toProvinceId: "the-city-streets", band: "slight", paidFromAccountRef: "leptines-savings",
  reason: "He strikes a bargain with a smith and sells knives in the market.",
});

describe("nobody says which purse", () => {
  it("pays from the actor's own purse, where he stands, when the answer names neither", () => {
    const world = opening();
    const result = applyDeltas(world, [STALL], as("leptines-syracuse"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    const venture = result.world.material.ventures[0]!;
    expect(venture.fromProvinceId).toBe(SYRACUSE);
    expect(venture.toProvinceId).toBe(SYRACUSE);
    expect(balance(result.world, "leptines-purse")).toBeLessThan(balance(world, "leptines-purse"));
    // And says so, for the audit.
    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions[0]!.assumed.join(" ")).toContain("leptines-purse");
  });

  it("takes the public's money to mean the treasury -- and a private man spending it still breaches", () => {
    const grant = parse({
      op: "holding_create", localId: "the_farm", title: "A farm", provinceId: SYRACUSE, holderCharacterRef: "leptines-syracuse",
      band: "slight", priceFromAccountRef: "the-state-treasury", reason: "He buys a farm with the city's money.",
    });
    const king = applyDeltas(opening(), [grant], as("hieron-ii"));
    expect(king.rejected).toEqual([]);
    expect(king.assumptions[0]!.assumed.join(" ")).toContain("syracuse-treasury");

    const merchant = applyDeltas(opening(), [grant], as("leptines-syracuse"));
    expect(merchant.assumptions[0]!.assumed.join(" ")).toContain("syracuse-treasury");
    expect(merchant.rejected.length + merchant.breaches.length).toBeGreaterThan(0);
  });

  it("never fills a null: land with no price is a grant, and stays one", () => {
    const grant = parse({
      op: "holding_create", localId: "the_grant", title: "Public land", provinceId: SYRACUSE, holderCharacterRef: "leptines-syracuse",
      band: "slight", priceFromAccountRef: null, reason: "The king grants him land.",
    });
    const result = applyDeltas(opening(), [grant], as("hieron-ii"));
    expect(result.assumptions).toEqual([]);
  });

  it("never invents who receives money: his own paid to no account there is, is spent", () => {
    const world = opening();
    const payment = parse({
      op: "money_transfer", fromAccountRef: "leptines-purse", toAccountRef: "the-smith-he-dealt-with", amount: 10, reason: "He pays the smith.",
    });
    const result = applyDeltas(world, [payment], as("leptines-syracuse"));
    expect(result.rejected).toEqual([]);
    expect(balance(result.world, "leptines-purse")).toBe(balance(world, "leptines-purse") - 10);
    expect(result.world.material.accounts).toHaveLength(world.material.accounts.length);
    // Somebody else's money paid nowhere is still refused: it is not his to spend into the air.
    const theirs = parse({ ...payment, fromAccountRef: "syracuse-treasury" });
    expect(applyDeltas(world, [theirs], as("leptines-syracuse")).assumptions).toEqual([]);
  });

  it("answers only for the actor: the world speaking for everybody is not him paying for it", () => {
    const world = opening();
    const result = applyDeltas(world, [STALL], as("leptines-syracuse", { actsForTheWorld: true, orderDeltas: new Set() }));
    expect(result.rejected).toHaveLength(1);
    expect(result.assumptions).toEqual([]);
    // Unless it is the order itself, which is his.
    const order = applyDeltas(world, [STALL], as("leptines-syracuse", { actsForTheWorld: true, orderDeltas: new Set([STALL]) }));
    expect(order.rejected).toEqual([]);
  });
});
