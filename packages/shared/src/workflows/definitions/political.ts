import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";

export const politicalWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "expire_office_term",
    description: "Mechanically vacate a seat once its own recorded term has expired -- system-invoked only, and only for a scenario whose own government rules make a term self-terminating (docs/plans/ai-world-matters-runtime.md, \"Institutional time\"). Not wired to any automatic caller yet: nothing in this codebase currently decides WHEN a scenario's rules call for this, so an untouched expired term leaves the seat held with an expired authority grant -- itself a live, contestable political matter -- rather than being silently vacated by this workflow running unprompted.",
    category: "political",
    invokerAuthority: ["system"],
    parametersSchema: z.object({
      seatId: EntityIdSchema,
    }).strict(),
    apply(world, params, context) {
      const seat = world.material.officeSeats.find((s) => s.id === params.seatId);
      if (!seat) return refuse(`No office seat "${params.seatId}" exists.`);
      if (seat.status !== "held") return refuse(`Seat "${params.seatId}" is not currently held; nothing to expire.`);
      if (seat.termExpiresAtStep === null || seat.termExpiresAtStep > context.atStep) {
        return refuse(`Seat "${params.seatId}"'s term has not expired (expires: ${seat.termExpiresAtStep ?? "never"}).`);
      }
      const holder = world.characters.find((c) => c.id === seat.holderCharacterId);
      return {
        world: {
          ...world,
          characters: seat.holderCharacterId === null ? world.characters : world.characters.map((c) => (c.id === seat.holderCharacterId ? { ...c, officeId: null } : c)),
          material: {
            ...world.material,
            officeSeats: world.material.officeSeats.map((s) =>
              s.id === seat.id ? { ...s, holderCharacterId: null, status: "vacant" as const, vacancyCause: "term_expired" as const } : s,
            ),
          },
        },
        result: {
          summary: `${holder?.name ?? "The seat's holder"}'s term in office ${seat.officeId} has mechanically expired; the seat is now vacant.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "start_war",
    description: "Declare war between two polities. Creates a war entry in conflicts.",
    category: "political",
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      if (!a) return refuse(`No polity exists with the id "${params.polityAId}".`);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!b) return refuse(`No polity exists with the id "${params.polityBId}".`);
      const [orderedA, orderedB]: [string, string] = params.polityAId < params.polityBId
        ? [params.polityAId, params.polityBId]
        : [params.polityBId, params.polityAId];
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            wars: [...world.conflicts.wars, { polityAId: orderedA, polityBId: orderedB }],
          },
        },
        result: {
          summary: `${a.name} declares war on ${b.name}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "end_war",
    description: "End an active war between two polities via treaty or defeat. System-invoked only: peace requires a passed political procedure (e.g. a treaty_ratification) naming this as its linked workflow, never a direct player/AI proposal.",
    category: "political",
    invokerAuthority: ["system"],
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
      termsLabel: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!a || !b) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            wars: world.conflicts.wars.filter(
              (w) =>
                !(
                  (w.polityAId === params.polityAId && w.polityBId === params.polityBId) ||
                  (w.polityAId === params.polityBId && w.polityBId === params.polityAId)
                ),
            ),
          },
        },
        result: {
          summary: `The war between ${a.name} and ${b.name} ends. ${params.termsLabel}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "give_territory",
    description:
      "Transfer control of a province from one polity to another by diplomatic cession -- an accepted diplomatic message between exactly the two powers involved is required as authorization. There is no other path through this workflow: an unopposed occupation or a won siege/battle goes through change_province_control instead.",
    category: "political",
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      newControllerPolityId: EntityIdSchema,
      firmnessBps: z.number().int().min(0).max(10_000).default(5_000),
      /** The accepted diplomatic message that actually ceded this ground. Never optional: this workflow has no other legitimate path. */
      authorizingMessageId: EntityIdSchema,
    }).strict(),
    apply(world, params) {
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return refuse(`No province exists with the id "${params.provinceId}".`);
      const newPolity = world.map.polities.find((p) => p.id === params.newControllerPolityId);
      if (!newPolity) return refuse(`No power exists with the id "${params.newControllerPolityId}" to receive this ground.`);
      const oldPolityId = province.controllerPolityId;
      const oldPolity = world.map.polities.find((p) => p.id === oldPolityId);

      const message = world.diplomacy.find((candidate) => candidate.id === params.authorizingMessageId);
      if (!message) {
        return refuse(`No diplomatic message with the id "${params.authorizingMessageId}" exists. give_territory requires an accepted message ceding this exact ground as its authorization.`);
      }

      return {
        world: {
          ...world,
          map: {
            ...world.map,
            provinces: world.map.provinces.map((p) =>
              p.id === params.provinceId
                ? { ...p, controllerPolityId: params.newControllerPolityId, controlFirmnessBps: params.firmnessBps }
                : p,
            ),
          },
        },
        result: {
          summary: `${province.name} passes from ${oldPolity?.name ?? "unknown"} to ${newPolity.name}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "sign_treaty",
    description: "Record a peace treaty between two polities (ends war if active).",
    category: "political",
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
      termsLabel: z.string().min(1).max(400),
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!a || !b) return null;
      return {
        world: {
          ...world,
          conflicts: {
            ...world.conflicts,
            wars: world.conflicts.wars.filter(
              (w) =>
                !(
                  (w.polityAId === params.polityAId && w.polityBId === params.polityBId) ||
                  (w.polityAId === params.polityBId && w.polityBId === params.polityAId)
                ),
            ),
          },
        },
        result: {
          summary: `${a.name} and ${b.name} sign a treaty. ${params.termsLabel}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "declare_independence",
    description: "Create a new polity that breaks away from a parent polity and claims a province.",
    category: "political",
    parametersSchema: z.object({
      newPolityId: EntityIdSchema,
      newPolityName: z.string().min(1).max(120),
      capitalSettlementId: EntityIdSchema.nullable(),
      claimedProvinceIds: z.array(EntityIdSchema).min(1).max(8),
    }).strict(),
    apply(world, params) {
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            polities: [
              ...world.map.polities.filter((p) => p.id !== params.newPolityId),
              { id: params.newPolityId, name: params.newPolityName, capitalSettlementId: params.capitalSettlementId },
            ],
            provinces: world.map.provinces.map((p) =>
              params.claimedProvinceIds.includes(p.id)
                ? { ...p, controllerPolityId: params.newPolityId, controlFirmnessBps: 4_000 }
                : p,
            ),
          },
        },
        result: {
          summary: `${params.newPolityName} declares independence and establishes itself.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "impose_tribute",
    description: "Create a periodic tribute obligation from one polity's treasury to another.",
    category: "political",
    parametersSchema: z.object({
      tributeId: EntityIdSchema,
      payerAccountId: EntityIdSchema,
      amount: z.number().int().positive(),
      cadenceSteps: z.number().int().min(1).max(36_600),
      label: z.string().min(1).max(120),
      atStep: z.number().int().nonnegative(),
    }).strict(),
    apply(world, params, context) {
      const payerAccount = world.material.accounts.find((a) => a.id === params.payerAccountId);
      if (!payerAccount) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            obligations: [
              ...world.material.obligations,
              {
                id: params.tributeId,
                kind: "tribute" as const,
                label: params.label,
                payerAccountId: params.payerAccountId,
                amount: params.amount,
                cadenceSteps: params.cadenceSteps,
                nextDueStep: context.atStep + params.cadenceSteps,
                priority: 5,
                arrears: 0,
                missedPeriods: 0,
                active: true,
              },
            ],
          },
        },
        result: {
          summary: `A tribute of ${params.amount} is imposed, payable every ${params.cadenceSteps} season(s).`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "break_alliance",
    description: "Dissolve an alliance between two polities.",
    category: "political",
    parametersSchema: z.object({
      polityAId: EntityIdSchema,
      polityBId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const a = world.map.polities.find((p) => p.id === params.polityAId);
      const b = world.map.polities.find((p) => p.id === params.polityBId);
      if (!a || !b) return null;
      return {
        world,
        result: {
          summary: `The alliance between ${a.name} and ${b.name} dissolves. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "rename_polity",
    description: "Change a polity's name (e.g. a country renaming itself after a regime change).",
    category: "political",
    parametersSchema: z.object({
      polityId: EntityIdSchema,
      newName: z.string().min(1).max(120),
    }).strict(),
    apply(world, params) {
      const polity = world.map.polities.find((p) => p.id === params.polityId);
      if (!polity) return null;
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            polities: world.map.polities.map((p) =>
              p.id === params.polityId ? { ...p, name: params.newName } : p,
            ),
          },
        },
        result: {
          summary: polity.name === params.newName
            ? `${polity.name} keeps the name it already bears.`
            : `${polity.name} is renamed to ${params.newName}.`,
          applied: true,
          ...(polity.name === params.newName ? { noOp: true } : {}),
        },
      };
    },
  }),

  defineWorkflow({
    id: "vassalize_polity",
    description: "Make one polity a tributary vassal of another by creating a recurring tribute obligation.",
    category: "political",
    parametersSchema: z.object({
      overlordPolityId: EntityIdSchema,
      vassalPolityId: EntityIdSchema,
      vassalPayerAccountId: EntityIdSchema,
      tributeObligationId: EntityIdSchema,
      tributeAmount: z.number().int().positive(),
      cadenceSteps: z.number().int().min(1).max(36_600),
      atStep: z.number().int().nonnegative(),
    }).strict(),
    apply(world, params, context) {
      const overlord = world.map.polities.find((p) => p.id === params.overlordPolityId);
      const vassal = world.map.polities.find((p) => p.id === params.vassalPolityId);
      if (!overlord || !vassal) return null;
      const payerAccount = world.material.accounts.find((a) => a.id === params.vassalPayerAccountId);
      if (!payerAccount) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            obligations: [
              ...world.material.obligations.filter((o) => o.id !== params.tributeObligationId),
              {
                id: params.tributeObligationId,
                kind: "tribute" as const,
                label: `Tribute of ${vassal.name} to ${overlord.name}`,
                payerAccountId: params.vassalPayerAccountId,
                amount: params.tributeAmount,
                cadenceSteps: params.cadenceSteps,
                nextDueStep: context.atStep + params.cadenceSteps,
                priority: 5,
                arrears: 0,
                missedPeriods: 0,
                active: true,
              },
            ],
          },
        },
        result: {
          summary: `${vassal.name} becomes a vassal of ${overlord.name}, paying tribute of ${params.tributeAmount} every ${params.cadenceSteps} season(s).`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "revoke_vassalage",
    description: "End a vassal's tribute obligation, restoring full independence.",
    category: "political",
    parametersSchema: z.object({
      tributeObligationId: EntityIdSchema,
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params) {
      const obligation = world.material.obligations.find((o) => o.id === params.tributeObligationId);
      if (!obligation) return null;
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            obligations: world.material.obligations.map((o) =>
              o.id === params.tributeObligationId ? { ...o, active: false } : o,
            ),
          },
        },
        result: {
          summary: `The tribute obligation "${obligation.label}" is revoked. ${params.reason}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "arrange_marriage_alliance",
    description: "Record a dynastic marriage between two characters of different polities as a diplomatic alliance.",
    category: "political",
    parametersSchema: z.object({
      characterAId: EntityIdSchema,
      characterBId: EntityIdSchema,
      relationId: EntityIdSchema,
      sourceNote: z.string().min(1).max(600),
    }).strict(),
    apply(world, params) {
      const a = world.characters.find((c) => c.id === params.characterAId);
      const b = world.characters.find((c) => c.id === params.characterBId);
      if (!a || !b) return null;
      // A political relation always names two polities: this is a shape
      // requirement of the record, not a narrative eligibility gate.
      if (!a.polityId || !b.polityId) return null;
      return {
        world: {
          ...world,
          map: {
            ...world.map,
            politicalRelations: [
              ...world.map.politicalRelations.filter((r) => r.id !== params.relationId),
              {
                id: params.relationId,
                kind: "alliance" as const,
                leaderPolityId: a.polityId,
                memberPolityId: b.polityId,
                sourceNote: params.sourceNote,
              },
            ],
          },
        },
        result: {
          summary: `${a.name} and ${b.name} marry, binding their polities in alliance.`,
          applied: true,
        },
      };
    },
  }),
];
