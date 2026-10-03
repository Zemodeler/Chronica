import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
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
const BRUTTIUM = PUNIC_IDS.rhegium;
const army = (state: WorldState) => state.material.forces.find((force) => force.id === "roman-field-army")!;

describe("a long march", () => {
  it("sets out on a far march instead of refusing it, and arrives when the road is walked", () => {
    const result = applyDeltas(world(), [WorldDeltaSchema.parse({
      op: "force_modify", forceRef: "roman-field-army", locationId: BRUTTIUM, moraleBpsDelta: 200, reason: "March on Rhegium.",
    })], context);
    expect(result.rejected).toEqual([]);
    // Still at home today, with the rest of the order carried out.
    expect(army(result.world).locationId).toBe(PUNIC_IDS.rome);
    // Read by its size: a little heart, which the engine says is 500.
    expect(army(result.world).moraleBps).toBe(Math.min(10_000, army(world()).moraleBps + 500));
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
    expect(army(second.world).moraleBps).toBe(Math.min(10_000, army(first.world).moraleBps + 500));
  });
});

describe("a march over the strait", () => {
  const MESSANA = PUNIC_IDS.messana;
  const withFleet = (state: WorldState, warships: number): WorldState => ({
    ...state,
    material: {
      ...state.material,
      forces: [...state.material.forces, {
        ...state.material.forces.find((force) => force.id === "allied-greek-hulls")!,
        id: "roman-transports",
        name: "Roman transports",
        locationId: PUNIC_IDS.rome,
        personnel: [{ categoryId: "warship", label: "Transports", fit: warships, unavailable: [] }],
        history: [],
      }],
    },
  });
  const march = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, reason: "Cross to Messana." });
  const tickUntil = (state: WorldState, until: number): WorldState => {
    let now = state;
    for (let day = 10; day <= until; day += 10) {
      now = runDeterministicTick({ world: { ...now, elapsedStep: day }, toDay: day, ids: createIdFactory(`strait-${day}`), warfare: definition.warfare }).world;
    }
    return now;
  };

  /**
   * Three hulls at Rhegium, ninety men a load: a hundred loads, not a ferry.
   * The eighteen allied transports the scenario now has carry the legion over
   * the strait in a few days (E22), so the refusal needs too few to be had.
   */
  const fewHulls = (): WorldState => {
    const state = world();
    return { ...state, material: { ...state.material, forces: state.material.forces.map((force) => (force.id === "allied-greek-hulls" ? { ...force, personnel: [{ categoryId: "warship", label: "Allied transports", fit: 3, unavailable: [] }] } : force)) } };
  };

  it("is refused without ships to cross in", () => {
    // Legio I in Latium with too few Greek hulls in Bruttium, and Syracuse
    // refusing to ferry it: "Transport Legio I across the strait" completed
    // anyway, and the legion walked into Messana.
    const result = applyDeltas(fewHulls(), [march], context);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/over water/);
    expect(result.world.projects.some((project) => project.completionOutcome?.kind === "force_move")).toBe(false);
  });

  it("refuses a project written to carry it over, too", () => {
    const result = applyDeltas(fewHulls(), [WorldDeltaSchema.parse({
      op: "project_create", localId: "transport", kind: "transport", label: "Transport Legio I across the strait to Messana",
      sponsorRef: { kind: "character", id: "gaius-genucius" }, fundingAccountRef: null,
      milestones: [{ label: "Embark and cross", dueInDays: 20, costAmount: 0 }],
      completionOutcome: { kind: "force_move", label: "Legio I in Messana", amount: 0, provinceId: MESSANA, polityId: null, commanderCharacterRef: null, forceRef: "roman-field-army", beneficiaryAccountRef: null, cadenceDays: null, agreementKind: null, withPolityId: null },
      reason: "Carry the legion over.",
    })], context);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/over water/);
  });

  it("goes over in its own ships, and the ships go with it", () => {
    const start = withFleet(world(), 400);
    const result = applyDeltas(start, [march], context);
    expect(result.rejected).toEqual([]);
    // The crossing: the march or the sailing that brings army and ships to
    // the shore is one of its legs, and finishes first.
    const journey = result.world.projects.find((project) => project.kind === "crossing") ?? result.world.projects.find((project) => project.completionOutcome?.kind === "force_move")!;
    const arrived = tickUntil(result.world, journey.milestones.at(-1)!.requiredAtElapsedOffset + 10);
    expect(army(arrived).locationId).toBe(MESSANA);
    expect(arrived.material.forces.find((force) => force.id === "roman-transports")!.locationId).toBe(MESSANA);
  });

  it("stays on the shore when its ships have gone by the day it arrives, and says why", () => {
    const start = withFleet(world(), 400);
    const result = applyDeltas(start, [march], context);
    // The crossing: the march or the sailing that brings army and ships to
    // the shore is one of its legs, and finishes first.
    const journey = result.world.projects.find((project) => project.kind === "crossing") ?? result.world.projects.find((project) => project.completionOutcome?.kind === "force_move")!;
    const sailed: WorldState = { ...result.world, material: { ...result.world.material, forces: result.world.material.forces.filter((force) => force.id !== "roman-transports") } };
    let state = sailed;
    const facts: string[] = [];
    for (let day = 10; day <= journey.milestones.at(-1)!.requiredAtElapsedOffset + 10; day += 10) {
      const ticked = runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`shore-${day}`), warfare: definition.warfare });
      facts.push(...ticked.factProposals.filter((fact) => fact.kind === "project_completed").map((fact) => fact.summary));
      state = ticked.world;
    }
    // On the shore it walked to for the ships, and no further.
    expect(army(state).locationId).not.toBe(MESSANA);
    expect(facts.join(" ")).toMatch(/produced nothing it was meant to\. .*over water/);
  });
});
