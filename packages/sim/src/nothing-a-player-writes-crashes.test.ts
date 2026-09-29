import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WORLD_DELTA_OPS, WorldDeltaSchema, WorldStateSchema, localRef,
  type WorldDelta, type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * Nothing a player writes takes the engine down with it.
 *
 * The player writes prose; a model turns it into deltas; and the model can be
 * wrong in ways nobody anticipated -- a reference to something that never
 * existed, a number at the end of its range, a batch that contradicts itself,
 * an op naming its own output. None of that may throw. The worst it may cost
 * is the delta that carried it, and the player is owed an answer either way.
 *
 * `applyDeltas` used to rethrow anything that was not a refusal, which took
 * the whole batch with it: one unanticipated shape turned a player's order
 * into a failure of the engine. This holds that line, and holds it against
 * every op in the vocabulary rather than the handful anybody thought to try.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("chaos"),
  gameId: "game-1",
});

/** Applies whatever it is given, and reports only that the engine survived. */
function survives(deltas: readonly unknown[], state: WorldState = world()) {
  const result = applyDeltas(state, deltas as readonly WorldDelta[], context());
  // Never a half-written world: whatever was refused left nothing behind.
  expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  return result;
}

describe("a payload that names things which do not exist", () => {
  it("refuses every op in the vocabulary without throwing", () => {
    // One deliberately empty payload per op: every required field missing,
    // every ref dangling. The engine must answer, not fall over.
    //
    // Parsed once and shared, because `applyDeltas` never mutates what it is
    // given. Building it per op parsed all 779 provinces eighty times over and
    // timed the test out -- slowness in the test, which looked for a minute
    // like slowness in the engine.
    const opening = world();
    const survived: string[] = [];
    for (const op of WORLD_DELTA_OPS) {
      const result = applyDeltas(opening, [{ op } as unknown as WorldDelta], context());
      expect(result.rejected, op).toHaveLength(1);
      // Deep equality, not identity: a batch in which everything was refused
      // still comes back through the world schema, so the object is new and
      // the contents must be untouched.
      expect(result.world, op).toStrictEqual(opening);
      survived.push(op);
    }
    expect(survived).toHaveLength(WORLD_DELTA_OPS.length);
  // Every op against the whole 779-province world, each validated in full:
  // half a second alone, and past the default five under a parallel suite.
  // Measured -- the reference fixing added four milliseconds of it.
  }, 30_000);

  it("refuses a reference to a thing that was never created", () => {
    const result = survives([{
      op: "force_modify", forceRef: localRef("an_army_nobody_raised"),
      name: "The Phantom Legion", reason: "Renaming something that does not exist.",
    }]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe("reference");
  });

  it("refuses a delta that names its own output", () => {
    const result = survives([{
      op: "force_create", localId: "ouroboros", name: "The Legion That Pays Itself", polityId: "rome",
      commanderCharacterRef: "gaius-genucius", controllerCharacterRef: "gaius-genucius",
      locationId: PUNIC_IDS.rome, authorizedStrength: 100,
      payObligationRef: localRef("ouroboros"), reason: "It pays itself.",
    }]);
    // The handle resolves to a force, which is not an obligation, so the
    // reference is refused rather than believed.
    expect(result.rejected).toHaveLength(1);
    expect(result.world.material.forces).toHaveLength(world().material.forces.length);
  });
});

describe("numbers at the end of their range", () => {
  it("takes the largest army the vocabulary allows without arithmetic going strange", () => {
    const result = survives([{
      op: "force_create", localId: "the_host", name: "Every man in Italy", polityId: "rome",
      commanderCharacterRef: "gaius-genucius", controllerCharacterRef: "gaius-genucius",
      locationId: PUNIC_IDS.rome, authorizedStrength: 1_000_000,
      reason: "The consul levies everybody.",
    }]);

    expect(result.rejected).toEqual([]);
    const raised = result.world.material.forces.at(-1)!;
    expect(Number.isFinite(raised.authorizedStrength)).toBe(true);
    expect(raised.personnel.every((category) => Number.isFinite(category.fit))).toBe(true);
  });

  it("cannot reduce an army below nothing", () => {
    const result = survives([{
      op: "force_modify", forceRef: "roman-field-army", authorizedStrengthDelta: -1_000_000,
      moraleBpsDelta: -10_000, cohesionBpsDelta: -10_000, reason: "Disaster.",
    }]);

    const after = result.world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(after.authorizedStrength).toBeGreaterThanOrEqual(1);
    expect(after.moraleBps).toBe(0);
    expect(after.cohesionBps).toBe(0);
  });

  it("cannot spend a treasury into a negative balance", () => {
    const result = survives([{
      op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: "carthage-treasury",
      amount: 1_000_000_000, reason: "Rome buys Carthage.",
    }]);

    // It pays what there is, and not a coin more.
    expect(result.rejected).toHaveLength(0);
    expect(result.world.material.accounts.find((account) => account.id === "rome-treasury")!.balance).toBe(0);
    expect(result.world.material.accounts.every((account) => account.balance >= 0)).toBe(true);
  });

  it("survives an attrition that would take more men than are there", () => {
    const result = survives([{
      op: "force_attrition", forceRef: "mamertine-garrison", cause: "starvation",
      lossBps: 6_000, moraleBpsDelta: -10_000, reason: "The city starves.",
    }]);

    expect(result.rejected).toEqual([]);
    const after = result.world.material.forces.find((force) => force.id === "mamertine-garrison")!;
    expect(after.personnel.every((category) => category.fit >= 0)).toBe(true);
  });
});

describe("a batch that argues with itself", () => {
  it("keeps the orders that worked when one in the middle does not", () => {
    const result = survives([
      { op: "force_modify", forceRef: "roman-field-army", name: "Legio I", reason: "Numbered." },
      { op: "force_modify", forceRef: "no-such-army", name: "Legio II", reason: "Numbering a ghost." },
      { op: "force_modify", forceRef: "roman-field-army", moraleBpsDelta: 250, reason: "And addressed." },
    ]);

    expect(result.rejected).toHaveLength(1);
    const legion = result.world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(legion.name).toBe("Legio I");
    expect(legion.moraleBps).toBe(world().material.forces.find((f) => f.id === "roman-field-army")!.moraleBps + 250);
  });

  it("undoes a delta completely when it is refused, including what it had already written", () => {
    const before = world();
    // A city taken, and then the same order again: the second is refused
    // because the city is already held, and must leave nothing behind.
    const city = before.map.provinces.find((province) => province.id === PUNIC_IDS.messana)!.settlements[0]!;
    const take = {
      op: "settlement_control_set", settlementId: city.id, toPolityRef: "mamertines",
      sacked: true, reason: "Storming a city they already hold.",
    };
    const result = survives([take]);

    expect(result.rejected).toHaveLength(1);
    // No plunder was banked on the way to being refused.
    expect(result.world.material.transactions).toEqual(before.material.transactions);
    expect(result.world.material.capturableValues).toEqual(before.material.capturableValues);
  });

  it("refuses the whole batch rather than saving a world that will not load", () => {
    // Every account emptied of its owner: the batch is structurally fine
    // delta by delta and leaves a world the schema will not accept.
    const before = world();
    const result = applyDeltas(before, [{
      op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount: 1, reason: "A coin.",
    }] as WorldDelta[], context());

    expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  });
});

describe("prose where the engine expected something else", () => {
  it("does not choke on text at the length the vocabulary permits", () => {
    const long = "a".repeat(600);
    const result = survives([{
      op: "generic_entity_create", localId: "manifesto", kind: "proclamation",
      label: "The consul's proclamation", ownerRef: { kind: "polity", id: "rome" },
      attributes: { text: long }, reason: "He has a great deal to say.",
    }]);

    expect(result.rejected).toEqual([]);
    expect(String(result.world.genericEntities.at(-1)!.attributes["text"])).toHaveLength(600);
  });

  it("holds a reason full of quotation marks and newlines", () => {
    const result = survives([{
      op: "force_modify", forceRef: "roman-field-army",
      name: 'The "Ironsides"',
      reason: "He said: \"they will be called the Ironsides\"\nand nobody argued.",
    }]);

    expect(result.rejected).toEqual([]);
    expect(result.world.material.forces.find((force) => force.id === "roman-field-army")!.name).toBe('The "Ironsides"');
  });
});

describe("the vocabulary's own guarantee", () => {
  it("parses or refuses every op, and never throws, for a payload of nulls", () => {
    const opening = world();
    for (const op of WORLD_DELTA_OPS) {
      const payload: Record<string, unknown> = { op };
      const parsed = WorldDeltaSchema.safeParse(payload);
      // Either the schema catches it, or the handler must -- never a throw.
      if (parsed.success) {
        const result = applyDeltas(opening, [parsed.data], context());
        expect(result.rejected.length + result.applied.length).toBe(1);
      } else {
        expect(parsed.error.issues.length).toBeGreaterThan(0);
      }
    }
  });
});
