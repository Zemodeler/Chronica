import { describe, expect, it } from "vitest";
import { kindAskedFor, verifyPart } from "./order-verifier";

describe("the order verifier", () => {
  it("passes acts of the kind the words ask for", () => {
    expect(verifyPart({ said: "Carry Legio I to Messana in the Roman Navy", ops: ["force_modify"], handedOn: false })).toBeNull();
    expect(verifyPart({ said: "Hire twenty galleys", ops: ["service_contract_open"], handedOn: false })).toBeNull();
  });

  it("flags a substitution: ships asked for, a march written", () => {
    const flag = verifyPart({ said: "Hire ships to carry the army", ops: ["force_modify"], handedOn: false });
    expect(flag).toMatch(/^Check: this asked for raising or building/);
    expect(flag).toContain("force modify");
  });

  it("says nothing of a part with no acts (that is already told as nothing came of it), or one handed on", () => {
    expect(verifyPart({ said: "Appoint someone to examine the accusation", ops: [], handedOn: false })).toBeNull();
    expect(verifyPart({ said: "Appoint someone to examine the accusation", ops: ["diplomatic_message_send"], handedOn: true })).toBeNull();
  });

  it("does not guess at wording it does not know", () => {
    expect(kindAskedFor("See that the harbour is kept quiet")).toBeNull();
    expect(verifyPart({ said: "See that the harbour is kept quiet", ops: ["force_modify"], handedOn: false })).toBeNull();
  });
});

import { claimsItDone } from "./order-outcomes";

describe("a passage that says more than the world shows", () => {
  // Plan chronicle-and-order-truth, 1.7: taken, appointed, paid, begun.
  it("catches a city said taken, a man appointed, a sum paid, with the part not done", () => {
    expect(claimsItDone("Messana was taken on the third day.", "under_way")).toBe(true);
    expect(claimsItDone("Marcus was appointed to examine the books.", "unanswered")).toBe(true);
    expect(claimsItDone("The sum was paid in full.", "carried_unverified")).toBe(true);
  });

  it("catches a work said begun when nothing was, and lets a part under way say so", () => {
    expect(claimsItDone("The audit began at dawn.", "unanswered")).toBe(true);
    expect(claimsItDone("The audit began at dawn.", "under_way")).toBe(false);
  });

  it("lets a part that is done say all of it", () => {
    expect(claimsItDone("Messana was taken and Marcus was appointed.", "achieved")).toBe(false);
  });
});
