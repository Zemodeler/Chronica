import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  computeOpinion,
  deriveRelationDimension,
  driftMind,
  NEUTRAL_MIND,
  WorldStateSchema,
  type BattleResult,
  type PoliticalProcedure,
  type WorldState,
} from "@chronica/shared";
import { lapseAilments } from "./ailments";
import { ensureConstitutions } from "./constitutions";
import { reviewLives } from "./mortality";
import { plotOdds } from "./plots";
import { judgmentLean, sentenceByOutcome, summonToJudgment } from "./trials";
import { createIdFactory } from "./ports";

/**
 * What happens to a man changes him, and changes what others think of him.
 * A general who loses is thought less of by the men he serves and grows more
 * careful; a man whose kinsman is condemned hates whoever brought the charge;
 * a bold man broken by defeats is no longer called bold.
 */

const { offices, successionRules } = punicWarsScenario.definition.government;
const base = (): WorldState => ensureConstitutions({ world: WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), government: { offices, successionRules }, toDay: 0 });
const who = (world: WorldState, id: string) => world.characters.find((character) => character.id === id)!;

describe("a mind that moves", () => {
  it("grows careful with defeats, a little at a time, and lets go a name it no longer bears out", () => {
    const bold = { ...NEUTRAL_MIND, temperament: { ...NEUTRAL_MIND.temperament, boldness: 32, caution: 40 } };
    const once = driftMind(bold, ["bold"], [{ kind: "defeat", atStep: 10 }]);
    expect(once.mind.temperament.caution).toBe(42);
    expect(once.mind.temperament.boldness).toBe(31);
    expect(once.traits).toEqual(["bold"]);
    // Five defeats in one season move him no more than six.
    const routed = driftMind(bold, ["bold"], Array.from({ length: 5 }, (_, index) => ({ kind: "defeat" as const, atStep: index })));
    expect(routed.mind.temperament.caution).toBe(46);
    expect(routed.mind.temperament.boldness).toBe(27);
    expect(routed.shed).toEqual(["bold"]);
    expect(routed.traits).toEqual([]);
  });

  it("is moved at his life review by what he learned since, and the lessons are spent", () => {
    const world = base();
    const hieron = who(world, "hieron-ii");
    const taught: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === hieron.id
        ? { ...character, nextLifeReviewAtStep: 10, lessons: [{ kind: "plotted_against", atStep: 5 }] }
        : character)),
    };
    const reviewed = reviewLives({ world: taught, life: punicWarsScenario.definition.life, toDay: 10, ids: createIdFactory("life") });
    const after = who(reviewed.world, hieron.id);
    expect(after.mind.temperament.caution).toBe(Math.min(100, hieron.mind.temperament.caution + 2));
    expect(after.lessons).toEqual([]);
  });
});

describe("a battle, as the men he serves see it", () => {
  it("costs the loser their respect and teaches him defeat", () => {
    const world = base();
    const force = world.material.forces.find((candidate) => candidate.id === "carthaginian-garrison")!;
    const result = { battleId: "battle-himera", outcome: "defender_victory", participantIds: [force.id, "roman-army"] } as unknown as BattleResult;
    const judged = summonToJudgment(world, result, [force], "Himera").world;
    const commander = who(judged, force.commanderCharacterId);
    expect(commander.lessons?.map((lesson) => lesson.kind)).toContain("defeat");
  });
});

describe("a trial, and those who remember it", () => {
  const trial = (sponsor: string, subject: string, outcome: "passed" | "failed", sentence: PoliticalProcedure["sentence"] = "fine"): PoliticalProcedure => ({
    id: `t-${subject}`, type: "denunciation", institutionId: "carthaginian-hundred-and-four", sponsorCharacterId: sponsor, subjectKind: "character", subjectId: subject,
    label: "The trial", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote", openedAtStep: 0,
    deadlineStep: 10, resolvedAtStep: 10, visibility: "public", voteRecordId: null, outcome, outcomeReason: "Decided.", sourceEventIds: [], resultingEventIds: [], sentence,
  });

  it("leaves the condemned hating the man who brought the charge, and his blood with him", () => {
    const world = base();
    const [accused, sponsor] = world.characters.filter((character) => character.alive && character.polityId === "carthage").map((character) => character.id);
    const kinsman = world.characters.find((character) => character.alive && character.id !== accused && character.id !== sponsor)!.id;
    const withKin: WorldState = { ...world, familyLinks: [...world.familyLinks, { id: "kin", characterId: accused!, relatedCharacterId: kinsman, kind: "sibling", startedAtStep: 0, endedAtStep: null, visibility: "public", provenanceEventId: null }] };
    const convicted = sentenceByOutcome(withKin, trial(sponsor!, accused!, "passed", "exile"), 10);
    expect(computeOpinion(who(convicted, accused!), sponsor!)).toBeLessThanOrEqual(-20);
    expect(computeOpinion(who(convicted, kinsman), sponsor!)).toBeLessThan(0);
    expect(who(convicted, accused!).lessons?.map((lesson) => lesson.kind)).toContain("convicted");
  });

  it("leaves a man acquitted remembering who tried to ruin him", () => {
    const world = base();
    const [accused, sponsor] = world.characters.filter((character) => character.alive && character.polityId === "carthage").map((character) => character.id);
    const cleared = sentenceByOutcome(world, trial(sponsor!, accused!, "failed"), 10);
    expect(deriveRelationDimension(who(cleared, accused!), sponsor!, "trust")).toBeLessThan(0);
    expect(who(cleared, accused!).lessons?.map((lesson) => lesson.kind)).toEqual(["acquitted"]);
  });

  it("is harder on a man nobody has a good word for than on one everybody praises", () => {
    const world = base();
    const accused = world.characters.find((character) => character.alive && character.polityId === "carthage")!.id;
    const spokenOf = (score: number): WorldState => ({
      ...world,
      characters: world.characters.map((character) => (character.id !== accused && character.alive
        ? { ...character, relations: [...character.relations, { subjectCharacterId: accused, causes: [{ id: `said-${character.id}`, label: "What is said of him.", score: 0, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { reputation: score } }] }] }
        : character)),
    });
    const praised = judgmentLean(spokenOf(20), trial("x", accused, "passed"), "carthage");
    const despised = judgmentLean(spokenOf(-20), trial("x", accused, "passed"), "carthage");
    expect(praised.lean).toBeLessThan(despised.lean);
    expect(despised.reasons.join(" ")).toContain("ill spoken of");
  });
});

describe("what sort of men lay a plot", () => {
  it("gives a bold hand better odds and a worse secret than a cautious one", () => {
    const world = base();
    const [sponsor, target] = world.characters.filter((character) => character.alive).slice(0, 2);
    const as = (traits: string[]) => plotOdds(world, { kind: "assassination", target: target!, sponsor: { ...sponsor!, traits }, agent: null, spend: 0 });
    const bold = as(["bold"]);
    const careful = as(["cautious", "disciplined"]);
    expect(bold.successOddsBps).toBeGreaterThan(careful.successOddsBps);
    expect(bold.secrecyBps).toBeLessThan(careful.secrecyBps);
  });
});

describe("a wound for life", () => {
  it("does not pass like a fever", () => {
    const world = base();
    const man = world.characters.find((character) => character.alive)!;
    const maimed: WorldState = { ...world, characters: world.characters.map((character) => (character.id === man.id ? { ...character, disqualifyingStatuses: ["injured:lost-arm", "fever"] } : character)) };
    const later = lapseAilments(maimed, 400).world;
    expect(who(later, man.id).disqualifyingStatuses).toEqual(["injured:lost-arm"]);
  });
});
