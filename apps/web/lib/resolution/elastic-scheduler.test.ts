import { describe, expect, it } from "vitest";
import type { FactualEvent, PlayerPlan, ScenarioClock } from "@chronica/shared";
import { ScenarioClockSchema, PlayerPlanSchema } from "@chronica/shared";
import { decideElasticStop } from "./elastic-scheduler";

const clock: ScenarioClock = ScenarioClockSchema.parse({
  stepLabel: "season",
  stepLabelPlural: "seasons",
  stepsPerYear: 4,
  minSpan: 1,
  maxSpan: 4,
});

function fact(overrides: Partial<FactualEvent> = {}): FactualEvent {
  return {
    id: "fact-1",
    atStep: 1,
    kind: "action",
    actionId: "move_force",
    actorId: "marcus-atilius",
    parameters: {},
    summary: "A force moves.",
    materialConsequence: true,
    ...overrides,
  };
}

function plan(overrides: Partial<PlayerPlan> = {}): PlayerPlan {
  return PlayerPlanSchema.parse({
    id: "plan-1",
    ownerId: "marcus-atilius",
    sourceDirectiveId: "directive-0",
    rawText: "Do something",
    revisions: [{ atStep: 1, text: "Do something" }],
    options: {},
    interpretation: "",
    status: "active",
    stages: [],
    assignments: [],
    spent: 0,
    createdAtStep: 1,
    updatedAtStep: 1,
    ...overrides,
  });
}

describe("decideElasticStop (docs/32, Phase 7, shadow mode)", () => {
  it("computes elapsedDayStart/End from the scenario clock's own stepsPerYear", () => {
    const decision = decideElasticStop({ elapsedStepStart: 4, scenarioClock: clock, factualEvents: [fact()], plans: [] });
    expect(decision.elapsedDayStart).toBe(365);
    expect(decision.elapsedDayEnd).toBeGreaterThan(decision.elapsedDayStart);
  });

  it("stops for player_decision, ignoring minSpan, when a character flagged an initiated dialogue this turn", () => {
    const decision = decideElasticStop({
      elapsedStepStart: 0,
      scenarioClock: clock,
      factualEvents: [fact({ actionId: "flag_npc_initiated_dialogue", id: "fact-dialogue" })],
      plans: [],
    });
    expect(decision.stopReason).toBe("player_decision");
    expect(decision.stoppingFactIds).toEqual(["fact-dialogue"]);
    expect(decision.requestedPlayerDecision).not.toBeNull();
  });

  it("stops for player_decision when a plan has outstanding clarification questions, citing the plan id", () => {
    const clarifying = plan({ clarificationQuestions: ["Which legion do you mean?"] });
    const decision = decideElasticStop({ elapsedStepStart: 0, scenarioClock: clock, factualEvents: [fact()], plans: [clarifying] });
    expect(decision.stopReason).toBe("player_decision");
    expect(decision.stoppingFactIds).toEqual([clarifying.id]);
    expect(decision.requestedPlayerDecision).toBe("Which legion do you mean?");
  });

  it("stops immediately (bypassing minSpan) for an irreversible player-involving event", () => {
    const decision = decideElasticStop({
      elapsedStepStart: 0,
      scenarioClock: clock,
      factualEvents: [fact()],
      plans: [],
      irreversibleEventFactIds: ["fact-death"],
    });
    expect(decision.stopReason).toBe("salient_event");
    expect(decision.stoppingFactIds).toEqual(["fact-death"]);
  });

  it("suppresses a routine reason (watch_condition/plan_interrupted/threshold_crossed) below minSpan", () => {
    // move_force's own 14-day duration is well under this clock's ~91-day minSpan.
    const decision = decideElasticStop({
      elapsedStepStart: 0,
      scenarioClock: clock,
      factualEvents: [fact()],
      plans: [],
      watchConditionFactIds: ["fact-watch"],
    });
    expect(decision.stopReason).not.toBe("watch_condition");
  });

  it("honors a routine reason once this turn's own advance reaches minSpan", () => {
    // A daily-step clock makes minSpan (1 step) equal to 1 day -- move_force's 14-day duration clears it.
    const dailyClock = ScenarioClockSchema.parse({ stepLabel: "day", stepLabelPlural: "days", stepsPerYear: 365, minSpan: 1, maxSpan: 10_000 });
    const decision = decideElasticStop({
      elapsedStepStart: 0,
      scenarioClock: dailyClock,
      factualEvents: [fact()],
      plans: [],
      watchConditionFactIds: ["fact-watch"],
    });
    expect(decision.stopReason).toBe("watch_condition");
    expect(decision.stoppingFactIds).toEqual(["fact-watch"]);
  });

  it("prioritizes plan_interrupted over threshold_crossed when both are present and minSpan is cleared", () => {
    const dailyClock = ScenarioClockSchema.parse({ stepLabel: "day", stepLabelPlural: "days", stepsPerYear: 365, minSpan: 1, maxSpan: 10_000 });
    const decision = decideElasticStop({
      elapsedStepStart: 0,
      scenarioClock: dailyClock,
      factualEvents: [fact()],
      plans: [],
      planInterruptionFactIds: ["fact-interrupted"],
      thresholdCrossedFactIds: ["fact-threshold"],
    });
    expect(decision.stopReason).toBe("plan_interrupted");
  });

  it("stops for max_span when a single turn's own action duration already exceeds the scenario's span, even with nothing else to report", () => {
    // start_war's 45-day duration exceeds this tight clock's ~7-day maxSpan (1 step at 52 steps/year).
    const tightClock = ScenarioClockSchema.parse({ stepLabel: "week", stepLabelPlural: "weeks", stepsPerYear: 52, minSpan: 1, maxSpan: 1 });
    const decision = decideElasticStop({ elapsedStepStart: 0, scenarioClock: tightClock, factualEvents: [fact({ actionId: "start_war" })], plans: [] });
    expect(decision.stopReason).toBe("max_span");
  });

  it("reports null (elastic time would keep advancing) when nothing modeled fired and max span was not reached", () => {
    const generousClock = ScenarioClockSchema.parse({ ...clock, minSpan: 1, maxSpan: 10_000 });
    const decision = decideElasticStop({ elapsedStepStart: 0, scenarioClock: generousClock, factualEvents: [fact({ actionId: "add_gold" })], plans: [] });
    expect(decision.stopReason).toBeNull();
    expect(decision.stoppingFactIds).toEqual([]);
  });
});
