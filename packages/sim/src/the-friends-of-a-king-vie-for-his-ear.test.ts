import { describe, expect, it } from "vitest";
import { ENVY_AT, favouriteOf, friendsOf, keepTheCourtRivalries, MOST_RIVALS } from "./court-rivalry";
import { holdersOfOffice, ill, opening } from "./government-test-kit";
import { computeOpinion } from "@chronica/shared";

/**
 * The friends of a king vie for his ear.
 *
 * At a king's court the man who keeps the revenues is the one the others envy: a friend who thinks ill of him comes to want him put out of the king's favour,
 * made of the opinions the men already have. A republic has no such court, and the want goes when the favourite does or the friend's mind changes.
 */
describe("the friends of a king vie for his ear", () => {
  const world = opening();
  const dioiketes = holdersOfOffice(world, "ptolemaic-egypt:dioiketes")[0]!;
  const friends = holdersOfOffice(world, "ptolemaic-egypt:councillor");
  const wants = (w: typeof world, id: string) => w.characters.find((c) => c.id === id)!.ambitions.filter((a) => a.status === "active" && a.id.startsWith("envy-"));

  it("makes the officer of the revenues the favourite, and the friends of the king his friends", () => {
    expect(favouriteOf(world, "ptolemaic-egypt")?.id).toBe(dioiketes);
    expect(friendsOf(world, "ptolemaic-egypt").map((c) => c.id)).toEqual(expect.arrayContaining(friends));
  });

  it("sets a friend who thinks ill of him against him, and nobody who does not", () => {
    const quarrel = ill(world, friends[0]!, dioiketes, -80);
    const done = keepTheCourtRivalries(quarrel);
    expect(computeOpinion(quarrel.characters.find((c) => c.id === friends[0])!, dioiketes)).toBeLessThanOrEqual(ENVY_AT);
    expect(wants(done, friends[0]!)).toMatchObject([{ kind: "office", targetId: dioiketes, label: expect.stringMatching(/king's favour/) as unknown }]);
    expect(wants(done, friends[1]!)).toEqual([]);
    // Once, not every month.
    expect(wants(keepTheCourtRivalries(done), friends[0]!)).toHaveLength(1);
  });

  it("lets the want go when the friend has made it up, and takes no more than the most", () => {
    const quarrelled = friends.slice(0, 4).reduce((w, id) => ill(w, id, dioiketes, -80), world);
    const done = keepTheCourtRivalries(quarrelled);
    const against = friends.filter((id) => wants(done, id).length > 0);
    expect(against.length).toBe(Math.min(MOST_RIVALS, 4));
    const mended = { ...done, characters: done.characters.map((c) => (c.id === against[0] ? { ...c, relations: [] } : c)) };
    expect(wants(keepTheCourtRivalries(mended), against[0]!)).toEqual([]);
  });

  it("is a court's affair: no republic has it, and the same on every run", () => {
    const rome = ill(world, holdersOfOffice(world, "roman-senator")[0]!, holdersOfOffice(world, "roman-consul")[0]!, -90);
    expect(keepTheCourtRivalries(rome).characters.flatMap((c) => c.ambitions).filter((a) => a.id.startsWith("envy-") && a.targetId === holdersOfOffice(world, "roman-consul")[0]!)).toEqual([]);
    const quarrel = ill(world, friends[0]!, dioiketes, -80);
    expect(JSON.stringify(keepTheCourtRivalries(quarrel))).toBe(JSON.stringify(keepTheCourtRivalries(structuredClone(quarrel))));
  });
});
