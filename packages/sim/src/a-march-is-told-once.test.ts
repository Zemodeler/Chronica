import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  daysInSeason,
  ensureProvinceMaterial,
  isWinterMonth,
  kmBetween,
  mustCrossAPass,
  type CrossingType,
  type MapWorld,
  type ProvinceEdge,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext, ApplyResult } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * E26: the consul's march to Rhegium was told "set out from Latium ... 87
 * days" again and again, after a battle as before it. A re-order toward the
 * same crossing began the march again from Latium; the crossing arranged from
 * Rhegium called off the army's own walk to Rhegium; a march that was turned
 * began again from home; the opening month, March, was winter; and the strait
 * at the end of a road was timed as a mountain pass.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const { messana: MESSANA, rhegium: RHEGIUM, rome: LATIUM, tarentum: TARENTUM } = PUNIC_IDS;
const CONSUL = "gaius-genucius";
const ARMY = "roman-field-army";

function opening(): WorldState {
  return ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
}

/** The allied hulls at Rhegium, enough to carry the legion. */
function hullsAtRhegium(world: WorldState): WorldState {
  return {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => force.id !== "allied-greek-hulls" ? force : {
        ...force, locationId: RHEGIUM, authorizedStrength: 300,
        personnel: [{ categoryId: "warship", label: "Allied transports", fit: 300, unavailable: [] }],
      }),
    },
  };
}

function apply(world: WorldState, actor: string, deltas: readonly Record<string, unknown>[], tag: string, more: Partial<ApplyContext> = {}): ApplyResult {
  return applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), {
    now: world.instant, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(tag), gameId: "game-march-once", playerCharacterId: CONSUL, ...more,
  });
}

const sendTo = (provinceId: string): Record<string, unknown> => ({ op: "force_modify", forceRef: ARMY, locationId: provinceId, reason: "March." });

function daysOn(state: WorldState, days: number): WorldState {
  let world = state;
  for (let step = 0; step < days; step += 1) {
    const day = world.elapsedStep + 1;
    world = runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { day, minute: 0 } }, toDay: day, ids: createIdFactory(`once-${day}`), warfare: definition.warfare }).world;
  }
  return world;
}

const journeys = (world: WorldState) => world.projects.filter((project) => project.status === "in_progress"
  && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === ARMY);
const told = (result: ApplyResult, kind: string) => result.factProposals.filter((fact) => fact.kind === kind);
const armyOf = (world: WorldState) => world.material.forces.find((force) => force.id === ARMY)!;
const dueOf = (project: WorldState["projects"][number]): number => project.startedAtStep + Math.max(...project.milestones.map((milestone) => milestone.requiredAtElapsedOffset));

