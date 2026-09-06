import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { createGameMasterSession } from "./session";
import { preparePlayerPlans, PlanOptionsSchema, type PlayerPlan } from "../actions/plans";
import { OrderBatchSchema } from "../actions/orders";
import { buildGameMasterTools } from "./tools";

const PLAYER = "marcus-atilius";
const PLAN = "plan-1-directive-0";
const call = (name: string, args: Record<string, unknown>) => ({ id: "test-call", name, arguments: args });
function base() { return structuredClone(firstPunicWarScenario.initialWorld); }
function session(world = base(), options = PlanOptionsSchema.parse({}), atStep = 1, fresh = true) {
  return createGameMasterSession({ world, atStep, actorCharacterId: PLAYER, directiveIds: fresh ? ["directive-0"] : [],
    directives: fresh ? [{ id: "directive-0", directive: { kind: "new", text: "Carry out the plan in stages.", planOptions: options } }] : [],
    // Two tests below define an action via a plan stage (docs/27: off by
    // default in normal play, but this suite is specifically about what a
    // defined action can and cannot do to plan bookkeeping).
    allowInventedActions: true });
}
function interpret(gm: ReturnType<typeof session>, stages: Record<string, unknown>[]) {
  return gm.invoke(call("interpret_plan", { planId: PLAN, interpretation: "Carry out the requested stages", stages }));
}
const stage = (id: string, extra: Record<string, unknown> = {}) => ({ id, objective: `Task ${id}`, actorId: PLAYER, ...extra });
function execute(gm: ReturnType<typeof session>, stageId: string, actionId: string, parameters: Record<string, unknown>) {
  return gm.invoke(call("execute_plan_stage", { planId: PLAN, stageId, actionId, parameters }));
}
function spendAction(gm: ReturnType<typeof session>, accountId: string, balance: number) {
  return gm.invoke(call("define_action", { actionId: `spend_to_${balance}`, intent: "Pay for the planned work", description: "Pay for work", parameters: [],
    operations: [{ op: "replace", path: `/material/accounts[id=${accountId}]/balance`, value: balance }] }));
}

