import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CharacterSocialEvent } from "./social-events";
import { applySocialEvents } from "./apply-social-events";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

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
    proposedBeliefs: [],
    pressureChanges: [],
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

describe("applySocialEvents — character-sim phase 2 extensions", () => {
  it("grants a belief only to a witness/participant recipient, through the same idempotent path", () => {
    const event = baseEvent({
      relationCauses: [],
      proposedBeliefs: [{
        subjectEntityId: null,
        claim: "Hanno is short on funds.",
        kind: "rumour",
        channel: "event_participant",
        explicitRecipientCharacterIds: [],
        expiresInSteps: null,
      }],
    });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    expect(outcome.appliedIds).toEqual(["event-1"]);
    const beliefHolders = outcome.world.characterBeliefs.map((b) => b.holderCharacterId).sort();
    expect(beliefHolders).toEqual(["hanno", "marcus-atilius"]);

    // Applying the same already-applied event again produces no duplicate belief.
    const appliedEvent = { ...event, status: "applied" as const };
    const secondPass = applySocialEvents(outcome.world, [appliedEvent], 5, "turn-1");
    expect(secondPass.world.characterBeliefs).toHaveLength(outcome.world.characterBeliefs.length);
  });

  it("rejects a belief proposal naming a recipient outside the event", () => {
    const event = baseEvent({
      relationCauses: [],
      proposedBeliefs: [{
        subjectEntityId: null, claim: "X", kind: "secret", channel: "private_disclosure",
        explicitRecipientCharacterIds: ["some-uninvolved-character"], expiresInSteps: null,
      }],
    });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    expect(outcome.appliedIds).toEqual([]);
    expect(outcome.world.characterBeliefs).toEqual([]);
  });

  it("creates a pressure for a participant via a pressureChanges proposal", () => {
    const event = baseEvent({
      relationCauses: [],
      pressureChanges: [{
        characterId: "hanno", action: "create", kind: "humiliation", intensity: 55,
        label: "Publicly insulted.", reviewInSteps: 4, expiresInSteps: 20, visibility: "public",
      }],
    });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    const pressure = outcome.world.characterPressures.find((p) => p.characterId === "hanno");
    expect(pressure).toBeDefined();
    expect(pressure!.kind).toBe("humiliation");
    expect(outcome.world.characters.find((c) => c.id === "hanno")!.mind.currentPressures).toContain(pressure!.id);
  });

  it("rejects a pressure change referencing an unknown character", () => {
    const event = baseEvent({
      relationCauses: [],
      pressureChanges: [{
        characterId: "nobody", action: "create", kind: "debt", intensity: 40,
        label: "x", reviewInSteps: 4, expiresInSteps: null, visibility: "private",
      }],
    });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    expect(outcome.appliedIds).toEqual([]);
    expect(outcome.world.characterPressures).toEqual([]);
  });

  it("creates a typed social link alongside a relation cause when socialLinkKind is given", () => {
    const event = baseEvent({
      relationCauses: [
        { subjectCharacterId: "hanno", targetCharacterId: "marcus-atilius", label: "Sworn allies.", score: 15, decayPerYearBps: 0, socialLinkKind: "ally" },
      ],
    });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    const link = outcome.world.socialLinks.find((l) => l.subjectCharacterId === "hanno" && l.targetCharacterId === "marcus-atilius");
    expect(link?.kind).toBe("ally");
  });

  it("stores a cause's dimensions map so multidimensional derivation reads more than the legacy score", () => {
    const event = baseEvent({
      relationCauses: [
        { subjectCharacterId: "hanno", targetCharacterId: "marcus-atilius", label: "Threatened him.", score: -5, decayPerYearBps: 0, dimensions: { fear: 30, trust: -10 } },
      ],
    });
    const outcome = applySocialEvents(world(), [event], 5, "turn-1");
    const cause = outcome.world.characters.find((c) => c.id === "hanno")!.relations
      .find((r) => r.subjectCharacterId === "marcus-atilius")!.causes[0]!;
    expect(cause.dimensions).toEqual({ fear: 30, trust: -10 });
  });
});
