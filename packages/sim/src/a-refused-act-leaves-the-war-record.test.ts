import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { context } from "./war-plan-kit";

/**
 * An answer lays to its war only the losses of the armies it changed (`archiveWarLosses` in `applyDeltas`).
 *
 * Every applied answer laid the unlaid losses of every army in the world, so an act that was refused -- or one about another
 * army altogether -- rewrote the record of armies it never touched (an old save's army, whose losses had never been laid).
 * (Compared by value: a batch works on a copy of the world, so no army comes back as the same object.)
 */
const ARMY = "roman-field-army";
const OTHER = "carthaginian-sicilian-army";
const WAR = "war-rome-rhegium";

/** The opening on day 200, Rome's field army with a hundred men lost in the Rhegium war and not yet laid to it. */
function withUnlaidLoss(): WorldState {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const at = { ...world, elapsedStep: 200, instant: { ...world.instant, day: 200 } };
  return {
    ...at,
    material: {
      ...at.material,
      forces: at.material.forces.map((force) => (force.id === ARMY
        ? { ...force, history: [...force.history, { id: "loss-hunger-150", atStep: 150, kind: "attrition_death" as const, categoryId: force.personnel[0]!.categoryId, count: 100, causeId: `${ARMY}-hunger` }] }
        : force)),
    },
  };
}

const armyOf = (world: WorldState, id: string) => world.material.forces.find((force) => force.id === id)!;
const warOf = (world: WorldState) => world.polityAgreements.find((agreement) => agreement.id === WAR)!;

describe("a refused act leaves the war record alone", () => {
  it("starts from a world that loads, with the army's loss unlaid", () => {
    const world = withUnlaidLoss();
    const parsed = WorldStateSchema.safeParse(world);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toEqual([]);
    expect(armyOf(world, ARMY).lossesArchived).toBeUndefined();
    expect(world.material.forces.some((force) => force.id === OTHER)).toBe(true);
  });

  it("changes no army when the act is refused", () => {
    const world = withUnlaidLoss();
    const result = applyDeltas(world, [{ op: "force_modify", forceRef: "no-such-army", name: "Legio Nulla", reason: "A rename of nobody." }], context(world, "gaius-genucius"));
    expect(result.rejected.length).toBe(1);
    expect(armyOf(result.world, ARMY)).toEqual(armyOf(world, ARMY));
    expect(warOf(result.world)).toEqual(warOf(world));
  });

  it("does not lay the losses of an army another act touched", () => {
    const world = withUnlaidLoss();
    const result = applyDeltas(world, [{ op: "force_modify", forceRef: OTHER, name: "The Punic Host", reason: "Renamed." }], context(world, "gaius-genucius"));
    expect(result.rejected).toEqual([]);
    expect(armyOf(result.world, OTHER).name).toBe("The Punic Host");
    expect(armyOf(result.world, ARMY)).toEqual(armyOf(world, ARMY));
    expect(warOf(result.world).losses ?? []).toEqual(warOf(world).losses ?? []);
  });

  it("lays the losses of an army the act wrote to, the old with the new, once", () => {
    const world = withUnlaidLoss();
    const result = applyDeltas(world, [{ op: "force_attrition", forceRef: ARMY, cause: "sickness", lossBps: 500, reason: "Fever in the camp." }], context(world, "gaius-genucius"));
    expect(result.rejected).toEqual([]);
    const army = armyOf(result.world, ARMY);
    const fresh = army.history.filter((event) => !armyOf(world, ARMY).history.some((old) => old.id === event.id));
    expect(fresh.length).toBeGreaterThan(0);
    expect(army.lossesArchived?.ids).toEqual(expect.arrayContaining(["loss-hunger-150", ...fresh.filter((event) => ["battle_death", "wounds_death", "attrition_death", "desertion"].includes(event.kind)).map((event) => event.id)]));
    const laid = warOf(result.world).losses?.find((entry) => entry.polityId === "rome");
    expect((laid?.hardship ?? 0) + (laid?.desertion ?? 0)).toBeGreaterThan(100);
    // Nothing is laid twice: a later refused act and a later act on another army leave the war's record as it is.
    const refused = applyDeltas(result.world, [{ op: "force_modify", forceRef: "no-such-army", name: "Legio Nulla", reason: "A rename of nobody." }], context(result.world, "gaius-genucius"));
    const elsewhere = applyDeltas(refused.world, [{ op: "force_modify", forceRef: OTHER, name: "The Punic Host", reason: "Renamed." }], context(refused.world, "gaius-genucius"));
    expect(warOf(elsewhere.world).losses).toEqual(warOf(result.world).losses);
  });
});
