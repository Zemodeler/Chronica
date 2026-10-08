import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type Character, type Force, type WorldState } from "@chronica/shared";
import { decideDispatches, menInWords } from "./dispatches";
import { withoutWrites } from "./letter-voice";

/**
 * "A report to his commander" from the consul was delivered to a legionary, a
 * trader and a quaestor, none of whom commanded anything, in a letter that
 * read "Clepsina writes: Clepsina writes" and gave "3600 of theirs to our 0".
 */

const BASE = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const CONSUL = "gaius-genucius";

function hungryArmyUnderAnother(): { world: WorldState; commander: Character; force: Force } {
  const consul = BASE.characters.find((c) => c.id === CONSUL)!;
  const force = BASE.material.forces.find((f) => f.polityId === consul.polityId && f.outlaw !== true && f.personnel.some((p) => p.fit > 0))!;
  const commander = BASE.characters.find((c) => c.id !== CONSUL && c.alive && c.polityId === consul.polityId && !BASE.material.forces.some((f) => f.commanderCharacterId === c.id))!;
  const world: WorldState = { ...BASE, instant: { day: 100, minute: 0 }, material: { ...BASE.material, forces: BASE.material.forces.map((f) => (f.id === force.id ? { ...f, commanderCharacterId: commander.id, controllerCharacterId: CONSUL, provisionStatus: "critical" as const } : f)) } };
  return { world, commander, force };
}

describe("a report to his commander", () => {
  it("goes to the man who holds the command above the one who writes it", () => {
    const { world, commander } = hungryArmyUnderAnother();
    expect(decideDispatches(world, CONSUL).map((d) => d.actorCharacterId)).toContain(commander.id);
  });

  it("goes to nobody who is not over the army: a legionary, a trader, a man of another power", () => {
    const { world, commander } = hungryArmyUnderAnother();
    const soldier = world.characters.find((c) => c.alive && c.polityId === "rome" && c.id !== CONSUL && c.id !== commander.id && !world.material.officeSeats.some((s) => s.holderCharacterId === c.id && s.status === "held") && !world.material.forces.some((f) => f.commanderCharacterId === c.id || f.controllerCharacterId === c.id))!;
    expect(decideDispatches(world, soldier.id)).toEqual([]);
    // The army was handed to another's command, and the consul's word with it: what his successor's men write goes to the one who has it now.
    const handed = { ...world, material: { ...world.material, forces: world.material.forces.map((f) => (f.controllerCharacterId === CONSUL ? { ...f, controllerCharacterId: commander.id } : f)) } };
    expect(decideDispatches(handed, CONSUL).filter((d) => d.why.startsWith("supply:"))).toEqual([]);
  });

  it("is told once under the sender's name, and in numbers a man would give", () => {
    expect(withoutWrites("Clepsina writes: Clepsina writes: The men at Rhegium are hungry.", "Clepsina")).toBe("The men at Rhegium are hungry.");
    expect(menInWords(3_640)).toBe("3600");
    expect(menInWords(40)).toBe("40");
    expect(menInWords(3)).toBe("a handful");
    expect(menInWords(0)).toBe("none");
  });
});
