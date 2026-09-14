import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { ensurePolityTreasuries, polityTreasuryId } from "./treasury-bootstrap";

const world = (): WorldState => structuredClone(firstPunicWarScenario.initialWorld);

describe("ensurePolityTreasuries (docs/plans/ai-world-matters-runtime.md, \"Polity treasuries\")", () => {
  it("opens a zero-balance treasury for every polity that lacks one", () => {
    const w = world();
    expect(w.material.accounts.some((a) => a.owner.kind === "polity")).toBe(false);
    const result = ensurePolityTreasuries(w, 1);
    for (const polity of w.map.polities) {
      const treasury = result.material.accounts.find((a) => a.owner.kind === "polity" && a.owner.id === polity.id);
      expect(treasury).toBeDefined();
      expect(treasury?.balance).toBe(0);
      expect(treasury?.status).toBe("active");
      expect(treasury?.id).toBe(polityTreasuryId(polity.id));
    }
  });

  it("emits no FactualEvent -- this is setup bookkeeping, not history", () => {
    const w = world();
    const result = ensurePolityTreasuries(w, 1);
    // ensurePolityTreasuries returns only a WorldState, with no events
    // channel at all -- there is no way for this call to produce a fact.
    expect(result).not.toHaveProperty("events");
  });

  it("is idempotent: a polity that already has a treasury is untouched, and a second call adds nothing", () => {
    const w = world();
    const once = ensurePolityTreasuries(w, 1);
    const twice = ensurePolityTreasuries(once, 2);
    expect(twice.material.accounts).toEqual(once.material.accounts);
  });

  it("leaves an existing, differently-named polity account alone rather than opening a second one", () => {
    const w = world();
    const polityId = w.map.polities[0]!.id;
    const withCustomTreasury: WorldState = {
      ...w,
      material: {
        ...w.material,
        accounts: [
          ...w.material.accounts,
          { id: "custom-treasury-id", owner: { kind: "polity" as const, id: polityId }, currencyId: w.material.currency.id, balance: 500, status: "active" as const, visibility: "polity" as const },
        ],
      },
    };
    const result = ensurePolityTreasuries(withCustomTreasury, 1);
    const treasuriesForPolity = result.material.accounts.filter((a) => a.owner.kind === "polity" && a.owner.id === polityId);
    expect(treasuriesForPolity).toHaveLength(1);
    expect(treasuriesForPolity[0]?.id).toBe("custom-treasury-id");
    expect(treasuriesForPolity[0]?.balance).toBe(500);
  });
});
