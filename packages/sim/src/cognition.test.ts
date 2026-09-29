import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioClock, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { foldStrayProposalKeys, renderCharacterPortrait, deal, runCognition } from "./cognition";
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
    impetus: "reaction",
    pressing: true,
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

describe("an answer that is right but nested wrong", () => {
  it("puts a proposal's own lists back inside the proposal instead of throwing the answer away", () => {
    // From a live game. Cognition answers in the same shape the orchestrator
    // does, and that shape has `facts`, `delegations` and `schedule` at the
    // top level -- so the model hoisted them there. The schema is strict, so
    // the whole answer went in the bin over a nesting level: three people had
    // been asked what they were doing, all three had answered at length, and
    // the world recorded nothing at all.
    const hoisted = {
      actors: [{
        actorRef: { kind: "character", id: "hanno" },
        reasoning: "He means to hold the strait.",
        proposal: { deltas: [] },
      }],
      facts: [{ localId: "f1", kind: "council", summary: "Carthage resolves to hold the strait." }],
      delegations: [{ localId: "d1" }],
      schedule: [{ kind: "muster", dueInDays: 10 }],
      discoveries: [],
    };
    const folded = foldStrayProposalKeys(hoisted) as { actors: { proposal: Record<string, unknown[]> }[] } & Record<string, unknown>;
    expect(folded.actors[0]!.proposal.facts).toHaveLength(1);
    expect(folded.actors[0]!.proposal.delegations).toHaveLength(1);
    expect(folded.actors[0]!.proposal.schedule).toHaveLength(1);
    expect(folded.facts).toBeUndefined();
  });

  it("folds a list sitting beside an actor's own proposal, which is never ambiguous", () => {
    const beside = {
      actors: [
        { actorRef: { kind: "character", id: "a" }, reasoning: "x", proposal: { deltas: [{ op: "belief_set" }] }, facts: [{ localId: "fa" }] },
        { actorRef: { kind: "character", id: "b" }, reasoning: "y", proposal: { deltas: [{ op: "force_modify" }] }, facts: [{ localId: "fb" }] },
      ],
    };
    const folded = foldStrayProposalKeys(beside) as { actors: { proposal: Record<string, unknown[]> }[] };
    expect(folded.actors[0]!.proposal.facts).toEqual([{ localId: "fa" }]);
    expect(folded.actors[1]!.proposal.facts).toEqual([{ localId: "fb" }]);
    // The deltas the actor already had are left exactly as they were.
    expect(folded.actors[0]!.proposal.deltas).toEqual([{ op: "belief_set" }]);
  });

  it("drops a line written where a delta belongs, and keeps the deltas", () => {
    // From a live burst: four of ten cognition calls were repairs, and two of
    // them were this -- a bare sentence in the deltas array, against a strict
    // schema, throwing away everything the same answer got right.
    const withProse = {
      actors: [{
        actorRef: { kind: "character", id: "a" },
        reasoning: "x",
        proposal: { deltas: [{ op: "belief_set" }, "He also writes to Syracuse.", { op: "force_modify" }] },
      }],
    };
    const folded = foldStrayProposalKeys(withProse) as { actors: { proposal: Record<string, unknown[]> }[] };
    expect(folded.actors[0]!.proposal.deltas).toEqual([{ op: "belief_set" }, { op: "force_modify" }]);
  });

  it("drops a person written as a sentence, and keeps the people", () => {
    const withProse = {
      actors: [
        { actorRef: { kind: "character", id: "a" }, reasoning: "x", proposal: { deltas: [] } },
        "Hanno does nothing of note.",
        { actorRef: { kind: "character", id: "b" }, reasoning: "y", proposal: { deltas: [] } },
      ],
    };
    const folded = foldStrayProposalKeys(withProse) as { actors: { actorRef: { id: string } }[] };
    expect(folded.actors.map((actor) => actor.actorRef.id)).toEqual(["a", "b"]);
  });

  it("takes a proposal's stray \"reason\" as the reasoning it was meant to be", () => {
    // The proposal schema is strict and has no "reason"; the actor has
    // "reasoning". Four complete answers were rejected over the difference.
    const nearMiss = {
      actors: [{ actorRef: { kind: "character", id: "a" }, proposal: { deltas: [], reason: "He waits for the harvest." } }],
    };
    const folded = foldStrayProposalKeys(nearMiss) as { actors: { reasoning?: string; proposal: Record<string, unknown> }[] };
    expect(folded.actors[0]!.proposal.reason).toBeUndefined();
    expect(folded.actors[0]!.reasoning).toBe("He waits for the harvest.");
  });

  it("keeps the reasoning the actor already gave, and drops the duplicate", () => {
    const both = {
      actors: [{ actorRef: { kind: "character", id: "a" }, reasoning: "The real one.", proposal: { deltas: [], reason: "A second telling." } }],
    };
    const folded = foldStrayProposalKeys(both) as { actors: { reasoning?: string; proposal: Record<string, unknown> }[] };
    expect(folded.actors[0]!.reasoning).toBe("The real one.");
    expect(folded.actors[0]!.proposal.reason).toBeUndefined();
  });

  it("drops a root list it cannot attribute rather than putting words in somebody's mouth", () => {
    // A fact carries its author's visibility with it, so guessing which of
    // several people said a thing is worse than losing it.
    const ambiguous = {
      actors: [
        { actorRef: { kind: "character", id: "a" }, reasoning: "x", proposal: { deltas: [] } },
        { actorRef: { kind: "character", id: "b" }, reasoning: "y", proposal: { deltas: [] } },
      ],
      facts: [{ localId: "orphan" }],
    };
    const folded = foldStrayProposalKeys(ambiguous) as { actors: { proposal: Record<string, unknown[]> }[] } & Record<string, unknown>;
    expect(folded.facts).toBeUndefined();
    expect(folded.actors[0]!.proposal.facts).toBeUndefined();
    expect(folded.actors[1]!.proposal.facts).toBeUndefined();
  });

  it("leaves an answer that was already right exactly as it was", () => {
    const fine = { actors: [{ actorRef: { kind: "character", id: "a" }, reasoning: "x", proposal: { deltas: [], facts: [{ localId: "f" }] } }] };
    expect(foldStrayProposalKeys(structuredClone(fine))).toEqual(fine);
  });
});

