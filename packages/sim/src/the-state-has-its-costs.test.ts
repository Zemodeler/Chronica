import { describe, expect, it } from "vitest";
import { DiplomaticMessageSchema, economyOf, monthlyTakings, type Office, type WorldState } from "@chronica/shared";
import { atDay, definition, opening } from "./fiscal-test-kit";
import { keepTheState } from "./keeping-the-state";
import { createIdFactory } from "./ports";
import { costsByPolity } from "./the-upkeep-of-a-state";

/**
 * "What does it cost to be a state?"
 *
 * Besides the roads, a state pays its public servants and expenses: the lictors, scribes and criers who wait on each magistrate, the public slaves and clerks, the house
 * of the council, the games the aediles give, the rites and the priests' share, the lodging and the gifts of the envoys of other powers, and a king's court. They scale with the
 * seats of the constitution and the size of the power. A Roman senator was unpaid, and so is none paid here: the Senate costs its house and its clerks, never a salary for a seat.
 */

const offices = definition.government.offices;
const takingsOf = (world: WorldState): Map<string, number> => new Map(world.map.polities.map((polity) => [polity.id, monthlyTakings(world, polity.id)]));
const costs = (world: WorldState, list: readonly Office[] = offices, day = 120) => costsByPolity(world, list, takingsOf(world), day);

const romanOffice = (kind: "magistracy" | "membership" | "priesthood"): Office => offices.find((office) => office.polityId === "rome" && (office.kind ?? "magistracy") === kind)!;

describe("the state has its costs", () => {
  it("costs a few in a hundred of what a power takes in, and no more than six", () => {
    const world = opening(120);
    const bills = costs(world);
    for (const polityId of ["rome", "carthage", "syracuse", "mamertines"]) {
      const share = bills.get(polityId)!.total / monthlyTakings(world, polityId);
      expect(share, polityId).toBeGreaterThan(0.01);
      expect(share, polityId).toBeLessThan(0.15);
    }
    const done = keepTheState({ world: atDay(world, 150), toDay: 150, ids: createIdFactory("costs"), offices });
    for (const polityId of ["rome", "carthage", "syracuse", "mamertines"]) {
      const row = economyOf(done.world).keeping.find((entry) => entry.polityId === polityId)!;
      expect(row.costsDue / monthlyTakings(world, polityId), polityId).toBeLessThanOrEqual(0.06 + 1e-9);
    }
  });

  it("grows with the seats of the magistracies: more magistrates, more lictors and scribes", () => {
    const world = opening(120);
    const base = costs(world).get("rome")!;
    const consul = romanOffice("magistracy");
    const more: Office[] = [...offices, { ...consul, id: "rome-extra-praetors", label: "Praetors", seatCount: 8, rank: 3 }];
    const larger = costs(world, more).get("rome")!;
    expect(larger.retinue).toBeGreaterThan(base.retinue);
    expect(larger.total).toBeGreaterThan(base.total);
    // The other powers are not touched by Rome's offices.
    expect(costs(world, more).get("carthage")!.retinue).toBe(costs(world).get("carthage")!.retinue);
  });

  it("pays no senator: three hundred more seats in the Senate cost nothing, and no line of the books goes to a man's purse", () => {
    const world = opening(120);
    const base = costs(world).get("rome")!;
    const seat = romanOffice("membership");
    const fuller: Office[] = [...offices, { ...seat, id: "rome-more-senators", label: "More senators", seatCount: 300 }];
    expect(costs(world, fuller).get("rome")).toEqual(base);
    // And what keepTheState pays for government goes out through the door of the men nobody names, never to an account.
    const rich = world;
    const done = keepTheState({ world: atDay(rich, 150), toDay: 150, ids: createIdFactory("senators"), offices });
    const added = done.world.material.transactions.filter((transaction) => transaction.cause.id.startsWith("keeping_") && !rich.material.transactions.some((known) => known.id === transaction.id));
    expect(added.length).toBeGreaterThan(0);
    for (const line of added) {
      expect(line.destinationAccountId).toBeUndefined();
      expect(line.external).toBe("the_unnamed");
      expect(line.kind).not.toBe("salary");
    }
  });

  it("is more for a bigger house of the council, and for the priests", () => {
    const world = opening(120);
    const base = costs(world).get("rome")!;
    const bigger: WorldState = { ...world, material: { ...world.material, institutions: world.material.institutions.map((chamber) => (chamber.polityId === "rome" ? { ...chamber, votingBlocs: chamber.votingBlocs.map((bloc) => ({ ...bloc, weight: bloc.weight * 4 })), totalVotingWeight: chamber.totalVotingWeight * 4 } : chamber)) } };
    expect(costs(bigger).get("rome")!.house).toBeGreaterThan(base.house);
    const priests: Office[] = [...offices, { ...romanOffice("membership"), id: "rome-more-priests", label: "More priests", kind: "priesthood", seatCount: 9 }];
    expect(costs(world, priests).get("rome")!.rites).toBeGreaterThan(base.rites);
  });

  it("lodges the envoys of other powers, and is more for a power many write to", () => {
    const world = opening(120);
    const base = costs(world).get("rome")!;
    const letter = (id: string, from: string, at: number) => DiplomaticMessageSchema.parse({
      id, kind: "letter", fromPolityId: from, fromCharacterId: world.characters.find((character) => character.polityId === from)!.id, toPolityId: "rome", subject: "Greetings", terms: "Our envoys bring greetings.", sentAtStep: at,
    });
    const visited: WorldState = { ...world, diplomacy: [...world.diplomacy, letter("env-1", "carthage", 110), letter("env-2", "syracuse", 112), letter("env-3", "massalia", 115)] };
    const hosted = costs(visited).get("rome")!;
    expect(hosted.embassies).toBeGreaterThan(base.embassies);
    expect(hosted.embassies - base.embassies).toBe(3 * 640);
    // A letter from long ago lodges nobody.
    const old: WorldState = { ...world, diplomacy: [...world.diplomacy, letter("env-4", "carthage", 20)] };
    expect(costs(old).get("rome")!.embassies).toBe(base.embassies);
    // Nor does a letter a power writes to itself.
    expect(hosted.total).toBeGreaterThan(base.total);
  });

  it("keeps a king's court and the keep of his friends, which a republic has not", () => {
    const world = opening(120);
    const bills = costs(world);
    expect(bills.get("syracuse")!.court).toBeGreaterThan(0);
    expect(bills.get("rome")!.court).toBe(0);
    expect(bills.get("carthage")!.court).toBe(0);
  });

  it("is the same every time it is asked", () => {
    const world = opening(120);
    expect(JSON.stringify([...costs(world)])).toBe(JSON.stringify([...costs(structuredClone(world))]));
  });
});
