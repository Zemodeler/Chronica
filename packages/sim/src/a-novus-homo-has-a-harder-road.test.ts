import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { NOVUS_BPS, ScenarioDefinitionSchema, candidateScore, gensById, nobilitasBps, nobilitasOf, nobilitasWeightBps, type Character, type WorldState } from "@chronica/shared";
import { named, opening } from "./gentes-test-kit";

/**
 * A man whose forefathers sat in the consul's chair stood for it with their images behind him; a new man had only himself.
 * The electors' reckoning of a man (`candidateScore`) now carries his name, in basis points of the scale: for the consulship in
 * full, for the praetorship by seven tenths, the aedileship by four, the quaestorship by a quarter, and the tribunate (the
 * plebs' own) by a tenth.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const office = (id: string) => definition.government.offices.find((candidate) => candidate.id === id)!;

/** Two men of the same standing: only their names differ. */
function equalised(world: WorldState, a: string, b: string, prestigeBps = 8_000): { world: WorldState; a: Character; b: Character } {
  const next: WorldState = { ...world, characters: world.characters.map((character) => (character.name === a || character.name === b ? { ...character, prestigeBps } : character)) };
  return { world: next, a: named(next, a), b: named(next, b) };
}

describe("a novus homo has a harder road", () => {
  const start = opening();

  it("reads Curius and Fabricius as new men, and a Fabius as a nobilis with six or more consulships of his branch behind him", () => {
    expect(nobilitasOf(start, named(start, "Manius Curius Dentatus"))).toMatchObject({ tier: "novus", inStirps: 0, inGens: 0, own: 3 });
    expect(nobilitasOf(start, named(start, "Gaius Fabricius Luscinus")).tier).toBe("novus");
    expect(nobilitasOf(start, named(start, "Tiberius Coruncanius")).tier).toBe("novus");
    const fabius = nobilitasOf(start, named(start, "Quintus Fabius Maximus Verrucosus"));
    expect(fabius.tier).toBe("nobilis");
    expect(fabius.stirps).toBe("Maximus");
    expect(fabius.inStirps).toBeGreaterThanOrEqual(6);
    // A man of a gens that has consuls but not in his own branch is a lesser noble.
    expect(nobilitasOf(start, named(start, "Gnaeus Cornelius Blasio")).tier).toBe("gentilis");
  });

  it("gives the same standing a different score by the name: the new man loses six hundred, the Fabius gains sixteen hundred and his gens's weight", () => {
    const { world, a: curius, b: fabius } = equalised(start, "Manius Curius Dentatus", "Quintus Fabius Maximus Verrucosus");
    const consul = office("roman-consul");
    const novus = candidateScore(consul, curius, 0, world);
    const nobilis = candidateScore(consul, fabius, 0, world);
    expect(novus).toBe(8_000 + nobilitasBps(world, curius));
    expect(nobilitasBps(world, curius)).toBe(NOVUS_BPS + Math.min(500, Math.round(gensById(world, "gens-curius")!.dignitasBps / 20)));
    expect(nobilitasBps(world, fabius)).toBe(1_600 + Math.min(500, Math.round(gensById(world, "gens-fabius")!.dignitasBps / 20)));
    expect(nobilis - novus).toBeGreaterThanOrEqual(2_000);
    // Without the gentes, as in a world made before them, the electors count standing alone.
    expect(candidateScore(consul, curius, 0)).toBe(8_000);
  });

  it("weighs the name less for the lesser offices, and hardly at all for the tribunate", () => {
    const { world, a: curius, b: fabius } = equalised(start, "Manius Curius Dentatus", "Quintus Fabius Maximus Verrucosus");
    const gap = (officeId: string): number => candidateScore(office(officeId), fabius, 0, world) - candidateScore(office(officeId), curius, 0, world);
    const consul = gap("roman-consul");
    expect(Math.abs(gap("roman-praetor") - Math.round(consul * 0.7))).toBeLessThanOrEqual(1);
    expect(gap("roman-aedile")).toBeLessThan(gap("roman-praetor"));
    expect(gap("roman-quaestor")).toBeLessThan(gap("roman-aedile"));
    expect(gap("roman-tribune")).toBeLessThan(gap("roman-quaestor"));
    expect(nobilitasWeightBps(office("roman-consul"))).toBe(10_000);
    expect(nobilitasWeightBps(office("roman-tribune"))).toBe(1_000);
  });

  it("can turn a close race: a new man a little the better in standing loses the consulship to a noble a little the worse, but not to a much worse one", () => {
    const base = equalised(start, "Manius Curius Dentatus", "Quintus Fabius Maximus Verrucosus").world;
    const set = (curius: number, fabius: number): WorldState => ({
      ...base, characters: base.characters.map((character) => (character.name === "Manius Curius Dentatus" ? { ...character, prestigeBps: curius } : character.name === "Quintus Fabius Maximus Verrucosus" ? { ...character, prestigeBps: fabius } : character)),
    });
    const consul = office("roman-consul");
    const close = set(9_000, 7_500);
    expect(candidateScore(consul, named(close, "Manius Curius Dentatus"), 0, close)).toBeLessThan(candidateScore(consul, named(close, "Quintus Fabius Maximus Verrucosus"), 0, close));
    const far = set(9_000, 5_000);
    expect(candidateScore(consul, named(far, "Manius Curius Dentatus"), 0, far)).toBeGreaterThan(candidateScore(consul, named(far, "Quintus Fabius Maximus Verrucosus"), 0, far));
  });

  it("is deterministic: the same world gives the same score every time", () => {
    const consul = office("roman-consul");
    const scores = (): number[] => start.characters.filter((character) => character.dynastyId !== null).map((character) => candidateScore(consul, character, 0, start));
    expect(scores()).toEqual(scores());
  });
});
