import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioClock, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { runCognition } from "./cognition";
import type { SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const clock: ScenarioClock = definition.clock;
const baseWorld = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

/** Captures the prompt rather than answering it: these tests are about what a person is told. */
function capturingPort(): SimModelPort & { userMessage: string } {
  const port: SimModelPort & { userMessage: string } = {
    userMessage: "",
    complete(_operation, _system, userMessage) {
      port.userMessage = userMessage;
      return Promise.resolve(JSON.stringify({ actors: [] }));
    },
  };
  return port;
}

function actorFor(world: WorldState, characterId: string): RoutedActor {
  const character = world.characters.find((candidate) => candidate.id === characterId)!;
  return {
    ref: { kind: "character", id: characterId },
    characterId,
    name: character.name,
    level: "focused",
    score: 60,
    knownFacts: [],
    why: "directly affected",
  };
}

async function promptFor(world: WorldState, characterId: string): Promise<string> {
  const port = capturingPort();
  await runCognition(port, [actorFor(world, characterId)], world, clock);
  return port.userMessage;
}

const someone = (world: WorldState): string => world.characters.find((character) => character.alive)!.id;

describe("what a person is told about themselves", () => {
  it("shows the mind they were given rather than only their office", async () => {
    const world = baseWorld();
    const id = someone(world);
    const withMind: WorldState = {
      ...world,
      characters: world.characters.map((character) =>
        character.id === id
          ? {
            ...character,
            mind: {
              ...character.mind,
              temperament: { boldness: 82, caution: 20, honesty: 30, sociability: 50, discipline: 70, cruelty: 50 },
              drives: { ...character.mind.drives, revenge: 88, wealth: 75, faith: 10 },
              riskTolerance: 77,
            },
          }
          : character,
      ),
    };

    const prompt = await promptFor(withMind, id);
    expect(prompt).toContain("Nature:");
    expect(prompt).toContain("bold");
    expect(prompt).toContain("reckless");
    expect(prompt).toContain("Risk they will take: 77/100.");
    expect(prompt).toContain("Driven by:");
    expect(prompt).toContain("revenge");
  });

  it("says nothing about a dimension sitting in the middle", async () => {
    const world = baseWorld();
    const id = someone(world);
    const neutral: WorldState = {
      ...world,
      characters: world.characters.map((character) =>
        character.id === id
          ? { ...character, mind: { ...character.mind, temperament: { boldness: 50, caution: 50, honesty: 50, sociability: 50, discipline: 50, cruelty: 50 } } }
          : character,
      ),
    };

    const prompt = await promptFor(neutral, id);
    expect(prompt).not.toContain("Nature:");
  });

  it("tells them what they can actually reach, with the ids they would have to name", async () => {
    const world = baseWorld();
    const commander = world.material.forces[0]!.commanderCharacterId;
    const prompt = await promptFor(world, commander);
    expect(prompt).toContain("Forces answering to them:");
    expect(prompt).toContain(`[${world.material.forces[0]!.id}]`);
  });
});

describe("what a person is not told", () => {
  const withOutlooks = (): WorldState => {
    const world = baseWorld();
    const [first, second] = world.map.polities;
    return {
      ...world,
      polityOutlooks: [
        {
          polityId: first!.id,
          primaryObjective: "Hold the peninsula and keep the consulship intact.",
          concerns: [{ label: "an unpaid army", level: "high" }],
          intentions: ["raise two more legions"],
          riskTolerance: 40,
          updatedAtStep: 0,
          lastChangeReason: "opening position",
        },
        {
          polityId: second!.id,
          primaryObjective: "Preserve western Mediterranean commercial dominance.",
          concerns: [{ label: "Roman expansion", level: "high" }],
          intentions: ["avoid a major Roman war for now"],
          riskTolerance: 55,
          updatedAtStep: 0,
          lastChangeReason: "opening position",
        },
      ],
    };
  };

  it("gives them their own government's aims", async () => {
    const world = withOutlooks();
    const ourPolity = world.map.polities[0]!.id;
    const ours = world.characters.find((character) => character.alive && character.polityId === ourPolity)!;
    const prompt = await promptFor(world, ours.id);
    expect(prompt).toContain("What their government is trying to do: Hold the peninsula");
  });

  it("never gives them a foreign power's aims, which is what espionage is for", async () => {
    const world = withOutlooks();
    const ourPolity = world.map.polities[0]!.id;
    const ours = world.characters.find((character) => character.alive && character.polityId === ourPolity)!;
    const prompt = await promptFor(world, ours.id);
    expect(prompt).not.toContain("Preserve western Mediterranean commercial dominance");
    expect(prompt).not.toContain("avoid a major Roman war");
  });

  it("leaves out a belief they have already moved past", async () => {
    const world = baseWorld();
    const id = someone(world);
    const withBeliefs: WorldState = {
      ...world,
      characterBeliefs: [
        {
          id: "belief-live", holderCharacterId: id, subjectEntityId: null,
          claim: "The grain fleet is already at sea.", kind: "rumour", sourceCharacterId: null, sourceEventId: null,
          confidence: 40, visibility: "private", learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [], status: "active",
        },
        {
          id: "belief-stale", holderCharacterId: id, subjectEntityId: null,
          claim: "The harvest failed in Campania.", kind: "fact", sourceCharacterId: null, sourceEventId: null,
          confidence: 90, visibility: "private", learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [], status: "superseded",
        },
      ],
    };

    const prompt = await promptFor(withBeliefs, id);
    expect(prompt).toContain("The grain fleet is already at sea. (rumour, 40/100 sure)");
    expect(prompt).not.toContain("The harvest failed in Campania");
  });
});

describe("the cost of a section", () => {
  it("stays small enough to batch several people into one call", async () => {
    const world = baseWorld();
    const prompt = await promptFor(world, someone(world));
    // Roughly 4 characters per token. Three focused actors share one call, so a
    // section that balloons is paid for three times over, every iteration.
    expect(Math.round(prompt.length / 4)).toBeLessThan(900);
  });
});
