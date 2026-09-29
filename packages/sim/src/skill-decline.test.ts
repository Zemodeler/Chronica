import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DepartmentSchema, WorldStateSchema, type Character, type WorldState } from "@chronica/shared";
import { reviewSkills, scarredBy } from "./skill-decline";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const one = (world: WorldState, id: string): Character => world.characters.find((character) => character.id === id)!;

const withMan = (age: number, subSkills: Character["skills"]["subSkills"]): WorldState => {
  const world = base();
  const model = world.characters.find((character) => character.polityId === null) ?? world.characters[0]!;
  const man: Character = { ...model, id: "old-man", name: "Old Man", polityId: null, officeId: null, ageYearsAtStart: age, birthStep: null, alive: true, skills: { ...model.skills, subSkills }, skillRecord: undefined };
  return { ...world, characters: [...world.characters, man] };
};

describe("a man's gifts, year on year", () => {
  it("are only noted the first time they are seen", () => {
    const seen = reviewSkills(withMan(40, { rhetoric: 80 }), 0);
    expect(one(seen, "old-man").skillRecord).toMatchObject({ reviewedAtStep: 0, peaks: { rhetoric: 80 } });
    expect(one(seen, "old-man").skills.subSkills.rhetoric).toBe(80);
  });

  it("lose their edge when unused for a year, down to sixty and no further", () => {
    let world = reviewSkills(withMan(20, { rhetoric: 80, taxation: 55 }), 0);
    world = reviewSkills(world, 360);
    expect(one(world, "old-man").skills.subSkills.rhetoric).toBe(79);
    expect(one(world, "old-man").skills.subSkills.taxation).toBe(55);
    world = reviewSkills(world, 360 * 25);
    expect(one(world, "old-man").skills.subSkills.rhetoric).toBe(60);
  });

  it("go in the body first with age, and never in the rites or the law", () => {
    let world = reviewSkills(withMan(70, { prowess: 60, endurance: 60, rites: 70, strategist: 58 }), 0);
    world = reviewSkills(world, 360);
    const man = one(world, "old-man");
    expect(man.skills.subSkills.prowess).toBe(58);
    expect(man.skills.subSkills.rites).toBe(69); // disuse only, not age
    expect(man.skills.subSkills.strategist).toBe(57);
  });

  it("never fall below half the best they have been", () => {
    let world = reviewSkills(withMan(90, { prowess: 40 }), 0);
    world = reviewSkills(world, 360 * 30);
    expect(one(world, "old-man").skills.subSkills.prowess).toBe(20);
  });

  it("keep a mark of a serious fever", () => {
    const man = one(withMan(40, { endurance: 60 }), "old-man");
    const after = scarredBy(man, "fever", 10).skills.subSkills.endurance!;
    expect(after).toBeLessThan(60);
    expect(after).toBeGreaterThanOrEqual(57);
    expect(scarredBy(man, "a wound", 10)).toBe(man);
  });
});

describe("a deputy", () => {
  it("grows toward the head he works under, a point a year", () => {
    const world = withMan(30, { taxation: 40 });
    const head = { ...one(world, "old-man"), id: "great-quaestor", name: "Great Quaestor", skills: { ...one(world, "old-man").skills, subSkills: { taxation: 80 } } };
    const seat = world.material.officeSeats[0]!;
    const staffed: WorldState = {
      ...world,
      characters: [...world.characters, head],
      departments: [DepartmentSchema.parse({ id: "t", scope: { kind: "polity", id: "syracuse" }, name: "Treasury", levers: ["tax_roll"], officeIds: ["head-office"], headOfficeId: "head-office", deputyOfficeIds: ["deputy-office"], foundedAtStep: 0, formsAtStep: 0, origin: "order" })],
      material: { ...world.material, officeSeats: [...world.material.officeSeats, { ...seat, id: "h", officeId: "head-office", holderCharacterId: "great-quaestor", status: "held" as const }, { ...seat, id: "d", officeId: "deputy-office", holderCharacterId: "old-man", status: "held" as const }] },
    };
    let later = reviewSkills(staffed, 0);
    later = reviewSkills(later, 360 * 3);
    expect(one(later, "old-man").skills.subSkills.taxation).toBe(43);
    later = reviewSkills(later, 360 * 20);
    expect(one(later, "old-man").skills.subSkills.taxation).toBe(60);
  });
});
