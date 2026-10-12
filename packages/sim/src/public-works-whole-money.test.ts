import { describe, expect, it } from "vitest";
import { economyOf, WorldStateSchema, type WorldState } from "@chronica/shared";
import { opening, withChest } from "./fiscal-test-kit";
import { keepTheState } from "./keeping-the-state";
import { auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";

describe("public works keep whole monetary units", () => {
  it.each([null, "house-publicani-rome"])("posts an affordable whole instalment with contractor %s", (houseId) => {
    const start = withChest(opening(120), "rome", 11);
    const source = start.material.incomeSources.find((candidate) => candidate.beneficiaryAccountId === "rome-treasury")!;
    const world: WorldState = {
      ...start,
      material: {
        ...start.material,
        obligations: start.material.obligations.map((obligation) => ({ ...obligation, active: false })),
        incomeSources: start.material.incomeSources.map((candidate) => candidate.id === source.id
          ? { ...candidate, amount: 3, cadenceSteps: 30, collectionRateBps: 10_000 }
          : { ...candidate, active: false }),
      },
      economy: {
        ...economyOf(start),
        works: [{
          projectId: "works:road:whole-money", polityId: "rome", name: "A road at Rome", kind: "road",
          provinceId: start.map.provinces.find((province) => province.controllerPolityId === "rome")!.id,
          houseId, price: 100, cost: 100, instalments: 6, letAtStep: 120, completesAtStep: 300,
          paid: 0, spent: 0, built: false,
        }],
      },
    };
    const done = keepTheState({ world, toDay: 120, ids: createIdFactory("whole-money") }).world;
    const contract = economyOf(done).works.find((candidate) => candidate.projectId === "works:road:whole-money")!;
    expect(contract.paid).toBe(9);
    expect(done.material.accounts.find((account) => account.id === "rome-treasury")!.balance).toBe(2);
    expect(done.material.accounts.every((account) => Number.isInteger(account.balance))).toBe(true);
    expect(done.material.transactions.every((transaction) => Number.isInteger(transaction.amount))).toBe(true);
    const parsed = WorldStateSchema.safeParse(done);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(auditMoney(world, done).unexplained).toEqual([]);
  });
});
