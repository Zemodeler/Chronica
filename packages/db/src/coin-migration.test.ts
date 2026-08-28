import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("coin denomination migration", () => {
  it("scales every persisted monetary owner by 1,000", () => {
    const sql = readFileSync(fileURLToPath(new URL("../migrations/0009_account_coin_wallet.sql", import.meta.url)), "utf8");
    for (const table of ["credit_wallets", "credit_lots", "credit_holds", "credit_ledger_entries", "gift_codes", "billing_products", "games", "scenario_versions"]) {
      expect(sql).toContain(`UPDATE "${table}" SET`);
    }
    expect(sql.match(/\* 1000/g)?.length).toBeGreaterThanOrEqual(8);
  });
});
