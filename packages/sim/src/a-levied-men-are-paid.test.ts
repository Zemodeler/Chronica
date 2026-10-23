import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { SOLDIER_PAY_PER_THOUSAND, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * Loop 3, E-C: three thousand men were raised for Epirus in a fortnight and the treasury never changed; in the Decius run 1,600
 * men were hired for a legion that "nobody has undertaken to pay". New men are paid by their power's treasury.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string, state: WorldState, deltas: readonly WorldDelta[] = []): ApplyContext => ({
  orderDeltas: new Set(deltas), now: state.instant, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory(`pay-${actor}`), gameId: "game-pay", playerCharacterId: actor,
});

describe("men raised or hired", () => {
  it("are paid: a levy gets a pay obligation on the treasury of its power", () => {
    const start = world();
    const king = "gaius-genucius";
    const home = start.characters.find((character) => character.id === king)!.locationProvinceId;
    const levy = WorldDeltaSchema.parse({
      op: "force_create", localId: "levy-1", name: "Levy of Rome", polityId: "rome", commanderCharacterRef: king, controllerCharacterRef: king, locationId: home,
      authorizedStrength: 2_000, payObligationRef: null, reason: "The king calls men to the standards.",
    });
    const raised = applyDeltas(start, [levy], context(king, start, [levy]));
    expect(raised.rejected).toEqual([]);
    const force = raised.world.material.forces.find((candidate) => candidate.name === "Levy of Rome")!;
    expect(force.payObligationId).not.toBeNull();
    const obligation = raised.world.material.obligations.find((candidate) => candidate.id === force.payObligationId)!;
    const treasury = raised.world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!;
    expect(obligation.payerAccountId).toBe(treasury.id);
    expect(obligation.amount).toBeGreaterThanOrEqual(Math.floor(2_000 * SOLDIER_PAY_PER_THOUSAND / 1_000 * 0.5));
  });

  it("are paid when hired to a force that nobody paid", () => {
    const start = world();
    const king = "gaius-genucius";
    const home = start.characters.find((character) => character.id === king)!.locationProvinceId;
    const levy = WorldDeltaSchema.parse({
      op: "force_create", localId: "levy-2", name: "Levy of Rome", polityId: "rome", commanderCharacterRef: king, controllerCharacterRef: king, locationId: home,
      authorizedStrength: 500, payObligationRef: null, reason: "The king calls men.",
    });
    const raised = applyDeltas(start, [levy], context(king, start, [levy]));
    const force = raised.world.material.forces.find((candidate) => candidate.name === "Levy of Rome")!;
    // A force that came into the world unpaid (as the scenarios' own garrisons did) is paid from the first hire.
    const unpaid: WorldState = { ...raised.world, material: { ...raised.world.material, forces: raised.world.material.forces.map((candidate) => (candidate.id === force.id ? { ...candidate, payObligationId: null } : candidate)) } };
    const hire = WorldDeltaSchema.parse({
      op: "force_reinforce", forceRef: force.id, categoryId: "infantry", label: "Hired footmen", men: 300, fromForceRef: null, reason: "The king hires men.",
    });
    const hired = applyDeltas(unpaid, [hire], context(king, unpaid, [hire]));
    expect(hired.rejected).toEqual([]);
    const after = hired.world.material.forces.find((candidate) => candidate.id === force.id)!;
    expect(after.payObligationId).not.toBeNull();
    expect(hired.world.material.obligations.some((obligation) => obligation.id === after.payObligationId && obligation.amount > 0)).toBe(true);
  });
});
