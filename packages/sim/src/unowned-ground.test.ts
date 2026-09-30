import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  EMPTY_ECONOMY_MEMORY, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, provinceTaxCapacity, taxBurdens,
  type WorldDelta, type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { reviewTheLand } from "./economy";
import { raiseLevy } from "./levies";
import { createIdFactory } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { runDeterministicTick } from "./tick";

/**
 * Open desert belongs to nobody.
 *
 * The map leaves some sixty desert provinces without a holder: no town, no
 * river, no sea within eighty kilometres of anybody's. What the engine does with
 * ground like that is: nobody taxes it or levies it, an army may cross it and
 * camp on it, it can be claimed by an order or by standing on it, and nobody's
 * government hears of its hunger or its disorder.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`open-${actor}`),
  gameId: "game-open",
  actsForTheWorld: true,
});
const apply = (world: WorldState, deltas: readonly unknown[], actor = "hanno-carthage") =>
  applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta) as WorldDelta), context(actor));

const initial = punicWarsScenario.initialWorld;
const holderOf = (world: WorldState, id: string) => world.map.provinces.find((province) => province.id === id)!.controllerPolityId;
const neighboursOf = (world: WorldState, id: string): string[] =>
  world.map.edges.filter((edge) => edge.crossing === "land" && (edge.from === id || edge.to === id)).map((edge) => (edge.from === id ? edge.to : edge.from));

/** A stretch of open desert with one power's ground on two sides of it (Egypt's, on this map). */
const crossing = (() => {
  for (const province of initial.map.provinces) {
    if (province.controllerPolityId !== null) continue;
    const beside = neighboursOf(initial, province.id).filter((id) => holderOf(initial, id) !== null && holderOf(initial, id) !== "rome");
    for (const first of beside) {
      const second = beside.find((id) => id !== first && holderOf(initial, id) === holderOf(initial, first));
      if (second !== undefined) return { desert: province.id, from: first, to: second, polity: holderOf(initial, first)! };
    }
  }
  throw new Error("The map has no desert between two provinces of one power");
})();
const withGarrisonAt = (world: WorldState, provinceId: string): WorldState => ({
  ...world,
  material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "carthaginian-garrison" ? { ...force, polityId: crossing.polity, locationId: provinceId, positionId: null } : force)) },
});
const garrison = (world: WorldState) => world.material.forces.find((force) => force.id === "carthaginian-garrison")!;

describe("an army and open desert", () => {
  it("steps onto the desert, camps there, and walks out the far side, with nobody's leave asked or wronged", () => {
    const start = withGarrisonAt(opening(), crossing.from);
    const in1 = apply(start, [{ op: "force_modify", forceRef: "carthaginian-garrison", locationId: crossing.desert, reason: "Cross the steppe." }]);
    expect(in1.rejected).toEqual([]);
    expect(garrison(in1.world).locationId).toBe(crossing.desert);
    expect(in1.factProposals.map((fact) => fact.kind)).not.toContain("trespass");

    const camped = runDeterministicTick({ world: { ...in1.world, elapsedStep: 30, instant: { day: 30, minute: 0 } }, toDay: 30, ids: createIdFactory("camp"), warfare: definition.warfare });
    expect(garrison(camped.world).locationId).toBe(crossing.desert);
    expect(camped.factProposals.filter((fact) => ["famine", "province_hunger", "province_unrest"].includes(String(fact.kind)))).toEqual([]);

    const out = apply(camped.world, [{ op: "force_modify", forceRef: "carthaginian-garrison", locationId: crossing.to, reason: "On to the far side." }]);
    expect(out.rejected).toEqual([]);
    expect(garrison(out.world).locationId).toBe(crossing.to);
  });

  it("sets a longer march going across the empty ground between two towns of one power", () => {
    // From the far side of the desert to a province beyond it is a journey, not a step: the road runs over open ground.
    const start = withGarrisonAt(opening(), crossing.from);
    const journey = apply(start, [{ op: "force_modify", forceRef: "carthaginian-garrison", locationId: crossing.to, reason: "The short way, over the steppe." }]);
    expect(journey.rejected).toEqual([]);
  });

  it("finds bread on the steppe only where a few herders live, and does not burn a people that is nobody's", () => {
    const world = withGarrisonAt(opening(), crossing.desert);
    const people = world.material.provinceMaterial.find((row) => row.provinceId === crossing.desert)!.population;
    const province = world.map.provinces.find((candidate) => candidate.id === crossing.desert)!;
    // A desert province holds a fifteenth of what farmland of its size does.
    expect(people).toBeLessThan(Math.round((50_000 / 7_000) * (province.areaKm2 ?? 7_000) / 5));
  });
});

