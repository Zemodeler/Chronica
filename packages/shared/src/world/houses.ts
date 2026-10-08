import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * Merchant houses and the fiscal officers' memory (docs/economy.md, "Who manages the economy").
 *
 * A **house** is a family firm: a head (a character, whose purse is the house's
 * capital), a home market, and the habit of sending cargoes where the markets
 * pay. It is not a polity and not a department: it is one line in the economy's
 * memory, so a world with a dozen of them costs a dozen rows, and the head is
 * an ordinary character -- he ages, falls ill, dies, and his estate passes by
 * the ordinary rules (`characters/inheritance.ts`). The house goes on under the
 * heir he named; with nobody to follow him it is wound up.
 *
 * Nothing here is a ship. A house opens at most `MAX_VENTURES_PER_HOUSE`
 * cargoes at a time (the ordinary `TradeVenture`), and the markets, the
 * customs and the money audit see them as they see any merchant's.
 */

/** What a house trades in, for its name and for where it looks: no more than a lean. */
export const HouseKindSchema = z.enum(["maritime", "grain", "silver", "banking", "publicani"]);
export type HouseKind = z.infer<typeof HouseKindSchema>;

export const MerchantHouseSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    kind: HouseKindSchema,
    /** The power whose law the house lives under: it pays its customs and may lend to its treasury. */
    polityId: EntityIdSchema.nullable(),
    /** The province of its home market: where its cargoes are bought and its factors sit. */
    homeProvinceId: EntityIdSchema,
    /** Who holds the capital now: the head, or the heir who followed him. */
    headCharacterId: EntityIdSchema,
    status: z.enum(["trading", "wound_up"]).default("trading"),
    foundedAtStep: ElapsedStepSchema.default(0),
    /** The day the house last looked to its business: a house acts once a month however long the span. */
    actedAtStep: ElapsedStepSchema.default(0),
    /** The day the house last had anything worth telling, so a year's news is a few lines and not a few hundred. */
    toldAtStep: ElapsedStepSchema.nullable().default(null),
    /** Cargoes landed and cargoes lost, over the house's life: what a ruler's page and the tests read. */
    voyages: z.number().int().nonnegative().max(1_000_000).default(0),
    losses: z.number().int().nonnegative().max(1_000_000).default(0),
    /** What it has lent to treasuries and not yet been repaid, a reading and never a ledger (the loans are the ledger). */
    lentSinceStep: ElapsedStepSchema.nullable().default(null),
    /** The day the house was first found with a head and nobody to follow him: its line is looked to until one is named (`house-succession.ts`). */
    heirSoughtAtStep: ElapsedStepSchema.nullable().optional(),
    /** The power that held the house's seat when the house last looked: a change is a city that has changed hands (`house-seat.ts`). Unset, it is `polityId`. */
    seatPolityId: EntityIdSchema.nullable().optional(),
  })
  .strict();
export type MerchantHouse = z.infer<typeof MerchantHouseSchema>;

/** No world has more houses than this: they are a handful of families, not a market. */
export const MAX_HOUSES = 80;
/** The most houses trading at once: past this nobody founds another (wound-up houses are forgotten after two years). */
export const MAX_TRADING_HOUSES = 60;
/** The most cargoes a house keeps at sea at once: a firm, not a fleet. */
export const MAX_VENTURES_PER_HOUSE = 3;
