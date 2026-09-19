import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioClockSchema, WorldStateSchema, type MoneyTransaction, type WorldState } from "@chronica/shared";
import { closeTheBooks } from "./ledger";

// Day 0 is 1 March 264 BC, so the year turns 306 days later.
const clock = ScenarioClockSchema.parse({ epoch: { year: 264, month: 3, day: 1, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 });
const NEW_YEAR = 306;

const base = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

/**
 * A government with a treasury to close. The scenario's own accounts are all
 * private purses, and a purse is not a public account.
 */
function withTreasury(world: WorldState, balance: number, extra = 0): { world: WorldState; polityId: string; accountId: string; secondId: string } {
  const polityId = world.map.polities[0]!.id;
  const account = (id: string, amount: number) => ({
    id, owner: { kind: "polity" as const, id: polityId }, currencyId: world.material.currency.id,
    balance: amount, status: "active" as const, visibility: "polity" as const,
  });
  return {
    world: { ...world, material: { ...world.material, accounts: [...world.material.accounts, account("public-treasury", balance), account("war-chest", extra)] } },
    polityId,
    accountId: "public-treasury",
    secondId: "war-chest",
  };
}

function withLedger(world: WorldState, accountId: string, entries: readonly Partial<MoneyTransaction>[]): WorldState {
  return {
    ...world,
    material: {
      ...world.material,
      transactions: entries.map((entry, index) => ({
        id: `txn-${index}`,
        atStep: 100,
        kind: "tax" as const,
        amount: 100,
        destinationAccountId: accountId,
        cause: { kind: "other" as const, explanation: "test" },
        visibility: "polity" as const,
        ...entry,
      })) as MoneyTransaction[],
    },
  };
}

describe("closing the books", () => {
  it("says nothing while the year is still running", () => {
    const { world, polityId, accountId } = withTreasury(base(), 1_000);
    const entries = closeTheBooks({
      world: withLedger(world, accountId, [{}]),
      clock,
      from: { day: 0, minute: 0 },
      to: { day: 60, minute: 0 },
      polityId,
    });
    expect(entries).toEqual([]);
  });

  it("strikes the year's account when the calendar turns, with no historian and no model call", () => {
    const { world, polityId, accountId } = withTreasury(base(), 895);
    const closing = 895;

    const entries = closeTheBooks({
      world: withLedger(world, accountId, [
        { id: "a", atStep: 40, kind: "tax", amount: 300, destinationAccountId: accountId },
        { id: "b", atStep: 200, kind: "upkeep", amount: 200, sourceAccountId: accountId, destinationAccountId: undefined },
      ]),
      clock,
      from: { day: 0, minute: 0 },
      to: { day: NEW_YEAR + 5, minute: 0 },
      polityId,
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.kind).toBe("recorded");
    expect(entry.title).toContain("264 BC");
    expect(entry.title).toContain("Treasury Account");
    // Closed from the end that is certainly right: the balance the accounts
    // actually hold, with the opening derived from the year's flows.
    expect(entry.body).toContain(`Treasury at the close of the year: ${closing}`);
    expect(entry.body).toContain(`Treasury at the opening of the year: ${closing - 300 + 200}`);
    expect(entry.body).toContain("Received: 300");
    expect(entry.body).toContain("Paid out: 200");
    expect(entry.quote).toBeNull();
    expect(entry.factIds).toEqual([]);
  });

  it("does not count money moved between a government's own accounts", () => {
    const { world, polityId, accountId, secondId } = withTreasury(base(), 900, 100);
    const entries = closeTheBooks({
      world: withLedger(world, accountId, [{ id: "a", atStep: 40, kind: "transfer", amount: 500, sourceAccountId: accountId, destinationAccountId: secondId }]),
      clock,
      from: { day: 0, minute: 0 },
      to: { day: NEW_YEAR + 5, minute: 0 },
      polityId,
    });
    expect(entries).toEqual([]);
  });

  it("writes no entry for a year with nothing in the books", () => {
    const { world, polityId, accountId } = withTreasury(base(), 1_000);
    const entries = closeTheBooks({
      world: withLedger(world, accountId, []),
      clock,
      from: { day: 0, minute: 0 },
      to: { day: NEW_YEAR + 5, minute: 0 },
      polityId,
    });
    expect(entries).toEqual([]);
  });

  it("has no books to close for a player with no government", () => {
    expect(closeTheBooks({ world: base(), clock, from: { day: 0, minute: 0 }, to: { day: NEW_YEAR + 5, minute: 0 }, polityId: null })).toEqual([]);
  });
});
