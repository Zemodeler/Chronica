import { describe, expect, it } from "vitest";
import { type Force, type WorldState } from "@chronica/shared";
import { keepCommandTenure } from "./command-tenure";
import { allotTheProvinces, graveness, soldierOf } from "./the-provinces";
import { createIdFactory } from "./ports";
import { atDay, government, holdersOfOffice, opening, withWar } from "./government-test-kit";

/**
 * The Senate assigns the provinces.
 *
 * When a year's consuls go out and the new ones come in, the Senate says which colleague takes which army: by decree the abler soldier to the graver front, the other
 * by lot; with one front the colleagues draw lots for it. Before this the first colleague without an army went to the first army that waited. A power the player
 * rules is left as it was.
 */
const OLD = ["gaius-genucius", "gnaeus-cornelius"] as const;
const NEW = ["manius-curius", "quintus-ogulnius"] as const;

function setup(): { world: WorldState; sicily: string; italy: string } {
  let world = withWar(atDay(opening(), 365), "rome", "carthage");
  const provinces = world.map.provinces.filter((p) => p.controllerPolityId === "rome");
  const [italy, sicily] = [provinces[0]!.id, provinces[1]!.id];
  const template = world.material.forces.find((f) => f.polityId === "rome")!;
  const army = (id: string, man: string, at: string, men: number): Force => ({ ...template, id, name: `Army of ${man}`, polityId: "rome", commanderCharacterId: man, controllerCharacterId: man, locationId: at, personnel: template.personnel.map((p, n) => ({ ...p, fit: n === 0 ? men : 0 })) });
  const enemy: Force = { ...template, id: "punic-host", name: "The Punic host", polityId: "carthage", commanderCharacterId: "hanno-carthage", controllerCharacterId: "hanno-carthage", locationId: sicily, personnel: template.personnel.map((p, n) => ({ ...p, fit: n === 0 ? 20_000 : 0 })) };
  world = { ...world, material: { ...world.material, forces: [...world.material.forces.filter((f) => f.polityId !== "rome" && f.polityId !== "carthage"), army("army-a", OLD[0], italy, 8_000), army("army-b", OLD[1], sicily, 8_000), enemy] } };
  // The new consuls took their seats today.
  let n = 0;
  world = { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "roman-consul" ? { ...seat, holderCharacterId: NEW[n++ % 2]!, termStartedAtStep: 365, termExpiresAtStep: 730 } : seat)) } };
  return { world, sicily, italy };
}
const ends = (world: WorldState) => OLD.map((id, n) => ({ characterId: id, officeId: "roman-consul", seatId: world.material.officeSeats.filter((s) => s.officeId === "roman-consul")[n]!.id, endedAtStep: 365 }));
const year = (world: WorldState, player: string | null = null) => keepCommandTenure({ world, government, toDay: 365, ids: createIdFactory("y"), endedTerms: ends(world), playerCharacterId: player });

describe("the Senate assigns the provinces", () => {
  const { world, sicily } = setup();

  it("is graver where the enemy stands: the front of the Punic host", () => {
    const front = (id: string) => ({ outgoingId: id, forces: world.material.forces.filter((f) => f.commanderCharacterId === id) });
    expect(graveness(world, "rome", front(OLD[1]))).toBeGreaterThan(graveness(world, "rome", front(OLD[0])));
    expect(sicily).toBeTruthy();
  });

  it("sends the abler soldier to the graver front by decree, and the other colleague by lot", () => {
    const done = year(world);
    const holds = done.world.commandHolds.filter((h) => h.status === "active" && h.basis === "awaiting_successor");
    expect(holds.map((h) => h.characterId).sort()).toEqual([...OLD].sort());
    const graver = holds.find((h) => h.characterId === OLD[1])!;
    const better = [...NEW].map((id) => world.characters.find((c) => c.id === id)!).sort((a, b) => soldierOf(b) - soldierOf(a) || a.id.localeCompare(b.id))[0]!;
    expect(graver.successorCharacterId).toBe(better.id);
    expect(holds.find((h) => h.characterId === OLD[0])!.successorCharacterId).toBe(NEW.find((id) => id !== better.id));
    const told = done.facts.find((f) => f.kind === "provinces_assigned")!;
    expect(told.summary).toMatch(/^The Senate has settled the provinces of the year: .*by decree of the Senate.*by lot/);
    expect(done.facts.filter((f) => f.kind === "provinces_assigned")).toHaveLength(1);
  });

  it("draws lots for the one front the colleagues share, the same lot every run", () => {
    const one = { ...world, material: { ...world.material, forces: world.material.forces.filter((f) => f.id !== "army-a") } };
    const a = allotTheProvinces(one, { polityId: "rome", fronts: [{ outgoingId: OLD[1], forces: one.material.forces.filter((f) => f.commanderCharacterId === OLD[1]) }], candidates: NEW.map((id) => one.characters.find((c) => c.id === id)!), day: 365, gameId: "g" });
    const b = allotTheProvinces(structuredClone(one), { polityId: "rome", fronts: [{ outgoingId: OLD[1], forces: one.material.forces.filter((f) => f.commanderCharacterId === OLD[1]) }], candidates: NEW.map((id) => one.characters.find((c) => c.id === id)!), day: 365, gameId: "g" });
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(a[0]!.how).toBe("lot");
    // A different year may draw the other man; a single free man is simply sent.
    const alone = allotTheProvinces(one, { polityId: "rome", fronts: [{ outgoingId: OLD[1], forces: one.material.forces.filter((f) => f.commanderCharacterId === OLD[1]) }], candidates: [one.characters.find((c) => c.id === NEW[0])!], day: 365, gameId: "g" });
    expect(alone[0]).toMatchObject({ successorId: NEW[0], how: "alone" });
  });

  it("is left to the player in the power he rules, who is sent as before", () => {
    const done = year(world, NEW[0]);
    expect(done.facts.some((f) => f.kind === "provinces_assigned")).toBe(false);
    expect(done.world.commandHolds.filter((h) => h.basis === "awaiting_successor").every((h) => h.successorCharacterId !== null)).toBe(true);
  });

  it("is the same on every run, and sends nobody who holds an army already", () => {
    expect(JSON.stringify(year(world))).toBe(JSON.stringify(year(structuredClone(world))));
    const busy = { ...world, material: { ...world.material, forces: world.material.forces.map((f) => (f.id === "army-a" ? { ...f, commanderCharacterId: NEW[0], controllerCharacterId: NEW[0] } : f)) } };
    const done = year(busy);
    for (const hold of done.world.commandHolds.filter((h) => h.basis === "awaiting_successor" && h.characterId === OLD[1])) expect(hold.successorCharacterId).not.toBe(NEW[0]);
    void holdersOfOffice;
  });
});
