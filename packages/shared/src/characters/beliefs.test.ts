import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CHANNEL_DEFAULTS,
  addOrReinforceBelief,
  expireBeliefs,
  queryBeliefs,
  investigateBelief,
  reduceConfidence,
  resolveRecipients,
  supersedeBelief,
} from "./beliefs";

describe("resolveRecipients", () => {
  it("grants a direct_witness belief only to the witnesses", () => {
    const recipients = resolveRecipients({
      channel: "direct_witness",
      participantCharacterIds: ["a", "b"],
      witnessCharacterIds: ["c"],
      sourceCharacterId: "a",
      sourceSocialLinkTargetIds: ["d", "e"],
      explicitRecipientIds: [],
    });
    expect(recipients).toEqual(["c"]);
  });

  it("never resolves a broad recipient list for a secret channel — only explicitly named recipients", () => {
    const recipients = resolveRecipients({
      channel: "intercepted_secret",
      participantCharacterIds: ["a", "b", "c", "d"],
      witnessCharacterIds: ["a", "b", "c", "d"],
      sourceCharacterId: "a",
      sourceSocialLinkTargetIds: ["x", "y", "z"],
      explicitRecipientIds: ["b"],
    });
    expect(recipients).toEqual(["b"]);
  });

  it("bounds ordinary_rumour recipients to the source's own social-link contacts, capped and deterministic", () => {
    const recipients = resolveRecipients({
      channel: "ordinary_rumour",
      participantCharacterIds: [],
      witnessCharacterIds: [],
      sourceCharacterId: "a",
      sourceSocialLinkTargetIds: ["e", "b", "d", "c", "a"],
      explicitRecipientIds: [],
    });
    expect(recipients).toEqual(["a", "b", "c", "d"]);
  });
});

describe("addOrReinforceBelief and confidence", () => {
  it("gives a direct witness higher confidence than an ordinary rumour recipient for the same claim", () => {
    const empty = { characterBeliefs: [] };
    const witness = addOrReinforceBelief(empty, {
      id: "b1", holderCharacterId: "witness", subjectEntityId: null, claim: "The bridge is out.",
      kind: "fact", sourceCharacterId: null, sourceEventId: "evt-1", channel: "direct_witness", atStep: 1, expiresInSteps: null,
    });
    const rumour = addOrReinforceBelief(empty, {
      id: "b2", holderCharacterId: "rumour-hearer", subjectEntityId: null, claim: "The bridge is out.",
      kind: "rumour", sourceCharacterId: "witness", sourceEventId: "evt-1", channel: "ordinary_rumour", atStep: 1, expiresInSteps: 10,
    });
    expect(witness.characterBeliefs[0]!.confidence).toBeGreaterThan(rumour.characterBeliefs[0]!.confidence);
    expect(witness.characterBeliefs[0]!.confidence).toBe(KNOWLEDGE_CHANNEL_DEFAULTS.direct_witness.defaultConfidence);
  });

  it("reinforces an identical existing belief instead of duplicating it", () => {
    const first = addOrReinforceBelief({ characterBeliefs: [] }, {
      id: "b1", holderCharacterId: "h", subjectEntityId: null, claim: "X is true.",
      kind: "rumour", sourceCharacterId: null, sourceEventId: null, channel: "ordinary_rumour", atStep: 1, expiresInSteps: null,
    });
    const second = addOrReinforceBelief(first, {
      id: "b2", holderCharacterId: "h", subjectEntityId: null, claim: "X is true.",
      kind: "rumour", sourceCharacterId: null, sourceEventId: null, channel: "trusted_report", atStep: 2, expiresInSteps: null,
    });
    expect(second.characterBeliefs).toHaveLength(1);
    expect(second.characterBeliefs[0]!.confidence).toBeGreaterThan(first.characterBeliefs[0]!.confidence);
  });
});

