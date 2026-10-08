import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { passage } from "./statecraft";
import { motionsByPower } from "./fiscal-officers";
import { ratifyTheWar } from "./bodies";
import { atDay, carryOut, government, holdersOfOffice, input, opening } from "./government-test-kit";

/**
 * A war needs the Senate.
 *
 * In Rome the consul who would make war lays it before the Senate, and makes it the month after it carries; in Carthage the suffete lays it before the Elders; a king makes
 * his own. A peace is the same. The people ratify the Senate's war, and a little legitimacy comes of it.
 */

const world0 = atDay(opening(), 200);
const ask = (world: WorldState, who: string, polity: string, act: "war" | "peace" | "pacts", label: string) =>
  passage(world, { ...input(world, "none"), nearPlayer: null, pressures: [] }, motionsByPower(world), world.characters.find((c) => c.id === who)!, { id: polity, name: polity }, act, label, ["war"]);

describe("a war needs the Senate", () => {
  it("is laid before the Senate by the consul, who cannot make it himself", () => {
    const [consul] = holdersOfOffice(world0, "roman-consul") as [string];
    const way = ask(world0, consul, "rome", "war", "war be made on Carthage");
    expect(way.how).toBe("asked");
    if (way.how !== "asked") return;
    expect(way.decision.deltas[0]).toMatchObject({ op: "political_procedure_open", institutionRef: "roman-senate", concerns: ["war"] });
    expect(way.decision.why).toMatch(/^asked the Senate that war be made on Carthage/);
    // Applied, it opens the question and starts no war.
    const done = carryOut(world0, way.decision);
    expect(done.rejected).toEqual([]);
    expect(done.world.polityAgreements.some((a) => a.kind === "war" && a.polityId === "rome" && a.otherPolityId === "carthage")).toBe(false);
    // Waiting on the vote, he does not ask again.
    expect(ask(done.world, consul, "rome", "war", "war be made on Carthage").how).toBe("wait");
  });

  it("makes the war the month after the Senate carries it, and rests for a season after it fails", () => {
    const [consul] = holdersOfOffice(world0, "roman-consul") as [string];
    const way = ask(world0, consul, "rome", "war", "war be made on Carthage");
    if (way.how !== "asked") throw new Error("not asked");
    const asked = carryOut(world0, way.decision).world;
    const procedure = asked.material.politicalProcedures.at(-1)!;
    const carried: WorldState = { ...atDay(asked, 215), material: { ...asked.material, politicalProcedures: asked.material.politicalProcedures.map((p) => (p.id === procedure.id ? { ...p, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: 210 } : p)) } };
    expect(ask(carried, consul, "rome", "war", "war be made on Carthage")).toMatchObject({ how: "own", decreed: true });
    const failed: WorldState = { ...carried, material: { ...carried.material, politicalProcedures: carried.material.politicalProcedures.map((p) => (p.id === procedure.id ? { ...p, outcome: "failed" as const } : p)) } };
    expect(ask(failed, consul, "rome", "war", "war be made on Carthage").how).toBe("wait");
  });

  it("is the Elders' in Carthage, and the king's own in Syracuse; and a peace goes the same way", () => {
    const [suffete] = holdersOfOffice(world0, "carthaginian-suffete") as [string];
    const way = ask(world0, suffete, "carthage", "war", "war be made on Rome");
    expect(way.how === "asked" && way.decision.deltas[0]).toMatchObject({ institutionRef: "carthaginian-council" });
    expect(ask(world0, "hieron-ii", "syracuse", "war", "war be made on Carthage").how).toBe("own");
    const [consul] = holdersOfOffice(world0, "roman-consul") as [string];
    expect(ask(world0, consul, "rome", "peace", "peace be made with Carthage").how).toBe("asked");
  });

  it("is ratified by the people once the Senate has carried it, and not twice", () => {
    const [consul] = holdersOfOffice(world0, "roman-consul") as [string];
    const way = ask(world0, consul, "rome", "war", "war be made on Carthage");
    if (way.how !== "asked") throw new Error("not asked");
    const asked = carryOut(world0, way.decision).world;
    const procedure = asked.material.politicalProcedures.at(-1)!;
    const carried: WorldState = { ...asked, material: { ...asked.material, politicalProcedures: asked.material.politicalProcedures.map((p) => (p.id === procedure.id ? { ...p, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: 205 } : p)) } };
    const inputOf = (world: WorldState) => ({ world, offices: government.offices, successionRules: government.successionRules, toDay: 210 });
    const legit = (world: WorldState) => world.material.polityLegitimacy.find((l) => l.polityId === "rome")?.legitimacyBps ?? 0;
    const ratified = ratifyTheWar(inputOf(carried));
    expect(ratified.facts[0]?.summary).toMatch(/The Centuriate Assembly ratified what the Senate had carried/);
    expect(legit(ratified.world)).toBeGreaterThan(legit(carried));
    expect(legit(ratifyTheWar(inputOf(ratified.world)).world)).toBe(legit(ratified.world));
  });
});
