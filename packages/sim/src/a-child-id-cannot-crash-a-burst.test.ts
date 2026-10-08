import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { LocalIdSchema, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";
import { safeLocalId } from "./safe-local-id";
import { decideVillainy } from "./villainy";

/**
 * A man born in the story has an id like `child:rome-kin-3ualq2:21`, and a
 * comrade `titus-vettius:comrade:4`. A local id built by pasting such an id
 * in used to fail the local-id rule and kill the whole burst (three hand runs).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** The player's own people, with a grown man of a strange id who hates him. */
function hatedWorld(): { world: WorldState; playerId: string; enemyId: string } {
  const world = { ...opening(), difficulty: "hard" as const };
  const player = world.characters.find((character) => character.id === "gaius-genucius")!;
  const donor = world.characters.find((character) => character.polityId === player.polityId && character.id !== player.id && character.alive)!;
  const enemyId = "titus-vettius:comrade:4";
  const enemy = {
    ...donor, id: enemyId, name: "Quintus Comrade", ageYearsAtStart: 30, birthStep: null,
    traits: ["ambitious", "cruel"], mind: { ...donor.mind, drives: { ...donor.mind.drives, revenge: 90, status: 90 }, temperament: { ...donor.mind.temperament, cruelty: 80, boldness: 80 } },
    relations: [{ subjectCharacterId: player.id, causes: [{ id: "hate", label: "A slight.", score: -80, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -80 } }] }],
    locationProvinceId: player.locationProvinceId,
  };
  return { world: { ...world, characters: [...world.characters, enemy] }, playerId: player.id, enemyId };
}

describe("a strange id", () => {
  it("is mended into a valid local id, and a valid one is left alone", () => {
    for (const raw of ["defamer_child:rome-kin-3ualq2:21_30", "Vendetta_TITUS:comrade:4", `x_${"long".repeat(30)}`, "march_roman-field-army"]) {
      expect(LocalIdSchema.safeParse(safeLocalId(raw)).success).toBe(true);
    }
    expect(safeLocalId("march_roman-field-army")).toBe("march_roman-field-army");
    expect(safeLocalId(`a${"b".repeat(80)}`)).not.toBe(safeLocalId(`a${"b".repeat(81)}`));
  });

  it("cannot kill the villainy of a month, whoever hates the player", () => {
    const { world, playerId, enemyId } = hatedWorld();
    let plotted = 0;
    for (let month = 0; month < 36; month += 1) {
      const decisions = decideVillainy({ world: { ...world, instant: { ...world.instant, day: month * 30 }, elapsedStep: month * 30 }, gameId: "child-id", playerCharacterId: playerId, playedByModel: new Set() });
      plotted += decisions.filter((decision) => decision.actorCharacterId === enemyId).length;
    }
    expect(plotted).toBeGreaterThan(0);
  });

  it("lets a burst of ninety days finish", { timeout: 60_000 }, async () => {
    const { world, playerId } = hatedWorld();
    const port: SimModelPort = { complete: (operation) => Promise.resolve(operation === "simulate_orchestrate" ? JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "He waits.", deltas: [], facts: [], outcome: "continue" }) : "{}") };
    const result = await runSimulationBurst({
      world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "child-id", gameId: "child-id", actorRef: { kind: "character", id: playerId }, actorPolityId: "rome",
      orderText: "Wait.", spanDays: 90, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    expect(result.world.instant.day).toBeGreaterThanOrEqual(90);
  });
});
