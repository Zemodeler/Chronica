import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import type { CharacterSocialEvent } from "./social-events";
import { applySocialEvents } from "./apply-social-events";

const world = () => structuredClone(firstPunicWarScenario.initialWorld) as WorldState;

function baseEvent(overrides: Partial<CharacterSocialEvent> = {}): CharacterSocialEvent {
  return {
    id: "event-1",
    gameId: "game-1",
    sourceTurnId: null,
    sourceSessionId: null,
    sourceMessageId: null,
    participantCharacterIds: ["marcus-atilius", "hanno"],
    kind: "insult",
    visibility: "private",
    knownByCharacterIds: ["marcus-atilius", "hanno"],
    relationCauses: [
      { subjectCharacterId: "hanno", targetCharacterId: "marcus-atilius", label: "You publicly insulted him.", score: -12, decayPerYearBps: 2_000 },
    ],
    knowledgeClaims: [],
    commitmentProposal: null,
    introducedCharacter: null,
    introducedProfile: null,
    createdAtStep: 3,
    appliedAtStep: null,
    appliedInTurnId: null,
    status: "proposed",
    rejectionReason: null,
    ...overrides,
  };
}

describe("applySocialEvents", () => {
  it("appends exactly one relation cause to the subject's directed view of the target", () => {
    const outcome = applySocialEvents(world(), [baseEvent()], 5, "turn-1");
    expect(outcome.appliedIds).toEqual(["event-1"]);
    const hanno = outcome.world.characters.find((c) => c.id === "hanno")!;
    const relation = hanno.relations.find((r) => r.subjectCharacterId === "marcus-atilius")!;
    expect(relation.causes).toHaveLength(1);
    expect(relation.causes[0]!.score).toBe(-12);
    expect(relation.causes[0]!.occurredAtStep).toBe(5);
  });

  it("records one encounter memory per applied event", () => {
    const outcome = applySocialEvents(world(), [baseEvent()], 5, "turn-1");
    expect(outcome.world.encounters).toHaveLength(1);
    expect(outcome.world.encounters[0]!.id).toBe("event-1");
  });

  it("appends a brand-new character for a discovery event and its profile for the caller to persist", () => {
    const introduced = {
      ...world().characters[0]!,
      id: "npc:discovered:abc123",
      name: "A New Contact",
    };
    const event = baseEvent({
      id: "event-2",
      kind: "discovery",
      participantCharacterIds: ["marcus-atilius", "npc:discovered:abc123"],
      relationCauses: [],
      introducedCharacter: introduced,
      introducedProfile: {
        gameId: "game-1",
        characterId: "npc:discovered:abc123",
        version: 1,
        roleLabel: "Grain merchant",
        biography: null,
        voiceSummary: null,
        presentationDetails: {},
        updatedAtStep: 3,
      },
    });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    expect(outcome.appliedIds).toEqual(["event-2"]);
    expect(outcome.world.characters.some((c) => c.id === "npc:discovered:abc123")).toBe(true);
    expect(outcome.introducedProfiles).toHaveLength(1);
  });

  it("rejects an event that references an unknown participant", () => {
    const event = baseEvent({ participantCharacterIds: ["marcus-atilius", "nobody"] });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    expect(outcome.appliedIds).toEqual([]);
    expect(outcome.rejectedIds).toEqual([{ id: "event-1", reason: 'Unknown participant "nobody".' }]);
  });

  it("skips events that are not in proposed status, so an already-applied event can never be applied twice", () => {
    const event = baseEvent({ status: "applied" });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    expect(outcome.appliedIds).toEqual([]);
    expect(outcome.world.encounters).toHaveLength(0);
  });

  it("never touches material state", () => {
    const before = world();
    const outcome = applySocialEvents(before, [baseEvent()], 5, "turn-1");
    expect(outcome.world.material).toBe(before.material);
  });
});
