import type { MatterDetector } from "../detector-types";
import type { DetectedMatter } from "../detector-types";
import { freshDetectedMatter } from "./shared";

// World matters, Phase 5 (docs/plans/ai-world-matters-runtime.md, "Supply
// and logistics"). A continuous-condition id (like the fiscal `arrears`
// detector), not a period-keyed one: "a force beyond its expected supply
// review creates one matter rather than daily duplicates" (doc, §Supply
// acceptance) is satisfied by giving the whole episode one stable id --
// `advanceWorldMatters` refreshes the SAME record every review while the
// condition holds, and resolves it (via its own source-vanished/no-longer-
// a-candidate path) the moment `provisionedThroughStep` is pushed out and
// `provisionStatus` returns to "provisioned", reopening as a fresh
// occurrence if the same force falls short again later.

const supplyReviewDetector: MatterDetector = {
  id: "supply.supply_review",
  kinds: ["supply_review"],
  detect(ctx) {
    const result: DetectedMatter[] = [];
    for (const force of ctx.world.material.forces) {
      const lookahead = 3;
      const dueOrSoon = force.provisionedThroughStep <= ctx.atStep + lookahead;
      const shortOrCritical = force.provisionStatus !== "provisioned";
      if (!dueOrSoon && !shortOrCritical) continue;
      const overdue = force.provisionedThroughStep <= ctx.atStep || force.provisionStatus === "critical";
      const matter = freshDetectedMatter(ctx, {
        id: `supply-review:${force.id}`,
        kind: "supply_review",
        sourceRef: { kind: "force", id: force.id },
        summary: `"${force.name}" needs a supply review (status: ${force.provisionStatus}, provisioned through step ${force.provisionedThroughStep}).`,
        intensity: force.provisionStatus === "critical" ? 80 : force.provisionStatus === "shortage" ? 60 : 30,
        provinceId: null,
        visibility: "public",
        cadenceSteps: 4,
      });
      result.push({
        ...matter,
        status: overdue ? "overdue" : "due",
        dueAt: matter.createdAt,
        requiredAuthority: [{ domain: "military", power: "command", scope: { kind: "force", id: force.id } }],
      });
    }
    return result;
  },
};

export const supplyMatterDetectors: readonly MatterDetector[] = [supplyReviewDetector];
