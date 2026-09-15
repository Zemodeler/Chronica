import { describe, expect, it } from "vitest";
import { emitFacts, factsVisibleTo, type Fact, type FactDraft } from "./facts";

describe("emitFacts", () => {
  it("assigns ids to drafted facts without mutating the draft", () => {
    const draft: FactDraft = {
      time: { day: 1, minute: 0 },
      atStep: 0,
      kind: "test",
      summary: "Something happened.",
      affectedEntities: [],
      resourceChanges: [],
      visibility: "public",
      discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
      evidence: null,
      eligibleReactionScopes: [],
      sourceEventId: null,
      sourceActionId: null,
      causalDepth: 0,
    };
    const [emitted] = emitFacts([draft], () => "fixed-id");
    expect(emitted?.id).toBe("fixed-id");
    expect(emitted?.summary).toBe(draft.summary);
  });
});

describe("factsVisibleTo", () => {
  const observer = { kind: "character" as const, id: "char-2" };

  function privateFact(discoveredBy: Fact["discovery"]["discoveredBy"]): Fact {
    return {
      id: "fact-1",
      time: { day: 5, minute: 0 },
      atStep: 5,
      kind: "conspiracy",
      summary: "A secret plot was formed.",
      affectedEntities: [],
      resourceChanges: [],
      visibility: "private",
      discovery: { state: "private", knowableAtInstant: null, discoveredBy },
      evidence: null,
      eligibleReactionScopes: [],
      sourceEventId: null,
      sourceActionId: null,
      causalDepth: 0,
    };
  }

  it("always includes public facts", () => {
    const publicFact = { ...privateFact([]), visibility: "public" as const };
    expect(factsVisibleTo([publicFact], observer, { day: 5, minute: 0 })).toEqual([publicFact]);
  });

  it("hides a private fact from an observer who has not discovered it", () => {
    const fact = privateFact([]);
    expect(factsVisibleTo([fact], observer, { day: 100, minute: 0 })).toEqual([]);
  });

  it("hides a private fact from a different observer than the one who discovered it", () => {
    const fact = privateFact([{ observerRef: { kind: "character", id: "char-999" }, atInstant: { day: 1, minute: 0 }, via: "witnessed" }]);
    expect(factsVisibleTo([fact], observer, { day: 100, minute: 0 })).toEqual([]);
  });

  it("reveals a private fact once this observer has discovered it, and not before", () => {
    const fact = privateFact([{ observerRef: observer, atInstant: { day: 10, minute: 0 }, via: "investigation" }]);
    expect(factsVisibleTo([fact], observer, { day: 5, minute: 0 })).toEqual([]);
    expect(factsVisibleTo([fact], observer, { day: 10, minute: 0 })).toEqual([fact]);
    expect(factsVisibleTo([fact], observer, { day: 20, minute: 0 })).toEqual([fact]);
  });
});
