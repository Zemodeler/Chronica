import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modernWordsIn } from "@chronica/shared";
import { keepGentes } from "./gentes";
import { adoptIntoGens } from "./adoption";
import { named, opening, withDay } from "./gentes-test-kit";

/**
 * The noble families are spoken of in the words of the age: gens, stirps, nobilitas, imagines, sacra, clients, a feud, an alliance by
 * marriage. No "house" for a trading firm (a firm is a firm), no modern apparatus. This scans what the gentes say: their names, notes,
 * rites, the reasons of their feuds, the reasons the seed gives for each person added, the news they make, and the files that write them.
 */
const FILES = [
  "../../shared/src/world/gentes.ts",
  "../../shared/src/characters/roman-names.ts",
  "../../shared/src/characters/gens-standing.ts",
  "../../shared/src/authority/your-gens.ts",
  "./gentes.ts",
  "./adoption.ts",
  "./gens-loyalty.ts",
  "../../db/src/punic-wars-gentes.ts",
  "../../db/src/punic-wars-fasti.ts",
];

describe("the gentes keep to the words of the age", () => {
  const world = opening();

  it("says nothing modern in the records the world holds", () => {
    const lines: string[] = [];
    for (const gens of world.gentes) {
      lines.push(gens.plural, gens.nomen, gens.note ?? "", ...gens.sacra, gens.tomb ?? "");
      for (const feud of gens.feuds) lines.push(feud.reason);
    }
    for (const character of world.characters) if (/-gens-/.test(character.id)) lines.push(character.creationReason ?? "");
    expect(lines.filter((line) => line.length > 0).length).toBeGreaterThan(100);
    expect(lines.flatMap((line) => modernWordsIn(line).map((word) => `${word}: ${line}`))).toEqual([]);
  });

  it("says nothing modern in the news they make: an adoption, a feud, a new first man, a new heir", () => {
    const lepidus = named(world, "Marcus Aemilius Lepidus");
    const done = adoptIntoGens(world, lepidus.id, named(world, "Lucius Valerius Flaccus").id, 100);
    if ("bar" in done) throw new Error(done.bar);
    const kept = keepGentes(withDay(world, 31), 31);
    const lines = [...done.facts, ...kept.facts].map((fact) => fact.summary);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.flatMap((line) => modernWordsIn(line).map((word) => `${word}: ${line}`))).toEqual([]);
  });

  it("calls no noble family a house of business, and no firm a gens, in the text written for them", () => {
    for (const gens of world.gentes) expect(gens.plural, gens.id).not.toMatch(/\bfirm\b|\bcompany\b|\bsocietas\b/i);
  });

  it("says nothing modern in the files that write them, comments and all", () => {
    const found = FILES.flatMap((file) => modernWordsIn(readFileSync(new URL(file, import.meta.url), "utf8")).map((word) => `${file}: ${word}`));
    expect(found).toEqual([]);
  });
});
