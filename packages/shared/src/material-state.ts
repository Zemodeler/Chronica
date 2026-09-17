import { z } from "zod";

export const EntityIdSchema = z.string().trim().min(1).max(120);
export const ElapsedStepSchema = z.number().int().nonnegative().safe();
export type ElapsedStep = z.infer<typeof ElapsedStepSchema>;
export const MoneyAmountSchema = z.number().int().nonnegative().safe();
export const BasisPointsSchema = z.number().int().min(0).max(10_000);
export const SignedScoreSchema = z.number().int().min(-100).max(100);

export const VisibilitySchema = z.enum(["public", "polity", "private"]);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const CurrencyDefinitionSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(80),
  unitName: z.string().trim().min(1).max(40),
  unitNamePlural: z.string().trim().min(1).max(40),
  symbol: z.string().trim().min(1).max(8).optional(),
});
export type CurrencyDefinition = z.infer<typeof CurrencyDefinitionSchema>;

export const AccountOwnerSchema = z.object({
  kind: z.enum(["character", "polity"]),
  id: EntityIdSchema,
});

export const MoneyAccountSchema = z.object({
  id: EntityIdSchema,
  owner: AccountOwnerSchema,
  currencyId: EntityIdSchema,
  balance: MoneyAmountSchema,
  status: z.enum(["active", "locked", "closed"]),
  visibility: VisibilitySchema,
});
export type MoneyAccount = z.infer<typeof MoneyAccountSchema>;

export const AccountPermissionSchema = z.enum([
  "view",
  "propose_spending",
  "spend_without_vote",
]);

export const AccountAccessSchema = z.object({
  id: EntityIdSchema,
  characterId: EntityIdSchema,
  accountId: EntityIdSchema,
  permissions: z.array(AccountPermissionSchema).min(1),
  sourceKind: z.enum(["ownership", "office", "title", "law"]),
  sourceId: EntityIdSchema,
});
export type AccountAccess = z.infer<typeof AccountAccessSchema>;

export const IncomeSourceSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["land", "office", "trade", "pension", "tax"]),
  label: z.string().trim().min(1).max(120),
  beneficiaryAccountId: EntityIdSchema,
  originKind: z.enum(["holding", "office", "position", "polity"]),
  originId: EntityIdSchema,
  amount: MoneyAmountSchema,
  cadenceSteps: z.number().int().positive().max(36_600),
  nextDueStep: ElapsedStepSchema,
  collectionRateBps: BasisPointsSchema.default(10_000),
  /**
   * Who the money comes from, where it comes from abroad.
   *
   * Trade was a label and nothing else: a "trade" income behaved exactly like
   * rent from a farm, so a war with the very people paying it changed nothing.
   * Naming the counterparty is what lets a blockade or a rupture cut a
   * particular route rather than an abstraction. Null for domestic revenue.
   */
  counterpartyPolityId: EntityIdSchema.nullable().default(null),
  active: z.boolean(),
});
export type IncomeSource = z.infer<typeof IncomeSourceSchema>;

export const MoneyObligationSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["army_pay", "army_upkeep", "salary", "tribute", "pension", "debt_service"]),
  label: z.string().trim().min(1).max(120),
  payerAccountId: EntityIdSchema,
  recipientAccountId: EntityIdSchema.optional(),
  amount: MoneyAmountSchema,
  cadenceSteps: z.number().int().positive().max(36_600),
  nextDueStep: ElapsedStepSchema,
  priority: z.number().int().min(0).max(1000),
  arrears: MoneyAmountSchema,
  missedPeriods: z.number().int().nonnegative(),
  active: z.boolean(),
  consequenceRef: EntityIdSchema.optional(),
});
export type MoneyObligation = z.infer<typeof MoneyObligationSchema>;

export const MoneyTransactionCauseSchema = z.object({
  kind: z.enum([
    "action",
    "scheduled_income",
    "obligation",
    "battle_result",
    "title_change",
    "succession",
    // docs/32, Part C.3: a project's reserve/spend/release lifecycle
    // (`world/project.ts`, `world/money-reservations.ts`).
    "project_reservation",
    "project_milestone",
    "project_release",
  ]),
  id: EntityIdSchema,
  explanation: z.string().trim().min(1).max(240),
});

/**
 * An earmark against an account's balance for one project (docs/32, Part C.3).
 * A reservation does not move money -- no `MoneyTransaction` is created when
 * one opens -- it only narrows what `availableBalance` (`world/money-
 * reservations.ts`) reports as spendable, so an ordinary `transfer_gold` can
 * never eat into funds a project has already committed. `remainingAmount`
 * falls as each milestone spends from it; the reservation closes only when
 * it reaches zero (`spent`) or the project is abandoned (`released`/
 * `cancelled`).
 */
