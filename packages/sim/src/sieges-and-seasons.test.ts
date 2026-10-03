import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type Force, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { answerSiege, siegeDecision } from "./siege-decisions";

/**
 * A siege is a string of events, not a bar filling up: sorties, runners by
 * sea, a breach to storm or wait at, terms offered, a traitor at a gate; and
 * the sea has a season (docs/plans/battles-that-last.md, phase 5).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const PLAYER = "gaius-genucius";
const context: ApplyContext = {
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: PLAYER }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory("siege5"), gameId: "game-siege5",
};
const WAR: WorldDelta = {
  op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "mamertines",
  terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "They refused to surrender.",
};
const LAY: WorldDelta = { op: "siege_lay", localId: "messana", forceRef: "roman-field-army", settlementId: "settlement-messana", reason: "Invest the city." };

function besieged(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const before = { ...opening, material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: MESSANA } : force)) } };
  return applyDeltas(before, [WAR, LAY], context).world;
}
const tick = (state: WorldState, day: number, player: string | null = PLAYER) => runDeterministicTick({
  world: { ...state, elapsedStep: day, instant: { ...state.instant, day } }, toDay: day, ids: createIdFactory(`siege5-${day}`), warfare: definition.warfare, clock: definition.clock,
  ...(player === null ? {} : { playerCharacterId: player }),
});
const pressedTo = (state: WorldState, pressureBps: number, told: readonly string[] = []): WorldState => ({ ...state, sieges: state.sieges.map((siege) => ({ ...siege, pressureBps, told: [...told] })) });

describe("a siege's turning points", () => {
  it("stops at a breach and asks the besieging player, and stands still while it waits", () => {
    const asked = tick(pressedTo(besieged(), 4_990), 5).world;
    const siege = asked.sieges[0]!;
    expect(siege.awaiting?.kind).toBe("breach");
    expect(siegeDecision(asked, PLAYER)!.options.map((option) => option.label)).toEqual(["Storm the breach", "Keep the lines"]);
    const waited = tick(asked, 10).world.sieges[0]!;
    expect(waited.pressureBps).toBe(siege.pressureBps);
  });

  it("storms the breach when told to, and the city is carried or the storm thrown back", () => {
    const asked = tick(pressedTo(besieged(), 4_990), 5).world;
    const stormed = answerSiege(asked, PLAYER, "siege-storm", 6, definition.warfare, createIdFactory("storm"));
    const siege = stormed.world.sieges[0]!;
    expect(siege.awaiting).toBeNull();
    expect(stormed.facts.some((fact) => /carried the breach|thrown back/.test(fact.summary))).toBe(true);
    expect(siege.pressureBps === 10_000 || siege.pressureBps < 4_990 + 100).toBe(true);
  });

  it("takes the city on terms, and the garrison marches out alive", () => {
    const asked = tick(pressedTo(besieged(), 7_490, ["breach"]), 5).world;
    expect(asked.sieges[0]!.awaiting?.kind).toBe("terms");
    const accepted = answerSiege(asked, PLAYER, "siege-accept", 6, definition.warfare, createIdFactory("terms")).world;
    const garrison = accepted.material.forces.find((force) => force.id === "mamertine-garrison")!;
    expect(garrison.locationId).not.toBe(MESSANA);
    const taken = tick(accepted, 10).world;
    expect(taken.sieges[0]!.status).toBe("taken");
    expect(taken.material.forces.some((force) => force.id === "mamertine-garrison")).toBe(true);
  });

  it("gives an undefended city up at the breach instead of asking about nobody", () => {
    const state = pressedTo(besieged(), 4_990);
    const empty: WorldState = { ...state, material: { ...state.material, forces: state.material.forces.filter((force) => !(force.locationId === MESSANA && force.polityId === "mamertines")) } };
    const ticked = tick(empty, 5);
    expect(ticked.world.sieges[0]!.status).toBe("taken");
    expect(siegeDecision(ticked.world, PLAYER)).toBeUndefined();
    expect(ticked.factProposals.some((fact) => /no garrison left to hold the breach/.test(fact.summary))).toBe(true);
  });

  it("carries a breach its garrison has left, and the city falls the same day", () => {
    const asked = tick(pressedTo(besieged(), 4_990), 5).world;
    expect(asked.sieges[0]!.awaiting?.kind).toBe("breach");
    const gone: WorldState = { ...asked, material: { ...asked.material, forces: asked.material.forces.filter((force) => !(force.locationId === MESSANA && force.polityId === "mamertines")) } };
    expect(siegeDecision(gone, PLAYER)!.prompt).toMatch(/No soldiers are left/);
    const stormed = answerSiege(gone, PLAYER, "siege-storm", 6, definition.warfare, createIdFactory("storm-empty"));
    expect(stormed.world.sieges[0]!.status).toBe("taken");
    expect(stormed.facts.map((fact) => fact.kind)).toEqual(expect.arrayContaining(["siege_event", "siege_ended"]));
  });

  it("lets a careful NPC besieger take terms himself", () => {
    const state = pressedTo(besieged(), 7_490, ["breach"]);
    const careful: WorldState = { ...state, characters: state.characters.map((character) => (character.id === PLAYER ? { ...character, mind: { ...character.mind, temperament: { ...character.mind.temperament, caution: 80 } } } : character)) };
    const ticked = tick(careful, 5, null);
    expect(ticked.world.sieges[0]!.status).toBe("taken");
    expect(ticked.world.sieges[0]!.endedReason).toMatch(/terms/);
  });
});

describe("a port fed by sea", () => {
  const ship = (): Force => ({
    id: "mamertine-boats", name: "Mamertine boats", polityId: "mamertines", commanderCharacterId: "mamertine-spokesman", controllerCharacterId: "mamertine-spokesman",
    locationId: MESSANA, positionId: null, authorizedStrength: 10, personnel: [{ categoryId: "warship", label: "Warships", fit: 10, unavailable: [] }],
    moraleBps: 7_000, cohesionBps: 7_000, fatigueBps: 0, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
  });

  it("holds out longer while its ships slip past the lines", () => {
    const plain = besieged();
    const fed: WorldState = { ...plain, material: { ...plain.material, forces: [...plain.material.forces, ship()] } };
    const without = tick(plain, 20).world.sieges[0]!.pressureBps;
    const withRunners = tick(fed, 20);
    expect(withRunners.world.sieges[0]!.pressureBps).toBeLessThan(without);
    expect(withRunners.factProposals.some((fact) => /slipped into/.test(fact.summary))).toBe(true);
  });
});

describe("the sea out of season", () => {
  // The clock opens on 1 March; the winter months fall around days 245-365.
  const WINTER_FROM = 250;
  function winterAt(provinceId: string): number {
    const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    let world: WorldState = { ...opening, material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id === "allied-greek-hulls" ? { ...force, locationId: provinceId, reckonedToStep: WINTER_FROM } : force)) } };
    for (let day = WINTER_FROM + 5; day <= WINTER_FROM + 120; day += 5) world = tick(world, day, null).world;
    return world.material.forces.find((force) => force.id === "allied-greek-hulls")!.personnel.reduce((sum, group) => sum + group.fit, 0);
  }

  it("costs a fleet kept at sea off another's coast its ships, and one laid up in its own harbour none", () => {
    const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const hulls = opening.material.forces.find((force) => force.id === "allied-greek-hulls")!.personnel.reduce((sum, group) => sum + group.fit, 0);
    const home = opening.material.forces.find((force) => force.id === "allied-greek-hulls")!.locationId;
    expect(winterAt(home)).toBe(hulls);
    expect(winterAt(PUNIC_IDS.carthage)).toBeLessThan(hulls);
  });
});
