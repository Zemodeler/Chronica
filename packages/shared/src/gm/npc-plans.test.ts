import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { createGameMasterSession } from "./session";
import { PlanOptionsSchema } from "../actions/plans";
import { ScenarioClockSchema } from "../world/clock";
import type { Principal } from "../authority/principal";
import type { WorldMatter } from "../matters/schema";
import type { WorldState } from "../world/world-state";

// Unified action runtime, requirement 2: an NPC's declared intent must
// become a real, persistent `ActionPlan` (`origin.kind: "npc"`), carried out
// through the same interpretation/stage/duration/reservation/budget/
// interruption mechanics a player's own directive-derived plan already uses
// -- mirrors `player-plans.test.ts`'s own coverage, one level up: `declare_intent`
// (bound to the NPC's own principal) in place of a submitted directive, and
// `interpret_plan`/`execute_plan_stage` bound to the `{kind:"interpreter"}`
// principal in place of the session's own default (unbound) principal.

const NPC = "hanno";
const NPC_PRINCIPAL: Principal = { kind: "npc", characterId: NPC };
const INTERPRETER: Principal = { kind: "interpreter" };
const BYSTANDER_PLAYER = "marcus-atilius";

const call = (name: string, args: Record<string, unknown>) => ({ id: "test-call", name, arguments: args });
function base() { return structuredClone(firstPunicWarScenario.initialWorld); }
function session(world = base(), atStep = 1) {
  return createGameMasterSession({ world, atStep, actorCharacterId: BYSTANDER_PLAYER, directiveIds: [], allowInventedActions: true });
}

/** Declares the NPC's intent and returns the plan id it originated. */
function declare(gm: ReturnType<typeof session>, intent: string): string {
  const outcome = gm.invoke(call("declare_intent", { actorId: NPC, intent, reason: "It serves my own interests." }), NPC_PRINCIPAL);
  expect(outcome.ok).toBe(true);
  const declared = gm.result().declaredIntents.find((i) => i.actorId === NPC && i.intent === intent);
  const planId = declared?.planId;
  expect(planId).toBeDefined();
  return planId!;
}

function interpret(gm: ReturnType<typeof session>, planId: string, stages: Record<string, unknown>[], options = PlanOptionsSchema.parse({})) {
  return gm.invoke(call("interpret_plan", { planId, interpretation: "Carry out the requested stages", stages, options }), INTERPRETER);
}
const stage = (id: string, extra: Record<string, unknown> = {}) => ({ id, objective: `Task ${id}`, actorId: NPC, ...extra });
function execute(gm: ReturnType<typeof session>, planId: string, stageId: string, actionId: string, parameters: Record<string, unknown>) {
  return gm.invoke(call("execute_plan_stage", { planId, stageId, actionId, parameters }), INTERPRETER);
}

const DAILY_CLOCK = ScenarioClockSchema.parse({ stepLabel: "day", stepLabelPlural: "days", stepsPerYear: 365, minSpan: 1, maxSpan: 10_000 });
function sessionWithClock(world = base(), atStep = 1) {
  return createGameMasterSession({ world, atStep, actorCharacterId: BYSTANDER_PLAYER, directiveIds: [], scenarioClock: DAILY_CLOCK });
}

const diplomaticMessageParams = {
  messageId: "msg-1", kind: "ultimatum", fromPolityId: "carthage", fromCharacterId: NPC, toPolityId: "rome",
  toCharacterId: null, subject: "Withdraw from Sicily", terms: "Carthage demands nothing here; Rome does.",
};

