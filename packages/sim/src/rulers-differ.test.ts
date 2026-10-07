import { beforeAll, describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, type Character, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";
import { readBoard } from "./board";
import { appetiteOf, dispositionOf, leastOdds, peaceReluctance } from "./disposition";
import { bigMoveCandidates, type StatecraftInput } from "./statecraft";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    return Promise.resolve("{}");
  },
};

/** The opening world after one quiet month, which is when its governments and rulers exist. */
let seeded: WorldState;
const base = (): WorldState => seeded;
beforeAll(async () => {
  const result = await runSimulationBurst({
    world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
    clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: "seed", gameId: "rulers-differ", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  seeded = result.world;
}, 300_000);

/** The same ruler, given a different mind; nothing else on the board changes. */
function withMind(world: WorldState, rulerId: string, mind: (c: Character) => Character["mind"]): WorldState {
  return { ...world, characters: world.characters.map((character) => (character.id === rulerId ? { ...character, traits: [], mind: mind(character) } : character)) };
}

const mindOf = (c: Character, temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]>, riskTolerance = 50): Character["mind"] =>
  ({ ...c.mind, riskTolerance, temperament: { ...c.mind.temperament, discipline: 50, ...temperament }, drives: { ...c.mind.drives, ...drives } });

const inputOf = (world: WorldState): StatecraftInput => ({
  world, gameId: "rulers-differ", excludedPolityIds: new Set(), playedByModel: new Set(), playerCharacterId: null, nearPlayer: null, pressures: [],
});

function candidatesFor(world: WorldState, polityId: string) {
  const rulers = readDepartments(world);
  const rulerOf = (id: string): Character | undefined => rulers.rulers(id).find((ruler) => ruler.alive);
  return bigMoveCandidates(inputOf({ ...world, instant: { day: 400, minute: 0 } }), readBoard(world), rulerOf, (id) => id === polityId, null).filter((c) => c.polityId === polityId);
}

/** A power with a ruler who, if bold enough, has somebody he could go to war with. */
function aPowerWithChoices(): { world: WorldState; polityId: string; rulerId: string } {
  const world = base();
  const rulers = readDepartments(world);
  for (const polity of world.map.polities) {
    const ruler = rulers.rulers(polity.id).find((candidate) => candidate.alive);
    if (ruler !== undefined && candidatesFor(withMind(world, ruler.id, (c) => mindOf(c, { boldness: 95, caution: 5 }, { wealth: 95, status: 95, security: 5 }, 95)), polity.id).length >= 1) return { world, polityId: polity.id, rulerId: ruler.id };
  }
  throw new Error("no power in the scenario has a war even a bold ruler could start");
}

describe("every ruler weighs the same board in his own way", () => {
  const hungry = (c: Character) => mindOf(c, { boldness: 90, caution: 10, honesty: 30, cruelty: 70 }, { wealth: 90, status: 90, security: 20, duty: 25, revenge: 70 }, 85);
  const dutiful = (c: Character) => mindOf(c, { boldness: 25, caution: 85, honesty: 90, cruelty: 20 }, { wealth: 25, status: 30, security: 85, duty: 90, revenge: 15, faith: 80 }, 15);

  it("scores the same neighbour higher for a hungry, bold ruler than for a frightened, dutiful one", () => {
    const { world, polityId, rulerId } = aPowerWithChoices();
    const best = (made: WorldState) => Math.max(...candidatesFor(made, polityId).map((c) => c.score));
    expect(best(withMind(world, rulerId, hungry))).toBeGreaterThan(best(withMind(world, rulerId, dutiful)));
  });

  it("makes a frightened ruler ask for far better odds than a bold one", () => {
    const { world, rulerId } = aPowerWithChoices();
    const at = (make: (c: Character) => Character["mind"]) => leastOdds(dispositionOf(withMind(world, rulerId, make).characters.find((c) => c.id === rulerId)!, 400));
    expect(at(dutiful)).toBeGreaterThan(at(hungry) + 0.5);
    // And each is somewhere reasonable.
    expect(at(hungry)).toBeGreaterThanOrEqual(0.35);
    expect(at(dutiful)).toBeLessThanOrEqual(1.6);
  });

  it("makes the proud and vengeful hold out in a war longer than the frightened and forgiving", () => {
    const { world, rulerId } = aPowerWithChoices();
    const proud = dispositionOf(withMind(world, rulerId, (c) => mindOf(c, { sociability: 20 }, { status: 95, revenge: 95, duty: 70, security: 30 })).characters.find((c) => c.id === rulerId)!, 400);
    const meek = dispositionOf(withMind(world, rulerId, (c) => mindOf(c, { sociability: 80 }, { status: 10, revenge: 10, duty: 40, security: 85 })).characters.find((c) => c.id === rulerId)!, 400);
    expect(peaceReluctance(proud)).toBeGreaterThan(peaceReluctance(meek) + 25);
  });

  it("is smooth: nudging one drive moves the appetite a little, never across a threshold", () => {
    const { world, rulerId } = aPowerWithChoices();
    const readings = [20, 35, 50, 65, 80, 95].map((wealth) =>
      appetiteOf(dispositionOf(withMind(world, rulerId, (c) => mindOf(c, {}, { wealth })).characters.find((c) => c.id === rulerId)!, 400)));
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i]!).toBeGreaterThan(readings[i - 1]!);
      expect(readings[i]! - readings[i - 1]!).toBeLessThan(4);
    }
  });

  it("names in the reason what is marked in him, and only that", () => {
    const { world, polityId, rulerId } = aPowerWithChoices();
    const why = candidatesFor(withMind(world, rulerId, hungry), polityId).flatMap((c) => c.why).join(" | ");
    const calm = candidatesFor(withMind(world, rulerId, (c) => mindOf(c, {}, {})), polityId).flatMap((c) => c.why).join(" | ");
    expect(calm).not.toMatch(/hungry for glory|bold to the edge/);
    // The hungry ruler's reasons are not the calm ruler's.
    expect(why).not.toBe(calm);
  });
});
