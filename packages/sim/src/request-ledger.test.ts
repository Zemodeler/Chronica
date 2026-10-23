import { describe, expect, it } from "vitest";
import { AllowanceSpentError, createRequestLedger, meteredPort } from "./request-ledger";
import type { SimModelPort, SimOperation } from "./ports";

const echo: SimModelPort = { complete: () => Promise.resolve("{}") };

describe("the request allowance", () => {
  it("counts every request by operation, whichever path sent it", async () => {
    const ledger = createRequestLedger({ total: 10, reserveForOrder: 0, reserveForChronicle: 0 });
    const port = meteredPort(echo, ledger);
    await Promise.all([port.complete("simulate_cognition", "", ""), port.complete("simulate_cognition", "", ""), port.complete("repair_deltas", "", "")]);
    expect(ledger.counts()).toEqual({ simulate_cognition: 2, repair_deltas: 1 });
    expect(ledger.spent).toBe(3);
  });

  it("never lets ambient work spend what is kept for the order and the closing account", async () => {
    const ledger = createRequestLedger({ total: 6, reserveForOrder: 2, reserveForChronicle: 2 });
    const port = meteredPort(echo, ledger);
    await port.complete("simulate_cognition", "", "");
    await port.complete("simulate_cognition", "", "");
    await expect(port.complete("simulate_cognition", "", "")).rejects.toBeInstanceOf(AllowanceSpentError);
    // The order and the historian still have theirs.
    await port.complete("simulate_orchestrate", "", "");
    await port.complete("simulate_orchestrate", "", "");
    await port.complete("compose_chronicle", "", "");
    await port.complete("compose_chronicle", "", "");
    expect(ledger.spent).toBe(6);
  });

  it("lets the order and the historian use what the other left unspent, but never the other's reserve", async () => {
    const ledger = createRequestLedger({ total: 5, reserveForOrder: 2, reserveForChronicle: 2 });
    const port = meteredPort(echo, ledger);
    await port.complete("simulate_orchestrate", "", "");
    await port.complete("simulate_orchestrate", "", "");
    await port.complete("simulate_orchestrate", "", ""); // beyond its reserve: the one free slot
    await expect(port.complete("simulate_orchestrate", "", "")).rejects.toBeInstanceOf(AllowanceSpentError);
    expect(ledger.canSpend("compose_chronicle", 2)).toBe(true);
  });

  it("does not call the model for a request it refuses", async () => {
    const asked: SimOperation[] = [];
    const ledger = createRequestLedger({ total: 1, reserveForOrder: 0, reserveForChronicle: 0 });
    const port = meteredPort({ complete: (operation) => { asked.push(operation); return Promise.resolve("{}"); } }, ledger);
    await port.complete("simulate_cognition", "", "");
    await port.complete("simulate_cognition", "", "").catch(() => undefined);
    expect(asked).toHaveLength(1);
  });
});
