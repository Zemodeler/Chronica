import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, allianceBetween, gensById, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { ALLIANCE_FADES_BPS_PER_MONTH, keepGentes } from "./gentes";
import { matchOf, willingnessToWed } from "./marriage";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { named, opening, thinks } from "./gentes-test-kit";

/**
 * A marriage between two families is an alliance between two gentes: recorded on both, firm for a generation and fading unless
 * the next match renews it, and weighed when the next suit is made -- a grudge between the families counts against the suitor, an
 * old marriage for him.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: characterId }, offices: definition.government.offices, warfare: definition.warfare,
  ids: createIdFactory(`wed-${characterId}`), gameId: "game-1",
});

function proposes(world: WorldState, suitorId: string, fatherId: string, daughter: string): WorldState {
  const sent = applyDeltas(world, [WorldDeltaSchema.parse({
    op: "diplomatic_message_send", localId: "the_suit", kind: "marriage_offer", fromPolityId: "rome", fromCharacterRef: suitorId, toPolityId: "rome", toCharacterRef: fatherId,
    subject: `The hand of ${daughter}`, terms: `I ask for ${daughter} in marriage.`, reason: "He would marry into the house.",
  })], as(suitorId));
  expect(sent.rejected).toEqual([]);
  return sent.world;
}

describe("a marriage binds two gentes", () => {
  const start = opening();
  const blasio = named(start, "Gnaeus Cornelius Blasio");

  it("records an alliance on both gentes, with the pair, when a suit is accepted, and says so in the news", () => {
    expect(allianceBetween(start, "gens-cornelius", "gens-ogulnius")).toBe(0);
    const asked = proposes(thinks(start, blasio.id, "quintus-ogulnius", 40), "quintus-ogulnius", blasio.id, "Cornelia");
    const answered = runDeterministicTick({ world: asked, toDay: 2, ids: createIdFactory("wed"), warfare: definition.warfare });
    const strength = allianceBetween(answered.world, "gens-cornelius", "gens-ogulnius");
    expect(strength).toBeGreaterThanOrEqual(4_500);
    const cornelii = gensById(answered.world, "gens-cornelius")!;
    const alliance = cornelii.alliances.find((entry) => entry.withGensId === "gens-ogulnius")!;
    expect(alliance.groomId).toBe("quintus-ogulnius");
    expect(gensById(answered.world, "gens-ogulnius")!.alliances.some((entry) => entry.withGensId === "gens-cornelius")).toBe(true);
    expect(answered.factProposals.find((fact) => fact.kind === "marriage")!.summary).toMatch(/are bound by it/);
  });

  it("fades with the months unless renewed", () => {
    const asked = proposes(thinks(start, blasio.id, "quintus-ogulnius", 40), "quintus-ogulnius", blasio.id, "Cornelia");
    let world = runDeterministicTick({ world: asked, toDay: 2, ids: createIdFactory("wed"), warfare: definition.warfare }).world;
    const before = allianceBetween(world, "gens-cornelius", "gens-ogulnius");
    world = keepGentes({ ...world, instant: { ...world.instant, day: 40 }, elapsedStep: 40 }, 40).world;
    expect(allianceBetween(world, "gens-cornelius", "gens-ogulnius")).toBe(before - ALLIANCE_FADES_BPS_PER_MONTH);
  });

  it("weighs in the next suit: an old marriage for the suitor, a feud between the families against him", () => {
    const asked = proposes(thinks(start, blasio.id, "quintus-ogulnius", 40), "quintus-ogulnius", blasio.id, "Cornelia");
    const message = asked.diplomacy.find((entry) => entry.kind === "marriage_offer")!;
    const plain = willingnessToWed(asked, matchOf(asked, message)!);
    const withFeud: WorldState = { ...asked, gentes: asked.gentes.map((gens) => (gens.id === "gens-cornelius" ? { ...gens, feuds: [{ againstGensId: "gens-ogulnius", reason: "An old wrong.", sinceStep: -1_000, renewedAtStep: -1_000, intensityBps: 6_000 }] } : gens)) };
    const feuding = willingnessToWed(withFeud, matchOf(withFeud, message)!);
    expect(feuding.score).toBeLessThan(plain.score);
    expect(feuding.reasons.join(" ")).toMatch(/at feud/);
    const withTie: WorldState = { ...asked, gentes: asked.gentes.map((gens) => (gens.id === "gens-cornelius" ? { ...gens, alliances: [{ withGensId: "gens-ogulnius", sinceStep: -2_000, renewedAtStep: -2_000, strengthBps: 6_000, groomId: "quintus-ogulnius", brideId: "x" }] } : gens)) };
    const bound = willingnessToWed(withTie, matchOf(withTie, message)!);
    expect(bound.score).toBeGreaterThan(plain.score);
    expect(bound.reasons.join(" ")).toMatch(/bound by an old marriage/);
  });

  it("gives the child his father's gens, not his mother's", () => {
    const asked = proposes(thinks(start, blasio.id, "quintus-ogulnius", 40), "quintus-ogulnius", blasio.id, "Cornelia");
    const wed = runDeterministicTick({ world: asked, toDay: 2, ids: createIdFactory("wed"), warfare: definition.warfare }).world;
    const bride = wed.characters.find((character) => character.name === "Cornelia Blasionis")!;
    expect(bride.dynastyId).toBe("gens-cornelius");
    expect(wed.characters.find((character) => character.id === "quintus-ogulnius")!.dynastyId).toBe("gens-ogulnius");
  });
});
