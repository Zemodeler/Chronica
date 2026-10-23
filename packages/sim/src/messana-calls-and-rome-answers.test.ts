import { describe, expect, it } from "vitest";
import { type DiplomaticMessage, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { decideStatecraft } from "./statecraft";
import { atDay, government, opening } from "./government-test-kit";
import { inputFor } from "./war-plan-kit";
import { APPEAL_WINDOW_DAYS, decideCallsForHelp, decideTheAppealWar, targetOfWarMotion, theAppealBehind, theAppealGoesToThePeople } from "./the-appeal-goes-to-the-people";

/**
 * Messana calls, and Rome answers (264: Polybius 1.10-11).
 *
 * The Mamertines called on Carthage and on Rome together. A Carthaginian garrison entered Messana; the Senate hesitated; the consul put the question to the
 * people, and the people voted the war. Here: when the Senate refuses a war on a power and an appeal lies behind it, the people are asked, by rule; carried,
 * the war is made by the consul the month after; refused, nothing more is done. Without an appeal the Senate's refusal stands.
 */
const NOW = 300;
const base = (): WorldState => atDay(opening(), NOW);

const appealLetter = (world: WorldState): DiplomaticMessage => ({
  id: "msg-messana-appeal", kind: "military_aid_request", fromPolityId: "mamertines", fromCharacterId: "mamertine-spokesman", toPolityId: "rome", toCharacterId: null,
  subject: "Messana asks Rome for help", terms: "The Mamertines ask Rome to take Messana under its protection against the Carthaginians in the citadel.", sentAtStep: world.elapsedStep - 20,
  replyDueByStep: null, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity",
});

/** A Carthaginian company in Messana: the garrison that came when the Mamertines asked. */
function withGarrisonInMessana(world: WorldState): WorldState {
  const messana = world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.name === "Messana"))!;
  const carthage = world.material.forces.find((force) => force.polityId === "carthage")!;
  const garrison = { ...carthage, id: "carthaginian-company-messana", name: "Carthaginian company at Messana", locationId: messana.id };
  return { ...world, material: { ...world.material, forces: [...world.material.forces, garrison] } };
}

const refused = (world: WorldState): PoliticalProcedure => ({
  id: "motion-messana-war", type: "council_deliberation", institutionId: "roman-senate", sponsorCharacterId: "gaius-genucius", subjectKind: "polity", subjectId: "carthage",
  label: "Motion of Gaius Genucius: that war be made on Carthage", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote",
  openedAtStep: world.elapsedStep - 15, deadlineStep: world.elapsedStep - 5, resolvedAtStep: world.elapsedStep - 5, visibility: "public", voteRecordId: null, outcome: "failed",
  outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: ["war"],
});

/** The assembly's blocs set to want a war, or not. */
const minded = (world: WorldState, support: number): WorldState => ({
  ...world,
  material: { ...world.material, institutions: world.material.institutions.map((i) => (i.id === "roman-comitia-centuriata" ? { ...i, votingBlocs: i.votingBlocs.map((b) => ({ ...b, baseSupport: support, interests: [] })) } : i)) },
});

const asked = (world: WorldState, support: number, letter = true): WorldState => {
  const w = minded(withGarrisonInMessana(world), support);
  return { ...w, diplomacy: letter ? [...w.diplomacy, appealLetter(w)] : w.diplomacy, material: { ...w.material, politicalProcedures: [...w.material.politicalProcedures, refused(w)] } };
};
const inputOf = (world: WorldState) => ({ world, offices: government.offices, successionRules: government.successionRules, toDay: NOW });

