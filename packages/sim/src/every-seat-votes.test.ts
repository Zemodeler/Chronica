import { describe, expect, it } from "vitest";
import { NEUTRAL_MIND, type CharacterMind, type GovernmentInstitution, type PoliticalProcedure } from "@chronica/shared";
import { ballotsOfBloc, mindLean, votesBySeat, type Seat } from "./ballots";

const mind = (temperament: Partial<CharacterMind["temperament"]>, drives: Partial<CharacterMind["drives"]> = {}): CharacterMind =>
  ({ ...NEUTRAL_MIND, temperament: { ...NEUTRAL_MIND.temperament, ...temperament }, drives: { ...NEUTRAL_MIND.drives, ...drives } });
const seat = (id: string, m: CharacterMind, characterId: string | null = id): Seat => ({ id, name: id, characterId, mind: m });
const bloc: { yesThreshold: number; noThreshold: number; groupId: string | null } = { yesThreshold: 15, noThreshold: -15, groupId: null };
const factional = { ...bloc, groupId: "faction-1" };
const question = (id = "q1"): PoliticalProcedure => ({ id } as PoliticalProcedure);

describe("every seat of every chamber votes for itself", () => {
  it("is true of councils and of assemblies of the people", () => {
    for (const franchise of ["council", "citizens", "soldiers", "chiefs", "priests", "cities"] as const) {
      expect(votesBySeat({ franchise } as GovernmentInstitution)).toBe(true);
    }
  });

  it("lets a bold man vote for a war and a cautious one against it, in the same bloc on the same day", () => {
    const hawk = mind({ boldness: 95, caution: 5 }, { status: 85 });
    const dove = mind({ boldness: 5, caution: 95 }, { status: 20 });
    expect(mindLean(hawk, ["war"])).toBeGreaterThan(10);
    expect(mindLean(dove, ["war"])).toBeLessThan(-10);
    const ballots = ballotsOfBloc([seat("hawk", hawk), seat("dove", dove)], bloc, 0, question(), ["war"], new Map());
    expect(ballots.find((b) => b.seat.id === "hawk")!.choice).toBe("yes");
    expect(ballots.find((b) => b.seat.id === "dove")!.choice).toBe("no");
  });

  it("votes the rich against taxes and the pious for the gods", () => {
    expect(mindLean(mind({}, { wealth: 95 }), ["taxes"])).toBeLessThan(-4);
    expect(mindLean(mind({}, { wealth: 5 }), ["taxes"])).toBeGreaterThan(4);
    expect(mindLean(mind({}, { faith: 95 }), ["religion"])).toBeGreaterThanOrEqual(4);
    expect(mindLean(mind({}, { faith: 5 }), ["religion"])).toBeLessThanOrEqual(-4);
  });

  it("holds a named man to what he said, whatever his bloc leans", () => {
    const man = seat("cato", mind({}));
    const against = ballotsOfBloc([man], bloc, 60, question(), [], new Map([["cato", "oppose" as const]]));
    const for_ = ballotsOfBloc([man], bloc, -60, question(), [], new Map([["cato", "support" as const]]));
    expect(against[0]!.choice).toBe("no");
    expect(for_[0]!.choice).toBe("yes");
  });

  it("lets the faction a man belongs to pull his vote, without deciding it", () => {
    // Twenty men of mixed nature: the same pull moves most of them, and not all.
    const seats = Array.from({ length: 200 }, (_, i) => seat(`m${i}`, mind({ boldness: (i * 37) % 101, caution: (i * 53) % 101, sociability: (i * 29) % 101, discipline: (i * 17) % 101 })));
    const tally = (lean: number, b: typeof bloc) => {
      const ballots = ballotsOfBloc(seats, b, lean, question("pull"), ["war"], new Map());
      return { yes: ballots.filter((x) => x.choice === "yes").length, no: ballots.filter((x) => x.choice === "no").length };
    };
    const strongFor = tally(10, factional);
    const strongAgainst = tally(-10, factional);
    expect(strongFor.yes).toBeGreaterThan(strongAgainst.yes + 20);
    expect(strongFor.no).toBeLessThan(strongAgainst.no);
    // And not unanimous: it is a pull, not a command.
    expect(strongFor.yes).toBeLessThan(seats.length);
    expect(strongFor.no).toBeGreaterThan(0);
    // A faction holds its people closer than an ordinary bloc does.
    expect(tally(30, factional).yes).toBeGreaterThanOrEqual(tally(30, bloc).yes);
  });

  it("makes unnamed seats vote as people, not as a lump: the same pull divides them", () => {
    const seats = Array.from({ length: 100 }, (_, i) => seat(`anon-${i}`, mind({ boldness: (i * 7) % 101, caution: (i * 13) % 101, sociability: (i * 31) % 101, discipline: (i * 11) % 101 }), null));
    const ballots = ballotsOfBloc(seats, bloc, 10, question(), ["war"], new Map());
    const choices = new Set(ballots.map((b) => b.choice));
    expect(choices.size).toBeGreaterThanOrEqual(2);
    expect(new Set(ballots.map((b) => b.lean)).size).toBeGreaterThan(20);
  });

  it("is the same for the same seat and question every time, and differs between questions", () => {
    const seats = Array.from({ length: 60 }, (_, i) => seat(`s${i}`, mind({ discipline: 20 }), null));
    const once = ballotsOfBloc(seats, bloc, 0, question("a"), [], new Map()).map((b) => b.lean);
    expect(ballotsOfBloc(seats, bloc, 0, question("a"), [], new Map()).map((b) => b.lean)).toEqual(once);
    expect(ballotsOfBloc(seats, bloc, 0, question("b"), [], new Map()).map((b) => b.lean)).not.toEqual(once);
  });
});

