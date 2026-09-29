import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { reviewSociety } from "./society";
import { runDeterministicTick } from "./tick";

/**
 * The Seleucid Empire holds over a thousand provinces. Nothing that loops over a
 * power's ground may put them all in a prompt, a fact or a note, or spend a
 * month's time on them: a king of this size is written about as a king of a
 * dozen provinces is, with the biggest named and the rest counted.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const held = (world: WorldState, polityId: string) => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;

describe("a power of a thousand provinces", () => {
  const world = opening();
  const king = world.characters.find((character) => character.polityId === "seleucid-empire" && character.officeId?.startsWith("seleucid-empire:"))!;

  it("is that big", () => {
    expect(held(world, "seleucid-empire")).toBeGreaterThan(1_000);
  });

  it("is sent to its king as a page no longer than Rome's is to a consul", () => {
    const slice = (actorId: string, polityId: string) => renderWorldSlice(buildWorldSlice({
      world, clock: definition.clock, offices: definition.government.offices, actorRef: { kind: "character", id: actorId }, actorPolityId: polityId,
      orderText: "Look to the realm", facts: [], dueEvents: [], pendingEvents: [],
    }));
    const kings = slice(king.id, "seleucid-empire");
    const consul = slice("gaius-genucius", "rome");
    expect(kings.length).toBeLessThan(consul.length * 1.5);
    expect(kings.length).toBeLessThan(40_000);
  });

  it("seats its chambers with a dozen regional blocs at most, and names its distress in one line", () => {
    const society = reviewSociety({ world, government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, warfare: definition.warfare, toDay: 0, ids: createIdFactory("big-society") }).world;
    for (const chamber of society.material.institutions.filter((institution) => institution.polityId === "seleucid-empire")) {
      expect(chamber.votingBlocs.filter((bloc) => bloc.interests?.includes("regional")).length).toBeLessThanOrEqual(12);
    }
    const starving: WorldState = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (world.map.provinces.find((province) => province.id === row.provinceId)?.controllerPolityId === "seleucid-empire" ? { ...row, foodSecurityBps: 3_900, stabilityBps: 3_900 } : row)) },
    };
    const before = { ...starving, material: { ...starving.material, provinceMaterial: starving.material.provinceMaterial.map((row) => ({ ...row, foodSecurityBps: 4_100, stabilityBps: 4_100 })) } };
    const ticked = runDeterministicTick({ world: { ...before, elapsedStep: 30, instant: { day: 30, minute: 0 } }, toDay: 30, ids: createIdFactory("big-tick"), warfare: definition.warfare, clock: definition.clock });
    for (const fact of ticked.factProposals) expect(fact.summary.length).toBeLessThan(700);
    for (const note of ticked.notes) expect(note.length).toBeLessThan(700);
  });

  it("takes a month of the clock in well under ten seconds", () => {
    const started = performance.now();
    runDeterministicTick({ world: { ...world, elapsedStep: 30, instant: { day: 30, minute: 0 } }, toDay: 30, ids: createIdFactory("big-month"), warfare: definition.warfare, clock: definition.clock });
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
