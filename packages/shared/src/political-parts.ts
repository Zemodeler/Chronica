import { z } from "zod";

/**
 * The closed vocabulary a constitution is made of.
 *
 * Kept in a file of its own, importing nothing but zod, because material
 * state (the chambers and their blocs) and the world (the constitution record)
 * both need it and neither may import the other.
 *
 * A form is a seed and never a switch. Nothing in the engine asks "is this a
 * monarchy?": it asks whether a ruler's seat passes by blood, which chamber
 * may change the constitution, who sits in it. The form is read back from
 * those parts (`sim/constitutions.ts`), so a monarchy that gave its council
 * the power of the purse is a little less of one, and says so.
 */
export const GovernmentFormSchema = z.enum([
  "monarchy",
  "oligarchic_republic",
  "popular_republic",
  "tribal_confederation",
  "soldier_commune",
  "league",
  "temple_state",
  // Named, so a model's schema writes the list once (see `AgreementKind`).
]).meta({ id: "GovernmentForm" });
export type GovernmentForm = z.infer<typeof GovernmentFormSchema>;

/**
 * How long a commander holds his army, and what ends it -- a part of a
 * constitution like any other.
 *
 * - `annual_prorogable`: a magistrate commands for his year; the chamber may
 *   extend it (prorogation), else his successor takes the army when he
 *   reaches it. Rome.
 * - `annual_no_iteration`: a year, never extended, and not twice running. The
 *   Achaean League's general.
 * - `at_pleasure`: as long as the ruler wants him. A king's general.
 * - `indefinite_answerable`: as long as the war needs him, and he answers for
 *   it before a court when it goes wrong. Carthage, and its Hundred and Four.
 */
export const CommandTenureSchema = z.enum(["annual_prorogable", "annual_no_iteration", "at_pleasure", "indefinite_answerable"]).meta({ id: "CommandTenure" });
export type CommandTenure = z.infer<typeof CommandTenureSchema>;

/** A form's seed for how long its commanders command, where nothing more is said. */
export function defaultCommandTenure(form: GovernmentForm): CommandTenure {
  switch (form) {
    case "oligarchic_republic":
    case "popular_republic":
      return "annual_prorogable";
    case "league":
      return "annual_no_iteration";
    default:
      return "at_pleasure";
  }
}

export const COMMAND_TENURE_IN_WORDS: Record<CommandTenure, string> = {
  annual_prorogable: "a commander holds his army for his year of office; the chamber may extend it, and otherwise his successor takes it over when he arrives",
  annual_no_iteration: "a commander holds his army for one year, never extended, and may not hold it two years running",
  at_pleasure: "a commander holds his army for as long as the ruler wishes",
  indefinite_answerable: "a commander holds his army for as long as the war needs him, and answers for defeat before a court",
};

export const GOVERNMENT_FORM_IN_WORDS: Record<GovernmentForm, string> = {
  monarchy: "a monarchy",
  oligarchic_republic: "a republic of the great houses",
  popular_republic: "a republic of its citizens",
  tribal_confederation: "a confederation of tribes",
  soldier_commune: "a commune of soldiers",
  league: "a league of cities",
  temple_state: "a state ruled from its temple",
};

/**
 * What a chamber may decide. A question outside its powers is not its to
 * count -- a council of elders that may not make war is asked, and the answer
 * binds nobody.
 *
 * - `laws`: measures that go on doing something, and offices made or reformed.
 * - `war`: war and peace, treaties, and levies.
 * - `taxes`: what is raised and what is spent.
 * - `elections`: it fills the offices its succession rules name it for.
 * - `constitution`: it may change the constitution itself.
 * - `judgment`: trials, removals, condemnations.
 */
export const ChamberPowerSchema = z.enum(["laws", "war", "taxes", "elections", "constitution", "judgment"]);
export type ChamberPower = z.infer<typeof ChamberPowerSchema>;
export const ALL_CHAMBER_POWERS: readonly ChamberPower[] = ChamberPowerSchema.options;

/**
 * Who sits in a chamber, and so which of the world's groups can have a bloc
 * in it. A soldiers' assembly has no room for merchants; a council of elders
 * has none for debtors.
 */
export const FranchiseSchema = z.enum(["council", "citizens", "soldiers", "chiefs", "cities", "priests"]);
export type Franchise = z.infer<typeof FranchiseSchema>;

/**
 * What a bloc wants. A bloc may want several things; its lean on a question
 * is the average of how each of them meets it.
 *
 * `faction`, `clients` and `loyalists` want whatever their leader wants: they
 * have no row in the table below, and lean by his declared word instead.
 */
export const BlocInterestSchema = z.enum([
  "nobles",
  "landed",
  "merchants",
  "commons",
  "debtors",
  "creditors",
  "soldiers",
  "veterans",
  "priests",
  "conquered",
  "regional",
  "crown",
  "faction",
  "clients",
  "loyalists",
  "war_weary",
]);
export type BlocInterest = z.infer<typeof BlocInterestSchema>;

/**
 * What a question is about. Derived by the engine from what the measure
 * enacts and what it is called; the model may add to it, never take away.
 */
