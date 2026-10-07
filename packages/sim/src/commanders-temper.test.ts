import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type Character } from "@chronica/shared";
import { commandersTemper } from "./statecraft";

const first = (): Character => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)).characters[0]!;

function general(martial: number, boldness: number): Character {
  const c = first();
  return { ...c, skills: { ...c.skills, martial, subSkills: { ...c.skills.subSkills, strategist: martial } }, mind: { ...c.mind, temperament: { ...c.mind.temperament, boldness } } };
}

describe("what a commander makes of the odds", () => {
  it("lets a veteran take a fight a poor general would refuse", () => {
    expect(commandersTemper(general(90, 50)).wants).toBeLessThan(commandersTemper(general(20, 50)).wants);
  });

  it("makes a reckless beginner want lower odds and a cautious one more, and the reckless one hold when he should fall back", () => {
    const reckless = commandersTemper(general(25, 90));
    const careful = commandersTemper(general(25, 10));
    expect(reckless.wants).toBeLessThan(careful.wants);
    expect(reckless.flees).toBeGreaterThan(careful.flees);
  });

  it("reads an absent commander as middling", () => {
    expect(commandersTemper(undefined)).toEqual({ wants: 1, flees: 1 });
  });
});
