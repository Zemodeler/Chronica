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
  active: z.boolean(),
});
export type IncomeSource = z.infer<typeof IncomeSourceSchema>;

export const MoneyObligationSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["army_pay", "army_upkeep", "salary", "tribute", "pension"]),
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
  ]),
  id: EntityIdSchema,
  explanation: z.string().trim().min(1).max(240),
});

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

export const MaterialEffectProposalSchema = z.object({
  sourceEntityId: EntityIdSchema,
  recipientEntityId: EntityIdSchema.nullish(),
  magnitude: z.enum(["minor", "meaningful"]),
  rationale: z.string().trim().min(1).max(400),
});
export type MaterialEffectProposal = z.infer<typeof MaterialEffectProposalSchema>;

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
  })
  .superRefine((state, context) => {
    const ids = <T extends { id: string }>(values: T[]) => new Set(values.map((value) => value.id));
    const accountIds = ids(state.accounts);
    const incomeIds = ids(state.incomeSources);
    const obligationIds = ids(state.obligations);
    const institutionIds = ids(state.institutions);
    const motionIds = ids(state.motions);
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
  });
export type MaterialWorldState = z.infer<typeof MaterialWorldStateSchema>;
