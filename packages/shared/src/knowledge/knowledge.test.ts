import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import type { WorldState } from "../world/world-state";
import { estimateMen, estimateShips, wealthInWords } from "./estimate";
import { entityKey, readGlossary, type ForceNote, type PersonNote } from "./glossary";
import { freshness, sourceLine } from "./source";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const successionRules = definition.government.successionRules;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const CONSUL = "gaius-genucius";
const CITIZEN = "manius-curius";

const glossaryOf = (state: WorldState, characterId: string) =>
  readGlossary({ world: state, characterId, offices, successionRules, clock });

describe("what the viewer can say about others' numbers", () => {
  it("gives a close count for what is seen, and a wider range for talk and for age", () => {
    const seen = estimateMen(9_100, "own_eyes", 0, ["legio-i", CONSUL, 0]);
    const talk = estimateMen(9_100, "rumour", 0, ["legio-i", CONSUL, 0]);
    const old = estimateMen(9_100, "report", 60, ["legio-i", CONSUL, 0]);
    const fresh = estimateMen(9_100, "report", 0, ["legio-i", CONSUL, 0]);
    expect(seen.label).toBe("about 9,000 men");
    expect(talk.high - talk.low).toBeGreaterThan(fresh.high - fresh.low);
    expect(old.high - old.low).toBeGreaterThan(fresh.high - fresh.low);
    expect(fresh.low).toBeLessThanOrEqual(9_100);
    expect(fresh.high).toBeGreaterThanOrEqual(9_100);
  });

  it("never widens past half the truth either way", () => {
    for (const reader of [CONSUL, CITIZEN, "hanno", "hiero"]) {
      const ancient = estimateMen(10_000, "rumour", 10_000, ["legio-i", reader, 0]);
      expect(ancient.low).toBeGreaterThanOrEqual(5_000);
      expect(ancient.high).toBeLessThanOrEqual(15_000);
    }
  });

  it("leans one way or the other, so a range's middle is not the count, and leans the same way each time", () => {
    // Centred on the truth, a range told the reader the truth: its midpoint
    // was the exact count, whatever the source.
    const readings = ["hanno", "hiero", "bomilcar", "mago", "himilco"].map((reader) => estimateMen(9_100, "report", 5, ["legio-i", reader, 3]));
    for (const reading of readings) {
      expect(reading.low).toBeLessThanOrEqual(9_100);
      expect(reading.high).toBeGreaterThanOrEqual(9_100);
    }
    expect(readings.some((reading) => Math.abs((reading.low + reading.high) / 2 - 9_100) >= 200)).toBe(true);
    expect(new Set(readings.map((reading) => reading.label)).size).toBeGreaterThan(1);
    expect(estimateMen(9_100, "report", 5, ["legio-i", "hanno", 3])).toEqual(readings[0]);
  });

  it("says ships and wealth in words", () => {
    expect(estimateShips(40, "report", 0)).toMatch(/ships/);
    expect(wealthInWords(0)).toBe("a man with his hands and little else");
    expect(wealthInWords(5_000)).toBe("a fortune that is itself a kind of office");
  });
});

describe("how knowledge goes stale", () => {
  it("ages an army in days and an office in months", () => {
    expect(freshness(0, 10, "field")).toBe("aging");
    expect(freshness(0, 40, "field")).toBe("stale");
    expect(freshness(0, 40, "office")).toBe("fresh");
  });

  it("dates only what is no longer fresh, and says it may have changed", () => {
    const fresh = sourceLine([{ channel: "letter", fromLabel: "Hieron", asOfStep: 90 }], 95, "person", clock)!;
    expect(fresh.text).toBe("From Hieron's letter.");
    expect(fresh.asOfLabel).toBeNull();
    const stale = sourceLine([{ channel: "report", fromLabel: null, asOfStep: 0 }], 100, "field", clock)!;
    expect(stale.freshness).toBe("stale");
    expect(stale.text).toMatch(/may have changed/);
  });

  it("puts the surest source first and folds letters together", () => {
    const line = sourceLine([
      { channel: "rumour", fromLabel: null, asOfStep: 1 },
      { channel: "letter", fromLabel: "Hieron", asOfStep: 1 },
      { channel: "letter", fromLabel: "Hieron", asOfStep: 2 },
      { channel: "dealings", fromLabel: null, asOfStep: 2 },
    ], 3, "person", clock)!;
    expect(line.text).toBe("From your own dealings, Hieron's letters and talk you have heard.");
  });
});

