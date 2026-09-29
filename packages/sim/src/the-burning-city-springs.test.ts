import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  TRAP_MAX_TOLL_BPS,
  TRAP_MIN_TOLL_BPS,
  TRAP_SPEND_FOR_FULL_TOLL,
  WorldDeltaSchema,
  WorldStateSchema,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import { trapTollBps } from "./contingencies";
import { runDeterministicTick } from "./tick";
import type { ApplyContext } from "./apply/context";

/**
 * "When the Carthaginians pass through the first layer of walls, set it ablaze
 * and lock the gates, making sure every troop stuck inside that layer dies."
 *
 * The half of that order that did not exist. The plan could always be written
 * down -- `generic_entity_create` took its trigger, its action and its owner --
 * and nothing in the engine ever read it back, so the trap worked exactly when
 * the narrator happened to remember it next turn. `the-burning-city.test.ts`
 * carried a named, skipped test saying so for as long as that was true.
 *
 * What is held here is the shape that was chosen over the two nearby ones: the
 * world says what was prepared and what it cost, and the **engine** says what
 * it did. There is no field for the toll, and there is deliberately no way for
 * a plan to carry its own deltas -- the moment one can, every one will, and
 * casualties become something an author writes rather than something a world
 * works out.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const MESSANA = PUNIC_IDS.messana;
const ETNA = "position-mount-etna";

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("burning"),
  gameId: "game-1",
});

function order(written: readonly unknown[], state: WorldState = world()) {
  const deltas: WorldDelta[] = [];
  const unsayable: string[] = [];
  for (const raw of written) {
    const parsed = WorldDeltaSchema.safeParse(raw);
    if (parsed.success) deltas.push(parsed.data);
    else unsayable.push(`${(raw as { op?: string }).op}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  const result = applyDeltas(state, deltas, context());
  return { world: result.world, unsayable, refused: result.rejected.map((rejection) => rejection.reason) };
}

/** The plan, as the order describes it: the ward, the men it is for, and what it cost to lay. */
const THE_PLAN = (spend: number): unknown => ({
  op: "contingency_arm", localId: "burning_city", label: "The Burning City",
  ownerCharacterRef: "gaius-genucius",
  trigger: { kind: "force_enters_position", positionId: ETNA, polityId: "carthage" },
  effect: "spring_trap",
  provinceId: MESSANA, positionId: ETNA, againstPolityId: "carthage",
  fundingAccountRef: "rome-treasury", spend,
  ambushForceRef: null, expiresInDays: null,
  reason: "The ward is prepared with pitch and timber, and the gates made to bar from outside.",
});

/** Puts the Carthaginian field force into the trapped ground, which is the trigger. */
function walkIntoIt(state: WorldState): WorldState {
  return WorldStateSchema.parse({
    ...state,
    material: {
      ...state.material,
      forces: state.material.forces.map((force) => (force.id === "carthaginian-garrison"
        ? { ...force, locationId: MESSANA, positionId: ETNA }
        : force)),
    },
  });
}

const fitOf = (state: WorldState, forceId: string): number =>
  state.material.forces.find((force) => force.id === forceId)!.personnel.reduce((sum, category) => sum + category.fit, 0);

describe("laying the plan", () => {
  it("is armed, and paid for on the day it is laid", () => {
    const result = order([THE_PLAN(1_000)]);

    expect(result.unsayable).toEqual([]);
    expect(result.refused).toEqual([]);
    const plan = result.world.contingencies.at(-1)!;
    expect(plan.label).toBe("The Burning City");
    expect(plan.status).toBe("armed");
    // Pitch and timber bought months before anybody walks into it. A trap is
    // a thing you build, not a sentence you write.
    const treasury = result.world.material.accounts.find((account) => account.id === "rome-treasury")!;
    expect(treasury.balance).toBe(world().material.accounts.find((account) => account.id === "rome-treasury")!.balance - 1_000);
  });

  it("has no field for what it will do, or for whether it works", () => {
    // The whole reason this shape was chosen over one that carries deltas.
    expect(WorldDeltaSchema.safeParse({ ...(THE_PLAN(500) as object), tollBps: 9_000 }).success).toBe(false);
    expect(WorldDeltaSchema.safeParse({ ...(THE_PLAN(500) as object), deltas: [] }).success).toBe(false);
  });

  it("can be called off when the ground is given up", () => {
    const laid = order([THE_PLAN(400)]);
    const planId = laid.world.contingencies.at(-1)!.id;
    const called = order([{
      op: "contingency_disarm", contingencyRef: planId,
      reason: "The fires stopped drawing their watch, and the plan with them.",
    }], laid.world);

    expect(called.refused).toEqual([]);
    expect(called.world.contingencies.at(-1)!.status).toBe("disarmed");
  });
});

