import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, atWar, ensureProvinceMaterial, openPeaceTable, openWar, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { ensureConstitutions } from "./constitutions";
import { acceptDemands, bribeAtTable, putTerms, termsPrice, willBear } from "./peace-table";
import { createIdFactory } from "./ports";

/**
 * The peace table (docs/plans/a-living-world.md §8), after Hearts of Iron IV:
 * a letter asking to talk seats two powers at a table, each side's war is
 * what it can ask for, every term has a price, and the side that is asked
 * answers by rule.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const context = { now: { day: 200, minute: 540 }, offices, warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("table"), gameId: "game-table" };

/** Syracuse and Carthage at war, Syracuse holding three Carthaginian districts of Sicily. */
function atTheTable(): { world: WorldState; tableId: string; held: string[] } {
  const opened = ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });
  const warred = { ...opened, polityAgreements: openWar(opened.polityAgreements, { id: "war-syracuse-carthage", polityId: "syracuse", otherPolityId: "carthage", terms: "War.", atStep: 10, sourceMessageId: null, reason: "Test." }) };
  const held = warred.map.provinces.filter((province) => province.controllerPolityId === "carthage" && province.id.startsWith("sic-") && province.settlements.length === 0).slice(0, 3).map((province) => province.id);
  const occupied: WorldState = {
    ...warred,
    instant: { ...warred.instant, day: 200 }, elapsedStep: 200,
    map: { ...warred.map, provinces: warred.map.provinces.map((province) => (held.includes(province.id) ? { ...province, controllerPolityId: "syracuse", ownerPolityId: "carthage", lostBy: { polityId: "carthage", atStep: 100 } } : province)) },
  };
  const letter = { id: "message-talks", kind: "peace_talks", fromPolityId: "syracuse", toPolityId: "carthage" } as DiplomaticMessage;
  const world = openPeaceTable(occupied, letter, 200);
  return { world, tableId: world.peaceTables[0]!.id, held };
}

describe("the peace table", () => {
  it("is seated by an accepted letter, once per war", () => {
    const { world } = atTheTable();
    expect(world.peaceTables).toHaveLength(1);
    expect(world.peaceTables[0]!.sides).toEqual(["syracuse", "carthage"]);
    const again = openPeaceTable(world, { id: "message-again", kind: "peace_talks", fromPolityId: "carthage", toPolityId: "syracuse" } as DiplomaticMessage, 210);
    expect(again.peaceTables).toHaveLength(1);
  });

  it("prices occupied ground at half, and signs terms the other side can bear", () => {
    const { world, tableId, held } = atTheTable();
    const table = world.peaceTables[0]!;
    const one = [{ kind: "cede" as const, provinceId: held[0]! }];
    expect(termsPrice(world, one, "carthage", "syracuse")).toBeLessThanOrEqual(willBear(world, table, "carthage", offices) + 1_000);
    const hieron = "hieron-ii";
    // A whole kingdom's worth is more than a short war has cost Carthage.
    const dear = [...held.map((provinceId) => ({ kind: "cede" as const, provinceId })), { kind: "client" as const }, { kind: "tribute" as const }];
    const countered = putTerms(world, tableId, "syracuse", dear, context, offices, hieron);
    expect(["countered", "refused"]).toContain(countered.answer);
    const session = countered.world.peaceTables[0]!.sessions[0]!;
    expect(session.byPolityId).toBe("syracuse");
    // What they would sign is offered back, and costs no more than they bear.
    expect(termsPrice(countered.world, session.counterTerms ?? [], "carthage", "syracuse")).toBeLessThanOrEqual(willBear(countered.world, countered.world.peaceTables[0]!, "carthage", offices));
    // The next session sits after an envoy's journey.
    expect(putTerms(countered.world, tableId, "syracuse", one, context, offices, hieron).refusal).toMatch(/envoys are still on the road/);
  });

  it("walks out on a side that keeps asking far more than it will give", () => {
    const { world, tableId, held } = atTheTable();
    let state = world;
    let last = "";
    for (let session = 0; session < 3; session += 1) {
      state = { ...state, instant: { ...state.instant, day: 200 + 60 * session }, elapsedStep: 200 + 60 * session };
      const turn = putTerms(state, tableId, "syracuse", [{ kind: "submission" }, ...held.map((provinceId) => ({ kind: "cede" as const, provinceId }))], { ...context, now: state.instant }, offices, "hieron-ii");
      state = turn.world;
      last = turn.answer;
    }
    expect(last).toBe("walked_out");
    expect(state.peaceTables[0]!.status).toBe("walked_out");
  });

  it("signs the other side's demands when the player's power takes them", () => {
    const { world, tableId } = atTheTable();
    // Carthage, winning, asks Syracuse for an indemnity; Syracuse agrees.
    const demanded: WorldState = { ...world, peaceTables: world.peaceTables.map((table) => ({ ...table, sessions: [{ atStep: 200, byPolityId: "carthage", terms: [{ kind: "indemnity", amount: 50, periods: 2 }], price: 3, answer: null, words: null }] })) };
    const turn = acceptDemands(demanded, tableId, "syracuse", context, offices, "hieron-ii");
    expect(turn.answer).toBe("accepted");
    expect(atWar(turn.world.polityAgreements, "syracuse", "carthage")).toBe(false);
    expect(turn.world.peaceTables[0]!.status).toBe("signed");
  });

  it("lets a man with money buy a negotiator, or be shamed for trying", () => {
    const { world, tableId } = atTheTable();
    const hanno = world.characters.find((character) => character.id === "hanno-carthage")!;
    const rich: WorldState = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === world.characters.find((character) => character.id === "hieron-ii")!.personalAccountId ? { ...account, balance: 5_000 } : account)) } };
    const bribe = bribeAtTable(rich, tableId, "hieron-ii", hanno.id, 1_000);
    expect(["taken", "refused", "found_out"]).toContain(bribe.outcome);
    const entry = bribe.world.peaceTables[0]!.bribes[0]!;
    if (entry.outcome === "taken") expect(willBear(bribe.world, bribe.world.peaceTables[0]!, "carthage", offices)).toBeGreaterThan(willBear(rich, rich.peaceTables[0]!, "carthage", offices));
    if (entry.outcome !== "taken") expect(bribe.facts.some((fact) => fact.kind === "scandal")).toBe(true);
  });
});
