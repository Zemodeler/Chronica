import { z } from "zod";
import { EntityIdSchema } from "../material-state";

/**
 * The noble families.
 *
 * A Roman belonged to a gens: the people who bore one nomen and kept one set of rites, and who
 * were, in the nobility's own telling, descended from one ancestor. A gens had branches (the
 * stirpes, named by cognomen: the Cornelii Scipiones, the Cornelii Lentuli), honours that were
 * the family's own (the imagines of its consuls and censors, carried at a funeral), rites it
 * kept down the generations (sacra gentilicia), a tomb, friends and enemies, and the marriages
 * that tied it to others. What made a man a *nobilis* was not his gens but the consuls in it:
 * a man whose forefathers sat in the curule chair stood for it easily, and one whose did not
 * -- a *novus homo* -- found the road steeper (Cato, Marius, Cicero were the late examples; in
 * 270 Curius and Fabricius were the first of their name).
 *
 * Carthage had its great families (the Barcids, the Hannonids, the Magonids) and the kings had
 * their houses; they are the same record with `kind: "royal"` or no order, and no consuls.
 *
 * `Character.dynastyId` names the gens a person belongs to; the members are whoever bears it.
 * Everything else here is written by `sim/gentes.ts` once a month and read by the places that
 * weigh a man's name: elections, marriage, the Senate's divisions, adoption.
 */

export const CurulHonourKindSchema = z.enum(["consul", "censor", "dictator"]);
export type CurulHonourKind = z.infer<typeof CurulHonourKindSchema>;

/** One curule honour a gens has had: it is why a family has imagines, and what a man's nobilitas is counted from. */
export const CurulHonourSchema = z
  .object({
    kind: CurulHonourKindSchema,
    /** The man's name, as the fasti give it. */
    who: z.string().trim().min(1).max(120),
    /** The person in the world, where he is one. */
    characterId: EntityIdSchema.nullable().default(null),
    /** The branch he belonged to. */
    stirps: z.string().trim().min(1).max(60).nullable().default(null),
    /** The day, counted from the opening (before it, negative). */
    atStep: z.number().int().safe(),
  })
  .strict();
export type CurulHonour = z.infer<typeof CurulHonourSchema>;

export const FeudSchema = z
  .object({
    againstGensId: EntityIdSchema,
    reason: z.string().trim().min(1).max(240),
    sinceStep: z.number().int().safe(),
    renewedAtStep: z.number().int().safe(),
    /** How hot it is, 0-10 000. It cools by itself and is stoked by the living. */
    intensityBps: z.number().int().min(0).max(10_000),
  })
  .strict();
export type Feud = z.infer<typeof FeudSchema>;

export const AllianceSchema = z
  .object({
    withGensId: EntityIdSchema,
    sinceStep: z.number().int().safe(),
    renewedAtStep: z.number().int().safe(),
    /** How close, 0-10 000: each match renews it, and it fades as the marriage's generation does. */
    strengthBps: z.number().int().min(0).max(10_000),
    /** The marriage that made it: groom, then bride. */
    groomId: EntityIdSchema,
    brideId: EntityIdSchema,
  })
  .strict();
export type Alliance = z.infer<typeof AllianceSchema>;

/** A branch: the cognomen that names it, the other cognomina its men bore (Valerii Maximi were also Corvi, Corvini and Messallae), and its order where it differs from the gens's (the Claudii Marcelli were plebeian). */
export const StirpsSchema = z
  .object({
    cognomen: z.string().trim().min(1).max(60),
    aka: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    ordo: z.enum(["patrician", "plebeian"]).optional(),
  })
  .strict();

