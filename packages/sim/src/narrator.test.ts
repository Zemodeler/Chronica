import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, isNavalForce, type WorldState } from "@chronica/shared";
import { decideNarratorSeed, decideNarratorSeeds, livePressures, readTension, recordSeedOffered, recordSeedOutcome, recordSeedsOffered, seedWasTaken, type NarratorInput } from "./narrator";

const small = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const large = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** A world whose calendar has run far enough for the first stirring. */
function later(world: WorldState, day: number): WorldState {
  return { ...world, instant: { day, minute: 0 }, elapsedStep: day };
}

function input(world: WorldState, overrides: Partial<NarratorInput> = {}): NarratorInput {
  return { world, gameId: "game-1", ownPolityId: "rome", playerCharacterId: "marcus-atilius", facts: [], ...overrides };
}

describe("reading the ruler's comfort", () => {
  it("stays inside the unit interval on both scenario worlds", () => {
    for (const world of [small(), large()]) {
      const tension = readTension(world, "rome");
      expect(tension.comfort).toBeGreaterThanOrEqual(0);
      expect(tension.comfort).toBeLessThanOrEqual(1);
      expect(tension.summary.length).toBeGreaterThan(0);
    }
  });

  it("falls when debts go unpaid, the war goes badly, and provinces are in distress", () => {
    const calm = large();
    const calmReading = readTension(calm, "rome");

    const troubled: WorldState = {
      ...calm,
      conflicts: { ...calm.conflicts, wars: [{ polityAId: "carthage", polityBId: "rome" }] },
      material: {
        ...calm.material,
        obligations: calm.material.obligations.map((obligation) => ({ ...obligation, missedPeriods: 3 })),
        forces: calm.material.forces.map((force) => (force.polityId === "rome" ? { ...force, moraleBps: 2_000, provisionStatus: "critical" as const } : force)),
        provinceMaterial: calm.material.provinceMaterial.map((material) => ({ ...material, stabilityBps: 1_000 })),
      },
    };
    const troubledReading = readTension(troubled, "rome");
    expect(troubledReading.comfort).toBeLessThan(calmReading.comfort);
    expect(troubledReading.war).toBeLessThan(calmReading.war);
    expect(troubledReading.order).toBeLessThan(calmReading.order);
  });
});

describe("deciding what stirs", () => {
  it("leaves a fresh world alone for the opening orders", () => {
    expect(decideNarratorSeed(input(large()))).toBeNull();
  });

  it("seeds once the cadence has run, and the same seed on a replay", () => {
    const world = later(large(), 40);
    const first = decideNarratorSeed(input(world));
    expect(first).not.toBeNull();
    expect(decideNarratorSeed(input(world))).toEqual(first);
    expect(first!.brief).toContain("[");
    expect(first!.key).toMatch(/^seed-/);
  });

  it("waits again after a seed has been offered", () => {
    const world = later(large(), 40);
    const seed = decideNarratorSeed(input(world))!;
    const offered = recordSeedOutcome(recordSeedOffered(world, seed), seed, true);
    expect(offered.narrator.seedCount).toBe(1);
    expect(decideNarratorSeed(input(later(offered, 45)))).toBeNull();
  });

  it("offers an ignored seed once more under the same key, then moves on", () => {
    const world = later(large(), 40);
    const seed = decideNarratorSeed(input(world))!;
    const ignored = recordSeedOutcome(recordSeedOffered(world, seed), seed, false);
    expect(ignored.narrator.consumed).toBe(false);

    const again = decideNarratorSeed(input(later(ignored, 42)));
    expect(again).not.toBeNull();
    expect(again!.repeated).toBe(true);
    expect(again!.key).toBe(seed.key);

    const dropped = recordSeedOutcome(recordSeedOffered(later(ignored, 42), again!), again!, false);
    expect(dropped.narrator.consumed).toBe(true);
    expect(dropped.narrator.seedCount).toBe(1);
  });

  it("stops starting threads when the world is already following too many, without going quiet", () => {
    const world = later(large(), 40);
    const crowded: WorldState = {
      ...world,
      storylines: Array.from({ length: 12 }, (_, index) => ({
        ...world.storylines[0]!,
        id: `thread-${index}`,
        title: `Thread ${index}`,
      })),
    };
    // Not silence: past the ceiling the world stops starting *threads*, and
    // goes on being a world where the harvest comes in.
    const seed = decideNarratorSeed(input(crowded));
    expect(seed?.oneShot).toBe(true);
  });

  it("lands sometimes at home and sometimes abroad, never in a country being peopled this call", () => {
    const world = later(large(), 40);
    const homes = new Set<boolean>();
    for (let game = 0; game < 60; game += 1) {
      const seed = decideNarratorSeed(input(world, { gameId: `game-${game}` }));
      if (seed === null) continue;
      homes.add(seed.inPlayerRealm);
      if (seed.kind === "world_event") expect(seed.secret).toBe(false);
      if (seed.archetype === "conspiracy") expect(seed.secret).toBe(true);
      if (seed.kind === "person_problem") expect(seed.target.characterId).not.toBe("marcus-atilius");
    }
    expect(homes.size).toBe(2);
  });

  it("knows a seed was taken up by the thread opened under its key, or by news naming its target", () => {
    const world = later(large(), 40);
    const seed = decideNarratorSeed(input(world))!;
    expect(seedWasTaken(world, [], seed)).toBe(false);
    const taken: WorldState = { ...world, storylines: [{ ...world.storylines[0]!, id: "opened", seedKey: seed.key }] };
    expect(seedWasTaken(taken, [], seed)).toBe(true);
  });
});

