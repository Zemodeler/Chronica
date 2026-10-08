import { describe, expect, it } from "vitest";
import { OrderPartSchema, ordersUnderWay, type OrderRecord, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { opening } from "./fiscal-test-kit";
import { orderOutcomeLines } from "./order-outcomes";
import { refusalInPeriodWords } from "./order-lines";

/**
 * "Refused." and nothing more, under a bid for the tribunate whose answer was
 * "standing 1,600 of 3,000 required"; and a proposal to the Senate refused
 * with "Nobody in Roman field army could remember appointing him". An order
 * refused says why, in the words of the age, wherever it is listed.
 */

const PLAYER = "gaius-genucius";

function refusedCandidacy(): { world: WorldState; orderId: string } {
  const base = opening(150);
  const body = base.material.institutions[0]!;
  const procedure = {
    id: "nomination-1", type: "nomination", institutionId: body.id, sponsorCharacterId: PLAYER, subjectKind: "character", subjectId: PLAYER, label: "Gaius Genucius stands for military tribune",
    eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote", openedAtStep: 100, deadlineStep: 140, resolvedAtStep: 100, visibility: "polity",
    voteRecordId: null, outcome: "failed", outcomeReason: "Not admitted: Gaius Genucius stands too low: standing 1,600 of 3,000 required.", sourceEventIds: [], resultingEventIds: [], concerns: [],
  } as unknown as PoliticalProcedure;
  const order: OrderRecord = {
    id: "order-1", actorCharacterId: PLAYER, text: "I stand as a candidate for military tribune.", givenAtStep: 100,
    parts: [OrderPartSchema.parse({ said: "I stand as a candidate for military tribune at the next election.", workRefs: [{ kind: "procedure", id: "nomination-1" }] })],
  };
  return { world: { ...base, orders: [order], material: { ...base.material, politicalProcedures: [...base.material.politicalProcedures, procedure] } }, orderId: "order-1" };
}

describe("a refusal", () => {
  it("says why in the line of the order", () => {
    const { world, orderId } = refusedCandidacy();
    expect(orderOutcomeLines(world, orderId)[0]).toMatch(/refused: .*standing 1,600 of 3,000 required/);
  });

  it("says why in the list of what is under way", () => {
    const { world } = refusedCandidacy();
    const item = ordersUnderWay(world, PLAYER).find((candidate) => candidate.kind === "order");
    expect(item?.detail).toMatch(/standing 1,600 of 3,000 required/);
  });

  it("does not tell a man who proposed a motion that nobody remembers appointing him", () => {
    const world = opening(150);
    const part = { said: "I propose to the Senate that the army be sent against Rhegium", workRefs: [] };
    const engine = "Nobody in Roman field army could remember appointing Titus Vettius to anything, and so nothing happened.";
    const private_ = refusalInPeriodWords(world, part, "a-private-man", engine);
    expect(private_).not.toMatch(/remember appointing/);
    expect(private_).toMatch(/no seat/);
    // A man who commands an army is told what is true of him, which is not that.
    expect(refusalInPeriodWords(world, { said: "March the army to Rhegium", workRefs: [] }, PLAYER, engine)).toBe(engine);
  });

  it("gives the reason of the man who refused, where an order was handed on and he said why", () => {
    const world = opening(150);
    const attempt = { id: "att-1", actionId: "act-1", issuerRef: { kind: "character" as const, id: PLAYER }, recipientRef: { kind: "character" as const, id: "gnaeus-cornelius" }, claimedAuthorityGrantId: null,
      authorityCheck: { authorized: false, grant: null, standing: null, reason: "" }, instruction: "Find bread.", standing: "request" as never, status: "refused" as const,
      recipientDecisionReason: "Lucius Julius is nobody he owes a hearing.", issuedAtStep: 1, decidedAtStep: 2, consequenceFactRefs: [], servesRef: null, answerDueByStep: 10 };
    const said = refusalInPeriodWords({ ...world, orderAttempts: [attempt as never] }, { said: "Find supply for the army.", workRefs: [{ kind: "order_attempt", id: "att-1" }] }, PLAYER, null);
    expect(said).toBe("Lucius Julius is nobody he owes a hearing.");
  });
});
