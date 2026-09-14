import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { availableBalance } from "../../world/money-reservations";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";

const randomUUID = () => globalThis.crypto.randomUUID();

/**
 * `collect_revenue`'s sanity band (docs/plans/ai-world-matters-runtime.md,
 * "Revenue assessment flow"): a claimed amount beyond this multiple of the
 * source's own declared per-period amount is refused, named anchors and
 * all, rather than silently accepted or silently clamped -- clamping would
 * make the engine the decider of the number, which the doc explicitly
 * forbids. A single named constant so the band stays auditable and is
 * revisited in one place after playtesting, not scattered as a magic number.
 */
const COLLECT_REVENUE_SANITY_BAND_MULTIPLE = 3;

export const economicWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "add_gold",
    description: "Add money to a character or polity account. Restricted: every call must cite where the money genuinely comes from (docs/plans/ai-world-matters-runtime.md, \"Treasury and monetary provenance\") -- scenario setup, a data migration, or (in normal play) collect_revenue's own provenance-checked path. Not a general-purpose way to credit an account; an NPC or character-directed proposal is refused outright.",
    category: "economic",
    // System/world-director only (docs/plans/ai-world-matters-runtime.md,
    // invariant 7: "Money entering a tracked account has provenance"). A
    // character-directed or NPC-originated call is refused before `apply`
    // ever runs (`commandKindOf`/`invokerSatisfiesAuthority`,
    // `workflows/policy.ts`) -- normal play credits an account only through
    // collect_revenue's own validated path.
    invokerAuthority: ["world_director", "system"],
    parametersSchema: z.object({
      accountId: EntityIdSchema,
      amount: z.number().int().positive(),
      reason: z.string().min(1).max(240),
      /**
       * Where this money genuinely comes from. `scenario_setup`/`migration`
       * are for authored opening balances and snapshot repair, never for
       * ordinary play; `abstract_economy` names the exact `IncomeSource`
       * `collect_revenue` would otherwise have credited, for the rare case
       * a caller must apply that same crediting outside the workflow path
       * (e.g. deterministic tooling) -- it does not re-run collect_revenue's
       * own period/idempotence/sanity-band checks, so use collect_revenue
       * directly whenever that is possible.
       */
      provenance: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("scenario_setup") }).strict(),
        z.object({ kind: z.literal("migration") }).strict(),
        z.object({ kind: z.literal("abstract_economy"), incomeSourceId: EntityIdSchema }).strict(),
      ]),
    }).strict(),
    apply(world, params, context) {
      const account = world.material.accounts.find((a) => a.id === params.accountId);
      if (!account) return refuse(`No account "${params.accountId}" exists.`);
      const provenance = params.provenance;
      if (provenance.kind === "abstract_economy") {
        const source = world.material.incomeSources.find((s) => s.id === provenance.incomeSourceId);
        if (!source) return refuse(`No income source "${provenance.incomeSourceId}" exists; cite a real source or use scenario_setup/migration.`);
      }
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
                cause: provenance.kind === "abstract_economy"
                  ? { kind: "scheduled_income" as const, id: provenance.incomeSourceId, explanation: params.reason }
                  : { kind: "action" as const, id: context.actorId, explanation: params.reason },
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
  }),

  defineWorkflow({
    id: "collect_revenue",
    description: "Collect one due period's revenue from an income source into its beneficiary account. Refuses if the source is not yet due, is inactive, or this period was already collected -- validates the claimed amount against a sanity band anchored to the source's own declared amount rather than accepting any figure. Partial or no collection is a legitimate choice: use record_revenue_shortfall to record that this period yielded nothing without crediting anything.",
    category: "economic",
    invokerAuthority: ["player", "character_director"],
    parametersSchema: z.object({
      incomeSourceId: EntityIdSchema,
      amount: z.number().int().positive(),
      reason: z.string().min(1).max(240),
      /** A matter this collection answers, if any (docs/plans/ai-world-matters-runtime.md, Phase 3) -- purely informational here; matters.ts's own session hook links the resulting fact, not this parameter. */
      standingPlanId: EntityIdSchema.nullable().optional(),
    }).strict(),
    duration: { minimumDays: 7, likelyDays: 21, maximumDays: 60 },
    apply(world, params, context) {
      const source = world.material.incomeSources.find((s) => s.id === params.incomeSourceId);
      if (!source) return refuse(`No income source "${params.incomeSourceId}" exists.`);
      if (!source.active) return refuse(`Income source "${params.incomeSourceId}" is not active.`);
      if (source.nextDueStep > context.atStep) {
        return refuse(`Income source "${params.incomeSourceId}" is not yet due; its next collection is step ${source.nextDueStep}.`);
      }
      const account = world.material.accounts.find((a) => a.id === source.beneficiaryAccountId);
      if (!account || account.status !== "active") return refuse(`Beneficiary account "${source.beneficiaryAccountId}" is not open to receive this.`);
      // A departure from the source's own declared amount is not forbidden
      // -- a governor may collect more or less than the anchor -- but an
      // incoherent figure is refused rather than silently accepted, per the
      // doc's "Validation should prevent incoherent values without reducing
      // revenue to one mandatory formula." The band is a named constant so
      // it stays auditable, not a hidden heuristic.
      const sanityCeiling = source.amount * COLLECT_REVENUE_SANITY_BAND_MULTIPLE;
      if (params.amount > sanityCeiling) {
        return refuse(
          `${params.amount} is far beyond this source's own declared yield (${source.amount}/period). `
          + `If circumstances genuinely support that much, cite the grounds; otherwise collect within a plausible range of ${source.amount}.`,
        );
      }
      const txId = randomUUID();
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            accounts: world.material.accounts.map((a) =>
              a.id === source.beneficiaryAccountId ? { ...a, balance: a.balance + params.amount } : a,
            ),
            incomeSources: world.material.incomeSources.map((s) =>
              s.id === source.id ? { ...s, nextDueStep: s.nextDueStep + s.cadenceSteps } : s,
            ),
            transactions: [
              ...world.material.transactions,
              {
                id: txId,
                atStep: context.atStep,
                kind: source.kind === "tax" ? "tax" as const : "income" as const,
                amount: params.amount,
                destinationAccountId: source.beneficiaryAccountId,
                cause: { kind: "scheduled_income" as const, id: source.id, explanation: params.reason },
                visibility: "polity" as const,
              },
            ],
          },
        },
        result: {
          summary: `${params.amount} collected from "${source.label}" into ${source.beneficiaryAccountId}: ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "record_revenue_shortfall",
    description: "Record that a due income source's period passed uncollected -- an authorized actor's explicit decision not to collect (or an acknowledgment that nothing was collectable), not a silent skip. Credits nothing; only advances the source past this period and leaves a factual record of the choice.",
    category: "economic",
    invokerAuthority: ["player", "character_director"],
    parametersSchema: z.object({
      incomeSourceId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const source = world.material.incomeSources.find((s) => s.id === params.incomeSourceId);
      if (!source) return refuse(`No income source "${params.incomeSourceId}" exists.`);
      if (!source.active) return refuse(`Income source "${params.incomeSourceId}" is not active.`);
      if (source.nextDueStep > context.atStep) {
        return refuse(`Income source "${params.incomeSourceId}" is not yet due; its next collection is step ${source.nextDueStep}.`);
      }
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            incomeSources: world.material.incomeSources.map((s) =>
              s.id === source.id ? { ...s, nextDueStep: s.nextDueStep + s.cadenceSteps } : s,
            ),
          },
        },
        result: {
          summary: `No revenue collected from "${source.label}" this period: ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "pay_obligation",
    description: "Pay toward a money obligation (army pay, upkeep, salary, tribute, pension) from its recorded payer account. Partial payment is a first-class outcome: pays exactly what is offered, up to what is currently owed and what the account can actually spend -- never more. The remaining balance stays on the obligation's own arrears.",
    category: "economic",
    invokerAuthority: ["player", "character_director"],
    parametersSchema: z.object({
      obligationId: EntityIdSchema,
      /**
       * Named explicitly, not merely read off the obligation record: this
       * is what `DEFAULT_AUTHORITY_REQUIREMENTS`'s scope-param authority
       * gate and `claimedResourcesForStage`'s generic resource-claim
       * detection (both keyed off a call's own parameter names) need to
       * treat this exactly like `transfer_gold`'s `sourceAccountId`. Must
       * match the obligation's own recorded `payerAccountId` or the call
       * refuses -- naming a different account never redirects the payment.
       */
      payerAccountId: EntityIdSchema,
      amount: z.number().int().positive(),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const obligation = world.material.obligations.find((o) => o.id === params.obligationId);
      if (!obligation) return refuse(`No obligation "${params.obligationId}" exists.`);
      if (!obligation.active) return refuse(`Obligation "${params.obligationId}" is not active.`);
      if (params.payerAccountId !== obligation.payerAccountId) {
        return refuse(`Account "${params.payerAccountId}" is not the recorded payer of obligation "${params.obligationId}" (that is "${obligation.payerAccountId}").`);
      }
      const payerAccount = world.material.accounts.find((a) => a.id === obligation.payerAccountId);
      if (!payerAccount) return refuse(`No payer account "${obligation.payerAccountId}" exists for this obligation.`);
      const dueThisPeriod = obligation.nextDueStep <= context.atStep ? obligation.amount : 0;
      const totalOwed = obligation.arrears + dueThisPeriod;
      if (totalOwed <= 0) return refuse(`Nothing is currently owed on obligation "${params.obligationId}".`);
      const payable = Math.min(params.amount, totalOwed, availableBalance(world.material, obligation.payerAccountId));
      if (payable <= 0) return refuse(`Account "${obligation.payerAccountId}" has no available balance to pay this obligation.`);
      const remainingOwed = totalOwed - payable;
      // Only a payment that covers this period's own due amount in full
      // counts as meeting the period -- advancing nextDueStep and clearing
      // missedPeriods. A payment that only reduces standing arrears, or
      // only partially covers what's newly due, leaves both where they
      // were; the remainder stays legible on `arrears` either way.
      const periodMet = dueThisPeriod > 0 && payable >= dueThisPeriod;
      const txId = randomUUID();
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            accounts: world.material.accounts.map((a) => {
              if (a.id === obligation.payerAccountId) return { ...a, balance: a.balance - payable };
              if (obligation.recipientAccountId !== undefined && a.id === obligation.recipientAccountId) return { ...a, balance: a.balance + payable };
              return a;
            }),
            obligations: world.material.obligations.map((o) =>
              o.id === obligation.id
                ? { ...o, arrears: remainingOwed, nextDueStep: periodMet ? o.nextDueStep + o.cadenceSteps : o.nextDueStep, missedPeriods: periodMet ? 0 : o.missedPeriods }
                : o,
            ),
            transactions: [
              ...world.material.transactions,
              {
                id: txId,
                atStep: context.atStep,
                kind: "upkeep" as const,
                amount: payable,
                sourceAccountId: obligation.payerAccountId,
                ...(obligation.recipientAccountId !== undefined ? { destinationAccountId: obligation.recipientAccountId } : {}),
                cause: { kind: "obligation" as const, id: obligation.id, explanation: params.reason },
                visibility: "polity" as const,
              },
            ],
          },
        },
        result: {
          summary: remainingOwed > 0
            ? `${payable} of ${totalOwed} owed paid on "${obligation.label}"; ${remainingOwed} remains outstanding.`
            : `${payable} paid on "${obligation.label}" in full: ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "restructure_obligation",
    description: "Change a money obligation's recorded terms (amount, cadence, or active status) going forward -- a negotiated settlement, a renegotiated tribute, or winding one down. Moves no money; only the obligation's own recorded terms change, with a cited reason.",
    category: "economic",
    invokerAuthority: ["player", "character_director"],
    parametersSchema: z.object({
      obligationId: EntityIdSchema,
      amount: z.number().int().positive().optional(),
      cadenceSteps: z.number().int().positive().max(36_600).optional(),
      active: z.boolean().optional(),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const obligation = world.material.obligations.find((o) => o.id === params.obligationId);
      if (!obligation) return refuse(`No obligation "${params.obligationId}" exists.`);
      if (params.amount === undefined && params.cadenceSteps === undefined && params.active === undefined) {
        return refuse("Name at least one of amount, cadenceSteps, or active to change.");
      }
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            obligations: world.material.obligations.map((o) =>
              o.id === obligation.id
                ? {
                  ...o,
                  ...(params.amount !== undefined ? { amount: params.amount } : {}),
                  ...(params.cadenceSteps !== undefined ? { cadenceSteps: params.cadenceSteps } : {}),
                  ...(params.active !== undefined ? { active: params.active } : {}),
                }
                : o,
            ),
          },
        },
        result: {
          summary: `Obligation "${obligation.label}" restructured: ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
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
      // docs/32, Part C.3: never spend into what a project has already
      // reserved -- `availableBalance` excludes every active reservation's
      // remaining hold, so this can transfer less than the account's raw
      // balance shows even when the account itself is never touched here.
      const actual = Math.min(params.amount, availableBalance(world.material, params.sourceAccountId));
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
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
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
  }),

  defineWorkflow({
    id: "grant_holding",
    description: "Grant a character legal holder rights over a territory-linked holding tied to an income source.",
    category: "economic",
    parametersSchema: z.object({
      holdingId: EntityIdSchema,
      title: z.string().min(1).max(120),
      territoryId: EntityIdSchema,
      legalHolderCharacterId: EntityIdSchema,
      incomeSourceId: EntityIdSchema,
      successionRuleId: EntityIdSchema,
      physicalControlBps: z.number().int().min(0).max(10_000).default(10_000),
    }).strict(),
    apply(world, params) {
      if (world.material.holdings.some((h) => h.id === params.holdingId)) return null;
      const holder = world.characters.find((c) => c.id === params.legalHolderCharacterId);
      if (!holder) return null;
      const incomeSource = world.material.incomeSources.find((s) => s.id === params.incomeSourceId);
      if (!incomeSource) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            holdings: [
              ...world.material.holdings,
              {
                id: params.holdingId,
                title: params.title,
                territoryId: params.territoryId,
                legalHolderCharacterId: params.legalHolderCharacterId,
                incomeSourceId: params.incomeSourceId,
                successionRuleId: params.successionRuleId,
                physicalControlBps: params.physicalControlBps,
              },
            ],
          },
        },
        result: {
          summary: `${holder.name} is granted the holding "${params.title}".`,
          applied: true,
        },
      };
    },
  }),
];
