import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, kmFrom, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext, ApplyResult } from "./apply/context";
import { whereOnTheRoad } from "./apply/marches";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The days an army has walked survive a change of orders.
 *
 * A march of one stretch turned on its fifteenth day of twenty stood where it had set out, the fifteen days thrown away; a march of
 * several stretches turned near its end was set a whole stretch back. The force is now put at the province nearest the road it has
 * covered, the road's end included once it is past the middle of the last stretch, so the error is at most half a stretch either way.
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

describe("the days walked survive a change of orders", () => {
  it("puts an army turned on day 15 of a 20-day stretch at the far end of it, and one turned on day 5 at the near end", () => {
    const world = opening();
    const neighbour = world.map.edges.find((edge) => (edge.from === LATIUM || edge.to === LATIUM) && edge.crossing === "land")!;
    const to = neighbour.from === LATIUM ? neighbour.to : neighbour.from;
    const march = oneStretch(world, LATIUM, to, 20, 0);
    expect(whereOnTheRoad({ ...world, elapsedStep: 15 }, march, LATIUM, false)).toBe(to);
    expect(whereOnTheRoad({ ...world, elapsedStep: 5 }, march, LATIUM, false)).toBe(LATIUM);
    // Exactly at the middle it stays where it was: it has not arrived until the march says so.
    expect(whereOnTheRoad({ ...world, elapsedStep: 10 }, march, LATIUM, false)).toBe(LATIUM);
  });

  it("puts an army turned on the road to Rhegium at the province nearest the ground it has covered, and marches on from there", () => {
    const start = apply(opening(), [sendTo(RHEGIUM)], "set-out");
    const march = journeys(start.world)[0]!;
    const length = kmFrom(start.world, LATIUM, BY_LAND).get(RHEGIUM)!;
    const days = daysOf(march);
    expect(days).toBeGreaterThan(10);
    const walkedDays = Math.floor(days * 0.45);
    const onTheRoad = daysOn(start.world, walkedDays);
    expect(armyOf(onTheRoad).locationId).toBe(LATIUM);

    const turned = apply(onTheRoad, [sendTo(TARENTUM)], "turned");
    const here = armyOf(turned.world).locationId;
    expect(here).not.toBe(LATIUM);
    expect(here).not.toBe(RHEGIUM);
    // Where it stands is on the road: as far from Latium along it as the days say, within half the longest stretch about it.
    const fromLatium = kmFrom(turned.world, LATIUM, BY_LAND).get(here)!;
    const walked = (walkedDays / days) * length;
    const longest = Math.max(...turned.world.map.edges.filter((edge) => (edge.from === here || edge.to === here) && edge.crossing === "land").map((edge) => edge.distance));
    expect(Math.abs(fromLatium - walked)).toBeLessThanOrEqual(longest / 2 + 1);
    // Told so: it turned on the road, short of Rhegium, and makes for Tarentum.
    const calledOff = turned.factProposals.find((fact) => fact.kind === "march_called_off");
    const tarentum = turned.world.map.provinces.find((province) => province.id === TARENTUM)!.name;
    expect(calledOff?.summary).toMatch(new RegExp(`turned on the road near .*, short of Rhegium coast and makes for ${tarentum} instead`));
    expect(turned.factProposals.find((fact) => fact.kind === "march_begun")?.summary).toMatch(new RegExp(`turned on the road near .* and makes for ${tarentum}`));
    // The new march is from where it stands, not from Latium.
    const next = journeys(turned.world).find((project) => project.completionOutcome?.provinceId === TARENTUM)!;
    const fromHere = kmFrom(turned.world, here, BY_LAND).get(TARENTUM)!;
    const fromHome = kmFrom(turned.world, LATIUM, BY_LAND).get(TARENTUM)!;
    expect(fromHere).not.toBe(fromHome);
    expect(daysOf(next)).toBeGreaterThan(0);
  });

  it("replans a march of several stretches without losing more than half a stretch, however late it is turned", () => {
    const start = apply(opening(), [sendTo(RHEGIUM)], "late");
    const march = journeys(start.world)[0]!;
    const days = daysOf(march);
    const length = kmFrom(start.world, LATIUM, BY_LAND).get(RHEGIUM)!;
    for (const share of [0.3, 0.6, 0.9]) {
      const walkedDays = Math.floor(days * share);
      const turned = apply(daysOn(start.world, walkedDays), [sendTo(TARENTUM)], `late-${share}`);
      const here = armyOf(turned.world).locationId;
      const fromLatium = kmFrom(turned.world, LATIUM, BY_LAND).get(here) ?? 0;
      const longest = Math.max(...turned.world.map.edges.filter((edge) => (edge.from === here || edge.to === here) && edge.crossing === "land").map((edge) => edge.distance));
      expect(Math.abs(fromLatium - (walkedDays / days) * length)).toBeLessThanOrEqual(longest / 2 + 1);
    }
  });
});
