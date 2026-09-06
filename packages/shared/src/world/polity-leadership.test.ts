import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "./world-state";
import { ensurePolityLeadership } from "./polity-leadership";

// The regression these guard: a player marched into a power that the scenario
// had given no people, and it was mechanically incapable of noticing, because
// every tool in the engine needs an actor to act through.

const world = (): WorldState => structuredClone(firstPunicWarScenario.initialWorld);

/** A polity with land and nobody living in its name. */
function leaderlessHost(w: WorldState): string {
  const polityId = w.map.provinces.find((province) => province.controllerPolityId !== null)!.controllerPolityId!;
  w.characters = w.characters.map((character) => (character.polityId === polityId ? { ...character, alive: false, diedAtStep: 0 } : character));
  return polityId;
}

describe("a power nothing is happening to", () => {
  it("is given nobody", () => {
    const w = world();
    w.characters = w.characters.map((character) => ({ ...character, alive: false, diedAtStep: 0 }));
    w.material.forces = [];
    w.conflicts = { ...w.conflicts, wars: [] };
    expect(ensurePolityLeadership(w, 1).seeded).toEqual([]);
  });
});

describe("a power with a foreign army on its ground", () => {
  const invaded = () => {
    const w = world();
    const polityId = leaderlessHost(w);
    const seat = w.map.provinces.find((province) => province.controllerPolityId === polityId)!;
    const intruder = w.material.forces.find((force) => force.polityId !== polityId);
    w.material.forces = w.material.forces.map((force) => (force.id === intruder?.id ? { ...force, locationId: seat.id } : force));
    return { world: w, polityId };
  };

  it("is given somebody to answer with, standing on ground it holds", () => {
    const { world: w, polityId } = invaded();
    const result = ensurePolityLeadership(w, 3);

    const seeded = result.seeded.find((leader) => leader.polityId === polityId);
    expect(seeded).toBeDefined();
    expect(seeded?.trigger).toBe("invaded");
    const leader = result.world.characters.find((character) => character.id === seeded!.characterId);
    expect(leader?.alive).toBe(true);
    expect(result.world.map.provinces.find((province) => province.id === leader?.locationProvinceId)?.controllerPolityId).toBe(polityId);
  });

  it("gives them a purse, so they are visible to every system that reads one", () => {
    const { world: w, polityId } = invaded();
    const result = ensurePolityLeadership(w, 3);
    const seeded = result.seeded.find((leader) => leader.polityId === polityId)!;
    const leader = result.world.characters.find((character) => character.id === seeded.characterId)!;
    expect(result.world.material.accounts.some((account) => account.id === leader.personalAccountId)).toBe(true);
  });

  it("creates a named person with a temperament and a concrete reason to act", () => {
    const { world: w, polityId } = invaded();
    const result = ensurePolityLeadership(w, 3);
    const seeded = result.seeded.find((leader) => leader.polityId === polityId)!;
    const leader = result.world.characters.find((character) => character.id === seeded.characterId)!;
    const goal = result.world.characterGoals.find((candidate) => candidate.characterId === leader.id);

    expect(leader.name).not.toBe(`${seeded.polityName} leader`);
    expect(leader.traits.length).toBeGreaterThan(0);
    expect(leader.ambitions).toHaveLength(1);
    expect(goal).toMatchObject({ category: "preserve_power", priority: 5, status: "active", targetEntityIds: [polityId] });
  });

  it("produces a world the engine still accepts", () => {
    const { world: w } = invaded();
    expect(WorldStateSchema.safeParse(ensurePolityLeadership(w, 3).world).success).toBe(true);
  });

  it("seeds nobody the second time it runs", () => {
    const { world: w } = invaded();
    const once = ensurePolityLeadership(w, 3);
    expect(ensurePolityLeadership(once.world, 4).seeded).toEqual([]);
  });

  it("leaves a power that already has living people exactly as it is", () => {
    const w = world();
    const before = structuredClone(w);
    const seat = w.map.provinces.find((province) => province.controllerPolityId === "rome")!;
    w.material.forces = w.material.forces.map((force) => (force.polityId === "carthage" ? { ...force, locationId: seat.id } : force));
    const result = ensurePolityLeadership(w, 3);
    expect(result.seeded).toEqual([]);
    expect(result.world.characters.length).toBe(before.characters.length);
  });
});

describe("a power that has been written to", () => {
  it("is given somebody to receive the letter", () => {
    const w = world();
    const polityId = leaderlessHost(w);
    const sender = w.characters.find((character) => character.alive)!;
    w.diplomacy = [{
      id: "msg-1",
      kind: "letter",
      fromPolityId: sender.polityId!,
      fromCharacterId: sender.id,
      toPolityId: polityId,
      toCharacterId: null,
      subject: "The question of the frontier",
      terms: "An understanding is proposed.",
      sentAtStep: 1,
      replyDueByStep: null,
      status: "awaiting_reply",
      answer: null,
      answerText: null,
      answeredAtStep: null,
      inReplyToMessageId: null,
      visibility: "polity",
    }];

    const result = ensurePolityLeadership(w, 2);
    expect(result.seeded.find((leader) => leader.polityId === polityId)?.trigger).toBe("addressed");
  });
});