describe("the age's own pull", () => {
  const pressure = {
    id: "unpaid-mercenaries",
    label: "Carthage fights with hired men and pays them late",
    kind: "world_event" as const,
    brief: "The arrears have come due.",
    weight: 40,
    severity: "grave" as const,
    secret: false,
    oneShot: false,
    when: { politiesExist: ["carthage"], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 0, notAfterDay: null, afterPressureIds: [] },
    target: { polityId: "carthage", provinceId: null, otherPolityId: null },
  };

  it("is available while the world still looks like the condition it names", () => {
    const world = later(large(), 40);
    expect(livePressures(world, [pressure]).map((live) => live.id)).toEqual(["unpaid-mercenaries"]);
  });

  it("is not available once the power it is about is gone", () => {
    const world = later(large(), 40);
    const withoutCarthage: WorldState = {
      ...world,
      map: { ...world.map, polities: world.map.polities.filter((polity) => polity.id !== "carthage") },
    };
    expect(livePressures(withoutCarthage, [pressure])).toEqual([]);
  });

  it("waits for its day, and expires after it", () => {
    const world = later(large(), 40);
    expect(livePressures(world, [{ ...pressure, when: { ...pressure.when, notBeforeDay: 900 } }])).toEqual([]);
    expect(livePressures(world, [{ ...pressure, when: { ...pressure.when, notAfterDay: 10, afterPressureIds: [] } }])).toEqual([]);
  });

  it("only counts a war condition when the war is actually on", () => {
    const world = later(large(), 40);
    const needsWar = { ...pressure, when: { ...pressure.when, atWar: [{ polityId: "rome", otherPolityId: "carthage" }] } };
    expect(livePressures(world, [needsWar])).toEqual([]);
  });

  it("is spent the moment it is offered, so it can never become a rail", () => {
    // A pressure the world declined to act on is one the age pulled toward and
    // did not get. Offering it again until it lands is the definition of a rail.
    const world = later(large(), 40);
    // The pull is a weight, not a schedule, so find a world where it won the roll.
    let seed: ReturnType<typeof decideNarratorSeed> = null;
    let gameId = "";
    for (let game = 0; game < 40 && seed === null; game += 1) {
      gameId = `game-${game}`;
      const candidate = decideNarratorSeed(input(world, { gameId, pressures: [pressure] }));
      if (candidate?.pressureId === "unpaid-mercenaries") seed = candidate;
    }
    expect(seed).not.toBeNull();
    expect(seed!.brief).toBe("The arrears have come due.");
    expect(seed!.target.polityName).toBe("Carthage");

    const after = recordSeedOffered(world, seed!);
    expect(after.narrator.spentPressureIds).toEqual(["unpaid-mercenaries"]);
    expect(livePressures(after, [pressure])).toEqual([]);
  });

  it("leaves the ordinary run of trouble in play", () => {
    // Not a schedule. With one pressure live, most games still meet something
    // that was nobody's plan.
    const world = later(large(), 40);
    const kinds = new Set<string>();
    for (let game = 0; game < 40; game += 1) {
      const seed = decideNarratorSeed(input(world, { gameId: `game-${game}`, pressures: [pressure] }));
      if (seed !== null) kinds.add(seed.pressureId === null ? "ordinary" : "pressure");
    }
    expect(kinds.has("ordinary")).toBe(true);
    expect(kinds.has("pressure")).toBe(true);
  });
});

