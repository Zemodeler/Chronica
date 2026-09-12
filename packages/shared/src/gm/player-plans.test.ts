import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { createGameMasterSession } from "./session";
import { preparePlayerPlans, PlanOptionsSchema, type ActionPlan } from "../actions/plans";
import { OrderBatchSchema } from "../actions/orders";
import { ScenarioClockSchema } from "../world/clock";
import { buildGameMasterTools } from "./tools";

const PLAYER = "marcus-atilius";
const PLAN = "plan-1-directive-0";
const call = (name: string, args: Record<string, unknown>) => ({ id: "test-call", name, arguments: args });
function base() { return structuredClone(firstPunicWarScenario.initialWorld); }
function session(world = base(), atStep = 1, fresh = true) {
  return createGameMasterSession({ world, atStep, actorCharacterId: PLAYER, directiveIds: fresh ? ["directive-0"] : [],
    directives: fresh ? [{ id: "directive-0", directive: { kind: "new", text: "Carry out the plan in stages." } }] : [],
    // Two tests below define an action via a plan stage (docs/27: off by
    // default in normal play, but this suite is specifically about what a
    // defined action can and cannot do to plan bookkeeping).
    allowInventedActions: true });
}
function interpret(gm: ReturnType<typeof session>, stages: Record<string, unknown>[], options = PlanOptionsSchema.parse({})) {
  return gm.invoke(call("interpret_plan", { planId: PLAN, interpretation: "Carry out the requested stages", stages, options }));
}
const stage = (id: string, extra: Record<string, unknown> = {}) => ({ id, objective: `Task ${id}`, actorId: PLAYER, ...extra });
function execute(gm: ReturnType<typeof session>, stageId: string, actionId: string, parameters: Record<string, unknown>) {
  return gm.invoke(call("execute_plan_stage", { planId: PLAN, stageId, actionId, parameters }));
}
function spendAction(gm: ReturnType<typeof session>, accountId: string, balance: number) {
  return gm.invoke(call("define_action", { actionId: `spend_to_${balance}`, intent: "Pay for the planned work", description: "Pay for work", parameters: [],
    operations: [{ op: "replace", path: `/material/accounts[id=${accountId}]/balance`, value: balance }] }));
}

const DAILY_CLOCK = ScenarioClockSchema.parse({ stepLabel: "day", stepLabelPlural: "days", stepsPerYear: 365, minSpan: 1, maxSpan: 10_000 });

function sessionWithClock(world = base(), atStep = 1) {
  return createGameMasterSession({
    world, atStep, actorCharacterId: PLAYER, directiveIds: ["directive-0"],
    directives: [{ id: "directive-0", directive: { kind: "new", text: "Send an ultimatum to Carthage." } }],
    scenarioClock: DAILY_CLOCK,
  });
}

const diplomaticMessageParams = {
  messageId: "msg-1", kind: "ultimatum", fromPolityId: "rome", fromCharacterId: PLAYER, toPolityId: "carthage",
  toCharacterId: null, subject: "Withdraw from Sicily", terms: "Carthage demands nothing here; Rome does.",
};

