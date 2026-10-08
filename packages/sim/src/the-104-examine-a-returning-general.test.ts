import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { examineTheReturned, keepTheAccounts } from "./close-of-office";
import { holdVotes } from "./senate";
import { keepTheBodies } from "./bodies";
import { createIdFactory } from "./ports";
import { atDay, government, opening } from "./accounts-test-kit";

/**
 * The Hundred and Four examine a general who comes home.
 *
 * Carthage did not wait for a battle to ask a general what he had done: when he came home the Hundred and Four examined him, and one who had lost an army was
 * crucified. A man who left no marks against him is approved and a little the better for it; one with a defeat or a breach is called before the court; one who
 * lost his army answers with his life. A man the court has already summoned this year is not examined twice.
 */
const home = (world: WorldState, manId: string): WorldState => {
  const capital = world.map.polities.find((p) => p.id === "carthage")!.capitalSettlementId;
  const province = world.map.provinces.find((p) => p.settlements.some((s) => s.id === capital))!;
  // He has laid down his army: the forces he led are gone from his hand.
  const forces = world.material.forces.filter((f) => f.commanderCharacterId !== manId && f.controllerCharacterId !== manId);
  return { ...world, material: { ...world.material, forces }, characters: world.characters.map((c) => (c.id === manId ? { ...c, prestigeBps: 5_000, locationProvinceId: province.id } : c)) };
};
const marked = (world: WorldState, manId: string, weight: number): WorldState => ({
  ...world, answerable: [...world.answerable, { characterId: manId, polityId: "carthage", kind: "defeat" as const, label: "lost his army at Agrigentum", atStep: 150, weight }],
});
const asked = (world: WorldState, day: number) => examineTheReturned({ world: atDay(world, day), offices: government.offices, toDay: day, ids: createIdFactory("e"), endedTerms: [] });

describe("the Hundred and Four examine a returning general", () => {
  // The general of Carthage with no army in the field (the opening gives Hanno none to lead) and home.
  const general = "hanno-carthage";
  const base = home(opening(200), general);

  it("approves a general who has nothing against him, and makes his name a little better", () => {
    const before = base.characters.find((c) => c.id === general)!.prestigeBps;
    const done = asked(base, 210);
    expect(done.world.material.politicalProcedures.some((p) => p.subjectId === general && p.type === "denunciation")).toBe(false);
    expect(done.world.characters.find((c) => c.id === general)!.prestigeBps).toBeGreaterThan(before);
    expect(done.world.statecraft.log.at(-1)?.why).toMatch(/^examination: .*found nothing against him/);
  });

  it("calls a general with a defeat against him before the court, for a fine", () => {
    const done = asked(marked(base, general, 2), 210);
    const case_ = done.world.material.politicalProcedures.find((p) => p.subjectId === general && p.type === "denunciation");
    expect(case_).toMatchObject({ institutionId: "carthaginian-hundred-and-four", sentence: "fine", concerns: ["punishment"] });
    expect(done.facts.map((f) => f.kind)).toEqual(["examination"]);
    expect(done.world.answerable.filter((e) => e.characterId === general)).toEqual([]);
  });

  it("asks a general who lost an army for his life, and the court may give it", () => {
    const done = asked(marked(base, general, 5), 210);
    const case_ = done.world.material.politicalProcedures.find((p) => p.subjectId === general && p.type === "denunciation")!;
    expect(case_.sentence).toBe("death");
    expect(done.facts[0]!.summary).toMatch(/his life/);
    const day = case_.deadlineStep! + 1;
    const input = { world: atDay(done.world, day), offices: government.offices, successionRules: government.successionRules, toDay: day };
    const sat = keepTheBodies(input);
    const counted = holdVotes({ ...input, world: sat.world, ids: createIdFactory("the-104-return") });
    const settled = counted.world.material.politicalProcedures.find((p) => p.id === case_.id)!;
    expect(["resolved", "blocked"]).toContain(settled.stage);
  });

  it("does not examine a man twice in a year, nor one still in the field, nor one already summoned", () => {
    const once = asked(marked(base, general, 2), 210);
    expect(asked(marked(once.world, general, 2), 260).facts).toEqual([]);
    const away = { ...marked(base, general, 2), characters: base.characters.map((c) => (c.id === general ? { ...c, locationProvinceId: base.map.provinces.find((p) => p.controllerPolityId === "rome")!.id } : c)) };
    expect(asked(away, 210).facts).toEqual([]);
  });

  it("is monthly, and only for a power that examines", () => {
    const reviewed = (world: WorldState) => ({ ...world, society: { ...world.society, lastReviewStep: 200 } });
    const early = keepTheAccounts({ world: atDay(reviewed(marked(base, general, 2)), 211), offices: government.offices, toDay: 211, ids: createIdFactory("k"), endedTerms: [] });
    expect(early.facts).toEqual([]);
    const monthEnd = keepTheAccounts({ world: atDay(reviewed(marked(base, general, 2)), 240), offices: government.offices, toDay: 240, ids: createIdFactory("k"), endedTerms: [] });
    expect(monthEnd.facts.map((f) => f.kind)).toEqual(["examination"]);
    const romans = asked({ ...base, answerable: [{ characterId: "gaius-genucius", polityId: "rome", kind: "defeat" as const, label: "beaten", atStep: 100, weight: 5 }] }, 240);
    expect(romans.facts).toEqual([]);
  });

  it("is the same on every run", () => {
    const a = asked(marked(base, general, 5), 210);
    const b = asked(structuredClone(marked(base, general, 5)), 210);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
