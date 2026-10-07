import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { CharacterMindSchema, NEUTRAL_MIND, deriveDefaultMind } from "./mind";

describe("NEUTRAL_MIND", () => {
  it("is a structurally valid mind", () => {
    expect(() => CharacterMindSchema.parse(NEUTRAL_MIND)).not.toThrow();
  });
});

describe("deriveDefaultMind", () => {
  const world = () => structuredClone(firstPunicWarScenario.initialWorld);

  it("is deterministic for the same inputs", () => {
    const marcus = world().characters.find((c) => c.id === "marcus-atilius")!;
    const a = deriveDefaultMind({ officeId: marcus.officeId, skills: marcus.skills, ageYears: 30, cultureId: marcus.cultureId });
    const b = deriveDefaultMind({ officeId: marcus.officeId, skills: marcus.skills, ageYears: 30, cultureId: marcus.cultureId });
    expect(a).toEqual(b);
  });

  it("produces a structurally valid mind", () => {
    const marcus = world().characters.find((c) => c.id === "marcus-atilius")!;
    const mind = deriveDefaultMind({ officeId: marcus.officeId, skills: marcus.skills, ageYears: 30, cultureId: marcus.cultureId });
    expect(() => CharacterMindSchema.parse(mind)).not.toThrow();
  });

  it("gives higher boldness and risk tolerance to a high-martial character than a low-martial one", () => {
    const highMartial = deriveDefaultMind({
      officeId: null,
      skills: { martial: 90, intrigue: 40, learning: 40, piety: 40, stewardship: 40, diplomacy: 40, body: 40, subSkills: {} },
      ageYears: 30,
      cultureId: "roman",
    });
    const lowMartial = deriveDefaultMind({
      officeId: null,
      skills: { martial: 10, intrigue: 40, learning: 40, piety: 40, stewardship: 40, diplomacy: 40, body: 40, subSkills: {} },
      ageYears: 30,
      cultureId: "roman",
    });
    expect(highMartial.temperament.boldness).toBeGreaterThan(lowMartial.temperament.boldness);
    expect(highMartial.riskTolerance).toBeGreaterThan(lowMartial.riskTolerance);
  });

  it("gives an office-holder higher status drive and caution than one without office", () => {
    const skills = { martial: 40, intrigue: 40, learning: 40, piety: 40, stewardship: 40, diplomacy: 40, body: 40, subSkills: {} };
    const withOffice = deriveDefaultMind({ officeId: "consul", skills, ageYears: 30, cultureId: "roman" });
    const withoutOffice = deriveDefaultMind({ officeId: null, skills, ageYears: 30, cultureId: "roman" });
    expect(withOffice.drives.status).toBeGreaterThan(withoutOffice.drives.status);
    expect(withOffice.temperament.caution).toBeGreaterThan(withoutOffice.temperament.caution);
  });
});

describe("generated people are varied at every age", () => {
  const skills = { martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: {} };
  const make = (id: string, ageYears: number) => deriveDefaultMind({ id, officeId: null, skills, ageYears, cultureId: "roman" });

  it("spreads every part of the mind across most of its range, not around fifty", () => {
    const minds = Array.from({ length: 400 }, (_, i) => make(`npc-${i}`, 35));
    for (const part of ["boldness", "caution", "honesty", "sociability", "discipline", "cruelty"] as const) {
      const values = minds.map((mind) => mind.temperament[part]);
      expect(Math.min(...values)).toBeLessThan(20);
      expect(Math.max(...values)).toBeGreaterThan(80);
      expect(values.filter((value) => value >= 40 && value <= 60).length).toBeLessThan(minds.length * 0.5);
    }
    for (const part of ["security", "status", "wealth", "family", "faith", "duty", "revenge"] as const) {
      const values = minds.map((mind) => mind.drives[part]);
      expect(Math.min(...values)).toBeLessThan(20);
      expect(Math.max(...values)).toBeGreaterThan(80);
    }
  });

  it("is just as varied among the old as among the young, and does not make the old timid", () => {
    const young = Array.from({ length: 400 }, (_, i) => make(`npc-${i}`, 25));
    const old = Array.from({ length: 400 }, (_, i) => make(`npc-${i}`, 70));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(old.map((m) => m.temperament.boldness)) - mean(young.map((m) => m.temperament.boldness)))).toBeLessThan(3);
    expect(old.filter((m) => m.temperament.boldness >= 75).length).toBeGreaterThan(20);
    expect(old.filter((m) => m.temperament.boldness <= 25).length).toBeGreaterThan(20);
  });

  it("is the same for the same person every time, and different between people", () => {
    expect(make("npc-7", 40)).toEqual(make("npc-7", 40));
    expect(make("npc-7", 40)).not.toEqual(make("npc-8", 40));
  });

  it("does not make one part of a person follow another", () => {
    const minds = Array.from({ length: 400 }, (_, i) => make(`npc-${i}`, 40));
    const bold = minds.filter((m) => m.temperament.boldness >= 70);
    // Among the bold, some are cautious anyway, some greedy and some not.
    expect(bold.some((m) => m.temperament.caution >= 65)).toBe(true);
    expect(bold.some((m) => m.temperament.caution <= 35)).toBe(true);
    expect(bold.some((m) => m.drives.wealth >= 70)).toBe(true);
    expect(bold.some((m) => m.drives.wealth <= 30)).toBe(true);
  });
});