export const MoneyReservationSchema = z
  .object({
    id: EntityIdSchema,
    accountId: EntityIdSchema,
    currencyId: EntityIdSchema,
    reservedAmount: MoneyAmountSchema.positive(),
    remainingAmount: MoneyAmountSchema,
    purposeKind: z.literal("project"),
    purposeId: EntityIdSchema,
    status: z.enum(["active", "released", "spent", "cancelled"]),
    createdAtStep: ElapsedStepSchema,
    closedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict()
  .superRefine((reservation, context) => {
    if (reservation.remainingAmount > reservation.reservedAmount) {
      context.addIssue({ code: "custom", path: ["remainingAmount"], message: "A reservation cannot hold more remaining than it originally reserved." });
    }
    const isOpen = reservation.status === "active";
    if (isOpen && reservation.closedAtStep !== null) {
      context.addIssue({ code: "custom", path: ["closedAtStep"], message: "An active reservation has not closed yet." });
    }
    if (!isOpen && reservation.closedAtStep === null) {
      context.addIssue({ code: "custom", path: ["closedAtStep"], message: "A reservation that is released, spent, or cancelled must record when it closed." });
    }
  });
export type MoneyReservation = z.infer<typeof MoneyReservationSchema>;

export const MoneyTransactionSchema = z
  .object({
    id: EntityIdSchema,
    atStep: ElapsedStepSchema,
    kind: z.enum([
      "income",
      "tax",
      "purchase",
      "transfer",
      "upkeep",
      "spoils",
      "ransom",
      "confiscation",
      "inheritance",
    ]),
    amount: MoneyAmountSchema.positive(),
    sourceAccountId: EntityIdSchema.optional(),
    destinationAccountId: EntityIdSchema.optional(),
    cause: MoneyTransactionCauseSchema,
    visibility: VisibilitySchema,
  })
  .superRefine((transaction, context) => {
    if (transaction.sourceAccountId === undefined && transaction.destinationAccountId === undefined) {
      context.addIssue({
        code: "custom",
        message: "A money transaction must name a source or destination account.",
      });
    }
    if (
      transaction.sourceAccountId !== undefined &&
      transaction.sourceAccountId === transaction.destinationAccountId
    ) {
      context.addIssue({
        code: "custom",
        message: "A money transaction cannot transfer to the same account.",
      });
    }
  });
export type MoneyTransaction = z.infer<typeof MoneyTransactionSchema>;

export const CapturableValueSchema = z.object({
  id: EntityIdSchema,
  sourceKind: z.enum(["force_pay_chest", "treasury_location", "holding"]),
  sourceId: EntityIdSchema,
  remainingValue: MoneyAmountSchema,
  currencyId: EntityIdSchema,
});
export type CapturableValue = z.infer<typeof CapturableValueSchema>;

export const HoldingSchema = z.object({
  id: EntityIdSchema,
  title: z.string().trim().min(1).max(120),
  territoryId: EntityIdSchema,
  legalHolderCharacterId: EntityIdSchema,
  incomeSourceId: EntityIdSchema,
  successionRuleId: EntityIdSchema,
  physicalControlBps: BasisPointsSchema,
});
export type Holding = z.infer<typeof HoldingSchema>;

// Estates and inheritance (character-sim phase 5).
//
// An estate never duplicates a balance or a holding; it only names the
// existing accounts/holdings/obligations a character owned or controlled, and
// the rule that decides who inherits them. Offices are never inherited here --
// an office becomes vacant on death (characters/character.ts `OfficeSeat`) and
// is refilled only through a Phase 4 institutional procedure.

export const InheritanceRuleKindSchema = z.enum([
  "primogeniture",
  "equal_division",
  "appointment",
  "elective",
  "seniority",
  "custom_scenario_rule",
]);
export type InheritanceRuleKind = z.infer<typeof InheritanceRuleKindSchema>;

export const InheritanceRuleSchema = z
  .object({
    id: EntityIdSchema,
    kind: InheritanceRuleKindSchema,
    /** Required when `kind` is "elective": the institution whose procedure decides. */
    institutionId: EntityIdSchema.nullable(),
    /** Whether the deceased's debts move to the beneficiary or are forgiven. */
    debtsTransfer: z.boolean(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.kind === "elective" && rule.institutionId === null) {
      context.addIssue({
        code: "custom",
        path: ["institutionId"],
        message: "An elective inheritance rule must name the institution that decides.",
      });
    }
  });
export type InheritanceRule = z.infer<typeof InheritanceRuleSchema>;

export const EstateStatusSchema = z.enum(["intact", "settling", "settled", "disputed", "escheated"]);

export const EstateSchema = z
  .object({
    id: EntityIdSchema,
    ownerCharacterId: EntityIdSchema,
    accountIds: z.array(EntityIdSchema).default([]),
    holdingIds: z.array(EntityIdSchema).default([]),
    obligationIds: z.array(EntityIdSchema).default([]),
    inheritanceRuleId: EntityIdSchema,
    /** Priority-ordered named beneficiaries, used by the "appointment" rule kind. */
    testamentaryBeneficiaryIds: z.array(EntityIdSchema).default([]),
    status: EstateStatusSchema,
    settledAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type Estate = z.infer<typeof EstateSchema>;

export const InheritanceAssetKindSchema = z.enum(["account_balance", "holding", "obligation"]);

/** The immutable ledger of what happened to one asset -- transferred, or denied. */
export const InheritanceTransferSchema = z
  .object({
    id: EntityIdSchema,
    estateId: EntityIdSchema,
    deceasedCharacterId: EntityIdSchema,
    /** Null means escheated/confiscated -- no valid beneficiary existed. */
    beneficiaryCharacterId: EntityIdSchema.nullable(),
    assetKind: InheritanceAssetKindSchema,
    assetId: EntityIdSchema,
    reason: z.string().trim().min(1).max(240),
    resolvedAtStep: ElapsedStepSchema,
    sourceEventId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type InheritanceTransfer = z.infer<typeof InheritanceTransferSchema>;

export const PoliticalCauseSchema = z.object({
  id: EntityIdSchema,
  label: z.string().trim().min(1).max(160),
  score: SignedScoreSchema,
  sourceId: EntityIdSchema,
});

export const VotingBlocSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(100),
    representedInterest: z.string().trim().min(1).max(100),
    weight: z.number().int().positive(),
    baseSupport: SignedScoreSchema,
    yesThreshold: SignedScoreSchema,
    noThreshold: SignedScoreSchema,
    causes: z.array(PoliticalCauseSchema),
  })
  .refine((bloc) => bloc.noThreshold < bloc.yesThreshold, {
    message: "A voting bloc's no threshold must be below its yes threshold.",
    path: ["noThreshold"],
  });
export type VotingBloc = z.infer<typeof VotingBlocSchema>;

export const GovernmentInstitutionSchema = z
  .object({
    id: EntityIdSchema,
    polityId: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    votingBlocs: z.array(VotingBlocSchema).min(1),
    totalVotingWeight: z.number().int().positive(),
    quorumBps: BasisPointsSchema,
    passageThresholdBps: BasisPointsSchema,
    denominator: z.enum(["total", "present", "cast"]),
  })
  .superRefine((institution, context) => {
    const weight = institution.votingBlocs.reduce((total, bloc) => total + bloc.weight, 0);
    if (weight !== institution.totalVotingWeight) {
      context.addIssue({
        code: "custom",
        path: ["totalVotingWeight"],
        message: "Total voting weight must equal the sum of voting bloc weights.",
      });
    }
  });
export type GovernmentInstitution = z.infer<typeof GovernmentInstitutionSchema>;

export const ReservedPowerCategorySchema = z.enum([
  "declare_war",
  "extraordinary_tax",
  "borrow",
  "foundational_law",
  "over_limit_muster",
]);
export type ReservedPowerCategory = z.infer<typeof ReservedPowerCategorySchema>;

export const ReservedPowerRuleSchema = z.object({
  id: EntityIdSchema,
  polityId: EntityIdSchema,
  category: ReservedPowerCategorySchema,
  institutionId: EntityIdSchema,
  emergencyProcedureId: EntityIdSchema.optional(),
});
export type ReservedPowerRule = z.infer<typeof ReservedPowerRuleSchema>;

export const MotionSchema = z.object({
  id: EntityIdSchema,
  institutionId: EntityIdSchema,
  sponsorCharacterId: EntityIdSchema,
  category: ReservedPowerCategorySchema,
  proposalLabel: z.string().trim().min(1).max(200),
  linkedActionId: EntityIdSchema,
  openedAtStep: ElapsedStepSchema,
  status: z.enum(["pending", "passed", "failed", "withdrawn"]),
  voteRecordId: EntityIdSchema.optional(),
});
export type Motion = z.infer<typeof MotionSchema>;

export const BlocVoteSchema = z.object({
  blocId: EntityIdSchema,
  choice: z.enum(["yes", "no", "abstain"]),
  weight: z.number().int().positive(),
  supportScore: SignedScoreSchema,
  reasons: z.array(z.string().trim().min(1).max(200)).min(1),
});
export type BlocVote = z.infer<typeof BlocVoteSchema>;

export const VoteRecordSchema = z
  .object({
    id: EntityIdSchema,
    motionId: EntityIdSchema,
    votes: z.array(BlocVoteSchema).min(1),
    yesWeight: z.number().int().nonnegative(),
    noWeight: z.number().int().nonnegative(),
    abstainWeight: z.number().int().nonnegative(),
    presentWeight: z.number().int().nonnegative(),
    quorumMet: z.boolean(),
    thresholdMet: z.boolean(),
    outcome: z.enum(["passed", "failed"]),
    resolvedAtStep: ElapsedStepSchema,
  })
  .superRefine((record, context) => {
    const totalFor = (choice: "yes" | "no" | "abstain") =>
      record.votes
        .filter((vote) => vote.choice === choice)
        .reduce((total, vote) => total + vote.weight, 0);
    const yes = totalFor("yes");
    const no = totalFor("no");
    const abstain = totalFor("abstain");
    if (yes !== record.yesWeight || no !== record.noWeight || abstain !== record.abstainWeight) {
      context.addIssue({ code: "custom", message: "Recorded vote totals must equal the bloc votes." });
    }
    if (record.presentWeight !== yes + no + abstain) {
      context.addIssue({ code: "custom", path: ["presentWeight"], message: "Present weight must equal all recorded votes." });
    }
    const shouldPass = record.quorumMet && record.thresholdMet && yes > no;
    if ((record.outcome === "passed") !== shouldPass) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "A vote passes only with quorum, threshold and more yes than no weight." });
    }
  });
export type VoteRecord = z.infer<typeof VoteRecordSchema>;

// Political institutions, factions and procedures (character-sim phase 4).
//
// Offices/institutions/voting blocs already existed as inert scaffold; this
// section adds the pieces that make them load-bearing: reusable eligibility
// requirements, political groups distinct from institutions, an authoritative
// office-seat/term record, a generic typed procedure lifecycle, and canonical
// per-supporter support/opposition records. A procedure's `resolutionMechanism`
// is scenario data -- a vote is one mechanism among several, never the default.

export const EligibilityRequirementKindSchema = z.enum([
  "alive",
  "polity_membership",
  "culture_membership",
  "faith_membership",
  "group_membership",
  "min_prestige",
  "holds_office",
  "not_disqualified",
  "sponsorship_required",
  "custom_scenario_flag",
]);
export type EligibilityRequirementKind = z.infer<typeof EligibilityRequirementKindSchema>;

/**
 * A single reusable eligibility test, referenced by id from an office or a
 * procedure. `params` is a loose bag because each kind needs different data
 * (a polity id, a minimum prestige, a required office id, a custom flag) --
 * the kind enum is the closed, validated part; params are scenario data.
 */
export const EligibilityRequirementSchema = z
  .object({
    id: EntityIdSchema,
    kind: EligibilityRequirementKindSchema,
    label: z.string().trim().min(1).max(160),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type EligibilityRequirement = z.infer<typeof EligibilityRequirementSchema>;

export const PoliticalGroupTypeSchema = z.enum([
  "faction",
  "household",
  "military_command",
  "religious_body",
  "merchant_interest",
  "landholder_interest",
  "other",
]);
export type PoliticalGroupType = z.infer<typeof PoliticalGroupTypeSchema>;

/**
 * A faction, household, military command, or other coalition a character can
 * belong to. Distinct from a `GovernmentInstitution`: a group is a social
 * coalition with a platform and leadership, not a body with formal voting
 * power (though a group's members may compose an institution's voting blocs).
 */
export const PoliticalGroupSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    polityId: EntityIdSchema.nullable(),
    type: PoliticalGroupTypeSchema,
    leaderCharacterId: EntityIdSchema.nullable(),
    platform: z.array(z.string().trim().min(1).max(200)).max(12),
    resourceAccountId: EntityIdSchema.nullable(),
    publicReputationBps: BasisPointsSchema,
    active: z.boolean(),
  })
  .strict();
export type PoliticalGroup = z.infer<typeof PoliticalGroupSchema>;

/**
 * A character's membership in a group. Membership is reach, not agreement --
 * a member can still oppose any single procedure their group's leadership
 * sponsors (see `SupportPosition`). A character may hold many of these.
 */
export const GroupMembershipSchema = z
  .object({
    characterId: EntityIdSchema,
    groupId: EntityIdSchema,
    role: z.string().trim().min(1).max(120),
    influenceBps: BasisPointsSchema,
    loyaltyBps: SignedScoreSchema,
    visibility: VisibilitySchema,
    joinedAtStep: ElapsedStepSchema,
    leftAtStep: ElapsedStepSchema.nullable().default(null),
    joinProvenanceEventId: EntityIdSchema.nullable(),
    leaveProvenanceEventId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type GroupMembership = z.infer<typeof GroupMembershipSchema>;

export const OfficeSeatStatusSchema = z.enum(["held", "vacant"]);
export const OfficeSeatVacancyCauseSchema = z.enum([
  "none",
  "death",
  "removal",
  "resignation",
  "term_expired",
  "never_filled",
  "incapacity",
  "capture",
]);

/**
 * The authoritative holder/term/provenance record for one seat of an office.
 * `Character.officeId` remains the compatibility mirror consumers already
 * read; this is the record workflows actually appoint/remove/expire through.
 * `seatIndex` supports multi-seat offices (e.g. two co-equal magistrates).
 */
export const OfficeSeatSchema = z
  .object({
    id: EntityIdSchema,
    officeId: EntityIdSchema,
    seatIndex: z.number().int().nonnegative().default(0),
    holderCharacterId: EntityIdSchema.nullable(),
    status: OfficeSeatStatusSchema,
    vacancyCause: OfficeSeatVacancyCauseSchema,
    termStartedAtStep: ElapsedStepSchema.nullable(),
    termExpiresAtStep: ElapsedStepSchema.nullable(),
    appointmentProcedureId: EntityIdSchema.nullable(),
    removalProcedureId: EntityIdSchema.nullable(),
    eligibilityRequirementIds: z.array(EntityIdSchema).default([]),
  })
  .strict()
  .superRefine((seat, context) => {
    if (seat.status === "held" && seat.holderCharacterId === null) {
      context.addIssue({ code: "custom", path: ["holderCharacterId"], message: "A held seat must name its holder." });
    }
    if (seat.status === "vacant" && seat.holderCharacterId !== null) {
      context.addIssue({ code: "custom", path: ["holderCharacterId"], message: "A vacant seat cannot have a holder." });
    }
    if (seat.status === "vacant" && seat.vacancyCause === "none") {
      context.addIssue({ code: "custom", path: ["vacancyCause"], message: "A vacant seat must record why it is vacant." });
    }
  });
export type OfficeSeat = z.infer<typeof OfficeSeatSchema>;

export const PoliticalProcedureTypeSchema = z.enum([
  "nomination",
  "appointment",
  "removal",
  "vote",
  "council_deliberation",
  "decree",
  "petition",
  "treaty_ratification",
  "command_assignment",
  "endorsement",
  "denunciation",
  /**
   * System-triggered, never sponsored by a player/NPC directly: opens
   * automatically when a ruling polity's legitimacy falls too far (docs/18
   * Phase 2 follow-on -- "taxation costs legitimacy but never opens a real
   * political procedure"). The friction an authority-holder faces from
   * spending down legitimacy is surfaced as this Chronicle-visible event,
   * not as a confirmation step blocking the order that caused it.
   */
  "opposition_motion",
]);
export type PoliticalProcedureType = z.infer<typeof PoliticalProcedureTypeSchema>;

export const PoliticalProcedureStageSchema = z.enum([
  "proposed",
  "gathering_support",
  "deliberating",
  "voting_or_deciding",
  "resolved",
  "withdrawn",
  "blocked",
]);
export type PoliticalProcedureStage = z.infer<typeof PoliticalProcedureStageSchema>;

/**
 * How a procedure is decided. A scenario may use `vote` for a council, but
 * `appointment_authority`/`seniority`/`decree_authority`/`sponsor_discretion`
 * are equally valid and require no voting bloc at all -- the engine never
 * assumes a legislature (docs/07).
 */
export const PoliticalResolutionMechanismSchema = z.enum([
  "vote",
  "appointment_authority",
  "seniority",
  "decree_authority",
  "sponsor_discretion",
]);
export type PoliticalResolutionMechanism = z.infer<typeof PoliticalResolutionMechanismSchema>;

export const PoliticalProcedureSubjectKindSchema = z.enum([
  "office_seat",
  "character",
  "force",
  "treaty",
  "polity",
  "group",
]);

export const PoliticalProcedureOutcomeSchema = z.enum(["passed", "failed", "blocked", "withdrawn"]);

/**
 * A generic, typed political procedure: the legal route through which a
 * sponsor, an institution (where one applies) and eligible participants turn
 * an intent into a decision.
 *
 * It used to name a workflow to invoke on success. That execution engine was
 * removed with the turn system, and for a while this carried a `linkedWorkflowId`
 * pointing at nothing, which nothing read. What a procedure actually needs is to
 * say in words what is being decided -- `label` -- and what happens next is the
 * business of whoever acts on the outcome.
 */
export const PoliticalProcedureSchema = z
  .object({
    id: EntityIdSchema,
    type: PoliticalProcedureTypeSchema,
    institutionId: EntityIdSchema.nullable(),
    sponsorCharacterId: EntityIdSchema,
    subjectKind: PoliticalProcedureSubjectKindSchema,
    subjectId: EntityIdSchema.nullable(),
    /** What is being decided, in plain words: "Censure the consul for Drepanum". */
    label: z.string().trim().min(1).max(200),
    eligibilityRequirementIds: z.array(EntityIdSchema).default([]),
    eligibleParticipantIds: z.array(EntityIdSchema).default([]),
    stage: PoliticalProcedureStageSchema,
    resolutionMechanism: PoliticalResolutionMechanismSchema,
    openedAtStep: ElapsedStepSchema,
    deadlineStep: ElapsedStepSchema.nullable().default(null),
    resolvedAtStep: ElapsedStepSchema.nullable().default(null),
    visibility: VisibilitySchema,
    voteRecordId: EntityIdSchema.nullable().default(null),
    outcome: PoliticalProcedureOutcomeSchema.nullable().default(null),
    outcomeReason: z.string().trim().max(400).nullable().default(null),
    sourceEventIds: z.array(EntityIdSchema).max(8).default([]),
    resultingEventIds: z.array(EntityIdSchema).max(8).default([]),
  })
  .strict()
  .superRefine((procedure, context) => {
    if (procedure.resolutionMechanism === "vote" && procedure.institutionId === null) {
      context.addIssue({
        code: "custom",
        path: ["institutionId"],
        message: "A vote-resolved procedure must name the institution voting on it.",
      });
    }
    const resolvedStages: PoliticalProcedureStage[] = ["resolved", "withdrawn", "blocked"];
    if (resolvedStages.includes(procedure.stage) && procedure.stage === "resolved" && procedure.outcome === null) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "A resolved procedure must record an outcome." });
    }
    if (!resolvedStages.includes(procedure.stage) && procedure.outcome !== null) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "An unresolved procedure cannot have an outcome yet." });
    }
  });
