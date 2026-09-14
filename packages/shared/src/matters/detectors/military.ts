import type { MatterDetector } from "../detector-types";
import { freshDetectedMatter } from "./shared";

// Ported behavior-preservingly from `world-development-scheduler.ts`'s
// `candidates()` (war branch): same id (`war:<sorted pair>:<polityId>`,
// still not a synthetic war entity id), same intensity/interval. No
// `leader(polityId)` lookup -- see `provincial.ts`'s comment.
const warBurdenDetector: MatterDetector = {
  id: "military.war_burden",
  kinds: ["war_burden"],
  detect(ctx) {
    const result = [];
    for (const war of ctx.world.conflicts.wars) {
      for (const polityId of [war.polityAId, war.polityBId]) {
        const polityName = ctx.world.map.polities.find((p) => p.id === polityId)?.name ?? polityId;
        result.push(
          freshDetectedMatter(ctx, {
            id: `war:${[war.polityAId, war.polityBId].sort().join(":")}:${polityId}`,
            kind: "war_burden",
            sourceRef: { kind: "polity", id: polityId },
            summary: `The continuing war requires ${polityName}'s leadership to review supply, defense, and diplomatic options.`,
            intensity: 55,
            provinceId: null,
            visibility: "public",
            cadenceSteps: 2,
          }),
        );
      }
    }
    return result;
  },
};

export const militaryMatterDetectors: readonly MatterDetector[] = [warBurdenDetector];
