import { z } from "zod";
import {
  AuthorityDomainSchema,
  AuthorityPowerSchema,
  AuthorityScopeSchema,
  AuthoritySourceSchema,
  AuthorityStandingSchema,
  type AuthorityDomain,
} from "../authority/vocabulary";
import { CharacterIntentActionTypeSchema } from "../characters/intents";
import { CharacterPressureKindSchema } from "../characters/pressures";
import { CharacterSocialEventKindSchema } from "../characters/social-events";
import { FamilyLinkKindSchema } from "../characters/family";
import { SkillBandSchema } from "../characters/skill-bands";
import { STANDING_CAUSES } from "../characters/standing-causes";
import { RelationDimensionScoresSchema } from "../characters/character";
import {
  BasisPointsSchema,
  EntityIdSchema,
  MaybeIdSchema,
  MoneyAmountSchema,
  OfficeSeatVacancyCauseSchema,
  PoliticalProcedureSubjectKindSchema,
  PoliticalProcedureTypeSchema,
  PoliticalResolutionMechanismSchema,
  SignedScoreSchema,
  SupportPositionChoiceSchema,
  SupportPositionKindSchema,
  SupportReasonKindSchema,
  VisibilitySchema,
} from "../material-state";
import { PolityAgreementKindSchema } from "../world/agreements";
import { ContingencyEffectSchema } from "../world/contingency";
import { CovertPlotKindSchema } from "../world/covert-plot";
import { WatchPredicateSchema } from "../world/watch";
import { TacticalPremiseSchema } from "../warfare/tactical-modifier";
import { EffectBandSchema, StandingEffectSchema } from "../world/standing-effects";
import { StandardLeverSchema } from "../world/departments";
import { StructureKindSchema } from "../world/structure";
import { PositionTypeSchema } from "../world/map";
import { DiplomaticAnswerSchema, DiplomaticMessageKindSchema } from "../world/diplomacy";
import { OrderPartyRefSchema } from "../world/party-ref";
import { StorylinePhaseSchema } from "../world/storylines";
import { LocalIdSchema, MaybeRefSchema, RefSchema } from "./refs";
import { ChamberPowerSchema, FranchiseSchema, GovernmentFormSchema, QuestionConcernSchema } from "../political-parts";

/**
 * Every way the model is allowed to change the world.
 *
 * This union is the whole of "the AI is sovereign over causality, software is
 * sovereign over arithmetic" (VISION §3). The model decides *what* changes and
 * by how much; each arm carries only the judgment, and the engine supplies
 * every id, timestamp, and derived field. Nothing outside this union can reach
 * `WorldState`.
 *
 * The union is deliberately small. Its predecessor gave the model ~97 bespoke
 * workflow tools and still could not keep the books straight (see
 * docs/plans/delete-chronicle-orders-turns.md); the lesson taken here is that a
 * narrow closed set plus one honest escape hatch (`generic_entity_create`,
 * VISION §9) covers more than a wide one, because every arm can actually be
 * validated.
 *
 * Time is always expressed as an offset in days from the current instant, never
 * as an absolute date: date arithmetic is the engine's job, and a model asked
 * to do it will eventually schedule something in the past.
 */

const ReasonSchema = z.string().trim().min(1).max(300).meta({ id: "Reason" });
/**
 * A sum of money. Named once for the reason `Ref` is: written out, it was the
 * same forty characters of bounds a dozen times over in every prompt.
 */
const MoneySchema = MoneyAmountSchema.meta({ id: "Money" });
/** A length of time in days, at least one: a term, a cadence, a wait. */
const DaysSchema = z.number().int().positive().max(36_600).meta({ id: "Days" });
/** A name or a short label: a person, a place, a thing. */
const NameSchema = z.string().trim().min(1).max(120).meta({ id: "Name" });
/** A short label, as somebody would say it: 160 characters. Named, as `Name` is. */
const TitleSchema = z.string().trim().min(1).max(160).meta({ id: "Title" });
/** A sentence of it: 200 characters. */
const LabelSchema = z.string().trim().min(1).max(200).meta({ id: "Label" });
/** A change in basis points, either way: morale, stability, health. Named once, for the same reason. */
const SignedBpsSchema = z.number().int().min(-10_000).max(10_000).meta({ id: "SignedBps" });

const DayOffsetSchema = z.number().int().min(0).max(36_600).meta({ id: "DayOffset" });

/**
 * Who pays to keep a made thing going, and roughly how much. The engine sizes
 * the sum to the province, and stops the thing when the money stops.
 */
const UpkeepRefSchema = z.object({ fromAccountRef: RefSchema, band: EffectBandSchema }).strict().meta({ id: "Upkeep" });

/** Money moving between accounts. `toAccountRef: null` is money genuinely leaving the modelled world (a foreign shipwright, a bribe abroad). */
const MoneyTransferSchema = z.object({
  op: z.literal("money_transfer"),
  fromAccountRef: RefSchema,
  toAccountRef: MaybeRefSchema,
  amount: MoneySchema,
  reason: ReasonSchema,
}).strict();

/** VISION §7: once the AI judges a tax reform worth +21/month, that becomes persistent state, not a one-off. */
const IncomeSourceUpsertSchema = z.object({
  op: z.literal("income_source_upsert"),
  localId: LocalIdSchema.optional(),
  incomeSourceRef: MaybeRefSchema,
  kind: z.enum(["land", "office", "trade", "pension", "tax"]),
  label: NameSchema,
  beneficiaryAccountRef: RefSchema,
  amount: MoneySchema,
  cadenceDays: DaysSchema,
  collectionRateBps: BasisPointsSchema.optional(),
  /**
   * The *other* power this revenue depends on, so a war can cut this route.
   * Null for anything raised at home -- a tax on your own citizens depends on
   * nobody abroad and naming yourself here says nothing.
   */
  counterpartyPolityId: MaybeIdSchema.default(null),
  active: z.boolean().default(true),
  reason: ReasonSchema,
}).strict();

/** The recurring cost side of the same coin -- army pay, upkeep, debt service. */
const ObligationUpsertSchema = z.object({
  op: z.literal("obligation_upsert"),
  localId: LocalIdSchema.optional(),
  obligationRef: MaybeRefSchema,
  kind: z.enum(["army_pay", "army_upkeep", "salary", "tribute", "pension", "debt_service"]),
  label: NameSchema,
  payerAccountRef: RefSchema,
  recipientAccountRef: MaybeRefSchema,
  amount: MoneySchema,
  cadenceDays: DaysSchema,
  priority: z.number().int().min(0).max(1000).default(500),
  active: z.boolean().default(true),
  reason: ReasonSchema,
}).strict();

/**
 * One stage of a project, and what it costs when it falls due.
 *
 * `.strict()`, and the one place in the vocabulary where strictness is worth
 * a whole delta: the obvious misspelling is `cost`, an unknown key was
 * stripped in silence, and the milestone then fell due for nothing. A
 * fortress, a fleet and four months of mercenary pay all came free, with no
 * refusal, no friction, and nothing in the record to say the treasury had been
 * spared. Better to lose the delta and be told than to keep it and be lied to.
 */
const ProjectStageSchema = z.object({
  label: TitleSchema,
  dueInDays: DayOffsetSchema,
  costAmount: MoneySchema.default(0),
}).strict().meta({ id: "ProjectStage" });

/**
 * What exists when the last milestone falls. A naval expansion that completes
 * and produces no ships has not happened. Omit it only for an effort whose
 * whole product is that it took place.
 */
const ProjectOutcomeSchema = z
  .object({
    kind: z.enum(["force", "structure", "income_source", "force_move", "agreement", "transfer", "none"]),
    label: TitleSchema,
    /** Men for a force, garrison capacity for a structure, revenue per period for an income source, the sum handed over for a transfer. */
    amount: z.number().int().nonnegative().max(10_000_000).default(0),
    provinceId: MaybeIdSchema.default(null),
    polityId: MaybeIdSchema.default(null),
    commanderCharacterRef: MaybeRefSchema.default(null),
    /** For "force_move": the army that arrives at "provinceId" when the journey ends. */
    forceRef: MaybeRefSchema.default(null),
    /** For "force": what kind of troops, "warship" for hulls. A fleet built as infantry is no fleet. */
    categoryId: EntityIdSchema.optional(),
    /**
     * For "agreement": what the two powers end up standing in, and who they
     * are. An embassy that arrives, is heard, and produces nothing has not
     * happened -- "a protector for Messana was secured" with nobody named as
     * the protector is a project reporting itself complete while leaving the
     * world exactly as it was.
     */
    agreementKind: PolityAgreementKindSchema.nullable().default(null),
    withPolityId: MaybeIdSchema.default(null),
    beneficiaryAccountRef: MaybeRefSchema.default(null),
    cadenceDays: DaysSchema.nullable().default(null),
    /** For "structure": what kind of building, what it goes on doing, and who pays its keep. */
    structureKind: StructureKindSchema.optional(),
    effects: z.array(StandingEffectSchema).max(6).optional(),
    upkeep: UpkeepRefSchema.nullable().optional(),
  })
  .strict()
  .meta({ id: "ProjectOutcome" });

/**
 * VISION §8: an overambitious order does not fail, it becomes a project with
 * friction. Milestones are what let §17's queue schedule four months of
 * recruitment without reasoning through four months.
 */
const ProjectCreateSchema = z.object({
  op: z.literal("project_create"),
  localId: LocalIdSchema,
  kind: z.string().trim().min(1).max(80),
  label: TitleSchema,
  sponsorRef: OrderPartyRefSchema,
  fundingAccountRef: MaybeRefSchema,
  milestones: z.array(ProjectStageSchema).min(1).max(20),
  completionOutcome: ProjectOutcomeSchema.nullable().default(null),
  reason: ReasonSchema,
}).strict();

const ProjectMilestoneUpdateSchema = z.object({
  op: z.literal("project_milestone_update"),
  projectRef: RefSchema,
  milestoneId: EntityIdSchema,
  status: z.enum(["completed", "skipped"]),
  reason: ReasonSchema,
}).strict();

const ForceCreateSchema = z.object({
  op: z.literal("force_create"),
  localId: LocalIdSchema,
  name: NameSchema,
  polityId: RefSchema,
  /** A band that answers to no power: only a private purse can raise one. "polityId" is where its men come from. */
  outlaw: z.boolean().optional(),
  commanderCharacterRef: RefSchema,
  controllerCharacterRef: RefSchema,
  locationId: EntityIdSchema,
  authorizedStrength: z.number().int().positive().max(1_000_000),
  /**
   * Who has undertaken to pay them, if anybody has. An obligation that already
   * stands, or one minted in this same answer -- "raise two legions and put
   * them on the treasury" is one order and should be one exchange.
   *
   * Null is a real answer and not a default to fall back on: a force nobody
   * has undertaken to pay is outside the arrears rules entirely, which is the
   * right reading of a warband and the wrong reading of a legion.
   */
  payObligationRef: MaybeRefSchema.default(null),
  /**
   * What kind of fighting men, or ships, they are: one of the scenario's troop
   * categories ("warship" for a vessel). Everything raised used to be infantry,
   * so a merchant fitting out a ship raised four hundred foot soldiers.
   */
  categoryId: EntityIdSchema.optional(),
  reason: ReasonSchema,
}).strict();

