import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { peopleYouKnow, readPerson } from "./acquaintance";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
/**
 * The opening without the great houses' families (L10): a man knows his own
 * wife and children from the first day, and the two tests below are about
 * everybody else.
 */
const strangers = (): WorldState => ({ ...world(), familyLinks: [] });
const consul = (s: WorldState): string =>
  s.material.officeSeats.find((x) => x.status === "held" && x.holderCharacterId !== null)!.holderCharacterId!;

/**
 * Give the viewer a real dealing with somebody.
 *
 * At scenario opening the social graph is all but empty -- no ties but the
 * great houses' families, one social link, no order attempts, and the consul has no recorded relation
 * with anyone. That is the honest state of turn zero, so a test that wants an
 * acquaintance has to say so rather than hope one is lying about.
 */
const acquainted = (s: WorldState, viewerId: string, otherId: string): WorldState =>
  WorldStateSchema.parse({
    ...s,
    characters: s.characters.map((c) => (c.id !== viewerId ? c : {
      ...c,
      relations: [...c.relations, {
        subjectCharacterId: otherId,
        causes: [{
          id: "cause-served-together",
          label: "You served together at Rhegium.",
          score: 10,
          occurredAtStep: 0,
          decayPerYearBps: 1_000,
          encounterMemoryId: null,
        }],
      }],
    })),
  });

const someoneElse = (s: WorldState, viewerId: string): string =>
  s.characters.find((c) => c.id !== viewerId && c.alive)!.id;

/** Every string a reader would actually see on one person. */
const prose = (p: NonNullable<ReturnType<typeof readPerson>>): string[] => [
  p.name, p.officeLabel ?? "", p.polityLabel ?? "", p.whereLabel ?? "", p.ageLabel ?? "",
  p.standingLabel, p.yourOpinionLabel,
  ...p.knownForLabels, ...p.reputedSkillLabels, ...p.towardYouLabels,
  ...p.ties.map((t) => t.label),
  ...p.heard.flatMap((h) => [h.prefaceLabel, h.claim, h.fromLabel ?? "", h.whenLabel ?? ""]),
];

