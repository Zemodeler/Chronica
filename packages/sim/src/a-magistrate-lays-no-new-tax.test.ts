import { describe, expect, it } from "vitest";
import { economyOf, type WorldState } from "@chronica/shared";
import { act, atDay, holdersOf, opening, rateOf } from "./competence-test-kit";

/**
 * No single magistrate lays a new tax (Polybius 6.13-14; docs/plans/government.md, "Proposed competence tables": `tax_rate`).
 *
 * A rate within custom is a magistrate's: the consuls, as colleagues, lay it. A new tax -- the land levy turned into a tithe, a tribute of men into coin -- is the
 * Senate's decree whatever the rate, and so is any rate past custom. The same act in a kingdom no chamber holds the taxes of is the king's alone.
 */

const set = (polityId: string, regime: string, rateBps: number) => ({ op: "tax_policy_set", scope: "polity", polityId, provinceId: null, regime, rateBps, reason: "The tribute is laid." });
const regimeOf = (world: WorldState, polityId: string) => economyOf(world).taxPolicies.find((policy) => policy.polityId === polityId)?.regime;

describe("a magistrate lays no new tax", () => {
  it("lets a consul lay the rate Rome already pays, within custom, and not turn the levy into a tithe", () => {
    const world = opening();
    const consul = holdersOf(world, "roman-consul")[0]!;
    expect(regimeOf(world, "rome")).toBe("land_levy");
    expect(act(world, consul, set("rome", "land_levy", 1_100)).rejected).toEqual([]);
    // A tithe at the very same rate is a new tax.
    const tithe = act(world, consul, set("rome", "tithe", 1_000));
    expect(tithe.applied).toHaveLength(0);
    expect(tithe.rejected[0]!.reason).toMatch(/Senate/);
    expect(regimeOf(tithe.world, "rome")).toBe("land_levy");
    // Ordered, it is moved in the Senate and waits on the vote, under words that say what it is.
    const laid = act(world, consul, set("rome", "tithe", 1_000), { order: true });
    expect(laid.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate" });
    expect(laid.world.material.politicalProcedures.at(-1)!.label).toMatch(/that the tribute of Roman Republic be laid anew, as a tithe at 10 in a hundred$/);
  });

  it("does not let a quaestor do it either", () => {
    const world = opening();
    const quaestor = holdersOf(world, "roman-quaestor")[0]!;
    const refused = act(world, quaestor, set("rome", "tithe", 900));
    expect(refused.applied).toHaveLength(0);
    expect(refused.rejected[0]!.reason).toMatch(/Senate/);
  });

  it("leaves a king the laying of any tax, new or not", () => {
    const world = atDay(opening(), 220);
    const king = holdersOf(world, "syracusan-king")[0]!;
    expect(regimeOf(world, "syracuse")).toBe("tithe");
    const done = act(world, king, set("syracuse", "land_levy", 1_500));
    expect(done.rejected).toEqual([]);
    expect(regimeOf(done.world, "syracuse")).toBe("land_levy");
    expect(rateOf(done.world, "syracuse")).toBe(1_500);
  });
});
