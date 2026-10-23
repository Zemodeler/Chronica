import { beforeAll, describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, type Character, type WorldState } from "@chronica/shared";
import { readBoard } from "./board";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { conductInWords, natureObjects } from "./nature";
import type { SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "w", deltas: [], facts: [], outcome: "continue" }));
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    return Promise.resolve("{}");
  },
};

let seeded: WorldState;
beforeAll(async () => {
  const result = await runSimulationBurst({
    world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
    clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: "seed", gameId: "nature-binds", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  seeded = result.world;
}, 300_000);

const minded = (world: WorldState, id: string, temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]>, riskTolerance = 50): WorldState =>
  ({ ...world, characters: world.characters.map((c) => (c.id === id ? { ...c, traits: [], mind: { ...c.mind, riskTolerance, temperament: { ...c.mind.temperament, ...temperament }, drives: { ...c.mind.drives, ...drives } } } : c)) });

const FRIGHTENED = { boldness: 10, caution: 95, discipline: 60 };
const FRIGHTENED_DRIVES = { security: 95, status: 20, wealth: 20, revenge: 10, duty: 60 };
const DARING = { boldness: 98, caution: 3 };
const DARING_DRIVES = { security: 5, status: 90, wealth: 90 };

/** A ruler and a neighbour somewhat stronger than he is: the same war, put to two different men. */
function aHopelessWar(world: WorldState): { rulerId: string; polityId: string; otherId: string } {
  const rulers = readDepartments(world);
  for (const reading of readBoard(world).values()) {
    const ruler = rulers.rulers(reading.polityId).find((candidate) => candidate.alive);
    const foe = reading.neighbours.find((neighbour) => neighbour.ratio > 0.3 && neighbour.ratio < 0.9 && neighbour.relation !== "war" && neighbour.relation !== "leads_us");
    if (ruler !== undefined && foe !== undefined) return { rulerId: ruler.id, polityId: reading.polityId, otherId: foe.polityId };
  }
  throw new Error("no power has a much stronger neighbour");
}

const war = (polityId: string, otherPolityId: string) => WorldDeltaSchema.parse({
  op: "agreement_open", localId: "war_x", kind: "war", polityId, otherPolityId, terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "test",
});

describe("nature binds the person when the model plays them", () => {
  it("stops a frightened ruler opening a hopeless war, and lets a daring one", () => {
    const { rulerId, polityId, otherId } = aHopelessWar(seeded);
    const frightened = minded(seeded, rulerId, FRIGHTENED, FRIGHTENED_DRIVES, 5);
    const daring = minded(seeded, rulerId, DARING, DARING_DRIVES, 98);
    expect(natureObjects(frightened, rulerId, war(polityId, otherId))).toMatch(/would not open a war/);
    expect(natureObjects(daring, rulerId, war(polityId, otherId))).toBeNull();
  });

  it("does not gate a man who is not the ruler, or acts that are not about the large matters", () => {
    const { rulerId, polityId, otherId } = aHopelessWar(seeded);
    const frightened = minded(seeded, rulerId, FRIGHTENED, FRIGHTENED_DRIVES, 5);
    const other = frightened.characters.find((c) => c.id !== rulerId && c.alive)!.id;
    expect(natureObjects(frightened, other, war(polityId, otherId))).toBeNull();
    expect(natureObjects(frightened, rulerId, WorldDeltaSchema.parse({ op: "character_state_set", characterRef: rulerId, standingDeltaBps: 10, standingCause: "scandal", reason: "x" }))).toBeNull();
  });

  it("refuses a gentle man's order to put a man to death out of hand, and a cruel man's is not refused", () => {
    const { rulerId } = aHopelessWar(seeded);
    const victim = seeded.characters.find((c) => c.id !== rulerId && c.alive)!.id;
    const kill = WorldDeltaSchema.parse({ op: "character_death", characterRef: victim, manner: "execution", byCharacterRef: rulerId, reason: "x" });
    expect(natureObjects(minded(seeded, rulerId, { cruelty: 5 }, {}), rulerId, kill)).toMatch(/put to death out of hand/);
    expect(natureObjects(minded(seeded, rulerId, { cruelty: 80 }, {}), rulerId, kill)).toBeNull();
  });

  it("tells the model, in terms the engine will hold it to, how each person decides", () => {
    const { rulerId } = aHopelessWar(seeded);
    const frightened = conductInWords(minded(seeded, rulerId, FRIGHTENED, FRIGHTENED_DRIVES, 5), minded(seeded, rulerId, FRIGHTENED, FRIGHTENED_DRIVES, 5).characters.find((c) => c.id === rulerId)!).join(" ");
    const daring = minded(seeded, rulerId, DARING, DARING_DRIVES, 98);
    const bold = conductInWords(daring, daring.characters.find((c) => c.id === rulerId)!).join(" ");
    expect(frightened).toMatch(/not start a war you are not far the stronger/);
    expect(bold).toMatch(/even odds, or worse/);
    expect(frightened).not.toBe(bold);
    expect(frightened).toMatch(/will not carry out a large act|not carry out a large act/);
  });
});