describe("the glossary", () => {
  it("reads the viewer's own forces exactly and no one else's", () => {
    const state = world();
    const notes = glossaryOf(state, CONSUL);
    const foreign = state.material.forces.filter((force) => force.polityId !== "rome");
    expect(foreign.length).toBeGreaterThan(0);
    for (const force of foreign) {
      const note = notes[entityKey("force", force.id)] as ForceNote;
      const fit = force.personnel.reduce((sum, category) => sum + category.fit, 0);
      expect(note.yours).toBe(false);
      expect(note.conditionLabel).toBeNull();
      expect(note.strengthLabel).not.toBe(`${fit.toLocaleString("en-GB")} men`);
    }
  });

  it("gives a private citizen fewer people than a consul, and never everyone alive", () => {
    const state = world();
    const people = (id: string) => Object.keys(glossaryOf(state, id)).filter((key) => key.startsWith("person:"));
    const consul = people(CONSUL);
    expect(consul.length).toBeLessThan(state.characters.length);
    expect(people(CITIZEN).length).toBeLessThanOrEqual(consul.length);
  });

  it("never leaves a link pointing at a note that is not there", () => {
    const notes = glossaryOf(world(), CONSUL);
    const keys = new Set(Object.keys(notes));
    for (const note of Object.values(notes)) {
      const links = note === undefined ? [] : Object.values(note as object).flatMap((value: unknown): unknown[] =>
        Array.isArray(value) ? (value as unknown[]) : [value]).filter((value): value is { key: string | null } =>
        typeof value === "object" && value !== null && "key" in value);
      for (const linked of links) if (linked.key !== null) expect(keys.has(linked.key)).toBe(true);
    }
  });

  it("says where it knows each officeholder from", () => {
    const notes = glossaryOf(world(), CITIZEN);
    const holders = Object.values(notes).filter((note): note is PersonNote => note?.kind === "person" && note.office !== null);
    expect(holders.length).toBeGreaterThan(0);
    for (const holder of holders) expect(holder.source?.text).toMatch(/rolls of office/);
  });
});

import { moraleWhy, opinionWhy, taxWhy } from "./why";

describe("why a word is the word it is", () => {
  it("puts what is going wrong with the men first", () => {
    const why = moraleWhy({ moraleLabel: "sullen", provisionLabel: "short of supply", payStatus: "2 periods of pay owed", changeExplanation: "Nothing has changed since you last looked." });
    expect(why.causes.map((cause) => cause.tone)).toEqual(["bad", "mid"]);
    expect(why.remedy).toMatch(/victory/);
  });

  it("says a heavy tax as a share of what the land can give, never the sums", () => {
    const why = taxWhy({ polityId: "rome", bearable: 1_000, asked: 1_200, collectedShare: 0.5, held: 1, stabilityShiftBps: -2_000 });
    expect(why.causes.map((cause) => cause.label)).toEqual([
      "More is asked than the land can give",
      "The collectors bring in little of it",
      "Order in the provinces is breaking under it",
    ]);
    expect(JSON.stringify(why)).not.toMatch(/1,?200|1,?000/);
  });

  it("reads only the viewer's own mind about someone", () => {
    const state = world();
    const viewer = state.characters.find((character) => character.relations.some((relation) => relation.causes.length > 0))!;
    const target = viewer.relations.find((relation) => relation.causes.length > 0)!.subjectCharacterId;
    const labels = opinionWhy(viewer, target).causes.map((cause) => cause.label.toLowerCase());
    const theirs = viewer.relations.find((relation) => relation.subjectCharacterId === target)!.causes.map((cause) => cause.label.toLowerCase());
    for (const label of labels) expect(theirs).toContain(label);
  });
});

import { explanationOf, explanations } from "./explanations";
import { GOVERNMENT_FORM_IN_WORDS } from "../political-parts";

describe("what the words mean", () => {
  it("has a text for every form of government and every kind of office, and nothing thin", () => {
    for (const form of Object.keys(GOVERNMENT_FORM_IN_WORDS)) expect(explanationOf(`form:${form}`), form).not.toBeNull();
    for (const kind of ["magistracy", "membership", "priesthood"]) expect(explanationOf(`office:${kind}`), kind).not.toBeNull();
    for (const entry of explanations()) expect(entry.text.length).toBeGreaterThan(20);
  });

  it("gives every office and power note a text to show", () => {
    const seeded = world();
    const rome = seeded.characters.find((character) => character.id === CONSUL)!.polityId!;
    // The sim grows constitutions at the first tick (`ensureConstitutions`); the seed has none.
    const withForm: WorldState = { ...seeded, constitutions: [{ polityId: rome, form: "oligarchic_republic", origin: "scenario", adoptedAtStep: 0, rulerOfficeId: null, sovereignInstitutionId: null, history: [] }] };
    const glossary = readGlossary({ world: withForm, characterId: CONSUL, offices, successionRules });
    const notes = Object.values(glossary);
    const office = notes.find((note): note is OfficeNote => note?.kind === "office")!;
    expect(explanationOf(office.explainedBy)).not.toBeNull();
    const power = notes.find((note): note is PowerNote => note?.kind === "power" && note.explainedBy !== null)!;
    expect(explanationOf(power.explainedBy)).not.toBeNull();
  });
});

