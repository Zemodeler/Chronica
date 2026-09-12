import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { selectAffectedAgentsForEvent, selectAffectedAgentsForFacts } from "./affected-agent-selector";
import { NO_INTERVENTION_SIGNALS, type Fact } from "./facts";
import type { WorldEventRecord } from "./event-queue";
import type { WorldState } from "./world-state";

// docs/32 corrective pass, requirement 3: the real per-event selector must
// stay narrow -- only who a specific event's own Facts actually concern --
// and respect the shared 8-agent/2-star-context budget.

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function fact(overrides: Partial<Fact> & Pick<Fact, "affectedEntities">): Fact {
  return {
    id: `fact-${Math.random()}`,
    time: { day: 1, minute: 0 },
    atStep: 1,
    kind: "test_event",
    summary: "Something happened.",
    resourceChanges: [],
    authorityChange: undefined,
    visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    evidence: null,
    eligibleReactionScopes: [],
    interventionSignals: NO_INTERVENTION_SIGNALS,
    sourceEventId: "event-1",
    sourceActionId: null,
    causalDepth: 0,
    ...overrides,
  };
}

const dueEvent: WorldEventRecord = {
  id: "event-1",
  gameId: "game-1",
  scheduledForTurnId: null,
  kind: "action_phase",
  status: "pending",
  instant: { day: 1, minute: 0 },
  priority: 0,
  isPlayerAction: false,
  subjectRef: { kind: "world", id: "world" },
  actionId: null,
  operationId: null,
  payload: { kind: "action_phase", actionId: "some_action" },
  causalDepth: 0,
  causedByEventId: null,
  causedByFactId: null,
  createdAtStep: 1,
  resolvedAtStep: null,
  resolvedFactIds: [],
};

describe("selectAffectedAgentsForEvent (docs/32 corrective pass, requirement 3)", () => {
  it("selects nothing when no fact names an affected entity", () => {
    const selection = selectAffectedAgentsForEvent(world(), [], dueEvent);
    expect(selection).toEqual({ npcCharacterIds: [], starContextRefs: [], withinBudget: true });
  });

  it("selects only the living character a fact directly names, ignoring unrelated characters entirely", () => {
    const w = world();
    const facts = [fact({ affectedEntities: [{ kind: "character", id: "hanno" }] })];
    const selection = selectAffectedAgentsForEvent(w, facts, dueEvent);
    expect(selection.npcCharacterIds).toEqual(["hanno"]);
    expect(selection.starContextRefs).toEqual([]);
    // A minor, personally-scoped event must not pull in the whole polity's
    // other named characters (e.g. Marcus Atilius, Quintus Fabius) just
    // because they exist in the same world.
    expect(selection.npcCharacterIds).not.toContain("marcus-atilius");
    expect(selection.npcCharacterIds).not.toContain("quintus-fabius");
  });

  it("ignores an institutional ref when the fact declares no eligible reaction scopes", () => {
    const w = world();
    const facts = [fact({ affectedEntities: [{ kind: "polity", id: "rome" }], eligibleReactionScopes: [] })];
    const selection = selectAffectedAgentsForEvent(w, facts, dueEvent);
    expect(selection).toEqual({ npcCharacterIds: [], starContextRefs: [], withinBudget: true });
  });

  it("selects a living command-holder over an affected force, and a star context when a scope has no living representative", () => {
    const w = world();
    const force = w.material.forces[0]!;
    const facts = [
      fact({ affectedEntities: [{ kind: "force", id: force.id }], eligibleReactionScopes: ["unit"] }),
      fact({ affectedEntities: [{ kind: "polity", id: "no-such-polity" }], eligibleReactionScopes: ["polity"] }),
    ];
    const selection = selectAffectedAgentsForEvent(w, facts, dueEvent);
    expect(selection.npcCharacterIds).toContain(force.commanderCharacterId);
    expect(selection.starContextRefs).toEqual([{ level: "polity", id: "no-such-polity" }]);
  });

  it("truncates to the shared 8-agent/2-star-context budget and reports withinBudget: false", () => {
    const w = world();
    const characterIds = w.characters.filter((c) => c.alive).map((c) => c.id);
    expect(characterIds.length).toBeGreaterThan(0);
    const facts = characterIds.map((id) => fact({ affectedEntities: [{ kind: "character", id }] }));
    const manyCharacters: WorldState = {
      ...w,
      characters: [
        ...w.characters,
        ...Array.from({ length: 10 }, (_, i) => ({ ...w.characters[0]!, id: `extra-${i}`, alive: true })),
      ],
    };
    const manyFacts = [...facts, ...Array.from({ length: 10 }, (_, i) => fact({ affectedEntities: [{ kind: "character", id: `extra-${i}` }] }))];
    const selection = selectAffectedAgentsForEvent(manyCharacters, manyFacts, dueEvent);
    expect(selection.npcCharacterIds.length).toBeLessThanOrEqual(8);
    expect(selection.withinBudget).toBe(false);
  });
});

describe("selectAffectedAgentsForFacts (unified action runtime, Stage 4)", () => {
  it("selects directly from a given batch of facts, with no event or sourceEventId involved at all", () => {
    const w = world();
    const facts = [fact({ affectedEntities: [{ kind: "character", id: "hanno" }], sourceEventId: null })];
    const selection = selectAffectedAgentsForFacts(w, facts);
    expect(selection.npcCharacterIds).toEqual(["hanno"]);
  });

  it("selectAffectedAgentsForEvent is exactly selectAffectedAgentsForFacts narrowed to one event's own facts first", () => {
    const w = world();
    const facts = [
      fact({ affectedEntities: [{ kind: "character", id: "hanno" }], sourceEventId: "event-1" }),
      fact({ affectedEntities: [{ kind: "character", id: "hamilcar" }], sourceEventId: "some-other-event" }),
    ];
    // Passed directly, selectAffectedAgentsForFacts sees both facts and selects both characters.
    expect([...selectAffectedAgentsForFacts(w, facts).npcCharacterIds].sort()).toEqual(["hamilcar", "hanno"]);
    // Narrowed through the event, only the fact naming this event's own id counts.
    const viaEvent = selectAffectedAgentsForEvent(w, facts, dueEvent);
    expect(viaEvent.npcCharacterIds).toEqual(["hanno"]);
  });
});
