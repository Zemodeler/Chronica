import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type Character, type WorldState } from "@chronica/shared";
import { answersAnOrder, assessExecution, daysInHand, throughHand } from "./delegation";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

/** One world, one man, made to order. */
function withMan(overrides: Partial<Character>, mind: Partial<Character["mind"]> = {}): { world: WorldState; id: string } {
  const world = base();
  const first = world.characters[0]!;
  const made: Character = {
    ...first,
    ...overrides,
    skills: { ...first.skills, ...(overrides.skills ?? {}) },
    mind: {
      ...first.mind,
      ...mind,
      drives: { ...first.mind.drives, ...(mind.drives ?? {}) },
      temperament: { ...first.mind.temperament, ...(mind.temperament ?? {}) },
    },
  };
  return { world: { ...world, characters: [made, ...world.characters.slice(1)] }, id: made.id };
}

describe("whose hands an order passes through", () => {
  it("makes the same work cost more and take longer in worse hands", () => {
    // VISION's own example: two officials given "find the money for two new
    // legions". Both accomplish it. The difference is what it cost.
    const able = withMan({ skills: { ...base().characters[0]!.skills, stewardship: 85 } });
    const poor = withMan({ skills: { ...base().characters[0]!.skills, stewardship: 15 } });
    const good = assessExecution(able.world, able.id, "fiscal")!;
    const bad = assessExecution(poor.world, poor.id, "fiscal")!;

    expect(throughHand(1_000, bad).cost).toBeGreaterThan(throughHand(1_000, good).cost);
    expect(daysInHand(60, bad)).toBeGreaterThan(daysInHand(60, good));
    // And being good at it is not free money: it is a discount, not a mint.
    expect(throughHand(1_000, good).cost).toBeGreaterThan(500);
  });

  it("asks the right skill for the kind of work", () => {
    const soldier = withMan({ skills: { ...base().characters[0]!.skills, martial: 90, stewardship: 10 } });
    expect(assessExecution(soldier.world, soldier.id, "military")!.competence).toBe(90);
    expect(assessExecution(soldier.world, soldier.id, "fiscal")!.competence).toBe(10);
  });

  it("takes a cut only where both the appetite and the weak conscience are", () => {
    const honest = withMan({}, { temperament: { ...base().characters[0]!.mind.temperament, honesty: 90 }, drives: { ...base().characters[0]!.mind.drives, wealth: 95 } });
    const greedy = withMan({}, { temperament: { ...base().characters[0]!.mind.temperament, honesty: 10 }, drives: { ...base().characters[0]!.mind.drives, wealth: 95, duty: 10 } });
    const dull = withMan({}, { temperament: { ...base().characters[0]!.mind.temperament, honesty: 10 }, drives: { ...base().characters[0]!.mind.drives, wealth: 5, status: 5, duty: 80 } });

    expect(assessExecution(honest.world, honest.id, "fiscal")!.skimBps).toBe(0);
    expect(assessExecution(dull.world, dull.id, "fiscal")!.skimBps).toBe(0);
    expect(assessExecution(greedy.world, greedy.id, "fiscal")!.skimBps).toBeGreaterThan(0);
  });

  it("never lets a thief empty the chest, because that man is caught the same week", () => {
    const worst = withMan({}, { temperament: { ...base().characters[0]!.mind.temperament, honesty: 0 }, drives: { ...base().characters[0]!.mind.drives, wealth: 100, status: 100, duty: 0 } });
    const hand = assessExecution(worst.world, worst.id, "fiscal")!;
    expect(throughHand(1_000, hand).skimmed).toBeLessThanOrEqual(200);
    expect(throughHand(1_000, hand).skimmed).toBeGreaterThan(0);
  });

  it("says what sort of workman this is, in words the prompt can use", () => {
    const able = withMan({ skills: { ...base().characters[0]!.skills, stewardship: 85 } });
    const words = assessExecution(able.world, able.id, "fiscal")!.words;
    expect(words).not.toMatch(/\d/);
    expect(words.length).toBeGreaterThan(10);
  });

  it("has nothing to say about a man who is not there", () => {
    expect(assessExecution(base(), "nobody-at-all", "fiscal")).toBeNull();
    expect(throughHand(500, null)).toEqual({ cost: 500, skimmed: 0 });
    expect(daysInHand(30, null)).toBe(30);
  });
});

describe("how a person answers somebody else's order", () => {
  const withMind = (over: Partial<WorldState["characters"][number]["mind"]["temperament"]>, drives?: Partial<WorldState["characters"][number]["mind"]["drives"]>) => {
    const character = base().characters[0]!;
    return {
      ...character,
      mind: {
        ...character.mind,
        temperament: { boldness: 50, caution: 50, honesty: 50, sociability: 50, discipline: 50, cruelty: 50, ...over },
        drives: { security: 50, status: 50, wealth: 50, family: 50, faith: 50, duty: 50, revenge: 50, ...drives },
      },
    };
  };

  it("says nothing at all about an unremarkable person", () => {
    // This is carried in the portrait of everybody with an order outstanding,
    // so the ordinary case has to cost nothing. Somebody middling answers as
    // the situation suggests, which is right.
    expect(answersAnOrder(withMind({}))).toBeNull();
  });

  it("will not let an honest man appear to comply", () => {
    const said = answersAnOrder(withMind({ honesty: 75 }))!;
    expect(said).toContain("refuses outright");
    expect(said).toContain('They do not take "subvert"');
  });

  it("hands the treacherous man exactly what it denies the honest one", () => {
    const said = answersAnOrder(withMind({ honesty: 20 }))!;
    expect(said).toContain("subvert");
    expect(said).toContain("appear to comply and do otherwise");
  });

  it("lets a dutiful man refuse even where he is not especially honest", () => {
    // Duty carries it on its own: a man who holds the office sacred does not
    // quietly sabotage what he was told to do, whatever else he is.
    expect(answersAnOrder(withMind({ honesty: 45 }, { duty: 80 }))!).toContain("refuses outright");
  });

  it("has the careful man delay rather than refuse", () => {
    expect(answersAnOrder(withMind({ caution: 70 }))!).toContain("delays rather than refuses");
  });
});
