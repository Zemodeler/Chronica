import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, kmFrom, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext, ApplyResult } from "./apply/context";
import { progressOnTheRoad, whereOnTheRoad } from "./apply/marches";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The days an army has walked survive a change of orders, and none are made up.
 *
 * A march of one stretch turned on its fifteenth day of twenty stood where it had set out, the fifteen days thrown away; the first
 * repair set it at the nearest province instead, which past the middle of a stretch was the far end -- a march finished by being
 * called off. The army now stands at the last province it reached, and the part of the stretch it was on goes into the journey it
 * makes next: counted where it goes on that way, walked back where it does not.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const { rhegium: RHEGIUM, rome: LATIUM, tarentum: TARENTUM } = PUNIC_IDS;
const CONSUL = "gaius-genucius";
const ARMY = "roman-field-army";
const BY_LAND = { passable: (edge: { readonly crossing: string }) => edge.crossing !== "sea_lane" && edge.crossing !== "strait" };

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

function apply(world: WorldState, deltas: readonly Record<string, unknown>[], tag: string, more: Partial<ApplyContext> = {}): ApplyResult {
  return applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), {
    now: world.instant, actorRef: { kind: "character", id: CONSUL }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(tag), gameId: "game-march-progress", playerCharacterId: CONSUL, ...more,
  });
}

const sendTo = (provinceId: string): Record<string, unknown> => ({ op: "force_modify", forceRef: ARMY, locationId: provinceId, reason: "March." });

function daysOn(state: WorldState, days: number): WorldState {
  let world = state;
  for (let step = 0; step < days; step += 1) {
    const day = world.elapsedStep + 1;
    world = runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { day, minute: 0 } }, toDay: day, ids: createIdFactory(`progress-${day}`), warfare: definition.warfare }).world;
  }
  return world;
}

const journeys = (world: WorldState) => world.projects.filter((project) => project.status === "in_progress"
  && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === ARMY);
const armyOf = (world: WorldState) => world.material.forces.find((force) => force.id === ARMY)!;
const daysOf = (project: WorldState["projects"][number]): number => Math.max(...project.milestones.map((milestone) => milestone.requiredAtElapsedOffset));

/** A march of one stretch, `days` long, from `from` to `to`, as the world would hold it. */
function oneStretch(world: WorldState, from: string, to: string, days: number, startedAtStep: number): WorldState["projects"][number] {
  return {
    id: "march-one-stretch", kind: "march", label: "A march of one stretch", status: "in_progress", sponsorEntityRef: { kind: "character", id: CONSUL },
    fundingAccountId: null, startedAtStep, targetCompletionStep: startedAtStep + days,
    milestones: [{ id: "arrives", label: "Arrives", requiredAtElapsedOffset: days, costAmount: 0, status: "pending" }],
    completionOutcome: { kind: "force_move", label: "Arrives", amount: 0, provinceId: to, polityId: null, commanderCharacterId: null, forceId: ARMY, beneficiaryAccountId: null, cadenceDays: null, agreementKind: null, withPolityId: null },
    description: null, visibility: "public",
  } as unknown as WorldState["projects"][number];
}

/** Within `slack` days. */
const near = (actual: number, expected: number, slack = 2): void => { expect(Math.abs(actual - expected)).toBeLessThanOrEqual(slack); };

