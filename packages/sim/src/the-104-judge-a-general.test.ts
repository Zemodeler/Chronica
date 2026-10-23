import { describe, expect, it } from "vitest";
import { type BattleResult, type WorldState } from "@chronica/shared";
import { agendaOf, keepTheBodies } from "./bodies";
import { holdVotes } from "./senate";
import { createIdFactory } from "./ports";
import { summonToJudgment } from "./trials";
import { atDay, government, opening } from "./government-test-kit";

/**
 * The Hundred and Four judge a general.
 *
 * A Carthaginian general who lost is summoned before the Tribunal; on the day the court counts its judges' votes, with its own blocs, its quorum and its majority, and the
 * sentence follows the count: acquitted, or fined and put out of office, or put to death. The court takes two cases a sitting.
 */

const hannoWorld = (): { world: WorldState; force: WorldState["material"]["forces"][number] } => {
  const world = opening();
  const force = world.material.forces.find((f) => f.polityId === "carthage" && f.commanderCharacterId === "hanno-carthage") ?? { ...world.material.forces[0]!, id: "hanno-army", polityId: "carthage", commanderCharacterId: "hanno-carthage" };
  return { world: world.material.forces.some((f) => f.id === force.id) ? world : { ...world, material: { ...world.material, forces: [...world.material.forces, force] } }, force };
};
const result = { battleId: "battle-himera", outcome: "defender_victory" } as unknown as BattleResult;

describe("the Hundred and Four judge a general", () => {
  it("takes two cases a sitting, as a court of judges does", () => {
    expect(agendaOf(opening().material.institutions.find((i) => i.id === "carthaginian-hundred-and-four")!)).toBe(2);
  });

  it("summons him, counts the court on its day, and sentences by the count", () => {
    const { world, force } = hannoWorld();
    const routed: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.filter((f) => f.id !== force.id) } };
    const summoned = summonToJudgment(atDay(routed, 200), result, [force], "Himera");
    const trial = summoned.world.material.politicalProcedures.at(-1)!;
    expect(trial.institutionId).toBe("carthaginian-hundred-and-four");
    const day = trial.deadlineStep! + 1;
    const input = { world: atDay(summoned.world, day), offices: government.offices, successionRules: government.successionRules, toDay: day };
    const sat = keepTheBodies(input);
    const counted = holdVotes({ ...input, world: sat.world, ids: createIdFactory("the-104") });
    const settled = counted.world.material.politicalProcedures.find((p) => p.id === trial.id)!;
    expect(["resolved", "blocked"]).toContain(settled.stage);
    if (settled.stage === "resolved") {
      expect(["passed", "failed"]).toContain(settled.outcome);
      expect(counted.world.material.voteRecords.at(-1)).toMatchObject({ motionId: trial.id });
      const hanno = counted.world.characters.find((c) => c.id === "hanno-carthage")!;
      if (settled.outcome === "passed") expect(hanno.alive).toBe(false);
      else expect(hanno.alive).toBe(true);
      expect(counted.facts.some((f) => /The Tribunal of the Hundred and Four (carried|rejected)/.test(f.summary))).toBe(true);
    }
  });
});
