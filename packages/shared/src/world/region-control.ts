import { z } from "zod";

// Region control grounds (docs/15-map, ADR pending: region control workflow).
//
// The reason a province's controller changed, carried alongside the existing
// `SiegeOrControlChangeSchema` (packages/shared/src/warfare/battle.ts) fields.
// "conquest"/"occupation" originate only from the battle/siege engine's own
// fact emission; the other four are the grounds the `change_region_control`
// workflow accepts from a proposed invocation.

export const RegionControlGroundsSchema = z.enum([
  "conquest",
  "occupation",
  "treaty_transfer",
  "rebellion_secession",
  "inheritance_succession",
  "administrative_transfer",
]);
export type RegionControlGrounds = z.infer<typeof RegionControlGroundsSchema>;
