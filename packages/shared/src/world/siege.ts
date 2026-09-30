import { z } from "zod";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema } from "../material-state";
import type { WorldState } from "./world-state";

/**
 * A city held under siege.
 *
 * "Siege begun", "siege continued", "siege posture" were sentences: a Roman
 * legion sat before Messana for two months and nothing in the world knew it,
 * so nothing happened, and the consul heard nothing until he stormed the walls.
 * A siege is a thing the engine keeps: the army that lays it, the city, and
 * how hard the city is pressed. Every day it is kept, the garrison goes
 * hungrier and thinner; every fortnight the besieger hears how it goes; and
 * when the city can hold no longer it opens its gates.
 */
export const SiegeWorkKindSchema = z.enum(["rams", "towers", "mine", "lines"]);
export type SiegeWorkKind = z.infer<typeof SiegeWorkKindSchema>;

/** How long each work takes to raise, in days, and what it costs for every thousand besiegers. */
export const SIEGE_WORKS: Readonly<Record<SiegeWorkKind, { readonly days: number; readonly costPerThousand: number; readonly label: string }>> = {
  rams: { days: 8, costPerThousand: 8, label: "rams and sheds" },
  towers: { days: 20, costPerThousand: 20, label: "siege towers" },
  mine: { days: 30, costPerThousand: 14, label: "a mine under the walls" },
  lines: { days: 15, costPerThousand: 16, label: "lines of circumvallation" },
};

export const SiegeSchema = z
  .object({
    id: EntityIdSchema,
    /** The army that lays it. The siege ends when it leaves. */
    forceId: EntityIdSchema,
    provinceId: EntityIdSchema,
    /** The city besieged, where it is one; null for the province's strongholds at large. */
    settlementId: EntityIdSchema.nullable().default(null),
    besiegerPolityId: EntityIdSchema,
    defenderPolityId: EntityIdSchema,
    startedAtStep: ElapsedStepSchema,
    /** The last day it was pressed, so a tick that covers ten days presses ten. */
    pressedToStep: ElapsedStepSchema,
    /** The last day the besieger was told how it goes. */
    reportedAtStep: ElapsedStepSchema,
    /** How near the city is to yielding: at 10 000 it opens its gates. */
    pressureBps: BasisPointsSchema.default(0),
    /**
     * The armies that were in the city when the siege was first pressed. Any
     * other army of the city's side that arrives is a relief (`sim/sieges.ts`).
     * Absent until the first day it is pressed.
     */
    garrisonForceIds: z.array(EntityIdSchema).max(40).optional(),
    /**
     * A moment of the siege put to the player besieging it, waiting on his
     * answer: a breach to storm, or terms offered (docs/plans/battles-that-last.md,
     * phase 5). The siege stands still until he gives it.
     */
    awaiting: z.object({ kind: z.enum(["breach", "terms"]), askedAtStep: ElapsedStepSchema }).strict().nullable().default(null),
    /**
     * The works raised against the city (docs/plans/battles-that-last.md):
     * rams and towers press it harder once built, a mine brings a stretch of
     * wall down when it is finished, and lines of circumvallation shut it in.
     * A sortie may burn what is not yet finished, and rams and towers after.
     */
    works: z.array(z.object({
      kind: SiegeWorkKindSchema,
      readyAtStep: ElapsedStepSchema,
      status: z.enum(["building", "ready", "burned", "sprung"]),
    }).strict()).max(8).default([]),
    /** The siege's events already told, so each is told once ("breach", "runners"). */
    told: z.array(z.string().max(60)).max(20).default([]),
    status: z.enum(["active", "lifted", "taken"]).default("active"),
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    endedReason: z.string().trim().min(1).max(300).nullable().default(null),
  })
  .strict();
export type Siege = z.infer<typeof SiegeSchema>;

/** Days a city with a garrison as strong as a third of the besiegers holds out. */
export const SIEGE_BASE_DAYS = 90;

/**
 * How hard a siege presses in a day, in basis points toward the gates
 * opening at 10 000. Besiegers three times the garrison take
 * `SIEGE_BASE_DAYS`; fewer take longer, more take less, within bounds; an
 * empty wall yields twice as fast. The engine presses sieges with this, and
 * the player's projection of one ("it should fall by June") uses it too.
 */
export function siegeRatio(besiegerFit: number, defenderFit: number, walls = 1): number {
  return (defenderFit === 0 ? 2 : Math.max(0.4, Math.min(1.6, besiegerFit / (defenderFit * 3)))) / Math.max(1, walls);
}

export function siegePressurePerDayBps(besiegerFit: number, defenderFit: number, walls = 1): number {
  return (siegeRatio(besiegerFit, defenderFit, walls) * 10_000) / SIEGE_BASE_DAYS;
}

/**
 * How many times longer the walls make a siege: 1 for an open town, up to
 * two and a half for a city walled to the scenario's highest level, and more
 * again for a fortress built on top. Settlements have carried a
 * `fortificationLevel` and structures a `defensiveEffectsBps` since the map was
 * written, and a siege read neither: Syracuse fell as fast as a village.
 */
export function siegeWalls(world: Pick<WorldState, "map" | "structures">, siege: Pick<Siege, "provinceId" | "settlementId" | "defenderPolityId">): number {
  const province = world.map.provinces.find((candidate) => candidate.id === siege.provinceId);
  const cities = (province?.settlements ?? []).filter((city) => siege.settlementId === null || city.id === siege.settlementId);
  const level = cities.reduce((most, city) => Math.max(most, city.fortificationLevel), 0);
  const works = world.structures
    .filter((structure) => structure.provinceId === siege.provinceId && (structure.ownerPolityId === null || structure.ownerPolityId === siege.defenderPolityId))
    .reduce((sum, structure) => sum + structure.defensiveEffectsBps, 0);
  return 1 + level * 0.15 + Math.min(10_000, works) / 10_000;
}
/** How often the besieger hears how the siege goes. */
export const SIEGE_REPORT_DAYS = 15;
/** Days before hunger begins to kill the garrison. */
export const SIEGE_HUNGER_AFTER_DAYS = 30;
/** Of the garrison's fit men, the share lost each day once hunger has begun, in basis points. */
export const SIEGE_HUNGER_BPS_PER_DAY = 30;
