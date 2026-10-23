import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, doctrinesOf, ensureProvinceMaterial, formArmies, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * The playtest hired a Gaulish company and saw it written as "Legio II (hastati, principes, triarii)": a company a contract raises was a row of men under the
 * employer's power, and the employer's establishment drew it up, so the Roman default body (a legion) took any infantry it had no other word for. A hired band
 * is its own people's: a band under its captain, with the pay he was hired at, the arms its people carry and the practice of its people for a doctrine of its own.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const hire = (label: string, categoryId: string, strength: number) => {
  const deltas = [WorldDeltaSchema.parse({
    op: "service_contract_open", localId: "band", role: "mercenary", label, employerAccountRef: "rome-treasury", employeeRef: "quintus-ogulnius",
    advance: 500, monthlyPay: 3_000, termDays: 180, duties: "Serve the consul.", company: { categoryId, strength }, provinceId: null, reason: "The consul wants men.",
  })];
  const context: ApplyContext = {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory("band"), gameId: "game-band", orderDeltas: new Set(deltas),
  };
  const world = opening();
  const result = applyDeltas(world, deltas, context);
  const contract = result.world.material.contracts.at(-1)!;
  return { result, world: result.world, band: result.world.material.forces.find((force) => force.id === contract.forceId)! };
};

describe("a hired band keeps its own people", () => {
  it("is a Gallic band under its captain, never Legio II with hastati, principes and triarii", () => {
    const { result, world, band } = hire("A company of Gauls for the consul", "infantry", 600);
    expect(result.rejected).toEqual([]);
    expect(band.polityId).toBe("rome");
    expect(band.commanderCharacterId).toBe("quintus-ogulnius");
    const named = JSON.stringify([band.name, band.formations, band.personnel]);
    expect(named).not.toMatch(/Legio|hastati|principes|triarii/);
    expect(band.formations).toHaveLength(1);
    expect(band.formations![0]).toMatchObject({ bodyLabel: expect.stringMatching(/^Gallic band of /) as unknown, line: "first" });
    expect(band.personnel[0]).toMatchObject({ categoryId: "infantry", fit: 600, label: expect.stringMatching(/^Gallic foot/) as unknown });
    // Its own pay: the contract's obligation, and an account of its own.
    expect(band.payObligationId).not.toBeNull();
    expect(world.material.accounts.some((account) => account.owner.kind === "force" && account.owner.id === band.id)).toBe(true);
    // The practice of its people is the band's own doctrine, and reaches its men whatever power holds the contract.
    const row = band.personnel[0]!;
    const doctrines = doctrinesOf({ ...definition.warfare, doctrines: world.doctrines, establishments: world.establishments }, band, row);
    expect(doctrines.map((doctrine) => doctrine.label)).toContain("The charge of the Gauls");
    // Drawing up the world's armies again leaves it as it is.
    expect(formArmies(world, 1).material.forces.find((force) => force.id === band.id)).toEqual(band);
  });

  it.each([
    ["Numidian horse for the consul", "cavalry", /^Numidian band of/, "wing", "The Numidian ride"],
    ["Balearic slingers", "light-infantry", /^Balearic band of/, "first", "The slingers' screen"],
    ["Iberian mercenaries", "infantry", /^Iberian band of/, "first", "The Iberian way in broken ground"],
    ["Campanian soldiers of fortune", "infantry", /^Campanian band of/, "first", "The Campanian line"],
    ["Greek hoplites", "infantry", /^Greek band of/, "first", "The hoplite phalanx"],
  ])("%s keep the structure and the doctrine of their own people", (label, category, body, _line, doctrine) => {
    const { result, world, band } = hire(label, category, 400);
    expect(result.rejected).toEqual([]);
    expect(band.formations![0]!.bodyLabel).toMatch(body);
    expect(JSON.stringify([band.name, band.formations, band.personnel])).not.toMatch(/Legio|hastati|principes|triarii/);
    expect(world.doctrines.some((candidate) => candidate.forceId === band.id && candidate.label === doctrine)).toBe(true);
  });
});
