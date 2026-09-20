import { describe, expect, it } from "vitest";
import type { AuthorityCheckResult } from "./authority-grant";
import {
  abandonOrderAttempt,
  completeOrderAttempt,
  decideOrderAttempt,
  issueOrderAttempt,
  receiveOrderAttempt,
  recordOrderAttemptConsequences,
  type OrderAttempt,
  type OrderStanding,
} from "./order-attempt";

const authorized: AuthorityCheckResult = { authorized: true, grant: null, standing: "lawful", reason: "Authorized by office grant." };
const unauthorized: AuthorityCheckResult = { authorized: false, grant: null, standing: null, reason: "No command grant over this force." };

function baseAttempt(authorityCheck: AuthorityCheckResult, standing: OrderStanding = "binding"): OrderAttempt {
  return issueOrderAttempt({
    id: "attempt-1",
    actionId: "action-1",
    issuerRef: { kind: "character", id: "soldier-1" },
    recipientRef: { kind: "character", id: "commander-1" },
    claimedAuthorityGrantId: null,
    authorityCheck,
    instruction: "Hold the strait and let nothing cross.",
    standing,
    issuedAtStep: 1,
  });
}

describe("issueOrderAttempt", () => {
  it("starts at status issued, with no decision yet", () => {
    const attempt = baseAttempt(authorized);
    expect(attempt.status).toBe("issued");
    expect(attempt.decidedAtStep).toBeNull();
  });
});

describe("receiveOrderAttempt", () => {
  it("moves issued -> received", () => {
    expect(receiveOrderAttempt(baseAttempt(authorized)).status).toBe("received");
  });

  it("refuses to receive an attempt that is not issued", () => {
    const received = receiveOrderAttempt(baseAttempt(authorized));
    expect(() => receiveOrderAttempt(received)).toThrow(/only an issued/i);
  });
});

describe("decideOrderAttempt: the garrison-gate case (docs/32 test plan)", () => {
  it("a lawful order the recipient accepts is recorded as accepted", () => {
    const received = receiveOrderAttempt(baseAttempt(authorized));
    const decided = decideOrderAttempt(received, "accept", "The commander recognizes the consul's authority.", 2);
    expect(decided.status).toBe("accepted");
    expect(decided.decidedAtStep).toBeNull(); // accepted is not yet terminal -- carried_out/abandoned follows
  });

  it("an unauthorized order the recipient refuses is recorded as refused, not silently applied", () => {
    const received = receiveOrderAttempt(baseAttempt(unauthorized));
    const decided = decideOrderAttempt(received, "refuse", "No command authority over this garrison.", 2);
    expect(decided.status).toBe("refused");
    expect(decided.decidedAtStep).toBe(2);
  });

  it("the commander can delay instead of deciding outright", () => {
    const received = receiveOrderAttempt(baseAttempt(unauthorized));
    const decided = decideOrderAttempt(received, "delay", "Awaiting confirmation from the Senate.", 2);
    expect(decided.status).toBe("delayed");
    expect(decided.decidedAtStep).toBeNull();
  });

  it("a commander complying with somebody who had no business commanding him is recorded as SUBVERTED, never accepted -- the order can never silently gain lawful power", () => {
    const received = receiveOrderAttempt(baseAttempt(unauthorized, "presumptuous"));
    const decided = decideOrderAttempt(received, "accept", "The commander is sympathetic to the soldier's cause.", 2);
    expect(decided.status).toBe("subverted");
    expect(decided.status).not.toBe("accepted");
    expect(decided.decidedAtStep).toBe(2);
  });

  it("a lawful order the recipient chooses to accept is never reclassified as subverted", () => {
    const received = receiveOrderAttempt(baseAttempt(authorized));
    const decided = decideOrderAttempt(received, "accept", "A lawful command.", 2);
    expect(decided.status).toBe("accepted");
  });

  it("granting a request from somebody who was asking is agreement, not subversion", () => {
    // The coercion used to fire on every unauthorized attempt, which under the
    // standing model is every willingly granted request -- so a quartermaster
    // who agreed to a merchant's reasonable ask was recorded as subverting the
    // chain of command.
    const received = receiveOrderAttempt(baseAttempt(unauthorized, "requested"));
    const decided = decideOrderAttempt(received, "accept", "It costs me nothing and he pays well.", 2);
    expect(decided.status).toBe("accepted");
  });

  it("refusing is an answer, whatever standing the asker had", () => {
    for (const standing of ["binding", "requested", "presumptuous"] as const) {
      const received = receiveOrderAttempt(baseAttempt(unauthorized, standing));
      expect(decideOrderAttempt(received, "refuse", "No.", 2).status).toBe("refused");
    }
  });

  it("the commander can betray by ignoring the order entirely", () => {
    const received = receiveOrderAttempt(baseAttempt(authorized));
    const decided = decideOrderAttempt(received, "ignore", "The commander pretends the message never arrived.", 2);
    expect(decided.status).toBe("ignored");
  });

  it("refuses to decide an attempt that has not been received or delayed", () => {
    expect(() => decideOrderAttempt(baseAttempt(authorized), "accept", "", 2)).toThrow(/only a received or delayed/i);
  });

  it("a delayed attempt can later be decided", () => {
    const received = receiveOrderAttempt(baseAttempt(authorized));
    const delayed = decideOrderAttempt(received, "delay", "Not yet.", 2);
    const decided = decideOrderAttempt(delayed, "accept", "Now.", 5);
    expect(decided.status).toBe("accepted");
  });
});

describe("completeOrderAttempt / abandonOrderAttempt", () => {
  it("moves accepted -> carried_out once the workflow applies", () => {
    const received = receiveOrderAttempt(baseAttempt(authorized));
    const accepted = decideOrderAttempt(received, "accept", "Lawful.", 2);
    const completed = completeOrderAttempt(accepted, 3);
    expect(completed.status).toBe("carried_out");
    expect(completed.decidedAtStep).toBe(3);
  });

  it("moves accepted -> abandoned when the workflow refuses on mechanical grounds", () => {
    const received = receiveOrderAttempt(baseAttempt(authorized));
    const accepted = decideOrderAttempt(received, "accept", "Lawful.", 2);
    const abandoned = abandonOrderAttempt(accepted, 3);
    expect(abandoned.status).toBe("abandoned");
  });

  it("refuses to complete an attempt that was never accepted", () => {
    expect(() => completeOrderAttempt(baseAttempt(authorized), 3)).toThrow(/only an accepted/i);
  });
});

describe("recordOrderAttemptConsequences", () => {
  it("appends fact refs without disturbing anything else", () => {
    const received = receiveOrderAttempt(baseAttempt(unauthorized, "presumptuous"));
    const subverted = decideOrderAttempt(received, "accept", "Complied anyway.", 2);
    const withConsequences = recordOrderAttemptConsequences(subverted, ["fact-legitimacy-1", "fact-evidence-1"]);
    expect(withConsequences.consequenceFactRefs).toEqual(["fact-legitimacy-1", "fact-evidence-1"]);
    expect(withConsequences.status).toBe("subverted");
  });
});
