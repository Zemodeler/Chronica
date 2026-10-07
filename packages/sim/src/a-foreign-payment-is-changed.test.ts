import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  coinageOf,
  conversionBps,
  convertSilver,
  economyOf,
  faceAmount,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { auditMoney, unexplainedTotal } from "./money-audit";
import { createIdFactory } from "./ports";
import { opening } from "./trade-test-kit";

/**
 * A foreign payment is changed (phase E of the economy rework).
 *
 * Every balance is silver by weight, and a power's coin is what its mint makes
 * of it. A sum paid between two accounts in the same coinage moves whole,
 * exactly as it always did. Paid across a border into another coinage, it
 * passes the money-changers: the payee receives it less their fee and any
 * discount the payer's coin fetches against the payee's, and the difference
 * goes out of the books by the `abroad` door, so the audit still balances.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`change-${characterId}`),
  gameId: "game-change",
});
const apply = (world: WorldState, deltas: readonly unknown[], who = "gaius-genucius") => applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), as(who));
const balance = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === id)!.balance;
const pay = (from: string, to: string, amount: number) => ({ op: "money_transfer", fromAccountRef: from, toAccountRef: to, amount, reason: "A payment." });

describe("a foreign payment is changed", () => {
  it("knows whose coin an account holds: its owner's power's, unless it is told otherwise", () => {
    const world = opening();
    expect(coinageOf(world, "rome-treasury").id).toBe("roman_aes_and_silver");
    expect(coinageOf(world, "gaius-purse").id).toBe("roman_aes_and_silver");
    expect(coinageOf(world, "carthage-treasury").id).toBe("carthaginian_shekel");
    expect(coinageOf(world, "hanno-purse").id).toBe("carthaginian_shekel");
    expect(coinageOf(world, "syracuse-treasury").id).toBe("syracusan_silver");
    const told = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "gaius-purse" ? { ...account, coinageId: "attic_drachma" } : account)) } };
    expect(coinageOf(told, "gaius-purse").id).toBe("attic_drachma");
    // A world without coinages holds one silver everywhere, and no sum is ever changed.
    const plain: WorldState = { ...world, economy: { ...economyOf(world), coinages: [] } };
    expect(convertSilver(plain, "rome-treasury", "carthage-treasury", 1_000)).toEqual({ received: 1_000, cut: 0 });
  });

  it("passes a sum inside one coinage whole, in one line", () => {
    const world = opening();
    const before = world.material.transactions.length;
    const done = apply(world, [pay("rome-treasury", "gaius-purse", 1_000)]);
    expect(done.rejected).toEqual([]);
    expect(balance(done.world, "gaius-purse") - balance(world, "gaius-purse")).toBe(1_000);
    expect(balance(world, "rome-treasury") - balance(done.world, "rome-treasury")).toBe(1_000);
    const lines = done.world.material.transactions.slice(before);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amount: 1_000, sourceAccountId: "rome-treasury", destinationAccountId: "gaius-purse" });
    expect(auditMoney(world, done.world).doors.abroad.out).toBe(0);
  });

  it("changes a sum crossing into another coinage: the payee gets it less the cut, which leaves by the abroad door", () => {
    const world = opening();
    const before = world.material.transactions.length;
    const done = apply(world, [pay("rome-treasury", "carthage-treasury", 10_000)]);
    expect(done.rejected).toEqual([]);
    const sent = balance(world, "rome-treasury") - balance(done.world, "rome-treasury");
    const got = balance(done.world, "carthage-treasury") - balance(world, "carthage-treasury");
    expect(sent).toBe(10_000);
    // Two coins with no premium or discount: only the money-changer's fee, 1.5 in a hundred.
    expect(got).toBe(9_850);
    const lines = done.world.material.transactions.slice(before);
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.destinationAccountId === "carthage-treasury")!.amount).toBe(9_850);
    const cut = lines.find((line) => line.external === "abroad")!;
    expect(cut).toMatchObject({ amount: 150, sourceAccountId: "rome-treasury" });
    expect(cut.destinationAccountId).toBeUndefined();
    // Every drachma is accounted for: 9,850 moved and 150 went out through the door.
    const audit = auditMoney(world, done.world);
    expect(unexplainedTotal(audit)).toBe(0);
    expect(audit.internal).toBe(9_850);
    expect(audit.doors.abroad.out).toBe(150);
  });

  it("takes more of a coin that fetches less, and nothing extra from a coin that fetches more", () => {
    const world = opening();
    const withPremium = (romanBps: number): WorldState => ({
      ...world,
      economy: { ...economyOf(world), coinages: economyOf(world).coinages.map((coinage) => (coinage.id === "roman_aes_and_silver" ? { ...coinage, premiumBps: romanBps } : coinage)) },
    });
    const sent = (state: WorldState): number => balance(apply(state, [pay("rome-treasury", "carthage-treasury", 10_000)]).world, "carthage-treasury") - balance(state, "carthage-treasury");
    const cheap = sent(withPremium(-1_000));
    expect(cheap).toBeLessThan(9_850);
    // A discount of a tenth costs about a tenth: 10,000 x (0.9 / 1.0) x 0.985.
    expect(cheap).toBeGreaterThan(8_800);
    expect(cheap).toBeLessThan(8_900);
    // A coin at a premium does not make money for the one who sends it: never more than the fee comes off.
    expect(sent(withPremium(1_000))).toBe(9_850);
    expect(conversionBps(withPremium(1_000), "roman_aes_and_silver", "carthaginian_shekel")).toBe(9_850);
  });

  it("is the payee's coin that the face amount reads in: a sum is more of a light coin than of a heavy one", () => {
    const world = opening();
    const roman = coinageOf(world, "rome-treasury");
    const attic = coinageOf({ ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "gaius-purse" ? { ...account, coinageId: "attic_drachma" } : account)) } }, "gaius-purse");
    // 7,300 silver units are 10,000 of Rome's coin, which is lighter than the Attic drachma, and 7,300 of the Attic's.
    expect(faceAmount(7_300, roman)).toBe(10_000);
    expect(faceAmount(7_300, attic)).toBe(7_300);
  });

  it("changes a tribute paid from one power's chest to another's in the monthly pass, and the books balance", async () => {
    const { runDeterministicTick } = await import("./tick");
    const world = opening();
    const bound: WorldState = {
      ...world,
      elapsedStep: 30,
      material: {
        ...world.material,
        incomeSources: [...world.material.incomeSources, {
          id: "syracuse-tribute", kind: "tribute" as const, label: "Tribute of Syracuse", beneficiaryAccountId: "rome-treasury", originKind: "polity" as const, originId: "rome",
          counterpartyPolityId: "syracuse", amount: 40_000, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 10_000, active: true,
        }],
      },
    };
    const paid = runDeterministicTick({ world: bound, toDay: 30, ids: createIdFactory("tribute-change"), warfare: definition.warfare });
    const line = paid.world.material.transactions.find((transaction) => transaction.cause.id === "syracuse-tribute" && transaction.destinationAccountId === "rome-treasury")!;
    // Syracuse's coin into Rome's: 40,000 of it, less the changer's fee.
    expect(line.amount).toBe(39_400);
    const cut = paid.world.material.transactions.find((transaction) => transaction.cause.id === "syracuse-tribute" && transaction.external === "abroad")!;
    expect(cut.amount).toBe(600);
    expect(unexplainedTotal(auditMoney(bound, paid.world))).toBe(0);
  });
});
