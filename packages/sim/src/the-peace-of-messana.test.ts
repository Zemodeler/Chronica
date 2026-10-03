import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, atWar, ensureProvinceMaterial, openWar, warStanding, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { concludePeace, priceOf, willingToGive } from "./peace";
import { EXTINCTION_AFTER_DAYS, endPolity, reviewPowers } from "./polity-end";
import { createIdFactory } from "./ports";

/**
 * Wars end now: by terms bargained for, or dictated by the side that won, and
 * a power beaten to nothing is no more -- though its people remember.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const MESSANA = PUNIC_IDS.messana;
const SYRACUSE_HOME = PUNIC_IDS.syracuse;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = { now: { day: 0, minute: 540 }, offices, warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("peace"), gameId: "game-peace" };
const war = (world: WorldState, a: string, b: string): WorldState => ({ ...world, polityAgreements: openWar(world.polityAgreements, { id: `war-${a}-${b}`, polityId: a, otherPolityId: b, terms: "War.", atStep: 0, sourceMessageId: null, reason: "War." }) });

/** Rome has taken Messana and every acre the Mamertines held round it, and they have nothing left but their garrison, then nothing at all. */
function messanaFallen(): WorldState {
  const world = war(opening(), "rome", "mamertines");
  return {
    ...world,
    map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id === MESSANA || province.controllerPolityId === "mamertines"
      ? { ...province, controllerPolityId: "rome", settlements: province.settlements.map((city) => ({ ...city, controllerPolityId: "rome" })), lostBy: { polityId: "mamertines", atStep: 0 } }
      : province)) },
  };
}

describe("how a war stands", () => {
  it("is won outright when the enemy holds no ground", () => {
    const standing = warStanding(messanaFallen(), "rome", "mamertines");
    expect(standing.totalDefeat).toBe(true);
    expect(standing.dictates).toBe(true);
    expect(warStanding(messanaFallen(), "mamertines", "rome").score).toBe(-100);
  });

  it("is even between two powers that have not yet fought", () => {
    const standing = warStanding(war(opening(), "rome", "syracuse"), "rome", "syracuse");
    expect(standing.dictates).toBe(false);
    expect(Math.abs(standing.score)).toBeLessThan(50);
  });
});

