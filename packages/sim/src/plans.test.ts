import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type PlanProposal, type WorldState } from "@chronica/shared";
import { routeAmbientActors } from "./attention";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { renderCharacterPortrait } from "./cognition";
import { dueSteps, layPlan, markWoken, nextPlanDay, settleOverdueSteps, STEP_LEAD_DAYS, takeSteps } from "./plans";
import { createIdFactory, type SimModelPort } from "./ports";

/**
 * People who plan, not only react (gap document §5).
 *
 * A man used to be asked what he did this week with his ambition printed as a
 * label, and whether he made progress over two years depended on the rotation
 * landing on him and on him remembering. These pin the part the engine now
 * owns: when it is time.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const offices = definition.government.offices;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const HIERON = "hieron-ii";
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";

const TAKE_MESSANA: PlanProposal = {
  ambition: "Take Messana from the Mamertines",
  kind: "office",
  steps: [
    { act: "Send envoys demanding the Mamertines submit", inDays: 20, when: null },
    { act: "Assault the walls of Messana", inDays: 90, when: { kind: "force_enters_province", provinceId: MESSANA, polityId: "syracuse" } },
  ],
};

const at = (world: WorldState, day: number): WorldState => ({ ...world, instant: { day, minute: 0 } });
const plansOf = (world: WorldState, id = HIERON) => world.characters.find((character) => character.id === id)!.ambitions;

function laid(): { world: WorldState; ambitionId: string } {
  const result = layPlan(opening(), HIERON, TAKE_MESSANA, createIdFactory("t"));
  return { world: result.world, ambitionId: result.ambitionId! };
}

describe("laying a plan", () => {
  it("dates each step from today, in order", () => {
    const { world, ambitionId } = laid();
    const ambition = plansOf(world).find((entry) => entry.id === ambitionId)!;
    expect(ambition.status).toBe("active");
    expect(ambition.steps.map((step) => [step.dueDay, step.status])).toEqual([[20, "pending"], [90, "pending"]]);
    expect(ambition.steps[1]!.waitsOn?.kind).toBe("force_enters_province");
  });

  it("laid again under the same want, keeps what is done and replaces what is not", () => {
    const first = laid();
    const stepId = plansOf(first.world).find((entry) => entry.id === first.ambitionId)!.steps[0]!.id;
    const done = takeSteps(first.world, HIERON, [stepId], true).world;
    const again = layPlan(at(done, 30), HIERON, { ambition: "take messana", kind: "office", steps: [{ act: "Bribe a gate-keeper", inDays: 15, when: null }] }, createIdFactory("t2"));
    expect(again.ambitionId).toBe(first.ambitionId);
    const steps = plansOf(again.world).find((entry) => entry.id === first.ambitionId)!.steps;
    expect(steps.map((step) => [step.act, step.status])).toEqual([
      ["Send envoys demanding the Mamertines submit", "done"],
      ["Bribe a gate-keeper", "pending"],
    ]);
    expect(steps[1]!.dueDay).toBe(45);
  });

  it("is only his: a dead man lays nothing", () => {
    const dead = { ...opening(), characters: opening().characters.map((character) => (character.id === HIERON ? { ...character, alive: false } : character)) };
    expect(layPlan(dead, HIERON, TAKE_MESSANA, createIdFactory("t")).ambitionId).toBeNull();
  });
});

describe("when it is time", () => {
  it("is a week before the step's day, not before", () => {
    const { world } = laid();
    expect(dueSteps(at(world, 20 - STEP_LEAD_DAYS - 1), clock)).toEqual([]);
    const due = dueSteps(at(world, 20 - STEP_LEAD_DAYS), clock);
    expect(due.map((entry) => entry.ownerId)).toEqual([HIERON]);
    expect(due[0]!.why).toContain("Send envoys");
  });

  it("but never before half the step's time has run", () => {
    const quick = layPlan(opening(), HIERON, { ambition: "Answer the envoys", kind: "other", steps: [{ act: "Receive them", inDays: 8, when: null }] }, createIdFactory("q")).world;
    expect(dueSteps(at(quick, 3), clock)).toEqual([]);
    expect(dueSteps(at(quick, 4), clock).map((entry) => entry.ownerId)).toEqual([HIERON]);
  });

  it("wakes its owner once, not every hop", () => {
    const { world } = laid();
    const day = at(world, 15);
    const woken = markWoken(day, dueSteps(day, clock));
    expect(dueSteps(woken, clock)).toEqual([]);
  });

  it("for a step that waits on something, is when that happens", () => {
    const first = laid();
    const stepId = plansOf(first.world).find((entry) => entry.id === first.ambitionId)!.steps[0]!.id;
    const envoysSent = takeSteps(at(first.world, 10), HIERON, [stepId], true).world;
    // The calendar alone does not wake him for the assault: it waits on the army.
    expect(dueSteps(at(envoysSent, 85), clock)).toEqual([]);
    const arrived: WorldState = {
      ...at(envoysSent, 40),
      material: {
        ...envoysSent.material,
        forces: envoysSent.material.forces.map((force) => (force.id === "syracusan-army" ? { ...force, locationId: MESSANA } : force)),
      },
    };
    const due = dueSteps(arrived, clock);
    expect(due.map((entry) => entry.ownerId)).toEqual([HIERON]);
    expect(due[0]!.why).toContain("has happened");
  });

  it("stops the clock for the plan: the week a step comes into, then the day it passes", () => {
    const { world } = laid();
    expect(nextPlanDay(world)).toBe(20 - STEP_LEAD_DAYS);
    const woken = markWoken(at(world, 14), dueSteps(at(world, 14), clock));
    expect(nextPlanDay(woken)).toBe(21);
  });
});

describe("a step not taken by its day", () => {
  it("is missed, in its owner's own record, and wakes him to decide what the plan is now", () => {
    const { world } = laid();
    const late = at(markWoken(at(world, 14), dueSteps(at(world, 14), clock)), 21);
    const settled = settleOverdueSteps(late, clock, (prefix) => prefix);
    expect(settled.missed).toBe(1);
    const [fact] = settled.facts;
    expect(fact!.visibility).toBe("private");
    expect(fact!.knownToRefs).toEqual([{ kind: "character", id: HIERON }]);
    expect(fact!.summary).toContain("fell behind");
    const due = dueSteps(settled.world, clock);
    expect(due[0]!.why).toContain("fallen behind");
    // Woken for it once, and then it is his to answer.
    expect(dueSteps(markWoken(settled.world, due), clock)).toEqual([]);
  });

  it("taken late still counts, but only if the answer left a mark", () => {
    const { world, ambitionId } = laid();
    const settled = settleOverdueSteps(at(world, 25), clock, (prefix) => prefix).world;
    const stepId = plansOf(settled).find((entry) => entry.id === ambitionId)!.steps[0]!.id;
    expect(takeSteps(settled, HIERON, [stepId], false).taken).toBe(0);
    expect(takeSteps(settled, HIERON, [stepId], true).taken).toBe(1);
    // Nobody takes another man's step.
    expect(takeSteps(settled, "hanno-carthage", [stepId], true).taken).toBe(0);
  });
});

describe("the router", () => {
  it("keeps a place for a man whose plan wants him, inside the cast it already had", () => {
    const { world } = laid();
    const day = at(world, 15);
    const due = dueSteps(day, clock);
    const cast = routeAmbientActors({ world: day, facts: [], offices, excludeCharacterIds: [], max: 3, dueStepOwners: new Map(due.map((entry) => [entry.ownerId, entry.why])) });
    expect(cast).toHaveLength(3);
    const hieron = cast.find((actor) => actor.characterId === HIERON)!;
    expect(hieron.pressing).toBe(true);
    expect(hieron.why).toContain("Send envoys");
  });

  it("prints the plan in his section, with the ids he answers by", () => {
    const { world, ambitionId } = laid();
    const text = renderCharacterPortrait(HIERON, "Hieron II", at(world, 15), clock);
    const step = plansOf(world).find((entry) => entry.id === ambitionId)!.steps[0]!;
    expect(text).toContain(`Take Messana from the Mamertines [${ambitionId}]`);
    expect(text).toContain(`next [${step.id}]`);
    expect(text).toContain("once an army of");
  });
});

describe("a burst", () => {
  /** Answers by what the section says, since a large cast is split into concurrent calls. */
  function answering(orchestrate: string, cognition: (user: string) => string): SimModelPort {
    return {
      complete(operation, _system, user) {
        if (operation === "simulate_orchestrate") return Promise.resolve(orchestrate);
        if (operation === "simulate_cognition") return Promise.resolve(cognition(user));
        return Promise.resolve("{}");
      },
    };
  }

  const ORDER = JSON.stringify({
    intent: { summary: "Wait on events.", domains: ["administration"] }, narrativeSummary: "The consul waits.",
    frictions: [], deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });
  const fact = (localId: string, summary: string) => ({ localId, kind: "diplomacy", summary, affectedRefs: [{ kind: "character", id: HIERON }], visibility: "public", discoveryState: "public", significance: 30 });

  async function playAMonth(budget?: Partial<typeof DEFAULT_BUDGET>) {
    let stepId: string | undefined;
    const days: number[] = [];
    const port = answering(ORDER, (user) => {
      const section = user.split(/^## /m).find((part) => part.startsWith(`Hieron II [${HIERON}]`));
      if (section === undefined) return JSON.stringify({ actors: [] });
      const next = /next \[(plan-step-[^\]]+)\]/.exec(section)?.[1];
      // Asked on the rotation with no plan yet, he lays one.
      if (next === undefined) {
        return JSON.stringify({ actors: [{ actorRef: { kind: "character", id: HIERON }, reasoning: "Messana is the key to the strait.", proposal: { narrativeSummary: "Hieron resolves on Messana.", deltas: [], facts: [fact("resolve", "Hieron resolved to bring Messana under Syracuse.")] }, plan: TAKE_MESSANA }] });
      }
      // Woken because the step's week has come, he takes it by its id.
      if (!section.includes("of their plan to")) return JSON.stringify({ actors: [] });
      stepId = next;
      days.push(Number(/in (\d+) day/.exec(section)?.[1] ?? -1));
      return JSON.stringify({ actors: [{ actorRef: { kind: "character", id: HIERON }, reasoning: "Time to send the envoys.", proposal: { narrativeSummary: "Envoys go to Messana.", deltas: [], facts: [fact("envoys", "Syracusan envoys demanded that the Mamertines submit.")] }, stepsTaken: [next] }] });
    });

    // A king with an office is in the ambient cast from the first look. The
    // span is the player waiting a month.
    const result = await runSimulationBurst({
      world: opening(), clock, offices, warfare: definition.warfare, burstId: "plan", gameId: "game-plans",
      actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Let a month pass.", spanDays: 30, knownFacts: [], queue: [], port, narratorSeeds: [],
      ...(budget === undefined ? {} : { budget: { ...DEFAULT_BUDGET, ...budget } }),
    });

    const plan = plansOf(result.world).find((ambition) => ambition.label === TAKE_MESSANA.ambition)!;
    expect(plan).toBeDefined();
    expect(stepId).toBe(plan.steps[0]!.id);
    // Asked in the step's own week, not at the end of the month.
    expect(days[0]).toBeLessThanOrEqual(STEP_LEAD_DAYS);
    expect(plan.steps.map((step) => step.status)).toEqual(["done", "pending"]);
    expect(result.plans.laid).toBe(1);
    expect(result.plans.taken).toBe(1);
    expect(result.plans.woken).toBeGreaterThanOrEqual(1);
    // The world stopped for the step's week rather than jumping the month.
    expect(result.newFacts.some((entry) => entry.summary.includes("envoys demanded"))).toBe(true);
  }

  it("carries a man from laying a plan to being woken for its step and taking it", async () => {
    await playAMonth();
  });

  it("still asks him when the burst's reactions were spent long before his step came due", async () => {
    // One round of reactions only: the plan is laid in it, and the step's
    // week comes a fortnight later, with no reaction left to ride along in.
    await playAMonth({ maxCausalDepth: 1 });

  });
});