describe("persistent player plans", () => {
  it("keeps the combined tool surface within the provider limit", () => {
    expect(buildGameMasterTools().length).toBeLessThanOrEqual(128);
  });

  it("checks registered spending actions before committing balances or time", () => {
    const world = base();
    const account = world.material.accounts[0]!;
    account.balance = 1_000;
    world.material.accountAccess.push({ id: "test-access", characterId: PLAYER, accountId: account.id, permissions: ["spend_without_vote"], sourceKind: "ownership", sourceId: PLAYER });
    const gm = session(world, PlanOptionsSchema.parse({ budget: { accountId: account.id, amount: 10 } }));
    expect(interpret(gm, [stage("payment")]).ok).toBe(true);
    const refused = execute(gm, "payment", "remove_gold", { accountId: account.id, amount: 20, reason: "Pay for work" });
    expect(refused.factual).toContain("budget");
    expect(gm.stagedWorld.material.accounts.find(a => a.id === account.id)!.balance).toBe(1_000);
    expect(gm.stagedWorld.actorActivities ?? []).toHaveLength(0);
    expect(execute(gm, "payment", "remove_gold", { accountId: account.id, amount: 10, reason: "Pay for smaller work" }).ok).toBe(true);
    expect(gm.stagedWorld.playerPlans![0]!.spent).toBe(10);
  });
  it("retains completed stages over a save/load and refuses to repeat their effects", () => {
    const gm = session();
    expect(interpret(gm, [stage("first"), stage("second", { dependsOn: ["first"], notBeforeStep: 2 })]).ok).toBe(true);
    expect(execute(gm, "second", "rename_character", { characterId: PLAYER, newName: "Too soon" }).ok).toBe(false);
    expect(execute(gm, "first", "rename_character", { characterId: PLAYER, newName: "First name" }).ok).toBe(true);
    const resumed = session(WorldStateSchema.parse(gm.stagedWorld), PlanOptionsSchema.parse({}), 2, false);
    expect(execute(resumed, "first", "rename_character", { characterId: PLAYER, newName: "Repeated" }).ok).toBe(false);
    expect(execute(resumed, "second", "rename_character", { characterId: PLAYER, newName: "Second name" }).ok).toBe(true);
    expect(resumed.stagedWorld.playerPlans![0]!.status).toBe("completed");
    expect(resumed.stagedWorld.playerPlans![0]!.stages.every(s => s.factRefs.length === 1)).toBe(true);
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

  it("enforces actual cumulative spending and rolls back an over-budget action", () => {
    const world = base();
    const account = world.material.accounts[0]!;
    account.balance = 1_000;
    const gm = session(world, PlanOptionsSchema.parse({ budget: { accountId: account.id, amount: 60 } }));
    expect(interpret(gm, [stage("first"), stage("second")]).ok).toBe(true);
    expect(spendAction(gm, account.id, 960).ok).toBe(true);
    expect(spendAction(gm, account.id, 930).ok).toBe(true);
    expect(execute(gm, "first", "spend_to_960", {}).ok).toBe(true);
    const eventsBefore = gm.result().events.length;
    expect(execute(gm, "second", "spend_to_930", {}).factual).toContain("budget");
    expect(gm.stagedWorld.material.accounts.find(a => a.id === account.id)!.balance).toBe(960);
    expect(gm.stagedWorld.playerPlans![0]!.spent).toBe(40);
    expect(gm.result().events).toHaveLength(eventsBefore);
    expect(gm.stagedWorld.playerPlans![0]!.stages[1]!.status).toBe("blocked");
  });

  it("uses each delegate's own time and requires their acceptance", () => {
    const world = base();
    const delegate = world.characters.find(c => c.id !== PLAYER && c.alive)!;
    const destination = world.map.provinces.find(p => p.id !== world.characters.find(c => c.id === PLAYER)!.locationProvinceId && p.id !== delegate.locationProvinceId)!;
    const gm = session(world, PlanOptionsSchema.parse({ delegateIds: [delegate.id] }));
    expect(interpret(gm, [stage("travel"), stage("delegate", { actorId: delegate.id })]).ok).toBe(true);
    expect(execute(gm, "travel", "move_character", { characterId: PLAYER, destinationProvinceId: destination.id }).ok).toBe(true);
    expect(execute(gm, "delegate", "move_character", { characterId: delegate.id, destinationProvinceId: destination.id }).ok).toBe(false);
    expect(gm.invoke(call("respond_to_plan_assignment", { planId: PLAN, actorId: delegate.id, accepted: true, reason: "The journey serves my interests." })).ok).toBe(true);
    expect(execute(gm, "delegate", "move_character", { characterId: delegate.id, destinationProvinceId: destination.id }).ok).toBe(true);
    expect(gm.stagedWorld.actorActivities!.filter(a => a.usedBps === 10_000)).toHaveLength(2);
  });

  it("carries excess personal work into the next turn", () => {
    const world = base();
    const destinations = world.map.provinces.filter(p => p.id !== world.characters.find(c => c.id === PLAYER)!.locationProvinceId).slice(0, 2);
    const gm = session(world);
    expect(interpret(gm, [stage("first"), stage("second")]).ok).toBe(true);
    expect(execute(gm, "first", "move_character", { characterId: PLAYER, destinationProvinceId: destinations[0]!.id }).ok).toBe(true);
    expect(execute(gm, "second", "move_character", { characterId: PLAYER, destinationProvinceId: destinations[1]!.id }).factual).toContain("time");
    const next = session(gm.stagedWorld, PlanOptionsSchema.parse({}), 2, false);
    expect(execute(next, "second", "move_character", { characterId: PLAYER, destinationProvinceId: destinations[1]!.id }).ok).toBe(true);
  });

  it("preserves progress on revision and stops a cancelled plan", () => {
    const gm = session();
    expect(interpret(gm, [stage("first"), stage("second")]).ok).toBe(true);
    expect(execute(gm, "first", "rename_character", { characterId: PLAYER, newName: "Done" }).ok).toBe(true);
    const revised = preparePlayerPlans(gm.stagedWorld, PLAYER, 2, [{ id: "revision", directive: { kind: "revise", actionId: PLAN, text: "Use another approach for the rest." } }]);
    expect(revised.playerPlans![0]!.stages).toHaveLength(1);
    expect(revised.playerPlans![0]!.revisions).toHaveLength(2);
    const stopped = preparePlayerPlans(revised, PLAYER, 3, [{ id: "cancel", directive: { kind: "cancel", actionId: PLAN } }]);
    expect(execute(session(stopped, PlanOptionsSchema.parse({}), 3, false), "first", "rename_character", { characterId: PLAYER, newName: "Again" }).ok).toBe(false);
  });

  it("reopens an explicitly recurring stage only when due", () => {
    const gm = session();
    expect(interpret(gm, [stage("repeat", { repeatEverySteps: 2 })]).ok).toBe(true);
    expect(execute(gm, "repeat", "rename_character", { characterId: PLAYER, newName: "Standing task" }).ok).toBe(true);
    const readStage = (world: WorldState): PlayerPlan["stages"][number] => world.playerPlans![0]!.stages[0]!;
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
