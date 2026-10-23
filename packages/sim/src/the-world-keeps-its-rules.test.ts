import { afterEach, describe, expect, it, vi } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, rungOf, type WorldState } from "@chronica/shared";
import { INVARIANT_IDS, InvariantBroken, checkStep, findViolations } from "./invariants";

/**
 * Each rule of the world (`invariants.ts`, docs/plans/engine-guarantees.md part 2) is caught when it is broken, the opening world
 * keeps them all, and a step that breaks one stops the run when strict and is only reported when not.
 */
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const caught = (world: WorldState): string[] => [...new Set(findViolations(world).map((violation) => violation.rule))];

function broken(rule: string): WorldState {
  const world = opening();
  const material = world.material;
  switch (rule) {
    case "fleet.one-voyage": {
      const fleet = material.forces.find((force) => force.personnel.some((row) => row.categoryId === "warship"))!;
      const army = material.forces.find((force) => force.id !== fleet.id)!;
      const voyage = (id: string) => ({
        id, label: `Crossing ${id}`, status: "in_progress" as const, ownerRef: { kind: "polity" as const, id: fleet.polityId }, kind: "transport", startedAtStep: 0, dueAtStep: 30,
        completionOutcome: { kind: "force_move" as const, forceId: army.id, toProvinceId: army.locationId, fleetIds: [fleet.id] },
      });
      return { ...world, projects: [...world.projects, voyage("one"), voyage("two")] as unknown as WorldState["projects"] };
    }
    case "force.one-army-a-man": {
      const man = world.characters.find((character) => character.alive)!.id;
      return { ...world, material: { ...material, forces: material.forces.map((force, index) => (index < 2 ? { ...force, memberCharacterIds: [man] } : force)) } };
    }
    case "person.made-once": {
      const man = world.characters.find((character) => character.alive && character.name.split(" ").length >= 2)!;
      return { ...world, characters: [...world.characters, { ...man, id: `${man.id}-again` }] };
    }
    case "office.held-by-the-living": {
      const seat = material.officeSeats.find((candidate) => candidate.status === "held")!;
      return { ...world, characters: world.characters.map((character) => (character.id === seat.holderCharacterId ? { ...character, alive: false } : character)) };
    }
    case "office.one-magistracy": {
      const seats = material.officeSeats.filter((seat) => rungOf(seat.officeId) !== undefined);
      const held = seats.find((seat) => seat.status === "held")!;
      const other = seats.find((seat) => seat.officeId !== held.officeId)!;
      return { ...world, material: { ...material, officeSeats: material.officeSeats.map((seat) => (seat.id === other.id ? { ...seat, designateCharacterId: held.holderCharacterId } : seat)) } };
    }
    case "diplomacy.one-footing": {
      const agreement = (id: string, kind: "war" | "alliance") => ({ ...world.polityAgreements[0]!, id, kind, polityId: "rome", otherPolityId: "syracuse", status: "active" as const });
      return { ...world, polityAgreements: [...world.polityAgreements, agreement("rule-war", "war"), agreement("rule-alliance", "alliance")] };
    }
    case "polity.ended-holds-nothing":
      return { ...world, map: { ...world.map, polities: world.map.polities.map((polity) => (polity.id === "syracuse" ? { ...polity, endedAtStep: 0, endedHow: "absorbed" as const } : polity)) } };
    case "ids.unique":
      return { ...world, material: { ...material, accounts: [...material.accounts, material.accounts[0]!] } };
    default:
      throw new Error(`no broken world for ${rule}`);
  }
}

describe("the world keeps its rules", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is kept by the opening world", () => {
    expect(findViolations(opening())).toEqual([]);
  });

  for (const rule of INVARIANT_IDS) {
    it(`catches a world that breaks ${rule}`, () => {
      expect(caught(broken(rule))).toContain(rule);
    });
  }

  it("catches money moved with no line to say why", () => {
    const before = opening();
    vi.stubEnv("CHRONICA_STRICT", "0");
    const after: WorldState = { ...before, material: { ...before.material, accounts: before.material.accounts.map((account, index) => (index === 0 ? { ...account, balance: account.balance + 1_000 } : account)) } };
    expect(checkStep("a test", before, after).map((violation) => violation.rule)).toEqual(["money.conserved"]);
  });

  it("catches men an act raised that nobody pays, and only what the act raised", () => {
    const before = opening();
    vi.stubEnv("CHRONICA_STRICT", "0");
    const army = before.material.forces.find((force) => force.id === "roman-field-army")!;
    const levy = { ...army, id: "a-new-levy", name: "A new levy", payObligationId: null };
    const raised: WorldState = { ...before, material: { ...before.material, forces: [...before.material.forces, levy] } };
    expect(checkStep("acts", before, raised, { acts: true }).map((violation) => violation.rule)).toEqual(["force.raised-paid"]);
    expect(checkStep("acts", before, { ...raised, material: { ...raised.material, forces: raised.material.forces.map((force) => (force.id === levy.id ? { ...force, payObligationId: army.payObligationId } : force)) } }, { acts: true })).toEqual([]);
    // The tick's own forces (an ally's contingent, a rising) are not held to it, and nor is a force that was there before.
    expect(checkStep("a tick", before, raised)).toEqual([]);
    expect(checkStep("acts", raised, { ...raised, elapsedStep: raised.elapsedStep }, { acts: true })).toEqual([]);
  });

  it("stops a strict run at the step that broke a rule, and only reports it otherwise", () => {
    const before = opening();
    const after = broken("diplomacy.one-footing");
    vi.stubEnv("CHRONICA_STRICT", "1");
    expect(() => checkStep("a test step", before, after)).toThrow(InvariantBroken);
    expect(() => checkStep("a test step", before, after)).toThrow(/a test step broke 1 rule.*diplomacy\.one-footing: rome and syracuse are both at war and allied/);
    vi.stubEnv("CHRONICA_STRICT", "0");
    expect(checkStep("a test step", before, after)).toHaveLength(1);
    // A fault already in the world is not the step's.
    expect(checkStep("a later step", after, { ...after, elapsedStep: after.elapsedStep })).toEqual([]);
  });
});
