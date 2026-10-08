import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, admissionRefusal, allOffices, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { FOREIGNER, DESERTER, grantCitizenship, isForeigner } from "./defection";
import { refugeClause } from "./trade-templates";

/**
 * A man who went over from Carthage to Rome was a Roman citizen the next morning and scored "enough for military tribune and quaestor". He is a guest now:
 * under a consul's protection, a client of him, a foreigner and a deserter in the eyes of the offices' rules; citizenship only by a law of the people.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world0 = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory("refuge"), gameId: "game-refuge", playerCharacterId: actor,
});
const goOver = (world: WorldState, who: string, to: string) => applyDeltas(world, [WorldDeltaSchema.parse({ op: "character_state_set", characterRef: who, polityId: to, reason: "He seeks refuge." })], context(who));

describe("a defector is a guest, not a citizen", () => {
  const world = world0();
  const man = world.characters.find((character) => character.polityId === "carthage" && character.alive && character.id !== "hanno-carthage")!;

  it("is received under a consul's protection, as his client, marked a foreigner and a deserter", () => {
    const result = goOver(world, man.id, "rome");
    expect(result.rejected).toEqual([]);
    const him = result.world.characters.find((character) => character.id === man.id)!;
    expect(him.polityId).toBe("rome");
    expect(isForeigner(him)).toBe(true);
    expect(him.disqualifyingStatuses).toContain(DESERTER);
    expect(result.world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === man.id)).toBe(true);
    expect(result.factProposals.some((fact) => fact.kind === "defection" && /under his protection/.test(fact.summary))).toBe(true);
  });

  it("is no candidate for a magistracy or the tribunate, and may be made a citizen only by law", () => {
    const him = goOver(world, man.id, "rome").world;
    const offices = allOffices({}, definition.government.offices);
    for (const id of ["roman-quaestor", "roman-military-tribune", "roman-aedile"]) {
      const office = offices.find((candidate) => candidate.id === id)!;
      const refusal = admissionRefusal(him, office, office.eligibilityRequirementIds, him.characters.find((character) => character.id === man.id)!, 100);
      expect(refusal, id).not.toBeNull();
    }
    const citizen = grantCitizenship(him, man.id);
    expect(isForeigner(citizen.characters.find((character) => character.id === man.id)!)).toBe(false);
    expect(citizen.characters.find((character) => character.id === man.id)!.disqualifyingStatuses).not.toContain(FOREIGNER);
  });

  it("is read from the player's own words: seek refuge with Rome", () => {
    const clause = refugeClause(world, man.id, "Seek refuge with Rome");
    expect(clause?.deltas[0]?.op).toBe("character_state_set");
    expect(refugeClause(world, man.id, "Seek refuge with Carthage")).toBeNull();
  });
});
