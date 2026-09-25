import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * "Teach." "Speak against it." "Write to Hieron." "Endow a shrine."
 *
 * A private man's talk, letters and foundations had no scope of their own, so
 * they were weighed against his whole country's authority -- which he does not
 * hold. A philosopher teaching and a senator speaking went on the record as
 * breaches of the republic. Curius holds no office, and none of this is the
 * republic's business.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = "punic-italy-latium";
const CURIUS = "manius-curius";

const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** Curius's own order: the acts are his, as the order's acts are. */
function asCurius(written: readonly unknown[], state: WorldState = world()) {
  const deltas: WorldDelta[] = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: 0, minute: 540 },
    actorRef: { kind: "character", id: CURIUS },
    offices: definition.government.offices,
    warfare: definition.warfare,
    terrains: definition.map.terrains,
    ids: createIdFactory("private"),
    gameId: "game-private",
    actsForTheWorld: true,
    orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
}

describe("a private life", () => {
  it("teaches, and persuades, without breaching anything", () => {
    const result = asCurius([
      {
        op: "social_events",
        events: [{
          participantCharacterRefs: [CURIUS, "quintus-ogulnius"], kind: "conversation", visibility: "private",
          summary: "Curius spends an afternoon on the Stoa's argument that a man should want little.",
          relationCauses: [{ subjectCharacterRef: "quintus-ogulnius", targetCharacterRef: CURIUS, label: "He taught me something.", score: 4 }],
        }],
      },
      {
        op: "belief_set", holderCharacterRef: "quintus-ogulnius", sourceCharacterRef: CURIUS,
        claim: "Rome's silver will cheapen if it is struck too fast.", kind: "suspicion", confidence: 60, reason: "Curius argued it.",
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(2);
    expect(result.breaches).toEqual([]);
  });

  it("speaks against a motion without breaching anything", () => {
    const state = world();
    const opened = applyDeltas(state, [WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: "levy", type: "vote", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "A second levy for Sicily", resolutionMechanism: "vote", reason: "The consul wants men.",
    })], {
      now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices,
      warfare: definition.warfare, ids: createIdFactory("open"), gameId: "game-private",
    });
    expect(opened.rejected).toEqual([]);
    const procedureId = opened.assignedIds.get("levy")!;

    const result = asCurius([{
      op: "political_support_set", procedureRef: procedureId, supporterKind: "character", supporterRef: CURIUS, position: "oppose",
      influenceWeight: 400, reasonKind: "belief", reasonLabel: "Rome should not be dragged across the strait.", reason: "Curius rises to speak.",
    }], opened.world);
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
  });

  it("writes to Hieron as himself, but offers no alliance in Rome's name", () => {
    const letter = {
      op: "diplomatic_message_send", localId: "note", kind: "letter", fromCharacterRef: CURIUS,
      toPolityId: "syracuse", toCharacterRef: "hieron-ii", subject: "An old soldier's greeting", terms: "I hear you keep a disciplined army.",
      reason: "Curius writes to a man he admires.",
    };
    const own = asCurius([{ ...letter, fromPolityId: "rome" }]);
    expect(own.rejected).toEqual([]);
    expect(own.breaches).toEqual([]);

    // An alliance is a power's to offer, and still judged as the republic's act.
    const offer = asCurius([{ ...letter, kind: "alliance_offer", fromPolityId: "rome" }]);
    expect(offer.breaches.length + offer.rejected.length).toBeGreaterThan(0);
  });

  it("endows a shrine from his own purse, but not from the treasury", () => {
    const shrine = {
      op: "generic_entity_create", localId: "shrine", kind: "shrine", label: "Curius's shrine to Fortuna", ownerRef: { kind: "character", id: CURIUS },
      provinceId: LATIUM, reason: "A vow kept from the Pyrrhic war.",
    };
    const own = asCurius([{ ...shrine, upkeep: { fromAccountRef: "curius-purse", band: "slight" } }]);
    expect(own.rejected).toEqual([]);
    expect(own.breaches).toEqual([]);

    const publicMoney = asCurius([{ ...shrine, upkeep: { fromAccountRef: "rome-treasury", band: "slight" } }]);
    expect(publicMoney.breaches.length + publicMoney.rejected.length).toBeGreaterThan(0);
  });
});

describe("men who follow a man with no right to lead them", () => {
  // Curius has no office; the field army is Gaius's. Renaming it is an order
  // to it, and one Gaius need not take.
  const rename = { op: "force_modify", forceRef: "roman-field-army", name: "Curius's army", reason: "Curius takes them as his own." };
  const regarded = (state: WorldState, dimensions: Record<string, number>): WorldState => ({
    ...state,
    characters: state.characters.map((character) => (character.id === "gaius-genucius"
      ? { ...character, relations: [...character.relations, { subjectCharacterId: CURIUS, causes: [{ id: "old-comrade", label: "He saved my life at Beneventum.", score: 20, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions }] }] }
      : character)),
  });

  it("is refused by a commander who owes him nothing", () => {
    const result = asCurius([rename]);
    expect(result.rejected[0]?.kind).toBe("ignored");
  });

  it("is carried out by a commander who would do it for him, and still breaches", () => {
    const result = asCurius([rename], regarded(world(), { trust: 30, respect: 25 }));
    expect(result.rejected).toEqual([]);
    expect(result.world.material.forces.find((force) => force.id === "roman-field-army")?.name).toBe("Curius's army");
    expect(result.factProposals.find((fact) => fact.kind === "done_unbidden")?.summary).toMatch(/for Manius Curius Dentatus's sake/);
    expect(result.breaches.length).toBeGreaterThan(0);
  });

  it("is carried out by a commander who wanted it already", () => {
    const state = world();
    const syracuse = state.material.forces.find((force) => force.polityId === "syracuse")!;
    const gaiusWantsIt = {
      ...state,
      characters: state.characters.map((character) => (character.id === "gaius-genucius"
        ? { ...character, ambitions: [...character.ambitions, { id: "humble-syracuse", label: "Humble Syracuse", kind: "revenge" as const, targetId: "syracuse", status: "active" as const }] }
        : character)),
    };
    const result = asCurius([{ op: "force_engage", forceRef: "roman-field-army", targetForceRef: syracuse.id, posture: "offer_battle", reason: "Curius wants war." }], gaiusWantsIt);
    // Whatever becomes of the battle, Gaius did not ignore him.
    expect(result.rejected.some((rejection) => rejection.kind === "ignored")).toBe(false);
  });
});
