import { describe, expect, it } from "vitest";
import { adoptedRomanName, daughterName, parseRomanName, praenomenForSon } from "@chronica/shared";
import { bearChild } from "./births";
import { named, opening } from "./gentes-test-kit";

/**
 * A Roman child had his father's gens and, by his birth, the father's order; a second son did not take his elder brother's given
 * name, nor a daughter a name of her own: she was her father's nomen in the feminine, and among sisters the elder and the younger.
 */
describe("a Roman child is named as Romans were", () => {
  const world = opening();

  it("is of the father's gens and order, with the parts of his name", () => {
    const mother = named(world, "Sulpicia");
    const born = bearChild(world, mother, 400, () => true)!;
    expect(born).not.toBeNull();
    const child = born.world.characters.find((character) => character.id === born.childId)!;
    expect(child.dynastyId).toBe("gens-cornelius");
    expect(child.ordo).toBe("patrician");
    expect(child.nomen).toBe("Cornelius");
    // Blasio has a son the Younger and a daughter Cornelia: the third child is a second son or a second daughter.
    if (child.gender === "male") {
      expect(child.name).toBe("Publius Cornelius Blasio");
      expect(child.praenomen).toBe("Publius");
    } else {
      expect(child.name).toMatch(/^Cornelia Minor, daughter of Gnaeus Cornelius Blasio/);
    }
  });

  it("gives the eldest son his father's names, then the gens's own given names in turn", () => {
    expect(praenomenForSon("Cornelius", "Gnaeus", [])).toBe("Gnaeus");
    expect(praenomenForSon("Cornelius", "Gnaeus", ["Gnaeus"])).toBe("Publius");
    expect(praenomenForSon("Cornelius", "Gnaeus", ["Gnaeus", "Publius"])).toBe("Lucius");
    expect(praenomenForSon("Fabius", "Quintus", ["Quintus"])).toBe("Marcus");
    expect(praenomenForSon("Unknownius", "Gaius", ["Gaius"])).toBe("Lucius");
    expect(daughterName("Cornelius", 0)).toBe("Cornelia");
    expect(daughterName("Cornelius", 1)).toBe("Cornelia Minor");
  });

  it("names an adopted man as the Scipio of Aemilius's line was: the adopter's three names, and his old nomen as -ianus", () => {
    const scipio = parseRomanName("Publius Cornelius Scipio");
    const aemilius = parseRomanName("Lucius Aemilius Paullus");
    expect(adoptedRomanName(scipio, aemilius, "Lucius Aemilius Paullus")).toBe("Publius Cornelius Scipio Aemilianus");
    // A man who has no Roman name takes his own as it stands.
    expect(adoptedRomanName({ praenomen: null, nomen: null, cognomen: null }, aemilius, "Lucius Aemilius Paullus")).toBe("Lucius Aemilius Paullus");
  });

  it("reads a woman's name as her father's gens", () => {
    expect(parseRomanName("Aemilia the Vestal").nomen).toBe("Aemilius");
    expect(parseRomanName("Cornelia Blasionis").nomen).toBe("Cornelius");
    expect(parseRomanName("Hanno of Carthage").nomen).toBeNull();
    expect(parseRomanName("Gaius Genucius Clepsina")).toEqual({ praenomen: "Gaius", nomen: "Genucius", cognomen: "Clepsina" });
  });
});
