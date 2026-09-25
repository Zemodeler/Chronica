import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "March the army to Bruttium."
 *
 * An army moves one province at a time, and a march further than that was
 * refused -- with a note saying the journey should have been written as a
 * project, which nobody then wrote. The consul's order simply did not happen.
 * Now the order is the march: the army sets out today and arrives when the
 * road has been walked.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("march"),
  gameId: "game-march",
};
const BRUTTIUM = "punic-italy-bruttian-highlands";
const army = (state: WorldState) => state.material.forces.find((force) => force.id === "roman-field-army")!;

describe("a long march", () => {
  it("sets out on a far march instead of refusing it, and arrives when the road is walked", () => {
    const result = applyDeltas(world(), [WorldDeltaSchema.parse({
      op: "force_modify", forceRef: "roman-field-army", locationId: BRUTTIUM, moraleBpsDelta: 200, reason: "March on Rhegium.",
    })], context);
    expect(result.rejected).toEqual([]);
    // Still at home today, with the rest of the order carried out.
    expect(army(result.world).locationId).toBe("punic-italy-latium");
    expect(army(result.world).moraleBps).toBe(army(world()).moraleBps + 200);
    const journey = result.world.projects.find((project) => project.completionOutcome?.kind === "force_move");
    expect(journey?.completionOutcome?.provinceId).toBe(BRUTTIUM);
    const setOut = result.factProposals.find((fact) => fact.kind === "march_begun");
    expect(setOut?.summary).toMatch(/days on the road/);

    const due = journey!.milestones.at(-1)!.requiredAtElapsedOffset;
    let state = result.world;
    for (let day = 10; day <= due + 10; day += 10) {
      state = runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`march-${day}`), warfare: definition.warfare }).world;
    }
    expect(army(state).locationId).toBe(BRUTTIUM);
  });
});

describe("an army already on the road", () => {
  it("is not sent out again when the same march is ordered a second time", () => {
    const march = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "roman-field-army", locationId: BRUTTIUM, reason: "March on Rhegium." });
    const first = applyDeltas(world(), [march], context);
    const second = applyDeltas(first.world, [WorldDeltaSchema.parse({ ...march, moraleBpsDelta: 100 })], { ...context, ids: createIdFactory("march-again") });
    expect(second.rejected).toEqual([]);
    const journeys = second.world.projects.filter((project) => project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === "roman-field-army");
    expect(journeys).toHaveLength(1);
    expect(second.factProposals.some((fact) => fact.kind === "march_begun")).toBe(false);
    // The rest of the repeated order still happens.
    expect(army(second.world).moraleBps).toBe(army(first.world).moraleBps + 100);
  });
});
