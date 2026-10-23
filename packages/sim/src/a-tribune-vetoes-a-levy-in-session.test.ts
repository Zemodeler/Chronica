import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { keepTheBodies, opposition } from "./bodies";
import { holdVotes } from "./senate";
import { createIdFactory } from "./ports";
import { atDay, government, holdersOfOffice, ill, opening, question } from "./government-test-kit";

/**
 * A tribune vetoes a levy in session.
 *
 * On the day a question comes up, a tribune who has said nothing of it and whom nobody plays takes his side by rule: against a burden on the plebs (a levy, a tax) moved by a
 * consul he thinks ill of, he forbids it, and the Senate cannot put it. A question that asks nothing of the plebs, from a man he trusts, he lets be. The player's own tribune is
 * never made to speak.
 */

const day = 200;
const input = (world: WorldState, player: string | null = null) => ({ world, offices: government.offices, successionRules: government.successionRules, toDay: day, playerCharacterId: player });
function levyBefore(concerns: readonly string[], label: string): { world: WorldState; consul: string; tribunes: string[] } {
  const world = atDay(opening(), day);
  const [consul] = holdersOfOffice(world, "roman-consul") as [string];
  const tribunes = holdersOfOffice(world, "roman-tribune");
  return { world: question(world, { id: "levy-1", bodyId: "roman-senate", sponsor: consul, label, concerns, openedAt: 190, votesOn: day }), consul, tribunes };
}
const ofQuestion = (world: WorldState) => world.material.politicalProcedures.find((p) => p.id === "levy-1")!;

describe("a tribune vetoes a levy in session", () => {
  it("is moved most by a burden moved by a man he thinks ill of", () => {
    const { world, consul, tribunes } = levyBefore(["levy", "taxes"], "Motion of a consul: that a levy of six legions be held and a war tax laid");
    const proc = ofQuestion(world);
    const tribune = world.characters.find((c) => c.id === tribunes[0])!;
    const friend = opposition(world, tribune, proc);
    let hated = world;
    for (const id of tribunes) hated = ill(hated, id, consul);
    const foe = opposition(hated, hated.characters.find((c) => c.id === tribunes[0])!, proc);
    expect(foe).toBeGreaterThan(friend);
    const plain = levyBefore(["religion"], "Motion of a consul: that the rites be kept");
    expect(opposition(plain.world, plain.world.characters.find((c) => c.id === plain.tribunes[0])!, ofQuestion(plain.world))).toBeLessThan(foe);
  });

  it("forbids it in session, and the Senate cannot put it", () => {
    const { world, consul, tribunes } = levyBefore(["levy", "taxes", "war"], "Motion of a consul: that a levy of six legions be held and a war tax laid");
    let hated = world;
    for (const id of tribunes) hated = ill(hated, id, consul, -90);
    const sat = keepTheBodies(input(hated));
    const spoke = sat.world.material.supportPositions.filter((p) => p.procedureId === "levy-1" && p.position === "oppose");
    expect(spoke.length).toBeGreaterThan(0);
    expect(tribunes).toContain(spoke[0]!.supporterId);
    const voted = holdVotes({ ...input(sat.world), ids: createIdFactory("veto") });
    expect(ofQuestion(voted.world)).toMatchObject({ stage: "blocked", outcome: "blocked" });
    expect(voted.facts.some((f) => f.kind === "motion_vetoed")).toBe(true);
  });

  it("does not make the player's own tribune speak", () => {
    const { world, consul, tribunes } = levyBefore(["levy", "taxes", "war"], "Motion of a consul: that a levy of six legions be held and a war tax laid");
    let hated = world;
    for (const id of tribunes) hated = ill(hated, id, consul, -90);
    const sat = keepTheBodies(input(hated, tribunes[0]));
    expect(sat.world.material.supportPositions.some((p) => p.procedureId === "levy-1" && p.supporterId === tribunes[0])).toBe(false);
  });
});
