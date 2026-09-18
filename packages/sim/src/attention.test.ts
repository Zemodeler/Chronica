import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, emitFacts, type Fact, type FactDraft, type Office, type WorldState } from "@chronica/shared";
import { routeAmbientActors, routeAttention } from "./attention";

const offices: readonly Office[] = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition).government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

let counter = 0;
function fact(overrides: Partial<FactDraft> = {}): Fact {
  const draft: FactDraft = {
    time: { day: 0, minute: 0 },
    atStep: 0,
    kind: "military_mobilization",
    summary: "Rome begins raising two new legions.",
    affectedEntities: [{ kind: "polity", id: "rome" }],
    resourceChanges: [],
    authorityChange: undefined,
    visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    evidence: null,
    eligibleReactionScopes: [],
    sourceEventId: null,
    sourceActionId: null,
    causalDepth: 0,
    ...overrides,
  };
  return emitFacts([draft], () => `fact-${(counter += 1)}`)[0]!;
}

const route = (facts: readonly Fact[], state: WorldState = world(), exclude: readonly string[] = []) =>
  routeAttention({ world: state, facts, offices, excludeCharacterIds: exclude, maxFocused: 3, maxCausalDepth: 3 });

describe("attention routing", () => {
  it("wakes nobody at all when nothing has happened", () => {
    const result = route([]);
    expect(result.focused).toHaveLength(0);
    expect(result.active).toHaveLength(0);
  });

  it("wakes someone for a public event, but never more than the budget allows", () => {
    const result = route([fact()]);
    expect(result.focused.length).toBeGreaterThan(0);
    expect(result.focused.length).toBeLessThanOrEqual(3);
  });

  it("does not wake the player -- they speak for themselves", () => {
    const woken = route([fact()], world(), ["marcus-atilius"]);
    expect(woken.focused.map((actor) => actor.characterId)).not.toContain("marcus-atilius");
    // ...and the exclusion is what kept them out, not an empty result.
    expect(route([fact()]).focused.map((actor) => actor.characterId)).toContain("marcus-atilius");
  });
});

describe("what an actor is allowed to react to", () => {
  it("cannot be woken by a secret nobody has discovered", () => {
    // VISION §14: the simulation knowing something is not the same as anyone
    // in it knowing, and only knowledge may cause action.
    const secret = fact({
      kind: "conspiracy",
      summary: "A senator quietly courts the army's officers.",
      visibility: "private",
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] },
    });
    const result = route([secret]);
    expect(result.focused).toHaveLength(0);
    expect(result.active).toHaveLength(0);
  });

  it("is woken by a secret once they are among those who know it", () => {
    const shared = fact({
      kind: "conversation_promise",
      summary: "Quintus Fabius promised to fund the legions.",
      visibility: "private",
      affectedEntities: [{ kind: "character", id: "quintus-fabius" }],
      discovery: {
        state: "private",
        knowableAtInstant: null,
        discoveredBy: [{ observerRef: { kind: "character", id: "quintus-fabius" }, atInstant: { day: 0, minute: 0 }, via: "witnessed" }],
      },
    });
    const result = route([shared]);
    expect([...result.focused, ...result.active].map((actor) => actor.characterId)).toContain("quintus-fabius");
  });

  it("cannot be woken by news that has not arrived yet", () => {
    // VISION §16: a public mobilization is still not knowable in Carthage on
    // the day it happens. `factsVisibleTo` alone would say otherwise.
    const travelling = fact({ discovery: { state: "delayed", knowableAtInstant: { day: 30, minute: 0 }, discoveredBy: [] } });
    expect(route([travelling]).focused).toHaveLength(0);
  });

  it("is woken once that news has had time to travel", () => {
    const travelling = fact({ discovery: { state: "delayed", knowableAtInstant: { day: 1, minute: 0 }, discoveredBy: [] } });
    const later = { ...world(), instant: { day: 2, minute: 0 }, elapsedStep: 2 };
    expect(route([travelling], later).focused.length).toBeGreaterThan(0);
  });

  it("cannot be woken by a fact already past the causal horizon", () => {
    // VISION §21: without this, every reaction breeds another forever.
    expect(route([fact({ causalDepth: 3 })]).focused).toHaveLength(0);
  });
});

