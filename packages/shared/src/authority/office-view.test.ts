import { describe, expect, it } from "vitest";
import type { WorldState } from "../world/world-state";
import { amend } from "../../../sim/src/constitutions";
import { createIdFactory } from "../../../sim/src/ports";
import { government, holdersOf, opening } from "../../../sim/src/competence-test-kit";
import { draftText, readOffice, type OfficeView } from "./office-view";
import { modernWordsIn } from "./period-words";

/**
 * The office as its holder sees it (docs/plans/government.md, "H5 as built"): the Punic opening with its constitutions seated, read for a
 * consul, a quaestor, a tribune, a dictator, a suffete, an elder, a king and a private man, and again after a reform.
 */

const CONSUL = "gnaeus-cornelius";
const QUAESTOR = "rome-quaestor-gosxrz";
const TRIBUNE = "rome-tribune-ujbc0s";
const SUFFETE = "carthage-suffete-34gglr";
const ELDER = "carthage-elder-1k7ahq";
const KING = "hieron-ii";
const world = opening(200);

const read = (id: string, from: WorldState = world, extra: Parameters<typeof readOffice>[5] = {}): OfficeView => readOffice(from, id, government.offices, undefined, government.successionRules, extra);
const line = (view: OfficeView, act: string) => view.charges[0]!.acts.find((entry) => entry.act === act)!;

/** A man of Rome who holds nothing. */
function privateMan(from: WorldState): { world: WorldState; id: string } {
  const model = from.characters.find((character) => character.id === CONSUL)!;
  const id = "nobody-of-rome";
  return { id, world: { ...from, characters: [...from.characters, { ...model, id, name: "Nobody of Rome", officeId: null, officesHeld: [], relations: [] }] } };
}

