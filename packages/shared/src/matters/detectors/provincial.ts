import type { MatterDetector } from "../detector-types";
import { freshDetectedMatter } from "./shared";

// Ported behavior-preservingly from `world-development-scheduler.ts`'s
// `candidates()` (scarcity/reconstruction/civic branches). Same thresholds,
// same id generation. The one deliberate difference: no `leader(polityId)`
// lookup -- Phase 1 does not resolve an actor at all (that is Phase 2's
// job, via `responsibleScopeRefs`/NPC routing), so a matter is now detected
// purely from source state, even when nobody currently holds the seat that
// would address it.

const scarcityDetector: MatterDetector = {
  id: "provincial.scarcity",
  kinds: ["scarcity"],
  detect(ctx) {
    const result = [];
    for (const material of ctx.world.material.provinceMaterial) {
      if (material.foodSecurityBps >= 4_000) continue;
      const province = ctx.world.map.provinces.find((p) => p.id === material.provinceId);
      if (!province) continue;
      result.push(
        freshDetectedMatter(ctx, {
          id: `scarcity:${province.id}`,
          kind: "scarcity",
          sourceRef: { kind: "province", id: province.id },
          summary: `Food insecurity in ${province.name} puts relief and provisioning before its governing authority.`,
          intensity: Math.round(40 + (4_000 - material.foodSecurityBps) / 100),
          provinceId: province.id,
          visibility: "public",
          cadenceSteps: 1,
        }),
      );
    }
    return result;
  },
};

const reconstructionDetector: MatterDetector = {
  id: "provincial.reconstruction",
  kinds: ["reconstruction"],
  detect(ctx) {
    const result = [];
    for (const material of ctx.world.material.provinceMaterial) {
      if (material.warDamageBps < 1_000 && material.displacedPopulation <= 0) continue;
      const province = ctx.world.map.provinces.find((p) => p.id === material.provinceId);
      if (!province) continue;
      result.push(
        freshDetectedMatter(ctx, {
          id: `reconstruction:${province.id}`,
          kind: "reconstruction",
          sourceRef: { kind: "province", id: province.id },
          summary: `${province.name} needs reconstruction${
            material.displacedPopulation > 0 ? ` and resettlement for ${material.displacedPopulation} displaced inhabitants` : ""
          }; its governing authority has an opportunity to organize recovery.`,
          intensity: Math.min(80, 30 + Math.round(material.warDamageBps / 200)),
          provinceId: province.id,
          visibility: "public",
          cadenceSteps: 2,
        }),
      );
    }
    return result;
  },
};

const civicDetector: MatterDetector = {
  id: "provincial.civic",
  kinds: ["civic"],
  detect(ctx) {
    return ctx.world.material.institutions.map((institution) =>
      freshDetectedMatter(ctx, {
        id: `civic:${institution.id}`,
        kind: "civic",
        sourceRef: { kind: "institution", id: institution.id },
        summary: `${institution.name}'s recurring public business places readiness and administration before its responsible authority.`,
        intensity: 35,
        provinceId: null,
        visibility: "public",
        cadenceSteps: 4,
      }),
    );
  },
};

export const provincialMatterDetectors: readonly MatterDetector[] = [scarcityDetector, reconstructionDetector, civicDetector];
