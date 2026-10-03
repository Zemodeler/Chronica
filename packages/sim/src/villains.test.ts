import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, withVices, type CovertPlot, type WorldState } from "@chronica/shared";
import { ensureConstitutions } from "./constitutions";
import { decideVillainy, usurpations } from "./villainy";

/**
 * Villains, played out (docs/plans/a-living-world.md §6). Two hand runs found
 * a world of honourable men; these are the ones who are not, doing what they
 * would.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });
const at = (world: WorldState, day: number): WorldState => ({ ...world, instant: { ...world.instant, day }, elapsedStep: day });

/** The Achaean ruler and one of his officers, the officer made into a man who would kill him. */
function court(): { world: WorldState; rulerId: string; plotterId: string } {
  const world = at(opening(), 400);
  const ruler = readDepartments(world).rulers("achaean-league")[0]!;
  const plotter = world.characters.find((character) => character.polityId === "achaean-league" && character.id !== ruler.id && character.officeId !== null)!;
  const made = {
    ...world,
    characters: world.characters.map((character) => (character.id === plotter.id
      ? { ...character, traits: ["ambitious", "treacherous"], prestigeBps: 9_000, relations: [{ subjectCharacterId: ruler.id, causes: [{ id: "hate", label: "Passed over.", score: -40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -40 } }] }] }
      : character.id === ruler.id ? { ...character, traits: ["content", "paranoid"], healthBps: 4_000 } : character)),
  };
  return { world: made, rulerId: ruler.id, plotterId: plotter.id };
}

describe("villains", () => {
  it("gives people with no nature written for them a vice by their station, and leaves the written alone", () => {
    const world = opening();
    const hanno = world.characters.find((character) => character.id === "hanno-carthage")!;
    expect(withVices(hanno, "ruler")).toBe(hanno);
    const all = punicWarsScenario.initialWorld.characters;
    expect(all.filter((character) => character.traits.includes("cruel")).length).toBeGreaterThan(10);
    expect(all.filter((character) => character.mind.temperament.honesty <= 30).length).toBeGreaterThan(10);
  });

  it("lays a plot against a weak ruler he hates, paid from his own purse", () => {
    const { world, rulerId, plotterId } = court();
    // A chance a month: within a year he moves.
    const laid = Array.from({ length: 12 }, (_, month) => decideVillainy({ world: at(world, 400 + 30 * month), gameId: "villains", playerCharacterId: null, playedByModel: new Set() }))
      .flat().find((decision) => decision.act === "plot");
    expect(laid).toBeDefined();
    expect(laid!.actorCharacterId).toBe(plotterId);
    expect(laid!.deltas[0]).toMatchObject({ op: "covert_plot_open", targetCharacterRef: rulerId, sponsorCharacterRef: plotterId });
    // Nobody the model is playing is moved by the rules.
    const played = Array.from({ length: 12 }, (_, month) => decideVillainy({ world: at(world, 400 + 30 * month), gameId: "villains", playerCharacterId: null, playedByModel: new Set([plotterId]) })).flat();
    expect(played.some((decision) => decision.act === "plot")).toBe(false);
  });

  const plot = (outcome: CovertPlot["outcome"], targetCharacterId: string, sponsorCharacterId: string): CovertPlot => ({
    id: "plot-1", kind: "assassination", targetCharacterId, sponsorCharacterId, agentCharacterId: null, spend: 100, cover: "Foreigners.",
    successOddsBps: 5_000, secrecyBps: 5_000, openedAtStep: 300, resolvesAtStep: 390, storylineId: null, outcome, resolvedAtStep: 390, stirred: true, targetWarned: false,
  });

  it("puts the man whose plot killed his ruler on the throne", () => {
    const { world, rulerId, plotterId } = court();
    const dead = { ...world, covertPlots: [plot("killed", rulerId, plotterId)], characters: world.characters.map((character) => (character.id === rulerId ? { ...character, alive: false, diedAtStep: 390 } : character)) };
    const result = usurpations(dead, null);
    expect(readDepartments(result.world).rulers("achaean-league").map((ruler) => ruler.id)).toContain(plotterId);
    expect(result.facts[0]?.kind).toBe("usurpation");
  });

  it("has a hard ruler put to death the man he caught plotting", () => {
    const { world, rulerId, plotterId } = court();
    const caught = { ...world, covertPlots: [plot("discovered", rulerId, plotterId)] };
    const purge = decideVillainy({ world: caught, gameId: "villains", playerCharacterId: null, playedByModel: new Set() }).find((decision) => decision.act === "purge");
    expect(purge?.deltas[0]).toMatchObject({ op: "character_death", characterRef: plotterId, manner: "execution", byCharacterRef: rulerId });
  });
});
