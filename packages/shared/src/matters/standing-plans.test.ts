import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex, AuthorityGrantSchema, type AuthorityIndex } from "../authority/authority-grant";
import type { ActionPlan } from "../actions/plans";
import type { WorldMatter } from "./schema";
import { continuationDraftFor, linkStandingPlan, standingPlanInvalidations } from "./standing-plans";

const INSTANT = { day: 10, minute: 0 };

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function baseMatter(overrides: Partial<WorldMatter> = {}): WorldMatter {
  return {
    id: "income-assessment:sicily-tax:period-1",
    kind: "income_assessment",
    sourceRef: { kind: "income_source", id: "sicily-tax" },
    status: "due",
    visibility: "public",
    summary: "Sicilian taxation is due for collection.",
    urgency: 40,
    createdAt: INSTANT,
    dueAt: INSTANT,
    nextReviewAt: INSTANT,
    lastReviewedAt: null,
    requiredAuthority: [{ domain: "fiscal", power: "spend", scope: { kind: "account", id: "marcus-purse" } }],
    responsibleScopeRefs: [],
    stakeholderRefs: [],
    relevantFactIds: [],
    standingPlanId: "plan-collect-sicily",
    supersedesMatterId: null,
    parentMatterId: null,
    offers: [],
    dispositions: [],
    resolutionFactIds: [],
    provinceId: null,
    intensity: 40,
    reviews: 3,
    pressureId: null,
    createdAtStep: 1,
    lastReviewedStep: 30,
    nextReviewStep: 60,
    ...overrides,
  };
}

function standingPlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    id: "plan-collect-sicily",
    origin: { kind: "npc", sourceId: "marcus-atilius", directiveId: "intent-collect" },
    ownerCharacterId: "marcus-atilius",
    issuingEntityRef: null,
    rawText: "Collect the ordinary Sicilian revenues each period and remit them to Rome.",
    revisions: [{ atStep: 1, text: "Collect the ordinary Sicilian revenues each period and remit them to Rome." }],
    options: { method: "", constraints: "", secrecy: "public", delegateIds: [], budget: null },
    interpretation: "Collect ordinary revenue on schedule.",
    claims: [],
    clarificationQuestions: [],
    standingInstructions: [],
    priority: 0,
    priorityEpoch: 0,
    status: "active",
    feasibility: null,
    stages: [
      {
        id: "collect-sicily-tax",
        objective: "Collect the ordinary Sicilian revenues.",
        actorId: "marcus-atilius",
        action: { kind: "built_in", actionId: "collect_revenue", parameters: { accountId: "marcus-purse", incomeSourceId: "sicily-tax", amount: 300 } },
        dependsOn: [],
        provinceId: null,
        notBeforeStep: null,
        repeatEverySteps: 30,
        reservationIds: [],
        durationEstimate: null,
        status: "completed",
        plannedStartStep: 1,
        startedAtStep: 1,
        expectedCompletionStep: 1,
        completedAtStep: 30,
        resultFactIds: [],
        statusReason: null,
      },
    ],
    assignments: [],
    reservationIds: [],
    spent: 0,
    createdAtStep: 1,
    updatedAtStep: 30,
    terminalReason: null,
    sourceMatterIds: ["income-assessment:sicily-tax:period-1"],
    standing: { cadenceSteps: 30, nextReviewStep: 60, exceptions: ["unless control of Sicily is lost"], expiresAtStep: null },
    ...overrides,
  };
}

function fiscalIndex(): AuthorityIndex {
  const grant = AuthorityGrantSchema.parse({
    id: "sicily-fiscal-grant",
    holder: { kind: "character", id: "marcus-atilius" },
    source: "custom",
    domain: "fiscal",
    scope: { kind: "account", id: "marcus-purse" },
    powers: ["spend"],
    standing: "lawful",
    grantedAtStep: 0,
  });
  return { grants: [grant] };
}

describe("linkStandingPlan", () => {
  it("sets standingPlanId", () => {
    const matter = baseMatter({ standingPlanId: null });
    expect(linkStandingPlan(matter, "plan-collect-sicily").standingPlanId).toBe("plan-collect-sicily");
  });
});

