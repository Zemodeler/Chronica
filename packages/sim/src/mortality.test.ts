import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type ScenarioLifeRules, type WorldState } from "@chronica/shared";
import { PERIL_MUST_STAND_DAYS, exposureMultiplier, killCharacter, reviewLives, successionDecision, takeUpTheHouse } from "./mortality";
import { createIdFactory } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const life: ScenarioLifeRules = definition.life;
const base = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const ids = () => createIdFactory("burst-life");

const at = (world: WorldState, day: number): WorldState => ({ ...world, instant: { day, minute: 0 }, elapsedStep: day });
const run = (world: WorldState, toDay: number, playerCharacterId: string | null = null) =>
  reviewLives({ world, life, toDay, ids: ids(), playerCharacterId });

describe("who is due for review, and when", () => {
  it("enrols everybody once, staggered, instead of reviewing the whole world on one day", () => {
    // Without the stagger every character in the world rolls on the same day,
    // for ever -- years in which nobody dies and years in which half the
    // Senate does.
    const after = run(base(), 1).world;
    const due = after.characters.filter((character) => character.alive).map((character) => character.nextLifeReviewAtStep);
    expect(due.every((step) => step !== null)).toBe(true);
    expect(new Set(due).size).toBeGreaterThan(1);
  });

  it("does nothing at all for a scenario that authors no age bands", () => {
    const world = base();
    const untouched = reviewLives({ world, life: { lifeStages: [], inheritanceRules: [], reviewIntervalSteps: 30 }, toDay: 400, ids: ids() });
    expect(untouched.world).toBe(world);
    expect(untouched.facts).toEqual([]);
  });

  it("gives the same answer however the span was cut into hops", () => {
    // `tickTo` runs several times a burst at hop boundaries. A roll hashed on
    // the day being ticked *to* would make a replay with different hops roll
    // differently, and a world you cannot replay is not a world you can trust.
    const start = at(base(), 0);
    const whole = run(run(start, 1).world, 400);

    let stepwise = run(start, 1).world;
    for (const day of [40, 90, 150, 210, 280, 340, 400]) stepwise = run(stepwise, day).world;

    const summary = (world: WorldState): string => world.characters
      .map((character) => `${character.id}:${character.alive}:${character.healthBps}:${character.disqualifyingStatuses.join("+")}`)
      .sort()
      .join("|");
    expect(summary(stepwise)).toBe(summary(whole.world));
  });
});

describe("what a person exposes themselves to", () => {
  it("counts a command, a failing body and a province in distress, and stops at six", () => {
    const world = base();
    const plain = world.characters.find((character) => character.healthBps >= 9_000 && !world.material.forces.some((force) => force.commanderCharacterId === character.id));
    if (plain !== undefined) expect(exposureMultiplier(world, plain)).toBeLessThan(2);

    const commander = world.characters.find((character) => world.material.forces.some((force) => force.commanderCharacterId === character.id))!;
    expect(exposureMultiplier(world, commander)).toBeGreaterThanOrEqual(2);

    const wrecked = { ...commander, healthBps: 100, disqualifyingStatuses: ["captured"] };
    const grim: WorldState = { ...world, characters: world.characters.map((character) => (character.id === commander.id ? wrecked : character)) };
    expect(exposureMultiplier(grim, wrecked)).toBeLessThanOrEqual(6);
  });
});

describe("a death that is earned", () => {
  /** A man of great age, commanding in a starving province: as exposed as this world gets. */
  function doomed(): { world: WorldState; id: string } {
    const world = base();
    const commander = world.characters.find((character) => world.material.forces.some((force) => force.commanderCharacterId === character.id))!;
    return {
      id: commander.id,
      world: {
        ...world,
        characters: world.characters.map((character) => (character.id === commander.id
          ? { ...character, ageYearsAtStart: 78, birthStep: null, healthBps: 2_000, officeId: character.officeId }
          : character)),
        material: {
          ...world.material,
          forces: world.material.forces.map((force) => (force.commanderCharacterId === commander.id ? { ...force, provisionStatus: "critical" as const } : force)),
        },
      },
    };
  }

  it("never takes a man who matters in the burst his peril opens", () => {
    const { world, id } = doomed();
    let state = run(at(world, 0), 1).world;
    let firstPeril: number | null = null;
    for (const day of [30, 60, 90, 120, 150, 180]) {
      const review = run(state, day);
      state = review.world;
      const peril = state.storylines.find((storyline) => storyline.seedKey === `peril:${id}`);
      if (peril !== undefined && firstPeril === null) firstPeril = day;
      const dead = !state.characters.find((character) => character.id === id)!.alive;
      if (dead) {
        expect(firstPeril).not.toBeNull();
        expect(day - firstPeril!).toBeGreaterThanOrEqual(PERIL_MUST_STAND_DAYS);
        return;
      }
    }
    // He may simply have survived the year, which is also correct. What must
    // never happen is dying without the peril having stood first.
    expect(state.characters.find((character) => character.id === id)!.alive).toBe(true);
  });

  it("opens the peril where the player can see it and act against it", () => {
    const { world, id } = doomed();
    let state = run(at(world, 0), 1).world;
    let facts: string[] = [];
    for (const day of [30, 60, 90, 120, 150, 180]) {
      const review = run(state, day);
      state = review.world;
      facts = [...facts, ...review.facts.map((fact) => fact.summary)];
      const peril = state.storylines.find((storyline) => storyline.seedKey === `peril:${id}`);
      if (peril === undefined) continue;
      // Not private: `whoSeeksThePlayer` skips private pressures, and a peril
      // nobody can bring to the player is a peril he cannot act against.
      expect(peril.visibility).not.toBe("private");
      const pressure = state.characterPressures.find((candidate) => candidate.characterId === id && candidate.kind === "illness" && candidate.status === "active");
      expect(pressure).toBeDefined();
      expect(pressure!.visibility).not.toBe("private");
      // And heavy enough that it reaches the report the player is reading.
      expect(review.facts.some((fact) => fact.significance >= 60)).toBe(true);
      return;
    }
  });
});