export const QuestionConcernSchema = z.enum([
  "war",
  "peace",
  "taxes",
  "spending",
  "land",
  "debt",
  "trade",
  "religion",
  "levy",
  "grain",
  "widen_franchise",
  "narrow_franchise",
  "strengthen_ruler",
  "weaken_ruler",
  "new_office",
  "punishment",
]);
export type QuestionConcern = z.infer<typeof QuestionConcernSchema>;

type Row = Partial<Record<QuestionConcern, number>>;

/**
 * How each interest meets each concern, from -80 (against it with everything
 * it has) to +80. "land" is land for those without it -- allotments,
 * colonies, redistribution -- which is why the landed hate it; "debt" is
 * relief of debt, which is why creditors do.
 *
 * Absent means indifferent. The numbers are in the same units as a bloc's
 * `baseSupport` and its thresholds, so a bloc of +20 disposition that meets a
 * question it hates at -50 ends at -30 and votes against it.
 */
export const INTEREST_CONCERN: Readonly<Record<BlocInterest, Row>> = {
  nobles: { war: 10, peace: -5, taxes: -20, land: -40, debt: -30, grain: -10, widen_franchise: -40, narrow_franchise: 30, strengthen_ruler: -30, weaken_ruler: 20, new_office: 5 },
  landed: { war: -5, peace: 10, taxes: -30, land: -60, debt: -20, levy: -15, grain: -20, widen_franchise: -20 },
  merchants: { war: -25, peace: 25, trade: 50, taxes: -25, debt: -40, spending: 10, levy: -10, widen_franchise: 10, strengthen_ruler: -10 },
  commons: { war: -10, peace: 10, taxes: -30, land: 50, debt: 40, grain: 50, levy: -25, religion: 10, widen_franchise: 50, narrow_franchise: -50, strengthen_ruler: 10, weaken_ruler: -5, punishment: 10 },
  debtors: { debt: 80, land: 40, taxes: -30, grain: 30, widen_franchise: 20, war: -10 },
  creditors: { debt: -80, trade: 20, taxes: -10 },
  soldiers: { war: 40, peace: -20, levy: 10, spending: 30, land: 30, strengthen_ruler: 15, punishment: -10 },
  veterans: { land: 60, war: 10, spending: 20, debt: 20, levy: -10, widen_franchise: 10 },
  priests: { religion: 60, war: -5, taxes: -10, strengthen_ruler: 5 },
  conquered: { taxes: -40, levy: -40, war: -20, widen_franchise: 40, narrow_franchise: -40, weaken_ruler: 20, punishment: -20 },
  regional: { taxes: -30, levy: -30, war: -10, spending: 10, strengthen_ruler: -40, weaken_ruler: 30 },
  crown: { strengthen_ruler: 60, weaken_ruler: -60, taxes: 20, war: 10, levy: 10, narrow_franchise: 10, widen_franchise: -10 },
  faction: {},
  clients: {},
  loyalists: { strengthen_ruler: 40, weaken_ruler: -30 },
  // A city tired of its war: for any end to it, and against whatever feeds it.
  war_weary: { peace: 70, war: -70, levy: -30, taxes: -15, spending: -10 },
};

/** Interests that lean by their leader's word rather than by the table. */
export const FOLLOWING_INTERESTS: ReadonlySet<BlocInterest> = new Set(["faction", "clients", "loyalists"]);

/** How far a following bloc moves with its leader's declared word. */
export const FOLLOWING_SHIFT = 50;

/**
 * How a bloc with these interests meets a question with these concerns: the
 * sum over concerns of each interest's view, averaged over its interests.
 * A bloc that wants two things weighs both; a question about two things adds
 * them.
 */
export function interestLean(interests: readonly BlocInterest[], concerns: readonly QuestionConcern[]): number {
  const counted = interests.filter((interest) => !FOLLOWING_INTERESTS.has(interest) || interest === "loyalists");
  if (counted.length === 0 || concerns.length === 0) return 0;
  const total = counted.reduce((sum, interest) => sum + concerns.reduce((inner, concern) => inner + (INTEREST_CONCERN[interest][concern] ?? 0), 0), 0);
  return Math.round(total / counted.length);
}

export const CONCERN_IN_WORDS: Record<QuestionConcern, string> = {
  war: "war",
  peace: "peace",
  taxes: "taxes",
  spending: "public spending",
  land: "land for the landless",
  debt: "relief of debt",
  trade: "trade",
  religion: "the gods",
  levy: "the levy",
  grain: "grain for the people",
  widen_franchise: "widening who has a voice",
  narrow_franchise: "narrowing who has a voice",
  strengthen_ruler: "strengthening the ruler",
  weaken_ruler: "weakening the ruler",
  new_office: "a new office",
  punishment: "a punishment",
};

export const INTEREST_IN_WORDS: Record<BlocInterest, string> = {
  nobles: "the nobility",
  landed: "the landowners",
  merchants: "the merchants",
  commons: "the common people",
  debtors: "the debtors",
  creditors: "the creditors",
  soldiers: "the soldiers",
  veterans: "the veterans",
  priests: "the priests",
  conquered: "the conquered",
  regional: "its own district",
  crown: "the crown",
  faction: "its leader",
  clients: "its patron",
  loyalists: "the fallen government",
  war_weary: "an end to the war",
};
