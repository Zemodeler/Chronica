import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * Men who answer to nobody.
 *
 * Every army belonged to a power, so a pirate squadron was Rome's navy under
 * another name: it could not fight Romans without "civil war", could not touch
 * a power Rome was at peace with, and answered to the consul. An outlaw band
 * follows whoever leads it and whoever pays it, and nobody makes peace with it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = "punic-italy-latium";

/** Curius, with a purse committed to paying armed men of his own. */
function world(): WorldState {
  const state = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return {
    ...state,
    material: {
      ...state.material,
      obligations: [...state.material.obligations, {
        id: "curius-band-pay", kind: "army_pay", label: "Curius's men", payerAccountId: "curius-purse", amount: 5, cadenceSteps: 30,
        nextDueStep: 30, priority: 500, arrears: 0, missedPeriods: 0, active: true,
      }],
    },
  };
}
const as = (actor: string, written: readonly unknown[], state: WorldState = world()) => {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`band-${actor}`), gameId: "game-band", actsForTheWorld: true, orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
};
const band = {
  op: "force_create", localId: "band", name: "The Sabine Wolves", polityId: "rome", outlaw: true, commanderCharacterRef: "manius-curius",
  controllerCharacterRef: "manius-curius", locationId: LATIUM, authorizedStrength: 300, payObligationRef: "curius-band-pay", reason: "Curius takes to the hills.",
};
const raised = () => {
  const result = as("manius-curius", [band]);
  expect(result.rejected).toEqual([]);
  return { world: result.world, id: result.assignedIds.get("band")! };
};

describe("an outlaw band", () => {
  it("is raised only with a private purse", () => {
    const { world: state, id } = raised();
    expect(state.material.forces.find((force) => force.id === id)?.outlaw).toBe(true);
    const fromTheState = as("gaius-genucius", [{ ...band, payObligationRef: null }]);
    expect(fromTheState.rejected[0]?.reason).toMatch(/private purse/);
  });

  it("answers to the man who leads it, not to the consul", () => {
    const { world: state, id } = raised();
    const consul = as("gaius-genucius", [{ op: "force_modify", forceRef: id, name: "The Consul's Wolves", reason: "Gaius claims them." }], state);
    expect(consul.rejected[0]?.kind).toBe("ignored");
  });

  it("fights Romans without a civil war, and raids Roman land", () => {
    const { world: state, id } = raised();
    const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(legion.locationId).toBe(LATIUM);
    const fought = as("manius-curius", [{
      op: "force_engage", forceRef: id, targetForceRef: legion.id, posture: "offer_battle", reason: "The Wolves fall on the consul's camp.",
    }], state);
    expect(fought.rejected).toEqual([]);
    // Whatever the battle does, it is not refused as Romans who will not fight Romans.
    expect(fought.rejected.map((rejection) => rejection.reason).join(" ")).not.toMatch(/answer to the same man|stand in/);
    expect(fought.factProposals.some((fact) => fact.kind === "civil_strife")).toBe(false);

    const raided = as("manius-curius", [{ op: "force_raid", forceRef: id, provinceId: LATIUM, reason: "They take what they need." }], state);
    expect(raided.rejected).toEqual([]);
  });

  it("is what a garrison becomes when it turns, and the world hears of it", () => {
    const turned = as("gaius-genucius", [{ op: "force_modify", forceRef: "roman-field-army", outlaw: true, reason: "The consul's men follow him out of the Republic." }]);
    expect(turned.rejected).toEqual([]);
    expect(turned.world.material.forces.find((force) => force.id === "roman-field-army")?.outlaw).toBe(true);
    expect(turned.factProposals.find((fact) => fact.kind === "gone_outlaw")?.visibility).toBe("public");
  });
});