export type PoliticalProcedure = z.infer<typeof PoliticalProcedureSchema>;

export const SupportPositionKindSchema = z.enum(["character", "group"]);
export const SupportPositionChoiceSchema = z.enum(["support", "oppose", "abstain", "undecided"]);
export const SupportReasonKindSchema = z.enum([
  "belief",
  "relationship",
  "commitment",
  "threat",
  "favour",
  "ideology",
  "group_loyalty",
  "material_interest",
]);

export const SupportReasonSchema = z.object({
  kind: SupportReasonKindSchema,
  label: z.string().trim().min(1).max(200),
  score: SignedScoreSchema,
  sourceId: EntityIdSchema,
});
export type SupportReason = z.infer<typeof SupportReasonSchema>;

/**
 * A canonical, provenance-carrying support/opposition record for one
 * procedure. Records are append-only: the current position for a supporter
 * is its latest row by `changedAtStep`, so a change of mind before resolution
 * is a new row, not a mutation, and the full history survives for diagnostics.
 */
export const SupportPositionSchema = z
  .object({
    id: EntityIdSchema,
    procedureId: EntityIdSchema,
    supporterKind: SupportPositionKindSchema,
    supporterId: EntityIdSchema,
    position: SupportPositionChoiceSchema,
    influenceWeight: z.number().int().nonnegative(),
    visibility: VisibilitySchema,
    reasons: z.array(SupportReasonSchema).max(12),
    provenanceEventIds: z.array(EntityIdSchema).max(8).default([]),
    changedAtStep: ElapsedStepSchema,
  })
  .strict();