describe("the one door out of life", () => {
  it("vacates the seat, hands the army to somebody living, and tells the world", () => {
    const world = base();
    const commander = world.characters.find((character) => world.material.forces.some((force) => force.commanderCharacterId === character.id))!;
    const killed = killCharacter(world, commander.id, "Natural causes.", 500);

    expect(killed.world.characters.find((character) => character.id === commander.id)!.alive).toBe(false);
    expect(killed.world.characters.find((character) => character.id === commander.id)!.officeId).toBeNull();
    expect(killed.world.material.officeSeats.some((seat) => seat.holderCharacterId === commander.id && seat.status === "held")).toBe(false);
    // A dead man went on commanding his legion, which is how this was found.
    for (const force of killed.world.material.forces) {
      const holder = killed.world.characters.find((character) => character.id === force.commanderCharacterId);
      if (holder !== undefined) expect(holder.alive).toBe(true);
    }
    expect(killed.facts[0]!.visibility).toBe("public");
    expect(killed.facts[0]!.significance).toBeGreaterThanOrEqual(85);
  });

  it("is idempotent, because a man does not die twice", () => {
    const world = base();
    const someone = world.characters.find((character) => character.alive)!;
    const once = killCharacter(world, someone.id, "Natural causes.", 500);
    const twice = killCharacter(once.world, someone.id, "Natural causes.", 520);
    expect(twice.facts).toEqual([]);
    expect(twice.world).toBe(once.world);
  });
});

describe("who the player becomes", () => {
  it("always offers somebody, because a dead end is the one thing forbidden", () => {
    const world = base();
    const someone = world.characters.find((character) => character.polityId === "rome")!;
    const decision = successionDecision(killCharacter(world, someone.id, "Natural causes.", 500).world, someone.id, 500);
    expect(decision.options.length).toBeGreaterThanOrEqual(1);
    expect(decision.prompt).toContain(someone.name);
    // The id is what tells the application who is asking next.
    for (const option of decision.options) expect(option.id.startsWith("succeed-")).toBe(true);
  });
});

describe("taking up the house", () => {
  const fresh = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

  it("settles the estate on the heir the day the man dies, and the choice of who follows says what each got", () => {
    const killed = killCharacter(fresh(), "marcus-atilius", "Killed in the field.", 10);
    expect(killed.facts.some((fact) => fact.kind === "inheritance")).toBe(true);
    const minor = killed.world.material.accounts.find((account) => account.id === "marcus-minor-purse")!;
    expect(minor.balance).toBeGreaterThanOrEqual(1_200);
    const ids = killed.world.material.inheritanceTransfers.map((transfer) => transfer.id);
    expect(new Set(ids).size).toBe(ids.length);
    const decision = successionDecision(killed.world, "marcus-atilius", 10);
    expect(decision.options[0]!.summary).toMatch(/inherits \d+ in coin/);
  });

  it("turns the house's rival on its new head, and hands him the house's friends and feuds", () => {
    let world = fresh();
    world = {
      ...world,
      characters: world.characters.map((character) => (character.id === "hanno"
        ? { ...character, relations: [...character.relations, { subjectCharacterId: "marcus-atilius", causes: [{ id: "old-feud", label: "Burned his ships", score: -40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
        : character)),
      storylines: [...world.storylines, { id: "feud-thread", title: "Hanno against the Atilii", participantIds: ["hanno", "marcus-atilius"], provinceId: null, phase: "escalating", stakes: "Who breaks first.", history: [], nextDevelopment: "More.", visibility: "polity", origin: "world", openedByRef: null, openedAtStep: 0, updatedAtStep: 0, closedAtStep: null, causalFactIds: [], seedKey: null }],
      nemeses: [{ id: "nemesis-1", characterId: "hanno", targetCharacterId: "marcus-atilius", arena: "military", storylineId: "feud-thread", chosenAtStep: 0, retiredAtStep: null, reason: "He commands against us." }],
    };
    const dead = killCharacter(world, "marcus-atilius", "Killed in the field.", 10).world;
    const taken = takeUpTheHouse(dead, "marcus-atilius", "marcus-atilius-minor");
    expect(taken.nemeses[0]!.targetCharacterId).toBe("marcus-atilius-minor");
    expect(taken.storylines.find((storyline) => storyline.id === "feud-thread")!.participantIds).toContain("marcus-atilius-minor");
    const feud = taken.characters.find((character) => character.id === "hanno")!.relations.find((relation) => relation.subjectCharacterId === "marcus-atilius-minor");
    expect(feud?.causes.some((cause) => cause.score < 0 && cause.label.includes("Marcus Atilius"))).toBe(true);
  });
});
