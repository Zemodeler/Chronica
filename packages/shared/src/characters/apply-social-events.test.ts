import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CharacterSocialEvent } from "./social-events";
import { applySocialEvents } from "./apply-social-events";
import { EntityIdSchema } from "../material-state";

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
    observedTraits: [],
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

  it("carries a rumour along the source's social links, which it never used to", () => {
    // resolveRecipients has always spread ordinary_rumour to up to four of the
    // source's social links. The one callsite passed [], so the only broad
    // channel in the knowledge model reached nobody at all.
    const state = world();
    const linked = {
      ...state,
      socialLinks: [
        { id: "l1", subjectCharacterId: "marcus-atilius", targetCharacterId: "quintus-ogulnius", kind: "friend" as const, visibility: "public" as const, sourceEventId: null, createdAtStep: 0 },
        { id: "l2", subjectCharacterId: "manius-curius", targetCharacterId: "marcus-atilius", kind: "client" as const, visibility: "public" as const, sourceEventId: null, createdAtStep: 0 },
      ],
    };
    const event = baseEvent({
      relationCauses: [],
      proposedBeliefs: [{
        subjectEntityId: "hanno",
        claim: "Hanno is short on funds.",
        kind: "rumour",
        channel: "ordinary_rumour",
        explicitRecipientCharacterIds: [],
        expiresInSteps: null,
      }],
    });
    const holders = applySocialEvents(linked, [event], 5, "turn-1").world.characterBeliefs
      .map((b) => b.holderCharacterId).sort();
    expect(holders.length).toBeGreaterThan(0);
    // Both directions of a link count: the source's friend and the source's client.
    expect(holders).toContain("quintus-ogulnius");
    expect(holders).toContain("manius-curius");
    // Never back to the person it came from.
    expect(holders).not.toContain("marcus-atilius");
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

describe("the people around you deciding what you are", () => {
  it("records one person's judgment without making it true", () => {
    const outcome = applySocialEvents(world(), [baseEvent({
      kind: "conversation",
      observedTraits: [{ subjectCharacterId: "marcus-atilius", observerCharacterId: "hanno", traitId: "bold", note: "He crossed before dawn." }],
    })], 5, "turn-1");
    expect(outcome.appliedIds).toHaveLength(1);
    expect(outcome.traitsConfirmed).toHaveLength(0);
    expect(outcome.world.traitObservations).toHaveLength(1);
    expect(outcome.world.characters.find((character) => character.id === "marcus-atilius")!.traits).not.toContain("bold");
  });

  it("makes it true, and says so, once a second person agrees", () => {
    const first = applySocialEvents(world(), [baseEvent({
      id: "event-a", kind: "conversation",
      observedTraits: [{ subjectCharacterId: "marcus-atilius", observerCharacterId: "hanno", traitId: "bold", note: "He crossed before dawn." }],
    })], 5, "turn-1");
    const second = applySocialEvents(first.world, [baseEvent({
      id: "event-b", kind: "conversation",
      participantCharacterIds: ["marcus-atilius", "quintus-fabius"],
      knownByCharacterIds: ["marcus-atilius", "quintus-fabius"],
      relationCauses: [],
      observedTraits: [{ subjectCharacterId: "marcus-atilius", observerCharacterId: "quintus-fabius", traitId: "bold", note: "He never waits for the Senate." }],
    })], 9, "turn-2");

    expect(second.traitsConfirmed).toHaveLength(1);
    expect(second.world.characters.find((character) => character.id === "marcus-atilius")!.traits).toContain("bold");
  });

  it("ignores a judgment from somebody who was not there", () => {
    // A trait is what somebody saw, not what they heard.
    const outcome = applySocialEvents(world(), [baseEvent({
      kind: "conversation",
      observedTraits: [{ subjectCharacterId: "marcus-atilius", observerCharacterId: "quintus-fabius", traitId: "bold", note: "I hear he is rash." }],
    })], 5, "turn-1");
    expect(outcome.world.traitObservations).toHaveLength(0);
    // And the event itself still applies: one bad observation is not a failure.
    expect(outcome.appliedIds).toHaveLength(1);
  });
});

describe("ids that have to fit", () => {
  it("keeps every generated id inside the schema, with real ids in it", () => {
    // From a live game. Built by concatenation these ran past
    // `EntityIdSchema`'s 120 characters the moment real ids were involved, and
    // the whole batch was rejected with "characters.21.relations.0.causes.0.id:
    // Too big" -- which names neither the event, nor the people, nor the
    // cause. It threw away a battle.
    const long = "declared-e31f3101-57a1-442c-858b-4a7583bf54a9";
    const longer = "character-3d67e6fd-4aee-43ac-b28b-18481bebd754-15";
    const state = world();
    const withBoth = {
      ...state,
      characters: state.characters.map((character, index) => (index === 0
        ? { ...character, id: long }
        : index === 1 ? { ...character, id: longer } : character)),
    };
    const outcome = applySocialEvents(withBoth, [baseEvent({
      id: "social-3d67e6fd-4aee-43ac-b28b-18481bebd754-12",
      participantCharacterIds: [long, longer],
      knownByCharacterIds: [long, longer],
      relationCauses: [{
        subjectCharacterId: long, targetCharacterId: longer,
        label: "He would not do as I asked.", score: -8, decayPerYearBps: 1_500,
        socialLinkKind: "rival",
      }],
    })], 5, "turn-long");

    expect(outcome.rejectedIds).toEqual([]);
    expect(outcome.appliedIds).toHaveLength(1);
    const subject = outcome.world.characters.find((character) => character.id === long)!;
    const cause = subject.relations[0]!.causes[0]!;
    expect(cause.id.length).toBeLessThanOrEqual(120);
    for (const link of outcome.world.socialLinks) expect(link.id.length).toBeLessThanOrEqual(120);
    // And the ids themselves parse, which is what the batch check was failing on.
    for (const check of [cause.id, ...outcome.world.socialLinks.map((link) => link.id)]) {
      expect(EntityIdSchema.safeParse(check).success).toBe(true);
    }
  });
});
