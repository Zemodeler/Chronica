import { describe, expect, it } from "vitest";
import { ScenarioClockSchema, emitFacts, factsKnownTo, type Fact, type FactDraft } from "@chronica/shared";
import { composeChronicle } from "./chronicle";
import type { SimModelPort } from "./ports";

const clock = ScenarioClockSchema.parse({ epoch: { year: 264, month: 3, day: 1, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 });

let factCounter = 0;

function fact(overrides: Partial<FactDraft>): Fact {
  const draft: FactDraft = {
    time: { day: 0, minute: 0 },
    atStep: 0,
    kind: "event",
    summary: "Something happened.",
    affectedEntities: [],
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
  return emitFacts([draft], () => `fact-${(factCounter += 1)}`)[0]!;
}

/** Captures what the historian was actually shown. */
function capturingPort(): SimModelPort & { lastUserMessage: string } {
  const port = {
    lastUserMessage: "",
    complete(_operation: Parameters<SimModelPort["complete"]>[0], _system: string, user: string) {
      port.lastUserMessage = user;
      return Promise.resolve("In the spring, Rome began to raise new legions.");
    },
  };
  return port;
}

describe("chronicle", () => {
  it("never shows the historian a fact the observer has not discovered", async () => {
    // VISION §25: the simulation knowing a senator is plotting is not a reason
    // for the Chronicle to say so.
    const port = capturingPort();
    const facts = [
      fact({ kind: "mobilization", summary: "Rome begins raising two new legions." }),
      fact({ kind: "conspiracy", summary: "A senator begins quietly courting the army's officers.", visibility: "private", discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] } }),
    ];

    const result = await composeChronicle({
      port,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts,
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [],
      frictions: [],
    });

    expect(port.lastUserMessage).toContain("raising two new legions");
    expect(port.lastUserMessage).not.toContain("courting the army's officers");
    expect(result.factIds).toHaveLength(1);
  });

  it("titles the passage with the period it covers", async () => {
    const result = await composeChronicle({
      port: capturingPort(),
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [fact({})],
      from: { day: 0, minute: 0 },
      to: { day: 31, minute: 0 },
      narrative: [],
      frictions: [],
    });
    expect(result.title).toBe("1 March 264 BC – 1 April 264 BC");
  });

  it("keeps the record when the narration call fails", async () => {
    const failing: SimModelPort = { complete: () => Promise.reject(new Error("provider unavailable")) };
    const result = await composeChronicle({
      port: failing,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [fact({ summary: "Rome begins raising two new legions." })],
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [],
      frictions: [],
    });
    expect(result.body).toContain("raising two new legions");
  });

  it("says plainly that nothing happened rather than inventing a period", async () => {
    const port = capturingPort();
    const result = await composeChronicle({
      port,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [],
      from: { day: 0, minute: 0 },
      to: { day: 5, minute: 0 },
      narrative: [],
      frictions: [],
    });
    expect(result.calls).toBe(0);
    expect(result.body).toContain("Nothing of note");
  });
});

describe("what a government knows of its own business", () => {
  it("tells the ruler what their own polity did", () => {
    // Facts scoped to a polity were invisible to everyone, including that
    // polity, so a government's own dispatches never reached it and whole
    // periods came back as "nothing of note was recorded".
    const dispatch = fact({
      kind: "diplomatic_dispatch",
      summary: "The consul has sent an envoy to Messana.",
      visibility: "polity",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      discovery: { state: "polity", knowableAtInstant: null, discoveredBy: [] },
    });

    expect(factsKnownTo([dispatch], { kind: "character", id: "marcus-atilius" }, "rome", { day: 1, minute: 0 })).toHaveLength(1);
  });

  it("does not tell a foreign ruler the same thing", () => {
    const dispatch = fact({
      kind: "diplomatic_dispatch",
      summary: "The consul has sent an envoy to Messana.",
      visibility: "polity",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      discovery: { state: "polity", knowableAtInstant: null, discoveredBy: [] },
    });

    expect(factsKnownTo([dispatch], { kind: "character", id: "hanno" }, "carthage", { day: 1, minute: 0 })).toHaveLength(0);
  });

  it("still keeps a secret from the ruler's own polity", () => {
    const plot = fact({
      kind: "conspiracy",
      summary: "A senator courts the army's officers.",
      visibility: "private",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] },
    });

    expect(factsKnownTo([plot], { kind: "character", id: "marcus-atilius" }, "rome", { day: 1, minute: 0 })).toHaveLength(0);
  });
});
