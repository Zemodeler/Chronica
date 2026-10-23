import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { CAST_ENTER_AT, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type CovertPlot, type WorldState } from "@chronica/shared";
import { FRIEND_OPINION, plotsOf, reviewCast, salienceOf } from "./cast";
import { ensureConstitutions } from "./constitutions";
import { playerInterests } from "./cognition-policy";

/**
 * A friend sits in the cast for a plot (the cast rule, with the friend seat; 2026-10-08).
 *
 * A man who holds the player in warm regard and is near him sits in one of the cast's seats, the friend's, when he has an important plot (a scheme, a thread, a letter,
 * a danger): his friendship sharpens it, as kinship and rivalry do. A friend with nothing at stake does not sit: it is the plot that brings him in, not the warmth.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const PLAYER = "gaius-genucius";
const FRIEND = "gnaeus-cornelius";
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });
const quiet = (world: WorldState): WorldState => ({
  ...world,
  polityAgreements: world.polityAgreements.filter((agreement) => agreement.kind !== "war"),
  storylines: world.storylines.map((storyline) => ({ ...storyline, phase: "closed" as const, closedAtStep: 0 })),
  characterPressures: world.characterPressures.map((pressure) => ({ ...pressure, status: "resolved" as never })),
});
const befriended = (world: WorldState, id: string, score = 30): WorldState => ({ ...world, characters: world.characters.map((character) => (character.id === id
  ? { ...character, relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== PLAYER), { subjectCharacterId: PLAYER, causes: [{ id: "c-friend", label: "Owes him much.", score, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] } : character)) });
const plotOf = (sponsor: string, target: string): CovertPlot => ({
  id: `plot-${sponsor}`, kind: "assassination", targetCharacterId: target, sponsorCharacterId: sponsor, agentCharacterId: null, spend: 0, cover: "A fever.", successOddsBps: 4_000, secrecyBps: 6_000,
  openedAtStep: 0, resolvesAtStep: 120, storylineId: null, outcome: null, resolvedAtStep: null,
} as unknown as CovertPlot);
const person = (world: WorldState, id: string) => world.characters.find((character) => character.id === id)!;

describe("a friend sits in the cast for a plot", () => {
  it("does not sit with nothing at stake, however warm he is", () => {
    const world = befriended(quiet(opening()), FRIEND, 60);
    expect(salienceOf(world, person(world, FRIEND), PLAYER)).toMatchObject({ score: 0, why: "of no account" });
    expect(reviewCast(world, PLAYER).cast.members.map((member) => member.characterId)).not.toContain(FRIEND);
  });

  it("sits in the friend's seat when a plot of his is in hand: warmth tips a plot that is not enough by itself", () => {
    const quietWorld = quiet(opening());
    const plotted = { ...quietWorld, covertPlots: [plotOf(FRIEND, "manius-curius")] };
    // The same plot in a man who is no friend of the player's is short of the line.
    const stranger = salienceOf(plotted, person(plotted, FRIEND), PLAYER);
    expect(stranger.score).toBeLessThan(CAST_ENTER_AT);
    expect(reviewCast(plotted, PLAYER).cast.members.map((member) => member.characterId)).not.toContain(FRIEND);
    // A friend's is over it, and he is given the friend's seat.
    const friendly = befriended(plotted, FRIEND);
    const reading = salienceOf(friendly, person(friendly, FRIEND), PLAYER);
    expect(reading.score).toBeGreaterThanOrEqual(CAST_ENTER_AT);
    expect(reading.seat).toBe("friend");
    expect(reading.why).toMatch(/friend|plot/);
    const seat = reviewCast(friendly, PLAYER).cast.members.find((member) => member.characterId === FRIEND);
    expect(seat?.seat).toBe("friend");
    // He is askable, as every seated man is.
    expect(playerInterests(friendly, PLAYER, definition.government.offices).detailOf(FRIEND)).toBe("personal");
  });

  it("wants him to be a friend, and near: a cooler man or a far one does not get the lift", () => {
    const base = { ...quiet(opening()), covertPlots: [plotOf(FRIEND, "manius-curius")] };
    const cool = befriended(base, FRIEND, FRIEND_OPINION - 5);
    expect(plotsOf(cool, person(cool, FRIEND), PLAYER).map((plot) => plot.why)).not.toContain("the player's friend");
    // A far friend with a plot is far from the player's concerns.
    const far = opening().characters.find((character) => character.polityId === "ireland-ulster-communities")!;
    const worldFar = befriended({ ...quiet(opening()), covertPlots: [plotOf(far.id, "gnaeus-cornelius")] }, far.id);
    expect(salienceOf(worldFar, person(worldFar, far.id), PLAYER)).toMatchObject({ score: 0, why: "far from the player's concerns" });
  });

  it("holds one seat for friends and is the same every time", () => {
    const friends = ["gnaeus-cornelius", "quintus-ogulnius", "manius-curius"];
    let world: WorldState = { ...quiet(opening()), covertPlots: friends.map((id) => plotOf(id, "gaius-genucius")) };
    for (const id of friends) world = befriended(world, id);
    const seated = reviewCast(world, PLAYER).cast.members.filter((member) => member.seat === "friend");
    expect(seated.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(reviewCast(world, PLAYER).cast)).toBe(JSON.stringify(reviewCast(world, PLAYER).cast));
  });
});
