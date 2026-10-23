import { describe, expect, it } from "vitest";
import {
  ACT_KINDS,
  bodyFor,
  chargeHolders,
  competenceOf,
  mayAct,
  recordTenures,
  seatCharacterInOffice,
  type WorldState,
} from "@chronica/shared";
import { amend, constitutionOf, keepThrones, recast, EMPTY_THRONE_DAYS } from "./constitutions";
import { killCharacter } from "./mortality";
import { createIdFactory } from "./ports";
import { government, holdersOf, opening } from "./competence-test-kit";

/**
 * The charges follow the constitution (docs/plans/government.md, "H1 as built").
 *
 * The charges of Rome, Carthage and Syracuse are data on their offices; but who may do what is read from the parts every time it is asked, so what changes the parts
 * changes the charges. A dictator is named and the chest alone stays the Senate's; a coup in Carthage leaves the suffetes, the officers of the accounts and the
 * commander in Sicily with nothing and puts it all in the usurper's hand, and the Office of the Accounts ends with its officers; a throne with no heir has no
 * man to hold its charge until the council has chosen; a league's reform that takes the purse from its synod puts the tribute before its council; and an ally
 * that breaks with Rome has its own war and peace.
 */

const mayStandFor = (world: WorldState, who: string, act: (typeof ACT_KINDS)[number], magnitude?: number) =>
  mayAct(world, who, act, { offices: government.offices, ...(magnitude === undefined ? {} : { magnitude }) });

