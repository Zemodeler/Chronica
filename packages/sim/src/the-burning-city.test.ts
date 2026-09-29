import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * One long order, taken apart.
 *
 * "Integrate the Gauls into the Thirteenth as auxiliaries. Send them to harass
 * the enemy's supply, attacking weak points. Burn the country so the enemy
 * finds nothing. The army at Agrigentum keeps fortifying both walls. And
 * prepare the Burning City: when the Carthaginians are through the first wall,
 * fire it and bar the gates."
 *
 * Five separate things, each of which the world has to be able to be told.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const AGRIGENTUM = PUNIC_IDS.agrigentum;

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("burning"),
  gameId: "game-1",
});

function order(written: readonly unknown[], state: WorldState = world()) {
  const deltas: WorldDelta[] = [];
  const unsayable: string[] = [];
  for (const [index, raw] of written.entries()) {
    const parsed = WorldDeltaSchema.safeParse(raw);
    if (parsed.success) deltas.push(parsed.data);
    else unsayable.push(`delta ${index} (${(raw as { op?: string }).op}): ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const result = applyDeltas(state, deltas, context());
  return { world: result.world, unsayable, refusals: result.rejected.map((r) => r.reason) };
}

const legion = (state: WorldState) => state.material.forces.find((force) => force.id === "roman-field-army")!;
const fit = (state: WorldState) => legion(state).personnel.reduce((sum, category) => sum + category.fit, 0);

describe("1. the Gauls are taken into the legion as auxiliaries", () => {
  it("puts men into an army that already exists", () => {
    const before = world();
    const result = order([{
      op: "force_reinforce", forceRef: "roman-field-army",
      categoryId: "infantry", label: "Gallic auxiliaries", men: 800,
      reason: "The Gauls are taken into the Thirteenth.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
    // Men who are actually there, not a larger number on the establishment.
    expect(fit(result.world)).toBe(fit(before) + 800);
    expect(legion(result.world).authorizedStrength).toBeGreaterThanOrEqual(fit(result.world));
  });

  it("keeps them as their own kind of troops rather than dissolving them into the line", () => {
    const result = order([{
      op: "force_reinforce", forceRef: "roman-field-army",
      categoryId: "cavalry", label: "Gallic horse", men: 300,
      reason: "Their horse is worth more than their spears.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
    const auxiliaries = legion(result.world).personnel.find((category) => category.label === "Gallic horse");
    expect(auxiliaries).toBeDefined();
    expect(auxiliaries!.fit).toBe(300);
  });

  it("writes it into the army's own history, like every other thing that happens to its men", () => {
    const result = order([{
      op: "force_reinforce", forceRef: "roman-field-army",
      categoryId: "infantry", label: "Gallic auxiliaries", men: 800,
      reason: "The Gauls are taken in.",
    }]);

    const entry = legion(result.world).history.at(-1)!;
    expect(entry.kind).toBe("reinforcement");
    expect(entry.count).toBe(800);
  });
});

describe("2. they are sent to harass the enemy's supply", () => {
  it("detaches them as a force of their own with its own commander", () => {
    const result = order([{
      op: "force_create", localId: "raiders", name: "Gallic auxiliaries", polityId: "rome",
      commanderCharacterRef: "manius-curius", controllerCharacterRef: "gaius-genucius",
      locationId: AGRIGENTUM, authorizedStrength: 800,
      reason: "Detached to work against the enemy's supply.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
  });

  it("can put an enemy army short of supply", () => {
    const result = order([{
      op: "force_modify", forceRef: "carthaginian-garrison", provisionStatus: "shortage",
      reason: "Their convoys are being taken.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
    expect(result.world.material.forces.find((f) => f.id === "carthaginian-garrison")!.provisionStatus).toBe("shortage");
  });
});

describe("3. the country is burnt so the enemy finds nothing", () => {
  it("takes the food out of a province without anybody giving battle for it", () => {
    const result = order([{
      op: "province_material_shift", provinceId: AGRIGENTUM,
      foodSecurityBpsDelta: -5_000, productiveCapacityBpsDelta: -3_000, stabilityBpsDelta: -2_000,
      reason: "Everything that could be carried is carried off and the rest burnt.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
    const after = result.world.material.provinceMaterial.find((row) => row.provinceId === AGRIGENTUM)!;
    expect(after.foodSecurityBps).toBeLessThan(4_000);
  });
});

describe("4. the army at Agrigentum keeps fortifying both walls", () => {
  it("is a piece of work with a thing standing at the end of it", () => {
    const result = order([{
      op: "project_create", localId: "the_walls", kind: "fortification",
      label: "The double wall at Agrigentum", sponsorRef: { kind: "character", id: "gaius-genucius" },
      fundingAccountRef: "rome-treasury",
      milestones: [
        { label: "The outer wall closed", dueInDays: 40, costAmount: 300 },
        { label: "The inner wall raised", dueInDays: 90, costAmount: 400 },
      ],
      completionOutcome: {
        kind: "structure", label: "The double wall at Agrigentum", amount: 4_000,
        provinceId: AGRIGENTUM, polityId: "rome",
      },
      reason: "The army digs while it waits.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
    expect(result.world.projects.at(-1)!.milestones).toHaveLength(2);
    // And it costs something. Written `cost`, this passed while the wall went
    // up for nothing: an unknown key was stripped in silence and `costAmount`
    // defaulted to zero, so every project in the world was free and the
    // delegation machinery below had nothing to work on.
    //
    // Short of the 300 and 400 asked for, because the work goes through a
    // man's hands and this one takes his percent on the way past. That is
    // `throughHand`, and the skim lands as a private fact a rival can find.
    // And a little shorter again: Carthage's works are costed by its Office of
    // the Accounts (v35), old hands at it, three in a hundred below a
    // middling man's price. A wall is a soldier's work, so it is his gifts
    // for war and for feeding an army that price it (`domainOfWork`), not
    // his gifts for letters and building.
    const costs = result.world.projects.at(-1)!.milestones.map((milestone) => milestone.costAmount);
    expect(costs).toEqual([Math.round(292 * 0.97), Math.round(390 * 0.97)]);
  });
});

describe("5. the Burning City is prepared against a day that has not come", () => {
  it("is written down as a standing plan somebody could later act on", () => {
    const result = order([{
      op: "generic_entity_create", localId: "burning_city", kind: "contingency",
      label: "The Burning City",
      ownerRef: { kind: "character", id: "gaius-genucius" },
      attributes: {
        trigger: "Carthaginian troops are inside the outer wall at Agrigentum",
        action: "Fire the outer ward and bar the gates behind them",
        province: AGRIGENTUM,
        prepared: true,
      },
      reason: "The consul makes his preparations and tells nobody.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
    const plan = result.world.genericEntities.at(-1)!;
    expect(plan.label).toBe("The Burning City");
    expect(plan.attributes["trigger"]).toContain("inside the outer wall");
  });

  /**
   * The half that used to not exist.
   *
   * For as long as this test named it, nothing in the vocabulary armed a trap:
   * scheduled events fired on a date and never on a condition, and `watch`
   * predicates decided when a burst handed control back to the ruler rather
   * than what happened when it did. So the plan above was a record somebody had
   * to read and act on, which in practice meant the model had to notice it next
   * turn and choose to spring it.
   *
   * It is built now -- `contingency_arm`, and `the-burning-city-springs.test.ts`
   * holds it. The shape it took is the one this note argued for: the trap fires
   * by itself and the *engine* works out what being caught in a burning ward
   * cost, from what was actually spent laying it. A contingency still cannot
   * carry its own deltas, and should not: that would let an author pre-write
   * six thousand basis points of casualties with no battle resolved, and
   * arithmetic is the engine's.
   *
   * What remains true of the record above is that it is still a fine way to
   * write a plan down. A plan the engine springs is a `contingency_arm`; a plan
   * that is only a plan -- something a man intends, that nobody has prepared
   * ground for -- is this.
   */

});
