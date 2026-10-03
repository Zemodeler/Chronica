import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type Character, type WorldState } from "@chronica/shared";
import { arenaStakes, chooseNemesis, conductInWords, stationOf } from "./nemesis";

/**
 * Play-test E21: Carthage's admiral made a private plebeian his nemesis.
 *
 * `chooseNemesis` scored capability alone, needed no grievance, and searched
 * the whole world, so the most capable man anywhere was the player's
 * antagonist whatever the player was -- and was told the player was "the
 * ruler". Now a nemesis has something against him, comes from the player's
 * own world, and is the size of the player: a private man gets a peer.
 */

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const PLAYER = "lucius-plebeius";

/** A plebeian of no office and no command, at Rome. */
function withAPrivateMan(world: WorldState): WorldState {
  const model = world.characters.find((character) => character.id === "quintus-ogulnius")!;
  const player: Character = {
    ...model, id: PLAYER, name: "Lucius the Plebeian", officeId: null, officesHeld: [], prestigeBps: 2_000, relations: [], ambitions: [], traits: [], dynastyId: null,
  };
  return { ...world, characters: [...world.characters, player] };
}

/** One man's grudge against another, set outright. */
function grudge(world: WorldState, of: string, against: string): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id !== of ? character : {
      ...character,
      relations: [...character.relations, { subjectCharacterId: against, causes: [{ id: `grudge-${of}`, label: "An old insult.", score: -40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -50, respect: -40 } }] }],
    })),
  };
}

const choose = (world: WorldState, playerId = PLAYER) => chooseNemesis({ world, gameId: "game-1", playerCharacterId: playerId, ownPolityId: world.characters.find((character) => character.id === playerId)!.polityId });

describe("a nemesis the size of the man", () => {
  it("chooses nobody for a private man nobody has anything against", () => {
    expect(stationOf(withAPrivateMan(opening()), PLAYER)).toBe("private");
    expect(choose(withAPrivateMan(opening()))).toBeNull();
  });

  it("never makes a foreign admiral a private man's nemesis, grudge or not", () => {
    const world = grudge(withAPrivateMan(opening()), "hannibal-gisco", PLAYER);
    expect(choose(world)?.characterId).not.toBe("hannibal-gisco");
  });

  it("never makes the consul a private man's nemesis: he is not his peer", () => {
    const world = grudge(withAPrivateMan(opening()), "gaius-genucius", PLAYER);
    expect(choose(world)).toBeNull();
  });

  it("gives him a peer with a grudge, and tells the quarrel as a private one", () => {
    const base = withAPrivateMan(opening());
    const peer = base.characters.find((character) => character.alive && character.polityId === "rome" && character.id !== PLAYER && character.prestigeBps <= 4_000 && character.officeId === null)
      ?? base.characters.find((character) => character.alive && character.polityId === "rome" && character.id !== PLAYER && character.prestigeBps <= 4_000)!;
    const world = grudge(base, peer.id, PLAYER);
    const chosen = choose(world)!;
    expect(chosen.characterId).toBe(peer.id);
    expect(chosen.arena).not.toBe("foreign");
    expect(arenaStakes("political", peer.name, "Lucius", "private")).not.toContain("what Lucius holds");
    expect(conductInWords(peer, "Lucius", "private")).toContain("private quarrel");
  });

  it("makes a foreigner a consul's nemesis only when the consul's army is at war with his power", () => {
    // Rome and Carthage are at peace in 270: Gisco's grudge does not make him the consul's antagonist.
    const grudged = grudge(opening(), "hannibal-gisco", "gaius-genucius");
    expect(choose(grudged, "gaius-genucius")?.characterId).not.toBe("hannibal-gisco");
  });
});
