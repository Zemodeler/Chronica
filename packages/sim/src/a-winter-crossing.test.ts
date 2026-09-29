import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  MechanicPredicateSchema,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  dayOfCalendarDate,
  ensureProvinceMaterial,
  passageFor,
  sailingSeason,
  stormFinds,
  type Force,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { perilsOfTheRoad } from "./crossings";
import { createIdFactory } from "./ports";
import { holdsIn } from "./watch";

/**
 * "Cross to Sicily before the year is out."
 *
 * Nothing in the engine knew what month it was: a fleet put out for Africa in
 * January as calmly as in July, and a legion marched as fast through the
 * winter mud as along summer roads. The sea is shut from December to
 * February now, risky at either edge of the season, and a voyage rolls
 * against the weather; a march takes longer in winter.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const LILYBAEUM = "ita-72843720b81376294924159-sicily-west";
const BRUTTIUM = "punic-italy-bruttian-highlands";
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";
const LATIUM = "punic-italy-latium";
const CAMPANIA = "punic-italy-campanian-plain";

/** Days from the epoch (1 March 270 BC) to the first of a month that year or the next. */
const firstOf = (month: number): number => dayOfCalendarDate({ year: month >= 3 ? 270 : 269, era: "BCE", month, day: 1 }, clock);

function opening(): WorldState {
  return ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
}
const forceOf = (world: WorldState, id: string): Force => world.material.forces.find((force) => force.id === id)!;
const fit = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

describe("the sailing season", () => {
  it("is open in summer, risky at its edges, shut in the dead of winter", () => {
    expect(sailingSeason(7)).toBe("open");
    expect(sailingSeason(3)).toBe("risky");
    expect(sailingSeason(11)).toBe("risky");
    expect(sailingSeason(1)).toBe("shut");
    expect(sailingSeason(null)).toBe("open");
  });

  it("shuts the open sea to Africa in January, and opens it in July", () => {
    const world = opening();
    const army = forceOf(world, "carthaginian-garrison");
    const january = passageFor(world, army, LILYBAEUM, definition.warfare, 1);
    expect(january.by).toBeNull();
    expect(january.by === null ? january.reason : "").toMatch(/sea is shut for the winter/);
    expect(passageFor(world, army, LILYBAEUM, definition.warfare, 7).by).toBe("sea");
  });

  it("still lets a strait be risked in winter", () => {
    const world = opening();
    const small = { ...forceOf(world, "roman-field-army"), locationId: BRUTTIUM, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_000, unavailable: [] }] };
    const passage = passageFor({ ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === small.id ? small : force)) } }, small, MESSANA, definition.warfare, 1);
    expect(passage.by).toBe("sea");
    expect(passage.by === "sea" ? passage.over : null).toBe("strait");
  });
});

describe("a storm", () => {
  it("never finds a summer strait, and sometimes finds the winter sea", () => {
    const summer = Array.from({ length: 200 }, (_, day) => stormFinds(7, "strait", ["army", day]));
    const winter = Array.from({ length: 200 }, (_, day) => stormFinds(1, "sea_lane", ["army", day]));
    expect(summer.some(Boolean)).toBe(false);
    expect(winter.filter(Boolean).length).toBeGreaterThan(20);
    expect(winter.filter(Boolean).length).toBeLessThan(100);
  });

  it("costs the fleet hulls and the army men when it does", () => {
    const world = opening();
    const army = { ...forceOf(world, "carthaginian-garrison") };
    const fleet = forceOf(world, "carthaginian-fleet");
    // The first day in the shut season the roll finds this crossing.
    const day = Array.from({ length: 400 }, (_, index) => index).find((index) => stormFinds(1, "sea_lane", [army.id, "crossing", index]))!;
    const road = perilsOfTheRoad(world, army, [fleet], LILYBAEUM, "sea_lane", 1, day, "crossing");
    expect(road.words).toMatch(/storm caught the crossing/);
    expect(fit(road.fleets[0]!)).toBeLessThan(fit(fleet));
    expect(fit(road.army)).toBeLessThan(fit(army));
  });
});

describe("a winter march", () => {
  const march = (day: number) => {
    const world = opening();
    const context: ApplyContext = {
      now: { day, minute: 540 },
      actorRef: { kind: "character", id: "gaius-genucius" },
      offices: definition.government.offices,
      warfare: definition.warfare,
      terrains: definition.map.terrains,
      clock,
      ids: createIdFactory(`march-${day}`),
      gameId: "game-winter",
    };
    const result = applyDeltas({ ...world, elapsedStep: day, instant: { day, minute: 540 } }, [{ op: "force_modify", forceRef: "roman-field-army", locationId: BRUTTIUM, reason: "South." }], context);
    const project = result.world.projects.find((candidate) => candidate.completionOutcome?.kind === "force_move")!;
    return project.milestones.at(-1)!.requiredAtElapsedOffset;
  };

  it("takes longer on winter roads", () => {
    expect(march(firstOf(1))).toBeGreaterThan(march(firstOf(7)));
  });

  it("over a pass in winter leaves men in the snow", () => {
    const world = opening();
    const onlyAPass: WorldState = { ...world, map: { ...world.map, edges: [{ from: LATIUM, to: CAMPANIA, crossing: "pass", distance: 1 }, { from: CAMPANIA, to: LATIUM, crossing: "pass", distance: 1 }] } };
    const army = forceOf(onlyAPass, "roman-field-army");
    const winter = perilsOfTheRoad(onlyAPass, army, [], CAMPANIA, null, 1, 10, "alps");
    expect(winter.words).toMatch(/deep in snow/);
    expect(fit(winter.army)).toBeLessThan(fit(army));
    expect(perilsOfTheRoad(onlyAPass, army, [], CAMPANIA, null, 7, 10, "alps").words).toBe("");
  });
});

describe("a rule that keeps a season", () => {
  it("can say the month, and holds only in it", () => {
    const winter = MechanicPredicateSchema.parse({ kind: "in_months", months: [12, 1, 2] });
    const world = opening();
    expect(holdsIn(winter, world, 1)).toBe(true);
    expect(holdsIn(winter, world, 7)).toBe(false);
    // With no calendar, no season holds.
    expect(holdsIn(winter, world)).toBe(false);
  });
});
