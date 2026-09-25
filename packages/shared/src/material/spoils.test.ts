import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../index";
import { chestOf, sackTheProvince, takeTheChest, untouchedWorthOf, worthOf } from "./spoils";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const balance = (state: WorldState, id: string) => state.material.accounts.find((account) => account.id === id)!.balance;

/** Messana: where the Mamertine garrison stands, and what the scenario is about. */
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";

const sack = (state: WorldState, over: Partial<Parameters<typeof sackTheProvince>[1]> = {}) =>
  sackTheProvince(state, {
    provinceId: MESSANA, takerPolityId: "rome", takingForceId: "roman-field-army",
    atStep: 100, cause: { kind: "action", id: "order-1", explanation: "The taking of Messana" },
    transactionId: "txn-1", ...over,
  });

describe("what an army takes", () => {
  it("is worth something, derived from the place rather than authored", () => {
    expect(untouchedWorthOf(world(), MESSANA)).toBeGreaterThan(0);
    expect(untouchedWorthOf(world(), "no-such-province")).toBe(0);
  });

  it("goes into the taking army's own chest, not its government's", () => {
    const before = world();
    const chest = chestOf(before, "roman-field-army")!;
    const treasury = balance(before, "rome-treasury");
    const result = sack(before);

    expect(result.taken).toBeGreaterThan(0);
    expect(result.intoAccountId).toBe(chest);
    expect(balance(result.world, chest)).toBe(balance(before, chest) + result.taken);
    expect(balance(result.world, "rome-treasury")).toBe(treasury);
  });

  it("falls back to the power's treasury when the army has no chest", () => {
    const before = world();
    const stripped: WorldState = {
      ...before,
      material: { ...before.material, accounts: before.material.accounts.filter((a) => a.id !== "roman-field-army-chest") },
    };
    const result = sack(stripped);
    expect(result.intoAccountId).toBe("rome-treasury");
  });

  it("is recorded as spoils, which no code path could produce before", () => {
    const result = sack(world());
    const entry = result.world.material.transactions.find((transaction) => transaction.id === "txn-1")!;
    expect(entry.kind).toBe("spoils");
    expect(entry.amount).toBe(result.taken);
    expect(entry.sourceAccountId).toBeUndefined();
  });

  it("yields less the second time, because the first army took it", () => {
    const first = sack(world());
    const second = sack(first.world, { transactionId: "txn-2" });
    expect(second.taken).toBeGreaterThan(0);
    expect(second.taken).toBeLessThan(first.taken);
    expect(worthOf(second.world, MESSANA)).toBeLessThan(worthOf(first.world, MESSANA));
  });

  it("leaves the province the worse for it", () => {
    const before = world();
    const result = sack(before);
    const after = result.world.material.provinceMaterial.find((row) => row.provinceId === MESSANA)!;
    // `applyWarDamage` has been tested and uncalled since phase 2. This is its
    // first caller, and the province is what pays for the plunder.
    expect(after.warDamageBps).toBeGreaterThan(0);
    expect(after.stabilityBps).toBeLessThan(7_000);
    expect(after.displacedPopulation).toBeGreaterThan(0);
  });

  it("takes nothing from a power with nowhere to put it", () => {
    const before = world();
    const homeless: WorldState = {
      ...before,
      material: {
        ...before.material,
        accounts: before.material.accounts.filter((a) => a.id !== "roman-field-army-chest" && a.id !== "rome-treasury"),
        obligations: before.material.obligations.filter((o) => o.payerAccountId !== "rome-treasury"),
        incomeSources: before.material.incomeSources.filter((s) => s.beneficiaryAccountId !== "rome-treasury"),
      },
    };
    const result = sack(homeless);
    expect(result.taken).toBe(0);
    expect(result.world).toBe(homeless);
  });
});

describe("the chest of a beaten army", () => {
  const capture = (state: WorldState) => takeTheChest(state, {
    beatenForceId: "mamertine-garrison", victorForceId: "roman-field-army", victorPolityId: "rome",
    atStep: 100, cause: { kind: "battle_result", id: "battle-1", explanation: "Taken with the field." },
    transactionId: "txn-chest",
  });

  it("goes to whoever beat them, which is the risk in living off plunder", () => {
    const before = world();
    const lost = balance(before, "mamertine-garrison-chest");
    expect(lost).toBeGreaterThan(0);

    const result = capture(before);
    expect(result.taken).toBe(lost);
    expect(balance(result.world, "mamertine-garrison-chest")).toBe(0);
    expect(balance(result.world, "roman-field-army-chest")).toBe(balance(before, "roman-field-army-chest") + lost);
  });

  it("conserves the money rather than minting it", () => {
    const before = world();
    const total = (state: WorldState) => state.material.accounts.reduce((sum, account) => sum + account.balance, 0);
    expect(total(capture(before).world)).toBe(total(before));
  });

  it("takes nothing from an army whose chest is already empty", () => {
    const before = world();
    const empty: WorldState = {
      ...before,
      material: {
        ...before.material,
        accounts: before.material.accounts.map((a) => (a.id === "mamertine-garrison-chest" ? { ...a, balance: 0 } : a)),
      },
    };
    expect(capture(empty).taken).toBe(0);
  });
});