describe("reduceConfidence", () => {
  it("lowers confidence without changing anything else", () => {
    const withBelief = addOrReinforceBelief({ characterBeliefs: [] }, {
      id: "b1", holderCharacterId: "h", subjectEntityId: null, claim: "X", kind: "suspicion",
      sourceCharacterId: null, sourceEventId: null, channel: "ordinary_rumour", atStep: 1, expiresInSteps: null,
    });
    const reduced = reduceConfidence(withBelief, "b1", 20);
    expect(reduced.characterBeliefs[0]!.confidence).toBe(withBelief.characterBeliefs[0]!.confidence - 20);
  });
});

describe("investigateBelief", () => {
  it("raises confidence by a fixed amount, capped at 100", () => {
    const withBelief = addOrReinforceBelief({ characterBeliefs: [] }, {
      id: "b1", holderCharacterId: "h", subjectEntityId: null, claim: "X", kind: "suspicion",
      sourceCharacterId: null, sourceEventId: null, channel: "ordinary_rumour", atStep: 1, expiresInSteps: null,
    });
    const investigated = investigateBelief(withBelief, "b1");
    expect(investigated.characterBeliefs[0]!.confidence).toBe(withBelief.characterBeliefs[0]!.confidence + 20);

    const nearCeiling = investigateBelief({ characterBeliefs: [{ ...withBelief.characterBeliefs[0]!, confidence: 90 }] }, "b1");
    expect(nearCeiling.characterBeliefs[0]!.confidence).toBe(100);
  });
});

describe("supersedeBelief", () => {
  it("marks the old belief superseded rather than deleting it, preserving history", () => {
    const original = addOrReinforceBelief({ characterBeliefs: [] }, {
      id: "b1", holderCharacterId: "h", subjectEntityId: "topic", claim: "The king is alive.",
      kind: "fact", sourceCharacterId: null, sourceEventId: null, channel: "ordinary_rumour", atStep: 1, expiresInSteps: null,
    });
    const superseded = supersedeBelief(original, "b1", {
      id: "b2", holderCharacterId: "h", subjectEntityId: "topic", claim: "The king is dead.",
      kind: "fact", sourceCharacterId: null, sourceEventId: "evt-2", channel: "trusted_report", atStep: 5, expiresInSteps: null,
    });
    const old = superseded.characterBeliefs.find((b) => b.id === "b1")!;
    const replacement = superseded.characterBeliefs.find((b) => b.claim === "The king is dead.")!;
    expect(old.status).toBe("superseded");
    expect(replacement.supersedesBeliefIds).toContain("b1");
  });
});

describe("expireBeliefs", () => {
  it("expires only beliefs whose expiresAtStep has come due", () => {
    const w = addOrReinforceBelief({ characterBeliefs: [] }, {
      id: "b1", holderCharacterId: "h", subjectEntityId: null, claim: "Old rumour.", kind: "rumour",
      sourceCharacterId: null, sourceEventId: null, channel: "ordinary_rumour", atStep: 1, expiresInSteps: 3,
    });
    const notYet = expireBeliefs(w, 3);
    expect(notYet.characterBeliefs[0]!.status).toBe("active");
    const expired = expireBeliefs(w, 4);
    expect(expired.characterBeliefs[0]!.status).toBe("expired");
  });
});

describe("queryBeliefs", () => {
  it("returns only active beliefs for the holder, narrowed by subject when given", () => {
    const w = addOrReinforceBelief(
      addOrReinforceBelief({ characterBeliefs: [] }, {
        id: "b1", holderCharacterId: "h", subjectEntityId: "topic-a", claim: "A", kind: "fact",
        sourceCharacterId: null, sourceEventId: null, channel: "direct_witness", atStep: 1, expiresInSteps: null,
      }),
      { id: "b2", holderCharacterId: "h", subjectEntityId: "topic-b", claim: "B", kind: "fact",
        sourceCharacterId: null, sourceEventId: null, channel: "direct_witness", atStep: 1, expiresInSteps: null },
    );
    expect(queryBeliefs(w, "h").map((b) => b.id).sort()).toEqual(["b1", "b2"]);
    expect(queryBeliefs(w, "h", "topic-a").map((b) => b.id)).toEqual(["b1"]);
    expect(queryBeliefs(w, "someone-else")).toEqual([]);
  });
});
