import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";
import { issueOrderAttempt } from "../authority/order-attempt";
import { emitFacts, NO_INTERVENTION_SIGNALS, type FactDraft } from "../world/facts";
import { buildNpcAgentContext } from "./npc-context";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

const atInstant = { day: 1, minute: 0 };

describe("buildNpcAgentContext (docs/32, Part B.4)", () => {
  it("returns undefined for an unknown character", () => {
    const w = world();
    const index = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    expect(buildNpcAgentContext(w, "no-such-character", index, [], atInstant)).toBeUndefined();
  });

  it("scopes visible facts to this observer, excluding a private fact never discovered by them", () => {
    const w = world();
    const index = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    const drafts: FactDraft[] = [
      {
        time: atInstant,
        atStep: 1,
        kind: "test_public",
        summary: "Everyone can see this.",
        affectedEntities: [],
        resourceChanges: [],
        authorityChange: undefined,
        evidence: null,
        visibility: "public",
        discovery: { state: "public", knowableAtInstant: atInstant, discoveredBy: [] },
        eligibleReactionScopes: ["world"],
        interventionSignals: NO_INTERVENTION_SIGNALS,
        sourceEventId: null,
        sourceActionId: null,
        causalDepth: 0,
      },
      {
        time: atInstant,
        atStep: 1,
        kind: "test_private",
        summary: "A secret hanno never learns.",
        affectedEntities: [],
        resourceChanges: [],
        authorityChange: undefined,
        evidence: null,
        visibility: "private",
        discovery: { state: "private", knowableAtInstant: atInstant, discoveredBy: [] },
        eligibleReactionScopes: ["world"],
        interventionSignals: NO_INTERVENTION_SIGNALS,
        sourceEventId: null,
        sourceActionId: null,
        causalDepth: 0,
      },
    ];
    const facts = emitFacts(drafts, (() => { let n = 0; return () => `fact-${n++}`; })());
    const context = buildNpcAgentContext(w, "hanno", index, facts, atInstant);
    expect(context).toBeDefined();
    expect(context?.visibleFacts.map((f) => f.kind)).toEqual(["test_public"]);
  });

  it("includes only this character's own pending orders, not another character's", () => {
    const w = world();
    const index = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    const attemptForHanno = issueOrderAttempt({
      id: "order-1",
      actionId: "action-1",
      issuerRef: { kind: "character", id: "marcus-atilius" },
      recipientRef: { kind: "character", id: "hanno" },
      claimedAuthorityGrantId: null,
      authorityCheck: { authorized: true, grant: null, standing: null, reason: "test fixture" },
      issuedAtStep: 1,
    });
    const w2: WorldState = { ...w, orderAttempts: [attemptForHanno] };
    const context = buildNpcAgentContext(w2, "hanno", index, [], atInstant);
    expect(context?.pendingOrders).toHaveLength(1);
    const otherContext = buildNpcAgentContext(w2, "marcus-atilius", index, [], atInstant);
    expect(otherContext?.pendingOrders).toHaveLength(0);
  });

  it("only surfaces this character's own authority grants", () => {
    const w = world();
    const index = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    const context = buildNpcAgentContext(w, "hanno", index, [], atInstant);
    expect(context?.ownAuthorityGrants.every((g) => g.holder.kind === "character" && g.holder.id === "hanno")).toBe(true);
  });
});
