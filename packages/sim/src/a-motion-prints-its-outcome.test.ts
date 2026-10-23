import { describe, expect, it } from "vitest";
import { OrderPartSchema, type OrderRecord, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { opening } from "./fiscal-test-kit";
import { orderOutcomeLines } from "./order-outcomes";

/**
 * A motion that passed printed no order line at all, and one that lapsed read
 * "refused". Each is now a line of its own, with the count the body gave.
 */

function withMotion(outcome: PoliticalProcedure["outcome"], reason: string): { world: WorldState; orderId: string } {
  const base = opening(150);
  const senate = base.material.institutions[0]!;
  const procedure = {
    id: "motion-1", type: "law_proposal", institutionId: senate.id, sponsorCharacterId: "gaius-genucius", subjectKind: "polity", subjectId: "rome", label: "Motion of Gaius Genucius: that a fleet be built",
    eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote", openedAtStep: 100, deadlineStep: 140, resolvedAtStep: 140, visibility: "polity",
    voteRecordId: null, outcome, outcomeReason: reason, sourceEventIds: [], resultingEventIds: [], concerns: [],
  } as unknown as PoliticalProcedure;
  const order: OrderRecord = {
    id: "order-1", actorCharacterId: "gaius-genucius", text: "I propose to the Senate that a fleet be built.", givenAtStep: 100,
    parts: [OrderPartSchema.parse({ said: "Propose to the Senate that a fleet be built.", workRefs: [{ kind: "procedure", id: "motion-1" }], actsCarried: 1 })],
  };
  return { world: { ...base, orders: [order], material: { ...base.material, politicalProcedures: [...base.material.politicalProcedures, procedure] } }, orderId: "order-1" };
}

describe("a motion", () => {
  it("that passed is told, with the count", () => {
    const { world, orderId } = withMotion("passed", "The Senate carried it, 52 for, 13 against, 34 abstaining.");
    const [line] = orderOutcomeLines(world, orderId);
    expect(line).toMatch(/carried, The Senate carried it, 52 for, 13 against, 34 abstaining/);
  });

  it("that failed is told, with the count", () => {
    const { world, orderId } = withMotion("failed", "The Senate rejected it, 1 for, 77 against.");
    const [line] = orderOutcomeLines(world, orderId);
    expect(line).toMatch(/refused: The Senate rejected it, 1 for, 77 against/);
  });

  it("that lapsed says it lapsed, and does not read as refused", () => {
    const { world, orderId } = withMotion("withdrawn", "Nothing more was done for it in 60 days.");
    const [line] = orderOutcomeLines(world, orderId);
    expect(line).toMatch(/-- lapsed/);
    expect(line).not.toMatch(/-- refused/);
  });
});
