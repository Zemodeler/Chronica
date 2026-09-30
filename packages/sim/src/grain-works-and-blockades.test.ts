import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type Force, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { grainPrice } from "./grain";

/**
 * Bread beyond foraging -- bought, taken, or sent up by road -- siege works
 * that press a city harder, and blockades kept as blockades
 * (docs/plans/battles-that-last.md).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = PUNIC_IDS.rome;
const MESSANA = PUNIC_IDS.messana;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const as = (written: readonly unknown[], state: WorldState, actor = "gaius-genucius") => {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`grain-${state.elapsedStep}`), gameId: "game-grain", orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
};
const tick = (state: WorldState, day: number) => runDeterministicTick({ world: { ...state, elapsedStep: day, instant: { ...state.instant, day } }, toDay: day, ids: createIdFactory(`grain-tick-${day}`), warfare: definition.warfare, clock: definition.clock });
const army = (world: WorldState, id = "roman-field-army"): Force => world.material.forces.find((force) => force.id === id)!;
const balance = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === id)!.balance;
const lean = (world: WorldState): WorldState => ({ ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, provisionedThroughStep: 2, provisionStatus: "provisioned" as const } : force)) } });

describe("bread bought", () => {
  it("feeds the army for the days bought, at a price, paid by whoever pays the army", () => {
    const start = lean(opening());
    const bought = as([{ op: "force_provision", forceRef: "roman-field-army", how: "buy", days: 20, reason: "Buy grain." }], start);
    expect(bought.rejected).toEqual([]);
    expect(army(bought.world).provisionedThroughStep).toBe(2 + 20);
    expect(balance(bought.world, "rome-treasury")).toBeLessThan(balance(start, "rome-treasury"));
    expect(bought.world.material.transactions.some((transaction) => transaction.kind === "purchase" && /Bread/.test(transaction.cause.explanation))).toBe(true);
  });

  it("costs more where the country is hungry", () => {
    const fed = opening();
    const hungry: WorldState = { ...fed, material: { ...fed.material, provinceMaterial: fed.material.provinceMaterial.map((row) => (row.provinceId === LATIUM ? { ...row, foodSecurityBps: 3_000 } : row)) } };
    expect(grainPrice(hungry, "rome", LATIUM)).toBeGreaterThan(grainPrice(fed, "rome", LATIUM));
  });
});

describe("bread requisitioned", () => {
  it("costs nothing in money and the country's temper on its own ground", () => {
    const start = lean(opening());
    const taken = as([{ op: "force_provision", forceRef: "roman-field-army", how: "requisition", days: 15, reason: "Take it." }], start);
    expect(taken.rejected).toEqual([]);
    const stability = (world: WorldState) => world.material.provinceMaterial.find((row) => row.provinceId === LATIUM)!.stabilityBps;
    expect(stability(taken.world)).toBeLessThan(stability(start));
    expect(balance(taken.world, "rome-treasury")).toBe(balance(start, "rome-treasury"));
    expect(army(taken.world).provisionedThroughStep).toBeGreaterThan(2);
  });
});

describe("a convoy", () => {
  const sicily = (): WorldState => {
    const world = lean(opening());
    return { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: PUNIC_IDS.capua } : force)) } };
  };

  it("is sent from home, and arrives when the road says", () => {
    const sent = as([{ op: "force_provision", forceRef: "roman-field-army", how: "convoy", days: 30, fromProvinceId: LATIUM, reason: "Send bread." }], sicily());
    expect(sent.rejected).toEqual([]);
    const convoy = sent.world.convoys[0]!;
    expect(convoy.status).toBe("on_the_road");
    const arrived = tick(sent.world, convoy.arrivesAtStep).world;
    expect(arrived.convoys[0]!.status).toBe("delivered");
    expect(army(arrived).provisionedThroughStep).toBeGreaterThanOrEqual(convoy.arrivesAtStep + 29);
  });

  it("will not be sent from ground that is not the army's own", () => {
    const refused = as([{ op: "force_provision", forceRef: "roman-field-army", how: "convoy", days: 30, fromProvinceId: PUNIC_IDS.carthage, reason: "Send bread." }], sicily());
    expect(refused.rejected[0]?.reason).toMatch(/own ground/);
  });
});

describe("siege works", () => {
  const WAR = { op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "mamertines", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." };
  const besieged = (works?: readonly string[]): WorldState => {
    const world = opening();
    const there: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: MESSANA } : force)) } };
    return as([WAR, { op: "siege_lay", localId: "messana", forceRef: "roman-field-army", settlementId: "settlement-messana", ...(works === undefined ? {} : { works }), reason: "Invest it." }], there).world;
  };

  it("are paid for and built, and once built press the city harder", () => {
    const plain = besieged();
    const works = besieged(["rams", "towers"]);
    expect(works.sieges[0]!.works.map((work) => work.kind)).toEqual(["rams", "towers"]);
    expect(balance(works, "rome-treasury")).toBeLessThan(balance(plain, "rome-treasury"));
    // After the towers are finished, the siege with works is further on.
    const later = (world: WorldState) => tick(tick(world, 21).world, 40).world.sieges[0]!;
    expect(later(works).pressureBps).toBeGreaterThan(later(plain).pressureBps);
    expect(later(works).works.every((work) => work.status === "ready" || work.status === "burned")).toBe(true);
  });

  it("a mine brings a stretch of wall down the day it is fired", () => {
    const mined = besieged(["mine"]);
    const before = tick(mined, 29).world.sieges[0]!.pressureBps;
    const fired = tick(tick(mined, 29).world, 31);
    expect(fired.world.sieges[0]!.pressureBps - before).toBeGreaterThanOrEqual(2_500);
    expect(fired.factProposals.some((fact) => /mine/.test(fact.summary))).toBe(true);
  });

  it("can be added to a siege already laid", () => {
    const laid = besieged();
    const added = as([{ op: "siege_lay", localId: "again", forceRef: "roman-field-army", settlementId: "settlement-messana", works: ["lines"], reason: "Shut it in." }], laid);
    expect(added.rejected).toEqual([]);
    expect(added.world.sieges[0]!.works.map((work) => work.kind)).toEqual(["lines"]);
  });
});

describe("a blockade", () => {
  it("begins when an enemy fleet closes on a port, has a tightness, and ends when it goes", () => {
    const world = opening();
    const port = world.map.provinces.find((province) => province.controllerPolityId === "carthage" && province.settlements.some((settlement) => settlement.kind === "port"))!;
    const at = as([{ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." }], world).world;
    const off: WorldState = { ...at, material: { ...at.material, forces: at.material.forces.map((force) => (force.id === "allied-greek-hulls" ? { ...force, locationId: port.id } : force)) } };
    const begun = tick(off, 1);
    const blockade = begun.world.blockades.find((candidate) => candidate.status === "active" && candidate.provinceId === port.id)!;
    expect(blockade.blockaderPolityId).toBe("rome");
    expect(blockade.tightnessBps).toBeGreaterThan(0);
    expect(begun.factProposals.some((fact) => fact.kind === "blockade_begun")).toBe(true);
    const gone: WorldState = { ...begun.world, material: { ...begun.world.material, forces: begun.world.material.forces.map((force) => (force.id === "allied-greek-hulls" ? { ...force, locationId: PUNIC_IDS.rhegium } : force)) } };
    const ended = tick(gone, 2);
    expect(ended.world.blockades.find((candidate) => candidate.id === blockade.id)!.status).toBe("ended");
    expect(ended.factProposals.some((fact) => fact.kind === "blockade_ended")).toBe(true);
  });
});