import { warInWords } from "./war";
import type { OfficeNote, PowerNote } from "./glossary";

describe("how the war goes", () => {
  it("reads a war from the viewer's side, and never gives the enemy's true count", () => {
    const state = world();
    const enemy = Object.values(glossaryOf(state, CONSUL)).find((note): note is PowerNote => note?.kind === "power" && note.war !== null);
    expect(enemy).toBeDefined();
    expect(enemy!.war!.headline.length).toBeGreaterThan(0);
    const text = JSON.stringify(enemy!.war);
    for (const force of state.material.forces) {
      const fit = force.personnel.reduce((sum, category) => sum + category.fit, 0);
      if (fit >= 100) expect(text).not.toContain(String(fit));
    }
  });

  it("says the enemy's numbers are unknown when nobody has counted them", () => {
    const state = world();
    const enemy = state.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "war" && (agreement.polityId === "rome" || agreement.otherPolityId === "rome"))!;
    const other = enemy.polityId === "rome" ? enemy.otherPolityId : enemy.polityId;
    const reading = warInWords(state, "rome", other, null)!;
    expect(reading.why.causes.map((cause) => cause.label)).toContain("Their numbers are unknown to you");
    expect(reading.why.remedy).toMatch(/dictates the peace/);
  });
});

describe("who could be next", () => {
  it("names who the electors would think of for an elected office of your own power", () => {
    const notes = glossaryOf(world(), CITIZEN);
    const elected = Object.values(notes).filter((note): note is OfficeNote => note?.kind === "office" && note.next !== null);
    expect(elected.length).toBeGreaterThan(0);
    expect(elected.some((note) => note.next!.talkedOf.length > 0)).toBe(true);
    for (const note of elected) expect(note.next!.talkedOf.map((linked) => linked.key)).not.toContain(`person:${CITIZEN}`);
  });

  it("does not guess at the next holder of another power's offices", () => {
    const notes = glossaryOf(world(), CONSUL);
    const foreign = Object.values(notes).filter((note): note is OfficeNote => note?.kind === "office" && note.polity?.label !== "Roman Republic");
    for (const note of foreign) expect(note.next).toBeNull();
  });
});

import { lookUp, lookupCandidates } from "./lookup";

describe("looking a word up", () => {
  const candidates = () => lookupCandidates(readGlossary({ world: world(), characterId: CONSUL, offices, successionRules }));

  it("finds a person by any word of the name, and the whole name first", () => {
    const all = candidates();
    const someone = all.find((candidate) => candidate.source === "note" && candidate.id.startsWith("person:") && candidate.label.includes(" "))!;
    const last = someone.label.split(" ").at(-1)!;
    expect(lookUp(last.toLowerCase(), all).map((hit) => hit.id)).toContain(someone.id);
    expect(lookUp(someone.label, all)[0]!.id).toBe(someone.id);
  });

  it("finds what a word means by the word itself", () => {
    expect(lookUp("siege", candidates())[0]!.id).toBe("rule:siege");
    expect(lookUp("foedus", candidates()).some((hit) => hit.id === "kind:foedus")).toBe(true);
  });

  it("finds nobody the player has no note for", () => {
    const state = world();
    const hidden = { ...structuredClone(state.characters.find((character) => character.id !== CONSUL)!), id: "hidden-conspirator", name: "Marcus Occultus", officeId: null, relations: [] };
    const withHidden: WorldState = { ...state, characters: [...state.characters, hidden] };
    const all = lookupCandidates(readGlossary({ world: withHidden, characterId: CONSUL, offices, successionRules }));
    expect(lookUp("occultus", all)).toEqual([]);
  });

  it("needs two letters, and folds accents and case", () => {
    expect(lookUp("s", candidates())).toEqual([]);
    expect(lookUp("SIÈGE", candidates())[0]!.id).toBe("rule:siege");
  });
});