export const GensSchema = z
  .object({
    /** "gens-cornelius", "gens-barca". */
    id: EntityIdSchema,
    kind: z.enum(["noble", "royal"]).default("noble"),
    /** The nomen, in a man's form: "Cornelius". For a house outside Rome, its name: "Barca". */
    nomen: z.string().trim().min(1).max(80),
    /** How it is spoken of: "the Cornelii". */
    plural: z.string().trim().min(1).max(100),
    polityId: EntityIdSchema.nullable().default(null),
    /** Patrician or plebeian, where the country has orders. */
    ordo: z.enum(["patrician", "plebeian"]).optional(),
    stirpes: z.array(StirpsSchema).max(24).default([]),
    honours: z.array(CurulHonourSchema).max(300).default([]),
    /** How many of its men have sat in a curule chair: the images in the atrium. Kept by the monthly pass. */
    imagines: z.number().int().min(0).max(400).default(0),
    /** The rites it keeps, by name. They stay in the gens (`sim/gentes.ts`). */
    sacra: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
    /** The man who carries them: the head, or the heir he named. Null where the gens has no man. */
    sacraKeeperId: EntityIdSchema.nullable().default(null),
    tomb: z.string().trim().min(1).max(120).nullable().default(null),
    feuds: z.array(FeudSchema).max(12).default([]),
    alliances: z.array(AllianceSchema).max(24).default([]),
    /** The first man of the gens: its eldest consular, else its most honoured. Kept by the monthly pass. */
    princepsId: EntityIdSchema.nullable().default(null),
    /** What the name weighs, 0-10 000. */
    dignitasBps: z.number().int().min(0).max(10_000).default(0),
    /** The day the monthly pass last looked at it. */
    keptAtStep: z.number().int().safe().nullable().default(null),
    /** Where the sources stand behind it, for whoever reads the record. */
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type Gens = z.infer<typeof GensSchema>;

/** The most gentes a world keeps: Rome's three hundred or so, the other powers' houses, and room to grow. */
export const MAX_GENTES = 500;

/** What of the world these reads need. */
export interface GentesView {
  readonly gentes?: readonly Gens[];
}

/** The slice of a character these reads need. */
export interface BearsAName {
  readonly id: string;
  readonly name: string;
  readonly dynastyId: string | null;
  readonly cognomen?: string | undefined;
  readonly alive?: boolean | undefined;
}

export function gensById(world: GentesView, id: string | null | undefined): Gens | undefined {
  return id == null ? undefined : world.gentes?.find((gens) => gens.id === id);
}

/** The branch of a gens a man belongs to: the stirps whose cognomen is among his own names, else none. */
export function stirpsOf(gens: Gens, character: Pick<BearsAName, "name" | "cognomen">): string | null {
  const words = new Set(`${character.cognomen ?? ""} ${character.name}`.split(/\s+/).filter((word) => word.length > 0));
  return gens.stirpes.find((stirps) => stirps.cognomen.split(/\s+/).every((word) => words.has(word)) || stirps.aka.some((word) => words.has(word)))?.cognomen ?? null;
}

/** What nobilitas a man has: the consuls among his forefathers and his gens, not counting himself. */
export interface Nobilitas {
  readonly tier: "nobilis" | "gentilis" | "novus" | "none";
  /** Consulships held by others of his own branch. */
  readonly inStirps: number;
  /** Consulships held by others of his gens, of any branch. */
  readonly inGens: number;
  /** What he has held himself. */
  readonly own: number;
  readonly stirps: string | null;
}

/** The consulships (and censorships and dictatorships) of a gens, optionally of one branch, optionally not counting one man. */
export function curuleHonours(gens: Gens, stirps: string | null, exceptId: string | null): number {
  return gens.honours.filter((honour) => honour.kind === "consul" && (stirps === null || honour.stirps === stirps) && (exceptId === null || honour.characterId !== exceptId)).length;
}

export function nobilitasOf(world: GentesView, character: BearsAName): Nobilitas {
  const gens = gensById(world, character.dynastyId);
  if (gens === undefined || gens.kind !== "noble" || gens.polityId !== "rome") return { tier: "none", inStirps: 0, inGens: 0, own: 0, stirps: null };
  const stirps = stirpsOf(gens, character);
  const own = gens.honours.filter((honour) => honour.kind === "consul" && honour.characterId === character.id).length;
  const inGens = curuleHonours(gens, null, character.id);
  const inStirps = stirps === null ? 0 : curuleHonours(gens, stirps, character.id);
  const tier = inStirps > 0 ? "nobilis" : inGens > 0 ? "gentilis" : "novus";
  return { tier, inStirps, inGens, own, stirps };
}

/** Per consulship in a man's own branch, what the electors add to his reckoning, in basis points of the scale (10 000 is the whole of a man's standing). */
export const NOBILIS_BPS_PER_CONSULSHIP = 400;
/** The most his own branch's consuls are worth. */
export const NOBILIS_BPS_CAP = 1_600;
/** A man whose branch has none but whose gens has: a flat share, and a little more for each. */
export const GENTILIS_BPS_BASE = 250;
export const GENTILIS_BPS_PER_CONSULSHIP = 100;
export const GENTILIS_BPS_CAP = 1_000;
/** A man of a gens that has never had a consul: the steeper road. */
export const NOVUS_BPS = -600;
/** A gens's dignitas counts for this share of itself, to a most. */
export const DIGNITAS_SHARE_DIVISOR = 20;
export const DIGNITAS_BPS_CAP = 500;

/** What his name adds to or takes from a man in the electors' reckoning, before the office's weight is applied. */
export function nobilitasBps(world: GentesView, character: BearsAName): number {
  const nobilitas = nobilitasOf(world, character);
  if (nobilitas.tier === "none") return 0;
  const gens = gensById(world, character.dynastyId)!;
  const dignitas = Math.min(DIGNITAS_BPS_CAP, Math.round(gens.dignitasBps / DIGNITAS_SHARE_DIVISOR));
  if (nobilitas.tier === "nobilis") return Math.min(NOBILIS_BPS_CAP, nobilitas.inStirps * NOBILIS_BPS_PER_CONSULSHIP) + dignitas;
  if (nobilitas.tier === "gentilis") return Math.min(GENTILIS_BPS_CAP, GENTILIS_BPS_BASE + nobilitas.inGens * GENTILIS_BPS_PER_CONSULSHIP) + dignitas;
  return NOVUS_BPS + dignitas;
}

/**
 * How much the electors weigh a name for an office, as a share of ten thousand. The consulship and the
 * censorship were the nobility's; a quaestor was chosen from the young men of the families; the tribunate
 * was the plebs' own and cared for it little.
 */
export function nobilitasWeightBps(office: { readonly rank?: number | undefined; readonly kind?: string | undefined; readonly tribunician?: boolean | undefined }): number {
  if (office.tribunician === true) return 1_000;
  if (office.rank === undefined) return office.kind === "priesthood" ? 3_500 : 0;
  if (office.rank >= 4) return 10_000;
  if (office.rank === 3) return 7_000;
  if (office.rank === 2) return 4_000;
  return 2_500;
}

/**
 * One short phrase for a man's gens, for the lines a model reads of him: "of the Cornelii, a noble", "of the Curii, a new man",
 * "of the Ptolemies". Null where he is of none.
 */
export function gensPhrase(world: GentesView, character: BearsAName): string | null {
  const gens = gensById(world, character.dynastyId);
  if (gens === undefined) return null;
  const nobilitas = nobilitasOf(world, character);
  const rank = nobilitas.tier === "nobilis" ? ", a noble" : nobilitas.tier === "novus" ? ", a new man" : "";
  return `of ${gens.plural}${rank}`;
}

/** Who is feuding with whom, as the heat between two gentes: zero where there is no feud. */
export function feudBetween(world: GentesView, a: string | null | undefined, b: string | null | undefined): number {
  if (a == null || b == null || a === b) return 0;
  const there = gensById(world, a)?.feuds.find((feud) => feud.againstGensId === b)?.intensityBps ?? 0;
  const back = gensById(world, b)?.feuds.find((feud) => feud.againstGensId === a)?.intensityBps ?? 0;
  return Math.max(there, back);
}

/** How close two gentes are by marriage, the strongest tie of either's record. */
export function allianceBetween(world: GentesView, a: string | null | undefined, b: string | null | undefined): number {
  if (a == null || b == null || a === b) return 0;
  const there = gensById(world, a)?.alliances.find((alliance) => alliance.withGensId === b)?.strengthBps ?? 0;
  const back = gensById(world, b)?.alliances.find((alliance) => alliance.withGensId === a)?.strengthBps ?? 0;
  return Math.max(there, back);
}

/** Offices Rome kept for patricians by birth: the king of the rites, the great flamines, the dancing priests of Mars. */
const PATRICIAN_ONLY_OFFICE = /rex-sacrorum|rex sacrorum|flamen|salii|salian/i;

/** What of the world the priestly taboos need: who sits in which seat. */
export interface SeatsView {
  readonly material: { readonly officeSeats: readonly { readonly officeId: string; readonly holderCharacterId: string | null; readonly status: string }[] };
}

/** The offices whose holders live under a taboo: the flamen of Jupiter, and the king of the rites. */
const FLAMEN_DIALIS = /flamen-dialis|flamen dialis/i;
const REX_SACRORUM = /rex-sacrorum|rex sacrorum/i;

const holdsOfficeLike = (world: SeatsView, characterId: string, pattern: RegExp): boolean =>
  world.material.officeSeats.some((seat) => seat.holderCharacterId === characterId && seat.status === "held" && pattern.test(seat.officeId));

/**
 * The taboos of the great priesthoods as eligibility, in the words the man is told; null where he is free. The flamen Dialis could hold no other
 * office and had no command (he might not see an army under arms, nor ride; Gellius 10.15, and Livy 27.8, where a flamen was refused the praetorship
 * and had to take his seat in the Senate by the praetor's order); the rex sacrorum could hold no magistracy (Livy 40.42, Plutarch, Roman Questions 63:
 * he gave up his own, and was kept from the people's). `office` is the one he would take.
 */
export function priestlyTaboo(world: SeatsView, office: { readonly id: string; readonly kind?: string | undefined }, character: { readonly id: string; readonly name: string }): string | null {
  if (FLAMEN_DIALIS.test(office.id) || REX_SACRORUM.test(office.id)) return null;
  if (holdsOfficeLike(world, character.id, FLAMEN_DIALIS)) return `${character.name} is the flamen of Jupiter, and may hold no other office.`;
  if (office.kind === "magistracy" && holdsOfficeLike(world, character.id, REX_SACRORUM)) return `${character.name} is the king of the rites, and may hold no magistracy.`;
  return null;
}

/** Why a man may not be given an army, in the words he is told: the flamen Dialis might not see one under arms. Null where he may. */
export function commandBar(world: SeatsView, character: { readonly id: string; readonly name: string }): string | null {
  return holdsOfficeLike(world, character.id, FLAMEN_DIALIS) ? `${character.name} is the flamen of Jupiter, who may not see an army under arms, still less lead one.` : null;
}

/** Why a man may not take a priesthood of the old rites, in the words he is told; null where he may. */
export function priestlyBar(office: { readonly id: string; readonly label?: string | undefined }, character: { readonly name: string; readonly ordo?: "patrician" | "plebeian" | undefined; readonly gender?: "male" | "female" | undefined }): string | null {
  if (!PATRICIAN_ONLY_OFFICE.test(`${office.id} ${office.label ?? ""}`)) return null;
  return character.ordo === "patrician" ? null : `${character.name} cannot hold it: the old rites were kept by patricians by birth.`;
}
