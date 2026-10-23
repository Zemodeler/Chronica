import { punicWarsScenario } from "@chronica/db";
import { WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { describe, expect, it } from "vitest";
import { applyDeltas } from "./apply/apply-deltas";
import { readBoard } from "./board";
import { context, placed } from "./war-plan-kit";

/**
 * A power on an ally's ground is a rival, whether or not it borders us.
 *
 * Rome and Carthage have no common border, and the board saw only neighbours, so that Rome never weighed a war on Carthage even with a Carthaginian garrison in
 * Messana, whose people were Rome's allies and had asked it for help. A power whose army stands on the ground of a friend of ours is now one of our rivals within
 * reach; the war it may come to is the old rules' (the age's lean, the appeal, the odds, the Senate and the people), not this.
 */
describe("a power on an ally's ground is a rival", () => {
  const MESSANA = "sic-q659z";
  const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const allied = (world: WorldState): WorldState => applyDeltas(world, [WorldDeltaSchema.parse({
    op: "agreement_open", localId: "rome-and-the-mamertines", kind: "alliance", polityId: "rome", otherPolityId: "mamertines", terms: "Rome and the Mamertines are allies.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Allies.",
  })], context(world, "gaius-genucius")).world;
  const sees = (world: WorldState): string[] => (readBoard(world).get("rome")?.neighbours ?? []).map((neighbour) => neighbour.polityId);

  it("is not one while nobody of ours stands where its army is", () => {
    expect(sees(placed(opening(), "carthaginian-sicilian-army", MESSANA))).not.toContain("carthage");
  });

  it("is not one while it keeps off our ally's ground", () => {
    expect(sees(allied(opening()))).not.toContain("carthage");
  });

  it("is one when its army stands in Messana and the Mamertines are our allies", () => {
    const world = allied(placed(opening(), "carthaginian-sicilian-army", MESSANA));
    expect(sees(world)).toContain("carthage");
    const carthage = readBoard(world).get("rome")!.neighbours.find((neighbour) => neighbour.polityId === "carthage")!;
    expect(carthage.bordering).toBe(false);
  });
});
