import { describe, expect, it } from "vitest";
import { goalMet } from "./goals";
import { orderPartStatus, type OrderPart } from "./orders";
import type { WorldState } from "./world-state";

const worldWith = (contractStatus: string, answer: string | null): WorldState => ({
  material: { contracts: [{ id: "c1", status: contractStatus, forceId: null }], forces: [], accounts: [], transactions: [] },
  diplomacy: [{ id: "m1", status: answer === null ? "awaiting_reply" : "answered", answer, subject: "Terms" }],
  projects: [], orders: [],
} as unknown as WorldState);

describe("order goals", () => {
  it("counts a hire that ran its term as served, and a broken one as lost", () => {
    expect(goalMet(worldWith("ended", null), { kind: "contract_active", contractId: "c1" })).toBe("met");
    expect(goalMet(worldWith("lapsed", null), { kind: "contract_active", contractId: "c1" })).toBe("met");
    expect(goalMet(worldWith("broken", null), { kind: "contract_active", contractId: "c1" })).toBe("impossible");
  });

  it("reads a held act waiting on a letter as awaiting its reply", () => {
    const part = {
      said: "Otherwise invest the walls", goals: [], workRefs: [], refusal: null, note: null, whyNot: null, factIds: [],
      stages: [{ held: { op: "siege_lay" }, waitsOn: [{ kind: "letter_answered", messageId: "m1", answer: "refused" }], status: "waiting", reason: null }],
      spend: null, attribution: "tagged", closedAtStep: null,
    } as unknown as OrderPart;
    expect(orderPartStatus(worldWith("active", null), part)).toBe("awaiting_reply");
  });
});
