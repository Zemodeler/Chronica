import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { musterTheForces } from "./forces";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

/** Every string a reader would actually see on one force. */
const prose = (r: ReturnType<typeof musterTheForces>["forces"][number]): string[] =>
  [r.moraleLabel, r.provisionLabel, r.payStatus, r.changeExplanation, r.destinationLabel, r.commanderLabel];

describe("the muster, as the man responsible for it can read it", () => {
  it("the scenario has forces to read at all", () => {
    expect(musterTheForces(world(), null, offices).forces.length).toBeGreaterThan(0);
  });

  it("never states a condition as a score", () => {
    for (const force of musterTheForces(world(), null, offices).forces) {
      for (const line of [force.moraleLabel, force.provisionLabel, force.payStatus]) {
        expect(line).not.toMatch(/\d+\s*\/\s*\d+/);
      }
      // Nor an entity id, which is the model's business.
      for (const line of prose(force)) expect(line).not.toMatch(/\[[a-z0-9-]+\]/);
    }
  });

  it("counts the men present, not the establishment on paper", () => {
    // The map has always shown authorizedStrength, so a legion that lost half
    // its men at Agrigentum still read as four thousand strong.
    const state = world();
    const force = state.material.forces[0]!;
    const mauled: WorldState = {
      ...state,
      material: {
        ...state.material,
        forces: [{ ...force, personnel: force.personnel.map((c) => ({ ...c, fit: Math.floor(c.fit / 2) })) }],
      },
    };
    const read = musterTheForces(mauled, null, offices).forces[0]!;
    expect(read.fitStrength).toBeLessThan(read.authorizedStrength);
  });

  it("makes the headcount add up, because a man is either fit or he is not", () => {
    for (const force of musterTheForces(world(), null, offices).forces) {
      expect(force.fitStrength + force.unavailable).toBe(force.totalHeadcount);
    }
  });

  it("discounts what they are worth by the state they are in", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const with_ = (over: Partial<typeof force>): number =>
      musterTheForces({ ...state, material: { ...state.material, forces: [{ ...force, ...over }] } }, null, offices)
        .forces[0]!.effectiveStrength;
    expect(with_({ moraleBps: 3_000 })).toBeLessThan(with_({ moraleBps: 9_000 }));
    expect(with_({ fatigueBps: 9_000 })).toBeLessThan(with_({ fatigueBps: 0 }));
  });

  it("distinguishes men who are owed pay from men nobody has undertaken to pay", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const orphaned = musterTheForces(
      { ...state, material: { ...state.material, forces: [{ ...force, payObligationId: null }] } }, null, offices,
    ).forces[0]!;
    expect(orphaned.payStatus).toBe("Nobody has undertaken to pay them");
  });

  it("says what has happened to them lately, and says so when nothing has", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const quiet = musterTheForces(
      { ...state, material: { ...state.material, forces: [{ ...force, history: [] }] } }, null, offices,
    ).forces[0]!;
    expect(quiet.changeExplanation).toBe("Nothing has changed since you last looked.");

    const bloodied: WorldState = {
      ...state,
      material: {
        ...state.material,
        forces: [{
          ...force,
          history: [
            { id: "e1", atStep: state.elapsedStep, kind: "battle_death" as const, categoryId: force.personnel[0]!.categoryId, count: 40, causeId: "c1" },
            { id: "e2", atStep: state.elapsedStep, kind: "desertion" as const, categoryId: force.personnel[0]!.categoryId, count: 12, causeId: "c2" },
          ],
        }],
      },
    };
    const said = musterTheForces(bloodied, null, offices).forces[0]!.changeExplanation;
    expect(said).toContain("40 killed in action");
    expect(said).toContain("12 deserted");
  });

  it("forgets what happened long ago, because this is what changed since you looked", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const old: WorldState = {
      ...state,
      elapsedStep: 400,
      material: {
        ...state.material,
        forces: [{ ...force, history: [{ id: "e1", atStep: 10, kind: "battle_death" as const, categoryId: force.personnel[0]!.categoryId, count: 40, causeId: "c1" }] }],
      },
    };
    expect(musterTheForces(old, null, offices).forces[0]!.changeExplanation).toBe("Nothing has changed since you last looked.");
  });

  it("does not let a consul read the enemy's morale off his own muster roll", () => {
    // seesForce ends in speaksForPolity, which on its own is true for every
    // force in the world. The hatch widens sight within your own power; the
    // polity filter is what keeps it there, exactly as slice.ts does it.
    const state = world();
    const consul = state.material.officeSeats.find((x) => x.status === "held" && x.holderCharacterId !== null)!.holderCharacterId!;
    const ownPolity = state.characters.find((c) => c.id === consul)!.polityId;
    expect(state.material.forces.some((f) => f.polityId !== ownPolity)).toBe(true);

    const read = musterTheForces(state, consul, offices);
    expect(read.forces.length).toBeGreaterThan(0);
    const byId = new Map(state.material.forces.map((f) => [f.id, f]));
    for (const force of read.forces) {
      expect(byId.get(force.id)!.polityId, force.name).toBe(ownPolity);
    }
  });

  it("still counts a force you command under somebody else's flag", () => {
    const state = world();
    const consul = state.material.officeSeats.find((x) => x.status === "held" && x.holderCharacterId !== null)!.holderCharacterId!;
    const foreign = state.material.forces.find((f) => f.polityId !== state.characters.find((c) => c.id === consul)!.polityId)!;
    const handed: WorldState = {
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((f) => (f.id === foreign.id ? { ...f, commanderCharacterId: consul, controllerCharacterId: consul } : f)),
      },
    };
    expect(musterTheForces(handed, consul, offices).forces.some((f) => f.id === foreign.id)).toBe(true);
  });

  it("does not hand a private man the state's armies", () => {
    // The same seesForce the world slice uses.
    const state = world();
    const seated = new Set(state.material.officeSeats.filter((s) => s.status === "held").map((s) => s.holderCharacterId));
    const commanders = new Set(state.material.forces.flatMap((f) => [f.commanderCharacterId, f.controllerCharacterId]));
    const priv = state.characters.find((c) => c.alive && !seated.has(c.id) && !commanders.has(c.id));
    if (priv === undefined) return;
    expect(musterTheForces(state, priv.id, offices).forces).toHaveLength(0);
  });
});