export type SupportPosition = z.infer<typeof SupportPositionSchema>;

export const PolityLegitimacySchema = z
  .object({
    polityId: EntityIdSchema,
    legitimacyBps: BasisPointsSchema,
    institutionalConfidenceBps: BasisPointsSchema,
    causes: z.array(PoliticalCauseSchema),
  })
  .strict();
export type PolityLegitimacy = z.infer<typeof PolityLegitimacySchema>;

export const InstitutionLegitimacySchema = z
  .object({
    institutionId: EntityIdSchema,
    legitimacyBps: BasisPointsSchema,
    causes: z.array(PoliticalCauseSchema),
  })
  .strict();
export type InstitutionLegitimacy = z.infer<typeof InstitutionLegitimacySchema>;

export const UnavailablePersonnelGroupSchema = z.object({
  id: EntityIdSchema,
  count: z.number().int().positive(),
  causeKind: z.enum(["sickness", "wounds"]),
  causeId: EntityIdSchema,
  earliestRecoveryStep: ElapsedStepSchema,
});

export const ForcePersonnelCategorySchema = z.object({
  categoryId: EntityIdSchema,
  label: z.string().trim().min(1).max(80),
  fit: z.number().int().nonnegative(),
  unavailable: z.array(UnavailablePersonnelGroupSchema),
});
export type ForcePersonnelCategory = z.infer<typeof ForcePersonnelCategorySchema>;