describe("continuationDraftFor (invariant 8: a standing continuation cannot exceed the decision that authorized it)", () => {
  it("produces a draft naming only the plan's own existing stage id, never a synthesized action", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan();
    const draft = continuationDraftFor(w, matter, plan, INSTANT);
    expect(draft).not.toBeNull();
    expect(draft!.kind).toBe("action_phase");
    expect(draft!.actionId).toBe("collect-sicily-tax");
    expect(draft!.payload).toEqual({ kind: "action_phase", actionId: "collect-sicily-tax" });
    expect(draft!.subjectRef).toEqual({ kind: "character", id: "marcus-atilius" });
    // No field of the draft carries an action name, parameters, or amount of
    // its own -- everything about what actually runs stays on the plan's own
    // stage.action, untouched by this function.
    expect(JSON.stringify(draft)).not.toContain("collect_revenue");
    expect(JSON.stringify(draft)).not.toContain("300");
  });

  it("returns null once the plan's standing authorization has expired", () => {
    const w = world();
    const matter = baseMatter({ nextReviewStep: 100 });
    const plan = standingPlan({ standing: { cadenceSteps: 30, nextReviewStep: 60, exceptions: [], expiresAtStep: 90 } });
    expect(continuationDraftFor(w, matter, plan, INSTANT)).toBeNull();
  });

  it("returns null for a plan with no repeatable stage", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan({ stages: [{ ...standingPlan().stages[0]!, repeatEverySteps: null }] });
    expect(continuationDraftFor(w, matter, plan, INSTANT)).toBeNull();
  });

  it("returns null for a plan with no standing configuration", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan({ standing: null });
    expect(continuationDraftFor(w, matter, plan, INSTANT)).toBeNull();
  });

  it("re-running for the same review instant produces the same draft, not a duplicate-shaped one", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan();
    const once = continuationDraftFor(w, matter, plan, INSTANT);
    const twice = continuationDraftFor(w, matter, plan, INSTANT);
    expect(twice).toEqual(once);
  });
});

describe("standingPlanInvalidations", () => {
  it("returns empty when nothing has changed", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan();
    expect(standingPlanInvalidations(w, plan, matter, fiscalIndex(), 60)).toEqual([]);
  });

  it("reopens when the plan's author is dead", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, alive: false } : c));
    const matter = baseMatter();
    const plan = standingPlan();
    const reasons = standingPlanInvalidations(w, plan, matter, fiscalIndex(), 60);
    expect(reasons.some((r) => r.includes("no longer available"))).toBe(true);
  });

  it("reopens when the plan's author no longer holds the authority the matter required", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan();
    const emptyIndex: AuthorityIndex = { grants: [] };
    const reasons = standingPlanInvalidations(w, plan, matter, emptyIndex, 60);
    expect(reasons.some((r) => r.includes("authority"))).toBe(true);
  });

  it("reopens when the account the plan spends from cannot cover the recorded amount", () => {
    const w = world();
    w.material.accounts = w.material.accounts.map((a) => (a.id === "marcus-purse" ? { ...a, balance: 0 } : a));
    const matter = baseMatter();
    const plan = standingPlan();
    const reasons = standingPlanInvalidations(w, plan, matter, fiscalIndex(), 60);
    expect(reasons.some((r) => r.includes("cannot currently cover"))).toBe(true);
  });

  it("reopens when the plan's own spending limit has been reached", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan({ options: { method: "", constraints: "", secrecy: "public", delegateIds: [], budget: { accountId: "marcus-purse", amount: 300 } }, spent: 300 });
    const reasons = standingPlanInvalidations(w, plan, matter, fiscalIndex(), 60);
    expect(reasons.some((r) => r.includes("spending limit"))).toBe(true);
  });

  it("reopens once the plan's standing authorization has expired", () => {
    const w = world();
    const matter = baseMatter();
    const plan = standingPlan({ standing: { cadenceSteps: 30, nextReviewStep: 60, exceptions: [], expiresAtStep: 60 } });
    const reasons = standingPlanInvalidations(w, plan, matter, fiscalIndex(), 60);
    expect(reasons.some((r) => r.includes("expired"))).toBe(true);
  });

  it("reopens when another plan holds an exclusive reservation on the same account", () => {
    const w = world();
    w.stageReservations = [{ id: "reservation-account-marcus-purse-other-plan-other-stage", planId: "other-plan", stageId: "other-stage", kind: "account", resourceId: "marcus-purse", createdAtStep: 50, releasedAtStep: null }];
    const matter = baseMatter();
    const plan = standingPlan();
    const reasons = standingPlanInvalidations(w, plan, matter, fiscalIndex(), 60);
    expect(reasons.some((r) => r.includes("exclusive reservation"))).toBe(true);
  });
});