describe("everyone you know, and what you know of them", () => {
  it("does not hand a consul the whole roster", () => {
    // knowsPerson once ended in a polity-standing hatch; under it a consul
    // was acquainted with every character alive. Give him one real dealing
    // so the assertion is about the hatch and not about an empty graph.
    const base = strangers();
    const viewer = consul(base);
    const state = acquainted(base, viewer, someoneElse(base, viewer));
    const known = peopleYouKnow({ world: state, viewerId: viewer, offices });
    expect(known).toHaveLength(1);
    expect(state.characters.length - 1).toBeGreaterThan(1);
  });

  it("knows nobody at the opening, because nothing has happened yet", () => {
    // Not a defect: at turn zero the consul has no recorded dealings with
    // anyone, and the honest answer is an empty list that fills as he governs.
    const state = strangers();
    expect(peopleYouKnow({ world: state, viewerId: consul(state), offices })).toEqual([]);
  });

  it("knows his own household from the first day", () => {
    const state = world();
    const viewer = consul(state);
    const household = state.familyLinks.filter((link) => link.characterId === viewer || link.relatedCharacterId === viewer).length;
    expect(household).toBeGreaterThan(0);
    expect(peopleYouKnow({ world: state, viewerId: viewer, offices })).toHaveLength(household);
  });

  it("never leaks a score, an id, or a private reading", () => {
    const state = world();
    const viewer = consul(state);
    for (const person of peopleYouKnow({ world: state, viewerId: viewer, offices })) {
      for (const line of prose(person)) {
        expect(line).not.toMatch(/\d+\s*\/\s*100\b/);
        expect(line).not.toMatch(/\[[a-z0-9-]+\]/);
        // assessExecution's honesty clause, which fires before anyone has
        // discovered a thing.
        expect(line).not.toContain("not to be left alone with money");
      }
    }
  });

  it("cannot depend on the subject's secrets", () => {
    // The strongest form of the rule: change everything private about a man
    // and what you are shown of him does not move.
    const base = world();
    const viewer = consul(base);
    const state = acquainted(base, viewer, someoneElse(base, viewer));
    const subject = peopleYouKnow({ world: state, viewerId: viewer, offices })[0]!;
    const altered: WorldState = {
      ...state,
      characters: state.characters.map((c) => (c.id !== subject.id ? c : {
        ...c,
        mind: { ...c.mind, temperament: { ...c.mind.temperament, honesty: 5, discipline: 5 }, drives: { ...c.mind.drives, wealth: 95, duty: 5 } },
        ambitions: [],
      })),
    };
    expect(readPerson({ world: altered, viewerId: viewer, subjectId: subject.id, offices })).toEqual(
      readPerson({ world: state, viewerId: viewer, subjectId: subject.id, offices }),
    );
  });

  it("lets somebody you have only heard of appear, with nothing but hearsay", () => {
    const state = world();
    const viewer = consul(state);
    const stranger = state.characters.find(
      (c) => c.id !== viewer && !peopleYouKnow({ world: state, viewerId: viewer, offices }).some((p) => p.id === c.id),
    )!;
    const withRumour: WorldState = {
      ...state,
      characterBeliefs: [{
        id: "b1", holderCharacterId: viewer, subjectEntityId: stranger.id,
        claim: "He took money from the Syracusan envoys.", kind: "rumour",
        sourceCharacterId: null, sourceEventId: null, confidence: 35,
        visibility: "private", learnedAtStep: state.elapsedStep, expiresAtStep: null,
        supersedesBeliefIds: [], status: "active",
      }],
    };
    const read = peopleYouKnow({ world: withRumour, viewerId: viewer, offices }).find((p) => p.id === stranger.id);
    expect(read).toBeDefined();
    expect(read!.how).toBe("heard_of");
    expect(read!.heard[0]!.prefaceLabel).toBe("It is said");
    // You have never dealt with him, so you have no read on what he is good at.
    expect(read!.reputedSkillLabels).toEqual([]);
  });

  it("says what a man is good at only once you have dealt with him", () => {
    const base = world();
    const viewer = consul(base);
    const other = someoneElse(base, viewer);
    expect(peopleYouKnow({ world: base, viewerId: viewer, offices }).some((p) => p.id === other)).toBe(false);
    const known = peopleYouKnow({ world: acquainted(base, viewer, other), viewerId: viewer, offices })
      .filter((p) => p.how === "dealt_with");
    expect(known.length).toBeGreaterThan(0);
    expect(known[0]!.reputedSkillLabels.length).toBeGreaterThan(0);
  });

  it("reads how a man answered your orders, and never what he thinks of you", () => {
    const base = world();
    const viewer = consul(base);
    const state = acquainted(base, viewer, someoneElse(base, viewer));
    const subject = peopleYouKnow({ world: state, viewerId: viewer, offices })[0]!;
    const attempt = (id: string, status: "refused" | "delayed") => ({
      id, actionId: "a1",
      issuerRef: { kind: "character" as const, id: viewer },
      recipientRef: { kind: "character" as const, id: subject.id },
      claimedAuthorityGrantId: null,
      authorityCheck: { authorized: false, grant: null, standing: null, reason: "no standing" },
      instruction: "Hold the line.", standing: "requested" as const, status,
      recipientDecisionReason: null, issuedAtStep: 1,
      // Only a terminal status records when it was decided; "delayed" is still open.
      decidedAtStep: status === "refused" ? 2 : null,
      consequenceFactRefs: [], servesRef: null,
    });
    const ordered = WorldStateSchema.parse({
      ...state,
      orderAttempts: [attempt("o1", "refused"), attempt("o2", "delayed"), attempt("o3", "delayed")],
    });
    const read = readPerson({ world: ordered, viewerId: viewer, subjectId: subject.id, offices })!;
    expect(read.towardYouLabels).toContain("refused you once");
    expect(read.towardYouLabels).toContain("kept you waiting twice");
  });

  it("does not show you a private tie of theirs that does not involve you", () => {
    const base = world();
    const viewer = consul(base);
    const state = acquainted(base, viewer, someoneElse(base, viewer));
    const subject = peopleYouKnow({ world: state, viewerId: viewer, offices })[0]!;
    const third = state.characters.find((c) => c.id !== viewer && c.id !== subject.id)!;
    const linked: WorldState = {
      ...state,
      socialLinks: [{
        id: "l1", subjectCharacterId: subject.id, targetCharacterId: third.id,
        kind: "client", visibility: "private", sourceEventId: null, createdAtStep: 0,
      }],
    };
    expect(readPerson({ world: linked, viewerId: viewer, subjectId: subject.id, offices })!.ties).toEqual([]);
  });
});
