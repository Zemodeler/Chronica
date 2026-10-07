import { describe, expect, it } from "vitest";
import { bodyFor, competenceOf, mayAct } from "@chronica/shared";
import { amend, recast } from "./constitutions";
import { createIdFactory } from "./ports";
import { act, government, holdersOf, opening, rateOf, taxSet } from "./competence-test-kit";

/**
 * A reform changes who may act.
 *
 * Nothing lists who decides: it is read from the parts of the constitution every time it is asked. So a measure that takes the
 * taxes from the Senate and gives them to the people puts the tribute before the people; a king who takes the state by force
 * leaves the consuls without an office and without a charge, and sets it all in his own hand; an office left without a holder
 * has nobody to hold it.
 */

const CONSUL = holdersOf(opening(), "roman-consul")[0]!;

describe("a reform changes who may act", () => {
  it("moves the tribute to another chamber when the measure that moves the taxes is carried", () => {
    const world = opening();
    const people = world.material.institutions.find((institution) => institution.polityId === "rome" && institution.id !== "roman-senate" && institution.franchise === "citizens" && institution.advisory !== true)!;
    const before = competenceOf(world, "roman-consul", government.offices)!;
    expect(before.acts.tax_rate.body?.id).toBe("roman-senate");
    // A measure that carries two changes at once: the Senate keeps the war and the laws, and the taxes and the purse go to the people.
    const stripped = amend(world, "rome", { chamber: { institutionId: "roman-senate", name: null, powers: ["laws", "war", "constitution"], advisory: null, franchise: null, abolish: false } } as never, government, 211, createIdFactory("reform-2"), "The lex of the tribute", CONSUL).world;
    const given = amend(stripped, "rome", { chamber: { institutionId: people.id, name: null, powers: ["elections", "laws", "taxes", "finance"], advisory: null, franchise: null, abolish: false } } as never, government, 212, createIdFactory("reform-3"), "The lex of the tribute", CONSUL).world;
    expect(bodyFor(given, "rome", "tax_rate", given.constitutions.find((record) => record.polityId === "rome"))?.id).toBe(people.id);
    expect(bodyFor(given, "rome", "spending")?.id).toBe(people.id);
    // The war is where it was.
    expect(bodyFor(given, "rome", "war")?.id).toBe("roman-senate");
    const after = competenceOf(given, "roman-consul", government.offices)!;
    expect(after.acts.tax_rate.body?.id).toBe(people.id);
    expect(after.acts.war.body?.id).toBe("roman-senate");
    expect(given.constitutions.find((record) => record.polityId === "rome")!.history.length).toBeGreaterThan(0);
    // And a rate past custom is now laid before the people.
    const laid = act({ ...given, instant: { day: 220, minute: 0 }, elapsedStep: 220 }, CONSUL, taxSet("rome", 1_800), { order: true });
    expect(laid.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: people.id });
  });

  it("leaves the consuls without an office and a charge when a king takes the state, and puts it all in his hand", () => {
    const world = opening();
    const consuls = holdersOf(world, "roman-consul");
    const usurper = holdersOf(world, "roman-senator").find((man) => !consuls.includes(man))!;
    expect(mayAct(world, CONSUL, "tax_rate", { offices: government.offices })?.grade).toBe("with_colleague");
    const taken = recast({
      world, polityId: "rome", toForm: "monarchy", origin: "seizure", byCharacterId: usurper, seatRuler: usurper, government, atStep: 230,
      summary: "A general took the city with his legions.",
    }).world;
    // The consulship is abolished: it holds no charge, and the men who held it hold nothing.
    const consul = competenceOf(taken, "roman-consul", government.offices)!;
    expect(Object.values(consul.acts).every((line) => line.grade === "forbidden")).toBe(true);
    expect(consul.acts.tax_rate.why).toMatch(/has been abolished/);
    expect(mayAct(taken, CONSUL, "tax_rate", { offices: government.offices })?.grade).not.toBe("alone");
    // The king holds it alone: no chamber that binds holds the taxes any longer.
    const king = mayAct(taken, usurper, "tax_rate", { offices: government.offices });
    expect(king).toMatchObject({ grade: "alone", body: null });
    expect(mayAct(taken, usurper, "coinage", { offices: government.offices })?.grade).toBe("alone");
    const done = act({ ...taken, instant: { day: 231, minute: 0 }, elapsedStep: 231 }, usurper, taxSet("rome", 2_000));
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "rome")).toBe(2_000);
    // The consul he put out may not.
    expect(act({ ...taken, instant: { day: 232, minute: 0 }, elapsedStep: 232 }, CONSUL, taxSet("rome", 1_000)).applied).toHaveLength(0);
  });

  it("has nobody to hold an office whose seat is empty: a vacated office loses its man and his charge", () => {
    const world = opening();
    const [first, second] = holdersOf(world, "roman-consul") as [string, string];
    const vacated = { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "roman-consul" ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "removal" as const } : seat)) } };
    // Both are still senators, and a senator has a voice in the house and no charge of the purse.
    expect(mayAct(vacated, first, "tax_rate", { offices: government.offices })).toMatchObject({ grade: "forbidden", officeId: "roman-senator" });
    expect(mayAct(vacated, second, "tax_rate", { offices: government.offices })).toMatchObject({ grade: "forbidden", officeId: "roman-senator" });
    // The office itself is still the republic's, and still reads as it did.
    expect(competenceOf(vacated, "roman-consul", government.offices)!.acts.tax_rate.grade).toBe("with_colleague");
  });
});
