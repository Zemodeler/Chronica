import { describe, expect, it } from "vitest";
import { admissionRefusal, gensById, priestlyBar, type Office } from "@chronica/shared";
import { adoptIntoGens } from "./adoption";
import { keepGentes } from "./gentes";
import { killCharacter } from "./mortality";
import { named, opening, withDay } from "./gentes-test-kit";

/**
 * The rites of a family stayed with it: the Fabii's on the Quirinal were carried by a Fabius, and when he died by another, never by a
 * stranger. The old priesthoods (the king of the rites, the flamines, the Salii) were the patricians', by birth, whatever the plebs
 * had won of the pontificate and the augurate in 300.
 */
describe("the sacra stay in the gens", () => {
  const start = opening();

  it("has a keeper of the gens, who is its living man", () => {
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    expect(keeper.dynastyId).toBe("gens-fabius");
    expect(keeper.alive).toBe(true);
    expect(keeper.gender).toBe("male");
  });

  it("passes to another man of the gens when the keeper dies, and never to a stranger", () => {
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    const dead = killCharacter(withDay(start, 40), keeper.id, "a fever", 40).world;
    const kept = keepGentes(withDay(dead, 60), 60).world;
    const now = gensById(kept, "gens-fabius")!;
    expect(now.sacraKeeperId).not.toBeNull();
    expect(now.sacraKeeperId).not.toBe(keeper.id);
    expect(kept.characters.find((character) => character.id === now.sacraKeeperId)!.dynastyId).toBe("gens-fabius");
    expect(now.sacra).toEqual(fabii.sacra);
  });

  it("goes to the heir the keeper named, if the heir is of the gens", () => {
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    const heir = named(start, "Gaius Fabius Pictor");
    const named_ = { ...start, characters: start.characters.map((character) => (character.id === keeper.id ? { ...character, heirCharacterId: heir.id } : character)) };
    const dead = killCharacter(withDay(named_, 40), keeper.id, "a fever", 40).world;
    expect(gensById(keepGentes(withDay(dead, 60), 60).world, "gens-fabius")!.sacraKeeperId).toBe(heir.id);
  });

  it("is lost to nobody but a gens with no man in it: the rites wait for one", () => {
    let world = withDay(start, 40);
    for (const man of start.characters.filter((character) => character.dynastyId === "gens-fabius" && character.alive)) world = killCharacter(world, man.id, "a plague", 40).world;
    const kept = keepGentes(withDay(world, 60), 60).world;
    const fabii = gensById(kept, "gens-fabius")!;
    expect(fabii.sacraKeeperId).toBeNull();
    expect(fabii.sacra.length).toBe(1);
  });

  it("goes with the name to an adopted son", () => {
    // An old Fabius with no son adopts a young patrician of another gens; the son bears the Fabii's name and can keep their rites.
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    const lone = { ...start, characters: start.characters.map((character) => (character.id === keeper.id ? { ...character, ageYearsAtStart: 60 } : character)), familyLinks: start.familyLinks.filter((link) => link.characterId !== keeper.id && link.relatedCharacterId !== keeper.id) };
    const done = adoptIntoGens(lone, keeper.id, named(lone, "Gaius Sulpicius Paterculus").id, 100);
    if ("bar" in done) throw new Error(done.bar);
    const dead = killCharacter(withDay(done.world, 200), keeper.id, "old age", 200).world;
    const kept = keepGentes(withDay(dead, 230), 230).world;
    const son = kept.characters.find((character) => character.name.endsWith("Sulpicianus"))!;
    expect(son.dynastyId).toBe("gens-fabius");
    expect(gensById(kept, "gens-fabius")!.sacraKeeperId).toBe(son.id);
  });

  it("keeps the old priesthoods for patricians by birth", () => {
    const rex = { id: "roman-rex-sacrorum", label: "The king of the rites" } as Pick<Office, "id" | "label">;
    const flamen = { id: "roman-flamen-dialis", label: "Flamen of Jupiter" } as Pick<Office, "id" | "label">;
    const pontiff = { id: "roman-pontiff", label: "Roman pontiff" } as Pick<Office, "id" | "label">;
    const patrician = named(start, "Gnaeus Cornelius Blasio");
    const plebeian = named(start, "Manius Curius Dentatus");
    expect(priestlyBar(rex, plebeian)).toMatch(/patricians by birth/);
    expect(priestlyBar(flamen, plebeian)).toMatch(/patricians by birth/);
    expect(priestlyBar(rex, patrician)).toBeNull();
    // The pontificate was opened to the plebs by the lex Ogulnia of 300.
    expect(priestlyBar(pontiff, plebeian)).toBeNull();
    // And it is the admission the electors apply, whatever else the office asks.
    const office = { id: "roman-rex-sacrorum", label: "The king of the rites", polityId: "rome", kind: "priesthood", authorisedActionIds: [], eligibilityRequirementIds: [] } as unknown as Office;
    expect(admissionRefusal(start, office, [], plebeian, 0)).toMatch(/patricians by birth/);
    expect(admissionRefusal(start, office, [], patrician, 0)).toBeNull();
  });
});
