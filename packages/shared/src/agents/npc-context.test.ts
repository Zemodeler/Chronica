import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";
import { issueOrderAttempt } from "../authority/order-attempt";
import { emitFacts, NO_INTERVENTION_SIGNALS, type FactDraft } from "../world/facts";
import type { WorldMatter } from "../matters/schema";
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

  it("populates the matters projection and respects fact visibility (docs/plans/ai-world-matters-runtime.md, Phase 2)", () => {
    const w = world();
    const index = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    const drafts: FactDraft[] = [
      {
        time: atInstant, atStep: 1, kind: "public_fact", summary: "Public news about the matter.",
        affectedEntities: [], resourceChanges: [], authorityChange: undefined, evidence: null,
        visibility: "public", discovery: { state: "public", knowableAtInstant: atInstant, discoveredBy: [] },
        eligibleReactionScopes: ["world"], interventionSignals: NO_INTERVENTION_SIGNALS, sourceEventId: null, sourceActionId: null, causalDepth: 0,
      },
      {
        time: atInstant, atStep: 1, kind: "private_fact", summary: "A secret hanno never learns.",
        affectedEntities: [], resourceChanges: [], authorityChange: undefined, evidence: null,
        visibility: "private", discovery: { state: "private", knowableAtInstant: atInstant, discoveredBy: [] },
        eligibleReactionScopes: ["world"], interventionSignals: NO_INTERVENTION_SIGNALS, sourceEventId: null, sourceActionId: null, causalDepth: 0,
      },
    ];
    const facts = emitFacts(drafts, (() => { let n = 0; return () => `fact-${n++}`; })());
    const matter: WorldMatter = {
      id: "test-matter", kind: "civic", sourceRef: { kind: "institution", id: "test-institution" },
      status: "due", visibility: "public", summary: "A test civic matter.", urgency: 30,
      createdAt: atInstant, dueAt: null, nextReviewAt: atInstant, lastReviewedAt: null,
      requiredAuthority: [], responsibleScopeRefs: [], stakeholderRefs: [],
      relevantFactIds: facts.map((f) => f.id),
      standingPlanId: null, supersedesMatterId: null, parentMatterId: null,
      offers: [], dispositions: [], resolutionFactIds: [],
      provinceId: "ita-72843720b81376294924159-sicily-west", // hanno's own location
      intensity: 30, reviews: 1, pressureId: null, createdAtStep: 1, lastReviewedStep: 1, nextReviewStep: 2,
    };
    const w2: WorldState = { ...w, worldMatters: [matter] };
    const context = buildNpcAgentContext(w2, "hanno", index, facts, atInstant);
    expect(context?.matters).toHaveLength(1);
    expect(context?.matters[0]?.matterId).toBe("test-matter");
    expect(context?.matters[0]?.knownFactSummaries).toEqual(["Public news about the matter."]);
  });
});