describe("how much stirs in a season", () => {
  it("sizes the batch on the season the burst will cover, not the morning it starts in", () => {
    // A live run made this plain: one order carried the world ninety days and
    // nothing stirred in any of them, because the order before it had stirred
    // the world that same morning. The narrator is asked once, at the top of
    // a burst, and the burst is the thing that moves time.
    const world = large();
    const sameMorning = { ...world, narrator: { ...world.narrator, lastSeedDay: 45, seedCount: 3, lastSeedKey: "seed-x", consumed: true } };
    expect(decideNarratorSeeds(input(later(sameMorning, 45)))).toEqual([]);
    expect(decideNarratorSeeds(input(later(sameMorning, 45), { spanDays: 90 })).length).toBeGreaterThanOrEqual(3);
  });

  it("offers a month's worth, not one thing, and never the same thing twice", () => {
    // A burst covers a season and used to carry exactly one stirring, so a
    // record of three months came back with two entries, both of them the
    // player's own business.
    const seeds = decideNarratorSeeds(input(later(large(), 45)));
    expect(seeds.length).toBeGreaterThanOrEqual(3);
    expect(seeds.length).toBeLessThanOrEqual(6);
    expect(new Set(seeds.map((seed) => seed.key)).size).toBe(seeds.length);
  });

  it("offers more after a long silence than after a short one", () => {
    const soon = decideNarratorSeeds(input(later(large(), 40)));
    const world = later(large(), 200);
    const long = decideNarratorSeeds(input({ ...world, narrator: { ...world.narrator, lastSeedDay: 0, seedCount: 1, lastSeedKey: "seed-x", consumed: true } }));
    expect(long.length).toBeGreaterThanOrEqual(soon.length);
  });

  it("holds its peace until the cadence has run", () => {
    const world = later(large(), 12);
    expect(decideNarratorSeeds(input({ ...world, narrator: { ...world.narrator, lastSeedDay: 10, seedCount: 2, lastSeedKey: "seed-x", consumed: true } }))).toEqual([]);
  });

  it("is the same batch for the same world, and a different one for a different game", () => {
    const world = later(large(), 45);
    expect(decideNarratorSeeds(input(world)).map((seed) => seed.key))
      .toEqual(decideNarratorSeeds(input(world)).map((seed) => seed.key));
    expect(decideNarratorSeeds(input(world)).map((seed) => seed.archetype))
      .not.toEqual(decideNarratorSeeds(input(world, { gameId: "game-elsewhere" })).map((seed) => seed.archetype));
  });

  it("advances the ordinal past the whole batch, so next season is new", () => {
    const world = later(large(), 45);
    const seeds = decideNarratorSeeds(input(world));
    const after = recordSeedsOffered(world, seeds);
    expect(after.narrator.seedCount).toBe(world.narrator.seedCount + seeds.length);
    expect(after.narrator.consumed).toBe(true);
    const next = decideNarratorSeeds(input(later(after, 120)));
    expect(next.map((seed) => seed.key).some((key) => seeds.some((seed) => seed.key === key))).toBe(false);
  });

  it("carries a war between two powers that can actually reach each other", () => {
    // Nothing in the table could ever open one: a whole match ran with a
    // single war in it, and that one only because a rebellion seceded.
    const world = large();
    const found = Array.from({ length: 60 }, (_, index) =>
      decideNarratorSeeds(input(later(world, 45), { gameId: `game-war-${index}` })))
      .flat()
      .find((seed) => seed.archetype === "war");
    expect(found).toBeDefined();
    if (found === undefined) return;
    expect(found.target.polityId).not.toBeNull();
    expect(found.target.otherPolityId).not.toBeNull();
    expect(found.target.otherPolityId).not.toBe(found.target.polityId);
    expect(found.brief).toContain('"agreement_open"');
    // Both parties are named by id, so the orchestrator never invents one.
    expect(found.brief).toContain(found.target.otherPolityId!);
    expect(found.brief).toContain(found.target.polityId!);
  });

  it("goes on making ordinary business while a war is on", () => {
    // A war used to collapse the table onto people's private troubles: every
    // new_actor was halved and world events lost their bonus, because the
    // bonus was for a comfortable reign and war is what makes a reign
    // uncomfortable. The record of a season at war became one man's defence,
    // filed four times running.
    const peace = large();
    const war: WorldState = { ...peace, conflicts: { ...peace.conflicts, wars: [{ polityAId: "rome", polityBId: "carthage" }] } };
    const quiet = new Set(["harvest", "games", "building", "market", "strangers", "omen", "cult"]);
    const count = (world: WorldState): number =>
      Array.from({ length: 30 }, (_, index) => decideNarratorSeeds(input(later(world, 45), { gameId: `game-atwar-${index}` })))
        .flat()
        .filter((seed) => quiet.has(seed.archetype)).length;
    expect(count(war)).toBeGreaterThan(0);
    expect(count(war)).toBeGreaterThanOrEqual(Math.round(count(peace) * 0.6));
  });

  it("makes ordinary business too, not only trouble", () => {
    const quiet = new Set(["harvest", "games", "building", "market", "strangers", "omen"]);
    const world = large();
    const archetypes = Array.from({ length: 40 }, (_, index) =>
      decideNarratorSeeds(input(later(world, 45), { gameId: `game-quiet-${index}` })))
      .flat()
      .map((seed) => seed.archetype);
    expect(archetypes.some((name) => quiet.has(name))).toBe(true);
  });
});

