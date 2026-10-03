import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type Character, type Difficulty, type WorldState } from "@chronica/shared";
import { ensureConstitutions } from "./constitutions";
import { accuseInEarnest, answerAThreat, prosecutePrivateMen } from "./personal-pushback";
import { plotOdds } from "./plots";
import { attemptRegimeChange } from "./regime";
import { decideVillainy } from "./villainy";

/**
 * Play-test L11 and the coup run: on hard the world pushed back on Rome and
 * never on the man. A private man was answerable to nobody, a man who hated
 * him did nothing about it, an accusation was a line of prose, and a man who
 * said he would march on the city drew no answer from it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const PLAYER = "quintus-ogulnius";
const opening = (difficulty: Difficulty = "hard"): WorldState => ({ ...ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), difficulty });
const named = (world: WorldState, name: string): Character => world.characters.find((character) => character.name === name)!;

/** Ogulnius a private man: his augur's seat laid down. */
function privateMan(world: WorldState): WorldState {
  return { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.holderCharacterId === PLAYER ? { ...seat, holderCharacterId: null, status: "vacant" as const } : seat)) } };
}

/** A man who hates him: score, and the temperament to act on it. */
function hates(world: WorldState, enemyId: string, targetId: string, temper: Partial<Character["mind"]["temperament"]> = {}): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id !== enemyId ? character : {
      ...character,
      mind: { ...character.mind, drives: { ...character.mind.drives, revenge: 80 }, temperament: { ...character.mind.temperament, ...temper } },
      relations: [...character.relations, { subjectCharacterId: targetId, causes: [{ id: `hate-${enemyId}`, label: "A wrong done him.", score: -50, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -60 } }] }],
    })),
  };
}

const answering = (world: WorldState, weight: number): WorldState => ({
  ...world,
  answerable: [...world.answerable, { characterId: PLAYER, polityId: "rome", kind: "breach" as const, label: "He took what was not his to take", atStep: 0, weight }],
});

describe("a private man answers for what he does (L11)", () => {
  it("is prosecuted on hard when his account reaches the difficulty's bar, by a man who thinks ill of him", () => {
    const world = answering(hates(privateMan(opening("hard")), "gnaeus-cornelius", PLAYER), 2);
    const out = prosecutePrivateMen(world, 30, PLAYER);
    const trial = out.world.material.politicalProcedures.find((procedure) => procedure.type === "denunciation" && procedure.subjectId === PLAYER);
    expect(trial).toBeDefined();
    expect(trial!.sponsorCharacterId).toBe("gnaeus-cornelius");
    expect(out.facts.some((fact) => fact.kind === "prosecution_brought")).toBe(true);
    expect(out.world.answerable.some((entry) => entry.characterId === PLAYER)).toBe(false);
  });

  it("is not, on normal, for the same account; nor anywhere with nobody to bring it", () => {
    const normal = answering(hates(privateMan(opening("normal")), "gnaeus-cornelius", PLAYER), 2);
    expect(prosecutePrivateMen(normal, 30, PLAYER).facts).toHaveLength(0);
    const unhated = answering(privateMan(opening("hard")), 2);
    expect(prosecutePrivateMen(unhated, 30, PLAYER).facts).toHaveLength(0);
  });
});

describe("a personal enemy moves against him (L11)", () => {
  const plotsAgainst = (world: WorldState): number => {
    let count = 0;
    for (let month = 0; month < 24; month += 1) {
      const at = { ...world, instant: { day: month * 30, minute: 0 }, elapsedStep: month * 30 };
      count += decideVillainy({ world: at, gameId: "game-1", playerCharacterId: PLAYER, playedByModel: new Set() })
        .filter((decision) => decision.actorCharacterId === "gnaeus-cornelius").length;
    }
    return count;
  };

  it("on hard, a vengeful man who hates him lays a plot against him in some months, and on gentle never", () => {
    const cruel = hates(opening("hard"), "gnaeus-cornelius", PLAYER, { cruelty: 80 });
    expect(plotsAgainst(cruel)).toBeGreaterThan(0);
    const decision = [...Array(24).keys()].map((month) => decideVillainy({ world: { ...cruel, instant: { day: month * 30, minute: 0 }, elapsedStep: month * 30 }, gameId: "game-1", playerCharacterId: PLAYER, playedByModel: new Set() }))
      .flat().find((candidate) => candidate.actorCharacterId === "gnaeus-cornelius")!;
    expect(decision.deltas[0]).toMatchObject({ op: "covert_plot_open", targetCharacterRef: PLAYER, kind: "assassination" });
    expect(plotsAgainst(hates(opening("gentle"), "gnaeus-cornelius", PLAYER, { cruelty: 80 }))).toBe(0);
  });

  it("a man without the stomach for violence blackens his name instead", () => {
    const mild = hates(opening("merciless"), "gnaeus-cornelius", PLAYER, { cruelty: 20, boldness: 20 });
    const decision = [...Array(24).keys()].map((month) => decideVillainy({ world: { ...mild, instant: { day: month * 30, minute: 0 }, elapsedStep: month * 30 }, gameId: "game-1", playerCharacterId: PLAYER, playedByModel: new Set() }))
      .flat().find((candidate) => candidate.actorCharacterId === "gnaeus-cornelius")!;
    expect(decision.deltas[0]).toMatchObject({ op: "character_state_set", characterRef: PLAYER, standingCause: "scandal" });
    expect(decision.facts.some((fact) => fact.kind === "scandal")).toBe(true);
  });

  it("plots against him are harder or easier by the difficulty's edge", () => {
    const world = opening("normal");
    const target = world.characters.find((character) => character.id === PLAYER)!;
    const sponsor = world.characters.find((character) => character.id === "gnaeus-cornelius")!;
    const input = { kind: "assassination" as const, target, sponsor, agent: null, spend: 0, playerCharacterId: PLAYER };
    const normal = plotOdds(world, input).successOddsBps;
    expect(plotOdds({ ...world, difficulty: "hard" }, input).successOddsBps).toBeGreaterThanOrEqual(normal);
    expect(plotOdds({ ...world, difficulty: "gentle" }, input).successOddsBps).toBeLessThanOrEqual(normal);
  });
});

