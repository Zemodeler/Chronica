import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, admissionRefusal, allOffices, seatCharacterInOffice, ScenarioDefinitionSchema, type WorldState } from "@chronica/shared";

/**
 * One election day gave the same man two offices (Arvina praetor and quaestor; Genucius quaestor and praetor): the higher laid the lower down and the
 * quaestors' seats stood vacant. A man chosen to one magistracy, or sitting in one, is not admitted to a second the same year, whichever order the
 * colleges are counted in.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = allOffices({}, definition.government.offices);
const office = (id: string) => offices.find((candidate) => candidate.id === id)!;

describe("a man is chosen for one office", () => {
  const world: WorldState = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const man = world.characters.find((character) => character.polityId === "rome" && character.alive && character.officeId === null && character.gender === "male")!;
  const strong: WorldState = { ...world, characters: world.characters.map((character) => (character.id === man.id ? { ...character, prestigeBps: 9_000, ordo: "patrician" as const, eligibilityWaivers: [] } : character)) };

  it("is refused a second magistracy once he is seated in one, or named to follow in one", () => {
    const quaestor = office("roman-quaestor");
    const praetor = office("roman-praetor");
    const seated = seatCharacterInOffice(strong, man.id, { office: quaestor, vacantSeatId: null }, 10, 365);
    const him = seated.characters.find((character) => character.id === man.id)!;
    expect(admissionRefusal(seated, praetor, praetor.eligibilityRequirementIds, him, 10)).toMatch(/does not hold two|already/);
    expect(admissionRefusal(seated, office("roman-aedile"), office("roman-aedile").eligibilityRequirementIds, him, 10)).toMatch(/does not hold two|already/);
    // Named to follow (a designate) is the same.
    const quaestorSeat = seated.material.officeSeats.find((seat) => seat.officeId === "roman-quaestor" && seat.holderCharacterId === man.id)!;
    const designate: WorldState = { ...strong, material: { ...strong.material, officeSeats: [...strong.material.officeSeats, { ...quaestorSeat, holderCharacterId: null, status: "vacant" as const, designateCharacterId: man.id }] } };
    expect(admissionRefusal(designate, praetor, praetor.eligibilityRequirementIds, designate.characters.find((character) => character.id === man.id)!, 10)).toMatch(/chosen for/);
  });
});
