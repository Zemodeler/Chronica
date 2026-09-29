import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { buildWorldSlice } from "./slice";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const { clock } = definition;
const { offices } = definition.government;

describe("which places a power with hundreds of small provinces is shown", () => {
  const COUNT = 300;
  /** Opaque ids whose alphabetical order says nothing about where anything is. */
  const idOf = (n: number): string => `it-${((n * 7919 + 13) % 100_003).toString(36).padStart(4, "0")}${n.toString(36)}`;
  const nameOf = (n: number): string => `Vicus ${["Alfa", "Beta", "Gamma", "Delta", "Omega"][n % 5]} ${n}`;

  function bigPolity(): { state: WorldState; ids: string[] } {
    const state = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const ids = Array.from({ length: COUNT }, (_, n) => idOf(n));
    const chain = ids.map((id, n) => ({
      id, name: nameOf(n), formerNames: [], terrainId: state.map.provinces[0]!.terrainId, settlements: [],
      controllerPolityId: "rome", controlFirmnessBps: 7000,
    }));
    const edges = ids.slice(1).map((id, n) => {
      const before = ids[n]!;
      return { from: before < id ? before : id, to: before < id ? id : before, crossing: "land" as const, distance: 10 };
    });
    state.map = {
      ...state.map,
      provinces: [...state.map.provinces.filter((province) => province.controllerPolityId !== "rome"), ...chain],
      edges: [...state.map.edges.filter((edge) => !ids.includes(edge.from) && !ids.includes(edge.to)), ...edges],
    };
    for (const force of state.material.forces) if (force.polityId === "rome") force.locationId = ids[0]!;
    return { state, ids };
  }
  const shown = (state: WorldState, orderText: string): string[] => buildWorldSlice({
    world: state, clock, offices, actorRef: { kind: "character", id: state.characters[0]!.id }, actorPolityId: "rome",
    orderText, facts: [], dueEvents: [], pendingEvents: [],
  }).provinces.map((province) => province.id);

  it("keeps the ground an army stands on, whatever its id sorts as", () => {
    const { state, ids } = bigPolity();
    const army = state.material.forces.find((force) => force.polityId === "rome")!;
    army.locationId = ids[COUNT - 1]!;
    const listed = shown(state, "Hold the line.");
    expect(listed).toHaveLength(40);
    expect(listed).toContain(ids[COUNT - 1]);
  });

  it("finds a province the order names by its name, or by its id", () => {
    const { state, ids } = bigPolity();
    expect(shown(state, `March on ${nameOf(171)} at once.`)).toContain(ids[171]);
    expect(shown(state, `Garrison ${ids[222]}.`)).toContain(ids[222]);
  });

  it("puts what is nearest the moment ahead of what is merely ours", () => {
    const { state, ids } = bigPolity();
    const listed = shown(state, `Garrison ${nameOf(150)}.`);
    expect(listed).toContain(ids[149]);
    expect(listed).toContain(ids[151]);
    expect(listed).not.toContain(ids[80]);
  });

  it("is the same list every time", () => {
    const { state } = bigPolity();
    expect(shown(state, "Hold.")).toEqual(shown(structuredClone(state), "Hold."));
  });
});