describe("an age that arrives in order", () => {
  it("holds a pressure back until the one it follows has been put to the world", () => {
    const world = later(large(), 400);
    const first = { id: "the-asking", label: "a", kind: "world_event" as const, brief: "b", weight: 10, severity: "serious" as const, secret: false, oneShot: false,
      when: { politiesExist: [], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 0, notAfterDay: null, afterPressureIds: [] },
      target: { polityId: "rome", provinceId: null, otherPolityId: null } };
    const second = { ...first, id: "the-answering", when: { ...first.when, afterPressureIds: ["the-asking"] } };

    expect(livePressures(world, [first, second]).map((pressure) => pressure.id)).toEqual(["the-asking"]);
    const asked: WorldState = { ...world, narrator: { ...world.narrator, spentPressureIds: ["the-asking"] } };
    expect(livePressures(asked, [first, second]).map((pressure) => pressure.id)).toEqual(["the-answering"]);
  });
});

describe("trouble that lands on an army", () => {
  /** Runs the whole deck deterministically by walking the seed ordinal. */
  function everySeed(world: WorldState, overrides: Partial<NarratorInput> = {}): ReturnType<typeof decideNarratorSeeds> {
    const seeds = [];
    for (let day = 40; day < 4_000; day += 40) {
      const at = later(world, day);
      seeds.push(...decideNarratorSeeds(input({ ...at, narrator: { ...at.narrator, lastSeedDay: null, seedCount: day } }, overrides)));
    }
    return seeds;
  }

  it("can reach a force at all, which it never could before", () => {
    // Trouble could name a province, a power or a person and nothing else, so
    // an army was the one thing in the world only a battle could touch.
    const world = large();
    expect(world.material.forces.length).toBeGreaterThan(0);
    const onForces = everySeed(world).filter((seed) => seed.target.forceId !== null);
    expect(onForces.length).toBeGreaterThan(0);
    for (const seed of onForces) {
      // Named with its id, so the brief can be carried out against it.
      expect(seed.brief).toContain(seed.target.forceId!);
      expect(world.material.forces.some((force) => force.id === seed.target.forceId)).toBe(true);
    }
  });

  it("puts the commander in the way of it, so somebody has to answer", () => {
    const world = large();
    for (const seed of everySeed(world).filter((entry) => entry.target.forceId !== null)) {
      const force = world.material.forces.find((candidate) => candidate.id === seed.target.forceId)!;
      expect(seed.target.characterId).toBe(force.commanderCharacterId);
      expect(seed.target.provinceId).toBe(force.locationId);
    }
  });

  it("never catches a legion in a storm at sea", () => {
    const world = large();
    const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
    for (const seed of everySeed(world, { warfare: definition.warfare })) {
      if (seed.archetype !== "storm_at_sea") continue;
      const force = world.material.forces.find((candidate) => candidate.id === seed.target.forceId)!;
      expect(isNavalForce(force, definition.warfare)).toBe(true);
    }
  });

  it("offers no storm at all when nothing on the map floats", () => {
    // Told no rules of war, nothing is naval -- and a brief about a fleet that
    // does not exist would be carried out anyway, on nobody.
    const world = large();
    expect(everySeed(world, { warfare: undefined }).some((seed) => seed.archetype === "storm_at_sea")).toBe(false);
  });
});
