import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, openStorylines, type WorldDelta, type WorldState, type WorldStoryline } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { ORDER_THREAD_CAP, WORLD_THREAD_CAP } from "./storyline-cap";
import { runDeterministicTick } from "./tick";

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const base = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

const thread = (id: string, origin: WorldStoryline["origin"], updatedAtStep: number): WorldStoryline => ({
  id, title: `Thread ${id}`, participantIds: [], provinceId: null, phase: "brewing", stakes: "Something.",
  history: [], nextDevelopment: "More.", visibility: "public", origin, openedByRef: null,
  openedAtStep: 0, updatedAtStep, closedAtStep: null, causalFactIds: [], seedKey: null,
});

/** A world already following `count` threads of its own, the first the stalest. */
const crowded = (count: number, origin: WorldStoryline["origin"] = "world"): WorldState => {
  const world = base();
  return { ...world, storylines: [...world.storylines, ...Array.from({ length: count }, (_, index) => thread(`${origin}-${index}`, origin, 10 + index))] };
};

const open: WorldDelta = {
  op: "storyline_open", localId: "mine", seedKey: null, title: "My Bid for the Consulship",
  participantRefs: ["marcus-atilius"], provinceId: null, phase: "brewing",
  stakes: "Whether the centuries will return him.", nextDevelopment: "He canvasses the tribes.",
  visibility: "public", reason: "The player sets out to stand for office.",
};

const context = (overrides: Partial<ApplyContext> = {}): ApplyContext => ({
  now: { day: 20, minute: 540 },
  actorRef: { kind: "character", id: "marcus-atilius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  ids: createIdFactory("cap"),
  gameId: "game-1",
  ...overrides,
});

const openIn = (world: WorldState, origin: WorldStoryline["origin"]): WorldStoryline[] =>
  openStorylines(world.storylines).filter((storyline) => (origin === "character" ? storyline.origin === "character" : storyline.origin !== "character"));

describe("the threads the world follows (E24)", () => {
  it("opens the order's own thread when the world already follows its cap, and sets the stalest world thread aside", () => {
    // The play-test: "The world is already following 12 threads" refused the
    // player's own storyline, in a world whose threads were all the world's.
    const world = crowded(WORLD_THREAD_CAP);
    const result = applyDeltas(world, [open], context({ actsForTheWorld: true, orderDeltas: new Set([open]) }));
    expect(result.rejected).toHaveLength(0);
    const mine = result.world.storylines.find((storyline) => storyline.title === "My Bid for the Consulship")!;
    expect(mine.origin).toBe("character");
    const stalest = result.world.storylines.find((storyline) => storyline.id === "world-0")!;
    expect(stalest.phase).toBe("closed");
    expect(stalest.history.at(-1)).toContain("My Bid for the Consulship");
    expect(result.world.storylines.find((storyline) => storyline.id === "world-1")!.phase).not.toBe("closed");
  });

  it("opens a character's own thread on his turn however many the world follows", () => {
    const result = applyDeltas(crowded(WORLD_THREAD_CAP + 4), [open], context());
    expect(result.rejected).toHaveLength(0);
    expect(openIn(result.world, "character")).toHaveLength(1);
  });

  it("keeps the orders' threads to their own cap, setting the stalest of them aside", () => {
    const result = applyDeltas(crowded(ORDER_THREAD_CAP, "character"), [open], context());
    expect(result.rejected).toHaveLength(0);
    expect(openIn(result.world, "character")).toHaveLength(ORDER_THREAD_CAP);
    expect(result.world.storylines.find((storyline) => storyline.id === "character-0")!.phase).toBe("closed");
  });

  it("still refuses the world a thread of its own past its cap, and does not count the orders' against it", () => {
    const worldAct = { ...open, localId: "theirs", title: "A Quarrel in Etruria" };
    const full = applyDeltas(crowded(WORLD_THREAD_CAP), [worldAct], context({ actsForTheWorld: true }));
    expect(full.rejected).toHaveLength(1);
    expect(full.rejected[0]!.reason).toContain(`${WORLD_THREAD_CAP} threads of its own`);
    const roomy = applyDeltas(crowded(ORDER_THREAD_CAP, "character"), [worldAct], context({ actsForTheWorld: true }));
    expect(roomy.rejected).toHaveLength(0);
  });

  it("brings the world's threads back under the cap at the day's sweep, whatever path opened them", () => {
    // A covert plot, a commander cut off, an heirless estate: each opens its
    // thread without asking, and a save held twenty-six.
    const world = crowded(WORLD_THREAD_CAP + 14);
    const { world: after, notes } = runDeterministicTick({ world, toDay: 40, ids: createIdFactory("tick") });
    expect(openIn(after, "world").length).toBeLessThanOrEqual(WORLD_THREAD_CAP);
    // The oldest idle ones went, the most recently moved stayed.
    expect(after.storylines.find((storyline) => storyline.id === "world-0")!.phase).toBe("closed");
    expect(after.storylines.find((storyline) => storyline.id === `world-${WORLD_THREAD_CAP + 13}`)!.phase).not.toBe("closed");
    expect(notes.some((note) => note.includes("has been set aside"))).toBe(true);
  });

  it("never sets aside a thread the engine is still telling", () => {
    const world = crowded(WORLD_THREAD_CAP + 2);
    // The stalest thread is a nemesis's quarrel, still pressed.
    const pressed: WorldState = {
      ...world,
      nemeses: [{
        id: "nemesis-1", characterId: "quintus-fabius", targetCharacterId: "marcus-atilius", arena: "political",
        storylineId: "world-0", chosenAtStep: 0, retiredAtStep: null, reason: "He wants the consulship.",
      }],
    };
    const { world: after } = runDeterministicTick({ world: pressed, toDay: 40, ids: createIdFactory("tick") });
    expect(after.storylines.find((storyline) => storyline.id === "world-0")!.phase).not.toBe("closed");
    expect(openIn(after, "world").length).toBeLessThanOrEqual(WORLD_THREAD_CAP + 1);
  });
});
