import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import type { AnyWorkflowDefinition } from "../types";

const randomUUID = () => globalThis.crypto.randomUUID();

export const economicWorkflows: AnyWorkflowDefinition[] = [
  {
    id: "add_gold",
    description: "Add money to a character or polity account (income, spoils, gift, etc.).",
    category: "economic",
    parametersSchema: z.object({
      accountId: EntityIdSchema,
      amount: z.number().int().positive(),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const account = world.material.accounts.find((a) => a.id === params.accountId);
      if (!account) return null;
      const txId = randomUUID();
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            accounts: world.material.accounts.map((a) =>
              a.id === params.accountId ? { ...a, balance: a.balance + params.amount } : a,
            ),
            transactions: [
              ...world.material.transactions,
              {
                id: txId,
                atStep: context.atStep,
                kind: "income" as const,
                amount: params.amount,
                destinationAccountId: params.accountId,
                cause: {
                  kind: "action" as const,
                  id: context.actorId,
                  explanation: params.reason,
                },
                visibility: "private" as const,
              },
            ],
          },
        },
        result: {
          summary: `${params.amount} added to account: ${params.reason}`,
          applied: true,
        },
      };
    },
  },

  {
    id: "remove_gold",
    description: "Remove money from a character or polity account (loss, tax, purchase, etc.).",
    category: "economic",
    parametersSchema: z.object({
      accountId: EntityIdSchema,
      amount: z.number().int().positive(),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const account = world.material.accounts.find((a) => a.id === params.accountId);
      if (!account) return null;
      const actual = Math.min(params.amount, account.balance);
      if (actual === 0) return null;
      const txId = randomUUID();
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            accounts: world.material.accounts.map((a) =>
              a.id === params.accountId ? { ...a, balance: a.balance - actual } : a,
            ),
            transactions: [
              ...world.material.transactions,
              {
                id: txId,
                atStep: context.atStep,
                kind: "purchase" as const,
                amount: actual,
                sourceAccountId: params.accountId,
                cause: {
                  kind: "action" as const,
                  id: context.actorId,
                  explanation: params.reason,
                },
                visibility: "private" as const,
              },
            ],
          },
        },
        result: {
          summary: `${actual} removed from account: ${params.reason}`,
          applied: true,
        },
      };
    },
  },

  {
    id: "transfer_gold",
    description: "Transfer money from one account to another.",
    category: "economic",
    parametersSchema: z.object({
      sourceAccountId: EntityIdSchema,
      destinationAccountId: EntityIdSchema,
      amount: z.number().int().positive(),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const src = world.material.accounts.find((a) => a.id === params.sourceAccountId);
      const dst = world.material.accounts.find((a) => a.id === params.destinationAccountId);
      if (!src || !dst) return null;
      const actual = Math.min(params.amount, src.balance);
      if (actual === 0) return null;
      const txId = randomUUID();
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            accounts: world.material.accounts.map((a) => {
              if (a.id === params.sourceAccountId) return { ...a, balance: a.balance - actual };
              if (a.id === params.destinationAccountId) return { ...a, balance: a.balance + actual };
              return a;
            }),
            transactions: [
              ...world.material.transactions,
              {
                id: txId,
                atStep: context.atStep,
                kind: "transfer" as const,
                amount: actual,
                sourceAccountId: params.sourceAccountId,
                destinationAccountId: params.destinationAccountId,
                cause: {
                  kind: "action" as const,
                  id: context.actorId,
                  explanation: params.reason,
                },
                visibility: "private" as const,
              },
            ],
          },
        },
        result: {
          summary: `${actual} transferred: ${params.reason}`,
          applied: true,
        },
      };
    },
  },

  {
    id: "create_income_source",
    description: "Create a new recurring income source for an account.",
    category: "economic",
    parametersSchema: z.object({
      incomeSourceId: EntityIdSchema,
      label: z.string().min(1).max(120),
      kind: z.enum(["land", "office", "trade", "pension", "tax"]),
      beneficiaryAccountId: EntityIdSchema,
      originKind: z.enum(["holding", "office", "position", "polity"]),
      originId: EntityIdSchema,
      amount: z.number().int().positive(),
      cadenceSteps: z.number().int().min(1).max(36_600),
    }).strict(),
    apply(world, params, context) {
      const account = world.material.accounts.find((a) => a.id === params.beneficiaryAccountId);
      if (!account) return null;
      const alreadyExists = world.material.incomeSources.some((s) => s.id === params.incomeSourceId);
      if (alreadyExists) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            incomeSources: [
              ...world.material.incomeSources,
              {
                id: params.incomeSourceId,
                kind: params.kind,
                label: params.label,
                beneficiaryAccountId: params.beneficiaryAccountId,
                originKind: params.originKind,
                originId: params.originId,
                amount: params.amount,
                cadenceSteps: params.cadenceSteps,
                nextDueStep: context.atStep + params.cadenceSteps,
                collectionRateBps: 10_000,
                active: true,
              },
            ],
          },
        },
        result: {
          summary: `New income source established: ${params.label} (${params.amount}/season).`,
          applied: true,
        },
      };
    },
  },

  {
    id: "cancel_income_source",
    description: "Deactivate a recurring income source.",
    category: "economic",
    parametersSchema: z.object({
      incomeSourceId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const source = world.material.incomeSources.find((s) => s.id === params.incomeSourceId);
      if (!source) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            incomeSources: world.material.incomeSources.map((s) =>
              s.id === params.incomeSourceId ? { ...s, active: false } : s,
            ),
          },
        },
        result: {
          summary: `Income source "${source.label}" cancelled.`,
          applied: true,
        },
      };
    },
  },
];
