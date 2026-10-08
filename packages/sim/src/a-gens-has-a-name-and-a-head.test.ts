import { describe, expect, it } from "vitest";
import { gensById, gensIdOfNomen, parseRomanName } from "@chronica/shared";
import { keepGentes } from "./gentes";
import { killCharacter } from "./mortality";
import { named, opening, withDay } from "./gentes-test-kit";

/**
 * The question was: do Roman houses exist, noble families as they had historically? They now do. A gens has a name
 * (the Cornelii), branches (the Scipiones, the Blasiones), a head who is one of its living men, and the world finds
 * a new one when he dies.
 */
describe("a gens has a name and a head", () => {
  const world = opening();

  it("is in the world at the opening, with its branches and its honours", () => {
    const cornelii = gensById(world, "gens-cornelius")!;
    expect(cornelii.plural).toBe("the Cornelii");
    expect(cornelii.ordo).toBe("patrician");
    expect(cornelii.stirpes.map((stirps) => stirps.cognomen)).toEqual(expect.arrayContaining(["Scipio", "Lentulus", "Blasio", "Rufinus"]));
    expect(cornelii.honours.filter((honour) => honour.kind === "consul").length).toBeGreaterThan(10);
    expect(cornelii.imagines).toBeGreaterThan(5);
    // The Fabii keep their rites, and they have a man to carry them.
    const fabii = gensById(world, "gens-fabius")!;
    expect(fabii.sacra[0]).toMatch(/Quirinal/);
    expect(world.characters.find((character) => character.id === fabii.sacraKeeperId)?.dynastyId).toBe("gens-fabius");
  });

  it("is each man's: dynastyId is set for every Roman with a nomen, and his name is parsed into its parts", () => {
    const blasio = named(world, "Gnaeus Cornelius Blasio");
    expect(blasio.dynastyId).toBe("gens-cornelius");
    expect([blasio.praenomen, blasio.nomen, blasio.cognomen]).toEqual(["Gnaeus", "Cornelius", "Blasio"]);
    // A woman bears the nomen of her father's gens in the feminine and keeps it when she marries.
    expect(named(world, "Sulpicia").dynastyId).toBe("gens-sulpicius");
    expect(named(world, "Aemilia the Vestal").dynastyId).toBe("gens-aemilius");
    expect(parseRomanName("Cornelia Blasionis").nomen).toBe("Cornelius");
    expect(gensIdOfNomen("Fabia")).toBe("gens-fabius");
  });

  it("has a head who is a living man of the gens, whose standing and honours lead it", () => {
    for (const gens of world.gentes.filter((candidate) => candidate.kind !== "royal" || candidate.princepsId !== null)) {
      const members = world.characters.filter((character) => character.dynastyId === gens.id && character.alive && character.gender === "male" && character.ageYearsAtStart >= 14);
      if (members.length === 0) { expect(gens.princepsId, gens.id).toBeNull(); continue; }
      const head = world.characters.find((character) => character.id === gens.princepsId);
      expect(head, gens.id).toBeDefined();
      expect(head!.dynastyId).toBe(gens.id);
      expect(head!.gender).toBe("male");
    }
    // Arvina has sat three times in the curule chair and is the first man of the Cornelii: more than Blasio's one consulship.
    expect(world.characters.find((character) => character.id === gensById(world, "gens-cornelius")!.princepsId)?.name).toBe("Publius Cornelius Arvina");
  });

  it("finds a new head when the head dies, the next time it looks", () => {
    const head = named(world, "Publius Cornelius Arvina");
    const dead = killCharacter(withDay(world, 40), head.id, "an old man's fever", 40).world;
    const kept = keepGentes(dead, 60).world;
    const now = gensById(kept, "gens-cornelius")!;
    expect(now.princepsId).not.toBe(head.id);
    const next = kept.characters.find((character) => character.id === now.princepsId)!;
    expect(next.alive).toBe(true);
    expect(next.dynastyId).toBe("gens-cornelius");
    // And the honours stay with the gens: nobody's nobilitas is lost to a death.
    expect(now.honours.length).toBe(gensById(world, "gens-cornelius")!.honours.length);
  });

  it("makes a gens for a name the world has not had, the first time it looks", () => {
    const start = withDay(world, 10);
    const a = { ...named(start, "Gaius Duilius"), id: "marcus-vettius", name: "Marcus Vettius Scato", dynastyId: null, nomen: undefined, cognomen: undefined, praenomen: undefined, ordo: undefined };
    const planted = { ...start, characters: [...start.characters, a] };
    const kept = keepGentes(planted, 12).world;
    expect(kept.gentes.some((gens) => gens.id === "gens-vettius")).toBe(true);
    const made = kept.characters.find((character) => character.id === "marcus-vettius")!;
    expect(made.dynastyId).toBe("gens-vettius");
    expect(made.ordo).toBe("plebeian");
  });
});
