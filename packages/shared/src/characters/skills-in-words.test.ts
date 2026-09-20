import { describe, expect, it } from "vitest";
import { skillsInWords, standingInWords, traitsInWords } from "./skills-in-words";
import type { CharacterSkills } from "./character";

const skills = (overrides: Partial<Omit<CharacterSkills, "subSkills">> = {}): CharacterSkills => ({
  martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50,
  subSkills: {}, ...overrides,
});

describe("what a man's contemporaries would say of him", () => {
  it("says what he is good at and what he is not, in words", () => {
    const said = skillsInWords(skills({ martial: 82, stewardship: 20 }));
    expect(said.join(", ")).toContain("soldier");
    expect(said.join(", ")).toContain("administrator");
    expect(said.join(", ")).not.toMatch(/\d/);
  });

  it("says nothing about a weakness that is not one", () => {
    // "A sound soldier and a sound administrator" says nothing at all.
    expect(skillsInWords(skills({ martial: 62 }))).toHaveLength(1);
  });

  it("keeps it to two or three things, never a sheet with the numbers filed off", () => {
    const said = skillsInWords(skills({ martial: 95, intrigue: 92, learning: 90, diplomacy: 88, stewardship: 5 }));
    expect(said.length).toBeLessThanOrEqual(3);
  });

  it("gets its articles right, because this is read as prose", () => {
    expect(skillsInWords(skills({ martial: 42, stewardship: 10 }))[0]).toMatch(/^an unremarkable /);
    expect(skillsInWords(skills({ martial: 70, stewardship: 10 }))[0]).toMatch(/^a capable /);
  });

  it("describes standing as a standing rather than a score", () => {
    expect(standingInWords(9_000)).not.toMatch(/\d/);
    expect(standingInWords(9_000)).not.toBe(standingInWords(1_000));
  });

  it("gives a trait the word other people would use for it", () => {
    expect(traitsInWords(["bold", "dutiful"])).toEqual(["Bold", "Dutiful"]);
    // A scenario may author a trait this registry has never heard of.
    expect(traitsInWords(["lugubrious"])).toEqual(["lugubrious"]);
  });
});
