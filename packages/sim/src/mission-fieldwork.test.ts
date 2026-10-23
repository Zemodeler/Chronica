import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { OrderPartSchema, ScenarioDefinitionSchema, WorldStateSchema, goalMet, orderPartStatus, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { explicitOrderGoals } from "./mission-intent";
import { continueMissions, menNamedIn } from "./mission-fieldwork";
import { runDeterministicTick } from "./tick";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = () => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const CONSUL = "gaius-genucius";
const SAID = "Send 2,000 men to start claiming the territory owned by them.";
const ORDER = `Find and kill the Campanian Legion. ${SAID}`;

function orderedWorld(): WorldState {
  const world = opening();
  const part = OrderPartSchema.parse({ said: SAID, goals: explicitOrderGoals(world, SAID, ORDER, "rome"), whyNot: "They watch the approaches instead." });
  world.orders = [{ id: "claim-order", actorCharacterId: CONSUL, text: ORDER, givenAtStep: 0, parts: [part] }];
  return world;
}
const partOf = (world: WorldState) => world.orders[0]!.parts[0]!;
const detachments = (world: WorldState) => world.material.forces.filter((force) => force.polityId === "rome" && force.name.startsWith("Detachment of"));

describe("an order to claim ground goes on being worked at", () => {
  it("reads the men from the words, and a city held in another's province as territory", () => {
    expect(menNamedIn(SAID)).toBe(2_000);
    expect(menNamedIn("Send two thousand men to Rhegium")).toBe(2_000);
    expect(menNamedIn("Send them to Rhegium")).toBeNull();
    expect(explicitOrderGoals(opening(), SAID, ORDER, "rome")).toEqual([expect.objectContaining({ kind: "control", polityId: "rome" })]);
  });

  it("makes the detachment, sets it as the part's mission and starts it on its way", () => {
    const world = orderedWorld();
    const before = world.material.forces.reduce((sum, force) => sum + force.personnel.reduce((n, group) => n + group.fit, 0), 0);
    const first = continueMissions({ world, toDay: 1, ids: createIdFactory("field") });
    const [made] = detachments(first.world);
    expect(made).toBeDefined();
    expect(made!.personnel.reduce((sum, group) => sum + group.fit, 0)).toBe(2_000);
    // The men come out of the army they were drawn from, not out of nowhere.
    expect(first.world.material.forces.reduce((sum, force) => sum + force.personnel.reduce((n, group) => n + group.fit, 0), 0)).toBe(before);
    expect(partOf(first.world).goals).toContainEqual(expect.objectContaining({ kind: "force_at", forceId: made!.id }));
    expect(partOf(first.world).whyNot).toBeNull();
    expect(first.facts.some((fact) => fact.kind === "force_reformed")).toBe(true);
    const target = partOf(first.world).goals.find((goal) => goal.kind === "control")!;
    if (made!.locationId !== (target as { provinceId: string }).provinceId) {
      expect(first.world.projects.some((project) => project.completionOutcome?.forceId === made!.id && project.status === "in_progress")).toBe(true);
      expect(first.facts.some((fact) => fact.kind === "march_begun")).toBe(true);
      expect(orderPartStatus(first.world, partOf(first.world))).toBe("under_way");
    }
    // Run again: nothing is made or sent twice.
    const second = continueMissions({ world: first.world, toDay: 2, ids: createIdFactory("field2") });
    expect(detachments(second.world)).toHaveLength(1);
    expect(second.world.projects).toHaveLength(first.world.projects.length);
  });

  it("carries the mission through the tick to the walls, or to the ground itself", () => {
    let world = continueMissions({ world: orderedWorld(), toDay: 1, ids: createIdFactory("long") }).world;
    const goal = partOf(world).goals.find((candidate) => candidate.kind === "control")!;
    for (let day = 2; day <= 220 && goalMet(world, goal) !== "met" && !world.sieges.some((siege) => siege.status === "active"); day += 6) {
      world = runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { day, minute: 0 } }, toDay: day, ids: createIdFactory(`tick-${day}`), playerCharacterId: CONSUL, warfare: definition.warfare }).world;
    }
    const made = detachments(world)[0]!;
    // It marched, arrived, and laid siege to the city the Campanians hold; the siege then runs by its own rules.
    expect(made.locationId).toBe((goal as { provinceId: string }).provinceId);
    expect(world.sieges).toContainEqual(expect.objectContaining({ forceId: made.id, settlementId: "settlement-rhegium", status: "active", defenderPolityId: "rhegium-campanians" }));
    expect(orderPartStatus(world, partOf(world))).not.toBe("achieved");
  });

  it("says why it stops where there is no war to take the ground in, and makes no army for it", () => {
    const world = orderedWorld();
    world.polityAgreements = world.polityAgreements.filter((agreement) => !(agreement.kind === "war" && [agreement.polityId, agreement.otherPolityId].includes("rhegium-campanians")));
    const result = continueMissions({ world, toDay: 1, ids: createIdFactory("peace") });
    expect(detachments(result.world)).toHaveLength(0);
    expect(partOf(result.world).whyNot).toMatch(/not at war/);
    expect(orderPartStatus(result.world, partOf(result.world))).not.toBe("achieved");
  });
});

