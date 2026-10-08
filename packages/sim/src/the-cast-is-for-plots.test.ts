import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { CAST_ENTER_AT, ScenarioDefinitionSchema, WorldStateSchema, economyOf, ensureProvinceMaterial, modernWordsIn, type CovertPlot, type WorldState } from "@chronica/shared";
import { HARD_DECISION_AT, plotsOf, reviewCast, salienceOf } from "./cast";
import { ensureConstitutions } from "./constitutions";
import { houseFolkOf } from "./merchant-houses";
import { withWar } from "./fiscal-test-kit";

/**
 * The cast is for plots (the cast rule, docs/plans/government.md; 2026-10-08).
 *
 * A person enters the standing cast, the people the model plays, when he has an important plot -- a scheme he leads, a thread the narrator has made of a quarrel,
 * a contest he stands in, a war plan in an army he commands, a hard decision before him, a letter or an order that wants his own answer -- and it is in or near the player's
 * area. Holding an office, being rich, owning a house or ruling a power with nothing in hand gives nothing by itself: he runs on the rules. The patrons of the trading
 * houses the rules founded are the plain case.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const PLAYER = "gaius-genucius";
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });
const person = (world: WorldState, id: string) => world.characters.find((character) => character.id === id)!;
/** A world with the narrator's threads closed, nobody pressed and no war standing: nobody has a plot. */
const quiet = (world: WorldState): WorldState => ({
  ...world,
  polityAgreements: world.polityAgreements.filter((agreement) => agreement.kind !== "war"),
  storylines: world.storylines.map((storyline) => ({ ...storyline, phase: "closed" as const, closedAtStep: 0 })),
  characterPressures: world.characterPressures.map((pressure) => ({ ...pressure, status: "resolved" as never })),
});

const plotOf = (sponsor: string, target: string): CovertPlot => ({
  id: "plot-1", kind: "assassination", targetCharacterId: target, sponsorCharacterId: sponsor, agentCharacterId: null, spend: 0, cover: "A fever.", successOddsBps: 4_000, secrecyBps: 6_000,
  openedAtStep: 0, resolvesAtStep: 120, storylineId: null, outcome: null, resolvedAtStep: null,
} as unknown as CovertPlot);

