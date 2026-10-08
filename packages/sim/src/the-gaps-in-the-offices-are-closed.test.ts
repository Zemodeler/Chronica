import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECENT_VOTERS_KEPT,
  RECENT_VOTES_KEPT,
  allOffices,
  boundedId,
  economyOf,
  readOffice,
  type FactProposalDraft,
  type VoteRecord,
  type WorldState,
} from "@chronica/shared";
import { fillAppointments } from "./appointments";
import { definition, government, opening } from "./competence-test-kit";
import { summariseTheFarCalendar } from "./far-calendar";
import { powersDealtWith, powersNearThePlayer } from "./far-powers";
import { keepTheLine } from "./house-succession";
import { keepTheTutelage, skimOf, tutorWord } from "./house-tutelage";
import { createIdFactory } from "./ports";
import { reviewSociety } from "./society";
import { rememberTheVote } from "./vote-history";

/**
 * The gaps the audit of the offices left (docs/plans/government.md, "Offices and data gaps closed"): the governor of the conquered lands is named, not left to
 * lapse; a seat says which chamber it is in; the chamber remembers how its members voted; the far calendar is told in a line where it touches the player's
 * circle; a boy who has his father's house has a tutor till he is of age.
 */

const at = (world: WorldState, day: number): WorldState => ({ ...world, elapsedStep: day, instant: { ...world.instant, day } });

describe("a king names the governor of the conquered lands", () => {
  /** A power that holds two provinces whose first masters were somebody else's, as a conqueror does. */
  function conqueror(polityId: string): WorldState {
    const world = opening(200);
    const taken = world.map.provinces.filter((province) => province.controllerPolityId === polityId).slice(0, 2).map((province) => province.id);
    expect(taken).toHaveLength(2);
    const other = world.map.polities.find((polity) => polity.id !== polityId)!.id;
    return { ...world, society: { ...world.society, lastReviewStep: null, nativeControllers: [...world.society.nativeControllers.filter((entry) => !taken.includes(entry.provinceId)), ...taken.map((provinceId) => ({ provinceId, polityId: other }))] } };
  }
  const reviewed = (world: WorldState) => reviewSociety({ world, government, warfare: definition.warfare, toDay: 200, ids: createIdFactory("governors") });

  it.each(["macedon", "seleucid-empire"])("seats a man in the office %s makes, the same month, by the king's naming", (polityId) => {
    const made = reviewed(conqueror(polityId));
    const office = allOffices(made.world, government.offices).find((candidate) => candidate.id === boundedId(polityId, "governor"));
    expect(office).toBeDefined();
    // One post, not a college: a college with a seat count is never filled by rule and lapsed, empty, after three years.
    expect(office!.seatCount).toBeUndefined();
    expect(office!.kind).toBe("magistracy");
    const filled = fillAppointments({ world: made.world, government, toDay: 200, playerCharacterId: null });
    const seat = filled.world.material.officeSeats.find((candidate) => candidate.officeId === office!.id);
    expect(seat?.status).toBe("held");
    expect(seat?.holderCharacterId).not.toBeNull();
    const king = filled.world.constitutions.find((record) => record.polityId === polityId)!.rulerOfficeId!;
    expect(filled.world.material.officeSeats.some((candidate) => candidate.officeId === king && candidate.holderCharacterId === seat!.holderCharacterId)).toBe(false);
    expect(filled.facts.some((fact) => fact.kind === "office_filled" && fact.summary.includes("Governor of the conquered lands"))).toBe(true);
  });

  it("makes no such office where there is nobody to hold it", () => {
    const world = conqueror("macedon");
    const ruler = world.constitutions.find((record) => record.polityId === "macedon")!.rulerOfficeId!;
    const kingId = world.material.officeSeats.find((seat) => seat.officeId === ruler && seat.holderCharacterId !== null)!.holderCharacterId!;
    const alone: WorldState = { ...world, characters: world.characters.map((character) => (character.polityId === "macedon" && character.id !== kingId ? { ...character, alive: false } : character)) };
    const made = reviewed(alone);
    expect(allOffices(made.world, government.offices).some((office) => office.id === boundedId("macedon", "governor") && office.successionRuleId !== "abolished")).toBe(false);
  });
});

