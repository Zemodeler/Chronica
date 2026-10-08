import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, admissionRefusal, allOffices, ScenarioDefinitionSchema, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { sentenceByOutcome } from "./trials";
import { isNoted } from "./nota";

/**
 * Lucius Julius Libo was condemned for peculation, and ten months on stood for the aedileship and was elected and seated in the Senate; the consul Appius
 * Claudius Russus was condemned and stayed consul. A conviction now takes the man's office and the office he was chosen for, brands him infamous for ten
 * years (for life if he went into exile), and lays the censors' mark on him until the next censors lift it.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world0 = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const trial = (subjectId: string, sentence: "fine" | "exile"): PoliticalProcedure => ({
  id: "case-russus", type: "denunciation", institutionId: "roman-comitia-tributa", sponsorCharacterId: subjectId, subjectKind: "character", subjectId,
  label: "The case of Appius Claudius Russus for what he took from the chest", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote", openedAtStep: 0,
  deadlineStep: 10, resolvedAtStep: 10, visibility: "public", voteRecordId: null, outcome: "passed", outcomeReason: "Guilty.", sourceEventIds: [], resultingEventIds: [], sentence,
});

describe("a condemned man", () => {
  const offices = allOffices({}, definition.government.offices);
  const aedile = offices.find((office) => office.id === "roman-aedile")!;
  const tribune = offices.find((office) => office.id === "roman-military-tribune")!;

  it("loses the consulship he sat in and the one he was chosen for, and cannot stand for an office for ten years", () => {
    const world = world0();
    const consul = world.material.officeSeats.find((seat) => seat.officeId === "roman-consul" && seat.status === "held")!;
    const man = consul.holderCharacterId!;
    const designating: WorldState = { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.id === consul.id ? { ...seat, designateCharacterId: man } : seat)) } };
    const condemned = sentenceByOutcome(designating, trial(man, "fine"), 100);
    expect(condemned.material.officeSeats.some((seat) => seat.holderCharacterId === man && seat.status === "held")).toBe(false);
    expect(condemned.material.officeSeats.some((seat) => seat.designateCharacterId === man)).toBe(false);
    const him = condemned.characters.find((character) => character.id === man)!;
    expect(admissionRefusal(condemned, aedile, aedile.eligibilityRequirementIds, him, 400)).toMatch(/infamous/);
    // After the ten years the bar is gone (other bars may remain).
    expect(admissionRefusal(condemned, aedile, aedile.eligibilityRequirementIds, him, 100 + 3_700) ?? "").not.toMatch(/infamous/);
  });

  it("is neither a military tribune nor a senator until the censors lift their mark, and exile is for life", () => {
    const world = world0();
    const man = world.characters.find((character) => character.polityId === "rome" && character.alive && character.officeId === null)!;
    const condemned = sentenceByOutcome(world, trial(man.id, "fine"), 100);
    expect(isNoted(condemned, man.id)).toBe(true);
    const him = condemned.characters.find((character) => character.id === man.id)!;
    expect(admissionRefusal(condemned, tribune, tribune.eligibilityRequirementIds, him, 200)).toMatch(/infamous|mark/);
    const exiled = sentenceByOutcome(world, trial(man.id, "exile"), 100);
    expect(admissionRefusal(exiled, aedile, aedile.eligibilityRequirementIds, exiled.characters.find((character) => character.id === man.id)!, 100 + 20_000)).toMatch(/for life/);
  });
});
