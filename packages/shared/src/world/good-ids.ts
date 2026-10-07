import { z } from "zod";

/**
 * The six goods markets deal in, by id. Kept apart from `markets.ts` so the
 * ledger's schemas (a cargo names the good it carries) can say them without
 * the market model, which reads the ledger, importing the ledger back.
 */
export const GOOD_IDS = ["grain", "oil_wine", "metals", "timber", "textiles", "slaves"] as const;
export type GoodId = (typeof GOOD_IDS)[number];
export const GoodIdSchema = z.enum(GOOD_IDS);
