import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, modernWordsIn, readYourGens } from "@chronica/shared";
import { GensSheet } from "./gens-sheet";

/**
 * Your gens, drawn from the Punic opening as a Roman reads it: the name, what it is worth, the images, the rites, the kin, the friends by
 * marriage and the feuds, in the age's words; and nothing for a man who is of no gens.
 */
const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("your gens", () => {
  it("is read for a noble: his name, branch, the first man, the rites and the kin", () => {
    const reading = readYourGens(world, "gnaeus-cornelius")!;
    expect(reading.name).toBe("the Cornelii");
    expect(reading.kindLabel).toBe("A patrician gens");
    expect(reading.you).toMatch(/Gnaeus Cornelius Blasio of the Cornelii, of the branch of the Blasiones/);
    expect(reading.nobilitas.label).toBe("Of a noble gens");
    expect(reading.head?.name).toBe("Publius Cornelius Arvina");
    expect(reading.members.some((member) => member.note === "your wife")).toBe(true);
    expect(reading.members[0]!.you).toBe(true);
    const html = renderToStaticMarkup(<GensSheet gens={reading} />);
    expect(html).toContain("The Cornelii");
    expect(html).toContain("Your kin");
    expect(html).toContain("Sulpicia");
    expect(html).toContain("your daughter");
    expect(html).toContain("Friends by marriage");
    expect(html).toContain("Feuds");
    expect(html).toContain("tomb of the Scipiones");
    expect(html).toContain("an image in the atrium");
  });

  it("calls Curius a new man, and says his sons will be nobles", () => {
    const reading = readYourGens(world, "manius-curius")!;
    expect(reading.nobilitas.label).toBe("A new man");
    expect(reading.nobilitas.sentence).toMatch(/first of it/);
    expect(reading.yourHonours).toMatch(/consul/);
    const html = renderToStaticMarkup(<GensSheet gens={reading} />);
    expect(html).toContain("A new man.");
  });

  it("says the Fabii's rites are kept in the gens, and who keeps them", () => {
    const reading = readYourGens(world, "quintus-fabius")!;
    expect(reading.sacra[0]).toMatch(/Quirinal/);
    const html = renderToStaticMarkup(<GensSheet gens={reading} />);
    expect(html).toContain("they stay in the gens");
    // And the grudge the Fabii hold against the Claudii is on the page, with its reason.
    expect(html).toContain("The Claudii");
    expect(html).toContain("freedmen");
  });

  it("is read for a king and for a Carthaginian in the words of a house, with no consuls", () => {
    const hieron = readYourGens(world, "hieron-ii")!;
    expect(hieron.kindLabel).toBe("A royal house");
    expect(hieron.nobilitas.label).toBe("Of the royal house");
    const hanno = readYourGens(world, "hanno-carthage")!;
    expect(hanno.kindLabel).toBe("A great house");
    expect(hanno.honours).toEqual([]);
  });

  it("is nothing for a man of no gens", () => {
    expect(readYourGens(world, "mamertine-spokesman")).toBeNull();
    expect(readYourGens(world, "nobody-at-all")).toBeNull();
  });

  it("uses no modern word anywhere on the page", () => {
    for (const id of ["gnaeus-cornelius", "manius-curius", "quintus-fabius", "hieron-ii", "hanno-carthage"]) {
      const html = renderToStaticMarkup(<GensSheet gens={readYourGens(world, id)!} />);
      expect(modernWordsIn(html.replace(/<[^>]+>/g, " ")), id).toEqual([]);
    }
  });
});