describe("an op written as a field of the proposal", () => {
  it("puts social_events back in the deltas instead of losing four people's answers", () => {
    // From a live game, and my own fault: the prompt named "social_events"
    // beside "relationCauses" and "observedTraits", both of which *are*
    // fields, so the model read it as one. All four actors in the batch were
    // correct in substance and the whole batch was discarded.
    const misplaced = {
      actors: [{
        actorRef: { kind: "character", id: "hanno" },
        reasoning: "He takes the measure of the man.",
        proposal: {
          deltas: [{ op: "belief_set" }],
          social_events: { events: [{ participantCharacterRefs: ["hanno", "marcus"], kind: "conversation", visibility: "polity", summary: "They met." }] },
        },
      }],
    };
    const folded = foldStrayProposalKeys(misplaced) as { actors: { proposal: { deltas: { op: string }[] } }[] };
    expect(folded.actors[0]!.proposal.deltas).toHaveLength(2);
    expect(folded.actors[0]!.proposal.deltas[1]!.op).toBe("social_events");
    expect(folded.actors[0]!.proposal).not.toHaveProperty("social_events");
  });

  it("accepts a bare event where the model skipped the wrapper", () => {
    const bare = {
      actors: [{
        actorRef: { kind: "character", id: "hanno" }, reasoning: "x",
        proposal: { deltas: [], social_events: [{ participantCharacterRefs: ["a", "b"], kind: "insult", visibility: "polity", summary: "Words were had." }] },
      }],
    };
    const folded = foldStrayProposalKeys(bare) as { actors: { proposal: { deltas: { op: string; events: unknown[] }[] } }[] };
    expect(folded.actors[0]!.proposal.deltas[0]!.events).toHaveLength(1);
  });
});