describe("persistent NPC plans", () => {
  it("originates a plan with origin.kind 'npc' the instant the intent is declared, before anything is interpreted", () => {
    const gm = session();
    const planId = declare(gm, "Raise the whole of Carthage against Syracuse this season.");
    const plan = gm.stagedWorld.plans!.find((p) => p.id === planId)!;
    expect(plan.origin.kind).toBe("npc");
    expect(plan.origin.sourceId).toBe(NPC);
    expect(plan.ownerCharacterId).toBe(NPC);
    expect(plan.status).toBe("active");
    expect(plan.stages).toEqual([]);
    expect(gm.result().events).toEqual([]);
  });

  it("blocks a direct action call for an actor with a plan-tracked intent, exactly like an unplotted player order", () => {
    const gm = session();
    const planId = declare(gm, "Move myself to the strait and see the crossing for myself.");
    const direct = gm.invoke(call("move_character", { actorId: NPC, characterId: NPC, destinationProvinceId: "nowhere-at-all" }), INTERPRETER);
    expect(direct.ok).toBe(false);
    expect(direct.factual).toMatch(/execute_plan_stage/i);
    expect(interpret(gm, planId, [stage("look")]).ok).toBe(true);
    const routed = execute(gm, planId, "look", "move_character", { characterId: NPC, destinationProvinceId: "nowhere-at-all" });
    // Reaches the workflow -- refused for the bad province id, not identity/tracking.
    expect(routed.factual).not.toMatch(/execute_plan_stage/i);
  });

  it("checks registered spending actions and tracks the NPC plan's cumulative debit", () => {
    const world = base();
    const account = world.material.accounts.find((a) => a.id === "hanno-purse")!;
    account.balance = 1_000;
    world.material.accountAccess.push({ id: "test-access", characterId: NPC, accountId: account.id, permissions: ["spend_without_vote"], sourceKind: "ownership", sourceId: NPC });
    const gm = session(world);
    const planId = declare(gm, "Pay for supplies out of my own purse.");
    expect(interpret(gm, planId, [stage("payment")], PlanOptionsSchema.parse({ budget: { accountId: account.id, amount: 10 } })).ok).toBe(true);
    expect(execute(gm, planId, "payment", "remove_gold", { accountId: account.id, amount: 8, reason: "Pay for supplies" }).ok).toBe(true);
    expect(gm.stagedWorld.material.accounts.find((a) => a.id === account.id)!.balance).toBe(992);
    expect(gm.stagedWorld.plans!.find((p) => p.id === planId)!.spent).toBe(8);
  });

  it("mechanically refuses an NPC plan stage's spend that would exceed its own stated budget", () => {
    const world = base();
    const account = world.material.accounts.find((a) => a.id === "hanno-purse")!;
    account.balance = 1_000;
    world.material.accountAccess.push({ id: "test-access", characterId: NPC, accountId: account.id, permissions: ["spend_without_vote"], sourceKind: "ownership", sourceId: NPC });
    const gm = session(world);
    const planId = declare(gm, "Pay for supplies out of my own purse.");
    expect(interpret(gm, planId, [stage("payment")], PlanOptionsSchema.parse({ budget: { accountId: account.id, amount: 10 } })).ok).toBe(true);
    const result = execute(gm, planId, "payment", "remove_gold", { accountId: account.id, amount: 20, reason: "Pay for supplies" });
    expect(result.ok).toBe(false);
    expect(result.factual).toMatch(/exceeding the 10-limit/);
    expect(gm.stagedWorld.material.accounts.find((a) => a.id === account.id)!.balance).toBe(1_000);
    expect(gm.stagedWorld.plans!.find((p) => p.id === planId)!.stages[0]!.status).toBe("blocked");
  });
});

describe("NPC plan stages with completesAtStep (unified action runtime, Stage 3/requirement 3)", () => {
  it("starts the stage and schedules it, without applying the action yet, when completesAtStep is given", () => {
    const gm = sessionWithClock();
    const planId = declare(gm, "Send an ultimatum to Rome.");
    expect(interpret(gm, planId, [stage("send")]).ok).toBe(true);
    const result = gm.invoke(call("execute_plan_stage", {
      planId, stageId: "send", actionId: "send_diplomatic_message", parameters: diplomaticMessageParams, completesAtStep: 4,
    }), INTERPRETER);
    expect(result.ok).toBe(true);
    const planStage = gm.stagedWorld.plans!.find((p) => p.id === planId)!.stages.find((s) => s.id === "send")!;
    expect(planStage.status).toBe("in_progress");
    expect(planStage.expectedCompletionStep).toBe(4);
    expect(gm.result().scheduledPlanPhases).toEqual([
      { planId, stageId: "send", actionId: "send_diplomatic_message", actorId: NPC, parameters: diplomaticMessageParams, atStep: 4 },
    ]);
    expect(gm.stagedWorld.diplomacy ?? []).toEqual([]);
  });

  it("refuses a completesAtStep outside the action's own declared duration range", () => {
    const gm = sessionWithClock();
    const planId = declare(gm, "Send an ultimatum to Rome.");
    expect(interpret(gm, planId, [stage("send")]).ok).toBe(true);
    const result = gm.invoke(call("execute_plan_stage", {
      planId, stageId: "send", actionId: "send_diplomatic_message", parameters: diplomaticMessageParams, completesAtStep: 100,
    }), INTERPRETER);
    expect(result.ok).toBe(false);
    expect(result.factual).toMatch(/duration estimate/i);
  });

  it("omitting completesAtStep still resolves the stage atomically", () => {
    const gm = sessionWithClock();
    const planId = declare(gm, "Rename myself.");
    expect(interpret(gm, planId, [stage("first")]).ok).toBe(true);
    const result = execute(gm, planId, "first", "rename_character", { characterId: NPC, newName: "Now" });
    expect(result.ok).toBe(true);
    expect(gm.stagedWorld.plans!.find((p) => p.id === planId)!.stages.find((s) => s.id === "first")!.status).toBe("completed");
    expect(gm.result().scheduledPlanPhases).toEqual([]);
  });
});