describe("the day it springs", () => {
  it("fires by itself, with nobody deciding to spring it", () => {
    // The assertion the skipped test was waiting for. No order is given on the
    // day: the world simply moves, and the trap goes off.
    const laid = order([THE_PLAN(2_000)]).world;
    const before = fitOf(laid, "carthaginian-garrison");

    const after = runDeterministicTick({
      world: walkIntoIt(laid), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });

    expect(after.world.contingencies.at(-1)!.status).toBe("sprung");
    expect(fitOf(after.world, "carthaginian-garrison")).toBeLessThan(before);
    expect(after.sprungContingencies).toHaveLength(1);
  });

  it("takes a third of them at the very most, however it was written", () => {
    const laid = order([THE_PLAN(TRAP_SPEND_FOR_FULL_TOLL * 4)]).world;
    const before = fitOf(laid, "carthaginian-garrison");

    const after = runDeterministicTick({
      world: walkIntoIt(laid), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });

    const lost = before - fitOf(after.world, "carthaginian-garrison");
    // The player asked for every man inside the ward to die. The honest answer
    // is a third of them, and the rest broken -- which decides a siege without
    // pretending an army is a number in a box.
    expect(lost).toBeLessThanOrEqual(Math.ceil((before * TRAP_MAX_TOLL_BPS) / 10_000));
    expect(lost).toBeGreaterThan(0);
    expect(after.world.contingencies.at(-1)!.tollBps).toBe(TRAP_MAX_TOLL_BPS);
  });

  it("breaks the men it does not kill", () => {
    const laid = order([THE_PLAN(2_000)]).world;
    const after = runDeterministicTick({
      world: walkIntoIt(laid), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });

    const caught = after.world.material.forces.find((force) => force.id === "carthaginian-garrison")!;
    const untouched = world().material.forces.find((force) => force.id === "carthaginian-garrison")!;
    // Out of proportion to what it kills, which is why a trap decides a siege.
    expect(caught.moraleBps).toBeLessThan(untouched.moraleBps / 2);
    expect(caught.cohesionBps).toBeLessThan(untouched.cohesionBps / 2);
  });

  it("burns the ward as well as the men in it", () => {
    const laid = order([THE_PLAN(2_000)]).world;
    const burnt = runDeterministicTick({
      world: walkIntoIt(laid), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });
    // The same stretch of time with nobody in the ward, so what is compared is
    // the trap and not the ordinary drift of a province over five days.
    const untouched = runDeterministicTick({
      world: laid, warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("quiet"),
    });

    const after = burnt.world.material.provinceMaterial.find((material) => material.provinceId === MESSANA)!;
    const before = untouched.world.material.provinceMaterial.find((material) => material.provinceId === MESSANA)!;
    expect(after.warDamageBps).toBeGreaterThan(before.warDamageBps);
    expect(after.productiveCapacityBps).toBeLessThan(before.productiveCapacityBps);
  });

  it("is worth what was spent on it, and nothing is free", () => {
    expect(trapTollBps(0)).toBe(TRAP_MIN_TOLL_BPS);
    expect(trapTollBps(TRAP_SPEND_FOR_FULL_TOLL)).toBe(TRAP_MAX_TOLL_BPS);
    expect(trapTollBps(TRAP_SPEND_FOR_FULL_TOLL * 100)).toBe(TRAP_MAX_TOLL_BPS);
    // The first coins buy the most: half the money is still most of the trap.
    expect(trapTollBps(TRAP_SPEND_FOR_FULL_TOLL / 2)).toBeGreaterThan(TRAP_MAX_TOLL_BPS / 2);
  });

  it("hands the ruler back the wheel, rather than telling him a month later", () => {
    const laid = order([THE_PLAN(1_000)]).world;
    const after = runDeterministicTick({
      world: walkIntoIt(laid), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });

    const told = after.factProposals.find((fact) => fact.kind === "trap_sprung")!;
    expect(told.summary).toContain("The Burning City");
    // Heavy enough that no entry bar keeps it out of the report he is reading.
    expect(told.significance).toBeGreaterThan(80);
  });
});

