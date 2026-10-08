import { describe, expect, it } from "vitest";
import { familyLinksOf, gensById, nobilitasOf, type WorldState } from "@chronica/shared";
import { ADOPTER_AT_LEAST_YEARS_OLDER, adoptIntoGens, adoptionBar, aGensKeepsItsName } from "./adoption";
import { keepGentes } from "./gentes";
import { killCharacter } from "./mortality";
import { named, opening, withDay } from "./gentes-test-kit";

/**
 * Publius Cornelius Scipio Aemilianus was born an Aemilius. An adoption gives a man the adopter's names, his gens, his rites and his
 * images, and an estate as a son's; it is refused where Rome refused it (a plebeian into a patrician gens, a man who has a son).
 */
describe("an adoption carries the name", () => {
  const start = opening();
  const lepidus = named(start, "Marcus Aemilius Lepidus");
  const flaccus = named(start, "Lucius Valerius Flaccus");

  it("makes a Valerius an Aemilius with the adopter's praenomen and his old nomen as -ianus", () => {
    expect(ADOPTER_AT_LEAST_YEARS_OLDER).toBe(18);
    const done = adoptIntoGens(start, lepidus.id, flaccus.id, 100);
    expect("bar" in done).toBe(false);
    if ("bar" in done) return;
    expect(done.adopteeName).toBe("Marcus Aemilius Lepidus Valerianus");
    const son = done.world.characters.find((character) => character.id === flaccus.id)!;
    expect([son.praenomen, son.nomen, son.cognomen]).toEqual(["Marcus", "Aemilius", "Lepidus Valerianus"]);
    expect(son.dynastyId).toBe("gens-aemilius");
    expect(son.ordo).toBe("patrician");
    // He has the gens's name behind him: his own branch's consul (Lepidus, 285), and the fasti's others of the gens.
    const nobilitas = nobilitasOf(done.world, son);
    expect(nobilitas.tier).toBe("nobilis");
    expect(nobilitas.stirps).toBe("Lepidus");
    // The adopter has an heir; the family graph and the contract say so.
    expect(done.world.characters.find((character) => character.id === lepidus.id)!.heirCharacterId).toBe(flaccus.id);
    expect(familyLinksOf(done.world, lepidus.id).some((view) => view.kind === "parent" && view.counterpartCharacterId === flaccus.id)).toBe(true);
    expect(done.world.lifeContracts.some((contract) => contract.type === "adoption_or_heir_designation" && contract.partyCharacterIds.includes(flaccus.id))).toBe(true);
    expect(done.facts[0]!.summary).toMatch(/Valerianus/);
  });

  it("carries the estate to him as a son's when the adopter dies", () => {
    const done = adoptIntoGens(start, lepidus.id, flaccus.id, 100);
    if ("bar" in done) throw new Error(done.bar);
    const purse = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === world.characters.find((character) => character.id === id)!.personalAccountId)!.balance;
    const before = purse(done.world, flaccus.id);
    const dead = killCharacter(withDay(done.world, 200), lepidus.id, "a fever", 200).world;
    expect(purse(dead, flaccus.id)).toBeGreaterThan(before);
  });

  it("enters the gens: the monthly pass counts him among its men", () => {
    const done = adoptIntoGens(start, lepidus.id, flaccus.id, 100);
    if ("bar" in done) throw new Error(done.bar);
    const kept = keepGentes(withDay(done.world, 200), 200).world;
    expect(kept.characters.filter((character) => character.dynastyId === "gens-aemilius" && character.alive).some((character) => character.id === flaccus.id)).toBe(true);
    expect(gensById(kept, "gens-valerius")!.princepsId).not.toBe(flaccus.id);
  });

  it("is refused where Rome refused it", () => {
    // A patrician gens does not take a plebeian.
    expect(adoptionBar(start, lepidus, named(start, "Gaius Aquillius Florus"), 100)).toMatch(/does not take a plebeian/);
    // A plebeian gens does not take a patrician, who does not go over to the plebs by adoption.
    expect(adoptionBar(start, named(start, "Gaius Junius Bubulcus Brutus"), flaccus, 100)).toMatch(/does not take a patrician/);
    // A man with a son of his own does not adopt.
    expect(adoptionBar(start, named(start, "Quintus Fabius Maximus Gurges"), named(start, "Lucius Aemilius Papus"), 100)).toMatch(/son of his own/);
    // The adopter must be eighteen years the elder.
    expect(adoptionBar(start, named(start, "Lucius Cornelius Scipio"), flaccus, 100)).toMatch(/years older|too young/);
    // A woman is neither.
    expect(adoptionBar(start, lepidus, named(start, "Sulpicia"), 100)).toMatch(/only a man/);
    // Nor the same gens.
    expect(adoptionBar(start, lepidus, named(start, "Lucius Aemilius Papus"), 100)).toMatch(/of the gens already/);
  });

  it("is rare: across thirty years, childless first men adopt only a few times", () => {
    let world = withDay(start, 0);
    let adopted = 0;
    for (let year = 1; year <= 30; year += 1) {
      const result = aGensKeepsItsName(world, year * 365);
      adopted += result.facts.filter((fact) => fact.kind === "adoption").length;
      world = result.world;
    }
    expect(adopted).toBeLessThanOrEqual(8);
  });
});
