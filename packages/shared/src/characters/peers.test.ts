import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import type { WorldState } from "../world/world-state";
import { peersOf } from "./peers";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("the mirror among your peers", () => {
  it("sets a consul among the consuls, sitting and former", () => {
    const peers = peersOf(world(), "gaius-genucius", offices)!;
    expect(peers.among).toMatch(/consuls, sitting and former/i);
    expect(peers.count).toBeGreaterThan(0);
    expect(peers.lines.map((line) => line.aspect)).toContain("Renown");
  });

  it("never reads what is in anybody's purse", () => {
    const peers = peersOf(world(), "gaius-genucius", offices)!;
    expect(peers.lines.map((line) => line.aspect)).not.toContain("Wealth");
  });

  it("has no peers for a man who never held anything", () => {
    const state = world();
    const model = state.characters.find((character) => character.id === "gaius-genucius")!;
    const nobody = WorldStateSchema.parse({ ...state, characters: [...state.characters, { ...model, id: "nobody", name: "Nobody", officeId: null, officesHeld: [] }] });
    expect(peersOf(nobody, "nobody", offices)).toBeNull();
  });
});
