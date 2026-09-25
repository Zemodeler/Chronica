import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, localRef, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * A rising becomes a country, and then has to be able to do anything.
 *
 * `polity_create` exists so that a revolt can turn into a power -- its own
 * comment says a war could otherwise be fought for a generation and leave the
 * map exactly as it began. It mints the new power against a `localId`, the way
 * every other creating op does.
 *
 * The question this asks is what can be said about that power in the same
 * breath that made it. An answer is one answer: the rising declares itself,
 * names a leader, raises men, and Rome declares war on it -- and if the
 * vocabulary cannot carry that, the model must either split it across turns
 * the player did not take, or write the whole thing and lose the half that
 * referred to something the engine had only just named.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("rising"),
  gameId: "game-1",
  // The world founding a rising and arming it, as the orchestrator does in
  // play -- not the consul raising men for a power he does not serve.
  actsForTheWorld: true,
});

function order(written: readonly unknown[]) {
  const deltas: WorldDelta[] = [];
  const unsayable: string[] = [];
  for (const [index, delta] of written.entries()) {
    const parsed = WorldDeltaSchema.safeParse(delta);
    if (parsed.success) deltas.push(parsed.data);
    else unsayable.push(`delta ${index} (${(delta as { op?: string }).op}): ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const result = applyDeltas(world(), deltas, context());
  return {
    world: result.world,
    unsayable,
    engineRefusals: result.rejected.filter((r) => r.kind === "reference").map((r) => r.reason),
    worldRefusals: result.rejected.filter((r) => r.kind === "world").map((r) => r.reason),
  };
}

const THE_RISING = {
  op: "polity_create", localId: "free_messana", name: "The Free City of Messana",
  breaksFromPolityId: "mamertines", provinceIds: [MESSANA], capitalSettlementId: null,
  reason: "The citizens throw off the mercenaries who took their city.",
};

describe("what can be said about a power in the breath that made it", () => {
  it("makes the power at all", () => {
    const result = order([THE_RISING]);
    expect(result.unsayable).toEqual([]);
    expect(result.engineRefusals).toEqual([]);
    expect(result.world.map.polities.some((polity) => polity.name.includes("Free City"))).toBe(true);
  });

  it("gives it somebody to speak for it", () => {
    const result = order([THE_RISING, {
      op: "character_create", localId: "their_leader", name: "Cleon of Messana",
      polityId: localRef("free_messana"), provinceId: MESSANA, age: 45,
      officeLabel: "First of the citizens", traits: ["bold"],
      generatedBecause: "A rising has to have somebody at the front of it.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.engineRefusals).toEqual([]);
    const leader = result.world.characters.find((character) => character.name === "Cleon of Messana")!;
    expect(leader).toBeDefined();
    expect(result.world.map.polities.some((polity) => polity.id === leader.polityId)).toBe(true);
  });

  it("gives it men to hold what it has taken", () => {
    const result = order([THE_RISING, {
      op: "character_create", localId: "their_leader", name: "Cleon of Messana",
      polityId: localRef("free_messana"), provinceId: MESSANA, age: 45,
      officeLabel: null, traits: [], generatedBecause: "Somebody leads them.",
    }, {
      op: "force_create", localId: "citizen_levy", name: "The citizen levy of Messana",
      polityId: localRef("free_messana"), commanderCharacterRef: localRef("their_leader"),
      controllerCharacterRef: localRef("their_leader"), locationId: MESSANA,
      authorizedStrength: 900, payObligationRef: null,
      reason: "Every man in the city who can hold a spear.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.engineRefusals).toEqual([]);
    expect(result.world.material.forces.some((force) => force.name.includes("citizen levy"))).toBe(true);
  });

  it("lets a great power declare war on it", () => {
    const result = order([THE_RISING, {
      op: "agreement_open", localId: "the_reprisal", kind: "war",
      polityId: "syracuse", otherPolityId: localRef("free_messana"),
      terms: "Syracuse will not have a free city on the strait.",
      forDays: null, sourceMessageRef: null, visibility: "public",
      reason: "Hieron moves before Rome can.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.engineRefusals).toEqual([]);
    expect(result.world.polityAgreements.some((agreement) => agreement.kind === "war")).toBe(true);
  });

  it("lets somebody write to it", () => {
    const result = order([THE_RISING, {
      op: "diplomatic_message_send", localId: "an_offer", kind: "letter",
      fromPolityId: "rome", fromCharacterRef: "gaius-genucius",
      toPolityId: localRef("free_messana"), toCharacterRef: null,
      subject: "Rome's regard for a free city",
      terms: "Keep your laws. Rome asks only the strait.",
      replyWithinDays: 30, inReplyToRef: null, visibility: "polity",
      reason: "The consul is quick off the mark.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.engineRefusals).toEqual([]);
    expect(result.world.diplomacy.length).toBeGreaterThan(0);
  });

  it("lets the world record how it is regarded", () => {
    const result = order([THE_RISING, {
      op: "polity_stance_shift", polityId: "syracuse", towardPolityId: localRef("free_messana"),
      trustDelta: -40, reason: "A city that throws off one master will throw off another.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.engineRefusals).toEqual([]);
  });
});