describe("the cast is for plots", () => {
  it("is nobody's for his wealth, his office or his house: a world with nothing in hand has no cast but the nemesis", () => {
    const world = quiet(opening());
    const cast = reviewCast(world, PLAYER).cast.members;
    // The consul's colleague, the rulers of great powers, the suffetes, the kin: none of them has a plot, so none is in it.
    expect(cast.filter((member) => member.seat !== "nemesis")).toEqual([]);
    expect(salienceOf(world, person(world, "gnaeus-cornelius"), PLAYER).why).toBe("of no account");
    // Nor does fortune make one: the richest man of the world, an office-holder, with a purse of millions.
    const rich = economyOf(world).houses.map((house) => person(world, house.headCharacterId)).find((head) => head.polityId === "rome")!;
    const flush: WorldState = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === rich.personalAccountId ? { ...account, balance: 50_000_000 } : account)) } };
    expect(salienceOf(flush, rich, PLAYER).score).toBe(0);
    expect(plotsOf(flush, rich, PLAYER)).toEqual([]);
  });

  it("leaves the patrons of the trading houses on the rules, until a plot reaches one", () => {
    const world = opening();
    const folk = [...houseFolkOf(world)];
    expect(folk.length).toBeGreaterThan(10);
    const cast = reviewCast(world, PLAYER).cast.members.map((member) => member.characterId);
    for (const id of folk) expect(cast, `${person(world, id).name} is a house's patron and has no plot`).not.toContain(id);
    // A patron near the player with a plot of his own: he leads a scheme, and has a hard decision before him.
    const patron = person(world, economyOf(world).houses.find((house) => house.polityId === "rome")!.headCharacterId);
    const plotted: WorldState = {
      ...quiet(world),
      covertPlots: [plotOf(patron.id, "gnaeus-cornelius")],
      characterPressures: [...quiet(world).characterPressures, { id: "pressure-x", characterId: patron.id, label: "A rival firm means to ruin him.", intensity: HARD_DECISION_AT + 10, status: "active" } as never],
    };
    const now = salienceOf(plotted, patron, PLAYER);
    expect(now.score).toBeGreaterThanOrEqual(CAST_ENTER_AT);
    expect(now.why).toMatch(/leads a plot/);
    expect(reviewCast(plotted, PLAYER).cast.members.map((member) => member.characterId)).toContain(patron.id);
  });

  it("wants the plot to be in or near the player's area: the same thread far from his concerns is nothing", () => {
    const world = quiet(opening());
    const far = world.characters.find((character) => character.polityId === "ireland-ulster-communities")!;
    expect(far).toBeDefined();
    const plotted: WorldState = { ...world, covertPlots: [plotOf(far.id, far.id === "x" ? "y" : "gnaeus-cornelius")] };
    expect(plotsOf(plotted, far, PLAYER).length).toBeGreaterThan(0);
    expect(salienceOf(plotted, far, PLAYER)).toMatchObject({ score: 0, why: "far from the player's concerns" });
    // The same plot in a power the player deals with is heard.
    const near = world.characters.find((character) => character.polityId === "syracuse")!;
    expect(salienceOf({ ...world, covertPlots: [plotOf(near.id, "gnaeus-cornelius")] }, near, PLAYER).score).toBeGreaterThan(0);
  });

  it("takes the commander of a power's main army, when it is at war, as having a war plan; at peace with nothing before him, not", () => {
    const hanno = "hanno-carthage";
    const peaceful = quiet(opening());
    expect(salienceOf(peaceful, person(peaceful, hanno), PLAYER).score).toBe(0);
    const war = withWar(peaceful, "carthage", "rome");
    const reading = salienceOf(war, person(war, hanno), PLAYER);
    expect(reading.score).toBeGreaterThanOrEqual(CAST_ENTER_AT);
    expect(reading.why).toMatch(/commands the main army of Carthage/);
    expect(reviewCast(war, PLAYER).cast.members.map((member) => member.characterId)).toContain(hanno);
    // And the opening's own world, with the Messana thread and his hard decision, keeps him in as it did.
    expect(reviewCast(opening(), PLAYER).cast.members.map((member) => member.characterId)).toContain(hanno);
  });

  it("counts a letter that wants an answer, an order that wants doing and a contest for office as plots; kin and rivalry only sharpen one", () => {
    const world = quiet(opening());
    const kin = person(world, "rome-kin-dymex9");
    // The player's kin, with nothing before them: nothing.
    expect(salienceOf(world, kin, PLAYER).score).toBe(0);
    // A letter to the player awaiting his answer from a man of his own household.
    const lettered: WorldState = { ...world, diplomacy: [...world.diplomacy, { id: "m1", kind: "letter", fromPolityId: "rome", fromCharacterId: kin.id, toPolityId: "rome", toCharacterId: PLAYER, subject: "A request", terms: "Help me.", sentAtStep: 0, replyDueByStep: 30, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "private", onRefusal: null } as never] };
    const letter = plotsOf(lettered, kin, PLAYER);
    expect(letter.map((plot) => plot.kind)).toContain("letter");
    expect(letter.map((plot) => plot.why).join(" ")).toMatch(/kin/);
    // A candidate in an open election.
    const contender = person(world, "manius-curius");
    const contested: WorldState = { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, {
      id: "elect-1", type: "nomination", institutionId: "roman-comitia-centuriata", sponsorCharacterId: contender.id, subjectKind: "character", subjectId: contender.id, label: "Curius stands for consul",
      eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote", openedAtStep: 0, deadlineStep: 60, resolvedAtStep: null, visibility: "public",
      voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: [],
    } as never] } };
    expect(plotsOf(contested, contender, PLAYER).map((plot) => plot.kind)).toContain("contest");
  });

  it("says in the words of the age why a man is in it", () => {
    const world = opening();
    const lines = reviewCast(world, PLAYER).cast.members.map((member) => member.why);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.flatMap((line) => modernWordsIn(line))).toEqual([]);
  });

  it("is the same every time", () => {
    const a = JSON.stringify(reviewCast(opening(), PLAYER).cast);
    const b = JSON.stringify(reviewCast(opening(), PLAYER).cast);
    expect(a).toBe(b);
  });
});