describe("an accusation laid on him is brought in earnest on hard (L11)", () => {
  const seed = { archetype: "accusation", severity: "serious" as const, target: { characterId: PLAYER }, brief: "He stands accused." } as Parameters<typeof accuseInEarnest>[1];
  it("opens a real trial on hard, with a man who thinks ill of him to press it", () => {
    const world = hates(opening("hard"), "gnaeus-cornelius", PLAYER);
    const out = accuseInEarnest(world, seed, PLAYER, 10);
    expect(out.world.material.politicalProcedures.some((procedure) => procedure.type === "denunciation" && procedure.subjectId === PLAYER)).toBe(true);
    expect(out.seed.brief).toMatch(/already before the court/);
  });
  it("stays a rumour on normal", () => {
    const world = hates(opening("normal"), "gnaeus-cornelius", PLAYER);
    expect(accuseInEarnest(world, seed, PLAYER, 10).facts).toHaveLength(0);
  });
});

describe("a man who threatens the state, or tries to take it (the coup run)", () => {
  it("a threat to march on the city alarms it, presses its rulers to act, and has him charged with treason", () => {
    const world = ensureConstitutions({ world: opening("normal"), government, toDay: 0 });
    const out = answerAThreat(world, PLAYER, "I gather my clients and march on Rome to seize the state.", 5);
    expect(out.facts.some((fact) => fact.kind === "state_threatened")).toBe(true);
    expect(out.world.characterPressures.some((pressure) => pressure.id.startsWith("defend-the-state") && pressure.label.includes("Ogulnius"))).toBe(true);
    expect(out.world.material.politicalProcedures.some((procedure) => procedure.type === "denunciation" && procedure.subjectId === PLAYER && procedure.label.includes("treason"))).toBe(true);
    // Said again within the season, it is the same alarm.
    expect(answerAThreat(out.world, PLAYER, "I march on Rome.", 20).facts).toHaveLength(0);
    // An ordinary order is no threat.
    expect(answerAThreat(world, PLAYER, "I go to the Forum and speak for the grain law.", 5).facts).toHaveLength(0);
  });

  it("a man with an army at the city may try to take it: success makes him its master, failure an outlaw on trial", () => {
    // Ogulnius at the head of the field army, as a proconsul might be: not one of the men who rule.
    const seated = ensureConstitutions({ world: opening("normal"), government, toDay: 0 });
    const base: WorldState = { ...seated, material: { ...seated.material, forces: seated.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, commanderCharacterId: PLAYER, controllerCharacterId: PLAYER } : force)) } };
    const general = PLAYER;
    const attempts = [...Array(60).keys()].map((n) => attemptRegimeChange({ world: base, actorId: general, polityId: "rome", route: "coup", form: null, forceIds: ["roman-field-army"], government, atStep: 10, gameId: `game-${n}` }));
    const won = attempts.find((attempt) => "succeeded" in attempt && attempt.succeeded);
    const lost = attempts.find((attempt) => "succeeded" in attempt && !attempt.succeeded);
    expect(won).toBeDefined();
    expect(lost).toBeDefined();
    if (won === undefined || !("world" in won) || lost === undefined || !("world" in lost)) return;
    // He holds the state.
    expect(won.world.material.officeSeats.some((seat) => seat.holderCharacterId === general && seat.status === "held")).toBe(true);
    // He is an outlaw, fifteen hundred down in standing, and on trial for treason.
    const after = lost.world.characters.find((character) => character.id === general)!;
    expect(after.disqualifyingStatuses).toContain("outlaw");
    expect(after.prestigeBps).toBe(Math.max(0, named(base, "Quintus Ogulnius Gallus").prestigeBps - 1_500));
    expect(lost.world.material.politicalProcedures.some((procedure) => procedure.type === "denunciation" && procedure.subjectId === general && procedure.label.includes("treason"))).toBe(true);
  });
});