describe("Messana calls, and Rome answers", () => {
  it("knows who appealed, and against whom", () => {
    const world = asked(base(), 100);
    expect(theAppealBehind(world, "rome", "carthage")).toMatchObject({ polityId: "mamertines", how: "letter" });
    expect(theAppealBehind(world, "rome", "syracuse")).toBeNull();
    expect(targetOfWarMotion(world, refused(world), "rome")).toBe("carthage");
  });

  it("puts a refused war to the people when an appeal lies behind it, and the people carry it", () => {
    const world = asked(base(), 100);
    const done = theAppealGoesToThePeople(inputOf(world));
    const motion = done.world.material.politicalProcedures.find((procedure) => procedure.id === "motion-messana-war")!;
    expect(motion.outcome).toBe("passed");
    expect(motion.outcomeReason).toMatch(/Carried by the .* on the appeal of Mamertines/);
    expect(done.facts[0]!.kind).toBe("war_voted_by_the_people");
    expect(done.facts[0]!.summary).toMatch(/would not take up the appeal.*the people voted the war on Carthage/);
    // Asked once, and the same on every run.
    expect(theAppealGoesToThePeople(inputOf(done.world)).facts).toEqual([]);
    expect(JSON.stringify(theAppealGoesToThePeople(inputOf(structuredClone(world))))).toBe(JSON.stringify(done));
  });

  it("leaves the war unmade when the people will not have it either", () => {
    const done = theAppealGoesToThePeople(inputOf(asked(base(), -100)));
    expect(done.world.material.politicalProcedures.find((procedure) => procedure.id === "motion-messana-war")!.outcome).toBe("failed");
    expect(done.facts[0]!.kind).toBe("appeal_refused_by_the_people");
  });

  it("does nothing where nobody appealed: the Senate's refusal stands", () => {
    const world = minded(base(), 100);
    const refusedOnly = { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, refused(world)] } };
    const done = theAppealGoesToThePeople(inputOf(refusedOnly));
    expect(done.facts).toEqual([]);
    expect(done.world.material.politicalProcedures.find((procedure) => procedure.id === "motion-messana-war")!.outcome).toBe("failed");
  });

  it("lets the old refusal lapse: after the window it is not taken to the people", () => {
    const done = theAppealGoesToThePeople({ ...inputOf(asked(base(), 100)), toDay: NOW + APPEAL_WINDOW_DAYS + 10 });
    expect(done.facts).toEqual([]);
  });

  it("makes the war the month after, by the consul, in the people's name", () => {
    const voted = theAppealGoesToThePeople(inputOf(asked(base(), 100))).world;
    const rulerOf = (polityId: string) => voted.characters.find((character) => character.polityId === polityId && character.alive && voted.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && /consul/.test(seat.officeId)));
    const made = decideTheAppealWar(voted, new Set(), rulerOf, NOW + 10);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ polityId: "rome", act: "declare_war", targetPolityId: "carthage" });
    expect(made[0]!.deltas[0]).toMatchObject({ op: "agreement_open", kind: "war", polityId: "rome", otherPolityId: "carthage" });
    // Nobody makes it for a power a player rules.
    expect(decideTheAppealWar(voted, new Set(["rome"]), rulerOf, NOW + 10)).toEqual([]);
    // And the monthly pass carries it out.
    const month = decideStatecraft(inputFor(voted));
    expect(month.some((decision) => decision.polityId === "rome" && decision.act === "declare_war" && decision.targetPolityId === "carthage")).toBe(true);
  });

  it("has a hard-pressed people write for help, once, to the strong powers near it that are not its enemies", () => {
    const world = atDay(opening(), 100);
    const calls = decideCallsForHelp(world, new Set(), new Set(), () => undefined, 100);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.deltas[0]!.op === "diplomatic_message_send" && call.polityId === "rhegium-campanians" && call.targetPolityId !== "rome")).toBe(true);
    // Not for a ruler the model plays, nor a power a player rules, nor twice in three hundred days.
    const played = world.characters.filter((character) => character.polityId === "rhegium-campanians").map((character) => character.id);
    expect(decideCallsForHelp(world, new Set(), new Set(played), () => undefined, 100)).toEqual([]);
    expect(decideCallsForHelp(world, new Set(["rhegium-campanians"]), new Set(), () => undefined, 100)).toEqual([]);
    const sent = { ...world, diplomacy: [...world.diplomacy, { ...appealLetter(world), fromPolityId: "rhegium-campanians", toPolityId: "carthage", sentAtStep: 90 }] };
    expect(decideCallsForHelp(sent, new Set(), new Set(), () => undefined, 100)).toEqual([]);
  });
});
