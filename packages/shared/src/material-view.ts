import { z } from "zod";
import {
  AccountPermissionSchema,
  EntityIdSchema,
  MoneyAmountSchema,
  VisibilitySchema,
} from "./material-state";

export const MoneyChangeViewSchema = z.object({
  id: EntityIdSchema,
  label: z.string().trim().min(1),
  amount: z.number().int().safe(),
  whenLabel: z.string().trim().min(1),
});

export const AccountViewSchema = z.object({
  id: EntityIdSchema,
  label: z.string().trim().min(1),
  balance: MoneyAmountSchema,
  permissions: z.array(AccountPermissionSchema),
  status: z.enum(["active", "locked", "closed"]),
  recentChanges: z.array(MoneyChangeViewSchema),
});

export const IncomeViewSchema = z.object({
  id: EntityIdSchema,
  label: z.string().trim().min(1),
  amount: MoneyAmountSchema,
  cadenceLabel: z.string().trim().min(1),
  nextDueLabel: z.string().trim().min(1),
  collectionStatus: z.enum(["collectible", "impaired", "suspended"]),
});

export const HoldingViewSchema = z.object({
  id: EntityIdSchema,
  title: z.string().trim().min(1),
  territoryLabel: z.string().trim().min(1),
  controlLabel: z.string().trim().min(1),
  incomeLabel: z.string().trim().min(1),
});

export const VotingBlocViewSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1),
  weight: z.number().int().positive(),
  vote: z.enum(["yes", "no", "abstain", "not_cast"]),
  reason: z.string().trim().min(1),
});

export const GovernmentViewSchema = z.object({
  institutionName: z.string().trim().min(1),
  reservedPowers: z.array(z.string().trim().min(1)),
  motionLabel: z.string().trim().min(1).optional(),
  motionStatus: z.enum(["none", "pending", "passed", "failed", "withdrawn"]),
  quorumLabel: z.string().trim().min(1).optional(),
  blocs: z.array(VotingBlocViewSchema),
});

export const ForceViewSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1),
    authorizedStrength: z.number().int().positive(),
    totalHeadcount: z.number().int().nonnegative(),
    fitStrength: z.number().int().nonnegative(),
    effectiveStrength: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
    provisionLabel: z.string().trim().min(1),
    provisionedThroughLabel: z.string().trim().min(1),
    payStatus: z.string().trim().min(1),
    changeExplanation: z.string().trim().min(1),
  })
  .refine((force) => force.fitStrength + force.unavailable === force.totalHeadcount, {
    message: "Total headcount must equal fit plus unavailable personnel.",
    path: ["totalHeadcount"],
  });

export const OrderReadbackSchema = z.object({
  payerLabel: z.string().trim().min(1),
  cost: MoneyAmountSchema,
  approvalLabel: z.string().trim().min(1),
});

export const MaterialWorldViewModelSchema = z.object({
  characterName: z.string().trim().min(1),
  currencyName: z.string().trim().min(1),
  currencySymbol: z.string().trim().min(1).optional(),
  personalAccount: AccountViewSchema,
  accessibleTreasuries: z.array(AccountViewSchema),
  income: z.array(IncomeViewSchema),
  holdings: z.array(HoldingViewSchema),
  government: GovernmentViewSchema,
  forces: z.array(ForceViewSchema),
  orderReadback: OrderReadbackSchema,
  visibility: VisibilitySchema,
});
export type MaterialWorldViewModel = z.infer<typeof MaterialWorldViewModelSchema>;

export const OrderDraftSchema = z.object({
  order: z.string().trim().min(3).max(4_000),
});
export type OrderDraft = z.infer<typeof OrderDraftSchema>;
