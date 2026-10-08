import { describe, expect, it } from "vitest";
import { CENSORS_300_TO_265, CONSULS_366_TO_270 } from "@chronica/db";
import { gensById, gensIdOfNomen, parseRomanName } from "@chronica/shared";
import { keepGentes } from "./gentes";
import { named, opening } from "./gentes-test-kit";

/**
 * The opening's families are the history's: the consuls of the gentes are the fasti's (docs/plans/gentes.md), nobody is there who was not
 * yet born, and every named Roman is of a gens.
 */
describe("the roster is historical", () => {
  const world = opening();

  it("counts each gens's consulships to the fasti, name by name", () => {
    const wanted = new Map<string, number>();
    for (const [, names] of CONSULS_366_TO_270) {
      for (const name of names) {
        const nomen = parseRomanName(name).nomen!;
        wanted.set(gensIdOfNomen(nomen), (wanted.get(gensIdOfNomen(nomen)) ?? 0) + 1);
      }
    }
    for (const [id, count] of wanted) expect(gensById(world, id)?.honours.filter((honour) => honour.kind === "consul").length, id).toBe(count);
    // The fasti are two a year: 366 to 270 is 97 years, less the dictator years the table leaves out.
    expect(CONSULS_366_TO_270.length).toBeGreaterThanOrEqual(90);
    const total = [...wanted.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(CONSULS_366_TO_270.reduce((sum, [, names]) => sum + names.length, 0));
  });

  it("gets the counts of the great gentes right, as Broughton has them to 270", () => {
    const consuls = (id: string): number => gensById(world, id)!.honours.filter((honour) => honour.kind === "consul").length;
    expect(consuls("gens-fabius")).toBe(13);
    expect(consuls("gens-cornelius")).toBe(15);
    expect(consuls("gens-valerius")).toBe(13);
    expect(consuls("gens-curius")).toBe(3);
    expect(consuls("gens-fabricius")).toBe(2);
    expect(consuls("gens-caecilius")).toBe(1);
    expect(consuls("gens-decius")).toBe(6);
    expect(consuls("gens-genucius")).toBe(7);
    expect(CENSORS_300_TO_265.length).toBeGreaterThanOrEqual(8);
    expect(gensById(world, "gens-cornelius")!.honours.filter((honour) => honour.kind === "censor").length).toBe(3);
  });

  it("opens with the consuls of 270 sitting as their gens's own men", () => {
    for (const [name, gens] of [["Gaius Genucius Clepsina", "gens-genucius"], ["Gnaeus Cornelius Blasio", "gens-cornelius"]] as const) {
      const man = named(world, name);
      expect(gensById(world, gens)!.honours.some((honour) => honour.characterId === man.id && honour.atStep === 0)).toBe(true);
    }
    // A father's consulships are not his son's: the character Papirius Cursor holds only the one of 272.
    const papirius = named(world, "Lucius Papirius Cursor");
    expect(gensById(world, "gens-papirius")!.honours.filter((honour) => honour.characterId === papirius.id).map((honour) => honour.atStep)).toEqual([-2 * 365]);
  });

  it("has nobody who was not yet born, and nobody famous from later in a place he was not", () => {
    const names = world.characters.map((character) => character.name);
    for (const later of ["Publius Cornelius Scipio Africanus", "Scipio Africanus", "Hannibal Barca", "Marcus Claudius Marcellus", "Cato", "Gelon II", "Hieronymus", "Antiochus III"]) {
      expect(names.some((name) => name.includes(later)), later).toBe(false);
    }
    // Hamilcar Barca is a boy of five; the Cunctator a boy of ten.
    expect(named(world, "Hamilcar Barca").ageYearsAtStart).toBe(5);
    expect(named(world, "Quintus Fabius Maximus Verrucosus").ageYearsAtStart).toBe(10);
    // The Scipiones alive are Barbatus and the next generation; Africanus's grandfather's generation is not yet grown.
    const scipiones = world.characters.filter((character) => /Cornelius Scipio/.test(character.name)).map((character) => character.name).sort();
    expect(scipiones).toEqual(["Gnaeus Cornelius Scipio Asina", "Lucius Cornelius Scipio", "Lucius Cornelius Scipio Barbatus"]);
  });

  it("gives every named Roman a gens, once the first month has been looked at", () => {
    const kept = keepGentes({ ...world, instant: { ...world.instant, day: 31 }, elapsedStep: 31 }, 31).world;
    const romans = kept.characters.filter((character) => character.polityId === "rome" && parseRomanName(character.name).nomen !== null);
    expect(romans.length).toBeGreaterThan(80);
    for (const roman of romans) {
      expect(roman.dynastyId, roman.name).not.toBeNull();
      expect(kept.gentes.some((gens) => gens.id === roman.dynastyId), roman.name).toBe(true);
      expect(roman.ordo, roman.name).toBeDefined();
    }
  });

  it("reads the order from the gens: the Claudii Caninae and the Scipiones Asinae are patricians, and a Vestal of the Fabii is of her gens's order", () => {
    expect(named(world, "Gaius Claudius Canina").ordo).toBe("patrician");
    expect(named(world, "Fabia the Vestal").ordo).toBe("patrician");
    expect(named(world, "Licinia the Vestal").ordo).toBe("plebeian");
    expect(named(world, "Gnaeus Cornelius Scipio Asina").ordo).toBe("patrician");
    expect(named(world, "Manius Curius Dentatus").ordo).toBe("plebeian");
  });

  it("marks every added person as historical or invented, with a reason", () => {
    const added = world.characters.filter((character) => /rome-gens-|-gens-/.test(character.id));
    expect(added.length).toBeGreaterThanOrEqual(35);
    for (const person of added) expect(person.creationReason, person.name).toMatch(/^(Historical|Invented)/);
    expect(added.length).toBeLessThanOrEqual(70);
  });

  it("gives the kings their heirs where the sources name them, and no heir where they do not", () => {
    expect(named(world, "Ptolemy II Philadelphus").heirCharacterId).toBe(named(world, "Ptolemy son of Ptolemy").id);
    expect(named(world, "Antigonus Gonatas").heirCharacterId).toBe(named(world, "Demetrius son of Antigonus").id);
    // Hiero has no child by 270, and the Seleucid co-regent is left unwritten.
    expect(named(world, "Hieron II").heirCharacterId).toBeNull();
    expect(gensById(world, "gens-hieronid")!.kind).toBe("royal");
    expect(gensById(world, "gens-barca")!.kind).toBe("noble");
  });
});
