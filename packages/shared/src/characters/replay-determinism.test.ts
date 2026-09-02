import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CharacterSocialEvent } from "./social-events";
import { applySocialEvents } from "./apply-social-events";
import { advancePressureLifecycle, derivePressureTriggers } from "./pressures";

// Replaying a committed turn -- the same unapplied events, the same
// already-applied outcomes -- must yield the same resulting character/social
// state every time (character-sim phase 2, extending the phase 1 pattern).

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function socialEvent(overrides: Partial<CharacterSocialEvent> = {}): CharacterSocialEvent {
  return {
    id: "event-1", gameId: "game-1", sourceTurnId: null, sourceSessionId: null, sourceMessageId: null,
    participantCharacterIds: ["marcus-atilius", "hanno"], kind: "insult", visibility: "private",
    knownByCharacterIds: ["marcus-atilius", "hanno"],
    relationCauses: [{ subjectCharacterId: "hanno", targetCharacterId: "marcus-atilius", label: "You publicly insulted him.", score: -12, decayPerYearBps: 2_000, dimensions: { affection: -15, respect: -8 } }],
    knowledgeClaims: [],
    proposedBeliefs: [{ subjectEntityId: null, claim: "Marcus insulted Hanno at the border.", kind: "rumour", channel: "event_participant", explicitRecipientCharacterIds: [], expiresInSteps: null }],
    pressureChanges: [{ characterId: "hanno", action: "create", kind: "humiliation", intensity: 55, label: "Publicly insulted.", reviewInSteps: 4, expiresInSteps: 20, visibility: "public" }],
    commitmentProposal: null, introducedCharacter: null, introducedProfile: null,
    createdAtStep: 3, appliedAtStep: null, appliedInTurnId: null, status: "proposed", rejectionReason: null,
    ...overrides,
  };
}

describe("replaying applySocialEvents", () => {
  it("produces byte-identical resulting character/social state given the same world and events", () => {
    const outcomeA = applySocialEvents(world(), [socialEvent()], 5, "turn-1");
    const outcomeB = applySocialEvents(world(), [socialEvent()], 5, "turn-1");
    expect(outcomeA.world).toEqual(outcomeB.world);
    expect(outcomeA.appliedIds).toEqual(outcomeB.appliedIds);
  });

  it("produces the same result whether pressure lifecycle advancement runs on the outcome once or is recomputed from scratch", () => {
    const outcome = applySocialEvents(world(), [socialEvent()], 5, "turn-1");
    const advancedA = advancePressureLifecycle(outcome.world, 9);
    const advancedB = advancePressureLifecycle(outcome.world, 9);
    expect(advancedA).toEqual(advancedB);
  });
});

describe("replaying derivePressureTriggers", () => {
  it("mints identical pressure-proposal ids for identical before/after states", () => {
    const charactersBefore = world().characters;
    const charactersAfter = charactersBefore.map((c) => (c.id === "marcus-atilius" ? { ...c, healthBps: c.healthBps - 3_000 } : c));
    const inputs = {
      atStep: 10,
      charactersBefore,
      charactersAfter,
      accountBalanceBefore: new Map<string, number>(),
      accountBalanceAfter: new Map<string, number>(),
      appliedSocialEvents: [{ id: "evt-1", kind: "insult", participantCharacterIds: ["marcus-atilius", "hanno"] }],
      failedOrCancelledCommitments: [],
      warringPolityIds: new Set(["rome", "carthage"]),
    };
    const a = derivePressureTriggers(inputs);
    const b = derivePressureTriggers(inputs);
    expect(a).toEqual(b);
  });
});