describe("a negotiated peace", () => {
  const atWarWithSyracuse = () => war(opening(), "rome", "syracuse");

  it("is made with no terms, each keeping what it holds", () => {
    const outcome = concludePeace(atWarWithSyracuse(), { proposerPolityId: "rome", otherPolityId: "syracuse", clauses: [], terms: "Each keeps what it holds.", representativeId: "hieron-ii", speakerId: "gaius-genucius" }, context, offices);
    expect(outcome.refusal).toBeNull();
    expect(atWar(outcome.world.polityAgreements, "rome", "syracuse")).toBe(false);
    expect(outcome.facts.some((fact) => fact.kind === "peace_made")).toBe(true);
  });

  it("will not give up its capital to a power that has not beaten it", () => {
    const world = atWarWithSyracuse();
    const clause = { kind: "cession" as const, provinceId: SYRACUSE_HOME, toPolityId: "rome" };
    // Its share of Syracuse's seventeen provinces, and thirty more for the capital.
    const price = priceOf(world, clause, "syracuse");
    expect(price).toBeGreaterThanOrEqual(35);
    expect(willingToGive(world, "syracuse", "rome", undefined, undefined)).toBeLessThan(price);
    const outcome = concludePeace(world, { proposerPolityId: "rome", otherPolityId: "syracuse", clauses: [clause], terms: "Syracuse to Rome.", representativeId: "hieron-ii", speakerId: "gaius-genucius" }, context, offices);
    expect(outcome.made).toBe(false);
    expect(outcome.refusal).toMatch(/cannot carry terms like these/);
  });

  it("is agreed only by somebody who speaks for the other side", () => {
    const outcome = concludePeace(atWarWithSyracuse(), { proposerPolityId: "rome", otherPolityId: "syracuse", clauses: [], terms: "Peace.", representativeId: "hanno-carthage", speakerId: "gaius-genucius" }, context, offices);
    expect(outcome.refusal).toMatch(/does not speak for/);
  });

  it("is not the player's order to declare while the war is undecided", () => {
    const deltas = [WorldDeltaSchema.parse({ op: "agreement_open", localId: "peace", kind: "peace", polityId: "rome", otherPolityId: "syracuse", terms: "Peace.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "The consul makes peace." })];
    const result = applyDeltas(atWarWithSyracuse(), deltas, { ...context, actorRef: { kind: "character", id: "gaius-genucius" }, actsForTheWorld: true, orderDeltas: new Set(deltas) } satisfies ApplyContext);
    expect(result.rejected[0]?.reason).toMatch(/not the order's to declare/);
    expect(atWar(result.world.polityAgreements, "rome", "syracuse")).toBe(true);
  });
});

describe("a dictated peace, and a surrender", () => {
  it("takes the beaten power into the victor, and it is no more", () => {
    const world = messanaFallen();
    const outcome = concludePeace(world, {
      proposerPolityId: "rome", otherPolityId: "mamertines", clauses: [{ kind: "submission", polityId: "mamertines", toPolityId: "rome" }],
      terms: "The Mamertines give themselves up to Rome.", representativeId: "mamertine-spokesman", speakerId: "gaius-genucius",
    }, context, offices);
    expect(outcome.refusal).toBeNull();
    expect(outcome.dictated).toBe(true);
    const mamertines = outcome.world.map.polities.find((polity) => polity.id === "mamertines")!;
    expect(mamertines.endedHow).toBe("absorbed");
    expect(outcome.world.characters.find((character) => character.id === "mamertine-spokesman")!.polityId).toBe("rome");
    expect(outcome.world.material.forces.some((force) => force.polityId === "mamertines")).toBe(false);
    expect(outcome.facts.some((fact) => fact.kind === "polity_ended")).toBe(true);
    // Its leader means to see it restored.
    expect(outcome.world.characters.find((character) => character.id === "mamertine-spokesman")!.ambitions.some((ambition) => ambition.targetId === "mamertines")).toBe(true);
  });

  it("will not take the surrender of a power that is not beaten", () => {
    const outcome = concludePeace(war(opening(), "rome", "syracuse"), {
      proposerPolityId: "rome", otherPolityId: "syracuse", clauses: [{ kind: "submission", polityId: "syracuse", toPolityId: "rome" }],
      terms: "Syracuse gives itself up.", representativeId: "hieron-ii", speakerId: "gaius-genucius",
    }, context, offices);
    expect(outcome.made).toBe(false);
  });
});

describe("a power with nothing left", () => {
  it("gives itself up at once to the power at war with it that took its last city and its army (deditio)", () => {
    const world = messanaFallen();
    const disarmed: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.polityId !== "mamertines") } };
    const yielded = reviewPowers({ ...disarmed, elapsedStep: 10 }, 10, createIdFactory("deditio-1")).world;
    expect(yielded.map.polities.find((polity) => polity.id === "mamertines")!.absorbedByPolityId).toBe("rome");
  });

  it("ends after sixty days with no ground and no army, where nobody at war with it took it", () => {
    // Its city lost, and the war over without terms: nobody to give itself up to.
    const fallen = messanaFallen();
    const world: WorldState = { ...fallen, polityAgreements: fallen.polityAgreements.map((agreement) => (agreement.kind === "war" && [agreement.polityId, agreement.otherPolityId].includes("mamertines") ? { ...agreement, status: "ended" as const, endedAtStep: 0, endedReason: "Lapsed." } : agreement)) };
    const disarmed: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.polityId !== "mamertines") } };
    const first = reviewPowers({ ...disarmed, elapsedStep: 10 }, 10, createIdFactory("empty-1")).world;
    expect(first.map.polities.find((polity) => polity.id === "mamertines")!.endedAtStep ?? null).toBeNull();
    const later = reviewPowers({ ...first, elapsedStep: 10 + EXTINCTION_AFTER_DAYS }, 10 + EXTINCTION_AFTER_DAYS, createIdFactory("empty-2"));
    expect(later.world.map.polities.find((polity) => polity.id === "mamertines")!.endedHow).toBe("extinct");
    expect(atWar(later.world.polityAgreements, "rome", "mamertines")).toBe(false);
  });

  it("lives on in exile while it has an army", () => {
    const world = messanaFallen();
    const later = reviewPowers({ ...reviewPowers(world, 10, createIdFactory("exile-1")).world, elapsedStep: 200 }, 200, createIdFactory("exile-2"));
    expect(later.world.map.polities.find((polity) => polity.id === "mamertines")!.endedAtStep ?? null).toBeNull();
  });
});

describe("a people who want their own back", () => {
  it("rise when the yearning is full, and restore the power that surrendered", () => {
    const absorbed = endPolity(messanaFallen(), "mamertines", "absorbed", "rome", 0).world;
    // A loose hold on Messana, and the yearning nearly full.
    const restless: WorldState = { ...absorbed, map: { ...absorbed.map, provinces: absorbed.map.provinces.map((province) => (province.id === MESSANA ? { ...province, controlFirmnessBps: 3_000, yearning: { polityId: "mamertines", bps: 9_900, updatedAtStep: 0 } } : province)) } };
    const rose = reviewPowers({ ...restless, elapsedStep: 30 }, 30, createIdFactory("rising"));
    const messana = rose.world.map.provinces.find((province) => province.id === MESSANA)!;
    expect(messana.controllerPolityId).toBe("mamertines");
    expect(rose.world.map.polities.find((polity) => polity.id === "mamertines")!.endedAtStep ?? null).toBeNull();
    expect(atWar(rose.world.polityAgreements, "mamertines", "rome")).toBe(true);
    expect(rose.world.material.forces.some((force) => force.polityId === "mamertines" && force.locationId === MESSANA)).toBe(true);
    expect(rose.facts.some((fact) => fact.kind === "rising" && /stood again/.test(fact.summary))).toBe(true);
  });
});
