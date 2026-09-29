import { describe, expect, it } from "vitest";
import { factsVisibleTo, type CharacterSocialEvent } from "@chronica/shared";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import { factsFromConversation } from "./conversation";
import { createIdFactory } from "./ports";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

function event(overrides: Partial<CharacterSocialEvent> = {}): CharacterSocialEvent {
  return {
    id: "evt-1",
    gameId: "game-1",
    sourceTurnId: null,
    sourceSessionId: "session-1",
    sourceMessageId: "msg-1",
    participantCharacterIds: ["marcus-atilius", "quintus-fabius"],
    kind: "conversation",
    visibility: "private",
    knownByCharacterIds: ["marcus-atilius", "quintus-fabius"],
    relationCauses: [],
    knowledgeClaims: [],
    proposedBeliefs: [],
    pressureChanges: [],
    observedTraits: [],
    commitmentProposal: null,
    introducedCharacter: null,
    introducedProfile: null,
    createdAtStep: 0,
    appliedAtStep: null,
    appliedInTurnId: null,
    status: "proposed",
    rejectionReason: null,
    ...overrides,
  };
}

const context = () => ({ world: world(), now: { day: 0, minute: 600 }, ids: createIdFactory("conv") });

describe("conversations as history", () => {
  it("records what two people said where only they can see it", () => {
    const { facts } = factsFromConversation({ events: [event()], ...context() });
    const fact = facts[0]!;

    expect(fact.visibility).toBe("private");
    expect(factsVisibleTo(facts, { kind: "character", id: "marcus-atilius" }, { day: 0, minute: 600 })).toHaveLength(1);
    expect(factsVisibleTo(facts, { kind: "character", id: "quintus-fabius" }, { day: 0, minute: 600 })).toHaveLength(1);
    // Hanno was not in the room and has been told nothing.
    expect(factsVisibleTo(facts, { kind: "character", id: "hanno" }, { day: 0, minute: 600 })).toHaveLength(0);
  });

  it("names the promise in the record, so the world can hold someone to it", () => {
    const { facts, significanceByFactId } = factsFromConversation({
      events: [event({
        kind: "promise",
        commitmentProposal: {
          actionKind: "payment",
          promisedResult: "two hundred talents toward the new legions",
          conditions: "",
          rationale: "",
          promisorCharacterId: "quintus-fabius",
          beneficiaryCharacterId: "marcus-atilius",
          requiredOfficeId: null,
          requiredResource: null,
          reviewInSteps: 6,
        },
      })],
      ...context(),
    });

    expect(facts[0]!.summary).toBe("Quintus Fabius promised Marcus Atilius: two hundred talents toward the new legions");
    // A promise weighs more than passing talk, so it pushes harder on pacing.
    expect(significanceByFactId.get(facts[0]!.id)).toBeGreaterThan(20);
  });

  it("weighs ordinary talk as near-noise", () => {
    const { facts, significanceByFactId } = factsFromConversation({ events: [event()], ...context() });
    expect(significanceByFactId.get(facts[0]!.id)).toBeLessThan(10);
  });

  it("carries a public exchange to everyone", () => {
    const { facts } = factsFromConversation({ events: [event({ visibility: "public" })], ...context() });
    expect(factsVisibleTo(facts, { kind: "character", id: "hanno" }, { day: 0, minute: 600 })).toHaveLength(1);
  });

  it("summarises from what was actually said when there is no promise", () => {
    const { facts } = factsFromConversation({
      events: [event({ relationCauses: [{ subjectCharacterId: "marcus-atilius", targetCharacterId: "quintus-fabius", label: "pressed him about the treasury", score: -5, decayPerYearBps: 1_000 }] })],
      ...context(),
    });
    expect(facts[0]!.summary).toContain("pressed him about the treasury");
  });
});