describe("persistent player plans", () => {
  it("keeps the combined tool surface within the provider limit", () => {
    expect(buildGameMasterTools().length).toBeLessThanOrEqual(128);
  });

  it("checks registered spending actions and tracks a plan's cumulative debit, without capping it", () => {
    const world = base();
    const account = world.material.accounts[0]!;
    account.balance = 1_000;
    world.material.accountAccess.push({ id: "test-access", characterId: PLAYER, accountId: account.id, permissions: ["spend_without_vote"], sourceKind: "ownership", sourceId: PLAYER });
    const gm = session(world);
    expect(interpret(gm, [stage("payment")], PlanOptionsSchema.parse({ budget: { accountId: account.id, amount: 10 } })).ok).toBe(true);
    // A stated plan budget is guidance for the Game Master's own judgement,
    // not a deterministic cap -- an over-budget spend still applies.
    expect(execute(gm, "payment", "remove_gold", { accountId: account.id, amount: 20, reason: "Pay for work" }).ok).toBe(true);
    expect(gm.stagedWorld.material.accounts.find(a => a.id === account.id)!.balance).toBe(980);
    expect(gm.stagedWorld.plans![0]!.spent).toBe(20);
  });
  it("retains completed stages over a save/load and refuses to repeat their effects", () => {
    const gm = session();
    expect(interpret(gm, [stage("first"), stage("second", { dependsOn: ["first"], notBeforeStep: 2 })]).ok).toBe(true);
    expect(execute(gm, "second", "rename_character", { characterId: PLAYER, newName: "Too soon" }).ok).toBe(false);
    expect(execute(gm, "first", "rename_character", { characterId: PLAYER, newName: "First name" }).ok).toBe(true);
    const resumed = session(WorldStateSchema.parse(gm.stagedWorld), 2, false);
    expect(execute(resumed, "first", "rename_character", { characterId: PLAYER, newName: "Repeated" }).ok).toBe(false);
    expect(execute(resumed, "second", "rename_character", { characterId: PLAYER, newName: "Second name" }).ok).toBe(true);
    expect(resumed.stagedWorld.plans![0]!.status).toBe("completed");
    expect(resumed.stagedWorld.plans![0]!.stages.every(s => s.resultFactIds.length === 1)).toBe(true);
    expect(WorldStateSchema.safeParse(resumed.stagedWorld).success).toBe(true);
  });

  it("blocks direct player actions from bypassing plan tracking", () => {
    const gm = session();
    expect(gm.invoke(call("rename_character", { actorId: PLAYER, characterId: PLAYER, newName: "Bypass" })).ok).toBe(false);
    expect(gm.stagedWorld.characters.find(c => c.id === PLAYER)!.name).not.toBe("Bypass");
  });

  it("rejects cycles, unselected delegates and edits to completed stages", () => {
    const gm = session();
    expect(interpret(gm, [stage("first", { dependsOn: ["second"] }), stage("second")]).ok).toBe(false);
    expect(interpret(gm, [stage("first", { actorId: "unselected" })]).ok).toBe(false);
    expect(interpret(gm, [stage("first"), stage("second")]).ok).toBe(true);
    expect(execute(gm, "first", "rename_character", { characterId: PLAYER, newName: "Completed" }).ok).toBe(true);
    expect(interpret(gm, [stage("first"), stage("second")]).ok).toBe(true);
    expect(interpret(gm, [stage("first", { objective: "Different objective" }), stage("second")]).ok).toBe(false);
  });

  it("tracks cumulative spending across stages without capping it at the stated budget", () => {
    const world = base();
    const account = world.material.accounts[0]!;
    account.balance = 1_000;
    const gm = session(world);
    expect(interpret(gm, [stage("first"), stage("second")], PlanOptionsSchema.parse({ budget: { accountId: account.id, amount: 60 } })).ok).toBe(true);
    expect(spendAction(gm, account.id, 960).ok).toBe(true);
    expect(spendAction(gm, account.id, 930).ok).toBe(true);
    expect(execute(gm, "first", "spend_to_960", {}).ok).toBe(true);
    expect(execute(gm, "second", "spend_to_930", {}).ok).toBe(true);
    expect(gm.stagedWorld.material.accounts.find(a => a.id === account.id)!.balance).toBe(930);
    expect(gm.stagedWorld.plans![0]!.spent).toBe(70);
    expect(gm.stagedWorld.plans![0]!.stages[1]!.status).toBe("completed");
  });

  it("requires a delegate's acceptance before they can execute a stage", () => {
    const world = base();
    const player = world.characters.find(c => c.id === PLAYER)!;
    const delegate = world.characters.find(c => c.id !== PLAYER && c.alive && (c.locationProvinceId === player.locationProvinceId || (player.polityId != null && c.polityId === player.polityId)))!;
    const destination = world.map.provinces.find(p => p.id !== player.locationProvinceId && p.id !== delegate.locationProvinceId)!;
    const gm = session(world);
    expect(interpret(gm, [stage("travel"), stage("delegate", { actorId: delegate.id })], PlanOptionsSchema.parse({ delegateIds: [delegate.id] })).ok).toBe(true);
    expect(execute(gm, "travel", "move_character", { characterId: PLAYER, destinationProvinceId: destination.id }).ok).toBe(true);
    expect(execute(gm, "delegate", "move_character", { characterId: delegate.id, destinationProvinceId: destination.id }).ok).toBe(false);
    expect(gm.invoke(call("respond_to_plan_assignment", { planId: PLAN, actorId: delegate.id, accepted: true, reason: "The journey serves my interests." })).ok).toBe(true);
    expect(execute(gm, "delegate", "move_character", { characterId: delegate.id, destinationProvinceId: destination.id }).ok).toBe(true);
  });

  it("preserves progress on revision and stops a cancelled plan", () => {
    const gm = session();
    expect(interpret(gm, [stage("first"), stage("second")]).ok).toBe(true);
    expect(execute(gm, "first", "rename_character", { characterId: PLAYER, newName: "Done" }).ok).toBe(true);
    const revised = preparePlayerPlans(gm.stagedWorld, PLAYER, 2, [{ id: "revision", directive: { kind: "revise", actionId: PLAN, text: "Use another approach for the rest." } }]);
    expect(revised.plans![0]!.stages).toHaveLength(1);
    expect(revised.plans![0]!.revisions).toHaveLength(2);
    const stopped = preparePlayerPlans(revised, PLAYER, 3, [{ id: "cancel", directive: { kind: "cancel", actionId: PLAN } }]);
    expect(execute(session(stopped, 3, false), "first", "rename_character", { characterId: PLAYER, newName: "Again" }).ok).toBe(false);
  });

  it("reopens an explicitly recurring stage only when due", () => {
    const gm = session();
    expect(interpret(gm, [stage("repeat", { repeatEverySteps: 2 })]).ok).toBe(true);
    expect(execute(gm, "repeat", "rename_character", { characterId: PLAYER, newName: "Standing task" }).ok).toBe(true);
    const readStage = (world: WorldState): ActionPlan["stages"][number] => world.plans![0]!.stages[0]!;
    expect(readStage(preparePlayerPlans(gm.stagedWorld, PLAYER, 2, [])).status).toBe("completed");
    expect(readStage(preparePlayerPlans(gm.stagedWorld, PLAYER, 3, [])).status).toBe("pending");
    expect(OrderBatchSchema.safeParse({ directives: [] }).success).toBe(true);
  });

  it("cannot define away the time ledger or plan budget", () => {
    const gm = session();
    expect(gm.invoke(call("define_action", { actionId: "erase_time", intent: "Erase time", description: "Erase time", parameters: [], operations: [{ op: "replace", path: "/actorActivities", value: [] }] })).ok).toBe(true);
    expect(interpret(gm, [stage("first")]).ok).toBe(true);
    expect(execute(gm, "first", "erase_time", {}).ok).toBe(false);
  });
});