/**
 * Men lost to something other than a battle.
 *
 * Disease, storm, hunger and cold have always killed more soldiers than
 * fighting has, and until now the engine had no way to say so: `force_modify`
 * moves the *authorized* strength, which is the establishment on paper, while
 * the men who are actually there live in `personnel`. Only a battle, and
 * desertion over unpaid wages, ever touched those -- so a plague in a camp
 * could lower morale and change nothing about how many men stood up
 * afterwards. `attrition_death` has been a personnel-event kind since the
 * force model was written and nothing has ever produced one.
 *
 * The loss is a *share*, not a count, for the reason every other delta states
 * a change rather than a total: the author says "one in twenty", and the
 * engine works out what that is of the men actually present. It is also the
 * guard against a thousand casualties in a force of four hundred.
 *
 * This is not the battle rule being relaxed. Casualties in a fight stay the
 * engine's alone because there is an enemy there to be favoured; a storm has
 * nobody's side to take.
 */
const ForceAttritionSchema = z.object({
  op: z.literal("force_attrition"),
  forceRef: RefSchema,
  cause: z.enum(["sickness", "storm", "starvation", "exposure", "desertion"]),
  /** Of the men still fit, the share this takes, in basis points. 500 is one in twenty. */
  lossBps: z.number().int().min(1).max(6_000),
  moraleBpsDelta: z.number().int().min(-10_000).max(0).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * Men joining an army that already exists.
 *
 * `"reinforcement"` has been a personnel-event kind since the force model was
 * written and nothing has ever produced one -- the exact position
 * `attrition_death` was in before `force_attrition` was added. An army could
 * lose men four ways and gain them in none: a legion that left half its
 * strength at Agrigentum could never be brought back up to it, and "take the
 * Gauls into the Thirteenth as auxiliaries" had no expression at all.
 * `force_modify.authorizedStrengthDelta` is not it and says so -- that moves
 * the establishment on paper, while the men who are actually there live in
 * `personnel`.
 *
 * A named category, because auxiliaries are not legionaries. Gallic horse
 * taken into a Roman army stays Gallic horse: the resolver reads categories
 * for their combat weight, steadiness and mobility, and dissolving them into
 * the line would make a cavalry wing fight like a maniple.
 */
const ForceReinforceSchema = z.object({
  op: z.literal("force_reinforce"),
  forceRef: RefSchema,
  /**
   * The kind of troops these are.
   *
   * A category the world does not yet know is *minted*, not refused. It used to
   * be refused, on the grounds that the resolver had no numbers for it -- but
   * the resolver's own fallback has always fought an unknown category as an
   * ordinary levy, so the refusal bought nothing and cost the order. "Take the
   * Carthaginian elephants into the legion" is a thing that happened in this
   * war, and a scenario's list is where a world's armies start rather than all
   * they may ever contain.
   */
  categoryId: EntityIdSchema,
  /**
   * What sort of troops they are, where the world is inventing the kind.
   *
   * Read only when `categoryId` names something that does not exist yet, and
   * ignored entirely otherwise: the character of horse is not the next man's
   * to rewrite because he happens to be recruiting some. Bands rather than
   * numbers, for the reason `character_create.wealth` is banded by standing --
   * the judgment is the world's and the arithmetic is the engine's, and a
   * model allowed to set combat weight directly would set it high.
   */
  newCategory: z
    .object({
      label: z.string().trim().min(1).max(80),
      /** What one of them is worth in a stand-up fight. Never more than an ordinary soldier of the period. */
      weightBand: z.enum(["light", "standard", "heavy"]).default("standard"),
      /** How they hold when it goes badly. Elephants and levies are brittle; veterans are stubborn. */
      steadinessBand: z.enum(["brittle", "standard", "stubborn"]).default("standard"),
      /** How fast they move, which decides pursuit and escape. */
      mobilityBand: z.enum(["slow", "standard", "fast"]).default("standard"),
      /** Whether they fight and travel on water. Hulls carry men; how many is the engine's figure. */
      naval: z.boolean().default(false),
    })
    .strict()
    .nullable()
    .optional(),
  /** What this body of men is called, where it is worth saying. */
  label: z.string().trim().min(1).max(80),
  men: z.number().int().positive().max(1_000_000),
  /**
   * Where they came from, when they came from an army rather than a levy.
   * Taking them out of that force is the whole of what "integrate them" means,
   * and leaving it standing at its old strength would double the men.
   */
  fromForceRef: MaybeRefSchema.default(null),
  reason: ReasonSchema,
}).strict();

/**
 * A plan of battle: what the commander means to try, and what it rests on.
 *
 * `restsOn` is what the plan depends on. The engine checks each against the
 * field: nothing true there and the plan is refused, one thing true and it is
 * worth a little, two or more and it is worth what was asked. See
 * `TacticalPremiseSchema`. Named once, because an attack and a standing plan
 * are the same thing said at different times.
 */
const BattlePlanSchema = z
  .object({
    factor: z.enum(["deployment", "surprise", "effective_strength", "cohesion", "morale", "withdrawal"]),
    magnitude: z.enum(["minor", "meaningful"]),
    rationale: z.string().trim().min(1).max(600),
    restsOn: z.array(TacticalPremiseSchema).max(6).optional(),
  })
  .strict()
  .meta({ id: "BattlePlan" });

const ForceModifySchema = z.object({
  op: z.literal("force_modify"),
  forceRef: RefSchema,
  /** Gone outlaw -- a garrison turned pirate -- or come back under a power. */
  outlaw: z.boolean().optional(),
  /**
   * What it is called now.
   *
   * "Rename the Roman field army to Legio I" is about as plain an order as a
   * commander can give, and there was no field in the whole vocabulary that
   * could carry it: a force's name was fixed at creation for the life of the
   * world. An army is renamed when it is reorganised, when it is numbered,
   * when a new consul takes it over, and when its old name becomes an
   * embarrassment.
   */
  name: NameSchema.optional(),
  /**
   * The banner it now carries. Set by the player's own hand from the map, where
   * the catalogue is; anything else writing it names a banner the client may
   * not have, and the force then shows its power's first.
   */
  standardId: EntityIdSchema.optional(),
  locationId: EntityIdSchema.optional(),
  /**
   * Where in that province they actually stand.
   *
   * `Force.positionId` has existed since the force model was written and the
   * battle resolver has always read it -- a pass is worth holding, a coast is
   * a bad place to be caught -- and nothing in the whole vocabulary could set
   * it. So the Punic Wars scenario authored Mount Etna as a pass worth seven
   * hundred basis points, a player spent a campaign fortifying it, and every
   * order about it resolved as "somewhere in north-eastern Sicily".
   *
   * A position this province does not have yet is made, not refused (see
   * `newPosition`): "camp above the ford" names a real place whether or not a
   * cartographer wrote it down. Cleared automatically when the force moves,
   * because a position belongs to the ground and the ground has changed.
   */
  positionId: MaybeIdSchema.optional(),
  /**
   * What sort of place it is, where the world is naming one that has no record
   * yet. Read only when `positionId` matches nothing, ignored otherwise.
   *
   * The engine decides what a pass or a siege line is worth to the men holding
   * it; the world only says which of them this is. A caller who could set the
   * modifier directly could fortify his way to a battle nobody could lose.
   */
  newPosition: z
    .object({
      label: NameSchema,
      type: PositionTypeSchema.default("camp"),
    })
    .strict()
    .nullable()
    .optional(),
  commanderCharacterRef: RefSchema.optional(),
  /**
   * Who answers for it, as against who leads it in the field. A consul keeps
   * control of an army he hands to a legate, and that distinction is the whole
   * reason `controllerCharacterId` is a separate field from the commander.
   */
  controllerCharacterRef: RefSchema.optional(),
  authorizedStrengthDelta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  moraleBpsDelta: SignedBpsSchema.optional(),
  /**
   * How well they hold together, and how spent they are.
   *
   * Only morale could be moved, so "rest the army" and "let them drill through
   * the winter" changed the men's spirits and left them as ragged and as tired
   * as they were -- and the resolver reads all three. An order to recover is
   * one of the commonest a commander gives and it could not be carried out.
   */
  cohesionBpsDelta: SignedBpsSchema.optional(),
  fatigueBpsDelta: SignedBpsSchema.optional(),
  provisionStatus: z.enum(["provisioned", "shortage", "critical"]).optional(),
  /** How long they are victualled for from today. "Supply them through the winter" is 90. */
  provisionedForDays: z.number().int().min(0).max(3_650).optional(),
  /**
   * Which power they answer to now.
   *
   * An army changes sides, is handed over by treaty, or is raised by one power
   * and given to another. None of it could be said, so a legion was the
   * property of whoever raised it for the life of the world.
   */
  polityId: RefSchema.optional(),
  /**
   * Who pays them now. Omit to leave the arrangement alone; null to cut them
   * loose from whoever was paying.
   *
   * Until this existed nothing in the whole vocabulary could write
   * `Force.payObligationId`: a scenario could author who paid an army and no
   * order could ever change it, so "put the legions on the treasury", "these
   * men are Carthage's to pay now" and "they will be paid out of what they
   * take" were all sayable, all convincingly narrated, and all inert.
   */
  payObligationRef: MaybeRefSchema.optional(),
  /**
   * How this army means to fight when it is next brought to battle, whoever
   * attacks. Null drops it.
   *
   * A plan could only be carried by the attack, so the side that was attacked
   * never had one: a consul who had spent a month fortifying a ford and
   * waiting for the Carthaginians to cross it fought them exactly as a camp
   * surprised in its sleep would. The plan is judged on the day, against the
   * field as it then stands, exactly as an attacker's is.
   */
  battlePlan: BattlePlanSchema.nullable().optional(),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §5: the world generates the official it needs and keeps him forever.
 * Only the judgment is here -- the engine builds the canonical `Character`.
 */
const CharacterCreateSchema = z.object({
  op: z.literal("character_create"),
  localId: LocalIdSchema,
  name: NameSchema,
  /**
   * A power that exists, or one created in this same answer.
   *
   * `polity_create` mints a power against a `localId` so that a rising can
   * become a country -- and every field that named a power took a raw id, so
   * nothing could be said about that country in the breath that made it. A
   * secession could declare itself and then not be given a leader, an army, a
   * war, a letter or an opinion until the next turn, which the player never
   * took. `RefSchema` accepts a plain id exactly as before, so nothing that
   * worked stops working.
   */
  polityId: RefSchema,
  provinceId: MaybeIdSchema,
  age: z.number().int().min(0).max(120),
  /**
   * What they are made, if they are made anything: "Military Quaestor",
   * "Prefect of the Fleet", "chief of the Boii". Where no such office exists
   * yet, the engine creates it -- a government invents offices constantly, and
   * the scenario's list is where one starts rather than all there may be.
   */
  officeLabel: z.string().trim().max(120).nullable(),
  /**
   * What that office lets its holder do, named in the same vocabulary the world
   * changes in. Only consulted when the office has to be created: an office
   * that authorises nothing is a title, which is a real thing to be, and the
   * powers of one that already exists are not the new holder's to rewrite.
   */
  officeAuthorises: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  traits: z.array(z.string().trim().min(1).max(60)).max(8),
  /**
   * What sort of person they are, in the world's own words: "a merchant of
   * Ostia", "senatorial", "a common soldier". What they are worth is bounded
   * by this, so a merchant invented to lend the state money cannot be worth
   * four coins and a ranker cannot be worth a senator's fortune.
   */
  standing: z.string().trim().max(120).nullable().default(null),
  /**
   * What they are worth, in their own purse.
   *
   * A merchant generated to lend the state money had nothing to lend with, so
   * the loan was refused by the very person invented to make it. Wealth is part
   * of who someone is, and the world decides it when it decides they exist.
   *
   * Clamped to `standing`'s band on the way in -- clamped, never rejected, so
   * the world's judgment inside a band still counts.
   */
  wealth: MoneySchema.default(0),
  /** A woman -- a Vestal, a matron, a queen -- or a man, who is what is assumed. */
  gender: z.enum(["male", "female"]).optional(),
  /** A slave belongs to the one who acts, a freedman is his patron's. Free is what is assumed. */
  legalStatus: z.enum(["free", "freed", "enslaved"]).optional(),
  /**
   * How good they are at things, in words; the engine sets the numbers.
   *
   * Everyone the world made was given the same skills: martial 35. So the world
   * could create Antigonus Gonatas, who had beaten the Gauls at Lysimachia, and
   * he would take the field as a worse general than any consul in the
   * scenario. Bands and not numbers for the reason troop categories are banded
   * -- a model allowed to write a number would write it high for its friends.
   */
  skills: z
    .object({ martial: SkillBandSchema.optional(), diplomacy: SkillBandSchema.optional() })
    .strict()
    .nullable()
    .optional(),
  /**
   * Whose kin they are, where that is why they exist: the Egyptian wife, the
   * hostage son, the heir. `relation` reads from the new person's side -- a
   * wife is `spouse_or_partner` of her husband, a son is `child` of his father.
   */
  kin: z
    .object({ ofCharacterRef: RefSchema, relation: FamilyLinkKindSchema })
    .strict()
    .nullable()
    .optional(),
  /** What they believe, by name. A faith nobody has heard of is founded, with them as its founder. */
  faith: NameSchema.optional(),
  /** VISION §5 keeps the reason a generated person exists, because it is often why they matter later. */
  generatedBecause: ReasonSchema,
  /**
   * Tolerated, and otherwise ignored.
   *
   * Thirty-seven of the forty ops take a `reason`, and this one says the same
   * thing under its own name. `.strict()` made the habit fatal: an answer that
   * wrote `reason` here alongside everything else lost the whole delta at
   * parse time, silently, before any repair could see it -- and a model that
   * has written `reason` thirty-seven times will write it the thirty-eighth.
   * Accepting it costs nothing and stops the drop.
   */
  reason: ReasonSchema.optional(),
}).strict();

const CharacterIntentSetSchema = z.object({
  op: z.literal("character_intent_set"),
  actorCharacterRef: RefSchema,
  actionType: CharacterIntentActionTypeSchema,
  targetRefs: z.array(RefSchema).max(8).default([]),
  rationale: z.string().trim().min(1).max(400),
  priority: z.number().int().min(0).max(100).default(50),
  visibility: VisibilitySchema.default("private"),
  /**
   * Tolerated, and otherwise ignored.
   *
   * Thirty-seven of the forty ops take a `reason`, and this one says the same
   * thing under its own name. `.strict()` made the habit fatal: an answer that
   * wrote `reason` here alongside everything else lost the whole delta at
   * parse time, silently, before any repair could see it -- and a model that
   * has written `reason` thirty-seven times will write it the thirty-eighth.
   * Accepting it costs nothing and stops the drop.
   */
  reason: ReasonSchema.optional(),
}).strict();

/**
 * Relationship, belief, pressure and commitment change, routed through the
 * character system's own `applySocialEvents` rather than a second mechanism.
 * The engine completes each draft into a `CharacterSocialEvent`.
 */
const SocialEventsSchema = z.object({
  op: z.literal("social_events"),
  events: z
    .array(
      z.object({
        /** Two at least: a social event with one participant is not one, and an encounter with one fails validation. */
        participantCharacterRefs: z.array(RefSchema).min(2).max(16),
        kind: CharacterSocialEventKindSchema,
        visibility: VisibilitySchema,
        summary: ReasonSchema,
        /**
         * What this did to how they see each other.
         *
         * The arm existed and always passed an empty list, so a social event
         * changed nobody's opinion of anybody -- the one thing a social event
         * is for. Each entry is one person's directed view of another, bounded
         * to ±20, with the dimensions it moves.
         */
        relationCauses: z
          .array(
            z.object({
              subjectCharacterRef: RefSchema,
              targetCharacterRef: RefSchema,
              label: LabelSchema,
              score: z.number().int().min(-20).max(20),
              /** How much of it fades a year. Zero is permanent, which is the point of the field. */
              decayPerYearBps: z.number().int().min(0).max(10_000).default(2_000),
              dimensions: RelationDimensionScoresSchema.optional(),
            }).strict(),
          )
          .max(8)
          .default([]),
        /**
         * What somebody there now thinks somebody else is like.
         *
         * Traits were written once, at creation, and never again -- a man
         * declared cautious stayed cautious however boldly he played. Two
         * different people have to say the same thing before it becomes who
         * he is; one is an opinion on the record.
         */
        observedTraits: z
          .array(
            z.object({
              subjectCharacterRef: RefSchema,
              observerCharacterRef: RefSchema,
              /** One of the engine's trait ids. Anything else is a word it does not have. */
              traitId: z.string().trim().min(1).max(60),
              note: LabelSchema,
            }).strict(),
          )
          .max(4)
          .default([]),
      }),
    )
    .min(1)
    .max(8),
  /**
   * Tolerated, and otherwise ignored.
   *
   * Thirty-seven of the forty ops take a `reason`, and this one says the same
   * thing under its own name. `.strict()` made the habit fatal: an answer that
   * wrote `reason` here alongside everything else lost the whole delta at
   * parse time, silently, before any repair could see it -- and a model that
   * has written `reason` thirty-seven times will write it the thirty-eighth.
   * Accepting it costs nothing and stops the drop.
   */
  reason: ReasonSchema.optional(),
}).strict();

/** VISION §9's escape hatch: a novel institution no typed schema fits, recorded rather than invented in place. */
const GenericEntityCreateSchema = z.object({
  op: z.literal("generic_entity_create"),
  localId: LocalIdSchema,
  kind: z.string().trim().min(1).max(80),
  label: TitleSchema,
  ownerRef: OrderPartyRefSchema.nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** Where it stands, if anywhere: a church's seat, a school's town. */
  provinceId: MaybeIdSchema.optional(),
  /** What it goes on doing, every month, while it is paid for (see `world/standing-effects.ts`). */
  effects: z.array(StandingEffectSchema).max(6).optional(),
  upkeep: UpkeepRefSchema.nullable().optional(),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §9: an arrangement the world invented goes on mattering.
 *
 * A generic entity used to be write-only -- created, never read, never changed.
 * A law whose recruitment pool is "expected to improve over several years" has
 * to be able to say how it is going, and to be retired when it is repealed.
 */
const GenericEntityUpdateSchema = z.object({
  op: z.literal("generic_entity_update"),
  entityRef: RefSchema,
  label: TitleSchema.optional(),
  /** Merged into what is already there. A null value removes that attribute. */
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** Repealed, dissolved, wound up. The record stays; it simply no longer applies. */
  retire: z.boolean().default(false),
  /** What it does now, replacing what it did. */
  effects: z.array(StandingEffectSchema).max(6).optional(),
  upkeep: UpkeepRefSchema.nullable().optional(),
  reason: ReasonSchema,
}).strict();

const AuthorityGrantUpsertSchema = z.object({
  op: z.literal("authority_grant_upsert"),
  localId: LocalIdSchema.optional(),
  grantRef: MaybeRefSchema,
  holder: OrderPartyRefSchema,
  source: AuthoritySourceSchema,
  domain: AuthorityDomainSchema,
  scope: AuthorityScopeSchema,
  powers: z.array(AuthorityPowerSchema).min(1),
  standing: AuthorityStandingSchema,
  expiresInDays: DayOffsetSchema.nullable().default(null),
  reason: ReasonSchema,
}).strict();

/** VISION §13: the delegate's own answer. `subvert` is reachable, and an unauthorized "accept" is recorded as one. */
const OrderAttemptDecideSchema = z.object({
  op: z.literal("order_attempt_decide"),
  orderAttemptRef: RefSchema,
  decision: z.enum(["accept", "delay", "refuse", "ignore", "subvert"]),
  reason: ReasonSchema,
}).strict();

const PolityStanceShiftSchema = z.object({
  op: z.literal("polity_stance_shift"),
  polityId: RefSchema,
  towardPolityId: RefSchema,
  trustDelta: SignedScoreSchema,
  reason: ReasonSchema,
}).strict();

/**
 * VISION §11: what a polity is trying to do, rewritten as circumstances change.
 * Upserted by polity -- a country has one outlook at a time, not a history of
 * them. Secret by construction: see `world/outlook.ts`.
 */
const PolityOutlookSetSchema = z.object({
  op: z.literal("polity_outlook_set"),
  polityId: RefSchema,
  primaryObjective: z.string().trim().min(1).max(240),
  concerns: z
    .array(z.object({ label: TitleSchema, level: z.enum(["low", "medium", "high"]) }).strict())
    .max(6)
    .default([]),
  intentions: z.array(LabelSchema).max(6).default([]),
  riskTolerance: z.number().int().min(0).max(100),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §6/§7: a measure with a political price has one.
 *
 * Legitimacy and institutional confidence were modelled from the start and
 * nothing could move them, so "double taxes on the wealthy" cost a government
 * nothing but a sentence. Basis points, because that is the unit the rest of the
 * political machinery already speaks.
 */
const LegitimacyShiftSchema = z.object({
  op: z.literal("legitimacy_shift"),
  target: z.enum(["polity", "institution"]),
  targetId: RefSchema,
  legitimacyBpsDelta: SignedBpsSchema,
  /** Only meaningful for a polity: how far the institutions themselves are still trusted. */
  institutionalConfidenceBpsDelta: SignedBpsSchema.optional(),
  causeLabel: TitleSchema,
  reason: ReasonSchema,
}).strict();

/**
 * VISION §6: the 18,400 available manpower, and everything else a province
 * actually consists of. Recruitment draws it down, war damages it, famine and
 * unrest move it -- all of which the engine could already compute and none of
 * which anything could ask for.
 */
const ProvinceMaterialShiftSchema = z.object({
  op: z.literal("province_material_shift"),
  provinceId: EntityIdSchema,
  availableManpowerDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  populationDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  stabilityBpsDelta: SignedBpsSchema.optional(),
  foodSecurityBpsDelta: SignedBpsSchema.optional(),
  productiveCapacityBpsDelta: SignedBpsSchema.optional(),
  warDamageBpsDelta: SignedBpsSchema.optional(),
  taxCapacityDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  displacedPopulationDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * What a measure does once it is carried.
 *
 * - `effects`/`upkeep`: a law that goes on doing something, every month, over
 *   the whole of the power's ground unless it says "here" -- the same closed
 *   verbs a building has, because a grain law and a granary do the same thing.
 * - `office`: an office reformed -- what it may do, how long it is held, how
 *   many hold it -- or abolished, or made.
 * - `body`: a council or assembly that did not exist, with one bloc of members
 *   to begin with.
 */
const EnactmentProposalSchema = z
  .object({
    effects: z.array(StandingEffectSchema).max(6).optional(),
    upkeep: UpkeepRefSchema.nullable().optional(),
    office: z
      .object({
        officeId: EntityIdSchema,
        /** What it is called, where it is being made. */
        officeLabel: NameSchema.nullable().optional(),
        /** What it may do now, in the vocabulary of the world's ops. Replaces what it did. */
        authorises: z.array(z.string().trim().min(1).max(60)).max(16).optional(),
        termDays: DaysSchema.nullable().optional(),
        /** How many hold it at once. */
        seats: z.number().int().min(1).max(12).optional(),
        abolish: z.boolean().default(false),
      })
      .strict()
      .optional(),
    body: z.object({ name: NameSchema }).strict().optional(),
    /**
     * A department: who is in charge of a piece of the state's work. Founding
     * one takes that work off whoever had it -- the ruler, or an older
     * department -- once it has had a month to organise. Name the levers it
     * holds; offices it names that do not exist are made, with an empty seat
     * each, and called what their ids say. What no lever says goes in "effects".
     */
    department: z
      .object({
        /** Absent founds a new one. */
        departmentRef: MaybeRefSchema.optional(),
        name: NameSchema.optional(),
        levers: z.array(StandardLeverSchema).optional(),
        headOfficeId: EntityIdSchema.optional(),
        officeIds: z.array(EntityIdSchema).optional(),
        deputyOfficeIds: z.array(EntityIdSchema).optional(),
        pay: z.enum(["honorary", "salaried"]).optional(),
        effects: z.array(StandingEffectSchema).max(4).optional(),
        abolish: z.boolean().default(false),
      })
      .strict()
      .optional(),
    /**
     * A work the measure pays for -- a fleet, a road, a levy -- begun the day
     * it passes. The Senate voted a fleet 119 to 0 and not a keel was laid,
     * because carrying it changed nothing.
     */
    project: z.object({
      kind: z.string().trim().min(1).max(80),
      label: TitleSchema,
      fundingAccountRef: MaybeRefSchema,
      milestones: z.array(ProjectStageSchema).min(1).max(20),
      completionOutcome: ProjectOutcomeSchema.nullable().default(null),
    }).strict().optional(),
    /** One man excused the ladder -- age, the rung below, the gap -- for one office, for a year. */
    waiver: z.object({ characterRef: RefSchema, officeId: EntityIdSchema }).strict().optional(),
    /**
     * The constitution changed: the whole form recast ("form"), one chamber
     * founded, reformed or abolished, or how one office is filled. Only the
     * chamber that holds the power over the constitution may carry it; where
     * none does, the ruler decrees it.
     */
    constitution: z
      .object({
        form: GovernmentFormSchema.optional(),
        chamber: z
          .object({
            /** Absent founds a new chamber. */
            institutionRef: MaybeRefSchema.optional(),
            name: NameSchema.optional(),
            powers: z.array(ChamberPowerSchema).max(6).optional(),
            advisory: z.boolean().optional(),
            franchise: FranchiseSchema.optional(),
            abolish: z.boolean().default(false),
          })
          .strict()
          .optional(),
        succession: z
          .object({
            officeId: EntityIdSchema,
            kind: z.enum(["primogeniture", "elective", "appointment", "seniority"]),
            /** The chamber that elects it, when elective. */
            institutionRef: MaybeRefSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .meta({ id: "Enactment" });

/**
 * VISION §6's "senate support 63/100", as the thing it actually is: a question
 * put to a body, with people taking sides on it.
 *
 * `PoliticalProcedure` deliberately does not assume a legislature -- a decree,
 * an appointment and a vote are all procedures, differing in how they resolve.
 */
const PoliticalProcedureOpenSchema = z.object({
  op: z.literal("political_procedure_open"),
  localId: LocalIdSchema,
  type: PoliticalProcedureTypeSchema,
  institutionRef: MaybeRefSchema,
  sponsorCharacterRef: RefSchema,
  subjectKind: PoliticalProcedureSubjectKindSchema,
  subjectRef: MaybeRefSchema,
  label: LabelSchema,
  resolutionMechanism: PoliticalResolutionMechanismSchema,
  deadlineInDays: DayOffsetSchema.nullable().default(null),
  visibility: VisibilitySchema.default("polity"),
  /**
   * What it does if it passes: a law, a reform, a new body. Null for a question
   * whose answer is only an answer -- a censure, a vote of thanks.
   *
   * A motion that passed changed nothing by itself, so a law had to be passed
   * and then carried out a second time by hand, and a government's own
   * offices and councils could not be reformed by anything at all. The engine
   * carries this out on the day it passes, and only then.
   */
  enacts: EnactmentProposalSchema.nullable().optional(),
  /** What it touches, so each bloc leans by what it wants. The engine adds what the measure plainly enacts. */
  concerns: z.array(QuestionConcernSchema).max(6).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * A government taken by force, or dictated.
 *
 * - "coup": a man with an army near the capital makes himself its master.
 * - "revolution": the people rise behind a leader and remake the state.
 * - "imposition": a conqueror or senior ally dictates the government of a power it holds.
 * - "restoration": the fallen government takes back what it lost.
 *
 * Never whether it works. The engine checks what the attempt needs -- men at
 * the capital, a people in unrest, a conquered city -- rolls it from the
 * armies' loyalty, the state's legitimacy and the plotters' standing, and
 * writes what follows either way.
 */
const RegimeChangeSchema = z.object({
  op: z.literal("regime_change"),
  actorCharacterRef: RefSchema,
  /** The power whose government changes. */
  polityRef: RefSchema,
  route: z.enum(["coup", "revolution", "imposition", "restoration"]),
  /** What it becomes. Absent: a coup makes a monarchy of it, a revolution a republic of its citizens, a restoration what it was. */
  form: GovernmentFormSchema.nullable().default(null),
  /** The armies used, which must answer to the actor. */
  forceRefs: z.array(RefSchema).max(4).default([]),
  reason: ReasonSchema,
}).strict();

/** Where one person or faction stands on an open question, and why. */
const PoliticalSupportSetSchema = z.object({
  op: z.literal("political_support_set"),
  procedureRef: RefSchema,
  supporterKind: SupportPositionKindSchema,
  supporterRef: RefSchema,
  position: SupportPositionChoiceSchema,
  influenceWeight: z.number().int().min(0).max(10_000),
  reasonKind: SupportReasonKindSchema,
  reasonLabel: LabelSchema,
  /**
   * What he said in the house, in his own words, when he spoke rather than
   * only voted: "a war tax in a year of dear grain will lose us the plebs".
   * Recorded as a speech; the debate is told as it happened, before the vote.
   */
  words: z.string().trim().min(1).max(240).nullable().optional(),
  visibility: VisibilitySchema.default("polity"),
  reason: ReasonSchema,
}).strict();

/** The question is settled, one way or another. */
const PoliticalProcedureResolveSchema = z.object({
  op: z.literal("political_procedure_resolve"),
  procedureRef: RefSchema,
  outcome: z.enum(["passed", "failed", "blocked", "withdrawn"]),
  outcomeReason: z.string().trim().min(1).max(400),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §7's "political seizure of assets", and every quieter transfer of land
 * besides. A holding carries who legally owns it and how much of it they
 * actually control, and the gap between the two is most of what makes land
 * political -- so both are movable here.
 */
/**
 * An estate: land a person owns and draws a living from.
 *
 * Bought with somebody's money (`priceFromAccountRef`), or granted out of the
 * public land by a government (null). The engine sets what it yields and what
 * it costs from the band and the province it lies in -- a model allowed to
 * write the rent would write it high -- and pays the yield to the holder's own
 * purse every month.
 */
const HoldingCreateSchema = z.object({
  op: z.literal("holding_create"),
  localId: LocalIdSchema,
  title: NameSchema,
  provinceId: EntityIdSchema,
  holderCharacterRef: RefSchema,
  /** How much land, and how good: a smallholding, a proper estate, a great one. */
  band: EffectBandSchema.default("slight"),
  /** Who pays for it. Null for a grant of public land, which is the government's act. */
  priceFromAccountRef: MaybeRefSchema,
  reason: ReasonSchema,
}).strict();

/**
 * Improving an estate: draining, planting, building, stocking. Paid now, from
 * the account named, and repaid by a larger yield every month after. The owner
 * needs nobody's leave to improve his own land.
 */
const HoldingImproveSchema = z.object({
  op: z.literal("holding_improve"),
  holdingRef: RefSchema,
  band: EffectBandSchema.default("slight"),
  /** What is being done to the land, in words: "drain the lower fields and plant olives". */
  works: LabelSchema,
  paidFromAccountRef: RefSchema,
  reason: ReasonSchema,
}).strict();

/**
 * Putting money into trade between two places. The engine sets what it
 * returns and costs from the two provinces; a war with the power at the other
 * end, or an enemy fleet off either port, stops it until they are gone.
 */
const TradeVentureOpenSchema = z.object({
  op: z.literal("trade_venture_open"),
  localId: LocalIdSchema,
  title: NameSchema,
  ownerCharacterRef: RefSchema,
  fromProvinceId: EntityIdSchema,
  /** The same province as `fromProvinceId` for trade in one market: a shop, a stall in the streets. */
  toProvinceId: EntityIdSchema,
  /** How much is put into it: a single cargo, a regular trade, a great house's business. */
  band: EffectBandSchema.default("slight"),
  paidFromAccountRef: RefSchema,
  reason: ReasonSchema,
}).strict();

/** Winding a venture up. Nothing is returned: the capital is in ships and goods already sold. */
const TradeVentureCloseSchema = z.object({
  op: z.literal("trade_venture_close"),
  ventureRef: RefSchema,
  reason: ReasonSchema,
}).strict();

const HoldingTransferSchema = z.object({
  op: z.literal("holding_transfer"),
  holdingRef: RefSchema,
  toCharacterRef: MaybeRefSchema,
  physicalControlBpsDelta: SignedBpsSchema.optional(),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §7 and §20: a government borrows.
 *
 * The principal arrives now and the servicing is an ordinary obligation, so a
 * debt that goes unpaid falls into arrears through the same machinery that
 * makes an unpaid army desert. Where the lender is someone in this world, the
 * money leaves their account -- and they become a person with a claim on the
 * state, which is where political concessions start.
 */
const LoanOpenSchema = z.object({
  op: z.literal("loan_open"),
  localId: LocalIdSchema,
  lenderKind: z.enum(["character", "polity", "foreign"]),
  /** Omitted only for "foreign" money, which comes from outside the modelled world. */
  lenderRef: MaybeRefSchema,
  borrowerAccountRef: RefSchema,
  principal: MoneySchema,
  /** Interest per servicing period, in basis points of the principal. */
  interestBps: BasisPointsSchema,
  cadenceDays: DaysSchema,
  /** What was agreed, in words. Often the politically expensive part. */
  terms: z.string().trim().min(1).max(300),
  collateralHoldingRef: MaybeRefSchema.default(null),
  reason: ReasonSchema,
}).strict();

/** Paying it down, walking away from it, or agreeing new terms under pressure. */
const LoanSettleSchema = z.object({
  op: z.literal("loan_settle"),
  loanRef: RefSchema,
  action: z.enum(["repay", "default", "renegotiate"]),
  /** For "repay": how much of the outstanding principal is being paid off now. */
  amount: MoneySchema.default(0),
  newInterestBps: BasisPointsSchema.optional(),
  newCadenceDays: DaysSchema.optional(),
  reason: ReasonSchema,
}).strict();

/**
 * What somebody takes to be true (VISION §14).
 *
 * The world already distinguished objective reality from what each person
 * believes about it, and nothing could put a belief into anybody's head. So
 * misinformation, deception and rumour had substrate and no mechanism: a
 * spymaster could not plant a falsehood, and an investigator could not form a
 * suspicion. Cognition reads these with their kind and confidence, so something
 * half-credited moves someone less than something witnessed -- and a planted
 * claim need not be true to be acted on.
 */
const BeliefSetSchema = z.object({
  op: z.literal("belief_set"),
  holderCharacterRef: RefSchema,
  claim: z.string().trim().min(1).max(400),
  kind: z.enum(["fact", "rumour", "suspicion", "secret"]),
  confidence: z.number().int().min(0).max(100),
  subjectRef: MaybeRefSchema.default(null),
  /** Who they heard it from, where anybody did. */
  sourceCharacterRef: MaybeRefSchema.default(null),
  visibility: VisibilitySchema.default("private"),
  reason: ReasonSchema,
}).strict();

/**
 * Two forces meet (VISION §3, §12).
 *
 * The one delta whose outcome its author does not decide. The model says who
 * engages whom and how they mean to fight; the engine resolves what happens --
 * casualties, morale, retreat, capture, ground -- from the deterministic
 * warfare rules. That is the sovereignty split at its sharpest: a model allowed
 * to author its own casualties would win every battle it cared about.
 *
 * A tactic may be *proposed*, and the engine may refuse it. A refusal is a fact
 * too.
 */
const ForceEngageSchema = z.object({
  op: z.literal("force_engage"),
  forceRef: RefSchema,
  targetForceRef: RefSchema,
  posture: z.enum(["offer_battle", "avoid_battle", "defend", "hold"]),
  /**
   * An unusual thing to try, within bounds the engine checks. Omit for an
   * ordinary engagement, or for the army's own standing plan where it has one
   * (`force_modify.battlePlan`); the side attacked fights by its own.
   */
  tactic: BattlePlanSchema.nullable().default(null),
  /**
   * Other armies coming in on the attacking side, in the same province.
   *
   * A battle was always one army against one, so "the Gauls fall on their
   * flank from the valley" could only be fought as a second, separate battle
   * against the same enemy -- which, since the enemy fought twice, won every
   * time. Armies of the attacker's own power under the same commander join by
   * themselves; this names anybody else's, or an ally's.
   */
  alliedForceRefs: z.array(RefSchema).max(8).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * A thread of history the world will follow (VISION §5, §20).
 *
 * The narrator seeds one; a crisis the scenario authored is one; an NPC's own
 * plot may become one. All are advanced by `storyline_advance` and shown back
 * to whoever is in them. A private storyline is the world's bookkeeping of a
 * secret: the orchestrator sees it because it is the world, its participants
 * see it because they are in it, and nobody else does.
 */
const StorylineOpenSchema = z.object({
  op: z.literal("storyline_open"),
  localId: LocalIdSchema,
  /** The handle shown under THE WORLD STIRS, when this answers a seed. Null when the world opened it on its own account. */
  seedKey: z.string().trim().min(1).max(80).nullable().default(null),
  title: TitleSchema,
  /** The people in it. A plague has none yet, and its province is enough. */
  participantRefs: z.array(RefSchema).max(16).default([]),
  provinceId: MaybeIdSchema.default(null),
  phase: StorylinePhaseSchema.exclude(["closed"]).default("brewing"),
  stakes: z.string().trim().min(1).max(320),
  nextDevelopment: z.string().trim().min(1).max(320),
  visibility: VisibilitySchema.default("public"),
  reason: ReasonSchema,
}).strict();


/**
 * A province changing hands (Pax-Historia-style contiguity, refined).
 *
 * Nothing in this engine has ever transferred a province. The battle resolver's
 * only control change reduces the defender's *firmness* and hands the province
 * straight back to whoever already held it, so a war could be fought for a
 * generation and the map would end exactly as it began. Conquest was prose.
 *
 * The rule the engine checks is reach, not land contiguity. "A polity cannot
 * own a region not adjacent to one of its own" is the blunt version, and taken
 * literally it forbids Rome holding Sicily -- which is the entire scenario. So
 * a taker needs either an army standing in the province, or a province of their
 * own next to it across a crossing the map admits. A sea lane is a crossing;
 * that is exactly how an island is taken, and exactly why the far side of the
 * world is not.
 *
 * Control taken is not control held. The province arrives at low firmness, and
 * the people in it are free to make that everyone's problem.
 */
/**
 * Somebody seated in an office, or put out of one.
 *
 * Nothing in the union could do either. Office was assigned exactly once in a
 * game's life -- inside `materializePlayerCharacter`, when the player declared
 * their character -- and never again by anything. A procedure that passed
 * settled its own row and moved no seat.
 *
 * It is worth its place in the contract for a second reason. `checkAuthority`
 * judges it like any other act, so a man who seats himself commits a breach
 * that somebody may come across and put before a court -- which is VISION §12's
 * illegal seizure of power falling out of the tables that already exist,
 * instead of needing a mechanic of its own.
 */
const OfficeSeatSetSchema = z.object({
  op: z.literal("office_seat_set"),
  /**
   * The office. One the government does not have yet is *made*, not refused:
   * "Quintus stands for tribune" in a Rome whose scenario authored only the
   * consulship was refused as "No office exists", and a refusal of that kind
   * never reached the player at all. A scenario's list is where a government
   * starts, exactly as `character_create.officeLabel` already treats it.
   */
  officeId: EntityIdSchema,
  /** What the office is called, where it is being made now. Read only when `officeId` matches nothing. */
  officeLabel: NameSchema.nullable().optional(),

  /** The seat, when an existing one is meant. Null takes the first free seat, or opens one. */
  seatId: MaybeIdSchema.default(null),
  /** Who holds it now. Null empties it. */
  holderCharacterRef: MaybeRefSchema.default(null),
  /** Why it fell vacant, when it did. */
  cause: OfficeSeatVacancyCauseSchema.default("none"),
  /** How long they hold it, in days. Null for a term that ends when somebody ends it. */
  termDays: DaysSchema.nullable().default(null),
  reason: ReasonSchema,
}).strict();

/**
 * A city changes hands, which a province changing hands is not.
 *
 * `Settlement.controllerPolityId` has carried the comment "a siege may change
 * a city before its province changes hands" since the map was written, and no
 * op in the vocabulary could set it. So taking Messana -- the single act this
 * whole scenario is pointed at -- could only be said as taking the whole of
 * north-eastern Sicily, and a garrison holding out in a city whose countryside
 * had gone was not a state the world could be in at all.
 */
const SettlementControlSetSchema = z.object({
  op: z.literal("settlement_control_set"),
  settlementId: EntityIdSchema,
  /**
   * The province it stands in, where the map has no record of this city.
   *
   * The map is a drawing of the world and not the whole of it. The Punic Wars
   * scenario draws forty-one settlements across the Mediterranean, so a
   * campaign that lands at Hadrumentum is naming a real city the cartographer
   * skipped -- and "besiege Hadrumentum" may not fail because of that. Given a
   * province, the city is founded on the record and then changes hands like any
   * other; left null, an unknown city is still refused, because a city with no
   * ground under it is a spelling mistake rather than a place.
   */
  inProvinceId: MaybeIdSchema.optional(),
  /** What it is called, for a city being put on the record. Falls back to the id read as words. */
  name: NameSchema.nullable().optional(),
  /** Who holds it now. Null for a city that answers to nobody -- sacked, abandoned, or its own. */
  toPolityRef: MaybeRefSchema,
  /** Whether the taking was a storm rather than a surrender. A stormed city is plundered. */
  sacked: z.boolean().default(false),
  reason: ReasonSchema,
}).strict();

const ProvinceControlSetSchema = z.object({
  op: z.literal("province_control_set"),
  provinceId: EntityIdSchema,
  /** Who holds it now. A polity that exists, or one created in this same answer. */
  toPolityRef: RefSchema,
  /** How firmly, in basis points. Low for ground just taken; high for a province ceded by treaty. */
  firmnessBps: z.number().int().min(0).max(10_000).default(2_500),
  reason: ReasonSchema,
}).strict();

/**
 * A new power on the map (VISION §9's dynamically created mechanics, applied to
 * the largest thing there is).
 *
 * Deferred when the narrator was built, and its absence shaped everything
 * around it: a rising is seeded, a leader is created, an army is raised -- and
 * all of it is filed under the very government being rebelled against, because
 * there was nowhere else to put it. A pretender was a Roman. Pirates answered
 * to the province they preyed on.
 *
 * The provinces it takes must be held by the power it breaks from and must hang
 * together: a rebellion is a piece of a country coming away, not a scatter of
 * unconnected towns. And it starts at war with the power it left, because a
 * secession nobody contests is an administrative reform.
 */
const PolityCreateSchema = z.object({
  op: z.literal("polity_create"),
  localId: LocalIdSchema,
  name: NameSchema,
  /** The power it is breaking from, when it is breaking from one. Null for a power that was always there. */
  breaksFromPolityId: MaybeRefSchema.default(null),
  /** What it holds at birth. Each must be controlled by `breaksFromPolityId` and connected to the rest. */
  provinceIds: z.array(EntityIdSchema).min(1).max(12),
  capitalSettlementId: MaybeIdSchema.default(null),
  /** Why it exists, in the record's words. */
  reason: ReasonSchema,
}).strict();

const StorylineAdvanceSchema = z.object({
  op: z.literal("storyline_advance"),
  storylineRef: RefSchema,
  /** What just happened in it, appended to its history. */
  development: z.string().trim().min(1).max(480),
  /** "closed" ends it; a closed thread is never advanced again. */
  phase: StorylinePhaseSchema.optional(),
  nextDevelopment: z.string().trim().min(1).max(320).optional(),
  stakes: z.string().trim().min(1).max(320).optional(),
  addParticipantRefs: z.array(RefSchema).max(8).default([]),
  reason: ReasonSchema,
}).strict();

/**
 * A circumstance bearing on one person: a debt come due, an illness, a rival
 * at their back. Its own arm rather than a field on `social_events`, because
 * a social event needs two people and a debt has only one. `create` puts a
 * pressure on them; `refresh` adds `intensity` to the strongest active one of
 * that kind, creating it if there is none; `resolve` lifts the strongest one.
 */
const CharacterPressureSetSchema = z.object({
  op: z.literal("character_pressure_set"),
  characterRef: RefSchema,
  action: z.enum(["create", "refresh", "resolve"]),
  kind: CharacterPressureKindSchema,
  intensity: z.number().int().min(0).max(100).default(50),
  label: LabelSchema,
  reviewInDays: z.number().int().positive().max(365).default(30),
  expiresInDays: z.number().int().positive().max(3_660).nullable().default(null),
  visibility: VisibilitySchema.default("private"),
  reason: ReasonSchema,
}).strict();

/**
 * What a person's body and standing have come to (VISION §12, slice 9).
 *
 * Nothing in this union could change `healthBps`, so illness could not impair
 * anybody and the narrator's own `illness` archetype had nowhere to land: a man
 * "fell ill" in a fact and went on doing everything he had done the day before.
 * `disqualifyingStatuses` was the same -- a generic status array checked by the
 * eligibility system and writable by nothing.
 *
 * **It can never set `alive: false`, and there is deliberately no field for it.**
 * Time and illness kill in `mortality.ts`, after a peril has been open long
 * enough to be acted against; a person's act kills through `character_death`,
 * which checks that the act was possible. Neither is a status to be written.
 */
const CharacterStateSetSchema = z.object({
  op: z.literal("character_state_set"),
  characterRef: RefSchema,
  /**
   * Signed, and clamped to the basis-point range on the way in. A gain is
   * rest, and small; a real recovery is a physician's ("physicianRef"), and
   * the engine rolls how well he does.
   */
  healthDeltaBps: SignedBpsSchema.default(0),
  physicianRef: MaybeRefSchema.optional(),
  /** Status tags to set and to lift -- "incapacitated", "captured", "wounded". */
  addStatuses: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  removeStatuses: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  /** Who they now mean to leave it all to. Null leaves the named heir alone. */
  heirRef: MaybeRefSchema.default(null),
  /**
   * Where they are now, when they have gone somewhere.
   *
   * Nothing in the vocabulary could move a person. Armies march and fleets
   * sail, but "Marcus travels to Egypt seeking a wife" left Marcus in Latium
   * with a status tag saying he was travelling, and every slice after that
   * showed him at home. A journey that takes real time is a project whose end
   * sets this; a short one is set directly.
   */
  moveToProvinceId: MaybeIdSchema.optional(),
  /** What they believe now, by name: a conversion, or a faith they have just founded. */
  faith: NameSchema.optional(),
  /**
   * How far their standing rose or fell: a triumph, games that bought the
   * city, a scandal, a defeat. Signed, a fifth of the whole scale at most.
   *
   * Standing is what an election is counted on and who is offered the house
   * when its head dies, and nothing any person did could move it: a consul who
   * won the war stood exactly where the day's most forgettable senator did.
   */
  standingDeltaBps: z.number().int().min(-2_000).max(2_000).optional(),
  /**
   * What moved it. The engine holds each cause to its own ceiling (see
   * `STANDING_CEILINGS_BPS`): a poem is not a triumph, and a shift nobody
   * names a cause for is the smallest of all.
   */
  standingCause: z.enum(STANDING_CAUSES).optional(),
  /**
   * The power they belong to now: a defector received, an exile taken in, a
   * man made a citizen. The engine lays down whatever they held in the old one
   * -- office and command -- because a man cannot serve both.
   */
  polityId: RefSchema.optional(),
  /**
   * What they got better or worse at -- a season in the field, years of study,
   * a wound that never healed. One step each, which is years of a life, not a
   * week of it; the engine says what a step is worth.
   */
  skillShifts: z
    .array(z.object({
      skill: z.enum(["martial", "diplomacy", "intrigue", "stewardship", "learning", "piety", "body"]),
      direction: z.enum(["better", "worse"]),
    }).strict())
    .max(3)
    .optional(),
  /** What they now want, or have got, or have given up on. "abandon" and "fulfil" name an ambition they already hold. */
  ambitions: z
    .array(z.object({
      label: LabelSchema,
      kind: z.enum(["office", "wealth", "revenge", "peace", "dynasty", "restoration", "other"]).default("other"),
      change: z.enum(["take_up", "fulfil", "abandon"]).default("take_up"),
    }).strict())
    .max(3)
    .optional(),
  reason: ReasonSchema,
}).strict();

/**
 * Kinship made or ended between two people who already exist: a marriage, a
 * divorce, an adoption.
 *
 * Kin could only be written when a person was created, so the commonest act
 * in Roman politics -- marrying a daughter to an ally, adopting an heir out of
 * another house -- could only be done by inventing a new person for it, and a
 * divorce could not be done at all. Read from `characterRef`'s side, as
 * `character_create.kin` is: an adopted son is "child" of his new father, a
 * wife "spouse_or_partner" of her husband. Consent is the people's own
 * business, and is the world's to judge; the engine keeps the record straight.
 */
const FamilyTieSetSchema = z.object({
  op: z.literal("family_tie_set"),
  characterRef: RefSchema,
  relatedCharacterRef: RefSchema,
  relation: FamilyLinkKindSchema,
  change: z.enum(["form", "end"]),
  reason: ReasonSchema,
}).strict();

/**
 * A man hired for work (roles plan phase 5; `material-state.ts`
 * `ServiceContractSchema`).
 *
 * The engine pays it: "advance" moves now and has to be there, "monthlyPay"
 * leaves the employer's account every month and the contract lapses the first
 * month it cannot. What the work needs comes with it -- a "mercenary"'s
 * "forceRef" answers to whoever hired it, an "envoy" may speak for the
 * employing power to "counterpartPolityId", a "tax_farmer" takes the tax of
 * "provinceId" for the treasury ("advance" is what he pays for the farm).
 */
const ServiceContractOpenSchema = z.object({
  op: z.literal("service_contract_open"),
  localId: LocalIdSchema,
  role: z.enum(["mercenary", "assassin", "envoy", "engineer", "physician", "tax_farmer", "gladiator", "retainer", "steward", "agent"]),
  label: TitleSchema,
  employerAccountRef: RefSchema,
  employeeRef: RefSchema,
  advance: MoneySchema.default(0),
  monthlyPay: MoneySchema.default(0),
  termDays: DayOffsetSchema.nullable().default(null),
  duties: z.string().trim().min(1).max(400),
  forceRef: MaybeRefSchema.default(null),
  /**
   * The men or ships a hired captain brings, when no force of his stands yet:
   * the engine raises them under him, answering to whoever hired them. A
   * "mercenary" names this or "forceRef" -- a shipmaster hired alone once
   * drew 100 a month and carried nobody.
   */
  company: z.object({ categoryId: EntityIdSchema, strength: z.number().int().positive().max(100_000) }).strict().nullable().default(null),
  provinceId: MaybeIdSchema.default(null),
  counterpartPolityId: MaybeRefSchema.default(null),
  reason: ReasonSchema,
}).strict();

/** Either side ending it. The man walking out before his term is up has broken it, and it shows. */
const ServiceContractCloseSchema = z.object({
  op: z.literal("service_contract_close"),
  contractRef: RefSchema,
  reason: ReasonSchema,
}).strict();

/**
 * What the law says a person is (roles plan phase 4).
 *
 * An owner frees his slave ("freed", and he stays the patron), sells him (a
 * new "ownerRef"), or lets him keep a purse of his own ("peculium"). Only the
 * owner can do any of it. A free man is made a slave only when he is already
 * in somebody's hands -- a captive, a prisoner, one condemned -- and becomes
 * the slave of whoever holds him, or of "ownerRef". Nobody is enslaved at large.
 */
const LegalStatusSetSchema = z.object({
  op: z.literal("legal_status_set"),
  characterRef: RefSchema,
  status: z.enum(["free", "freed", "enslaved"]),
  ownerRef: MaybeRefSchema.default(null),
  peculium: z.boolean().optional(),
  reason: ReasonSchema,
}).strict();

/**
 * A life ended by somebody's act rather than by time, illness or battle.
 *
 * Death had one door and it was the engine's alone, so a court could not
 * condemn anybody, a captured king could not be put to death, a quarrel could
 * not be settled with swords, and a beaten general could not fall on his own.
 * Each of these is a door now, and each has the one thing that makes it a
 * death somebody *did* rather than one a writer wanted:
 *
 * - `execution`: the condemned is held -- a captive, a prisoner -- where the
 *   one who orders it has men or the ground. Nobody is executed at large.
 * - `duel`: the two stand in one place, and the engine says who falls, from
 *   their skill with arms and the state of their bodies. Nobody writes the
 *   winner of a duel any more than of a battle.
 * - `suicide`: a man's own act, or a captive's, or one whose life is already
 *   in the balance.
 */
const CharacterDeathSchema = z.object({
  op: z.literal("character_death"),
  characterRef: RefSchema,
  manner: z.enum(["execution", "duel", "suicide"]),
  /** Who ordered it, or who fought him. Null only for a suicide. */
  byCharacterRef: MaybeRefSchema.default(null),
  reason: ReasonSchema,
}).strict();

/**
 * An army living off somebody else's country: farms burned, herds driven off,
 * granaries emptied.
 *
 * There was no way to say it. The nearest thing was a `province_material_shift`
 * that burned the fields and banked nothing, so "raid the Samnites and send the
 * loot back to Rome" damaged Samnium and left Rome no richer -- and, since the
 * shift is a number anybody may write, it could as easily be written against
 * your own province as an enemy's. The engine sizes the take from the men and
 * how fast they move (a hundred horsemen strip more than a hundred foot, and
 * far less than a legion), the province's own worth sets what there is, and
 * the damage follows from what was carried off.
 *
 * The raiders must be standing in the province. It cannot be their own power's
 * ground: that is not a raid, it is plundering your own people.
 */
/**
 * A named man joining an army's ranks, leaving them with leave, or leaving them
 * without it. Not command: the commander is `force_modify`'s business. A man
 * in the ranks shares his army's fortune in battle and sees what it sees.
 */
const ForceMembershipSetSchema = z.object({
  op: z.literal("force_membership_set"),
  characterRef: RefSchema,
  forceRef: RefSchema,
  change: z.enum(["enlist", "discharge", "desert"]),
  reason: ReasonSchema,
}).strict();

const ForceRaidSchema = z.object({
  op: z.literal("force_raid"),
  forceRef: RefSchema,
  provinceId: EntityIdSchema,
  /** Where the loot is sent. Null keeps it with the army, or its power's treasury. */
  toAccountRef: MaybeRefSchema.default(null),
  reason: ReasonSchema,
}).strict();


/** What a treaty makes happen (`agreement_open`'s clauses), and what a letter offering one offers. */
const TreatyClauseSchema = z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("indemnity"),
        payerPolityId: RefSchema,
        /** Each period's payment, in the world's money. */
        amount: MoneySchema,
        cadenceDays: z.number().int().positive().max(3_660),
        periods: z.number().int().min(1).max(100),
      }).strict(),
      z.object({ kind: z.literal("cession"), provinceId: EntityIdSchema, toPolityId: RefSchema }).strict(),
      z.object({ kind: z.literal("hostage"), characterRef: RefSchema, heldByPolityId: RefSchema }).strict(),
      /**
       * Surrender (deditio): the power gives itself up to the other party. Its
       * ground, people and money become the victor's, its army is disbanded,
       * and it is no more -- though its people remember (`sim/polity-end.ts`).
       */
      z.object({ kind: z.literal("submission"), polityId: RefSchema, toPolityId: RefSchema }).strict(),
    ]).meta({ id: "TreatyClause" });

/**
 * One power writing to another (VISION §24).
 *
 * `world/diplomacy.ts` described a letter years ago and nothing could make one,
 * so an order to propose an alliance became a project, a generic entity, or a
 * sentence in a fact -- and the king it was addressed to never had to answer.
 * A letter is a durable object: it is sent, it stands unanswered, and somebody
 * must eventually reply to it.
 *
 * A power always speaks through a person, so the sender is named twice: the
 * polity whose word this is, and the character who gave it. That is what lets a
 * senator's private correspondence with a foreign power be a breach rather than
 * an impossibility.
 */
const DiplomaticMessageSendSchema = z.object({
  op: z.literal("diplomatic_message_send"),
  localId: LocalIdSchema,
  kind: DiplomaticMessageKindSchema,
  fromPolityId: RefSchema,
  fromCharacterRef: RefSchema,
  toPolityId: RefSchema,
  /** A named recipient where there is one; null addresses the power at large. */
  toCharacterRef: MaybeRefSchema.default(null),
  subject: z.string().trim().min(1).max(240),
  /** What is actually being proposed, demanded or asked. */
  terms: z.string().trim().min(1).max(1_200),
  /** How long the sender is willing to wait. Null when they set no term. */
  replyWithinDays: z.number().int().positive().max(3_660).nullable().default(null),
  /** Set when this is itself the answer to an earlier letter. */
  inReplyToRef: MaybeRefSchema.default(null),
  visibility: VisibilitySchema.default("polity"),
  /**
   * The agreements accepting this would make, when it offers any: an ally
   * taken in ("alliance", "foedus"), a city put under protection
   * ("protectorate"), a peace, tribute. An offer of alliance, peace or trade,
   * or a demand for tribute, already means its own. Empty for a letter that
   * only says something.
   */
  proposes: z.array(PolityAgreementKindSchema).max(4).optional(),
  /**
   * The terms of the peace or treaty it offers, carried out if it is accepted:
   * provinces ceded, an indemnity, hostages, a surrender.
   */
  clauses: z.array(TreatyClauseSchema).max(6).optional(),
  /**
   * What the sender does if it is refused, or no answer comes by
   * "replyWithinDays": "war" for an ultimatum whose threat is war. The engine
   * carries it out when the answer is known -- not before it is asked.
   */
  onRefusal: z.enum(["war"]).nullable().optional(),
  reason: ReasonSchema,
}).strict();

/**
 * Answering one.
 *
 * Sending says nothing about the reply: the answer is the recipient's own
 * decision, taken with their own interests in view, which is why it is usually
 * proposed by that person's cognition rather than by the world. Answering moves
 * the sender's trust in the recipient by how their approach was received --
 * silence hardest of all.
 */
/**
 * What two powers now have standing between them: a war begun, a peace made,
 * an alliance sworn, tribute agreed.
 *
 * Its own arm rather than a stance shift, because how much Rome trusts Carthage
 * and whether Rome is at war with Carthage are different facts that change for
 * different reasons -- and only one of them can be answered by a number.
 */
const AgreementOpenSchema = z.object({
  op: z.literal("agreement_open"),
  localId: LocalIdSchema,
  kind: PolityAgreementKindSchema,
  /** For tribute, protection and foedus the order is the terms: the tributary pays, the protected power is answered for by, or the ally follows, the other. */
  polityId: RefSchema,
  otherPolityId: RefSchema,
  terms: z.string().trim().min(1).max(600),
  /**
   * What the treaty actually makes happen, beyond what it is called.
   *
   * Terms were prose, so an indemnity was a sentence nobody paid, a province
   * ceded by treaty stayed where it was, and a hostage never left home. Each
   * clause here is carried out the moment the treaty is made; an indemnity is
   * owed period by period, falls into arrears like any debt, and stops when
   * it is paid off or the treaty ends.
   */
  clauses: z
    .array(TreatyClauseSchema)
    .max(6)
    .optional(),
  /** A truce with a term ends by itself. Null runs until somebody ends it. */
  forDays: DaysSchema.nullable().default(null),
  /** The letter that produced it, where one did. */
  sourceMessageRef: MaybeRefSchema.default(null),
  visibility: VisibilitySchema.default("public"),
  reason: ReasonSchema,
}).strict();

/**
 * Something laid against a person in secret (see `world/covert-plot.ts`).
 *
 * The order this exists for -- "hire a man to kill him, and never let my name
 * be spoken" -- had no expression at all. Death runs through one door in this
 * engine, deliberately, so that nobody is killed off without it having been
 * made a thing of first; and the nearest thing this vocabulary could say was to
 * drop the mark's health and tag him dead, which produced a man at no health,
 * marked dead, and alive, still commanding his army.
 *
 * So it is said properly, and the sovereignty split holds exactly as it does
 * for a battle. The world says who is moving against whom, whose hand it is,
 * what was paid, what the cover story is, and how long it ought to take. The
 * engine says whether it works. Neither the odds nor the outcome is writable
 * here, and there is deliberately no field for either: an author who could set
 * his own chance of success would never miss, and the player who writes "25/75"
 * or "1% chance" in his order is telling the world how he rates it, not
 * settling it.
 *
 * It may always be laid. It is never certain to come off.
 */
const CovertPlotOpenSchema = z.object({
  op: z.literal("covert_plot_open"),
  localId: LocalIdSchema,
  kind: CovertPlotKindSchema,
  targetCharacterRef: RefSchema,
  /** Who wants it done -- usually, but not always, the person whose order this is. */
  sponsorCharacterRef: RefSchema,
  /** Whose hand it is, where one is named. A hired man may be created in this same answer. */
  agentCharacterRef: MaybeRefSchema.default(null),
  /** Where the money comes from. Null for a thing done for love, hatred or duty. */
  fundingAccountRef: MaybeRefSchema.default(null),
  /**
   * What is paid for it. Money buys a better hand and a quieter one -- up to a
   * point, past which more of it only means more people who know.
   */
  spend: MoneySchema.default(0),
  /** Whom the world is to blame if it goes wrong. "The Carthaginians did this." */
  cover: z.string().trim().min(1).max(300),
  /**
   * How long the world judges it will take to come to a head: a man has to be
   * found, got near, and left alone with him. Held by the engine between three
   * weeks and a year, because below that there is no plot and above it nobody
   * is still watching.
   */
  expectedInDays: z.number().int().min(1).max(3_650).default(60),
  reason: ReasonSchema,
}).strict();

/**
 * A plan laid against a day that has not come (see `world/contingency.ts`).
 *
 * "When the Carthaginians pass through the first layer of walls, set it ablaze
 * and lock the gates." About a fifth of the orders a real player writes hang
 * their content on a condition like that, and until now every one of them was
 * a note in the record that something had to notice and choose to act on.
 *
 * The trigger is the watch language, which is already closed, deterministic and
 * free to evaluate. The effect is one of two things and neither of them is
 * yours to size: `spring_trap` does what was prepared, and the engine works out
 * what that costs from what was actually spent laying it; `stand_to` raises the
 * alarm and hands the ruler back the wheel, which is the right answer to every
 * conditional whose consequence is a judgment rather than a bang -- "should the
 * city fall, write to the Senate" is not an effect, it is the next order.
 *
 * Traps cost money, taken when they are laid. That is what a trap is.
 */
const ContingencyArmSchema = z.object({
  op: z.literal("contingency_arm"),
  localId: LocalIdSchema,
  /** What it is called. "The Burning City." */
  label: LabelSchema,
  ownerCharacterRef: RefSchema,
  /** When it springs, in the same language a watch is written in. */
  trigger: WatchPredicateSchema,
  effect: ContingencyEffectSchema,
  provinceId: EntityIdSchema,
  /** The exact ground, where the plan is about ground: the ward, the pass, the ford. */
  positionId: MaybeIdSchema.default(null),
  /** Whom it is laid for. Null catches whoever walks into it, its owner's men included. */
  againstPolityId: MaybeIdSchema.default(null),
  fundingAccountRef: MaybeRefSchema.default(null),
  /** Pitch, timber and men paid to wait. The whole of what decides how badly it hurts. */
  spend: MoneySchema.default(0),
  /** Who falls on them once it springs, where anybody does. An ordinary battle follows. */
  ambushForceRef: MaybeRefSchema.default(null),
  /** How long it keeps. Null for a plan that waits as long as it must. */
  expiresInDays: DayOffsetSchema.nullable().default(null),
  /** For "stand_to": what the order said to do then, in its own words. */
  standingOrder: z.string().trim().min(1).max(400).nullable().optional(),
  reason: ReasonSchema,
}).strict();

/**
 * Laying a siege (`world/siege.ts`): an army standing in an enemy's province
 * invests the city, and the engine starves it from then on -- reporting every
 * fortnight, and opening its gates when it can hold no longer. The army has to
 * be there, and its power at war with the city's. "settlementId" names the
 * city; null invests the province's strongholds at large.
 */
const SiegeLaySchema = z.object({
  op: z.literal("siege_lay"),
  localId: LocalIdSchema,
  forceRef: RefSchema,
  settlementId: MaybeIdSchema.default(null),
  reason: ReasonSchema,
}).strict();

/** Raising a siege: the army marches off, or terms are made. Leaving the province raises it anyway. */
const SiegeLiftSchema = z.object({
  op: z.literal("siege_lift"),
  siegeRef: RefSchema,
  reason: ReasonSchema,
}).strict();

/**
 * Sending a man to go through the books: of one of the state's departments,
 * or of a household's estates and trade. It takes a month or three; whether
 * it finds anything depends on how well he looks and how well it was hidden.
 */
const AuditOpenSchema = z.object({
  op: z.literal("audit_open"),
  localId: LocalIdSchema,
  auditorCharacterRef: RefSchema,
  /** The department gone through. Absent, "householdOwnerRef" names whose estates. */
  departmentRef: MaybeRefSchema.optional(),
  householdOwnerRef: MaybeRefSchema.optional(),
  reason: ReasonSchema,
}).strict();

/** Calling one off: the fires stopped drawing attention, or the ground was given up. */
const ContingencyDisarmSchema = z.object({
  op: z.literal("contingency_disarm"),
  contingencyRef: RefSchema,
  reason: ReasonSchema,
}).strict();

/** Ending one: a peace signed, a truce broken, an alliance renounced. */
const AgreementCloseSchema = z.object({
  op: z.literal("agreement_close"),
  agreementRef: RefSchema,
  reason: ReasonSchema,
}).strict();

const DiplomaticMessageAnswerSchema = z.object({
  op: z.literal("diplomatic_message_answer"),
  messageRef: RefSchema,
  answer: DiplomaticAnswerSchema,
  /** The recipient's own words, and the reason it went the way it did. */
  answerText: z.string().trim().min(1).max(1_200),
  /**
   * Accepting: which of the agreements the letter offered is taken up, where
   * it offered more than one. The engine opens it; null takes the only one.
   */
  agreementKind: PolityAgreementKindSchema.nullable().optional(),
  /** For tribute, protection and foedus: the power that pays, is protected, or follows. Null means the power accepting. */
  boundPolityId: MaybeRefSchema.optional(),
  reason: ReasonSchema,
}).strict();

export const WorldDeltaSchema = z.discriminatedUnion("op", [
  MoneyTransferSchema,
  IncomeSourceUpsertSchema,
  ObligationUpsertSchema,
  ProjectCreateSchema,
  ProjectMilestoneUpdateSchema,
  ForceCreateSchema,
  ForceModifySchema,
  ForceReinforceSchema,
  ForceAttritionSchema,
  CharacterCreateSchema,
  CharacterIntentSetSchema,
  SocialEventsSchema,
  GenericEntityCreateSchema,
  AuthorityGrantUpsertSchema,
  OrderAttemptDecideSchema,
  PolityStanceShiftSchema,
  PolityOutlookSetSchema,
  LegitimacyShiftSchema,
  ProvinceMaterialShiftSchema,
  PoliticalProcedureOpenSchema,
  PoliticalSupportSetSchema,
  PoliticalProcedureResolveSchema,
  HoldingTransferSchema,
  HoldingCreateSchema,
  HoldingImproveSchema,
  ForceMembershipSetSchema,
  TradeVentureOpenSchema,
  TradeVentureCloseSchema,
  GenericEntityUpdateSchema,
  LoanOpenSchema,
  LoanSettleSchema,
  BeliefSetSchema,
  ForceEngageSchema,
  StorylineOpenSchema,
  StorylineAdvanceSchema,
  CharacterPressureSetSchema,
  CharacterStateSetSchema,
  ForceRaidSchema,
  DiplomaticMessageSendSchema,
  DiplomaticMessageAnswerSchema,
  AgreementOpenSchema,
  AgreementCloseSchema,
  ProvinceControlSetSchema,
  SettlementControlSetSchema,
  PolityCreateSchema,
  OfficeSeatSetSchema,
  CovertPlotOpenSchema,
  ContingencyArmSchema,
  ContingencyDisarmSchema,
  AuditOpenSchema,
  SiegeLaySchema,
  SiegeLiftSchema,
  FamilyTieSetSchema,
  CharacterDeathSchema,
  LegalStatusSetSchema,
  ServiceContractOpenSchema,
  ServiceContractCloseSchema,
  RegimeChangeSchema,
]).meta({ id: "WorldDelta" });
export type WorldDelta = z.infer<typeof WorldDeltaSchema>;
export type WorldDeltaOp = WorldDelta["op"];

/** Every op in the union, for exhaustiveness checks and prompt generation. */
export const WORLD_DELTA_OPS = [
  "money_transfer",
  "income_source_upsert",
  "obligation_upsert",
  "project_create",
  "project_milestone_update",
  "force_create",
  "force_modify",
  "force_reinforce",
  "force_attrition",
  "character_create",
  "character_intent_set",
  "social_events",
  "generic_entity_create",
  "authority_grant_upsert",
  "order_attempt_decide",
  "polity_stance_shift",
  "polity_outlook_set",
  "legitimacy_shift",
  "province_material_shift",
  "political_procedure_open",
  "political_support_set",
  "political_procedure_resolve",
  "holding_transfer",
  "holding_create",
  "holding_improve",
  "force_membership_set",
  "trade_venture_open",
  "trade_venture_close",
  "generic_entity_update",
  "loan_open",
  "loan_settle",
  "belief_set",
  "force_engage",
  "storyline_open",
  "storyline_advance",
  "character_pressure_set",
  "character_state_set",
  "diplomatic_message_send",
  "diplomatic_message_answer",
  "agreement_open",
  "agreement_close",
  "province_control_set",
  "settlement_control_set",
  "polity_create",
  "office_seat_set",
  "covert_plot_open",
  "contingency_arm",
  "contingency_disarm",
  "audit_open",
  "siege_lay",
  "siege_lift",
  "force_raid",
  "family_tie_set",
  "character_death",
  "legal_status_set",
  "service_contract_open",
  "service_contract_close",
  "regime_change",
] as const satisfies readonly WorldDeltaOp[];

/**
 * Which authority domain a delta acts in, so `checkAuthority` can classify the
 * actor's standing to do it (VISION §12). A delta outside the actor's authority
 * is still applied -- it is recorded as a breach, because insubordination is a
 * story, not a validation failure.
 */
export const DELTA_AUTHORITY_DOMAIN: Record<WorldDeltaOp, AuthorityDomain> = {
  money_transfer: "fiscal",
  income_source_upsert: "fiscal",
  obligation_upsert: "fiscal",
  project_create: "civil",
  project_milestone_update: "civil",
  force_create: "military",
  force_modify: "military",
  force_reinforce: "military",
  force_attrition: "military",
  character_create: "civil",
  character_intent_set: "social",
  social_events: "social",
  generic_entity_create: "civil",
  authority_grant_upsert: "judicial",
  order_attempt_decide: "civil",
  polity_stance_shift: "diplomatic",
  polity_outlook_set: "diplomatic",
  legitimacy_shift: "civil",
  province_material_shift: "civil",
  political_procedure_open: "civil",
  political_support_set: "social",
  political_procedure_resolve: "civil",
  holding_transfer: "judicial",
  holding_create: "fiscal",
  holding_improve: "fiscal",
  force_membership_set: "military",
  trade_venture_open: "fiscal",
  trade_venture_close: "fiscal",
  generic_entity_update: "civil",
  loan_open: "fiscal",
  loan_settle: "fiscal",
  belief_set: "social",
  force_engage: "military",
  storyline_open: "civil",
  storyline_advance: "civil",
  character_pressure_set: "social",
  character_state_set: "social",
  force_raid: "military",
  diplomatic_message_send: "diplomatic",
  diplomatic_message_answer: "diplomatic",
  agreement_open: "diplomatic",
  agreement_close: "diplomatic",
  // Taking ground is a military act; founding a power is not anyone's office.
  province_control_set: "military",
  settlement_control_set: "military",
  polity_create: "civil",
  // Putting a man in office, or out of it, is the civil power at its plainest.
  office_seat_set: "civil",
  // Nobody's office authorises this, which is the point: every plot is a
  // breach, and the record says so the moment it is laid.
  covert_plot_open: "judicial",
  // Laying and calling off a prepared destruction is a commander's act, made
  // in advance. It is judged exactly as ordering it on the day would be.
  contingency_arm: "military",
  contingency_disarm: "military",
  // Going through the books is the fiscal power at its plainest.
  audit_open: "fiscal",
  // A siege is an army's work, judged as ordering the army would be.
  siege_lay: "military",
  siege_lift: "military",
  // Marrying and adopting are a family's business, and its head's.
  family_tie_set: "social",
  // Putting a man to death is the judicial power at its plainest; a duel or a
  // suicide is nobody's office, and is judged as the act of whoever gave it.
  character_death: "judicial",
  // Freeing or selling a slave is the household's; enslaving a free man is the judicial power's.
  legal_status_set: "judicial",
  // Hiring a man is spending the money that pays him.
  service_contract_open: "fiscal",
  service_contract_close: "fiscal",
  // No office authorises taking the state: every attempt is a breach, and the record says so.
  regime_change: "military",
};
