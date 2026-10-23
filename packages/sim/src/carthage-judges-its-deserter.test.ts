import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, admissionRefusal, allOffices, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/** Carthage did nothing when a trierarch went over to Rome. Now the Hundred and Four try him in his absence, his estate is taken for the treasury, and his family are held for him. */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory("deserter"), gameId: "game-deserter",
});

describe("Carthage judges its deserter", () => {
  const world: WorldState = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const man = world.characters.find((character) => character.polityId === "carthage" && character.alive && character.id !== "hanno-carthage")!;
  const rich: WorldState = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === man.personalAccountId ? { ...account, balance: 5_000 } : account)) } };
  // He has a wife and a child, who stay.
  const kin = world.characters.filter((character) => character.polityId === "carthage" && character.alive && character.id !== man.id && character.id !== "hanno-carthage").slice(0, 2);
  const withKin: WorldState = {
    ...rich,
    familyLinks: [...rich.familyLinks, ...kin.map((relative, index) => ({ id: `link-${index}`, characterId: man.id, relatedCharacterId: relative.id, kind: index === 0 ? "spouse_or_partner" as const : "child" as const, startedAtStep: 0, endedAtStep: null, visibility: "polity" as const, provenanceEventId: null }))],
  };
  const result = applyDeltas(withKin, [WorldDeltaSchema.parse({ op: "character_state_set", characterRef: man.id, polityId: "rome", reason: "He goes over to Rome." })], context(man.id));

  it("tries him in his absence, takes his estate for the treasury, and says so", () => {
    expect(result.rejected).toEqual([]);
    const fact = result.factProposals.find((candidate) => /in his absence/.test(candidate.summary));
    expect(fact?.summary).toMatch(/estate \(5000\) is taken for the treasury/);
    expect(result.world.material.accounts.find((account) => account.id === man.personalAccountId)!.balance).toBe(0);
    expect(result.world.material.transactions.some((row) => row.kind === "confiscation" && row.sourceAccountId === man.personalAccountId && row.amount === 5_000)).toBe(true);
  });

  it("holds his family hostage for him, and shuts every office of Carthage to him for life", () => {
    for (const relative of kin) expect(result.world.characters.find((character) => character.id === relative.id)!.disqualifyingStatuses).toContain("hostage");
    const suffete = allOffices({}, definition.government.offices).find((office) => office.id === "carthaginian-suffete")!;
    const him = result.world.characters.find((character) => character.id === man.id)!;
    expect(admissionRefusal(result.world, suffete, suffete.eligibilityRequirementIds, him, 5_000)).not.toBeNull();
  });
});
