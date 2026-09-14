import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";
import { emitFacts, NO_INTERVENTION_SIGNALS, type FactDraft } from "../world/facts";
import type { WorldMatter } from "./schema";
import { projectMattersForCharacter } from "./projection";

const INSTANT = { day: 10, minute: 0 };

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function baseMatter(overrides: Partial<WorldMatter> = {}): WorldMatter {
  return {
    id: "test-matter",
    kind: "civic",
    sourceRef: { kind: "institution", id: "test-institution" },
    status: "due",
    visibility: "public",
    summary: "A test matter.",
    urgency: 40,
    createdAt: INSTANT,
    dueAt: null,
    nextReviewAt: INSTANT,
    lastReviewedAt: null,
    requiredAuthority: [],
    responsibleScopeRefs: [],
    stakeholderRefs: [],
    relevantFactIds: [],
    standingPlanId: null,
    supersedesMatterId: null,
    parentMatterId: null,
    offers: [],
    dispositions: [],
    resolutionFactIds: [],
    provinceId: null,
    intensity: 40,
    reviews: 1,
    pressureId: null,
    createdAtStep: 1,
    lastReviewedStep: 1,
    nextReviewStep: 2,
    ...overrides,
  };
}

function index(w: WorldState) {
  return buildAuthorityIndex({ officeSeats: w.material.officeSeats, forces: w.material.forces }, [], [], 1);
}

describe("projectMattersForCharacter", () => {
  it("shows a matter's public facts but withholds a private fact this character never discovered", () => {
    const w = world();
    const drafts: FactDraft[] = [
      {
        time: INSTANT, atStep: 1, kind: "public_fact", summary: "Everyone can see this.",
        affectedEntities: [], resourceChanges: [], authorityChange: undefined, evidence: null,
        visibility: "public", discovery: { state: "public", knowableAtInstant: INSTANT, discoveredBy: [] },
        eligibleReactionScopes: ["world"], interventionSignals: NO_INTERVENTION_SIGNALS, sourceEventId: null, sourceActionId: null, causalDepth: 0,
      },
      {
        time: INSTANT, atStep: 1, kind: "private_fact", summary: "A secret hanno never learns.",
        affectedEntities: [], resourceChanges: [], authorityChange: undefined, evidence: null,
        visibility: "private", discovery: { state: "private", knowableAtInstant: INSTANT, discoveredBy: [] },
        eligibleReactionScopes: ["world"], interventionSignals: NO_INTERVENTION_SIGNALS, sourceEventId: null, sourceActionId: null, causalDepth: 0,
      },
    ];
    const facts = emitFacts(drafts, (() => { let n = 0; return () => `fact-${n++}`; })());
    const matter = baseMatter({
      provinceId: "ita-72843720b81376294924159-sicily-west", // hanno's own location -> "affected" recipient
      relevantFactIds: facts.map((f) => f.id),
    });
    const w2: WorldState = { ...w, worldMatters: [matter] };
    const projected = projectMattersForCharacter(w2, "hanno", index(w2), facts, INSTANT);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.knownFactSummaries).toEqual(["Everyone can see this."]);
  });

  it("does not project a private household matter for an uninvolved character, even one with an intersecting goal", () => {
    const w = world();
    w.households = [{ id: "household-1", name: "Test Household", polityId: "rome", headCharacterId: "marcus-atilius", active: true }];
    // hanno has an active goal naming the household -- would normally make him an "interested" recipient (step 4),
    // but the matter's own visibility is private, so that role must not surface it to him.
    w.characterGoals = [
      {
        id: "goal-hanno", characterId: "hanno", objective: "Learn of Roman household troubles.",
        category: "resource", targetEntityIds: ["household-1"], priority: 2, status: "active",
        visibility: "private", causalFactIds: [], createdAtStep: 1, updatedAtStep: 1, history: [],
      },
    ];
    const matter = baseMatter({
      id: "household-matter",
      kind: "household",
      sourceRef: { kind: "household", id: "household-1" },
      visibility: "private",
    });
    const w2: WorldState = { ...w, worldMatters: [matter] };

    const forHanno = projectMattersForCharacter(w2, "hanno", index(w2), [], INSTANT);
    expect(forHanno).toHaveLength(0);

    const forHead = projectMattersForCharacter(w2, "marcus-atilius", index(w2), [], INSTANT);
    expect(forHead).toHaveLength(1);
    expect(forHead[0]!.role).toBe("responsible");
  });

  it("caps output at max and prioritizes by urgency", () => {
    const w = world();
    const matters: WorldMatter[] = Array.from({ length: 8 }, (_, i) =>
      baseMatter({ id: `m-${i}`, urgency: i * 10, provinceId: "ita-72843720b81376294924159-sicily-west" }),
    );
    const w2: WorldState = { ...w, worldMatters: matters };
    const projected = projectMattersForCharacter(w2, "hanno", index(w2), [], INSTANT, 3);
    expect(projected).toHaveLength(3);
    expect(projected.map((p) => p.urgency)).toEqual([70, 60, 50]);
  });
});
