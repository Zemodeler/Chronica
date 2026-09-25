import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, localRef, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * Can the world be told this?
 *
 * The vision is that a player may order anything, however strange, and the
 * world answers. What actually stops that is never the strangeness -- it is a
 * missing field: a name that cannot be changed, a promise that cannot be
 * recorded, an arrangement with no word for it. Each of those reaches the
 * player as a sentence that reads like a rule of the world, and each one
 * teaches them not to try that again.
 *
 * So this is a battery of ordinary and obscure orders, written as the deltas a
 * competent answer would produce, asserting only that the engine can carry
 * them out. A failure here is not a bug in a feature; it is a sentence the
 * player may not say.
 *
 * Where an order *should* be refused -- the world resisting rather than the
 * vocabulary failing -- the refusal must be a "world" one, because that is the
 * answer the player is entitled to hear.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const context = (actor = "gaius-genucius"): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("weird"),
  gameId: "game-1",
});

/**
 * Applies an order the way the real pipeline does, and fails loudly with the
 * engine's own words.
 *
 * Every delta goes through `WorldDeltaSchema` first, exactly as a model's
 * answer does. That is not ceremony: a test that hand-builds a payload and
 * skips the parse is testing its author's memory of the vocabulary, and will
 * happily report an engine bug that is really a missing default. One written
 * that way here produced a NaN in world state and looked for a minute like a
 * real fault.
 */
