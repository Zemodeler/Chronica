import { describe, expect, it } from "vitest";
import type { MaterialWorldState, MoneyAccount } from "../material-state";
import { availableBalance, openReservation, releaseMoneyReservation, spendFromReservation } from "./money-reservations";

function account(overrides: Partial<MoneyAccount> = {}): MoneyAccount {
  return { id: "acct-1", owner: { kind: "polity", id: "rome" }, currencyId: "denarii", balance: 1000, status: "active", visibility: "public", ...overrides };
}

function material(overrides: Partial<Pick<MaterialWorldState, "accounts" | "reservations">> = {}): Pick<MaterialWorldState, "accounts" | "reservations"> {
  return { accounts: [account()], reservations: [], ...overrides };
}

describe("availableBalance (docs/32, Part C.3)", () => {
  it("equals the raw balance when nothing is reserved", () => {
    expect(availableBalance(material(), "acct-1")).toBe(1000);
  });

  it("excludes an active reservation's remaining amount", () => {
    const reservation = openReservation(material(), { id: "r1", accountId: "acct-1", currencyId: "denarii", amount: 400, purposeId: "academy", atStep: 1 });
    expect(reservation).not.toBeNull();
    const state = material({ reservations: reservation ? [reservation] : [] });
    expect(availableBalance(state, "acct-1")).toBe(600);
  });

  it("ignores a released or spent reservation", () => {
    const reservation = openReservation(material(), { id: "r1", accountId: "acct-1", currencyId: "denarii", amount: 400, purposeId: "academy", atStep: 1 });
    const released = releaseMoneyReservation(reservation!, 5);
    const state = material({ reservations: [released] });
    expect(availableBalance(state, "acct-1")).toBe(1000);
  });

  it("returns 0 for an unknown account", () => {
    expect(availableBalance(material(), "no-such-account")).toBe(0);
  });
});

describe("openReservation", () => {
  it("refuses to reserve more than is currently available", () => {
    const reservation = openReservation(material(), { id: "r1", accountId: "acct-1", currencyId: "denarii", amount: 5000, purposeId: "fortress", atStep: 1 });
    expect(reservation).toBeNull();
  });

  it("stacks reservations against the same account down to zero available", () => {
    const first = openReservation(material(), { id: "r1", accountId: "acct-1", currencyId: "denarii", amount: 1000, purposeId: "a", atStep: 1 })!;
    const second = openReservation(material({ reservations: [first] }), { id: "r2", accountId: "acct-1", currencyId: "denarii", amount: 1, purposeId: "b", atStep: 1 });
    expect(second).toBeNull();
  });
});

describe("spendFromReservation", () => {
  it("draws down remainingAmount without closing while balance remains", () => {
    const reservation = openReservation(material(), { id: "r1", accountId: "acct-1", currencyId: "denarii", amount: 400, purposeId: "academy", atStep: 1 })!;
    const after = spendFromReservation(reservation, 150, 3);
    expect(after.remainingAmount).toBe(250);
    expect(after.status).toBe("active");
  });

  it("closes as spent once the last milestone draws it to zero", () => {
    const reservation = openReservation(material(), { id: "r1", accountId: "acct-1", currencyId: "denarii", amount: 400, purposeId: "academy", atStep: 1 })!;
    const after = spendFromReservation(reservation, 400, 3);
    expect(after.remainingAmount).toBe(0);
    expect(after.status).toBe("spent");
    expect(after.closedAtStep).toBe(3);
  });

  it("throws when spending from a reservation that already closed", () => {
    const reservation = openReservation(material(), { id: "r1", accountId: "acct-1", currencyId: "denarii", amount: 400, purposeId: "academy", atStep: 1 })!;
    const released = releaseMoneyReservation(reservation, 5);
    expect(() => spendFromReservation(released, 1, 6)).toThrow();
  });
});
