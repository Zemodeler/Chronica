import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Petition the Senate for the Sicilian command. Once I receive it, raise an
 * additional 5000 men known as Legio II."
 *
 * The second sentence waited on the Senate's vote, and no trigger could say
 * so: it was dropped, the command came, nothing was raised, and the next order
 * -- merge Legio II into Legio I -- met a legion that did not exist. It is now
 * a plan that waits on the question, and when the question is carried the
 * consul is handed the wheel with his own order in front of him.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("command"),
  gameId: "game-command",
};

describe("an order that waits on the Senate", () => {
  const given = applyDeltas(world(), [
    WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: "command", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "The Sicilian command for Gaius Genucius Clepsina", resolutionMechanism: "vote", deadlineInDays: 10,
      reason: "The consul asks for the command.",
    }),
    WorldDeltaSchema.parse({
      op: "contingency_arm", localId: "legio_ii", label: "Legio II, once the command is given", ownerCharacterRef: "gaius-genucius",
      trigger: { kind: "question_decided", procedureId: "local:command", outcome: "passed" }, effect: "stand_to",
      provinceId: "punic-italy-latium", standingOrder: "Raise an additional 5000 men known as Legio II.",
      reason: "The consul's order for when the command is his.",
    }),
  ], context);

  it("is laid against the question the same order asked", () => {
    expect(given.rejected).toEqual([]);
    const plan = given.world.contingencies.at(-1)!;
    expect(plan.trigger).toEqual({ kind: "question_decided", procedureId: given.assignedIds.get("command"), outcome: "passed" });
    expect(plan.armedReading).toBe("no");
  });

  it("hands the consul his own order when the Senate carries it", () => {
    let state = given.world;
    const met: string[] = [];
    for (const day of [10, 11, 12]) {
      const ticked = runDeterministicTick({
        world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`command-${day}`), warfare: definition.warfare,
        government: { offices: definition.government.offices, successionRules: definition.government.successionRules ?? [] },
      });
      met.push(...ticked.factProposals.filter((fact) => fact.kind === "contingency_met").map((fact) => fact.summary));
      state = ticked.world;
    }
    const question = state.material.politicalProcedures.find((procedure) => procedure.id === given.assignedIds.get("command"))!;
    expect(question.outcome).toBe("passed");
    expect(state.contingencies.at(-1)!.status).toBe("sprung");
    expect(met.join(" ")).toContain("Raise an additional 5000 men known as Legio II.");
  });
});