describe("what it will not do", () => {
  it("does not fire on men who were already standing in it", () => {
    // You cannot spring a trap on men who are already past it. The edge is the
    // same one `isWatchSatisfied` draws for the ruler's own watch conditions.
    const occupied = walkIntoIt(world());
    const laid = order([THE_PLAN(2_000)], occupied).world;
    const before = fitOf(laid, "carthaginian-garrison");

    const after = runDeterministicTick({
      world: laid, warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });

    expect(after.world.contingencies.at(-1)!.status).toBe("armed");
    expect(fitOf(after.world, "carthaginian-garrison")).toBe(before);
  });

  it("does not fire twice", () => {
    const laid = order([THE_PLAN(2_000)]).world;
    const first = runDeterministicTick({
      world: walkIntoIt(laid), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });
    const afterward = fitOf(first.world, "carthaginian-garrison");

    const second = runDeterministicTick({
      world: first.world, warfare: definition.warfare, life: definition.life,
      toDay: 40, ids: createIdFactory("again"),
    });

    expect(fitOf(second.world, "carthaginian-garrison")).toBe(afterward);
    expect(second.sprungContingencies).toEqual([]);
  });

  it("does not fire once it has been called off", () => {
    const laid = order([THE_PLAN(2_000)]);
    const planId = laid.world.contingencies.at(-1)!.id;
    const called = order([{
      op: "contingency_disarm", contingencyRef: planId, reason: "The ward is given up.",
    }], laid.world).world;
    const before = fitOf(called, "carthaginian-garrison");

    const after = runDeterministicTick({
      world: walkIntoIt(called), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("spring"),
    });

    expect(fitOf(after.world, "carthaginian-garrison")).toBe(before);
  });

  it("goes stale if nobody ever walks into it", () => {
    const laid = order([{ ...(THE_PLAN(500) as object), expiresInDays: 30 }]).world;
    const after = runDeterministicTick({
      world: laid, warfare: definition.warfare, life: definition.life,
      toDay: 60, ids: createIdFactory("rot"),
    });

    expect(after.world.contingencies.at(-1)!.status).toBe("lapsed");

    // And the money is not refunded: the timber was bought. Measured against
    // the same world without the plan, because sixty days of a tick also
    // collects revenue and pays wages, and a bare balance says nothing.
    const withoutIt = runDeterministicTick({
      world: world(), warfare: definition.warfare, life: definition.life,
      toDay: 60, ids: createIdFactory("rot"),
    });
    const balance = (state: WorldState): number =>
      state.material.accounts.find((account) => account.id === "rome-treasury")!.balance;
    expect(balance(withoutIt.world) - balance(after.world)).toBe(500);
  });

  it("catches whoever is standing in it when nobody was named", () => {
    // A trap does not check papers. Laid against nobody in particular, it takes
    // any force in the ward that is not its owner's own.
    const laid = order([{ ...(THE_PLAN(2_000) as object), againstPolityId: null }]).world;
    const after = runDeterministicTick({
      world: walkIntoIt(laid), warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("anyone"),
    });

    expect(after.world.contingencies.at(-1)!.status).toBe("sprung");
    expect(fitOf(after.world, "carthaginian-garrison")).toBeLessThan(fitOf(laid, "carthaginian-garrison"));
  });

  it("reports honestly when it springs on an empty ward", () => {
    // The trigger and the trap are about different things: "a Carthaginian
    // force enters the province" can be true of an army nowhere near the mine.
    const laid = order([{
      ...(THE_PLAN(2_000) as object),
      trigger: { kind: "force_enters_province", provinceId: MESSANA, polityId: "carthage" },
      positionId: ETNA,
    }]).world;

    const elsewhereInTheProvince = WorldStateSchema.parse({
      ...laid,
      material: {
        ...laid.material,
        forces: laid.material.forces.map((force) => (force.id === "carthaginian-garrison"
          ? { ...force, locationId: MESSANA, positionId: null }
          : force)),
      },
    });

    const after = runDeterministicTick({
      world: elsewhereInTheProvince, warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("empty"),
    });

    expect(after.world.contingencies.at(-1)!.status).toBe("sprung");
    expect(after.world.contingencies.at(-1)!.tollBps).toBe(0);
    expect(after.factProposals.some((fact) => fact.kind === "preparation_wasted")).toBe(true);
  });
});