export const ForcePersonnelEventSchema = z.object({
  id: EntityIdSchema,
  atStep: ElapsedStepSchema,
  kind: z.enum(["reinforcement", "battle_death", "attrition_death", "desertion", "capture", "unavailable", "recovery"]),
  categoryId: EntityIdSchema,
  count: z.number().int().positive(),
  causeId: EntityIdSchema,
});

export const ForceSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  polityId: EntityIdSchema,
  commanderCharacterId: EntityIdSchema,
  controllerCharacterId: EntityIdSchema,
  locationId: EntityIdSchema,
  /** Where within `locationId` this force stands (docs/19 Phase 3); null resolves to the province's default position. */
  positionId: EntityIdSchema.nullable().default(null),
  authorizedStrength: z.number().int().positive(),
  personnel: z.array(ForcePersonnelCategorySchema).min(1),
  moraleBps: BasisPointsSchema,
  cohesionBps: BasisPointsSchema,
  fatigueBps: BasisPointsSchema,
  provisionStatus: z.enum(["provisioned", "shortage", "critical"]),
  provisionedThroughStep: ElapsedStepSchema,
  payObligationId: EntityIdSchema.nullable(),
  payArrearsPeriods: z.number().int().nonnegative(),
  history: z.array(ForcePersonnelEventSchema),
});
export type Force = z.infer<typeof ForceSchema>;