describe("an order to kill a force is fought for, or stopped by something real", () => {
  const KILL = "Find and kill the Campanian Legion.";
  const killWorld = (): WorldState => {
    const world = opening();
    const part = OrderPartSchema.parse({ said: KILL, goals: explicitOrderGoals(world, KILL, KILL, "rome"), whyNot: "Rome guarantees safe passage, so the army holds instead." });
    world.orders = [{ id: "kill-order", actorCharacterId: CONSUL, text: KILL, givenAtStep: 0, parts: [part] }];
    world.material.forces = world.material.forces.map((force) => force.id === "roman-field-army" ? { ...force, hold: true } : force);
    return world;
  };
  const input = (world: WorldState, toDay: number, extra: Partial<Parameters<typeof continueMissions>[0]> = {}) => ({
    world, toDay, ids: createIdFactory(`kill-${toDay}`), warfare: definition.warfare, government: { offices: definition.government.offices, successionRules: [] },
    clock: definition.clock, playerCharacterId: CONSUL, ...extra,
  });

  it("lifts the hold and sends the army where the legion is, rather than leaving it holding", () => {
    const world = killWorld();
    const roman = () => world.material.forces.find((force) => force.id === "roman-field-army")!;
    const target = world.material.forces.find((force) => force.id === "campanian-legion")!;
    const result = continueMissions(input(world, 1));
    const army = result.world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(army.hold).not.toBe(true);
    if (roman().locationId !== target.locationId) {
      expect(result.world.projects.some((project) => project.completionOutcome?.forceId === army.id && project.completionOutcome?.provinceId !== null && project.status === "in_progress")).toBe(true);
    }
    expect(result.world.material.forces.find((force) => force.id === "campanian-legion")!.personnel[0]!.fit).toBe(3_600);
    expect(orderPartStatus(result.world, result.world.orders[0]!.parts[0]!)).not.toBe("achieved");
  });

  it("offers battle when the armies are in one place, and invents no death", () => {
    const world = killWorld();
    const target = world.material.forces.find((force) => force.id === "campanian-legion")!;
    world.material.forces = world.material.forces.map((force) => force.id === "roman-field-army" ? { ...force, locationId: target.locationId } : force);
    const result = continueMissions(input(world, 1));
    expect(result.world.engagements.some((engagement) => engagement.attackerForceIds.includes("roman-field-army") && engagement.defenderForceIds.includes("campanian-legion"))).toBe(true);
    // A fight begun is not a force killed: the goal is still read from deaths alone.
    expect(goalMet(result.world, result.world.orders[0]!.parts[0]!.goals.find((goal) => goal.kind === "force_killed")!)).toBe("not_yet");
    // Not opened a second time.
    const again = continueMissions(input(result.world, 2));
    expect(again.world.engagements).toHaveLength(result.world.engagements.length);
  });

  it("gives way to a later word from the same man about that army", () => {
    const world = killWorld();
    world.orders.push({ id: "later", actorCharacterId: CONSUL, text: "Hold the field army at Rhegium.", givenAtStep: 5,
      parts: [OrderPartSchema.parse({ said: "Hold the field army at Rhegium.", goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: "it-5sjyb" }] })] });
    const result = continueMissions(input(world, 6));
    expect(result.world.material.forces.find((force) => force.id === "roman-field-army")!.hold).toBe(true);
    expect(result.world.projects).toHaveLength(world.projects.length);
  });
});