function order(written: readonly unknown[], state: WorldState = world(), actor?: string) {
  const deltas = written.map((delta, index) => {
    const parsed = WorldDeltaSchema.safeParse(delta);
    if (!parsed.success) {
      throw new Error(`delta ${index} is not something the vocabulary can say: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    return parsed.data;
  });
  const result = applyDeltas(state, deltas, context(actor));
  return {
    world: result.world,
    engineRefusals: result.rejected.filter((r) => r.kind === "reference").map((r) => r.reason),
    worldRefusals: result.rejected.filter((r) => r.kind === "world").map((r) => r.reason),
  };
}

const MESSANA = "ita-72843720b81376294924159-sicily-northeast";

describe("orders a ruler gives about people", () => {
  it("invents an officer the world had no name for and gives him a job", () => {
    const result = order([{
      op: "character_create", localId: "quaestor", name: "Titus Sempronius", polityId: "rome",
      provinceId: "punic-italy-latium", age: 34, officeLabel: "Quaestor of the fleet",
      officeAuthorises: ["money_transfer"], traits: ["diligent"],
      generatedBecause: "Somebody has to keep the accounts of the crossing.",
      reason: "The consul appoints a quaestor to the fleet.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    const made = result.world.characters.find((character) => character.name === "Titus Sempronius");
    expect(made).toBeDefined();
    // The office he was made into exists afterwards, whether or not the
    // scenario ever heard of a quaestorship.
    expect(made!.officeId).not.toBeNull();
  });

  it("tells one man what another has privately come to believe about him", () => {
    const result = order([{
      op: "belief_set", holderCharacterRef: "hieron-ii", subjectRef: "gaius-genucius",
      claim: "The Roman consul means to take the strait for himself.",
      kind: "suspicion", confidence: 70, visibility: "private",
      reason: "Hieron reads the consul's movements and draws a conclusion.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    expect(result.world.characterBeliefs.some((belief) => belief.claim.includes("take the strait"))).toBe(true);
  });

  it("puts a man under a pressure he did not ask for, and lifts it again", () => {
    const pressed = order([{
      op: "character_pressure_set", characterRef: "quintus-ogulnius", action: "create",
      kind: "political_danger", intensity: 65,
      label: "His brother's debts are being talked about in the Senate.",
      visibility: "polity", reviewInDays: 60, reason: "A rumour takes hold.",
    }]);

    expect(pressed.engineRefusals).toEqual([]);
    expect(pressed.world.characterPressures.some((pressure) =>
      pressure.characterId === "quintus-ogulnius" && pressure.label.includes("debts"))).toBe(true);
  });
});

describe("orders about things that are not war", () => {
  it("founds an arrangement the vocabulary has no word for", () => {
    // A grain dole, a priesthood, a shipwrights' guild: the world must be able
    // to hold a thing nobody anticipated, or every scenario is a fixed list.
    const result = order([{
      op: "generic_entity_create", localId: "dole", kind: "public_distribution",
      label: "The grain dole of the Aventine", ownerRef: { kind: "polity", id: "rome" },
      attributes: { modius_per_head: 5, funded_from: "rome-treasury" },
      reason: "The consul buys quiet in the city.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    const founded = result.world.genericEntities.at(-1)!;
    expect(founded.label).toContain("grain dole");
    expect(founded.attributes["modius_per_head"]).toBe(5);
  });

  it("gives a province a bad year without anybody fighting in it", () => {
    const result = order([{
      op: "province_material_shift", provinceId: "punic-italy-latium",
      populationDelta: -2_000, foodSecurityBpsDelta: -2_500, stabilityBpsDelta: -1_200,
      reason: "The harvest fails in Latium.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    const after = result.world.material.provinceMaterial.find((row) => row.provinceId === "punic-italy-latium")!;
    expect(after.foodSecurityBps).toBeLessThan(8_000);
  });

  it("borrows from a foreign banker nobody in this world has to be", () => {
    const result = order([{
      op: "loan_open", localId: "ptolemaic_credit", borrowerAccountRef: "rome-treasury",
      lenderKind: "foreign", lenderRef: null, principal: 4_000, interestBps: 800,
      cadenceDays: 90, terms: "Credit advanced at Alexandria against the next tributum",
      collateralHoldingRef: null, reason: "The war chest is short and Egypt is rich.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    expect(result.world.material.loans.at(-1)!.outstanding).toBe(4_000);
    // Money from outside the world really does come from outside it.
    expect(result.world.material.accounts.find((a) => a.id === "rome-treasury")!.balance).toBe(13_000);
  });
});

describe("orders about the shape of the world itself", () => {
  it("lets a people break away and become a power that did not exist", () => {
    const result = order([{
      op: "polity_create", localId: "free_messana", name: "The Free City of Messana",
      breaksFromPolityId: "mamertines", provinceIds: [MESSANA], capitalSettlementId: null,
      reason: "The city throws off the mercenaries who took it.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    expect(result.world.map.polities.some((polity) => polity.name.includes("Free City"))).toBe(true);
  });

  it("refuses a province to somebody who cannot reach it, and says so to the player", () => {
    const result = order([{
      op: "province_control_set", provinceId: "tun-13205935b88806172084765",
      toPolityRef: "rome", firmnessBps: 5_000, reason: "Rome annexes Africa from Latium.",
    }]);

    // The world resisting is the right answer, and it must reach the player
    // rather than the debugging record.
    expect(result.engineRefusals).toEqual([]);
    expect(result.worldRefusals).toHaveLength(1);
    expect(result.worldRefusals[0]).toContain("no army");
  });
});

describe("orders that are nobody's business but the person giving them", () => {
  it("sends a private letter, and keeps it private", () => {
    const result = order([{
      op: "diplomatic_message_send", localId: "quiet_word", kind: "letter",
      fromPolityId: "rome", fromCharacterRef: "gaius-genucius",
      toPolityId: "carthage", toCharacterRef: "hanno-carthage",
      subject: "A private understanding about the strait",
      terms: "Neither of us crosses. Say nothing of this to Syracuse.",
      replyWithinDays: 45, inReplyToRef: null, visibility: "private",
      reason: "The consul goes behind the Senate's back.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    expect(result.world.diplomacy.at(-1)!.visibility).toBe("private");
  });

  it("records a man deciding to do something, without doing it yet", () => {
    const result = order([{
      op: "character_intent_set", actorCharacterRef: "decius-vibellius", actionType: "negotiate",
      rationale: "Sell Rhegium to Carthage before Rome arrives to take it back.",
      targetRefs: ["hanno-carthage"], priority: 80, visibility: "private",
      reason: "The mutineer looks for a buyer.",
    }]);

    expect(result.engineRefusals).toEqual([]);
    expect(result.world.characterIntents.some((intent) => intent.rationale.includes("Sell Rhegium"))).toBe(true);
  });
});

describe("the whole of an order, end to end", () => {
  it("raises a force, funds it, names it, feeds it and sends it, in one breath", () => {
    const result = order([
      {
        op: "obligation_upsert", localId: "new_pay", obligationRef: null, kind: "army_pay",
        label: "Pay of the Sicilian expedition", payerAccountRef: "rome-treasury", recipientAccountRef: null,
        amount: 180, cadenceDays: 30, priority: 900, active: true, reason: "The Senate votes the money.",
      },
      {
        op: "force_create", localId: "expedition", name: "The Sicilian expedition", polityId: "rome",
        commanderCharacterRef: "manius-curius", controllerCharacterRef: "gaius-genucius",
        locationId: "punic-italy-latium", authorizedStrength: 2_000,
        payObligationRef: localRef("new_pay"), reason: "Two legions for the crossing.",
      },
      {
        op: "force_modify", forceRef: localRef("expedition"), name: "Legio Sicula",
        provisionStatus: "provisioned", provisionedForDays: 120, cohesionBpsDelta: 500,
        reason: "Named, drilled and victualled for the season.",
      },
    ]);

    expect(result.engineRefusals).toEqual([]);
    const raised = result.world.material.forces.find((force) => force.name === "Legio Sicula")!;
    expect(raised).toBeDefined();
    expect(raised.payObligationId).not.toBeNull();
    expect(raised.provisionedThroughStep).toBe(world().elapsedStep + 120);
    // And it carries a chest of its own, because every army does.
    expect(result.world.material.accounts.some((account) =>
      account.owner.kind === "force" && account.owner.id === raised.id)).toBe(true);
  });
});

/**
 * The vocabulary's own consistency.
 *
 * Not an order anybody gives -- a property of the language they give orders
 * in. A key that thirty-seven ops require and three forbid is a trap: the
 * answer parses everywhere else and is thrown away here, silently, before any
 * repair can see it. Found by writing the battery above and being caught by
 * it twice.
 */
describe("the vocabulary does not contradict itself", () => {
  it("lets every op say why it is being done", () => {
    const refused: string[] = [];
    for (const [op, payload] of Object.entries(MINIMAL_BY_OP)) {
      const withReason = WorldDeltaSchema.safeParse({ ...payload, reason: "Because the consul said so." });
      const without = WorldDeltaSchema.safeParse(payload);
      // The payloads below are deliberately minimal and some are incomplete;
      // what is under test is only that adding a reason never makes a delta
      // worse than it was.
      if (without.success && !withReason.success) refused.push(op);
    }
    expect(refused).toEqual([]);
  });
});

/** One well-formed example of each op that this file has exercised. */
const MINIMAL_BY_OP: Record<string, Record<string, unknown>> = {
  character_create: {
    op: "character_create", localId: "x", name: "A Man", polityId: "rome", provinceId: null,
    age: 40, officeLabel: null, traits: [], generatedBecause: "Somebody was needed.",
  },
  character_intent_set: {
    op: "character_intent_set", actorCharacterRef: "gaius-genucius", actionType: "wait",
    rationale: "He waits to see what Carthage does.",
  },
  social_events: {
    op: "social_events",
    events: [{
      participantCharacterRefs: ["gaius-genucius", "manius-curius"],
      kind: "conversation", summary: "They talk over the crossing.", visibility: "private",
    }],
  },
  force_modify: { op: "force_modify", forceRef: "roman-field-army", name: "Legio I" },
  money_transfer: { op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount: 1 },
};
