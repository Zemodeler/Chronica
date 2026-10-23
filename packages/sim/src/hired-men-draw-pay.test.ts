import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

describe("men hired to an army", () => {
  it("draw wages: the army's pay obligation grows with them (hand run 2026-10-22, M1)", () => {
    const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const pay = (w: typeof world) => w.material.obligations.find((obligation) => obligation.id === "syracuse-army-pay")!.amount;
    const hire = WorldDeltaSchema.parse({ op: "force_reinforce", forceRef: "syracusan-army", categoryId: "infantry", label: "Hired mercenary footmen", men: 3_000, fromForceRef: null, reason: "hire" });
    const result = applyDeltas(world, [hire], { now: { day: 0, minute: 0 }, actorRef: { kind: "character", id: "hieron-ii" }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("hire"), gameId: "g" } as never);
    expect(result.rejected).toEqual([]);
    expect(pay(result.world)).toBeGreaterThan(pay(world));
  });
});
