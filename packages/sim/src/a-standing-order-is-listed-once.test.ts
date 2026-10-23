import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { OrderPartSchema, WorldStateSchema, readStandingOrders, type WorldState } from "@chronica/shared";

const ACTOR = "gaius-genucius";

const held = (id: string, status: "waiting" | "resumed" | "failed") => ({
  id, actorCharacterId: ACTOR, text: "If he refuses, declare war and lay siege.", givenAtStep: 0,
  parts: [OrderPartSchema.parse({
    said: "Lay siege to Rhegium",
    stages: [{ held: { op: "force_modify", forceRef: "roman-field-army", hold: true, reason: "Siege." }, waitsOn: [{ kind: "force_at", forceId: "roman-field-army", provinceId: "rhegium-coast" }], status, reason: null }],
  })],
});

describe("a standing order recorded twice", () => {
  it("is one line in the Council, the newest record's", () => {
    const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const world: WorldState = { ...base, orders: [held("order-a", "failed"), held("order-b", "failed")] };
    const rows = readStandingOrders(world, ACTOR).rows.filter((row) => row.kind === "held");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toContain("order-b");
  });

  it("keeps two lines that differ in where they stand", () => {
    const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const world: WorldState = { ...base, orders: [held("order-a", "waiting"), held("order-b", "failed")] };
    expect(readStandingOrders(world, ACTOR).rows.filter((row) => row.kind === "held")).toHaveLength(2);
  });
});
