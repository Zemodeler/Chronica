import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  atWar,
  leaderOf,
  mayEnterWithoutLeave,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * Rome's allies by foedus: the Samnites, Lucanians, Etruscans and the rest.
 *
 * They were drawn as Roman provinces, which made Rome's rule of Italy a thing
 * nobody could lose. Then they were their own powers, bound to nothing: Rome
 * could burn Samnium without a war, the Samnites could sign with Carthage, and
 * a Samnite army camped beside a consul's watched him be attacked. The foedus
 * is the bargain as it was -- soldiers, no tribute, no war or peace of their
 * own -- and these are the cases it has to get right.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const BRUTTIUM = PUNIC_IDS.rhegium;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const context = (actor: string, actsForTheWorld = false): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("foedus"),
  gameId: "game-foedus",
  actsForTheWorld,
});

function order(actor: string, written: readonly unknown[], state: WorldState = world(), actsForTheWorld = false) {
  const result = applyDeltas(state, written.map((raw) => WorldDeltaSchema.parse(raw)), context(actor, actsForTheWorld));
  expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  return result;
}

/** A Samnite levy camped in Bruttium beside the consul's army, with the Campanians of Rhegium there too. */
function aCampInBruttium(): WorldState {
  const state = world();
  const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
  return {
    ...state,
    material: {
      ...state.material,
      forces: [
        ...state.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: BRUTTIUM } : force)),
        { ...structuredClone(legion), id: "samnite-levy", name: "Samnite levy", polityId: "samnites", commanderCharacterId: "decius-vibellius", controllerCharacterId: "decius-vibellius", locationId: BRUTTIUM, authorizedStrength: 1_000, payObligationId: null, personnel: [{ ...structuredClone(legion.personnel[0]!), label: "Samnite infantry", fit: 900 }] },
      ],
    },
  };
}

describe("the allies of Rome", () => {
  it("are bound to Rome, and at war with whoever Rome is at war with", () => {
    const agreements = world().polityAgreements;
    expect(leaderOf(agreements, "samnites")).toBe("rome");
    expect(leaderOf(agreements, "messapians")).toBeNull();
    // Rome is at war with the Campanians of Rhegium, so its allies are too.
    expect(atWar(agreements, "samnites", "rhegium-campanians")).toBe(true);
    expect(atWar(agreements, "samnites", "carthage")).toBe(false);
    expect(atWar(agreements, "rome", "samnites")).toBe(false);
  });

  it("let a consul's army march through their country, and each other's, without trespass", () => {
    const agreements = world().polityAgreements;
    expect(mayEnterWithoutLeave(agreements, "rome", "samnites")).toBe(true);
    expect(mayEnterWithoutLeave(agreements, "lucanians", "samnites")).toBe(true);
    expect(mayEnterWithoutLeave(agreements, "rome", "messapians")).toBe(false);
  });

  it("make no treaty of their own with anybody else", () => {
    const result = order("gaius-genucius", [{
      op: "agreement_open", localId: "pact", kind: "alliance", polityId: "samnites", otherPolityId: "carthage",
      terms: "The Samnites and Carthage against Rome.", clauses: [], forDays: null, sourceMessageRef: null, visibility: "public", reason: "Samnite envoys at Carthage.",
    }], world(), true);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("bound to Roman Republic by foedus");
  });

  it("leave the foedus by going to war with Rome, which is a revolt", () => {
    const result = order("gaius-genucius", [{
      op: "agreement_open", localId: "revolt", kind: "war", polityId: "samnites", otherPolityId: "rome",
      terms: "The Samnites rise again.", clauses: [], forDays: null, sourceMessageRef: null, visibility: "public", reason: "The Pentri rise.",
    }], world(), true);
    expect(result.rejected).toEqual([]);
    expect(leaderOf(result.world.polityAgreements, "samnites")).toBeNull();
    expect(atWar(result.world.polityAgreements, "samnites", "rome")).toBe(true);
    // And no longer share Rome's quarrel with Rhegium.
    expect(atWar(result.world.polityAgreements, "samnites", "rhegium-campanians")).toBe(false);
  });

  it("are not attacked by Rome while the foedus stands", () => {
    const result = order("gaius-genucius", [{
      op: "force_engage", forceRef: "roman-field-army", targetForceRef: "samnite-levy", posture: "offer_battle", reason: "Punish the Samnites.",
    }], aCampInBruttium());
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("foedus");
  });

  it("are defended by the consul's army camped beside them", () => {
    const result = order("decius-vibellius", [{
      op: "force_engage", forceRef: "campanian-legion", targetForceRef: "samnite-levy", posture: "offer_battle", reason: "Fall on the Samnite camp.",
    }], aCampInBruttium());
    expect(result.rejected).toEqual([]);
    const battle = result.world.conflicts.battles.at(-1)!;
    expect(battle.participantForceIds).toEqual(expect.arrayContaining(["campanian-legion", "samnite-levy", "roman-field-army"]));
  });
});
