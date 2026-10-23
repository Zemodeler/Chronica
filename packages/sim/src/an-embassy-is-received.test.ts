import { describe, expect, it } from "vitest";
import { warStanding, type WorldState } from "@chronica/shared";
import { answerByRule } from "./statecraft";
import { atDay, carryOut, decideTheMonth, input, opening, withWar } from "./government-test-kit";

/**
 * An embassy is received.
 *
 * A power that is losing a war sends envoys to ask for talks, in the hand of the man who keeps its letters; the power written to receives them by the man who keeps
 * its letters too (the consul, in Rome), and answers by his temper. Not for a power the player rules, nor when envoys went lately.
 */

/** Carthage at war with Rome and with no army left in the field. */
function carthageBeaten(): WorldState {
  const world = withWar(opening(), "rome", "carthage");
  return { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.polityId !== "carthage") } };
}
const embassies = (world: WorldState, day: number, polityId = "carthage") => decideTheMonth(atDay(world, day), day).filter((d) => d.polityId === polityId && /^embassy/.test(d.why));

describe("an embassy is received", () => {
  it("is sent by the power that is losing, in the hand of a man of its own", () => {
    const world = carthageBeaten();
    expect(warStanding(atDay(world, 200), "carthage", "rome").score).toBeLessThanOrEqual(-20);
    let found: ReturnType<typeof embassies>[number] | undefined;
    let when = 0;
    for (let day = 150; day <= 450 && found === undefined; day += 30) { found = embassies(world, day)[0]; when = day; }
    expect(found, "the envoys go within a season or two").toBeDefined();
    expect(found!.targetPolityId).toBe("rome");
    expect(found!.deltas[0]).toMatchObject({ op: "diplomatic_message_send", kind: "peace_talks", fromPolityId: "carthage", toPolityId: "rome" });
    expect(world.characters.find((c) => c.id === found!.actorCharacterId)?.polityId).toBe("carthage");
    const done = carryOut(atDay(world, when), found!);
    expect(done.rejected).toEqual([]);
    expect(done.world.diplomacy.at(-1)).toMatchObject({ kind: "peace_talks", toPolityId: "rome" });
    // Not again while the envoys are on the road.
    expect(embassies(done.world, when + 30)).toEqual([]);
  });

  it("is received by Rome's consul, the man who keeps its letters, and answered by rule", () => {
    const world = carthageBeaten();
    let sent: ReturnType<typeof carryOut> | undefined;
    for (let day = 150; day <= 450 && sent === undefined; day += 30) {
      const [decision] = embassies(world, day);
      if (decision !== undefined) sent = carryOut(atDay(world, day), decision);
    }
    expect(sent).toBeDefined();
    const there = atDay(sent!.world, sent!.world.instant.day + 12);
    const message = there.diplomacy.find((m) => m.kind === "peace_talks" && m.toPolityId === "rome")!;
    const rome = input(there, "none");
    const answer = answerByRule(there, { ...message, deliveredOnDay: there.instant.day - 1 }, { ...rome, nearPlayer: null, pressures: [] }, (id) => (id === "rome" ? there.characters.find((c) => /consul|rome/.test(c.id) && c.polityId === "rome" && there.material.officeSeats.some((s) => s.holderCharacterId === c.id && s.officeId === "roman-consul")) : undefined));
    if (answer !== null) {
      const consuls = there.material.officeSeats.filter((s) => s.officeId === "roman-consul").map((s) => s.holderCharacterId);
      expect(consuls).toContain(answer.actorCharacterId);
      expect(answer.deltas[0]).toMatchObject({ op: "diplomatic_message_answer" });
    }
  });

  it("is not the rules' to send for a power the player rules", () => {
    const world = carthageBeaten();
    for (let day = 150; day <= 450; day += 30) expect(decideTheMonth(atDay(world, day), day, { player: "carthage" }).filter((d) => d.polityId === "carthage")).toEqual([]);
  });
});
