import { provincialMatterDetectors } from "./detectors/provincial";
import { militaryMatterDetectors } from "./detectors/military";
import { householdMatterDetectors } from "./detectors/household";
import { fiscalMatterDetectors } from "./detectors/fiscal";
import { institutionalMatterDetectors } from "./detectors/institutional";
import { supplyMatterDetectors } from "./detectors/supply";
import { diplomaticMatterDetectors } from "./detectors/diplomatic";
import type { MatterDetector } from "./detector-types";

export type { MatterDetectorContext, DetectedMatter, MatterDetector } from "./detector-types";

// Matter detector registry (docs/plans/ai-world-matters-runtime.md,
// "1. Detection") -- imitates `workflows/registry.ts`'s exact aggregation
// style: one array concatenated from each domain's own module, frozen.
// Adding a detector: implement it in `detectors/<domain>.ts`, then add its
// array to the list below.
const allDetectors: MatterDetector[] = [
  ...provincialMatterDetectors,
  ...militaryMatterDetectors,
  ...householdMatterDetectors,
  ...fiscalMatterDetectors,
  ...institutionalMatterDetectors,
  ...supplyMatterDetectors,
  ...diplomaticMatterDetectors,
];

export const MATTER_DETECTORS: readonly MatterDetector[] = Object.freeze(allDetectors);
