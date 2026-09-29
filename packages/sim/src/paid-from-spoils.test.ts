import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  advanceWorldTo, localRef, ScenarioDefinitionSchema, untouchedWorthOf, WorldStateSchema,
  type WorldDelta, type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import { runDeterministicTick } from "./tick";

/**
 * "The spoils of war will be the payment to the soldiers."
 *
 * The order a player can give, followed all the way through: an obligation
 * drawn on the army's own chest instead of the treasury, plunder filling that
 * chest when the army takes ground, and the arrears rules doing the rest when
 * it stops. Every piece of this was inert until now -- `capturableValues` was
 * written by nothing, `"spoils"` was a transaction kind no code path produced,
 * accounts could not belong to an army, and `Force.payObligationId` could not
 * be written by any delta in the vocabulary.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const RHEGIUM = "punic-italy-bruttian-highlands";
const CHEST = "roman-field-army-chest";

/**
 * The consular army standing in Bruttium with the Campanian legion holding it.
 *
 * Marching it there is movement and is tested elsewhere; the scenario gives
 * the mutineers the city rather than the province, and the province is what
 * changes hands. Both are fixture, so that what is under test here is only
 * who pays the army and out of what.
 */
/** Somewhere the legion can stand that is not Rhegium. */
const NEXT_DOOR = (world: WorldState): string => {
  const edge = world.map.edges.find((candidate) => candidate.from === RHEGIUM || candidate.to === RHEGIUM)!;
  return edge.from === RHEGIUM ? edge.to : edge.from;
};

function atRhegium(): WorldState {
  const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return {
    ...opening,
    map: {
      ...opening.map,
      provinces: opening.map.provinces.map((province) =>
        province.id === RHEGIUM ? { ...province, controllerPolityId: "rhegium-campanians" } : province),
    },
    material: {
      ...opening.material,
      // The ground only: with the Campanian legion standing on it too, the two
      // armies now meet (`contact.ts`), and a battle's plunder is not the pay.
      forces: opening.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: RHEGIUM }
        : force.id === "campanian-legion" ? { ...force, locationId: NEXT_DOOR(opening) } : force)),
    },
  };
}

function context(state: WorldState) {
  return {
    now: state.instant,
    actorRef: { kind: "character" as const, id: "gaius-genucius" },
    offices: definition.government.offices,
    warfare: definition.warfare,
    terrains: definition.map.terrains,
    ids: createIdFactory("spoils"),
    gameId: "game-1",
  };
}

/** The order itself: a wage bill on the army's own chest, and the army put on it. */
const THE_ORDER: readonly WorldDelta[] = [
  {
    op: "obligation_upsert", localId: "from_spoils", obligationRef: null, kind: "army_pay",
    label: "The soldiers' share of what is taken", payerAccountRef: CHEST, recipientAccountRef: null,
    amount: 300, cadenceDays: 30, priority: 900, active: true,
    reason: "They are to be paid out of what they take, not out of the treasury.",
  },
  {
    op: "force_modify", forceRef: "roman-field-army", payObligationRef: localRef("from_spoils"),
    reason: "The army's wages come off its own chest from now on.",
  },
];

const army = (state: WorldState) => state.material.forces.find((force) => force.id === "roman-field-army")!;
const balance = (state: WorldState, id: string) => state.material.accounts.find((account) => account.id === id)!.balance;

function months(state: WorldState, count: number, ids = createIdFactory("tick")): WorldState {
  let current = state;
  for (let month = 0; month < count; month += 1) {
    const toDay = current.instant.day + 30;
    current = advanceWorldTo(
      runDeterministicTick({ world: current, toDay, ids, warfare: definition.warfare }).world,
      { day: toDay, minute: 0 },
    );
  }
  return current;
}

describe("paying an army out of what it takes", () => {
  it("is an order the engine can actually carry out", () => {
    const result = applyDeltas(atRhegium(), THE_ORDER, context(atRhegium()));

    expect(result.rejected).toHaveLength(0);
    const paymaster = result.world.material.obligations.find((o) => o.id === army(result.world).payObligationId)!;
    // The decisive bit: the wage bill is drawn on the army's chest, not on
    // Rome's treasury. Before this the same order could only add a charge to
    // the treasury -- the opposite of what it means.
    expect(paymaster.payerAccountId).toBe(CHEST);
    expect(paymaster.payerAccountId).not.toBe("rome-treasury");
  });

  it("pays the men while the chest holds out, and stops when it does not", () => {
    const ordered = applyDeltas(atRhegium(), THE_ORDER, context(atRhegium())).world;
    expect(balance(ordered, CHEST)).toBe(400);

    // 400 in the chest against 300 a month: one month paid, the next not.
    const first = months(ordered, 1);
    expect(balance(first, CHEST)).toBe(100);
    expect(first.material.obligations.find((o) => o.id === army(first).payObligationId)!.missedPeriods).toBe(0);

    const second = months(first, 1);
    expect(second.material.obligations.find((o) => o.id === army(second).payObligationId)!.missedPeriods).toBe(1);
    expect(army(second).payArrearsPeriods).toBe(1);
    expect(army(second).moraleBps).toBeLessThan(army(ordered).moraleBps);
  });

  it("fills the chest again when the army takes a province", () => {
    const ordered = applyDeltas(atRhegium(), THE_ORDER, context(atRhegium())).world;
    const worth = untouchedWorthOf(ordered, RHEGIUM);
    expect(worth).toBeGreaterThan(0);

    const taken = applyDeltas(
      ordered,
      [{ op: "province_control_set", provinceId: RHEGIUM, toPolityRef: "rome", firmnessBps: 3_000, reason: "Rhegium is retaken." }],
      context(ordered),
    );

    expect(taken.rejected).toHaveLength(0);
    expect(taken.world.map.provinces.find((p) => p.id === RHEGIUM)!.controllerPolityId).toBe("rome");
    // Into the army's chest, because the army that took it has one.
    expect(balance(taken.world, CHEST)).toBeGreaterThan(400);
    expect(taken.world.material.transactions.some((transaction) => transaction.kind === "spoils")).toBe(true);
  });

  it("starves the men when the army stops winning, which is the bargain", () => {
    const ordered = applyDeltas(atRhegium(), THE_ORDER, context(atRhegium())).world;
    const plundered = applyDeltas(
      ordered,
      [{ op: "province_control_set", provinceId: RHEGIUM, toPolityRef: "rome", firmnessBps: 3_000, reason: "Rhegium is retaken." }],
      context(ordered),
    ).world;

    // Rich for a while on what Rhegium had, and then not. Nothing else is
    // paying them: this is the whole of the arrangement the player chose.
    const after = months(plundered, 12);
    expect(after.material.obligations.find((o) => o.id === army(after).payObligationId)!.missedPeriods).toBeGreaterThan(0);
    expect(army(after).payArrearsPeriods).toBeGreaterThan(0);
    expect(army(after).moraleBps).toBeLessThan(army(plundered).moraleBps);

    const fit = (state: WorldState) => army(state).personnel.reduce((sum, category) => sum + category.fit, 0);
    expect(fit(after)).toBeLessThan(fit(plundered));

    // And Rome's treasury was never touched, because Rome was never paying.
    expect(balance(after, "rome-treasury")).toBeGreaterThan(balance(plundered, "rome-treasury"));
  });
});
