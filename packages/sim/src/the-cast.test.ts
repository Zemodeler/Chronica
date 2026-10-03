import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { reviewCast } from "./cast";
import { ensureConstitutions } from "./constitutions";
import type { SimModelPort } from "./ports";

/**
 * The standing cast (docs/plans/a-living-world.md §4): everybody runs on rules
 * until he matters to the player's story, and then the model plays him -- once
 * a burst, handed what he did lately and what lies open to him.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = () => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });

describe("the standing cast", { timeout: 120_000 }, () => {
  it("is the consul's colleague, the power across the strait, and the men in the Rhegium thread", () => {
    const cast = reviewCast(opening(), "gaius-genucius").cast.members;
    const ids = cast.map((member) => member.characterId);
    expect(ids).toContain("gnaeus-cornelius");
    expect(ids).toContain("hanno-carthage");
    // Never the player, and never more than the seats.
    expect(ids).not.toContain("gaius-genucius");
    expect(cast.length).toBeLessThanOrEqual(8);
    // The wider world has a voice: a seat held by a foreign ruler.
    expect(cast.some((member) => member.seat === "world")).toBe(true);
  });

  it("keeps a member through a quiet review, and lets him go only after his stay", () => {
    let world = reviewCast(opening(), "gaius-genucius");
    const hanno = () => world.cast.members.find((member) => member.characterId === "hanno-carthage");
    expect(hanno()?.reviews).toBe(0);
    // His thread closes: he matters less, but not at once out of the story.
    world = { ...world, storylines: world.storylines.map((storyline) => ({ ...storyline, phase: "closed" as const, closedAtStep: 0 })) };
    world = reviewCast(world, "gaius-genucius");
    expect(hanno()).toBeDefined();
  });

  it("is asked in the first burst, told why, and shown what lies open to it", async () => {
    const sections: string[] = [];
    const port: SimModelPort = {
      complete(operation, _system, user) {
        if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
        if (operation === "simulate_cognition") sections.push(user);
        return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
      },
    };
    const result = await runSimulationBurst({
      world: opening(), clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
      burstId: "cast", gameId: "the-cast", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: null, spanDays: 30, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    expect(result.world.cast.members.length).toBeGreaterThan(0);
    const all = sections.join("\n");
    expect(all).toContain("## Hanno of Carthage [hanno-carthage]");
    expect(all).toMatch(/one of the people who matter now/);
    // His standing look comes once a burst; he may be asked again for his
    // own business -- news that lands on him, a letter owed -- but not as cast.
    const hanno = sections.flatMap((section) => section.split(/^(?=## )/m)).filter((part) => part.startsWith("## Hanno of Carthage"));
    expect(hanno.filter((part) => part.includes("one of the people who matter now"))).toHaveLength(1);
  });
});