describe("the consul's march to Rhegium", () => {
  it("is told once, and not again when he is sent on toward the same crossing", () => {
    const first = apply(hullsAtRhegium(opening()), CONSUL, [sendTo(RHEGIUM)], "first");
    expect(first.rejected).toEqual([]);
    expect(told(first, "march_begun")).toHaveLength(1);
    expect(told(first, "march_begun")[0]!.summary).toMatch(/set out from/);
    const march = journeys(first.world)[0]!;

    // A week on, "make for Messana": the march to Rhegium is the way there.
    const onward = apply(daysOn(first.world, 7), CONSUL, [sendTo(MESSANA)], "onward");
    expect(onward.rejected).toEqual([]);
    expect(told(onward, "march_begun")).toHaveLength(0);
    expect(told(onward, "march_called_off")).toHaveLength(0);
    const crossing = journeys(onward.world).find((project) => project.kind === "crossing");
    expect(crossing?.completionOutcome?.provinceId).toBe(MESSANA);
    expect(crossing?.completionOutcome?.embarkProvinceId).toBe(RHEGIUM);
    expect(journeys(onward.world).filter((project) => project.kind !== "crossing").map((project) => project.id)).toEqual([march.id]);
    // The crossing waits on the march already walking, not a new one from Latium.
    expect(dueOf(crossing!)).toBeGreaterThanOrEqual(dueOf(march));
    expect(armyOf(onward.world).locationId).toBe(LATIUM);

    // "Rhegium", with the crossing from Rhegium arranged: that is the order carried out.
    const back = apply(daysOn(onward.world, 3), CONSUL, [sendTo(RHEGIUM)], "back");
    expect(back.rejected).toEqual([]);
    expect(told(back, "march_begun")).toHaveLength(0);
    expect(told(back, "march_called_off")).toHaveLength(0);
    expect(journeys(back.world).map((project) => project.id).sort()).toEqual(journeys(onward.world).map((project) => project.id).sort());

    // And "Messana" again is the crossing under way, not a second one.
    const again = apply(back.world, CONSUL, [sendTo(MESSANA)], "again");
    expect(again.rejected).toEqual([]);
    expect(told(again, "crossing_arranged")).toHaveLength(0);
    expect(told(again, "march_begun")).toHaveLength(0);
    expect(journeys(again.world)).toHaveLength(journeys(back.world).length);
  });

  it("is not told again after a battle on the road", () => {
    const opened = opening();
    // Hieron's army in Latium, at war with Rome.
    const facing = apply({
      ...opened,
      material: { ...opened.material, forces: opened.material.forces.map((force) => (force.id === "syracusan-army" ? { ...force, locationId: LATIUM } : force)) },
    }, CONSUL, [{ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "syracuse", terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Messana." }], "war").world;
    const set = apply(facing, CONSUL, [sendTo(RHEGIUM)], "set");
    expect(told(set, "march_begun")).toHaveLength(1);
    const fought = apply(set.world, CONSUL, [{ op: "force_engage", forceRef: ARMY, targetForceRef: "syracusan-army", posture: "offer_battle", tactic: null, reason: "Battle." }], "fight");
    expect(fought.rejected).toEqual([]);
    expect(fought.world.engagements.some((engagement) => engagement.attackerForceIds.includes(ARMY))).toBe(true);
    const after = daysOn(fought.world, 3);
    const reordered = apply(after, CONSUL, [sendTo(RHEGIUM)], "after");
    expect(reordered.rejected).toEqual([]);
    expect(told(reordered, "march_begun")).toHaveLength(0);
  });
});

describe("a march turned on the road", () => {
  it("goes on from where it got to, and says so", () => {
    const first = apply(opening(), CONSUL, [sendTo(RHEGIUM)], "first");
    const march = journeys(first.world)[0]!;
    const halfway = daysOn(first.world, Math.floor((dueOf(march) - march.startedAtStep) / 2));
    const turned = apply(halfway, CONSUL, [sendTo(TARENTUM)], "turned");
    expect(turned.rejected).toEqual([]);
    const near = armyOf(turned.world).locationId;
    expect(near).not.toBe(LATIUM);
    expect(near).not.toBe(RHEGIUM);
    expect(told(turned, "march_called_off")[0]!.summary).toMatch(/turned on the road near .*, short of/);
    const begun = told(turned, "march_begun");
    expect(begun).toHaveLength(1);
    expect(begun[0]!.summary).toMatch(/turned on the road near/);
    expect(begun[0]!.summary).not.toMatch(/set out from/);
    // Nearer Tarentum than Latium is: the road already walked counts.
    expect(kmBetween(turned.world, near, TARENTUM)!).toBeLessThan(kmBetween(turned.world, LATIUM, TARENTUM)!);
    const fresh = journeys(apply(opening(), CONSUL, [sendTo(TARENTUM)], "fresh").world)[0]!;
    const onward = journeys(turned.world)[0]!;
    expect(onward.completionOutcome?.provinceId).toBe(TARENTUM);
    expect(dueOf(onward) - onward.startedAtStep).toBeLessThan(dueOf(fresh) - fresh.startedAtStep);
  });
});

describe("a course the world set", () => {
  it("is held for a fortnight against the world's own re-orders, as against a commander's", () => {
    // The player is somebody else; the world moves the consul's army.
    const asTheWorld = { playerCharacterId: "manius-curius", actsForTheWorld: true, orderDeltas: new Set<WorldDelta>() };
    const first = apply(opening(), CONSUL, [sendTo(RHEGIUM)], "world-first", asTheWorld);
    expect(first.rejected).toEqual([]);
    const turned = apply(daysOn(first.world, 5), CONSUL, [sendTo(TARENTUM)], "world-turned", asTheWorld);
    expect(turned.rejected).toHaveLength(1);
    expect(turned.rejected[0]!.reason).toMatch(/holds that course/);
    // Sent on toward the same place, it is not refused.
    const same = apply(daysOn(first.world, 5), CONSUL, [sendTo(RHEGIUM)], "world-same", asTheWorld);
    expect(same.rejected).toEqual([]);
    // The player's own order turns his own army whenever he likes.
    const his = apply(daysOn(first.world, 5), CONSUL, [sendTo(TARENTUM)], "his");
    expect(his.rejected).toEqual([]);
  });
});

describe("the season", () => {
  it("does not count March as winter", () => {
    expect(isWinterMonth(3)).toBe(false);
    expect(isWinterMonth(2)).toBe(true);
    expect(isWinterMonth(11)).toBe(true);
    expect(isWinterMonth(4)).toBe(false);
    expect(daysInSeason(40, 3, true)).toBe(40);
    expect(daysInSeason(40, 1, false)).toBe(60);
  });

  it("times the consul's march on 1 March as on any open road", () => {
    const withClock = apply(opening(), CONSUL, [sendTo(RHEGIUM)], "march-clock", { clock: definition.clock });
    const without = apply(opening(), CONSUL, [sendTo(RHEGIUM)], "march-plain");
    expect(dueOf(journeys(withClock.world)[0]!)).toBe(dueOf(journeys(without.world)[0]!));
  });
});

describe("a mountain pass", () => {
  /** p0 - p1 by `first`, p1 - p2 by `second`, and, when given, a way round p0 - p3 - p2. */
  function road(first: CrossingType, second: CrossingType, roundKm: number | null = null): MapWorld {
    const edges: ProvinceEdge[] = [
      { from: "p0", to: "p1", crossing: first, distance: 100 },
      { from: "p1", to: "p2", crossing: second, distance: 100 },
      ...(roundKm === null ? [] : [{ from: "p0", to: "p3", crossing: "land" as const, distance: roundKm / 2 }, { from: "p3", to: "p2", crossing: "land" as const, distance: roundKm / 2 }]),
    ];
    return { map: { provinces: ["p0", "p1", "p2", "p3"].map((id) => ({ id })), edges } } as unknown as MapWorld;
  }

  it("is a pass on the map, and a sea leg is not one", () => {
    expect(mustCrossAPass(road("land", "pass"), "p0", "p2")).toBe(true);
    expect(mustCrossAPass(road("land", "land"), "p0", "p2")).toBe(false);
    expect(mustCrossAPass(road("land", "strait"), "p0", "p2")).toBe(false);
    expect(mustCrossAPass(road("land", "sea_lane"), "p0", "p2")).toBe(false);
    // A way round, not twice as long, is taken instead.
    expect(mustCrossAPass(road("land", "pass", 300), "p0", "p2")).toBe(false);
    expect(mustCrossAPass(road("land", "pass", 500), "p0", "p2")).toBe(true);
  });

  it("is not on the road from Latium to Messana", () => {
    expect(mustCrossAPass(opening(), LATIUM, MESSANA)).toBe(false);
  });
});