describe("execute_plan_stage with completesAtStep (unified action runtime, Stage 3)", () => {
  it("starts the stage and schedules it, without applying the action yet, when completesAtStep is given", () => {
    const gm = sessionWithClock();
    expect(interpret(gm, [stage("send")]).ok).toBe(true);
    const result = gm.invoke(call("execute_plan_stage", {
      planId: PLAN, stageId: "send", actionId: "send_diplomatic_message", parameters: diplomaticMessageParams, completesAtStep: 4,
    }));
    expect(result.ok).toBe(true);
    const planStage = gm.stagedWorld.plans![0]!.stages.find((s) => s.id === "send")!;
    expect(planStage.status).toBe("in_progress");
    expect(planStage.expectedCompletionStep).toBe(4);
    expect(planStage.durationEstimate).toMatchObject({ minimumSteps: 1, likelySteps: 3, maximumSteps: 14 });
    expect(gm.result().scheduledPlanPhases).toEqual([
      { planId: PLAN, stageId: "send", actionId: "send_diplomatic_message", actorId: PLAYER, parameters: diplomaticMessageParams, atStep: 4 },
    ]);
    // Not applied yet -- no diplomatic message exists in the staged world.
    expect(gm.stagedWorld.diplomacy ?? []).toEqual([]);
  });

  it("refuses a completesAtStep outside the action's own declared duration range", () => {
    const gm = sessionWithClock();
    expect(interpret(gm, [stage("send")]).ok).toBe(true);
    const result = gm.invoke(call("execute_plan_stage", {
      planId: PLAN, stageId: "send", actionId: "send_diplomatic_message", parameters: diplomaticMessageParams, completesAtStep: 100,
    }));
    expect(result.ok).toBe(false);
    expect(result.factual).toMatch(/duration estimate/i);
    expect(gm.stagedWorld.plans![0]!.stages.find((s) => s.id === "send")!.status).toBe("pending");
  });

  it("refuses a completesAtStep at or before the current step", () => {
    const gm = sessionWithClock();
    expect(interpret(gm, [stage("send")]).ok).toBe(true);
    const result = gm.invoke(call("execute_plan_stage", {
      planId: PLAN, stageId: "send", actionId: "send_diplomatic_message", parameters: diplomaticMessageParams, completesAtStep: 1,
    }));
    expect(result.ok).toBe(false);
  });

  it("accepts any future step for an action with no declared duration estimate", () => {
    const gm = sessionWithClock();
    expect(interpret(gm, [stage("first")]).ok).toBe(true);
    const result = gm.invoke(call("execute_plan_stage", {
      planId: PLAN, stageId: "first", actionId: "rename_character", parameters: { characterId: PLAYER, newName: "Later" }, completesAtStep: 50,
    }));
    expect(result.ok).toBe(true);
    expect(gm.stagedWorld.plans![0]!.stages.find((s) => s.id === "first")!.durationEstimate).toMatchObject({ minimumSteps: 49, likelySteps: 49, maximumSteps: 49 });
  });

  it("omitting completesAtStep still resolves the stage atomically, exactly as before", () => {
    const gm = sessionWithClock();
    expect(interpret(gm, [stage("first")]).ok).toBe(true);
    const result = gm.invoke(call("execute_plan_stage", { planId: PLAN, stageId: "first", actionId: "rename_character", parameters: { characterId: PLAYER, newName: "Now" } }));
    expect(result.ok).toBe(true);
    expect(gm.stagedWorld.plans![0]!.stages.find((s) => s.id === "first")!.status).toBe("completed");
    expect(gm.result().scheduledPlanPhases).toEqual([]);
  });
});
