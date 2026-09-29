import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ledger, faked at the seam the gate calls it through.
 *
 * A live turn once ended with "You have run out of coins" in front of a
 * wallet holding three coins: the database had broken a deadlock by killing
 * the hold's transaction, and the gate called every failure to reserve coins
 * a shortfall. These pin the two things that fix stays honest about.
 */
const ledger = vi.hoisted(() => ({
  authorizeCoinHold: vi.fn(),
  settleCoinHold: vi.fn(),
  releaseCoinHold: vi.fn(),
  getCoinWalletSnapshot: vi.fn(),
}));

vi.mock("@chronica/db", () => ({
  ...ledger,
  CoinHoldRefusedError: class CoinHoldRefusedError extends Error {
    constructor(readonly reason: string) { super(reason); this.name = "CoinHoldRefusedError"; }
  },
}));

import { CoinHoldRefusedError } from "@chronica/db";
import { callWithCoinGate } from "./coin-gate";
import type { AiAdapter } from "./adapter";

const call = vi.fn(() => Promise.resolve({ content: "{}", model: "gpt-6-luna", inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }));
const adapter = { call } as unknown as AiAdapter;

const db = {} as never;
const gate = () => callWithCoinGate(db, "user", "game", "simulate_cognition", adapter, { system: "", user: "" });

beforeEach(() => {
  vi.clearAllMocks();
  ledger.getCoinWalletSnapshot.mockResolvedValue({ availableMicroUnits: 3_000_000n });
  ledger.authorizeCoinHold.mockResolvedValue({ holdId: "hold-1" });
  ledger.settleCoinHold.mockResolvedValue(undefined);
  ledger.releaseCoinHold.mockResolvedValue(undefined);
});

describe("reserving coins", () => {
  it("calls a refusal by the ledger running out of coins", async () => {
    ledger.authorizeCoinHold.mockRejectedValue(new CoinHoldRefusedError("insufficient_coins"));
    await expect(gate()).rejects.toMatchObject({ name: "InsufficientCoinsError" });
  });

  it("does not call a broken transaction running out of coins", async () => {
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    ledger.authorizeCoinHold.mockRejectedValue(deadlock);
    await expect(gate()).rejects.toBe(deadlock);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("settling a hold", () => {
  it("gives the coins back when the settlement itself fails", async () => {
    const failure = new Error("Coin hold cannot settle this call.");
    ledger.settleCoinHold.mockRejectedValue(failure);
    await expect(gate()).rejects.toBe(failure);
    expect(ledger.releaseCoinHold).toHaveBeenCalledWith(db, "hold-1");
  });

  it("charges the hold, and leaves it settled, when it succeeds", async () => {
    await expect(gate()).resolves.toMatchObject({ model: "gpt-6-luna" });
    expect(ledger.settleCoinHold).toHaveBeenCalledOnce();
    expect(ledger.releaseCoinHold).not.toHaveBeenCalled();
  });
});

describe("a free adapter", () => {
  it("is let through without touching the wallet or reserving anything", async () => {
    const free = { free: true, call, callWithTools: () => Promise.reject(new Error("unused")) } as unknown as AiAdapter;
    await expect(callWithCoinGate(db, "user", "game", "simulate_cognition", free, { system: "", user: "" })).resolves.toMatchObject({ model: "gpt-6-luna" });
    expect(ledger.getCoinWalletSnapshot).not.toHaveBeenCalled();
    expect(ledger.authorizeCoinHold).not.toHaveBeenCalled();
    expect(ledger.settleCoinHold).not.toHaveBeenCalled();
  });
});