describe("a seat says which chamber it is in", () => {
  const world = opening(200);
  const offices = allOffices(world, government.offices);
  const seat = (id: string) => offices.find((office) => office.id === id)!;

  it("names the chamber in the scenario's data and in the form's template", () => {
    expect(seat("roman-senator").chamberId).toBe("roman-senate");
    expect(seat("carthaginian-elder").chamberId).toBe("carthaginian-council");
    expect(seat("carthaginian-judge").chamberId).toBe("carthaginian-hundred-and-four");
    // An officer of his legion sits in no chamber, and says so rather than being read as a senator.
    expect(seat("roman-military-tribune").chamberId).toBeNull();
    const generated = offices.filter((office) => office.kind === "membership" && office.id.endsWith(":councillor") && world.material.institutions.some((chamber) => chamber.polityId === office.polityId));
    expect(generated.length).toBeGreaterThan(10);
    for (const office of generated) {
      expect(office.chamberId, office.id).toBeDefined();
      expect(world.material.institutions.some((chamber) => chamber.id === office.chamberId), `${office.id} -> ${office.chamberId}`).toBe(true);
    }
  });

  it("reads a judge's seat as the court's and an elder's as the council's, with no guessing from names", () => {
    const view = (id: string) => readOffice(world, id, government.offices, undefined, government.successionRules);
    const elder = world.material.officeSeats.find((candidate) => candidate.officeId === "carthaginian-elder" && candidate.holderCharacterId !== null)!.holderCharacterId!;
    expect(view(elder).bodies.find((body) => body.relations.includes("sits"))?.id).toBe("carthaginian-council");
    const judge = world.material.officeSeats.find((candidate) => candidate.officeId === "carthaginian-judge" && candidate.holderCharacterId !== null);
    if (judge !== undefined) expect(view(judge.holderCharacterId!).bodies.find((body) => body.relations.includes("sits"))?.id).toBe("carthaginian-hundred-and-four");
    const source = readFileSync(new URL("../../shared/src/authority/office-view.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/STOPWORDS|const stem = /u);
  });
});

describe("a chamber remembers how its members voted", () => {
  const record = (n: number, yes: readonly string[], no: readonly string[], abstain: readonly string[] = []): VoteRecord => ({
    id: `vote-${n}`, motionId: `q-${n}`, votes: [{ blocId: "b", choice: "yes", weight: yes.length }, { blocId: "c", choice: "no", weight: no.length }],
    ballots: [...yes.map((characterId) => ({ characterId, name: characterId, blocId: "b", choice: "yes" as const, supportScore: 20 })), ...no.map((characterId) => ({ characterId, name: characterId, blocId: "c", choice: "no" as const, supportScore: -20 })), ...abstain.map((characterId) => ({ characterId, name: characterId, blocId: "c", choice: "abstain" as const, supportScore: 0 }))],
    yesWeight: yes.length, noWeight: no.length, abstainWeight: abstain.length, presentWeight: yes.length + no.length + abstain.length, quorumMet: true, thresholdMet: yes.length > no.length,
    outcome: yes.length > no.length ? "passed" : "failed", resolvedAtStep: 100 + n,
  }) as VoteRecord;

  it("keeps the last twenty questions, each with its members on each side, and no more", () => {
    let world = opening(200);
    for (let n = 1; n <= RECENT_VOTES_KEPT + 5; n += 1) world = rememberTheVote(world, "roman-senate", { id: `q-${n}`, label: `Question ${n}` }, record(n, ["gaius-genucius", "manius-curius"], ["quintus-ogulnius"]));
    const kept = world.material.institutions.find((chamber) => chamber.id === "roman-senate")!.recentVotes!;
    expect(kept).toHaveLength(RECENT_VOTES_KEPT);
    expect(kept[0]!.label).toBe("Question 6");
    expect(kept.at(-1)).toMatchObject({ label: `Question ${RECENT_VOTES_KEPT + 5}`, outcome: "passed", yes: ["gaius-genucius", "manius-curius"], no: ["quintus-ogulnius"] });
    // The same question counted again is not kept twice.
    world = rememberTheVote(world, "roman-senate", { id: `q-${RECENT_VOTES_KEPT + 5}`, label: "Again" }, record(RECENT_VOTES_KEPT + 5, ["gaius-genucius"], ["manius-curius"]));
    expect(world.material.institutions.find((chamber) => chamber.id === "roman-senate")!.recentVotes).toHaveLength(RECENT_VOTES_KEPT);
  });

  it("caps the names it keeps for a side, so a Senate of three hundred does not swell the world", () => {
    const crowd = Array.from({ length: 300 }, (_, i) => `senator-${String(i).padStart(3, "0")}`);
    const world = rememberTheVote(opening(200), "roman-senate", { id: "q-1", label: "A crowded question" }, record(1, crowd, []));
    expect(world.material.institutions.find((chamber) => chamber.id === "roman-senate")!.recentVotes![0]!.yes).toHaveLength(RECENT_VOTERS_KEPT);
  });

  it("tells a senator how he and his colleagues have voted lately", () => {
    let world = opening(200);
    world = rememberTheVote(world, "roman-senate", { id: "q-1", label: "The grain from Sicily" }, record(1, ["gaius-genucius", "manius-curius"], ["quintus-ogulnius"]));
    world = rememberTheVote(world, "roman-senate", { id: "q-2", label: "A fleet of sixty" }, record(2, ["quintus-ogulnius"], ["gaius-genucius"], ["manius-curius"]));
    const nameOf = (id: string): string => world.characters.find((character) => character.id === id)!.name;
    const senate = readOffice(world, "gaius-genucius", government.offices, undefined, government.successionRules).bodies.find((body) => body.id === "roman-senate")!;
    expect(senate.votedLately.map((vote) => vote.label)).toEqual(["A fleet of sixty", "The grain from Sicily"]);
    const [fleet, grain] = senate.votedLately;
    expect(fleet).toMatchObject({ yourSide: "against", outcome: "refused", tally: "For 1, against 1." });
    expect(fleet!.against.map((who) => who.label)).toEqual([nameOf("quintus-ogulnius")]);
    expect(grain).toMatchObject({ yourSide: "for", outcome: "carried" });
    expect(grain!.withYou.map((who) => who.label)).toEqual([nameOf("manius-curius")]);
    expect(grain!.against.map((who) => who.label)).toEqual([nameOf("quintus-ogulnius")]);
  });
});

describe("the far calendar is told in a line only where it touches the player's circle", () => {
  const world = opening(200);
  const player = "gaius-genucius";
  const election = (polityId: string): FactProposalDraft => ({
    localId: `election-${polityId}`, kind: "election_held", summary: `The ${polityId} elected its magistrates.`, affectedRefs: [{ kind: "polity", id: polityId }],
    visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 30,
  });

  it("says one line for the powers beyond his borders that hold a treaty with one near him, and keeps the rest hidden", () => {
    const near = powersNearThePlayer(world, player)!;
    const dealt = powersDealtWith(world, player)!;
    const strangers = world.map.polities.map((polity) => polity.id).filter((id) => !dealt.has(id));
    expect(strangers.length).toBeGreaterThan(5);
    // Nothing touches him: nothing is said.
    expect(summariseTheFarCalendar(world, strangers.slice(0, 5).map(election), player)).toEqual([]);
    // A far power with an open treaty with a power near him is his news in a line, once, with the others counted out.
    const friend = [...near].find((id) => id !== "rome")!;
    const withTreaty: WorldState = {
      ...world,
      polityAgreements: [...world.polityAgreements, { id: "far-pact", polityId: strangers[0]!, otherPolityId: friend, kind: "alliance", status: "active" } as WorldState["polityAgreements"][number]],
    };
    const told = summariseTheFarCalendar(withTreaty, strangers.slice(0, 5).map(election), player);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: "far_calendar", visibility: "public" });
    expect(told[0]!.summary).toMatch(/^Elections were held in one power within your circle beyond your borders: /u);
    expect(told[0]!.affectedRefs).toEqual([{ kind: "polity", id: strangers[0] }]);
    // A power near him is told as it always was (public already); it is not counted into the far line.
    expect(summariseTheFarCalendar(withTreaty, [{ ...election("rome"), visibility: "public" }], player)).toEqual([]);
  });
});

