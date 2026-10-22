import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Fact } from "@chronica/shared";
import { factsForPlayer } from "./report-facts";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const fact = (id: string, entity: { kind: string; id: string }): Fact => ({ id, time: { day: 1, minute: 0 }, atStep: 1, kind: "x", summary: id, affectedEntities: [entity], resourceChanges: [], visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] } } as unknown as Fact);

describe("the facts a report leads with", () => {
  it("puts what touches the player's own side before heavier news of other powers", () => {
    const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const election = fact("election-abroad", { kind: "polity", id: "samnites" });
    const treaty = fact("our-treaty", { kind: "polity", id: "carthage" });
    const ranked = factsForPlayer([election, treaty], new Map([["election-abroad", 60], ["our-treaty", 40]]), world, "hannibal-gisco", "carthage", definition.government.offices);
    expect(ranked.map((entry) => entry.id)).toEqual(["our-treaty", "election-abroad"]);
  });
});
