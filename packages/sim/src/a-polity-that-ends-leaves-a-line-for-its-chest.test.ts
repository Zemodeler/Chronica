import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { auditMoney } from "./money-audit";
import { endPolity } from "./polity-end";

/**
 * A people that gives itself up to a victor hands over its chest, and the money audit is told so: the Bruttians' treasury went to Rome's in a three-year run of the war
 * sanity with no line to say why (two unexplained entries) once the Roman army marched into their country.
 */
describe("a polity that ends leaves a line for its chest", () => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

  it("moves the chest to the victor and writes it down, so that nothing is unexplained", () => {
    const before = world.material.accounts.find((account) => account.id === "bruttians-treasury")!.balance;
    expect(before).toBeGreaterThan(0);
    const ended = endPolity(world, "bruttians", "absorbed", "rome", 100);
    expect(ended.world.material.accounts.find((account) => account.id === "bruttians-treasury")!.balance).toBe(0);
    const line = ended.world.material.transactions.find((transaction) => transaction.sourceAccountId === "bruttians-treasury" && transaction.destinationAccountId === "rome-treasury");
    expect(line).toMatchObject({ kind: "spoils", amount: before });
    expect(auditMoney(world, ended.world).unexplained).toEqual([]);
  });

  it("writes nothing where there is no victor", () => {
    const ended = endPolity(world, "bruttians", "extinct", null, 100);
    expect(ended.world.material.transactions.some((transaction) => transaction.sourceAccountId === "bruttians-treasury")).toBe(false);
  });
});
