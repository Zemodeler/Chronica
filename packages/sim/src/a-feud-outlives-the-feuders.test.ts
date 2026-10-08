import { describe, expect, it } from "vitest";
import { feudBetween, gensById } from "@chronica/shared";
import { FEUD_BEGINS_BPS, FEUD_COOLS_BPS_PER_MONTH, keepGentes } from "./gentes";
import { FEUD_VOTE_MAX, kinOf, leanAsAGens } from "./gens-loyalty";
import { killCharacter } from "./mortality";
import { named, opening, thinks, withDay } from "./gentes-test-kit";

/**
 * A grudge between two men, if it was deep enough and lasted, became a grudge between their families: the Cornelii did not forgive
 * Fabricius his censorship of 275, and their sons did not. It cools by itself, slowly, is fed by the living, and turns a man of one
 * gens against a motion moved by the other's, by a bounded measure.
 */
describe("a feud outlives the feuders", () => {
  const start = opening();

  it("opens with the grudges the sources attest, both ways", () => {
    expect(feudBetween(start, "gens-cornelius", "gens-fabricius")).toBeGreaterThan(0);
    const fabricii = gensById(start, "gens-fabricius")!;
    expect(fabricii.feuds[0]!.reason).toMatch(/ten pounds of silver/);
    expect(feudBetween(start, "gens-fabius", "gens-claudius")).toBeGreaterThan(0);
  });

  it("is made by a living man's deep and lasting ill will toward a man of another gens", () => {
    const a = named(start, "Gaius Claudius Canina");
    const b = named(start, "Lucius Postumius Megellus");
    expect(feudBetween(start, "gens-claudius", "gens-postumius")).toBe(0);
    const hated = thinks(start, a.id, b.id, -80);
    const kept = keepGentes(withDay(hated, 30), 30);
    expect(feudBetween(kept.world, "gens-claudius", "gens-postumius")).toBeGreaterThanOrEqual(FEUD_BEGINS_BPS);
    expect(kept.facts.some((fact) => fact.kind === "gens_feud" && /Claudii/.test(fact.summary))).toBe(true);
  });

  it("cools a little each month, and is still there when both the men who made it are dead", () => {
    const a = named(start, "Gaius Claudius Canina");
    const b = named(start, "Lucius Postumius Megellus");
    let world = keepGentes(withDay(thinks(start, a.id, b.id, -80), 30), 30).world;
    const first = gensById(world, "gens-claudius")!.feuds.find((feud) => feud.againstGensId === "gens-postumius")!.intensityBps;
    // They die; nobody is left to feed it.
    world = killCharacter(withDay(world, 40), a.id, "a fever", 40).world;
    world = killCharacter(world, b.id, "a fever", 41).world;
    world = keepGentes(withDay(world, 70), 70).world;
    const second = gensById(world, "gens-claudius")!.feuds.find((feud) => feud.againstGensId === "gens-postumius")!.intensityBps;
    expect(second).toBeLessThan(first);
    expect(first - second).toBeLessThanOrEqual(FEUD_COOLS_BPS_PER_MONTH + 450);
    // Years on, still hot.
    for (let month = 3; month <= 24; month += 1) world = keepGentes(withDay(world, month * 30 + 10), month * 30 + 10).world;
    const later = gensById(world, "gens-claudius")!.feuds.find((feud) => feud.againstGensId === "gens-postumius")!;
    expect(later.intensityBps).toBeGreaterThan(0);
    expect(later.intensityBps).toBeLessThan(second);
    expect(world.characters.find((character) => character.id === a.id)!.alive).toBe(false);
  });

  it("burns out in the end if nobody stokes it", () => {
    let world = start;
    // The Fabii's old grudge against the Claudii, left to itself for forty years.
    for (let month = 1; month <= 480; month += 1) world = keepGentes(withDay(world, month * 30), month * 30).world;
    expect(feudBetween(world, "gens-fabius", "gens-claudius")).toBe(0);
  });

  it("turns a man of one gens against a motion of the other's, by at most a tenth of the scale", () => {
    const fabricius = named(start, "Gaius Fabricius Luscinus");
    const kin = kinOf(start, { sponsorCharacterId: fabricius.id })!;
    const seats = [{ gensId: "gens-cornelius" }, { gensId: "gens-cornelius" }, { gensId: "gens-valerius" }, {}];
    const leans = leanAsAGens(seats, [20, 20, 20, 20], kin);
    expect(leans[0]).toBeLessThan(20);
    expect(leans[0]).toBe(leans[1]);
    expect(20 - leans[0]!).toBeLessThanOrEqual(FEUD_VOTE_MAX);
    expect(leans[2]).toBe(20);
    expect(leans[3]).toBe(20);
    // The hottest feud costs the most it may.
    const hot = { sponsorGensId: "gens-fabricius", feudOf: () => 10_000 };
    expect(20 - leanAsAGens([{ gensId: "gens-cornelius" }], [20], hot)[0]!).toBe(FEUD_VOTE_MAX);
  });

  it("draws the seats of one gens together behind its first man, a quarter of the way", () => {
    const kin = { sponsorGensId: null, feudOf: () => 0 };
    const seats = [{ gensId: "gens-fabius", leader: true }, { gensId: "gens-fabius" }, { gensId: "gens-fabius" }, { gensId: "gens-valerius" }];
    const leans = leanAsAGens(seats, [40, -20, 0, -20], kin);
    // The mean of the gens, the head counting double: (80 - 20 + 0) / 4 = 15.
    expect(leans[0]).toBeCloseTo(40 + (15 - 40) * 0.25, 5);
    expect(leans[1]).toBeCloseTo(-20 + (15 + 20) * 0.25, 5);
    expect(leans[3]).toBe(-20);
    // No gentes in the world, no pull.
    expect(leanAsAGens(seats, [40, -20, 0, -20], undefined)).toEqual([40, -20, 0, -20]);
  });
});
