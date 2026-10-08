import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, familyLinksOf, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { isOwnBusiness } from "./apply/own-business";
import { adoptionBar } from "./adoption";
import { named, opening, thinks } from "./gentes-test-kit";
import { createIdFactory } from "./ports";

/**
 * A man adopts an heir (the `adopt` delta). It was a yearly rule and nothing a man could do: a childless first man was found a nephew
 * by the engine, and a player who wanted a son out of a friend's house had only a bare family tie to write. Now a private man (or a
 * model's NPC) writes it, and the Roman rules are the engine's: the name and its -ianus cognomen, the gens and its rites, the estate
 * as a son's, the father's leave, the adoptee's will, the pontifices for a patrician's, and the one road from the plebs to the patriciate.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const start = opening();
const lepidus = named(start, "Marcus Aemilius Lepidus");
const flaccus = named(start, "Lucius Valerius Flaccus");
const plebeian = named(start, "Gaius Aquillius Florus");

function adopt(world: WorldState, actorId: string, adopterId: string, adopteeId: string, actsForTheWorld = false) {
  const delta: WorldDelta = WorldDeltaSchema.parse({ op: "adopt", adopterRef: adopterId, adopteeRef: adopteeId, reason: "He wants a son to carry the name." });
  return applyDeltas(world, [delta], {
    now: world.instant, actorRef: { kind: "character", id: actorId }, offices: definition.government.offices, successionRules: definition.government.successionRules,
    warfare: definition.warfare, ids: createIdFactory("adopt"), gameId: "game-adopt", actsForTheWorld,
  });
}

describe("a man adopts an heir", () => {
  it("makes the adoptee his son by the act: the name, the gens, the order, the kin link and the heir", () => {
    const result = adopt(start, lepidus.id, lepidus.id, flaccus.id);
    expect(result.rejected).toEqual([]);
    const son = result.world.characters.find((character) => character.id === flaccus.id)!;
    expect(son.name).toBe("Marcus Aemilius Lepidus Valerianus");
    expect(son.dynastyId).toBe("gens-aemilius");
    expect(result.world.characters.find((character) => character.id === lepidus.id)!.heirCharacterId).toBe(flaccus.id);
    expect(familyLinksOf(result.world, lepidus.id).some((view) => view.kind === "parent" && view.counterpartCharacterId === flaccus.id)).toBe(true);
    expect(result.factProposals.some((fact) => fact.kind === "adoption")).toBe(true);
    // A man's own household: not a breach of anybody's authority.
    expect(result.breaches).toEqual([]);
    expect(isOwnBusiness(WorldDeltaSchema.parse({ op: "adopt", adopterRef: lepidus.id, adopteeRef: flaccus.id, reason: "x" }), start, lepidus.id, (ref) => ref)).toBe(true);
  });

  it("is a man's own to write: a stranger cannot adopt on another's behalf, but the world keeping a house may", () => {
    const stranger = named(start, "Gaius Aquillius Florus");
    expect(adopt(start, stranger.id, lepidus.id, flaccus.id).rejected.length).toBe(1);
    expect(adopt(start, stranger.id, lepidus.id, flaccus.id, true).rejected).toEqual([]);
  });

  it("is refused for the adoptee's own will: a man who hates the adopter does not take his name", () => {
    const hated = thinks(start, flaccus.id, lepidus.id, -60);
    expect(adoptionBar(hated, lepidus, named(hated, flaccus.name), 100)).toMatch(/will not take/);
    const result = adopt(hated, lepidus.id, lepidus.id, flaccus.id);
    expect(result.rejected.length).toBe(1);
    expect(result.world.characters.find((character) => character.id === flaccus.id)!.name).toBe(flaccus.name);
  });

  it("is refused for a man with a son, and for a plebeian gens taking a patrician", () => {
    const gurges = named(start, "Quintus Fabius Maximus Gurges");
    expect(adopt(start, gurges.id, gurges.id, named(start, "Lucius Aemilius Papus").id).rejected.length).toBe(1);
    expect(adoptionBar(start, named(start, "Gaius Junius Bubulcus Brutus"), flaccus, 100)).toMatch(/does not take a patrician/);
  });

  it("is the one road from the plebs to the patriciate: a patrician takes a plebeian, who is a patrician after", () => {
    expect(plebeian.ordo ?? "plebeian").not.toBe("patrician");
    expect(adoptionBar(start, lepidus, plebeian, 100)).toBeNull();
    const result = adopt(start, lepidus.id, lepidus.id, plebeian.id);
    expect(result.rejected).toEqual([]);
    const son = result.world.characters.find((character) => character.id === plebeian.id)!;
    expect(son.ordo).toBe("patrician");
    expect(son.dynastyId).toBe("gens-aemilius");
    expect(son.name).toMatch(/^Marcus Aemilius Lepidus Aquillianus/);
  });

  it("goes before the pontifices where the adopter is a patrician: without a pontiff alive the curiate law cannot be laid", () => {
    const withoutPontiffs: WorldState = {
      ...start,
      material: { ...start.material, officeSeats: start.material.officeSeats.filter((seat) => !/pontif/i.test(seat.officeId)).concat([{ ...start.material.officeSeats[0]!, officeId: "pontifex", status: "vacant", holderCharacterId: null }]) },
    };
    expect(adoptionBar(withoutPontiffs, lepidus, flaccus, 100)).toMatch(/no pontiff/);
    expect(adoptionBar(start, lepidus, flaccus, 100)).toBeNull();
  });
});