describe("the days walked survive a change of orders", () => {
  it("keeps an army turned on day 15 of a 20-day stretch at the province it set out from, three quarters along the stretch, never at the far end", () => {
    const world = opening();
    const neighbour = world.map.edges.find((edge) => (edge.from === LATIUM || edge.to === LATIUM) && edge.crossing === "land")!;
    const to = neighbour.from === LATIUM ? neighbour.to : neighbour.from;
    const march = oneStretch(world, LATIUM, to, 20, 0);
    const late = progressOnTheRoad({ ...world, elapsedStep: 15 }, march, LATIUM, false);
    expect(late.at).toBe(LATIUM);
    expect(late.toward).toBe(to);
    expect(late.kmAlong).toBeCloseTo(neighbour.distance * 0.75, 6);
    expect(whereOnTheRoad({ ...world, elapsedStep: 15 }, march, LATIUM, false)).toBe(LATIUM);
    expect(progressOnTheRoad({ ...world, elapsedStep: 5 }, march, LATIUM, false).kmAlong).toBeCloseTo(neighbour.distance * 0.25, 6);
    // On its last day, and only then, it is there.
    expect(whereOnTheRoad({ ...world, elapsedStep: 19 }, march, LATIUM, false)).toBe(LATIUM);
    expect(whereOnTheRoad({ ...world, elapsedStep: 20 }, march, LATIUM, false)).toBe(to);
  });

  it("reads a journey begun part way along a stretch: on along it with the walked part counted, back along it with that much to walk first", () => {
    const world = opening();
    const neighbour = world.map.edges.find((edge) => (edge.from === LATIUM || edge.to === LATIUM) && edge.crossing === "land")!;
    const to = neighbour.from === LATIUM ? neighbour.to : neighbour.from;
    // Three quarters along Latium-to, and turned back to Latium: three quarters of the stretch to walk, not none and not all.
    const homeward = oneStretch(world, LATIUM, LATIUM, 10, 0);
    const back = { ...homeward, completionOutcome: { ...homeward.completionOutcome!, provinceId: LATIUM }, offRoad: { towardProvinceId: to, km: neighbour.distance * 0.75 } } as WorldState["projects"][number];
    expect(progressOnTheRoad({ ...world, elapsedStep: 0 }, back, LATIUM, false)).toMatchObject({ at: LATIUM, toward: to });
    expect(progressOnTheRoad({ ...world, elapsedStep: 5 }, back, LATIUM, false).kmAlong).toBeCloseTo(neighbour.distance * 0.375, 6);
    // And on to the far end: what is left of the stretch, from three quarters along.
    const on = { ...oneStretch(world, LATIUM, to, 5, 0), offRoad: { towardProvinceId: to, km: neighbour.distance * 0.75 } } as WorldState["projects"][number];
    expect(progressOnTheRoad({ ...world, elapsedStep: 0 }, on, LATIUM, false).kmAlong).toBeCloseTo(neighbour.distance * 0.75, 6);
    expect(progressOnTheRoad({ ...world, elapsedStep: 4 }, on, LATIUM, false)).toMatchObject({ at: LATIUM, toward: to });
    expect(whereOnTheRoad({ ...world, elapsedStep: 5 }, on, LATIUM, false)).toBe(to);
  });

  it("turns an army on the road to Rhegium at the last province it reached, and counts the stretch it was on into its next journey", () => {
    const start = apply(opening(), [sendTo(RHEGIUM)], "set-out");
    const march = journeys(start.world)[0]!;
    const length = kmFrom(start.world, LATIUM, BY_LAND).get(RHEGIUM)!;
    const days = daysOf(march);
    expect(days).toBeGreaterThan(10);
    const walkedDays = Math.floor(days * 0.45);
    const onTheRoad = daysOn(start.world, walkedDays);
    expect(armyOf(onTheRoad).locationId).toBe(LATIUM);
    const walked = (walkedDays / days) * length;
    const progress = progressOnTheRoad(onTheRoad, journeys(onTheRoad)[0]!, LATIUM, false);

    const turned = apply(onTheRoad, [sendTo(TARENTUM)], "turned");
    const here = armyOf(turned.world).locationId;
    expect(here).toBe(progress.at);
    expect(here).not.toBe(RHEGIUM);
    // Never ahead of the ground it has covered; behind it by exactly the part of the stretch it was on.
    const fromLatium = kmFrom(turned.world, LATIUM, BY_LAND).get(here)!;
    expect(fromLatium).toBeLessThanOrEqual(walked + 1e-6);
    expect(walked - fromLatium).toBeCloseTo(progress.kmAlong, 6);
    const tarentum = turned.world.map.provinces.find((province) => province.id === TARENTUM)!.name;
    expect(turned.factProposals.find((fact) => fact.kind === "march_called_off")?.summary).toMatch(new RegExp(`short of Rhegium coast and makes for ${tarentum} instead`));
    // The new journey is reckoned from where it really is, and where it is on it the day it sets out is where it was.
    const next = journeys(turned.world).find((project) => project.completionOutcome?.provinceId === TARENTUM)!;
    expect(next).toBeDefined();
    if (progress.kmAlong > 0) {
      expect(next.offRoad).toEqual({ towardProvinceId: progress.toward, km: progress.kmAlong });
      const now = progressOnTheRoad(turned.world, next, here, false);
      expect(now.at).toBe(here);
      expect(now.kmAlong).toBeCloseTo(progress.kmAlong, 6);
    }
  });

  it("brings an army turned back home in about the days it had walked, and not the moment it was turned", () => {
    const start = apply(opening(), [sendTo(RHEGIUM)], "home");
    const days = daysOf(journeys(start.world)[0]!);
    const walkedDays = Math.floor(days * 0.3);
    const turned = apply(daysOn(start.world, walkedDays), [sendTo(LATIUM)], "home-turned");
    const back = journeys(turned.world).find((project) => project.completionOutcome?.provinceId === LATIUM);
    expect(back).toBeDefined();
    near(daysOf(back!), walkedDays, Math.max(2, Math.ceil(walkedDays * 0.3)));
  });

  it("does not turn a march it is already making: told again for Rhegium, it goes on as it was", () => {
    const start = apply(opening(), [sendTo(RHEGIUM)], "same");
    const march = journeys(start.world)[0]!;
    const onTheRoad = daysOn(start.world, Math.floor(daysOf(march) * 0.6));
    const again = apply(onTheRoad, [sendTo(RHEGIUM)], "same-again");
    expect(journeys(again.world).map((project) => project.id)).toEqual([march.id]);
    expect(armyOf(again.world).locationId).toBe(LATIUM);
  });

  it("replans a march of several stretches without losing or gaining ground, however late it is turned", () => {
    const start = apply(opening(), [sendTo(RHEGIUM)], "late");
    const march = journeys(start.world)[0]!;
    const days = daysOf(march);
    const length = kmFrom(start.world, LATIUM, BY_LAND).get(RHEGIUM)!;
    for (const share of [0.3, 0.6, 0.9]) {
      const walkedDays = Math.floor(days * share);
      const before = daysOn(start.world, walkedDays);
      const progress = progressOnTheRoad(before, journeys(before)[0]!, LATIUM, false);
      const turned = apply(before, [sendTo(TARENTUM)], `late-${share}`);
      const here = armyOf(turned.world).locationId;
      expect(here).not.toBe(RHEGIUM);
      const fromLatium = kmFrom(turned.world, LATIUM, BY_LAND).get(here) ?? 0;
      expect(fromLatium + progress.kmAlong).toBeCloseTo((walkedDays / days) * length, 4);
    }
  });
});