/**
 * Compact, canonical, per-province material state (docs/14 Phase 2:
 * background material society).
 *
 * Bounded/scaled deliberately, matching `Settlement.size`'s "coarse on
 * purpose" values -- this is not a population simulator. `population` and
 * `availableManpower` are counts; every other field is basis points (10 000
 * = full baseline) so recruitment, taxation, war, and recovery can move them
 * by a proportion rather than needing a second unit system.
 */
export const ProvinceMaterialSchema = z
  .object({
    provinceId: EntityIdSchema,
    population: z.number().int().nonnegative(),
    availableManpower: z.number().int().nonnegative(),
    productiveCapacityBps: BasisPointsSchema,
    foodSecurityBps: BasisPointsSchema,
    stabilityBps: BasisPointsSchema,
    taxCapacity: MoneyAmountSchema,
    displacedPopulation: z.number().int().nonnegative(),
    warDamageBps: BasisPointsSchema,
    lastMaterialUpdateStep: ElapsedStepSchema,
  })
  .strict();
export type ProvinceMaterial = z.infer<typeof ProvinceMaterialSchema>;

export const MaterialEffectProposalSchema = z.object({
  sourceEntityId: EntityIdSchema,
  recipientEntityId: EntityIdSchema.nullish(),
  magnitude: z.enum(["minor", "meaningful"]),
  rationale: z.string().trim().min(1).max(400),
});
export type MaterialEffectProposal = z.infer<typeof MaterialEffectProposalSchema>;

/**
 * Borrowed money (VISION §7, §20).
 *
 * Debt could not be represented at all: every amount in the world is
 * non-negative and the tick floors balances at zero, so a treasury simply
 * stopped at nothing and no one was owed anything. §20's chain -- a finance
 * official borrows heavily from merchants, the merchant then demands political
 * concessions -- had no mechanism behind it, because there were no merchants
 * to owe and nothing to owe them.
 *
 * A loan is a liability record, not a negative balance. Servicing it is an
 * ordinary `MoneyObligation` of kind "debt_service", so arrears, priority and
 * missed periods all work exactly as they do for army pay -- which means a debt
 * crisis is already modelled by the machinery that models an unpaid army.
 */
export const LoanSchema = z
  .object({
    id: EntityIdSchema,
    /** "foreign" is money from outside the modelled world -- there is no lender to pay back in person. */
    lenderKind: z.enum(["character", "polity", "foreign"]),
    lenderId: EntityIdSchema.nullable(),
    borrowerAccountId: EntityIdSchema,
    principal: MoneyAmountSchema,
    /** What is still owed. Repayment reduces it; this is the number that matters. */
    outstanding: MoneyAmountSchema,
    interestBps: BasisPointsSchema,
    cadenceSteps: z.number().int().positive().max(36_600),
    /** The obligation that services it, where one was opened. */
    serviceObligationId: EntityIdSchema.nullable().default(null),
    /** What was actually agreed, in words -- often the part that matters politically. */
    terms: z.string().trim().min(1).max(300),
    collateralHoldingId: EntityIdSchema.nullable().default(null),
    status: z.enum(["active", "repaid", "defaulted", "renegotiated"]),
    openedAtStep: ElapsedStepSchema,
  })
  .strict()
  .refine((loan) => loan.lenderKind === "foreign" || loan.lenderId !== null, {
    message: "A loan from someone in this world must name them.",
    path: ["lenderId"],
  });
