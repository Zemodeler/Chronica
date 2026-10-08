import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ScenarioDefinitionSchema, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/** Libo never got the chance to stand: an election was called twenty days before and nothing told him. A man who may stand is told, by name, with the day and the words. */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };

describe("an election is called", () => {
  it("tells the player, when he is eligible, that he may stand", () => {
    const world: WorldState = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const started = runDeterministicTick({ world, toDay: 0, ids: createIdFactory("told-0"), warfare: definition.warfare, government, playerCharacterId: "gaius-genucius" }).world;
    const ended = runDeterministicTick({ world: started, toDay: 365, ids: createIdFactory("told-365"), warfare: definition.warfare, government, playerCharacterId: "gaius-genucius" });
    expect(ended.factProposals.filter((fact) => fact.kind === "election_called").length).toBeGreaterThan(0);
    // Whoever is told, is told he may stand and how; nobody is told who cannot.
    for (const fact of ended.factProposals.filter((candidate) => candidate.kind === "election_open_to_you")) {
      expect(fact.summary).toContain("you may stand");
      expect(fact.summary).toContain("I put my name forward for");
      expect(fact.knownToRefs?.some((ref) => ref.id === "gaius-genucius")).toBe(true);
    }
  });
});
