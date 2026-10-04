import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type OrderPart, type WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";
import { lineOf } from "./order-outcomes";
import { scoreOrders, scoreProse } from "./scorecard";
import { runScorecard } from "./scorecard-fixtures";

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const part = (change: Partial<OrderPart>): OrderPart => ({
  said: "Carry Legio I to Messana", goals: [], workRefs: [], refusal: null, note: null, whyNot: null, factIds: [],
  stages: [], spend: null, attribution: "tagged", closedAtStep: null, refusedAtStep: null, actsCarried: 0, actsRefused: 0, ...change,
});
const withParts = (parts: OrderPart[]): WorldState => ({
  ...opening(), orders: [{ id: "rec", actorCharacterId: "gaius-genucius", text: "x", givenAtStep: 0, parts }],
});
const entry = (body: string, quote: ChronicleEntry["quote"] = null): ChronicleEntry => ({
  kind: "narrated", title: "t", body, factIds: [], subjects: [], tags: [], changes: [], quote, fromInstantSortKey: 0, toInstantSortKey: 0,
});

describe("the order scorecard", () => {
  it("counts an act carried with nothing to check it against as unverified, not as done", () => {
    const score = scoreOrders(withParts([part({ actsCarried: 1 })]));
    expect(score.unverified).toBe(1);
    expect(score.doneWithoutEvidence).toBe(0);
  });

  it("counts a part whose goal already holds as matched: it has evidence behind its word", () => {
    const legion = opening().material.forces.find((force) => force.id === "roman-field-army")!;
    const score = scoreOrders(withParts([part({ goals: [{ kind: "force_at", forceId: legion.id, provinceId: legion.locationId }], actsCarried: 1 })]));
    expect(score.matched).toBe(1);
    expect(score.doneWithoutEvidence).toBe(0);
  });

  it("counts a held stage with no review date", () => {
    const stage = { held: { op: "force_modify" }, waitsOn: [{ kind: "procedure_passed" as const, procedureId: "p" }], status: "waiting" as const, reason: null, heldSinceStep: 0, failedAtStep: null, reviewAtStep: null };
    expect(scoreOrders(withParts([part({ stages: [stage] })])).waitingWithoutReview).toBe(1);
  });

  it("runs its fixtures with a told outcome for every part", async () => {
    const cards = await runScorecard();
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.orders.parts.length).toBeGreaterThan(0);
      expect(card.orders.doneWithoutEvidence).toBe(0);
      expect(card.orders.erasedFailures).toBe(0);
    }
  });
});

describe("a part told done", () => {
  // Plan chronicle-and-order-truth, 1.5: no "done" without what the world shows.
  it("cites the place the world shows the army at", () => {
    const legion = opening().material.forces.find((force) => force.id === "roman-field-army")!;
    const done = part({ goals: [{ kind: "force_at", forceId: legion.id, provinceId: legion.locationId }], actsCarried: 1 });
    expect(lineOf(opening(), done, "gaius-genucius")).toContain(`done: ${legion.name} at `);
  });
});

describe("the prose scorecard", () => {
  it("counts clerk phrases per thousand words, moral endings and quotes", () => {
    const quote = { speaker: "x", text: "y" } as unknown as ChronicleEntry["quote"];
    const score = scoreProse([
      entry("The legion was recorded as having crossed. Time would tell what it cost.", quote),
      entry("Hieron sent grain. The harbour filled."),
      { ...entry("Recorded."), kind: "recorded" },
    ]);
    expect(score.entries).toBe(2);
    expect(score.clerkPhrases).toBe(1);
    expect(score.endingsWithMoralOrForecast).toBe(1);
    expect(score.entriesWithQuote).toBe(1);
    expect(score.clerkWordsPer1000).toBeGreaterThan(0);
  });

  it("does not score the engine's own outcome lines as prose", () => {
    const body = "Hieron sent grain.\n\nWhat came of the order:\n- \"x\" -- done (was recorded as done).";
    expect(scoreProse([entry(body)]).clerkPhrases).toBe(0);
  });
});
