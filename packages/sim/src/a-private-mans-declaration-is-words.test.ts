import { describe, expect, it } from "vitest";
import { WorldDeltaSchema, atWar, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { as, holdersOf, opening } from "./competence-test-kit";
import { usurpedLately } from "./usurpation";

/**
 * A private man's declaration is words (the user's rule, 2026-10-08). A man with no office that makes war who says "I declare war" has said words nobody follows:
 * no war, no motion moved for him, and a fact that nobody acted on his word. A king acts at once, as always; a man who only proposes has his motion laid.
 */

const world0 = opening();
const consuls = holdersOf(world0, "roman-consul");
const PRIVATE = world0.characters.find((character) => character.alive && character.polityId === "rome" && character.officeId === null && !consuls.includes(character.id))!.id;
const war = WorldDeltaSchema.parse({ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Carthage must answer." });
const declare = (world: WorldState) => applyDeltas(world, [war], { ...as(PRIVATE, world.elapsedStep, [war]), declaredDeltas: new Set([war]) });

describe("a private man's declaration is words", () => {
  it("does nothing: no war, no motion, and the city notes that nobody followed him", () => {
    const done = declare(world0);
    expect(done.applied).toHaveLength(0);
    expect(atWar(done.world.polityAgreements, "rome", "carthage")).toBe(false);
    expect(done.rejected[0]!.reason).toMatch(/nobody acted on his word alone/);
    expect(done.rejected[0]!.reason).not.toMatch(/moved it in the chamber/);
    expect(done.world.material.politicalProcedures.length).toBe(world0.material.politicalProcedures.length);
    const told = done.factProposals.find((fact) => fact.kind === "nobody_follows");
    expect(told).toBeDefined();
    expect(told!.summary).toMatch(/Only the .* could decide it/);
    // It is no usurpation: there was nothing to usurp.
    expect(usurpedLately(done.world, PRIVATE)).toBe(false);
  });

  it("is a motion when he only proposes it: the existing path, a vote and no deed", () => {
    const proposed = applyDeltas(world0, [war], as(PRIVATE, world0.elapsedStep, [war]));
    expect(atWar(proposed.world.polityAgreements, "rome", "carthage")).toBe(false);
    expect(proposed.rejected[0]!.reason).toMatch(/moved it in the chamber/);
    expect(proposed.world.material.politicalProcedures.length).toBe(world0.material.politicalProcedures.length + 1);
  });

  it("is the same every time", () => {
    expect(JSON.stringify(declare(world0))).toBe(JSON.stringify(declare(world0)));
  });
});
