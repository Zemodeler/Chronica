import { describe, expect, it } from "vitest";
import { type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { opposition, ratifyTheWar, REFUSAL_SPUR, thePeopleRefusedLately } from "./bodies";
import { atDay, government, opening } from "./government-test-kit";

/**
 * The people vote the war.
 *
 * The Senate carries a war and the engine makes it (the user's simplification stands); the assembly that holds the power of war then votes it, as a real vote of its
 * franchise (its blocs and its gentes, the men away at the wars not counted). Carried, the power stands a little better, by the margin; refused, it stands a little
 * worse, the war goes on, and the tribunes have the people's word to use against the levy and the burdens of it.
 */
const motion = (world: WorldState): { world: WorldState; procedure: PoliticalProcedure } => {
  const procedure = {
    id: "motion-war", type: "council_deliberation", institutionId: "roman-senate", sponsorCharacterId: "gaius-genucius", subjectKind: "polity", subjectId: "rome",
    label: "Motion of Gaius Genucius: that war be made on Carthage", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote", openedAtStep: 190,
    deadlineStep: 200, resolvedAtStep: 205, visibility: "public", voteRecordId: null, outcome: "passed", outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: ["war"],
  } as PoliticalProcedure;
  return { procedure, world: { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } } };
};
/** The assembly's blocs set to want a war, or not. */
const minded = (world: WorldState, support: number): WorldState => ({
  ...world,
  material: { ...world.material, institutions: world.material.institutions.map((i) => (i.id === "roman-comitia-centuriata" ? { ...i, votingBlocs: i.votingBlocs.map((b) => ({ ...b, baseSupport: support, interests: [] })) } : i)) },
});
const inputOf = (world: WorldState) => ({ world, offices: government.offices, successionRules: government.successionRules, toDay: 210 });
/** A power with no record stands at the middle of the scale, 5,000 (`adjustPolityLegitimacy`). */
const legit = (world: WorldState) => world.material.polityLegitimacy.find((l) => l.polityId === "rome")?.legitimacyBps ?? 5_000;
const base = atDay(opening(), 210);

describe("the people vote the war", () => {
  it("ratifies a war it wants, by the margin, and the power stands better", () => {
    const { world } = motion(minded(base, 100));
    const done = ratifyTheWar(inputOf(world));
    const entity = done.world.genericEntities.find((e) => e.kind === "ratification")!;
    expect(entity.attributes).toMatchObject({ carried: true, procedureId: "motion-war" });
    expect(Number(entity.attributes!["yes"])).toBeGreaterThan(Number(entity.attributes!["no"]));
    expect(legit(done.world)).toBeGreaterThan(legit(world));
    expect(done.facts[0]!.kind).toBe("war_ratified");
    expect(done.facts[0]!.summary).toMatch(/ratified what the Senate had carried, by \d+ to \d+/);
    expect(thePeopleRefusedLately(done.world, "rome")).toBe(false);
  });

  it("refuses a war it does not want: the power loses a little, the war is not undone, the tribunes may use it", () => {
    const { world } = motion(minded(base, -100));
    const done = ratifyTheWar(inputOf(world));
    expect(done.world.genericEntities.find((e) => e.kind === "ratification")!.attributes).toMatchObject({ carried: false });
    expect(legit(done.world)).toBeLessThan(legit(world));
    expect(done.facts[0]!.kind).toBe("war_refused");
    expect(done.facts[0]!.summary).toMatch(/would not ratify/);
    // The Senate's motion stands carried: war stays the Senate's.
    expect(done.world.material.politicalProcedures.find((p) => p.id === "motion-war")!.outcome).toBe("passed");
    expect(thePeopleRefusedLately(done.world, "rome")).toBe(true);
    // And a tribune is the more moved to forbid the levy of it.
    const tribune = done.world.characters.find((c) => done.world.material.officeSeats.some((s) => s.officeId === "roman-tribune" && s.holderCharacterId === c.id))!;
    const levy = { ...done.world.material.politicalProcedures.find((p) => p.id === "motion-war")!, id: "motion-levy", label: "Motion of Gaius Genucius: that a levy be held", concerns: ["levy" as const] } as PoliticalProcedure;
    expect(opposition(done.world, tribune, levy)).toBe(opposition(world, tribune, levy) + REFUSAL_SPUR);
    // It is forgotten after a season and a half.
    expect(thePeopleRefusedLately({ ...done.world, elapsedStep: 210 + 500 }, "rome")).toBe(false);
  });

  it("is voted once, and the same on every run", () => {
    const { world } = motion(minded(base, 100));
    const once = ratifyTheWar(inputOf(world));
    expect(ratifyTheWar(inputOf(once.world)).facts).toEqual([]);
    expect(JSON.stringify(ratifyTheWar(inputOf(structuredClone(world))))).toBe(JSON.stringify(once));
  });

  it("counts the people who stayed behind: the men under arms do not vote", () => {
    const { world } = motion(minded(base, 100));
    const present = (w: WorldState) => Number(ratifyTheWar(inputOf(w)).world.genericEntities.find((e) => e.kind === "ratification")!.attributes!["present"]);
    const field = world.map.provinces.find((p) => p.controllerPolityId === "rome" && !p.settlements.some((s) => s.id === world.map.polities.find((x) => x.id === "rome")!.capitalSettlementId))!.id;
    const template = world.material.forces.find((f) => f.polityId === "rome")!;
    const armies = Array.from({ length: 20 }, (_, n) => ({ ...template, id: `levy-${n}`, polityId: "rome", locationId: field, personnel: template.personnel.map((p) => ({ ...p, fit: 20_000 })) }));
    const away = { ...world, material: { ...world.material, forces: [...world.material.forces.filter((f) => f.polityId !== "rome"), ...armies] } };
    const home = { ...world, material: { ...world.material, forces: world.material.forces.filter((f) => f.polityId !== "rome") } };
    expect(present(away)).toBeLessThan(present(home));
  });
});
