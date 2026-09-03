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