describe("a consul's charge", () => {
  const view = read(CONSUL);

  it("is a head of the state in a republic with a colleague, and says how he holds it", () => {
    expect(view.role).toBe("head");
    expect(view.style).toBe("college");
    expect(view.polityLabel).toBe("Roman Republic");
    const charge = view.charges[0]!;
    expect(charge.label).toBe("Roman consul");
    expect(charge.head).toBe(true);
    expect(charge.collegial).toBe(true);
    expect(charge.colleagues).toHaveLength(1);
    expect(charge.holding.term).toBe("a year");
    expect(charge.holding.how).toMatch(/Elected by the Centuriate Assembly/);
    expect(charge.holding.daysLeft).toBe(165);
    expect(view.seats.map((seat) => seat.label)).toEqual(["Roman senator"]);
  });

  it("sorts the twelve acts as the constitution reads them: the rate and the levy with his colleague, the coin and the treaties by the Senate", () => {
    const charge = view.charges[0]!;
    expect(charge.acts).toHaveLength(12);
    expect(charge.withColleague.map((entry) => entry.act).sort()).toEqual(["levy", "spending", "tax_rate"]);
    expect(charge.byTheBody.map((entry) => entry.act)).toEqual(expect.arrayContaining(["coinage", "pacts", "war", "peace", "customs", "loans"]));
    expect(charge.forbidden).toHaveLength(0);
    const rate = line(view, "tax_rate");
    expect(rate.within).toBe(1_200);
    expect(rate.withinWords).toBe("to 12 in a hundred");
    expect(rate.now).toBe("now 10 in a hundred");
    expect(rate.beyondWords).toBe("Past that it is laid before the Senate.");
    expect(rate.stoppedBy).toEqual(["your colleague", "Tribune of the plebs"]);
    expect(line(view, "coinage").stand).toBe("Laid before the Senate");
    expect(line(view, "war").body).toBe("Senate");
  });

  it("counts the allowance he draws on his own word, and what is left of it after a draw", () => {
    const allowance = view.charges[0]!.allowance!;
    expect(allowance.amount).toBeGreaterThan(0);
    expect(allowance.spent).toBe(0);
    expect(allowance.words).toMatch(/in a year on his own word/);
    const drawn = { ...world, actMarks: [{ polityId: "rome", act: "spending" as const, officeId: "roman-consul", byCharacterId: CONSUL, byOfficeId: "roman-consul", atStep: 190, sinceStep: 150, total: 250_000 }] };
    const after = read(CONSUL, drawn).charges[0]!.allowance!;
    expect(after.spent).toBe(250_000);
    expect(after.left).toBe(allowance.amount! - 250_000);
    expect(after.words).toContain("250,000");
  });

  it("shows the Senate and the assemblies: what must be laid before them, and his seat", () => {
    const senate = view.bodies.find((body) => body.id === "roman-senate")!;
    expect(senate.relations).toEqual(expect.arrayContaining(["sits", "convenes", "lays before"]));
    expect(senate.yourSeat).toBe("You sit in it as a Roman senator.");
    expect(senate.holds.map((hold) => hold.deed)).toEqual(expect.arrayContaining(["Make war", "Have the coin struck with other silver"]));
    expect(senate.powers).toEqual(expect.arrayContaining(["war", "the tribute", "the purse"]));
    expect(view.bodies.some((body) => body.id === "roman-comitia-centuriata" && body.relations.includes("elects you"))).toBe(true);
  });

  it("names the tribunes and the augurs as those whose word reaches over him", () => {
    const tribunes = view.reach.find((reach) => reach.label === "Tribune of the plebs")!;
    expect(tribunes.count).toBe(10);
    expect(tribunes.stops).toEqual(expect.arrayContaining(["the tribute", "the levy", "the purse"]));
    expect(tribunes.sentence).toMatch(/step between you and the act/);
    expect(view.reach.some((reach) => reach.label === "Roman augur")).toBe(true);
  });

  it("lists the colleague, the quaestors and the tribunes beside him, with how each stands to him", () => {
    const quaestors = view.neighbours.find((neighbour) => neighbour.label === "Roman quaestor")!;
    expect(quaestors.relation).toBe("beneath");
    expect(quaestors.holders.length).toBeGreaterThan(0);
    expect(quaestors.holders[0]!.toYou).toBe("neutral");
    expect(quaestors.keeps.join(" ")).toMatch(/rate of the tribute/);
    expect(view.neighbours.find((neighbour) => neighbour.label === "Tribune of the plebs")!.relation).toBe("beside");
    expect(view.neighbours.find((neighbour) => neighbour.label === "Roman consul")!.relation).toBe("colleague");
    expect(view.neighbours.some((neighbour) => neighbour.relation === "above")).toBe(false);
  });

  it("says what a colleague last did in his charge, from the log, and how he thinks of him", () => {
    const logged = {
      ...world,
      statecraft: { ...world.statecraft, log: [...world.statecraft.log, { day: 180, polityId: "rome", actorCharacterId: QUAESTOR, act: "fiscal" as const, targetPolityId: null, why: "tribute: the rate of Rome raised from 10 to 12." }] },
    };
    const ill = { ...logged, characters: logged.characters.map((character) => (character.id === QUAESTOR ? { ...character, relations: [{ subjectCharacterId: CONSUL, causes: [{ id: "q", label: "A quarrel.", score: -70, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] } : character)) };
    const quaestors = read(CONSUL, ill).neighbours.find((neighbour) => neighbour.label === "Roman quaestor")!;
    const him = quaestors.holders.find((holder) => holder.person.label === "Marcus Atilius Regulus")!;
    expect(him.lastDone?.text).toBe("Tribute: the rate of Rome raised from 10 to 12.");
    expect(him.toYou).toBe("hostile");
  });

  it("lists the questions open before the Senate, with the count for those who sit in it, and how it lately settled others", () => {
    const procedure = (id: string, label: string, stage: string, over: Record<string, unknown> = {}) => ({
      id, type: "council_deliberation", institutionId: "roman-senate", sponsorCharacterId: CONSUL, subjectKind: "polity", subjectId: "rome", label, eligibilityRequirementIds: [], eligibleParticipantIds: [],
      stage, resolutionMechanism: "vote", openedAtStep: 150, deadlineStep: 215, resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [], ...over,
    });
    const laid = {
      ...world,
      material: {
        ...world.material,
        politicalProcedures: [
          ...world.material.politicalProcedures,
          procedure("open-1", "that the tribute of Rome be laid anew as a tithe", "gathering_support", { concerns: ["taxes"] }),
          procedure("done-1", "that war be made on Carthage", "resolved", { outcome: "passed", resolvedAtStep: 120, outcomeReason: "The Senate carried it." }),
          procedure("done-2", "that the coin of Rome be struck lighter", "resolved", { outcome: "failed", resolvedAtStep: 130 }),
        ],
      },
    } as unknown as WorldState;
    const senate = read(CONSUL, laid).bodies.find((body) => body.id === "roman-senate")!;
    expect(senate.openCount).toBe(1);
    expect(senate.open[0]).toMatchObject({ label: "that the tribute of Rome be laid anew as a tithe", yours: true, concerns: ["taxes"] });
    expect(senate.open[0]!.tally).toBe("Nobody has declared yet.");
    expect(senate.lately.map((item) => [item.outcome, item.label])).toEqual([["refused", "that the coin of Rome be struck lighter"], ["carried", "that war be made on Carthage"]]);
    // A man who sits nowhere near it does not read the count.
    const quaestor = read(QUAESTOR, laid).bodies.find((body) => body.id === "roman-senate")!;
    expect(quaestor.open[0]!.tally).toBeNull();
  });

  it("drafts each act as an order for the desk, and lays what is past his figure before the Senate", () => {
    const rate = view.drafts.find((draft) => draft.key === "tax_rate")!;
    expect(rate.grade).toBe("with_colleague");
    expect(rate.max).toBe(12);
    expect(draftText(rate, { figure: 11 })).toEqual({ text: "Let every province of Roman Republic that has no tax of its own be taxed by a land levy at 11 in a hundred.", laid: null });
    const past = draftText(rate, { figure: 14 });
    expect(past.text).toBe("Lay before the Senate that the tribute of Roman Republic be laid at 14 in a hundred.");
    expect(past.laid).toBe("Senate");
    const war = view.drafts.find((draft) => draft.key === "war")!;
    expect(war.direct).toBeNull();
    expect(draftText(war, { power: "Carthage" }).text).toBe("Lay before the Senate that war be made on Carthage.");
    expect(view.drafts.find((draft) => draft.key === "coinage")!.direct).toBeNull();
    expect(view.drafts.find((draft) => draft.key === "levy")!.grade).toBe("with_colleague");
  });

  it("links the books when he has them, and reads the departments he keeps", () => {
    expect(view.accounts!.links.map((link) => link.tab)).toEqual(["accounts"]);
    expect(view.accounts!.currency).toBe("Drachmae");
  });
});

describe("the charges beneath a consul", () => {
  it("is a quaestor's: the rate with his colleagues, every draw by the Senate, the coin not his", () => {
    const view = read(QUAESTOR);
    expect(view.role).toBe("magistrate");
    expect(view.charges[0]!.collegial).toBe(true);
    expect(line(view, "tax_rate").grade).toBe("with_colleague");
    expect(line(view, "coinage").grade).toBe("forbidden");
    expect(line(view, "spending").grade).toBe("by_the_body");
    expect(view.charges[0]!.allowance!.amount).toBe(0);
    expect(view.charges[0]!.allowance!.words).toMatch(/every sum is laid before the Senate/);
    expect(view.charges[0]!.levers.map((lever) => lever.lever)).toEqual(["tax_roll", "credit"]);
    expect(view.charges[0]!.levers[0]!.byRule).toMatch(/rate of the tribute/);
    expect(view.neighbours.find((neighbour) => neighbour.label === "Roman consul")!.relation).toBe("above");
    expect(view.drafts.map((draft) => draft.key)).toEqual(["tax_rate", "customs", "loans", "spending"]);
  });

  it("is a tribune's: no act of his own, and the levy, the purse and the tribute his to stop", () => {
    const view = read(TRIBUNE);
    expect(view.role).toBe("tribune");
    expect(view.charges[0]!.forbidden).toHaveLength(12);
    expect(view.charges[0]!.mayStop).toEqual(expect.arrayContaining(["the levy", "the purse", "the tribute"]));
    expect(view.drafts.every((draft) => draft.kind === "stop")).toBe(true);
    expect(view.drafts.map((draft) => draft.key)).toContain("stop:levy");
    expect(view.drafts.find((draft) => draft.key === "stop:levy")!.direct).toMatch(/I forbid the levy of Roman Republic/);
    expect(view.neighbours.find((neighbour) => neighbour.label === "Roman consul")!.relation).toBe("beside");
    expect(view.bodies.some((body) => body.id === "roman-concilium-plebis" && body.relations.includes("convenes"))).toBe(true);
  });

  it("is a dictator's: everything alone but the treasury, and no chamber over him", () => {
    const seat = { id: "seat-dictator", officeId: "roman-dictator", seatIndex: 0, holderCharacterId: "quintus-fabius", status: "held" as const, vacancyCause: "none" as const, termStartedAtStep: 190, termExpiresAtStep: 370, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] };
    const named = { ...world, material: { ...world.material, officeSeats: [...world.material.officeSeats, seat] } } as WorldState;
    const view = read("quintus-fabius", named);
    const dictator = view.charges.find((charge) => charge.officeId === "roman-dictator")!;
    expect(dictator.alone.map((entry) => entry.act)).toEqual(expect.arrayContaining(["tax_rate", "war", "levy", "customs"]));
    expect(dictator.holding.how).toMatch(/appoint/i);
    expect(dictator.holding.daysLeft).toBe(170);
  });
});

describe("Carthage and the kings", () => {
  it("shows a suffete his colleague, the elders who hold his acts and the Hundred and Four who try him", () => {
    const view = read(SUFFETE);
    expect(view.role).toBe("head");
    expect(line(view, "customs").grade).toBe("with_colleague");
    expect(line(view, "customs").withinWords).toBe("to a tariff of 10 in a hundred");
    expect(line(view, "tax_rate").grade).toBe("by_the_body");
    expect(line(view, "tax_rate").body).toBe("Council of Elders");
    const council = view.bodies.find((body) => body.id === "carthaginian-council")!;
    expect(council.relations).toContain("lays before");
    expect(council.note).toMatch(/goes on to the Carthaginian assembly|goes on to the people|goes on to/);
    expect(view.bodies.find((body) => body.id === "carthaginian-hundred-and-four")!.relations).toContain("answers to");
    expect(view.neighbours.find((neighbour) => neighbour.label === "Officer of the Accounts")!.relation).toBe("beneath");
    expect(view.neighbours.find((neighbour) => neighbour.label === "Carthaginian suffete")!.relation).toBe("colleague");
    expect(view.headings.neighbours).toBe("Your colleague and the magistrates");
  });

  it("shows an elder his seat in the Council and the magistrates who put questions to it, and no charge", () => {
    const view = read(ELDER);
    expect(view.role).toBe("member");
    expect(view.charges).toEqual([]);
    expect(view.seats[0]).toEqual({ officeId: "carthaginian-elder", label: "Carthaginian elder", body: "Council of Elders" });
    expect(view.bodies.find((body) => body.id === "carthaginian-council")!.relations).toContain("sits");
    expect(view.neighbours.find((neighbour) => neighbour.label === "Carthaginian suffete")!.relation).toBe("beside");
    expect(view.private).toBeNull();
  });

  it("gives a king every act alone, his friends as counsel, his officers beneath him, and nobody who may stop him", () => {
    const view = read(KING);
    expect(view.role).toBe("head");
    expect(view.style).toBe("king");
    expect(view.charges[0]!.alone).toHaveLength(12);
    expect(view.charges[0]!.allowance!.words).toMatch(/No chamber limits/);
    expect(view.reach).toEqual([]);
    const friends = view.bodies.find((body) => body.advisory)!;
    expect(friends.relations).toContain("counsels you");
    expect(friends.note).toMatch(/overrules his friends/);
    expect(view.neighbours.find((neighbour) => neighbour.relation === "counsel")!.label).toBe("Friend of the King of Syracuse");
    expect(view.neighbours.find((neighbour) => neighbour.label === "Syracusan strategos")!.relation).toBe("beneath");
    expect(view.headings.neighbours).toBe("Your friends and your officers");
    expect(view.drafts.filter((draft) => draft.kind === "act").every((draft) => draft.direct !== null && draft.grade === "alone")).toBe(true);
  });
});

describe("a man with no charge", () => {
  it("is told what binds him and what a patron could move, in short", () => {
    const { world: there, id } = privateMan(world);
    const view = read(id, there);
    expect(view.role).toBe("private");
    expect(view.charges).toEqual([]);
    expect(view.drafts).toEqual([]);
    expect(view.private!.noCharge).toMatch(/You hold no charge in Roman Republic/);
    expect(view.private!.boundBy.length).toBeLessThanOrEqual(2);
    expect(view.private!.movedBy.find((entry) => entry.body === "Senate")!.through).toBe("Roman consul");
    expect(view.bodies.some((body) => body.relations.includes("citizen"))).toBe(true);
  });

  it("is nothing for a man who is not in the world", () => {
    const view = readOffice(world, "nobody-at-all", government.offices);
    expect(view.polityId).toBeNull();
    expect(view.charges).toEqual([]);
  });
});

describe("the view follows the constitution", () => {
  it("moves the tribute to the people when a reform takes it from the Senate", () => {
    const people = world.material.institutions.find((institution) => institution.polityId === "rome" && institution.id !== "roman-senate" && institution.franchise === "citizens" && institution.advisory !== true)!;
    expect(line(read(CONSUL), "tax_rate").beyondWords).toMatch(/Senate/);
    const stripped = amend(world, "rome", { chamber: { institutionId: "roman-senate", name: null, powers: ["laws", "war", "constitution"], advisory: null, franchise: null, abolish: false } } as never, government, 211, createIdFactory("reform-2"), "The lex of the tribute", CONSUL).world;
    const given = amend(stripped, "rome", { chamber: { institutionId: people.id, name: null, powers: ["elections", "laws", "taxes", "finance"], advisory: null, franchise: null, abolish: false } } as never, government, 212, createIdFactory("reform-3"), "The lex of the tribute", CONSUL).world;
    const after = read(CONSUL, given);
    expect(line(after, "tax_rate").body).toBe(people.name);
    expect(line(after, "tax_rate").beyondWords).toContain(people.name);
    expect(after.bodies.find((body) => body.id === people.id)!.relations).toContain("lays before");
  });

  it("takes the consul's charge away when the form is recast as a monarchy, and when his seat is vacated", () => {
    const recast = amend(world, "rome", { form: "monarchy" } as never, government, 211, createIdFactory("reform-4"), "The kingship", CONSUL).world;
    const after = read(CONSUL, recast);
    expect(after.charges.find((charge) => charge.officeId === "roman-consul")).toBeUndefined();
    expect(after.style).toBe("king");
    const vacated = { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "roman-consul" && seat.holderCharacterId === CONSUL ? { ...seat, holderCharacterId: null, status: "vacant" as const } : seat)) } } as WorldState;
    const empty = read(CONSUL, vacated);
    expect(empty.role).toBe("member");
    expect(empty.charges).toEqual([]);
    expect(holdersOf(vacated, "roman-consul")).toHaveLength(1);
  });
});

describe("the words of the age", () => {
  it("uses no modern word in anything the view says, for any of the offices", () => {
    const { world: there, id } = privateMan(world);
    for (const [from, who] of [[world, CONSUL], [world, QUAESTOR], [world, TRIBUNE], [world, SUFFETE], [world, ELDER], [world, KING], [there, id]] as const) {
      const view = read(who, from);
      const text = JSON.stringify(view, (_key, value: unknown) => (typeof value === "string" ? value : value)).replace(/"[a-zA-Z]+":/g, " ");
      expect(modernWordsIn(text), who).toEqual([]);
      for (const draft of view.drafts) expect(modernWordsIn(`${draft.direct ?? ""} ${draft.laid ?? ""} ${draft.note}`), draft.key).toEqual([]);
    }
  });
});
