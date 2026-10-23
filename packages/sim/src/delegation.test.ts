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
    // The skill and the work's own finer skill, half each: war and feeding an
    // army for military work, administration and the tax roll for fiscal.
    const soldier = withMan({ skills: { ...base().characters[0]!.skills, martial: 90, stewardship: 10, subSkills: { logistics: 90, taxation: 10 } } });
    expect(assessExecution(soldier.world, soldier.id, "military")!.competence).toBe(90);
    expect(assessExecution(soldier.world, soldier.id, "fiscal")!.competence).toBe(10);
    const quartermaster = withMan({ skills: { ...base().characters[0]!.skills, martial: 90, subSkills: { logistics: 30 } } });
    expect(assessExecution(quartermaster.world, quartermaster.id, "military")!.competence).toBe(60);
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

describe("what kind of work a project is", () => {
  it("reads it off the project's kind and name, and calls anything else civil work", async () => {
    const { domainOfWork } = await import("./delegation");
    expect(domainOfWork("temple", "The Temple of Janus")).toBe("religious");
    expect(domainOfWork("construction", "Walls of Messana")).toBe("military");
    expect(domainOfWork("census", "The census of the tribes")).toBe("fiscal");
    expect(domainOfWork("road", "The Via Appia to Capua")).toBe("civil");
  });
});

describe("every person is their own hand", () => {
  const zero = base().characters[0]!;
  const skillsOf = (stewardship: number): Character["skills"] => ({ ...zero.skills, stewardship, subSkills: { taxation: stewardship } });
  const mindOf = (temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]>): Partial<Character["mind"]> =>
    ({ temperament: { ...zero.mind.temperament, ...temperament }, drives: { ...zero.mind.drives, ...drives } });
  const hand = (m: { world: WorldState; id: string }) => assessExecution(m.world, m.id, "fiscal")!;

  it("makes a loyal veteran cheaper and quicker than a hungry beginner, who is quicker than a dud", () => {
    const veteran = hand(withMan({ skills: skillsOf(80), ageYearsAtStart: 52, traits: [] }, mindOf({ honesty: 85, discipline: 70 }, { duty: 85, status: 30, wealth: 30 })));
    const beginner = hand(withMan({ skills: skillsOf(35), ageYearsAtStart: 24, traits: ["ambitious"] }, mindOf({ honesty: 60, discipline: 40 }, { duty: 55, status: 90, wealth: 40 })));
    const dud = hand(withMan({ skills: skillsOf(15), ageYearsAtStart: 45, traits: [] }, mindOf({ honesty: 85, discipline: 70 }, { duty: 85, status: 30, wealth: 30 })));

    expect(throughHand(1_000, veteran).cost).toBeLessThan(throughHand(1_000, beginner).cost);
    expect(throughHand(1_000, beginner).cost).toBeLessThan(throughHand(1_000, dud).cost);
    expect(daysInHand(60, veteran)).toBeLessThan(daysInHand(60, beginner));
    expect(daysInHand(60, beginner)).toBeLessThan(daysInHand(60, dud));
    // Large enough to see in one project.
    expect(throughHand(1_000, dud).cost).toBeGreaterThanOrEqual(1.5 * throughHand(1_000, veteran).cost);
    expect(daysInHand(60, dud)).toBeGreaterThanOrEqual(2 * daysInHand(60, veteran));
  });

  it("does not sort anybody into a bucket: changing one trait moves the numbers a little, not a lot", () => {
    const at = (ambitionDrive: number) => hand(withMan({ skills: skillsOf(50), ageYearsAtStart: 35, traits: [] }, mindOf({}, { status: ambitionDrive })));
    const steps = [30, 40, 50, 60, 70, 80, 90].map((drive) => at(drive).delayBps);
    // Strictly smoother than a threshold: every step is a change, none is a cliff.
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeLessThan(steps[i - 1]!);
      expect(steps[i - 1]! - steps[i]!).toBeLessThan(700);
    }
  });

  it("gives two equally skilled people different hands when their temperaments differ", () => {
    const careful = hand(withMan({ skills: skillsOf(50), ageYearsAtStart: 40 }, mindOf({ caution: 85, discipline: 80 }, {})));
    const rash = hand(withMan({ skills: skillsOf(50), ageYearsAtStart: 40 }, mindOf({ caution: 15, discipline: 25 }, {})));
    // The careful one is slower and cheaper; the rash one quicker and dearer.
    expect(careful.delayBps).toBeGreaterThan(rash.delayBps);
    expect(careful.wasteBps).toBeLessThan(rash.wasteBps);
    expect(careful.words).not.toBe(rash.words);
  });

  it("describes only what is marked in the person", () => {
    const plain = hand(withMan({ skills: skillsOf(50), ageYearsAtStart: 35, traits: [] }, mindOf({ honesty: 50, discipline: 50, caution: 50 }, { status: 60, duty: 50, wealth: 50 })));
    const driven = hand(withMan({ skills: skillsOf(30), ageYearsAtStart: 22, traits: ["ambitious"] }, mindOf({ discipline: 30 }, { status: 90 })));
    expect(plain.words).not.toMatch(/hurry|slapdash|meticulous|slowness|new to/);
    expect(driven.words).toMatch(/hurry/);
    expect(driven.words).toMatch(/new to this kind of work/);
    expect(driven.words).toMatch(/slapdash/);
  });
});
