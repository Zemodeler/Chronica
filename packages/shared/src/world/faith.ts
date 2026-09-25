import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * What people believe, as a list anybody may add to.
 *
 * Characters carried a `faithId` from the start and nothing read it, and there
 * was nothing for it to name. "Start a church" had no expression at all: the
 * nearest thing was an arrangement called a church, which did nothing. Faiths
 * are now an open list on the office pattern -- one is founded by naming it --
 * and belief is counted where it lives, as a share of each province.
 *
 * A province with no row believes as it always has; the rows record only what
 * has changed, so 779 provinces cost nothing until somebody preaches in one.
 */
export const FaithSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    foundedAtStep: ElapsedStepSchema,
    founderCharacterId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type Faith = z.infer<typeof FaithSchema>;

export const FaithAdherenceSchema = z
  .object({
    provinceId: EntityIdSchema,
    faithId: EntityIdSchema,
    shareBps: z.number().int().min(0).max(10_000),
  })
  .strict();
export type FaithAdherence = z.infer<typeof FaithAdherenceSchema>;

interface FaithWorld {
  readonly faiths: readonly Faith[];
  readonly faithAdherence: readonly FaithAdherence[];
}

const slug = (name: string): string =>
  name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "faith";

/** The faith of that name or id, founding it if nobody has yet. Deterministic in the name, so a replay founds the same one. */
export function faithNamed<W extends FaithWorld>(
  world: W,
  nameOrId: string,
  atStep: number,
  founderCharacterId: string | null = null,
): { readonly world: W; readonly faithId: string; readonly founded: boolean } {
  const wanted = nameOrId.trim();
  const known = world.faiths.find((faith) => faith.id === wanted || faith.name.toLowerCase() === wanted.toLowerCase());
  if (known !== undefined) return { world, faithId: known.id, founded: false };
  const id = `faith-${slug(wanted)}`;
  const clash = world.faiths.find((faith) => faith.id === id);
  if (clash !== undefined) return { world, faithId: clash.id, founded: false };
  return {
    world: { ...world, faiths: [...world.faiths, { id, name: wanted, foundedAtStep: atStep, founderCharacterId }] },
    faithId: id,
    founded: true,
  };
}

/**
 * A faith gaining ground in a province. Every other faith recorded there gives
 * up its share in proportion; whatever is not recorded is the old belief, and
 * gives up the rest. Returns the new share of the growing faith.
 */
export function convertIn<W extends FaithWorld>(world: W, provinceId: string, faithId: string, gainBps: number): { readonly world: W; readonly shareBps: number } {
  const here = world.faithAdherence.filter((row) => row.provinceId === provinceId);
  const elsewhere = world.faithAdherence.filter((row) => row.provinceId !== provinceId);
  const current = here.find((row) => row.faithId === faithId)?.shareBps ?? 0;
  const next = Math.max(0, Math.min(10_000, current + gainBps));
  const gained = next - current;
  const others = here.filter((row) => row.faithId !== faithId);
  const recorded = others.reduce((sum, row) => sum + row.shareBps, 0);
  const unrecorded = Math.max(0, 10_000 - recorded - current);
  // Taken from the old belief first, then from the recorded rivals in proportion.
  const fromRivals = Math.max(0, gained - unrecorded);
  const rivals = others.map((row) => ({
    ...row,
    shareBps: recorded === 0 ? row.shareBps : Math.max(0, row.shareBps - Math.round((row.shareBps / recorded) * fromRivals)),
  }));
  return {
    world: { ...world, faithAdherence: [...elsewhere, ...rivals.filter((row) => row.shareBps > 0), { provinceId, faithId, shareBps: next }] },
    shareBps: next,
  };
}