import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, officeTemper } from "@chronica/shared";
import { seatsOf } from "./ballots";

describe("every nation that votes seats its chamber with people", () => {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

  it("gives every chamber of every power one person for every vote it holds", () => {
    expect(world.material.institutions.length).toBeGreaterThan(10);
    const polities = new Set(world.material.institutions.map((institution) => institution.polityId));
    expect(polities.size).toBeGreaterThan(3);
    for (const institution of world.material.institutions) {
      const seats = seatsOf(world, institution, new Set());
      for (const bloc of institution.votingBlocs) expect(seats.get(bloc.id)?.length).toBe(bloc.weight);
      // Each seat is a person with a mind of their own, and no two alike.
      const all = [...seats.values()].flat();
      expect(new Set(all.map((seat) => seat.id)).size).toBe(all.length);
    }
  });

  it("seats Carthage's council with Carthaginians, and Rome's Senate with Romans, as named men where it has them", () => {
    const named = (institutionId: string) => {
      const institution = world.material.institutions.find((candidate) => candidate.id === institutionId)!;
      return [...seatsOf(world, institution, new Set()).values()].flat().filter((seat) => seat.characterId !== null)
        .map((seat) => world.characters.find((character) => character.id === seat.characterId)!);
    };
    const carthage = named("carthaginian-council");
    expect(carthage.length).toBeGreaterThan(0);
    for (const man of carthage) expect(man.polityId).toBe("carthage");
    const senate = named("roman-senate");
    expect(senate.length).toBeGreaterThan(0);
    for (const man of senate) expect(man.polityId).toBe("rome");
  });

  it("makes unnamed seats differ from one another", () => {
    const institution = world.material.institutions.find((candidate) => candidate.id === "carthaginian-council")!;
    const unnamed = [...seatsOf(world, institution, new Set()).values()].flat().filter((seat) => seat.characterId === null);
    expect(unnamed.length).toBeGreaterThan(20);
    expect(new Set(unnamed.map((seat) => seat.mind.temperament.boldness)).size).toBeGreaterThan(15);
  });
});

describe("what an officer is like at the work of an office", () => {
  const person = (temperament: Partial<CharacterMind["temperament"]>, drives: Partial<CharacterMind["drives"]> = {}) => ({ mind: mind(temperament, drives) });

  it("rewards the disciplined, dutiful and honest and costs the slack and the venal, by up to fourteen points", () => {
    const steady = officeTemper(person({ discipline: 90, honesty: 85 }, { duty: 90 }));
    const slack = officeTemper(person({ discipline: 10, honesty: 15 }, { duty: 15, wealth: 90 }));
    expect(steady).toBeGreaterThan(8);
    expect(slack).toBeLessThan(-8);
    expect(Math.abs(steady)).toBeLessThanOrEqual(14);
    expect(Math.abs(slack)).toBeLessThanOrEqual(14);
  });

  it("is nothing for the middling, and a greedy man is dear only if he is also not honest", () => {
    expect(officeTemper(person({}))).toBe(0);
    const greedyHonest = officeTemper(person({ honesty: 95 }, { wealth: 95 }));
    const greedyCrooked = officeTemper(person({ honesty: 10 }, { wealth: 95 }));
    expect(greedyHonest).toBeGreaterThan(greedyCrooked);
  });

  it("is a smooth scale, not a type: it moves a little with each part", () => {
    const readings = [10, 30, 50, 70, 90].map((discipline) => officeTemper(person({ discipline })));
    for (let i = 1; i < readings.length; i += 1) expect(readings[i]!).toBeGreaterThanOrEqual(readings[i - 1]!);
    expect(new Set(readings).size).toBeGreaterThan(3);
  });
});