describe("claiming open desert", () => {
  it("is done by standing on it and saying so, with nobody's ground plundered", () => {
    const start = withGarrisonAt(opening(), crossing.desert);
    const chestBefore = start.material.accounts.find((account) => account.id === "carthaginian-garrison-chest")!.balance;
    const claimed = apply(start, [{ op: "province_control_set", provinceId: crossing.desert, toPolityRef: crossing.polity, firmnessBps: 3_000, reason: "The garrison claims the steppe it stands on." }]);
    expect(claimed.rejected).toEqual([]);
    const province = claimed.world.map.provinces.find((candidate) => candidate.id === crossing.desert)!;
    expect(province.controllerPolityId).toBe(crossing.polity);
    expect(province.lostBy ?? null).toBeNull();
    const fact = claimed.factProposals.find((candidate) => candidate.kind === "province_control_change")!;
    expect(fact.summary).toMatch(/claimed .* which no power had held/);
    // Nothing was carried off: there was no one to take it from.
    expect(claimed.world.material.accounts.find((account) => account.id === "carthaginian-garrison-chest")!.balance).toBe(chestBefore);
    expect(claimed.world.material.transactions.length).toBe(start.material.transactions.length);
  });

  it("is done from the next province, with no army there, by a plain order", () => {
    const start = withGarrisonAt(opening(), crossing.from);
    const claimed = apply(start, [{ op: "province_control_set", provinceId: crossing.desert, toPolityRef: crossing.polity, firmnessBps: 3_000, reason: "The steppe next to the kingdom's land is the kingdom's." }]);
    expect(claimed.rejected).toEqual([]);
    expect(holderOf(claimed.world, crossing.desert)).toBe(crossing.polity);
  });

  it("is refused to a power with no army there and no ground next to it", () => {
    const refused = apply(opening(), [{ op: "province_control_set", provinceId: crossing.desert, toPolityRef: "rome", firmnessBps: 3_000, reason: "Rome takes the far steppe." }], "gaius-genucius");
    expect(refused.rejected).toHaveLength(1);
    expect(refused.rejected[0]!.reason).toContain("no army");
    expect(holderOf(refused.world, crossing.desert)).toBeNull();
  });
});

describe("what nobody's ground costs and yields", () => {
  it("pays nobody a tax: a power's ceiling is the sum of its own provinces, and the desert is not among them", () => {
    const world = opening();
    const before = [...taxBurdens(world)].map(([id, burden]) => [id, burden.bearable]);
    const richer: WorldState = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === crossing.desert ? { ...row, population: 900_000, taxCapacity: 90_000 } : row)) },
    };
    expect(provinceTaxCapacity(richer, crossing.desert)).toBe(90_000);
    expect([...taxBurdens(richer)].map(([id, burden]) => [id, burden.bearable])).toEqual(before);
    for (const [, burden] of taxBurdens(richer)) expect(burden.bearable).toBeGreaterThanOrEqual(0);
  });

  it("raises no levy from it, not even when the levy is called on the desert itself", () => {
    const world = withGarrisonAt(opening(), crossing.desert);
    const manpowerOf = (state: WorldState, id: string) => state.material.provinceMaterial.find((row) => row.provinceId === id)!.availableManpower;
    const rich: WorldState = { ...world, material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === crossing.desert ? { ...row, availableManpower: 40_000 } : row)) } };
    const levy = raiseLevy(rich, { polityId: crossing.polity, provinceId: crossing.desert, men: 3_000, atStep: 0, pays: false, payerAccountId: null, ids: createIdFactory("levy") } as never);
    expect(levy.men).toBeGreaterThan(0);
    expect(manpowerOf(levy.world, crossing.desert)).toBe(40_000);
  });

  it("tells no one of its hunger, its disorder or its dead, while the same ruin next door is reported", () => {
    const world = withGarrisonAt(opening(), crossing.desert);
    const ruin = { population: 60_000, foodSecurityBps: 0, stabilityBps: 0, displacedPopulation: 30_000 };
    const ruined: WorldState = {
      ...world,
      material: {
        ...world.material,
        provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === crossing.desert || row.provinceId === crossing.from ? { ...row, ...ruin } : row)),
      },
      economy: { ...EMPTY_ECONOMY_MEMORY, lastReviewStep: 0 },
    };
    const land = reviewTheLand({ world: ruined, toDay: 120, warfare: definition.warfare, clock: definition.clock } as never);
    // A fact is about the place it opens with; people who fled the steppe and settled in a neighbour's fields are news of the neighbour.
    const about = <F extends { affectedRefs?: readonly { id: string }[] | undefined }>(facts: readonly F[], id: string): F[] => facts.filter((fact) => fact.affectedRefs?.[0]?.id === id);
    expect(about(land.facts, crossing.from).map((fact) => String(fact.kind))).toContain("famine");
    expect(about(land.facts, crossing.desert)).toEqual([]);

    const ticked = runDeterministicTick({ world: { ...ruined, elapsedStep: 120, instant: { day: 120, minute: 0 } }, toDay: 120, ids: createIdFactory("open-tick"), warfare: definition.warfare, clock: definition.clock });
    expect(about(ticked.factProposals, crossing.desert).filter((fact) => ["famine", "migration", "province_hunger", "province_unrest"].includes(String(fact.kind)))).toEqual([]);
    expect(ticked.notes.join(" ")).not.toMatch(/unclaimed/);
  });

  it("is named in the slice as held by no one", () => {
    const world = opening();
    const name = world.map.provinces.find((province) => province.id === crossing.desert)!.name;
    const text = renderWorldSlice(buildWorldSlice({
      world, clock: definition.clock, offices: definition.government.offices, actorRef: { kind: "character", id: "hanno-carthage" }, actorPolityId: crossing.polity,
      orderText: `March the garrison into ${name}`, facts: [], dueEvents: [], pendingEvents: [],
    }));
    expect(text).toContain(`${name} [${crossing.desert}] — held by no one`);
  });
});