describe("why an actor is woken", () => {
  it("counts an open promise as a reason to care", () => {
    const state = world();
    const withCommitment: WorldState = {
      ...state,
      commitments: [{
        id: "commitment-1",
        promisorCharacterId: "quintus-fabius",
        beneficiaryCharacterId: "marcus-atilius",
        actionKind: "payment",
        description: "two hundred talents toward the new legions",
        conditions: "",
        requiredOfficeId: null,
        requiredResource: null,
        visibility: "private",
        sourceEventId: null,
        breachPressureKind: "humiliation",
        status: "pending",
        createdAtStep: 0,
        reviewAtStep: 30,
        resolvedAtStep: null,
        resolutionReason: null,
      }],
    };

    const woken = [...route([fact()], withCommitment).focused, ...route([fact()], withCommitment).active]
      .find((actor) => actor.characterId === "quintus-fabius");
    expect(woken?.why).toContain("open commitment");
  });

  it("says in plain terms why each actor was selected", () => {
    const result = route([fact()]);
    for (const actor of result.focused) expect(actor.why.length).toBeGreaterThan(0);
  });

  it("selects the same actors for the same world, every time", () => {
    // A replay that woke different people would make every other guarantee
    // meaningless.
    const facts = [fact()];
    const first = route(facts).focused.map((actor) => actor.characterId);
    const second = route(facts).focused.map((actor) => actor.characterId);
    expect(first).toEqual(second);
  });
});

describe("the world elsewhere", () => {
  const ambient = (state: WorldState, priority: readonly string[] = []) =>
    routeAmbientActors({ world: state, facts: [], offices, excludeCharacterIds: ["marcus-atilius"], max: 2, priorityCharacterIds: priority });

  it("keeps one slot for whoever the narrator has just handed a problem to", () => {
    // Marcus the Younger holds no office and no command, so the rotation would
    // never reach him. The seed landed on him, so he is asked this round.
    const cast = ambient(world(), ["marcus-atilius-minor"]);
    expect(cast.map((actor) => actor.characterId)).toContain("marcus-atilius-minor");
    expect(cast).toHaveLength(2);
    expect(cast[0]!.why).toContain("something has just come to them");
  });

  it("tells a participant what their thread is waiting on, and weighs a crisis more than a rumour", () => {
    const state = world();
    const thread = {
      id: "t1", title: "The Quaestor's Silence", participantIds: ["quintus-fabius"], provinceId: null, phase: "crisis" as const,
      stakes: "Everything.", history: [], nextDevelopment: "Fabius must choose a side tonight.", visibility: "public" as const,
      origin: "world" as const, openedByRef: null, openedAtStep: 0, updatedAtStep: 0, closedAtStep: null, causalFactIds: [], seedKey: null,
    };
    const inCrisis = ambient({ ...state, storylines: [thread] });
    const fabius = inCrisis.find((actor) => actor.characterId === "quintus-fabius")!;
    expect(fabius.why).toContain("Fabius must choose a side tonight");
    const brewing = ambient({ ...state, storylines: [{ ...thread, phase: "brewing" }] });
    expect(fabius.score).toBeGreaterThan(brewing.find((actor) => actor.characterId === "quintus-fabius")!.score);
  });

  it("ignores a thread that is closed", () => {
    const state = world();
    const closed = ambient({
      ...state,
      storylines: [{
        id: "t1", title: "Over", participantIds: ["quintus-fabius"], provinceId: null, phase: "closed", stakes: "Nothing now.", history: [],
        nextDevelopment: "Nothing.", visibility: "public", origin: "world", openedByRef: null, openedAtStep: 0, updatedAtStep: 0, closedAtStep: 0, causalFactIds: [], seedKey: null,
      }],
    });
    expect(closed.find((actor) => actor.characterId === "quintus-fabius")?.why ?? "").not.toContain("Over");
  });
});
