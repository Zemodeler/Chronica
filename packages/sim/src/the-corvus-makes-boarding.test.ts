import { describe, expect, it } from "vitest";
import { formArmies, readFormation, warfareWith, type Force, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { CORVUS_MOTION, THE_CORVUS, decideAFleet } from "./a-fleet-by-decree";
import { createIdFactory } from "./ports";
import { holdVotes } from "./senate";
import { atWar, context, definition, forceOf, inputFor, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * The corvus makes boarding (Polybius 1.22).
 *
 * Rome has no way of fighting at sea in 270; once it has ships and the war goes on against a sea power, the boarding-bridge is put to the Senate as a way of war,
 * and carried, it is adopted: the ships are refitted over months, and a Roman ship that closes with an enemy's is worth more than it was. It is paid for in the speed of the ships.
 */
const offices = definition.government.offices;
const DAY = 400;
const withRomanFleet = (): WorldState => {
  const world = romeAndCarthageAlone(atWar(120));
  const punic = forceOf(world, "carthaginian-fleet");
  const fleet: Force = { ...punic, id: "roman-fleet", name: "The Roman fleet", polityId: "rome", commanderCharacterId: "gaius-genucius", controllerCharacterId: "gaius-genucius", formations: [], personnel: punic.personnel.map(({ formationId: _gone, ...row }) => ({ ...row, fit: 60 })) };
  const cleared = { ...world.material, forces: [...world.material.forces, fleet], institutions: world.material.institutions.map((institution) => ({ ...institution, votingBlocs: institution.votingBlocs.map((bloc) => ({ ...bloc, interests: [], baseSupport: 80 })) })) };
  return formArmies({ ...world, instant: { ...world.instant, day: DAY }, elapsedStep: DAY, material: cleared }, DAY);
};
const rulerOf = (world: WorldState) => (polityId: string) => world.characters.find((character) => character.polityId === polityId && character.alive && world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && /consul/.test(seat.officeId)));
const boardingOf = (world: WorldState, forceId: string): number => {
  const force = forceOf(world, forceId);
  const rules = warfareWith(world, { ...definition.warfare!, today: world.elapsedStep } as never);
  return Math.max(...force.personnel.map((row) => readFormation(rules as never, force, row).boardingBps));
};

describe("the corvus makes boarding", () => {
  const world = withRomanFleet();

  it("is not in the scenario: Rome opens without a way of fighting at sea", () => {
    expect(boardingOf(world, "roman-fleet")).toBeLessThanOrEqual(0);
    expect(world.doctrines.some((doctrine) => doctrine.polityId === "rome" && /corvus|boarding/iu.test(doctrine.label))).toBe(false);
  });

  it("is put to the Senate once Rome has ships and the enemy has the sea, and carried", () => {
    const asked = decideAFleet({ ...inputFor(world), offices }, rulerOf(world)).find((decision) => decision.polityId === "rome")!;
    expect(asked).toBeDefined();
    const motion = asked.deltas[0] as { op: string; label: string; enacts: { military: typeof THE_CORVUS } };
    expect(motion.op).toBe("political_procedure_open");
    expect(motion.label).toContain(CORVUS_MOTION);
    expect(motion.enacts.military.adopt![0]!.label).toBe("The corvus");
    const moved = applyDeltas(world, [...asked.deltas], context(world, asked.actorCharacterId) as never);
    expect(moved.rejected).toEqual([]);
    const counted = holdVotes({ world: { ...moved.world, elapsedStep: DAY + 12 }, offices, toDay: DAY + 12, ids: createIdFactory("corvus") });
    const adopted = counted.world.doctrines.find((doctrine) => doctrine.polityId === "rome" && /corvus/iu.test(doctrine.label))!;
    expect(adopted).toBeDefined();
    expect(adopted.effects).toEqual(expect.arrayContaining([expect.objectContaining({ lever: "boarding", direction: "raise" })]));
    expect(counted.world.establishments.find((establishment) => establishment.polityId === "rome")!.doctrineIds).toContain(adopted.id);
    // Moved once: it is not put again.
    expect(decideAFleet({ ...inputFor(counted.world), offices }, rulerOf(counted.world)).some((decision) => decision.polityId === "rome")).toBe(false);
    // The Roman ships now close better than they did, and the sea-keeping of them is the price.
    const later = { ...counted.world, elapsedStep: DAY + 12 + 400 };
    expect(boardingOf(later, "roman-fleet")).toBeGreaterThan(boardingOf(world, "roman-fleet"));
    expect(adopted.effects).toEqual(expect.arrayContaining([expect.objectContaining({ lever: "march_speed", direction: "lower" })]));
  });
});
