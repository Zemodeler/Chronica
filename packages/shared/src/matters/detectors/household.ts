import type { MatterDetector } from "../detector-types";
import { freshDetectedMatter } from "./shared";

// Ported behavior-preservingly from `world-development-scheduler.ts`'s
// `candidates()` (household branch): same id, same threshold (local food
// insecurity), same interval. No `leader`/actor lookup -- see
// `provincial.ts`'s comment. `visibility: "private"` mirrors the old
// scheduler's `visibility: "private"` pressure and keeps household needs
// out of public matter context, same as the household pressure was kept
// out of the public event feed.
const householdDetector: MatterDetector = {
  id: "household.household",
  kinds: ["household"],
  detect(ctx) {
    const result = [];
    for (const household of ctx.world.households.filter((h) => h.active)) {
      const head = ctx.world.characters.find((c) => c.id === household.headCharacterId && c.alive);
      const material = ctx.world.material.provinceMaterial.find((p) => p.provinceId === head?.locationProvinceId);
      if (!head || !material || material.foodSecurityBps >= 4_000) continue;
      result.push(
        freshDetectedMatter(ctx, {
          id: `household:${household.id}`,
          kind: "household",
          sourceRef: { kind: "household", id: household.id },
          summary: `Local food insecurity puts the provisioning of ${household.name} before its head of household.`,
          intensity: 50,
          provinceId: material.provinceId,
          visibility: "private",
          cadenceSteps: 2,
        }),
      );
    }
    return result;
  },
};

export const householdMatterDetectors: readonly MatterDetector[] = [householdDetector];
