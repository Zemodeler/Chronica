import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { assessFeasibility } from "./feasibility";

const PLAYER = "marcus-atilius";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

describe("assessFeasibility (docs/32, Phase 3, advisory only)", () => {
  it("passes actor_exists for a living character and reports viable with no other input", () => {
    const result = assessFeasibility({ world: world(), actorId: PLAYER });
    expect(result.findings).toEqual([expect.objectContaining({ dimension: "actor_exists", result: "pass" })]);
    expect(result.classification).toBe("viable");
  });

  it("fails actor_exists, not recoverable, for an unknown or dead character and classifies impossible", () => {
    const result = assessFeasibility({ world: world(), actorId: "no-such-character" });
    expect(result.findings[0]).toMatchObject({ dimension: "actor_exists", result: "fail", recoverable: false });
    expect(result.classification).toBe("impossible");
  });

  it("checks a named province exists", () => {
    const w = world();
    const realProvinceId = w.map.provinces[0]!.id;
    expect(assessFeasibility({ world: w, actorId: PLAYER, targetProvinceId: realProvinceId }).classification).toBe("viable");
    expect(assessFeasibility({ world: w, actorId: PLAYER, targetProvinceId: "nowhere" }).classification).toBe("impossible");
  });

  it("checks the actor actually controls a named account", () => {
    const w = world();
    const ownAccount = w.material.accounts.find(a => a.owner.kind === "character" && a.owner.id === PLAYER);
    const otherAccount = w.material.accounts.find(a => !(a.owner.kind === "character" && a.owner.id === PLAYER));
    expect(ownAccount).toBeDefined();
    expect(assessFeasibility({ world: w, actorId: PLAYER, resourceRefs: [{ accountId: ownAccount!.id }] }).classification).toBe("viable");
    if (otherAccount) {
      const result = assessFeasibility({ world: w, actorId: PLAYER, resourceRefs: [{ accountId: otherAccount.id }] });
      expect(result.classification).toBe("impossible");
    }
  });

  it("marks an unregistered action id as unsupported, not impossible -- a future invented action could still cover it", () => {
    const result = assessFeasibility({ world: world(), actorId: PLAYER, actionId: "found_a_colony_on_mars" });
    expect(result.findings.find(f => f.dimension === "workflow_support")).toMatchObject({ result: "fail", recoverable: true });
    expect(result.classification).toBe("unsupported");
  });

  it("recognizes a registered workflow id", () => {
    const result = assessFeasibility({ world: world(), actorId: PLAYER, actionId: "move_force" });
    expect(result.findings.find(f => f.dimension === "workflow_support")).toMatchObject({ result: "pass" });
    expect(result.classification).toBe("viable");
  });

  it("fails world_consistency, not recoverable, on a contradicted world premise and classifies misinformed", () => {
    const result = assessFeasibility({
      world: world(),
      actorId: PLAYER,
      claims: [{ text: "I have a legion at Rome", kind: "world_premise", verification: "contradicted", supportingFactIds: [], contradictionFactIds: ["fact-no-legion"] }],
    });
    expect(result.findings.find(f => f.dimension === "world_consistency")).toMatchObject({ result: "fail", recoverable: false });
    expect(result.classification).toBe("misinformed");
  });

  it("ignores a confirmed or actor_belief claim", () => {
    const result = assessFeasibility({
      world: world(),
      actorId: PLAYER,
      claims: [
        { text: "I believe Carthage will attack", kind: "actor_belief", verification: "unknown", supportingFactIds: [], contradictionFactIds: [] },
        { text: "I have a legion at Rome", kind: "world_premise", verification: "confirmed", supportingFactIds: ["fact-yes-legion"], contradictionFactIds: [] },
      ],
    });
    expect(result.findings.find(f => f.dimension === "world_consistency")).toBeUndefined();
    expect(result.classification).toBe("viable");
  });
});
