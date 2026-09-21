import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioClockSchema, WorldStateSchema, ensureProvinceMaterial, nemesisOf, type WorldState } from "@chronica/shared";
import { chooseNemesis, conductInWords, nemesisMethod, nemesisStance, recordNemesis, retireNemesis, shouldRetire } from "./nemesis";
import { renderCharacterPortrait } from "./cognition";
import { createIdFactory } from "./ports";

const clock = ScenarioClockSchema.parse({ epoch: { year: 264, month: 3, day: 1, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 });
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const ids = () => createIdFactory("test");

/** The player is whoever the scenario seats first; the rest of the world is the field. */
const rulerOf = (state: WorldState): string => state.characters.find((character) => character.alive && character.officeId !== null)!.id;

function chosen(state: WorldState, ruler: string) {
  return chooseNemesis({ world: state, gameId: "game-1", playerCharacterId: ruler, ownPolityId: "rome" });
}

describe("choosing the ruler's antagonist", () => {
  it("picks somebody with both the means and the reason", () => {
    const state = world();
    const ruler = rulerOf(state);
    const pick = chosen(state, ruler);
    expect(pick).not.toBeNull();
    expect(pick!.characterId).not.toBe(ruler);
    // The reason is kept for inspection: a choice nobody can account for is
    // one nobody can tune.
    expect(pick!.reason.length).toBeGreaterThan(0);
    expect(state.characters.some((character) => character.id === pick!.characterId && character.alive)).toBe(true);
  });

  it("is the same man on the same world, and a different one on another game", () => {
    const state = world();
    const ruler = rulerOf(state);
    expect(chosen(state, ruler)).toEqual(chosen(state, ruler));
  });

  it("will not choose a second while one is standing", () => {
    const state = world();
    const ruler = rulerOf(state);
    const after = recordNemesis(state, chosen(state, ruler)!, ruler, ids());
    expect(chosen(after, ruler)).toBeNull();
  });

  it("gives a foreign commander a foreign quarrel and a countryman a domestic one", () => {
    const state = world();
    const ruler = rulerOf(state);
    const pick = chosen(state, ruler)!;
    const rival = state.characters.find((character) => character.id === pick.characterId)!;
    if (rival.polityId === "rome") expect(pick.arena).not.toBe("foreign");
    else expect(pick.arena).toBe("foreign");
  });
});

describe("the thread the quarrel is told in", () => {
  it("does not hand the ruler the plot against him", () => {
    // A thread is shown to everyone in it, and the slice draws the ruler's own
    // portrait exactly as cognition draws everybody else's. Listing him here
    // would have announced the whole quarrel in his first report.
    const state = world();
    const ruler = rulerOf(state);
    const after = recordNemesis(state, chosen(state, ruler)!, ruler, ids());
    const thread = after.storylines.at(-1)!;

    expect(thread.participantIds).not.toContain(ruler);
    expect(thread.visibility).toBe("private");

    const rulerName = after.characters.find((character) => character.id === ruler)!.name;
    // He may well be caught up in other things -- the scenario gives him
    // threads of his own. What must not reach him is this one.
    const portrait = renderCharacterPortrait(ruler, rulerName, after, clock);
    expect(portrait).not.toContain(thread.stakes);
    expect(portrait).not.toContain(thread.title);
    expect(portrait).not.toContain(thread.id);
  });

  it("puts it in front of the man whose campaign it is", () => {
    const state = world();
    const ruler = rulerOf(state);
    const after = recordNemesis(state, chosen(state, ruler)!, ruler, ids());
    const nemesis = nemesisOf(after.nemeses, ruler)!;
    const rival = after.characters.find((character) => character.id === nemesis.characterId)!;

    const portrait = renderCharacterPortrait(rival.id, rival.name, after, clock);
    // His own long-term aim, carried by the thread rather than by a second
    // copy of it kept somewhere else.
    expect(portrait).toContain("Caught up in:");
    expect(portrait).toContain(after.storylines.at(-1)!.stakes);
  });
});

describe("where he stands this season", () => {
  const withNemesis = (state: WorldState) => {
    const ruler = rulerOf(state);
    const after = recordNemesis(state, chosen(state, ruler)!, ruler, ids());
    return { world: after, nemesis: nemesisOf(after.nemeses, ruler)! };
  };

  it("is opposed while the country is not being fought over", () => {
    const state = { ...world(), conflicts: { ...world().conflicts, wars: [] } };
    const { world: after, nemesis } = withNemesis(state);
    if (nemesis.arena === "foreign") return;
    expect(nemesisStance(after, nemesis, "rome")).toBe("opposed");
  });

  it("converges when the war is going badly, because a private quarrel is a luxury", () => {
    // An antagonist who can never be on your side is a villain, and a villain
    // is a duller thing to play against than a man whose interests sometimes
    // run with yours and who expects to be owed for it.
    const base = world();
    const { world: after, nemesis } = withNemesis(base);
    if (nemesis.arena === "foreign") return;

    const atWar: WorldState = {
      ...after,
      conflicts: { ...after.conflicts, wars: [{ ...after.conflicts.wars[0]!, polityAId: "rome", polityBId: "carthage" }] },
      material: {
        ...after.material,
        forces: after.material.forces.map((force) => (force.polityId === "rome" ? { ...force, provisionStatus: "critical" as const } : force)),
      },
    };
    expect(nemesisStance(atWar, nemesis, "rome")).toBe("converged");
  });

  it("goes dormant when he is dead, and is retired", () => {
    const base = world();
    const { world: after, nemesis } = withNemesis(base);
    const dead: WorldState = {
      ...after,
      characters: after.characters.map((character) => (character.id === nemesis.characterId ? { ...character, alive: false } : character)),
    };
    expect(nemesisStance(dead, nemesis, "rome")).toBe("dormant");
    expect(shouldRetire(dead, nemesis)).toBe(true);
    expect(nemesisOf(retireNemesis(dead, nemesis).nemeses, nemesis.targetCharacterId)).toBeUndefined();
  });

  it("retires him when the quarrel itself is over", () => {
    const base = world();
    const { world: after, nemesis } = withNemesis(base);
    const settled: WorldState = {
      ...after,
      storylines: after.storylines.map((storyline) => (storyline.id === nemesis.storylineId ? { ...storyline, phase: "closed" as const } : storyline)),
    };
    expect(shouldRetire(settled, nemesis)).toBe(true);
  });
});

describe("two rivals who want the same thing and are not the same antagonist", () => {
  const person = (state: WorldState, mind: Partial<WorldState["characters"][number]["mind"]>) => {
    const base = state.characters.find((character) => character.alive)!;
    return { ...base, mind: { ...base.mind, ...mind } };
  };
  const temperament = (over: Partial<WorldState["characters"][number]["mind"]["temperament"]>) =>
    ({ boldness: 50, caution: 50, honesty: 50, sociability: 50, discipline: 50, cruelty: 50, ...over });
  const drives = (over: Partial<WorldState["characters"][number]["mind"]["drives"]>) =>
    ({ security: 50, status: 50, wealth: 50, family: 50, faith: 50, duty: 50, revenge: 50, ...over });

  it("reads the method off the man, not off the quarrel", () => {
    const state = world();
    expect(nemesisMethod(person(state, { temperament: temperament({ honesty: 80 }) }))).toBe("open");
    expect(nemesisMethod(person(state, { temperament: temperament({ honesty: 20 }) }))).toBe("covert");
    expect(nemesisMethod(person(state, { temperament: temperament({ honesty: 50 }) }))).toBe("pragmatic");
    // The middle, decided by patience: a careful unscrupulous man finds the
    // quiet way without needing to prefer it.
    expect(nemesisMethod(person(state, { temperament: temperament({ honesty: 45, discipline: 70 }), riskTolerance: 30 }))).toBe("covert");
  });

  it("forbids the stalwart man the things it hands the treacherous one", () => {
    // The whole point: an honest rival opposes you to your face and loses in
    // the open rather than win by a means he despises.
    const state = world();
    const stalwart = conductInWords(person(state, { temperament: temperament({ honesty: 80, cruelty: 20 }) }), "Marcus");
    const treacherous = conductInWords(person(state, { temperament: temperament({ honesty: 15, cruelty: 80 }) }), "Marcus");

    expect(stalwart).toContain("will not conspire");
    expect(stalwart).toContain("in the open");
    expect(stalwart).not.toContain("subvert\" -- they appear to comply");
    expect(stalwart).toContain("will not reach Marcus through his family");

    expect(treacherous).toContain("belief_set");
    expect(treacherous).toContain("subvert");
    expect(treacherous).toContain("no reason to spare what is near Marcus");
    expect(treacherous).not.toContain("will not conspire");
  });

  it("gives them different instruments, from what they are actually good at", () => {
    const state = world();
    const base = state.characters.find((character) => character.alive)!;
    const soldier = { ...base, skills: { ...base.skills, martial: 80, stewardship: 20, diplomacy: 20 } };
    const banker = { ...base, mind: { ...base.mind, drives: drives({ wealth: 80 }) }, skills: { ...base.skills, martial: 20, stewardship: 80 } };

    expect(conductInWords(soldier, "Marcus")).toContain("the men they command");
    expect(conductInWords(banker, "Marcus")).toContain("money_transfer");
    expect(conductInWords(banker, "Marcus")).not.toContain("the men they command");
  });

  it("answers the same order three different ways", () => {
    const state = world();
    const honest = conductInWords(person(state, { temperament: temperament({ honesty: 80 }) }), "Marcus");
    const liar = conductInWords(person(state, { temperament: temperament({ honesty: 20 }) }), "Marcus");
    const careful = conductInWords(person(state, { temperament: temperament({ honesty: 50, caution: 70 }) }), "Marcus");

    expect(honest).toContain("refused outright");
    expect(liar).toContain("appear to comply and do otherwise");
    expect(careful).toContain("more often delayed than refused");
  });

  it("closes ranks or takes the opening, on the same war", () => {
    // A war is a reason to stand down or the chance he has been waiting for,
    // depending entirely on the man.
    const base = world();
    const ruler = rulerOf(base);
    const after = recordNemesis(base, chosen(base, ruler)!, ruler, ids());
    const nemesis = nemesisOf(after.nemeses, ruler)!;
    if (nemesis.arena === "foreign") return;

    const atWar = (mind: Partial<WorldState["characters"][number]["mind"]>): WorldState => ({
      ...after,
      conflicts: { ...after.conflicts, wars: [{ ...after.conflicts.wars[0]!, polityAId: "rome", polityBId: "carthage" }] },
      characters: after.characters.map((character) =>
        character.id === nemesis.characterId ? { ...character, mind: { ...character.mind, ...mind } } : character),
    });

    expect(nemesisStance(atWar({ drives: drives({ duty: 80, status: 50 }) }), nemesis, "rome")).toBe("converged");
    expect(nemesisStance(atWar({ drives: drives({ duty: 20, status: 80 }) }), nemesis, "rome")).toBe("opposed");
  });
});