describe("NPC plan-stage resource reservations and preemption (unified action runtime, Stage 6/requirement 2)", () => {
  const FORCE_ID = "carthaginian-army";
  const DESTINATION = "ita-72843720b81376294924159-sicily-southeast";

  function scheduleMove(gm: ReturnType<typeof session>, planId: string, stageId: string, completesAtStep: number) {
    return gm.invoke(call("execute_plan_stage", {
      planId, stageId, actionId: "move_force", parameters: { forceId: FORCE_ID, destinationProvinceId: DESTINATION }, completesAtStep,
    }), INTERPRETER);
  }

  it("reserves the NPC's own time and the force a scheduled stage claims, for as long as it stays in progress", () => {
    const gm = sessionWithClock();
    const planId = declare(gm, "March my army to the southeast.");
    expect(interpret(gm, planId, [stage("march")]).ok).toBe(true);
    expect(scheduleMove(gm, planId, "march", 10).ok).toBe(true);
    const held = (gm.stagedWorld.stageReservations ?? []).filter((r) => r.releasedAtStep === null);
    expect(held).toHaveLength(2);
    expect(held.map((r) => r.kind).sort()).toEqual(["character_time", "force"]);
    expect(held.every((r) => r.planId === planId && r.stageId === "march")).toBe(true);
    expect(held.some((r) => r.kind === "force" && r.resourceId === FORCE_ID)).toBe(true);
  });

  it("a freshly declared intent preempts a standing NPC plan's hold on the same force, interrupting it and releasing its reservation", () => {
    const gm = sessionWithClock();
    const planId = declare(gm, "March my army to the southeast.");
    expect(interpret(gm, planId, [stage("march")]).ok).toBe(true);
    expect(scheduleMove(gm, planId, "march", 10).ok).toBe(true);

    // A later turn, a fresh intent: recall the same force. Nothing about the
    // first plan was touched this turn, so it is only ever standing
    // self-directed work; the fresh instruction is what docs/32 says wins.
    const resumed = sessionWithClock(gm.stagedWorld, 5);
    const planId2 = declare(resumed, "Recall my army home instead.");
    expect(interpret(resumed, planId2, [stage("recall")]).ok).toBe(true);
    expect(scheduleMove(resumed, planId2, "recall", 20).ok).toBe(true);

    const march = resumed.stagedWorld.plans!.find((p) => p.id === planId)!.stages.find((s) => s.id === "march")!;
    expect(march.status).toBe("interrupted");
    const marchReservation = resumed.stagedWorld.stageReservations!.find((r) => r.stageId === "march" && r.kind === "force")!;
    expect(marchReservation.releasedAtStep).toBe(5);
    const recallReservation = resumed.stagedWorld.stageReservations!.find((r) => r.stageId === "recall" && r.kind === "force")!;
    expect(recallReservation.releasedAtStep).toBeNull();
  });
});

// World matters, Phase 2 (docs/plans/ai-world-matters-runtime.md, "5.
// Intention and interpretation": "The matter ID becomes causal metadata on
// the intent").
describe("declare_intent's matterIds", () => {
  const INSTANT = { day: 1, minute: 0 };

  function testMatter(overrides: Partial<WorldMatter> = {}): WorldMatter {
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

  function worldWithMatter(matter: WorldMatter): WorldState {
    return { ...base(), worldMatters: [matter] };
  }

  it("flips the named matter's offer outcome to intent_declared", () => {
    const gm = session(worldWithMatter(testMatter()));
    const outcome = gm.invoke(
      call("declare_intent", { actorId: NPC, intent: "Attend to the civic business myself.", reason: "It is mine to handle.", matterIds: ["test-matter"] }),
      NPC_PRINCIPAL,
    );
    expect(outcome.ok).toBe(true);
    const declared = gm.result().declaredIntents.find((i) => i.actorId === NPC)!;
    expect(declared.matterIds).toEqual(["test-matter"]);
    const matter = gm.stagedWorld.worldMatters!.find((m) => m.id === "test-matter")!;
    const offer = matter.offers.find((o) => o.actorRef.kind === "character" && o.actorRef.id === NPC)!;
    expect(offer).toBeDefined();
    expect(offer.outcome).toBe("intent_declared");
    expect(offer.intentIds).toEqual([declared.id]);
  });

  it("accepts a declare_intent naming an unknown matter id without refusing it, and records nothing extra", () => {
    const gm = session(worldWithMatter(testMatter()));
    const outcome = gm.invoke(
      call("declare_intent", { actorId: NPC, intent: "Do something unrelated entirely.", reason: "My own business.", matterIds: ["no-such-matter"] }),
      NPC_PRINCIPAL,
    );
    expect(outcome.ok).toBe(true);
    const matter = gm.stagedWorld.worldMatters!.find((m) => m.id === "test-matter")!;
    expect(matter.offers).toEqual([]);
  });
});
