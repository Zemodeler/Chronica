import { describe, expect, it, vi } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * E1: a step of the burst's own bookkeeping that writes what will not load.
 *
 * The plan-step slip with no limit was one such step; there will be others.
 * Here the step that settles overdue plans is made to write a step slipped
 * nine times -- past what its schema holds -- and the burst must hand back a
 * world that loads, with the path it refused kept with the burst.
 */
vi.mock("./plans", async (original) => {
  const actual = await original<typeof import("./plans")>();
  return {
    ...actual,
    settleOverdueSteps: (world: WorldState) => ({
      world: {
        ...world,
        characters: world.characters.map((character, index) => index !== 0 ? character : {
          ...character,
          ambitions: [{
            id: "ambition-broken", label: "Something", kind: "office" as const, targetId: null, status: "active" as const,
            steps: [{ id: "step-broken", act: "Something", dueDay: 1, laidOnDay: 0, waitsOn: null, armedReading: null, status: "pending" as const, wokenOnDay: 0, settledOnDay: null, slips: 9 }],
          }],
        }),
      },
      facts: [],
      missed: 0,
      slipped: 1,
    }),
  };
});

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = { complete: () => Promise.resolve(JSON.stringify({ actors: [] })) };

describe("a step that writes what will not load", () => {
  it("is set aside, and the burst hands back a world that loads, saying where it broke", async () => {
    const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const result = await runSimulationBurst({
      world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "broken", gameId: "game-broken",
      actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: null, knownFacts: [], queue: [], port: silent, narratorSeeds: [], spanDays: 3,
    });
    expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
    expect(result.world.characters.some((character) => character.ambitions.some((ambition) => ambition.id === "ambition-broken"))).toBe(false);
    const refused = result.skipped.filter((entry) => entry.stage === "invariant" && entry.reason.startsWith("settling overdue plan steps"));
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0]!.reason).toMatch(/characters\.0\.ambitions\.0\.steps\.0\.slips/);
  });
});