describe("a boy who has his father's house has a tutor till he is of age", () => {
  /** A house whose head has died leaving a boy of ten, and a brother of the dead man of full age and honest. */
  function orphaned(houseId: string) {
    const world = opening(0);
    const house = economyOf(world).houses.find((entry) => entry.id === houseId)!;
    const father = world.characters.find((character) => character.id === house.headCharacterId)!;
    const boy = world.characters.find((character) => character.id === father.heirCharacterId)!;
    const uncle = world.characters.find((character) => character.polityId === father.polityId && character.gender === "male" && character.id !== father.id && character.id !== boy.id && character.alive && character.officeId === null && character.ageYearsAtStart >= 30 && character.ageYearsAtStart <= 50 && character.mind.temperament.honesty >= 40)!;
    const made: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === father.id ? { ...character, alive: false, diedAtStep: 0 } : character.id === boy.id ? { ...character, ageYearsAtStart: 10, birthStep: null } : character)),
      familyLinks: [...world.familyLinks, { id: "uncle-link", characterId: father.id, relatedCharacterId: uncle.id, kind: "sibling" as const, startedAtStep: 0, endedAtStep: null, visibility: "public" as const, provenanceEventId: null }],
    };
    return { world: made, house, father, boy, uncle };
  }
  const houseId = () => economyOf(opening(0)).houses.find((entry) => entry.polityId === "rome")?.id ?? economyOf(opening(0)).houses[0]!.id;

  it("names the nearest honest man of the dead man's kin, links him as guardian, and ends it when the boy is eighteen", () => {
    const { world, house, boy, uncle } = orphaned(houseId());
    const due = new Set([house.id]);
    const line = keepTheLine(world, 30, createIdFactory("line"), due);
    expect(economyOf(line.world).houses.find((entry) => entry.id === house.id)!.headCharacterId).toBe(boy.id);
    const tutored = keepTheTutelage(line.world, 30, createIdFactory("tutelage"), due);
    const kept = economyOf(tutored.world).houses.find((entry) => entry.id === house.id)!;
    expect(kept.tutorCharacterId).not.toBeNull();
    expect(tutored.world.familyLinks.some((link) => link.kind === "guardian" && link.characterId === kept.tutorCharacterId && link.relatedCharacterId === boy.id && link.endedAtStep === null)).toBe(true);
    expect(tutored.facts.map((fact) => fact.kind)).toContain("house_tutor_named");
    expect(tutored.facts[0]!.summary).toMatch(new RegExp(`as his ${tutorWord(boy)} until he comes of age`, "u"));
    // The same house is not named a second tutor while the first stands.
    expect(keepTheTutelage(tutored.world, 60, createIdFactory("again"), due).facts).toEqual([]);
    // Eight years on the boy is of age: the guardianship ends and the house is his to keep.
    const grown = at(tutored.world, 365 * 8 + 30);
    const ended = keepTheTutelage(grown, grown.elapsedStep, createIdFactory("grown"), due);
    expect(economyOf(ended.world).houses.find((entry) => entry.id === house.id)!.tutorCharacterId).toBeNull();
    expect(ended.world.familyLinks.find((link) => link.kind === "guardian" && link.relatedCharacterId === boy.id)!.endedAtStep).toBe(grown.elapsedStep);
    expect(ended.facts.map((fact) => fact.kind)).toEqual(["house_comes_of_age"]);
    expect(uncle.id).toBeDefined();
  });

  it("makes a dishonest tutor give back what he made away with, out of his own purse and into the ward's", () => {
    const { world, house, boy } = orphaned(houseId());
    const due = new Set([house.id]);
    let state = keepTheTutelage(keepTheLine(world, 30, createIdFactory("line"), due).world, 30, createIdFactory("t"), due).world;
    const tutorId = economyOf(state).houses.find((entry) => entry.id === house.id)!.tutorCharacterId!;
    // Make him the kind who takes, and find the year in which his accounts show it (the odds are fixed by the pair).
    state = { ...state, characters: state.characters.map((character) => (character.id === tutorId ? { ...character, mind: { ...character.mind, temperament: { ...character.mind.temperament, honesty: 30 }, drives: { ...character.mind.drives, wealth: 90 } } } : character)) };
    const tutor = state.characters.find((character) => character.id === tutorId)!;
    const ward = state.characters.find((character) => character.id === boy.id)!;
    const owedBy = (id: string) => skimOf({ id }, tutor, ward, 100_000);
    // For the houses of the opening some pair is struck by the odds, some is not: the rule is a share, never all.
    expect(owedBy(house.id)).toBeLessThanOrEqual(8_000);
    expect(skimOf({ id: house.id }, { ...tutor, mind: { ...tutor.mind, temperament: { ...tutor.mind.temperament, honesty: 80 } } }, ward, 100_000)).toBe(0);
    const owed = owedBy(house.id);
    const purses = (w: WorldState) => ({ tutor: w.material.accounts.find((account) => account.id === tutor.personalAccountId)!.balance, ward: w.material.accounts.find((account) => account.id === ward.personalAccountId)!.balance });
    const grown = at(state, 365 * 8 + 30);
    const before = purses(grown);
    const ended = keepTheTutelage(grown, grown.elapsedStep, createIdFactory("accounts"), due);
    const after = purses(ended.world);
    const moved = after.ward - before.ward;
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(before.tutor - after.tutor).toBe(moved);
    if (owed > 0) expect(ended.facts[0]!.summary).toMatch(/made away with/u);
  });
});
