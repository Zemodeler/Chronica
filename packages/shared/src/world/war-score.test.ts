import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { EngagementSchema, WorldStateSchema, type WorldState } from "../index";
import { warLossesOf, warStanding } from "./war-score";

/**
 * A war's losses are laid to the war they belong to.
 *
 * A power with two wars bled twice for every man: each war's score read every loss of every army. Now a death in one of this
 * identified engagement is this war's; every other loss goes to the war the army is under orders in; and where it is under none,
 * it is shared among the power's wars, so the two wars' sums are the whole and no more.
 */
const CAMPANIANS = "rhegium-campanians";
const ARMY = "roman-field-army";
const base = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const atDay = (world: WorldState, day: number): WorldState => ({ ...world, elapsedStep: day, instant: { ...world.instant, day } });

type Event = WorldState["material"]["forces"][number]["history"][number];
const event = (kind: Event["kind"], count: number, atStep: number, causeId: string): Event => ({ id: `${kind}-${atStep}-${causeId}`, atStep, kind, categoryId: "infantry", count, causeId });
const lost = (world: WorldState, forceId: string, events: readonly Event[]): WorldState => ({
  ...world,
  material: { ...world.material, forces: world.material.forces.map((force) => (force.id === forceId ? { ...force, history: [...force.history, ...events] } : force)) },
});

/** Rome at war with Carthage from day 50, and an identified Rhegium engagement on day 100. */
function twoWars(world: WorldState): WorldState {
  const rhegium = world.polityAgreements.find((agreement) => agreement.id === "war-rome-rhegium")!;
  return {
    ...world,
    engagements: [...world.engagements, EngagementSchema.parse({
      id: "the-sally",
      provinceId: world.material.forces.find((force) => force.id === ARMY)!.locationId,
      attackerForceIds: [ARMY],
      defenderForceIds: [world.material.forces.find((force) => force.polityId === CAMPANIANS)!.id],
      openedByForceId: ARMY, openedAtStep: 100, lastRoundStep: 100,
      seeking: "battle", status: "ended", winner: "attacker", endedBy: "decided", endedAtStep: 100,
    })],
    polityAgreements: [
      ...world.polityAgreements.map((agreement) => (agreement.id === rhegium.id ? { ...agreement, battles: [{ atStep: 100, winnerPolityId: "rome", loserPolityId: CAMPANIANS, naval: false, engaged: 8_000 }] } : agreement)),
      { ...rhegium, id: "war-rome-carthage", polityId: "carthage", otherPolityId: "rome", sinceStep: 50, terms: "The war for Sicily.", battles: [] },
    ],
  };
}

describe("a war's losses", () => {
  it("counts hunger and sickness with the sword, and reads as the standing's blood", () => {
    const world = lost(atDay(base(), 200), ARMY, [event("attrition_death", 2_000, 100, `${ARMY}:hunger`), event("battle_death", 300, 110, "a-sally"), event("wounds_death", 50, 120, "a-sally"), event("desertion", 100, 130, `${ARMY}:hunger`)]);
    expect(warLossesOf(world, "rome", CAMPANIANS)).toEqual({ battle: 300, wounds: 50, hardship: 2_000, desertion: 100, total: 2_450 });
    expect(warStanding(world, "rome", CAMPANIANS).parts).toContain("has bled more");
    expect(warStanding(world, CAMPANIANS, "rome").parts).toContain("has bled them more");
  });

  it("lays a battle's dead to its identified engagement, and an idle army's hardship equally among the wars", () => {
    const world = lost(twoWars(atDay(base(), 200)), ARMY, [event("battle_death", 1_000, 100, "the-sally"), event("attrition_death", 600, 150, `${ARMY}:hunger`)]);
    const rhegium = warLossesOf(world, "rome", CAMPANIANS);
    const carthage = warLossesOf(world, "rome", "carthage");
    expect(rhegium).toMatchObject({ battle: 1_000, hardship: 300 });
    expect(carthage).toMatchObject({ battle: 0, hardship: 300 });
    expect(rhegium.total + carthage.total).toBe(1_600);
  });

  it("lays an army's hardship to the war it is under orders in", () => {
    const plain = lost(twoWars(atDay(base(), 200)), ARMY, [event("attrition_death", 600, 150, `${ARMY}:hunger`)]);
    const world: WorldState = {
      ...plain,
      campaigns: [{ forceId: ARMY, polityId: "rome", warId: "war-rome-carthage", theatreId: null, objective: { kind: "province", provinceId: "sic-4z01i" }, baseProvinceId: null, fallbackProvinceId: null, mode: "siege", issuedByCharacterId: "gaius-genucius", issuedStep: 140, expiresStep: 300 }],
    };
    expect(warLossesOf(world, "rome", "carthage").hardship).toBe(600);
    expect(warLossesOf(world, "rome", CAMPANIANS).hardship).toBe(0);
  });

  it("counts nothing from before the war, and nothing for a war that is not", () => {
    const world = lost(twoWars(atDay(base(), 200)), ARMY, [event("attrition_death", 600, 20, `${ARMY}:hunger`)]);
    expect(warLossesOf(world, "rome", "carthage").total).toBe(0);
    // Only the Rhegium war existed on day 20; a later war cannot take half its losses.
    expect(warLossesOf(world, "rome", CAMPANIANS).total).toBe(600);
    expect(warLossesOf(world, "rome", "macedon").total).toBe(0);
  });
});
