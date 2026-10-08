import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { atDay, carryOut, decideTheMonth, opening } from "./government-test-kit";
import { courtOf } from "./magistrates";

/**
 * A praetor hears the case.
 *
 * Where an audit has found a man's hand in the chest, the man who keeps the courts (the praetor in Rome) sets a day for the case before the court that judges
 * the power's men: the Senate or the people in Rome, the Hundred and Four in Carthage. Once for a man, a month at most, and nothing for a man nobody found out.
 */

function withTheft(world: WorldState, polityId: string, foundAt: number | null): { world: WorldState; thief: string } {
  const thief = world.characters.find((c) => c.alive && c.polityId === polityId && !world.material.officeSeats.some((s) => s.holderCharacterId === c.id && /praetor/.test(s.officeId)))!;
  const account = world.material.accounts.find((a) => a.owner.id === polityId)!;
  return {
    thief: thief.id,
    world: { ...world, diversions: [...world.diversions, { id: "diversion-test", byCharacterId: thief.id, scope: { kind: "polity", id: polityId }, departmentId: null, amount: 9_000, toAccountId: account.id, firstAtStep: 40, lastAtStep: 90, foundAtStep: foundAt }] },
  };
}
const cases = (world: WorldState, day: number, polityId: string) => decideTheMonth(atDay(world, day), day).filter((d) => d.polityId === polityId && /^justice/.test(d.why));
/** The first of the months from the day on in which the praetor has the case up: a slow man is a month late. */
const firstCase = (world: WorldState, polityId: string, from = 150) => { for (let day = from; day <= from + 270; day += 30) { const [found] = cases(world, day, polityId); if (found !== undefined) return { day, found }; } return undefined; };

describe("a praetor hears the case", () => {
  it("brings the case of a man an audit found out, before the court that judges: Rome's Senate", () => {
    const { world, thief } = withTheft(opening(), "rome", 100);
    expect(courtOf(world, "rome")).toMatchObject({ id: "roman-senate" });
    const opened = firstCase(world, "rome");
    expect(opened).toBeDefined();
    const found = opened!.found;
    const praetors = world.material.officeSeats.filter((s) => /praetor/.test(s.officeId)).map((s) => s.holderCharacterId);
    expect(praetors).toContain(found.actorCharacterId);
    expect(found.deltas[0]).toMatchObject({ op: "political_procedure_open", type: "denunciation", subjectRef: thief, concerns: ["punishment"] });
    const done = carryOut(atDay(world, opened!.day), found);
    expect(done.rejected).toEqual([]);
    expect(done.world.material.politicalProcedures.at(-1)).toMatchObject({ type: "denunciation", subjectId: thief, institutionId: "roman-senate" });
    // Not twice for the same man.
    expect(cases(done.world, opened!.day + 30, "rome")).toEqual([]);
  });

  it("leaves a man nobody has found out, and a theft found long ago", () => {
    expect(cases(withTheft(opening(), "rome", null).world, 150, "rome")).toEqual([]);
    expect(cases(withTheft(opening(), "rome", 100).world, 600, "rome")).toEqual([]);
  });

  it("sends Carthage's cases to the Hundred and Four", () => {
    const { world } = withTheft(opening(), "carthage", 100);
    expect(courtOf(world, "carthage")).toMatchObject({ id: "carthaginian-hundred-and-four" });
    const found = firstCase(world, "carthage")?.found;
    expect(found).toBeDefined();
    if (found !== undefined) expect(found.deltas[0]).toMatchObject({ institutionRef: "carthaginian-hundred-and-four" });
  });
});
