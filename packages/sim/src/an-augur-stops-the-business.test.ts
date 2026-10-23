import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { OMEN_ODDS, theAuspices } from "./bodies";
import { atDay, government, holdersOfOffice, ill, opening, question } from "./government-test-kit";

/**
 * An augur stops the business.
 *
 * Before a question goes to the people, an augur who sees bad omens puts the assembly off a month (*obnuntiatio*): once for a question, more often against a man he thinks ill of,
 * never for the Senate's business, and never in the player's own mouth.
 */

const day = 200;
const input = (world: WorldState, player: string | null = null) => ({ world, offices: government.offices, successionRules: government.successionRules, toDay: day, playerCharacterId: player });
function manyQuestions(bodyId: string, count = 150): WorldState {
  let world = atDay(opening(), day);
  const [sponsor] = holdersOfOffice(world, "roman-consul") as [string];
  for (let n = 0; n < count; n += 1) world = question(world, { id: `law-${n}`, bodyId, sponsor, label: `Motion of a consul: that law ${n} be passed`, concerns: ["land"], openedAt: 150, votesOn: day });
  return world;
}
const stopped = (world: WorldState) => world.material.politicalProcedures.filter((p) => (p.adjournments ?? 0) > 0);

describe("an augur stops the business", () => {
  it("puts some of the people's business off a month, about as the odds say, and tells it", () => {
    const stoppedHere = theAuspices(input(manyQuestions("roman-comitia-centuriata")));
    const n = stopped(stoppedHere.world);
    expect(n.length).toBeGreaterThan(0);
    expect(n.length).toBeLessThan(150 * ((OMEN_ODDS + 18) / 100));
    expect(n.every((p) => p.deadlineStep === day + 30 && /ill omens/.test(p.outcomeReason ?? ""))).toBe(true);
    expect(stoppedHere.facts.length).toBe(n.length);
    expect(stoppedHere.facts[0]!.summary).toMatch(/as .*, reported ill omens before the assembly met/);
  });

  it("does not stop the Senate, nor a question twice", () => {
    expect(stopped(theAuspices(input(manyQuestions("roman-senate"))).world)).toEqual([]);
    const once = theAuspices(input(manyQuestions("roman-comitia-centuriata"))).world;
    const again = theAuspices({ ...input(once), toDay: day + 30 });
    expect(stopped(again.world).length).toBe(stopped(once).length);
  });

  it("stops more against a man the augur thinks ill of", () => {
    const base = manyQuestions("roman-comitia-centuriata");
    const [consul] = holdersOfOffice(base, "roman-consul") as [string];
    let hated = base;
    for (const id of holdersOfOffice(base, "roman-augur")) hated = ill(hated, id, consul, -80);
    expect(stopped(theAuspices(input(hated)).world).length).toBeGreaterThan(stopped(theAuspices(input(base)).world).length);
  });

  it("does not stop a thing when the only augur is the player", () => {
    const base = manyQuestions("roman-comitia-centuriata");
    const augurs = holdersOfOffice(base, "roman-augur");
    let one = base;
    // Every augur but one is gone from the seats; that one is the player.
    one = { ...one, material: { ...one.material, officeSeats: one.material.officeSeats.map((s) => (s.officeId === "roman-augur" && s.holderCharacterId !== augurs[0] ? { ...s, holderCharacterId: null, status: "vacant" as const } : s)) } };
    expect(stopped(theAuspices(input(one, augurs[0])).world)).toEqual([]);
  });
});