describe("the men held back to fall on them (orders 7, 25, 28)", () => {
  it("fights an ordinary battle against an enemy the trap has already broken", () => {
    const laid = order([{ ...(THE_PLAN(2_000) as object), ambushForceRef: "roman-field-army" }]).world;
    const bothThere = WorldStateSchema.parse({
      ...walkIntoIt(laid),
      material: {
        ...walkIntoIt(laid).material,
        forces: walkIntoIt(laid).material.forces.map((force) => (force.id === "roman-field-army"
          ? { ...force, locationId: MESSANA }
          : force)),
      },
    });

    const after = runDeterministicTick({
      world: bothThere, warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("ambush"),
    });

    // The trap, and then a real battle -- resolved by the ordinary resolver,
    // against men who have just lost a third of their strength and their order.
    expect(after.world.contingencies.at(-1)!.status).toBe("sprung");
    expect(after.contingencyBattles).toHaveLength(1);
    expect(after.factProposals.some((fact) => fact.kind === "trap_sprung")).toBe(true);
  });
});

describe("the conditional whose consequence is a judgment (orders 27, 29, 45, 51, 53)", () => {
  it("stands to when a city falls, and gives the ruler the moment", () => {
    // "Should Hadrumentum fall, send the Senate a letter requesting legions."
    // Not an effect anybody can compute: it is the next order, and what it was
    // missing was a prompt at the moment the condition held.
    const laid = order([{
      op: "contingency_arm", localId: "when_it_falls", label: "Word to the Senate when Messana falls",
      ownerCharacterRef: "gaius-genucius",
      trigger: { kind: "settlement_control_changes", settlementId: "settlement-messana" },
      effect: "stand_to", provinceId: MESSANA, positionId: null, againstPolityId: null,
      fundingAccountRef: null, spend: 0, ambushForceRef: null, expiresInDays: 365,
      reason: "He means to write the moment the city changes hands, and not a week after.",
    }]);
    expect(laid.refused).toEqual([]);

    const taken = WorldStateSchema.parse({
      ...laid.world,
      map: {
        ...laid.world.map,
        provinces: laid.world.map.provinces.map((province) => (province.id === MESSANA
          ? { ...province, settlements: province.settlements.map((settlement) => ({ ...settlement, controllerPolityId: "rome" })) }
          : province)),
      },
    });

    const after = runDeterministicTick({
      world: taken, warfare: definition.warfare, life: definition.life,
      toDay: 5, ids: createIdFactory("stand-to"),
    });

    expect(after.world.contingencies.at(-1)!.status).toBe("sprung");
    expect(after.sprungContingencies).toHaveLength(1);
    // Nobody was hurt by it, and nothing was decided for him.
    expect(after.factProposals.some((fact) => fact.kind === "contingency_met")).toBe(true);
    expect(after.world.characterPressures.some(
      (pressure) => pressure.characterId === "gaius-genucius" && pressure.kind === "military_emergency",
    )).toBe(true);
  });
});