describe("a large cast, dealt onto two calls", () => {
  /** Answers for whoever it was asked about, so a split can be told from a loss. */
  function answeringPort(): SimModelPort & { userMessages: string[] } {
    const port: SimModelPort & { userMessages: string[] } = {
      userMessages: [],
      complete(_operation, _system, userMessage) {
        port.userMessages.push(userMessage);
        const asked = [...userMessage.matchAll(/^## .+ \[([^\]]+)\]$/gm)].map((match) => match[1]!);
        return Promise.resolve(JSON.stringify({
          actors: asked.map((characterId) => ({
            actorRef: { kind: "character", id: characterId },
            reasoning: "They wait and see.",
            proposal: {
              narrativeSummary: `${characterId} does nothing in particular.`,
              deltas: [], facts: [], delegations: [], schedule: [], discoveries: [], frictions: [], utterance: null,
            },
          })),
        }));
      },
    };
    return port;
  }

  /** The scenario ships five people; a cast worth splitting needs more of them. */
  const peopled = (world: WorldState, count: number): WorldState => {
    const template = world.characters.find((character) => character.alive)!;
    const extra = Array.from({ length: Math.max(0, count - world.characters.length) }, (_, index) => ({
      ...template,
      id: `extra-${index}`,
      name: `Extra ${index}`,
    }));
    return { ...world, characters: [...world.characters, ...extra] };
  };

  const cast = (world: WorldState, count: number): RoutedActor[] =>
    world.characters.filter((character) => character.alive).slice(0, count).map((character) => actorFor(world, character.id));

  it("still answers for everybody, in the order the router chose", async () => {
    const world = peopled(baseWorld(), 8);
    const actors = cast(world, 8);
    const port = answeringPort();

    const result = await runCognition(port, actors, world, clock);

    // Two calls, one round: the split is what makes a round cost the longer
    // half rather than the sum of the whole cast's answers.
    expect(port.userMessages).toHaveLength(2);
    expect(result.calls).toBe(2);
    expect(result.parseFailure).toBeNull();
    // Everybody the router picked, and in its order -- the deltas are applied
    // in this sequence, so a half finishing first must not reorder it.
    expect(result.output.actors.map((actor) => actor.actorRef.id)).toEqual(actors.map((actor) => actor.characterId));
  });

  it("tells each person exactly what one call would have told them", async () => {
    // The split changes which request carries a person and nothing about what
    // is said of them. The part that could have gone wrong is the relations
    // block: it is built from everyone in view, and had the halves each been
    // told only about themselves, a man would have stopped having opinions
    // about the people who happened to land in the other call.
    const world = peopled(baseWorld(), 8);
    const actors = cast(world, 8);
    const everyone = actors.map((actor) => actor.characterId);

    const split = answeringPort();
    await runCognition(split, actors, world, clock);
    expect(split.userMessages).toHaveLength(2);

    const sent = split.userMessages.join("\n\n");
    for (const actor of actors) {
      const asOneCallWouldHaveIt = renderCharacterPortrait(actor.characterId, actor.name, world, clock, {
        knownFacts: actor.knownFacts,
        impetus: { why: actor.why, ownBusiness: actor.impetus === "own_business" },
        others: everyone,
        closeWithDate: true,
      });
      expect(sent).toContain(asOneCallWouldHaveIt);
    }
  });

  it("keeps half a round when the other half cannot be read", async () => {
    const world = peopled(baseWorld(), 8);
    const actors = cast(world, 8);
    let calls = 0;
    const port: SimModelPort = {
      complete(_operation, _system, userMessage) {
        calls += 1;
        // The second half answers with something unusable, twice -- its own
        // call and its own repair.
        // Valid JSON of the wrong shape, so it is the schema that refuses it
        // and the repair attempt is reached.
        if (userMessage.includes(actors[5]!.characterId)) return Promise.resolve(JSON.stringify({ actors: "not a list of people" }));
        const asked = [...userMessage.matchAll(/^## .+ \[([^\]]+)\]$/gm)].map((match) => match[1]!);
        return Promise.resolve(JSON.stringify({
          actors: asked.map((characterId) => ({
            actorRef: { kind: "character", id: characterId },
            reasoning: "They wait.",
            proposal: { narrativeSummary: "Nothing.", deltas: [], facts: [], delegations: [], schedule: [], discoveries: [], frictions: [], utterance: null },
          })),
        }));
      },
    };

    const result = await runCognition(port, actors, world, clock);

    expect(calls).toBe(3);
    expect(result.parseFailure).not.toBeNull();
    // The first four still acted. Before the split, one unreadable answer lost
    // the whole round.
    expect(result.output.actors.map((actor) => actor.actorRef.id)).toEqual(actors.slice(0, 4).map((actor) => actor.characterId));
  });
});

describe("an op written where a field belongs", () => {
  it("puts a hoisted storyline_advance back among the deltas", () => {
    // Measured twice in a row on live bursts: four people's complete answers
    // rejected over `Unrecognized key: "storyline_advance"`, and repaired at
    // full price both times. The prompt asks for it beside `storylineRef`,
    // which genuinely is a field, so the mistake is the prompt's own doing.
    const hoisted = {
      actors: [{
        actorRef: { kind: "character", id: "a" },
        reasoning: "x",
        proposal: {
          deltas: [{ op: "belief_set" }],
          storyline_advance: { storylineRef: "s1", development: "The fleet sailed.", reason: "It happened." },
        },
      }],
    };
    const folded = foldStrayProposalKeys(hoisted) as { actors: { proposal: Record<string, unknown[]> }[] };
    expect(folded.actors[0]!.proposal.storyline_advance).toBeUndefined();
    expect(folded.actors[0]!.proposal.deltas).toEqual([
      { op: "belief_set" },
      { op: "storyline_advance", storylineRef: "s1", development: "The fleet sailed.", reason: "It happened." },
    ]);
  });

  it("still wraps social_events in the list it carries", () => {
    // The two are folded by the same machinery and want different shapes:
    // social_events holds an `events` array, a storyline advance is flat.
    const hoisted = {
      actors: [{
        actorRef: { kind: "character", id: "a" },
        reasoning: "x",
        proposal: { deltas: [], social_events: { participantCharacterRefs: ["a", "b"] } },
      }],
    };
    const folded = foldStrayProposalKeys(hoisted) as { actors: { proposal: Record<string, unknown[]> }[] };
    expect(folded.actors[0]!.proposal.deltas).toEqual([
      { op: "social_events", events: [{ participantCharacterRefs: ["a", "b"] }] },
    ]);
  });
});

describe("the actor's reasoning, written one level down", () => {
  it("takes it from inside the proposal, under either spelling", () => {
    for (const key of ["reasoning", "reason"]) {
      const nested = {
        actors: [{ actorRef: { kind: "character", id: "a" }, proposal: { deltas: [], [key]: "He waits for the harvest." } }],
      };
      const folded = foldStrayProposalKeys(nested) as { actors: { reasoning?: string; proposal: Record<string, unknown> }[] };
      expect(folded.actors[0]!.proposal[key]).toBeUndefined();
      expect(folded.actors[0]!.reasoning).toBe("He waits for the harvest.");
    }
  });
});

describe("how a cast is dealt onto calls", () => {
  it("keeps a small cast in one call, and deals a large one onto as many as asked, evenly", () => {
    const state = baseWorld();
    const cast = state.characters.filter((character) => character.alive).slice(0, 5).map((character) => actorFor(state, character.id));
    const ten = [...cast, ...cast].map((actor, index) => ({ ...actor, characterId: `${actor.characterId}-${index}` }));
    expect(deal(cast)).toHaveLength(1);
    expect(deal(ten).map((batch) => batch.length)).toEqual([4, 4, 2]);
    expect(deal(ten, { maxBatches: 2, actorsPerCall: 5 }).map((batch) => batch.length)).toEqual([5, 5]);
    expect(deal(ten, { maxBatches: 4, actorsPerCall: 3 }).map((batch) => batch.length)).toEqual([3, 3, 3, 1]);
    expect(deal(ten.slice(0, 7), { maxBatches: 4, actorsPerCall: 2 }).map((batch) => batch.length)).toEqual([2, 2, 2, 1]);
  });
});

describe("how old he is and how he is in body", () => {
  it("says his age always, and his health only when it is not sound", () => {
    const world = baseWorld();
    const man = world.characters.find((character) => character.alive)!;
    const sound = renderCharacterPortrait(man.id, man.name, { ...world, characters: world.characters.map((character) => (character.id === man.id ? { ...character, healthBps: 10_000, disqualifyingStatuses: [] } : character)) }, clock);
    expect(sound).toMatch(/\nAge \d+\.\n/);
    const unwell = renderCharacterPortrait(man.id, man.name, {
      ...world,
      characters: world.characters.map((character) => (character.id === man.id ? { ...character, healthBps: 3_000, disqualifyingStatuses: ["incapacitated", "fever", "injured:blinded-one-eye"] } : character)),
    }, clock);
    expect(unwell).toContain("in poor health; ill, and keeping to the house; suffering from fever; blinded in one eye.");
  });
});
