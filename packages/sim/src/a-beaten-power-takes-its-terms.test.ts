import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DiplomaticMessageSchema, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, warStanding, type FactProposalDraft, type WorldState } from "@chronica/shared";
import { settlePeaceByRule } from "./peace-by-rule";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * A beaten power takes the terms it is offered (docs/reports/consul-run-issues.md, H4). The consul dictated surrender to the
 * Campanians of Rhegium at a war score of a hundred, and every letter was "refused by silence".
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** The Campanians beaten: Rhegium and all their ground Rome's, their legion a remnant in the field. */
function beaten(): WorldState {
  const world = opening();
  return {
    ...world,
    map: { ...world.map, provinces: world.map.provinces.map((province) => ({ ...province,
      settlements: province.settlements.map((city) => (city.controllerPolityId === "rhegium-campanians" ? { ...city, controllerPolityId: "rome" } : city)),
      controllerPolityId: province.controllerPolityId === "rhegium-campanians" ? "rome" : province.controllerPolityId })) },
    material: { ...world.material, forces: world.material.forces.map((force) => (force.polityId === "rhegium-campanians" ? { ...force, personnel: force.personnel.map((group) => ({ ...group, fit: Math.min(group.fit, 300) })) } : force)) },
  };
}

const surrender = (world: WorldState, dueBy: number): WorldState => ({
  ...world,
  diplomacy: [...world.diplomacy, DiplomaticMessageSchema.parse({
    id: "message-surrender", kind: "peace_offer", fromPolityId: "rome", fromCharacterId: "gaius-genucius", toPolityId: "rhegium-campanians", toCharacterId: "decius-vibellius",
    subject: "Rome's terms", terms: "Lay down your arms and give yourselves up to the Roman people.", sentAtStep: 0, replyDueByStep: dueBy, proposes: ["peace"],
    clauses: [{ kind: "submission", polityId: "rhegium-campanians", toPolityId: "rome" }],
  })],
});

const settle = (world: WorldState, toDay: number) => {
  const facts: FactProposalDraft[] = [];
  const settled = settlePeaceByRule({ ...world, elapsedStep: toDay, instant: { ...world.instant, day: toDay } }, toDay, facts,
    { offices: definition.government.offices, warfare: definition.warfare, ids: createIdFactory("peace-rule"), gameId: "test", playerPolityId: "rome" });
  return { world: settled, facts, letter: settled.diplomacy.find((message) => message.id === "message-surrender")! };
};

describe("terms of peace offered to a power nobody plays", () => {
  it("are taken, submission and all, by a power beaten so far that Rome dictates the peace", () => {
    const world = surrender(beaten(), 1);
    expect(warStanding(world, "rome", "rhegium-campanians").dictates).toBe(true);
    const { world: settled, letter, facts } = settle(world, 1);
    expect(letter).toMatchObject({ status: "answered", answer: "accepted" });
    expect(settled.map.polities.find((polity) => polity.id === "rhegium-campanians")?.endedHow).toBe("absorbed");
    expect(facts.some((fact) => fact.kind === "letter_answered" && /accepted/.test(fact.summary))).toBe(true);
  });

  it("are refused with a reason, never by silence, by a power not beaten", () => {
    const world = surrender(opening(), 1);
    expect(warStanding(world, "rome", "rhegium-campanians").dictates).toBe(false);
    const { world: settled, letter } = settle(world, 1);
    expect(letter.status).toBe("answered");
    expect(letter.answer).toBe("refused");
    expect(letter.answerText).toMatch(/\w/);
    expect(settled.map.polities.find((polity) => polity.id === "rhegium-campanians")?.endedAtStep ?? null).toBeNull();
  });

  it("wait for their day while the man they are written to can still answer", () => {
    const { letter } = settle(surrender(beaten(), 30), 1);
    expect(letter.status).toBe("awaiting_reply");
  });

  it("are settled in the tick, and the war and its treaties end with the power", () => {
    const world = surrender(beaten(), 1);
    const ticked = runDeterministicTick({ world: { ...world, elapsedStep: 1, instant: { ...world.instant, day: 1 } }, toDay: 1, ids: createIdFactory("peace-tick"),
      warfare: definition.warfare, government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, playerCharacterId: "gaius-genucius" }).world;
    expect(ticked.map.polities.find((polity) => polity.id === "rhegium-campanians")?.endedHow).toBe("absorbed");
    expect(ticked.polityAgreements.find((agreement) => agreement.id === "war-rome-rhegium")?.status).toBe("ended");
  });
});
