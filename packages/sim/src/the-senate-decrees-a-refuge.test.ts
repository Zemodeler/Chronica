import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { keepTheBodies } from "./bodies";
import { holdVotes } from "./senate";
import { RECEPTION_KIND, SUPPLIANT, UNPROTECTED, rankOf } from "./reception";

/**
 * A consul received a man who came over "under his protection" at once, whoever he was. Rome gave a refugee of weight *hospitium* by decree of the Senate, and the
 * consul laid it before the house; a humble man he took in on his own word. A general who goes over is a suppliant until the Senate has voted; carried, the consul is
 * his patron; refused, he is sent back (his own power at peace with Rome) or left without protection (at war with it).
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const goOver = (world: WorldState, who: string, to: string) => applyDeltas(world, [WorldDeltaSchema.parse({ op: "character_state_set", characterRef: who, polityId: to, reason: "He seeks refuge." })], {
  now: { day: world.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: who }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory("refuge"), gameId: "game-refuge", playerCharacterId: who,
} satisfies ApplyContext);
const sit = (world: WorldState, day: number) => {
  const sat = keepTheBodies({ world: { ...world, elapsedStep: day }, offices: definition.government.offices, successionRules: definition.government.successionRules, toDay: day });
  return holdVotes({ world: sat.world, offices: definition.government.offices, successionRules: definition.government.successionRules, toDay: day, ids: createIdFactory(`vote-${day}`) });
};

describe("the Senate decrees a refuge", () => {
  const world = opening();
  const general = world.characters.find((character) => world.material.forces.some((force) => force.polityId === "carthage" && force.commanderCharacterId === character.id && force.personnel.some((row) => row.fit > 0)))!;
  const humble = world.characters.find((character) => character.polityId === "carthage" && character.alive && character.id !== general.id
    && rankOf(world, character) === null && !world.material.forces.some((force) => force.commanderCharacterId === character.id || force.controllerCharacterId === character.id))!;

  it("tells a general from a humble man", () => {
    expect(rankOf(world, general)).not.toBeNull();
    expect(rankOf(world, humble)).toBeNull();
  });

  it("takes a humble man in on the consul's own word, as before", () => {
    const result = goOver(world, humble.id, "rome");
    expect(result.rejected).toEqual([]);
    const him = result.world.characters.find((character) => character.id === humble.id)!;
    expect(him.disqualifyingStatuses).not.toContain(SUPPLIANT);
    expect(result.world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === humble.id)).toBe(true);
    expect(result.world.genericEntities.some((entity) => entity.kind === RECEPTION_KIND)).toBe(false);
    expect(result.factProposals.some((fact) => /under his protection/.test(fact.summary))).toBe(true);
  });

  it("lays a general's reception before the Senate, and he is a suppliant until it votes", () => {
    const result = goOver(world, general.id, "rome");
    expect(result.rejected).toEqual([]);
    const him = result.world.characters.find((character) => character.id === general.id)!;
    expect(him.polityId).toBe("rome");
    expect(him.disqualifyingStatuses).toEqual(expect.arrayContaining([SUPPLIANT, "foreigner", "deserter"]));
    expect(result.world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === general.id)).toBe(false);
    const motion = result.world.material.politicalProcedures.find((procedure) => procedure.subjectId === general.id && /received as a guest of /.test(procedure.label))!;
    expect(motion.label).toMatch(/^Motion of .+: that .+ be received as a guest of .+ and given hospitium$/);
    expect(result.world.material.institutions.find((institution) => institution.id === motion.institutionId)!.polityId).toBe("rome");
    expect(result.factProposals.some((fact) => /laid it before the house/.test(fact.summary))).toBe(true);
    expect(result.factProposals.some((fact) => /under his protection/.test(fact.summary))).toBe(false);
  });

  it("makes him the consul's guest and client when the Senate carries it", () => {
    const laid = goOver(world, general.id, "rome").world;
    const counted = sit(laid, 30);
    const settled = keepTheBodies({ world: { ...counted.world, elapsedStep: 31 }, offices: definition.government.offices, successionRules: definition.government.successionRules, toDay: 31 });
    const motion = settled.world.material.politicalProcedures.find((procedure) => procedure.subjectId === general.id && /received as a guest/.test(procedure.label))!;
    expect(motion.outcome).toBe("passed");
    const him = settled.world.characters.find((character) => character.id === general.id)!;
    expect(him.disqualifyingStatuses).not.toContain(SUPPLIANT);
    expect(him.disqualifyingStatuses).toContain("foreigner");
    expect(settled.world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === general.id && link.targetCharacterId === motion.sponsorCharacterId)).toBe(true);
    expect(settled.facts.some((fact) => /decreed that .+ be received as a guest of .+ and given hospitium/.test(fact.summary))).toBe(true);
  });

  it("sends him back when the Senate refuses and his own power is at peace with Rome", () => {
    const laid = goOver({ ...world, polityAgreements: world.polityAgreements.filter((agreement) => agreement.kind !== "war") }, general.id, "rome").world;
    const refused = refuse(laid);
    const settled = keepTheBodies({ world: { ...refused, elapsedStep: 31 }, offices: definition.government.offices, successionRules: definition.government.successionRules, toDay: 31 });
    const him = settled.world.characters.find((character) => character.id === general.id)!;
    expect(him.polityId).toBe("carthage");
    expect(him.disqualifyingStatuses).toEqual(expect.arrayContaining(["captured", "deserter"]));
    expect(him.disqualifyingStatuses).not.toContain(SUPPLIANT);
    expect(settled.facts.some((fact) => /would not receive .+ sent back to Carthage/.test(fact.summary))).toBe(true);
  });

  it("leaves him without protection when the Senate refuses and his power is at war with Rome", () => {
    const atWar = {
      ...world,
      polityAgreements: [...world.polityAgreements.filter((agreement) => agreement.kind !== "war"), { ...world.polityAgreements[0]!, id: "war-test", kind: "war" as const, status: "active" as const, polityId: "rome", otherPolityId: "carthage" }],
    };
    const laid = goOver(atWar, general.id, "rome").world;
    const settled = keepTheBodies({ world: { ...refuse(laid), elapsedStep: 31 }, offices: definition.government.offices, successionRules: definition.government.successionRules, toDay: 31 });
    const him = settled.world.characters.find((character) => character.id === general.id)!;
    expect(him.polityId).toBe("rome");
    expect(him.disqualifyingStatuses).toContain(UNPROTECTED);
    expect(settled.world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === general.id)).toBe(false);
    expect(settled.facts.some((fact) => /left without protection/.test(fact.summary))).toBe(true);
  });
});

/** The house said no: the same record the count writes. */
function refuse(world: WorldState): WorldState {
  return {
    ...world,
    material: {
      ...world.material,
      politicalProcedures: world.material.politicalProcedures.map((procedure) => (/received as a guest/.test(procedure.label)
        ? { ...procedure, stage: "resolved" as const, outcome: "failed" as const, outcomeReason: "The house would not have him.", resolvedAtStep: 30 }
        : procedure)),
    },
  };
}