export type Loan = z.infer<typeof LoanSchema>;

export const MaterialWorldStateSchema = z
  .object({
    currency: CurrencyDefinitionSchema,
    accounts: z.array(MoneyAccountSchema),
    accountAccess: z.array(AccountAccessSchema),
    incomeSources: z.array(IncomeSourceSchema),
    obligations: z.array(MoneyObligationSchema),
    transactions: z.array(MoneyTransactionSchema),
    capturableValues: z.array(CapturableValueSchema),
    holdings: z.array(HoldingSchema),
    institutions: z.array(GovernmentInstitutionSchema),
    reservedPowers: z.array(ReservedPowerRuleSchema),
    motions: z.array(MotionSchema),
    voteRecords: z.array(VoteRecordSchema),
    forces: z.array(ForceSchema),
    eligibilityRequirements: z.array(EligibilityRequirementSchema).default([]),
    politicalGroups: z.array(PoliticalGroupSchema).default([]),
    groupMemberships: z.array(GroupMembershipSchema).default([]),
    officeSeats: z.array(OfficeSeatSchema).default([]),
    politicalProcedures: z.array(PoliticalProcedureSchema).default([]),
    supportPositions: z.array(SupportPositionSchema).default([]),
    polityLegitimacy: z.array(PolityLegitimacySchema).default([]),
    institutionLegitimacy: z.array(InstitutionLegitimacySchema).default([]),
    inheritanceRules: z.array(InheritanceRuleSchema).default([]),
    estates: z.array(EstateSchema).default([]),
    inheritanceTransfers: z.array(InheritanceTransferSchema).default([]),
    // docs/14 Phase 2: background material society, one entry per province.
    // Defaulted so archived snapshots (which never had one) load cleanly;
    // packages/shared/src/material/province-material.ts backfills any
    // missing entry the first time a snapshot is resolved.
    provinceMaterial: z.array(ProvinceMaterialSchema).default([]),
    // docs/32, Part C.3: project fund earmarks. Defaulted so archived
    // snapshots (none of which ever populated this) load cleanly.
    reservations: z.array(MoneyReservationSchema).default([]),
    /** VISION §7: borrowed money, as a liability rather than a negative balance. */
    loans: z.array(LoanSchema).default([]),
  })
  .superRefine((state, context) => {
    const ids = <T extends { id: string }>(values: T[]) => new Set(values.map((value) => value.id));
    const accountIds = ids(state.accounts);
    const incomeIds = ids(state.incomeSources);
    const obligationIds = ids(state.obligations);
    const institutionIds = ids(state.institutions);
    const motionIds = ids(state.motions);
    const groupIds = ids(state.politicalGroups);
    const eligibilityRequirementIds = ids(state.eligibilityRequirements);
    const procedureIds = ids(state.politicalProcedures);
    const holdingIds = ids(state.holdings);
    const inheritanceRuleIds = ids(state.inheritanceRules);
    const estateIds = ids(state.estates);
    const requireReference = (exists: boolean, path: (string | number)[], message: string) => {
      if (!exists) context.addIssue({ code: "custom", path, message });
    };

    const seenOwners = new Set<string>();
    state.accounts.forEach((account, index) => {
      requireReference(account.currencyId === state.currency.id, ["accounts", index, "currencyId"], "Account currency must match the scenario currency.");
      const owner = `${account.owner.kind}:${account.owner.id}`;
      requireReference(!seenOwners.has(owner), ["accounts", index, "owner"], "An owner may have only one M1 money account.");
      seenOwners.add(owner);
    });
    state.accountAccess.forEach((access, index) => {
      requireReference(accountIds.has(access.accountId), ["accountAccess", index, "accountId"], "Account access must reference an existing account.");
    });
    state.incomeSources.forEach((income, index) => {
      requireReference(accountIds.has(income.beneficiaryAccountId), ["incomeSources", index, "beneficiaryAccountId"], "Income must reference an existing beneficiary account.");
    });
    state.obligations.forEach((obligation, index) => {
      requireReference(accountIds.has(obligation.payerAccountId), ["obligations", index, "payerAccountId"], "Obligation payer must exist.");
      if (obligation.recipientAccountId !== undefined) {
        requireReference(accountIds.has(obligation.recipientAccountId), ["obligations", index, "recipientAccountId"], "Obligation recipient must exist.");
      }
    });
    state.holdings.forEach((holding, index) => {
      requireReference(incomeIds.has(holding.incomeSourceId), ["holdings", index, "incomeSourceId"], "A holding must reference an existing income source.");
    });
    state.capturableValues.forEach((value, index) => {
      requireReference(value.currencyId === state.currency.id, ["capturableValues", index, "currencyId"], "Capturable value currency must match the scenario currency.");
    });
    state.reservations.forEach((reservation, index) => {
      requireReference(accountIds.has(reservation.accountId), ["reservations", index, "accountId"], "A reservation must reference an existing account.");
      requireReference(reservation.currencyId === state.currency.id, ["reservations", index, "currencyId"], "Reservation currency must match the scenario currency.");
    });
    state.reservedPowers.forEach((rule, index) => {
      requireReference(institutionIds.has(rule.institutionId), ["reservedPowers", index, "institutionId"], "Reserved power must reference an existing institution.");
    });
    state.motions.forEach((motion, index) => {
      requireReference(institutionIds.has(motion.institutionId), ["motions", index, "institutionId"], "Motion must reference an existing institution.");
    });
    state.voteRecords.forEach((record, index) => {
      requireReference(motionIds.has(record.motionId), ["voteRecords", index, "motionId"], "Vote record must reference an existing motion.");
    });
    state.forces.forEach((force, index) => {
      if (force.payObligationId !== null) {
        requireReference(obligationIds.has(force.payObligationId), ["forces", index, "payObligationId"], "Force pay must reference an existing obligation.");
      }
    });

    // A group's leaderCharacterId is cross-checked against the character list
    // at the WorldState level, not here -- MaterialWorldState has no view of it.
    state.politicalGroups.forEach((group, index) => {
      if (group.resourceAccountId !== null) {
        requireReference(accountIds.has(group.resourceAccountId), ["politicalGroups", index, "resourceAccountId"], "A political group's resource account must exist.");
      }
    });
    state.groupMemberships.forEach((membership, index) => {
      requireReference(groupIds.has(membership.groupId), ["groupMemberships", index, "groupId"], "A group membership must reference an existing political group.");
    });
    const seenSeats = new Set<string>();
    state.officeSeats.forEach((seat, index) => {
      const seatKey = `${seat.officeId}:${seat.seatIndex}`;
      requireReference(!seenSeats.has(seatKey), ["officeSeats", index, "seatIndex"], "An office seat index must be unique per office.");
      seenSeats.add(seatKey);
      seat.eligibilityRequirementIds.forEach((requirementId, requirementIndex) => {
        requireReference(
          eligibilityRequirementIds.has(requirementId),
          ["officeSeats", index, "eligibilityRequirementIds", requirementIndex],
          "An office seat's eligibility requirement must exist.",
        );
      });
      if (seat.appointmentProcedureId !== null) {
        requireReference(procedureIds.has(seat.appointmentProcedureId), ["officeSeats", index, "appointmentProcedureId"], "A seat's appointment procedure must exist.");
      }
      if (seat.removalProcedureId !== null) {
        requireReference(procedureIds.has(seat.removalProcedureId), ["officeSeats", index, "removalProcedureId"], "A seat's removal procedure must exist.");
      }
    });
    state.politicalProcedures.forEach((procedure, index) => {
      if (procedure.institutionId !== null) {
        requireReference(institutionIds.has(procedure.institutionId), ["politicalProcedures", index, "institutionId"], "A procedure's institution must exist.");
      }
      if (procedure.voteRecordId !== null) {
        requireReference(
          state.voteRecords.some((record) => record.id === procedure.voteRecordId),
          ["politicalProcedures", index, "voteRecordId"],
          "A procedure's vote record must exist.",
        );
      }
      procedure.eligibilityRequirementIds.forEach((requirementId, requirementIndex) => {
        requireReference(
          eligibilityRequirementIds.has(requirementId),
          ["politicalProcedures", index, "eligibilityRequirementIds", requirementIndex],
          "A procedure's eligibility requirement must exist.",
        );
      });
    });
    state.supportPositions.forEach((position, index) => {
      requireReference(procedureIds.has(position.procedureId), ["supportPositions", index, "procedureId"], "A support position must reference an existing procedure.");
      if (position.supporterKind === "group") {
        // A body's own voting blocs take sides on its motions exactly as an
        // outside faction does -- and are usually the ones that decide. Either
        // is a real supporter; only a name belonging to neither is an error.
        const isBloc = state.institutions.some((institution) => institution.votingBlocs.some((bloc) => bloc.id === position.supporterId));
        requireReference(
          groupIds.has(position.supporterId) || isBloc,
          ["supportPositions", index, "supporterId"],
          "A group support position must reference an existing political group or voting bloc.",
        );
      }
    });
    state.institutionLegitimacy.forEach((entry, index) => {
      requireReference(institutionIds.has(entry.institutionId), ["institutionLegitimacy", index, "institutionId"], "Institution legitimacy must reference an existing institution.");
    });
    state.inheritanceRules.forEach((rule, index) => {
      if (rule.institutionId !== null) {
        requireReference(institutionIds.has(rule.institutionId), ["inheritanceRules", index, "institutionId"], "An elective inheritance rule must reference an existing institution.");
      }
    });
    state.estates.forEach((estate, index) => {
      requireReference(inheritanceRuleIds.has(estate.inheritanceRuleId), ["estates", index, "inheritanceRuleId"], "An estate must reference an existing inheritance rule.");
      estate.accountIds.forEach((accountId, accountIndex) => {
        requireReference(accountIds.has(accountId), ["estates", index, "accountIds", accountIndex], "An estate must reference existing accounts.");
      });
      estate.holdingIds.forEach((holdingId, holdingIndex) => {
        requireReference(holdingIds.has(holdingId), ["estates", index, "holdingIds", holdingIndex], "An estate must reference existing holdings.");
      });
      estate.obligationIds.forEach((obligationId, obligationIndex) => {
        requireReference(obligationIds.has(obligationId), ["estates", index, "obligationIds", obligationIndex], "An estate must reference existing obligations.");
      });
    });
    state.inheritanceTransfers.forEach((transfer, index) => {
      requireReference(estateIds.has(transfer.estateId), ["inheritanceTransfers", index, "estateId"], "An inheritance transfer must reference an existing estate.");
    });
  });
export type MaterialWorldState = z.infer<typeof MaterialWorldStateSchema>;