describe("the charges follow the constitution", () => {
  it("names a dictator, who holds all but the chest, and takes it back from him when his six months are out", () => {
    const world = opening();
    const consuls = holdersOf(world, "roman-consul");
    const man = holdersOf(world, "roman-senator").find((id) => !consuls.includes(id))!;
    // A senator has a voice in the house and no charge of the state's money.
    expect(mayStandFor(world, man, "war")?.grade).toBe("forbidden");
    const office = government.offices.find((candidate) => candidate.id === "roman-dictator")!;
    const named = seatCharacterInOffice(world, man, { office, vacantSeatId: null }, 200, office.termDays ?? null);
    // The consuls keep theirs, with the Senate holding the war; the dictator holds it himself, and the loans, the coin, the chest and the treaties stay the Senate's.
    expect(mayStandFor(named, man, "war")?.grade).toBe("alone");
    expect(mayStandFor(named, man, "tax_rate")?.grade).toBe("alone");
    expect(mayStandFor(named, man, "levy")?.grade).toBe("alone");
    for (const act of ["loans", "coinage", "spending", "pacts", "peace"] as const) expect(mayStandFor(named, man, act)?.grade, act).toBe("by_the_body");
    expect(mayStandFor(named, consuls[0]!, "war")?.grade).toBe("by_the_body");
    // Six months on, the seat is vacant and the man is a senator again.
    const retired: WorldState = { ...named, material: { ...named.material, officeSeats: named.material.officeSeats.map((seat) => (seat.officeId === "roman-dictator" ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "term_ended" as never } : seat)) } };
    expect(mayStandFor(retired, man, "war")?.grade).toBe("forbidden");
    // And the dictator's charge named him by the parts: the chest the Senate keeps reads as the Senate's whoever he is.
    expect(competenceOf(named, "roman-dictator", government.offices)!.acts.spending.body?.id).toBe("roman-senate");
  });

  it("makes a coup in Carthage leave its officers with nothing, end the Office of the Accounts, and put it all in the usurper's hand", () => {
    const world = opening();
    const hanno = "hanno-carthage";
    const [suffete] = holdersOf(world, "carthaginian-suffete") as [string];
    const [accountant] = holdersOf(world, "carthaginian-accountant") as [string];
    // Before: the suffetes are the head of the state and the elders hold the purse; the general holds the levy and the field's coin; the accountants keep the books.
    expect(constitutionOf(world, "carthage")!.rulerOfficeId).toBe("carthaginian-suffete");
    expect(mayStandFor(world, suffete, "tax_rate")).toMatchObject({ grade: "by_the_body", body: { id: "carthaginian-council" } });
    expect(mayStandFor(world, suffete, "war")).toMatchObject({ grade: "by_the_body", body: { id: "carthaginian-council" } });
    expect(mayStandFor(world, hanno, "levy")?.grade).toBe("alone");
    expect(mayStandFor(world, hanno, "tax_rate")?.grade).toBe("forbidden");
    expect(mayStandFor(world, accountant, "tax_rate", 1_100)?.grade).toBe("with_colleague");
    expect(mayStandFor(world, accountant, "tax_rate", 1_800)?.grade).toBe("by_the_body");
    expect(world.departments.find((department) => department.id === "carthage-accounts")!.abolishedAtStep).toBeNull();
    // The coup: the commander in Sicily takes the state with the army.
    const taken = recast({ world, polityId: "carthage", toForm: "monarchy", origin: "seizure", byCharacterId: hanno, seatRuler: hanno, government, atStep: 230, summary: "The general took the city." }).world;
    // The suffetes and the accountants have no office and no charge; the Office of the Accounts, whose every officer is gone, ends.
    for (const office of ["carthaginian-suffete", "carthaginian-accountant", "carthaginian-strategos"]) {
      expect(Object.values(competenceOf(taken, office, government.offices)!.acts).every((line) => line.grade === "forbidden"), office).toBe(true);
    }
    expect(mayStandFor(taken, suffete, "tax_rate")?.grade).not.toBe("by_the_body");
    expect(mayStandFor(taken, accountant, "tax_rate", 1_100)?.grade).not.toBe("with_colleague");
    expect(taken.departments.find((department) => department.id === "carthage-accounts")!.abolishedAtStep).toBe(230);
    // The usurper holds it alone: no chamber that binds holds any power of the state.
    for (const act of ACT_KINDS) expect(mayStandFor(taken, hanno, act)?.grade, act).toBe("alone");
    expect(constitutionOf(taken, "carthage")).toMatchObject({ form: "monarchy", origin: "seizure" });
    expect(chargeHolders(taken, "carthage", "tax_rate", government.offices).map((holder) => holder.characterId)).toContain(hanno);
    expect(chargeHolders(taken, "carthage", "tax_rate", government.offices).map((holder) => holder.characterId)).not.toContain(suffete);
  });

  it("leaves a throne with no heir with nobody to hold its charge until the council has chosen", () => {
    const world = opening();
    const hiero = "hieron-ii";
    expect(mayStandFor(world, hiero, "coinage")?.grade).toBe("alone");
    const dead = killCharacter(recordTenures(world, 9), hiero, "He died in his sleep.", 10).world;
    // The throne is vacant: nobody of Syracuse holds the king's charge, and the strategoi hold only what they did.
    expect(chargeHolders(dead, "syracuse", "coinage", government.offices)).toEqual([]);
    const strategos = holdersOf(dead, "syracusan-strategos")[0]!;
    expect(mayStandFor(dead, strategos, "levy")?.grade).toBe("with_colleague");
    expect(mayStandFor(dead, strategos, "war")?.grade).toBe("forbidden");
    // After the sixty days the council takes the choosing on, and the throne is elective: the office is still the king's, and the charge is still read from the parts.
    const chosen = keepThrones({ world: dead, government, toDay: 10 + EMPTY_THRONE_DAYS });
    expect(constitutionOf(chosen.world, "syracuse")!.history.at(-1)?.origin).toBe("extinction");
    expect(competenceOf(chosen.world, "syracusan-king", government.offices)!.acts.coinage.grade).toBe("alone");
    // And a man seated in it holds the charge: a king by his council's choice is as much a king as one by blood.
    const office = government.offices.find((candidate) => candidate.id === "syracusan-king")!;
    const friend = holdersOf(chosen.world, "syracusan-friend")[0]!;
    const crowned = seatCharacterInOffice(chosen.world, friend, { office, vacantSeatId: chosen.world.material.officeSeats.find((seat) => seat.officeId === office.id && seat.status === "vacant")?.id ?? null }, 80, null);
    expect(mayStandFor(crowned, friend, "tax_rate")?.grade).toBe("alone");
    expect(mayStandFor(crowned, friend, "war")?.grade).toBe("alone");
  });

  it("puts a league's tribute before its other chamber when a reform takes the purse from its synod", () => {
    const world = opening();
    const polityId = "achaean-league";
    const head = constitutionOf(world, polityId)!.rulerOfficeId!;
    const before = competenceOf(world, head, government.offices)!;
    const synod = bodyFor(world, polityId, "tax_rate", constitutionOf(world, polityId))!;
    expect(before.acts.tax_rate.grade).toBe("by_the_body");
    const council = world.material.institutions.find((institution) => institution.polityId === polityId && institution.id !== synod.id && institution.advisory !== true && institution.powers?.includes("taxes"))!;
    // The synod keeps the war and the laws; the purse and the tribute go to the council of the magistrates.
    const reformed = amend(world, polityId, { chamber: { institutionId: synod.id, name: null, powers: ["laws", "war", "treaties", "levy", "elections", "constitution"], advisory: null, franchise: null, abolish: false } } as never, government, 211, createIdFactory("league-reform"), "The lex of the purse", null).world;
    const after = competenceOf(reformed, head, government.offices)!;
    expect(before.acts.tax_rate.body?.id).toBe(synod.id);
    expect(after.acts.tax_rate.body?.id).toBe(council.id);
    expect(after.acts.spending.body?.id ?? council.id).toBe(council.id);
    expect(after.acts.war.body?.id).toBe(synod.id);
    expect(constitutionOf(reformed, polityId)!.history.length).toBeGreaterThan(0);
  });

  it("denies an ally of the foedus its own war and peace, and gives them back when it breaks with Rome", () => {
    const world = opening();
    const ally = "etruscan-cities";
    const head = constitutionOf(world, ally)!.rulerOfficeId!;
    expect(world.polityAgreements.some((agreement) => agreement.kind === "foedus" && agreement.polityId === ally && agreement.otherPolityId === "rome" && agreement.status === "active")).toBe(true);
    const bound = competenceOf(world, head, government.offices)!;
    expect(bound.acts.war.grade).toBe("forbidden");
    expect(bound.acts.peace.grade).toBe("forbidden");
    expect(bound.acts.war.why).toMatch(/Roman Republic makes the war and the peace of those bound to it by the foedus/);
    // Its trade, and the rest of its charge, are its own.
    expect(bound.acts.tax_rate.grade).not.toBe("forbidden");
    const free: WorldState = { ...world, polityAgreements: world.polityAgreements.map((agreement) => (agreement.polityId === ally && agreement.kind === "foedus" ? { ...agreement, status: "ended" as const } : agreement)) };
    expect(competenceOf(free, head, government.offices)!.acts.war.grade).not.toBe("forbidden");
  });
});
