import { beforeEach, describe, expect, it, vi } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type Commitment, type WorldState } from "@chronica/shared";

/**
 * A four-hundred-character instruction, pasted into a grievance's label (two
 * hundred at most), made every tick after it write a world that would not
 * load; each was set aside without a word and the clock ran on. Now the words
 * are cut to fit, and a tick that really cannot hold stops the turn, loudly.
 */

const corrupt = vi.hoisted(() => ({ fromDay: Number.MAX_SAFE_INTEGER }));
vi.mock("./tick", async (importOriginal) => {
  const original = await importOriginal<typeof import("./tick")>();
  return {
    ...original,
    runDeterministicTick: (input: Parameters<typeof original.runDeterministicTick>[0]) => {
      const ticked = original.runDeterministicTick(input);
      return input.toDay < corrupt.fromDay ? ticked : { ...ticked, world: { ...ticked.world, elapsedStep: -5 } };
    },
  };
});

const { runSimulationBurst, DEFAULT_BUDGET } = await import("./burst");
const { keepPromises, GRACE_DAYS } = await import("./promises");
const { clipOverlong } = await import("./clip-overlong");

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const LONG = `${"Send grain to the legion at Rhegium and see that every man of it is fed, ".repeat(6)}`.slice(0, 400);

function promised(world: WorldState): WorldState {
  const commitment: Commitment = {
    id: "promise-hieron-grain", promisorCharacterId: "hieron-ii", beneficiaryCharacterId: "gaius-genucius", actionKind: "other", description: LONG, conditions: "",
    requiredOfficeId: null, requiredResource: null, visibility: "private", sourceEventId: null, breachPressureKind: "humiliation", status: "pending",
    createdAtStep: world.elapsedStep, reviewAtStep: world.elapsedStep + 10, resolvedAtStep: null, resolutionReason: null,
  };
  return { ...world, commitments: [...world.commitments, commitment] };
}

const quiet = { complete: (operation: string) => Promise.resolve(operation === "simulate_orchestrate" ? JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "He waits.", deltas: [], facts: [], outcome: "continue" }) : "{}") };
const burst = (world: WorldState) => runSimulationBurst({
  world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
  burstId: "long", gameId: "long", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
  orderText: "Wait.", spanDays: 90, knownFacts: [], queue: [], port: quiet, narratorSeeds: [], budget: DEFAULT_BUDGET,
});

describe("a long promise", { timeout: 60_000 }, () => {
  // What a player's game does with a step that breaks the world: sets it aside and goes on. Strict, it would stop.
  beforeEach(() => { vi.stubEnv("CHRONICA_STRICT", "0"); });
  it("breaks into a world that still loads", () => {
    const start = promised(opening());
    const early = keepPromises({ world: start, toDay: start.elapsedStep + 10, playerCharacterId: "gaius-genucius" });
    const broken = keepPromises({ world: early.world, toDay: start.elapsedStep + 10 + GRACE_DAYS, playerCharacterId: "gaius-genucius" });
    expect(broken.world.commitments.find((commitment) => commitment.id === "promise-hieron-grain")!.status).toBe("broken");
    const loads = WorldStateSchema.safeParse(broken.world);
    expect(loads.success ? null : loads.error.issues.slice(0, 3)).toBeNull();
  });

  it("is cut to fit wherever else it lands, not set aside", () => {
    const world = opening();
    const target = world.characters[0]!;
    const long = { ...world, characters: [{ ...target, relations: [{ subjectCharacterId: target.id, causes: [{ id: "x", label: LONG, score: -5, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: {} }] }], ...[] }, ...world.characters.slice(1)] };
    const mended = clipOverlong(long as WorldState);
    expect(mended).not.toBeNull();
    expect(WorldStateSchema.safeParse(mended!.world).success).toBe(true);
  });

  it("lets ninety days run with a 400-character delegation on the books", async () => {
    corrupt.fromDay = Number.MAX_SAFE_INTEGER;
    const result = await burst(promised(opening()));
    expect(result.stopReason).not.toBe("tick_failed");
    expect(result.world.instant.day).toBeGreaterThanOrEqual(90);
    expect(result.parseFailures.filter((line) => line.includes("would not load"))).toEqual([]);
  });

  it("stops the turn, loudly, at a tick that cannot be mended, and does not carry the clock past it", async () => {
    corrupt.fromDay = 30;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await burst(opening());
    spy.mockRestore();
    corrupt.fromDay = Number.MAX_SAFE_INTEGER;
    expect(result.stopReason).toBe("tick_failed");
    expect(result.world.instant.day).toBeLessThan(30);
    expect(result.parseFailures.some((line) => line.includes("would not load"))).toBe(true);
  });
});
