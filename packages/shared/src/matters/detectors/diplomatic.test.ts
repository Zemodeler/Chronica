import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { deriveWorldInstant, type WorldState } from "@chronica/shared";
import { executeWorkflow } from "../../workflows/executor";
import { advanceWorldMatters } from "../advance";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function at(step: number) {
  return deriveWorldInstant(step);
}

function withPendingMessage(): WorldState {
  const outcome = executeWorkflow(
    {
      actionId: "send_diplomatic_message",
      actorId: "hanno",
      parameters: {
        messageId: "msg-1",
        kind: "peace_offer",
        fromPolityId: "carthage",
        fromCharacterId: "hanno",
        toPolityId: "rome",
        toCharacterId: "marcus-atilius",
        subject: "A negotiated peace",
        terms: "Carthage offers to withdraw from Sicily in exchange for an end to the war.",
        replyDueByStep: 10,
      },
    },
    world(),
    1,
  );
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error("fixture setup failed");
  return outcome.world;
}

describe("diplomatic matter detector (docs/plans/ai-world-matters-runtime.md, Phase 7)", () => {
  it("detects a treaty_review matter for an unanswered message, naming both parties as stakeholders", () => {
    const w = withPendingMessage();
    const result = advanceWorldMatters(w, at(1), 1);
    const matter = result.world.worldMatters!.find((m) => m.id === "treaty-review:msg-1")!;
    expect(matter).toBeDefined();
    expect(matter.sourceRef).toEqual({ kind: "diplomatic_message", id: "msg-1" });
    expect(matter.stakeholderRefs).toEqual(expect.arrayContaining([
      { kind: "character", id: "marcus-atilius" },
      { kind: "character", id: "hanno" },
      { kind: "polity", id: "rome" },
    ]));
  });

  it("marks the matter overdue once the reply deadline passes", () => {
    const w = withPendingMessage();
    const result = advanceWorldMatters(w, at(10), 10);
    const matter = result.world.worldMatters!.find((m) => m.id === "treaty-review:msg-1")!;
    expect(matter.status).toBe("overdue");
  });

  it("resolves the matter once the message is actually answered", () => {
    const w = withPendingMessage();
    const first = advanceWorldMatters(w, at(1), 1);
    expect(first.world.worldMatters!.some((m) => m.id === "treaty-review:msg-1" && m.status !== "cancelled")).toBe(true);

    const answered = executeWorkflow(
      { actionId: "answer_diplomatic_message", actorId: "marcus-atilius", parameters: { messageId: "msg-1", answer: "accepted", answeredByCharacterId: "marcus-atilius", answerText: "Rome accepts." } },
      first.world,
      2,
    );
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const second = advanceWorldMatters(answered.world, at(2), 2);
    const matter = second.world.worldMatters!.find((m) => m.id === "treaty-review:msg-1")!;
    expect(matter.status).toBe("cancelled");
  });

  it("never mutates world.diplomacy -- detection is pure and produces matters only", () => {
    const w = withPendingMessage();
    const before = structuredClone(w.diplomacy);
    advanceWorldMatters(w, at(1), 1);
    expect(w.diplomacy).toEqual(before);
  });
});
