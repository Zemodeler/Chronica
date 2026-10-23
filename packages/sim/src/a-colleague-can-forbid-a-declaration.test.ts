import { describe, expect, it } from "vitest";
import { WorldDeltaSchema, atWar, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { as, holdersOf, opening, thinksIll } from "./competence-test-kit";
import { usurpedLately } from "./usurpation";

/**
 * A colleague can forbid a declaration (par potestas, intercessio): the one thing that stands between a consul's word and the deed, as historically. Not the
 * Senate's vote -- none is asked -- but his colleague of equal power who thinks ill of him, or has interceded, or a tribune who has.
 */

const [CONSUL, COLLEAGUE] = holdersOf(opening(), "roman-consul") as [string, string];
const war = WorldDeltaSchema.parse({ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Carthage must answer." });
const declare = (world: WorldState) => applyDeltas(world, [war], { ...as(CONSUL, world.elapsedStep, [war]), declaredDeltas: new Set([war]) });

describe("a colleague can forbid a declaration", () => {
  it("stops it when he thinks ill of the man: no war, no usurpation, and he says why", () => {
    const world = thinksIll(opening(), COLLEAGUE, CONSUL);
    const done = declare(world);
    expect(done.applied).toHaveLength(0);
    expect(done.rejected[0]!.reason).toMatch(/same office/i);
    expect(done.rejected[0]!.reason).toMatch(/stopped it/);
    expect(atWar(done.world.polityAgreements, "rome", "carthage")).toBe(false);
    expect(usurpedLately(done.world, CONSUL)).toBe(false);
  });

  it("stops it for a word of intercession already given, and a tribune's is as good", () => {
    const base = opening();
    const intercession = (owner: string, act: string) => ({ id: `intercession-${owner}`, kind: "intercession", name: "Intercession", ownerRef: { kind: "character" as const, id: owner }, attributes: { against: CONSUL, act }, createdAtStep: 0 });
    const withWord = (owner: string, act = "all"): WorldState => ({ ...base, genericEntities: [...base.genericEntities, intercession(owner, act) as never] });
    const colleague = declare(withWord(COLLEAGUE));
    expect(colleague.applied).toHaveLength(0);
    expect(colleague.rejected[0]!.reason).toMatch(/interceded/);
    const tribune = holdersOf(base, "roman-tribune")[0];
    if (tribune !== undefined) {
      const stopped = declare(withWord(tribune, "war"));
      expect(stopped.applied).toHaveLength(0);
      expect(stopped.rejected[0]!.reason).toMatch(/tribune/);
    }
    // A word against a levy does not stop a war.
    expect(declare(withWord(COLLEAGUE, "levy")).applied).toHaveLength(1);
  });

  it("does not stop it for a colleague who thinks well of him: the war is made, and answered for", () => {
    const done = declare(opening());
    expect(done.applied).toHaveLength(1);
    expect(atWar(done.world.polityAgreements, "rome", "carthage")).toBe(true);
    expect(usurpedLately(done.world, CONSUL)).toBe(true);
  });
});
