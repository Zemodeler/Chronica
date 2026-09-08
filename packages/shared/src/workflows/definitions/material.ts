import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";
import { findProvinceMaterial, applyRecruitmentToMaterial, applyTaxationDraw } from "../../material/province-material";
import { adjustPolityLegitimacy } from "../../material/legitimacy";

const randomUUID = () => globalThis.crypto.randomUUID();

// Recruitment and taxation, connected to canonical provincial manpower and
// tax capacity (docs/14 Phase 2). Unlike `create_force` (unconstrained,
// scenario-authored raising), these are the player/NPC-facing skills: they
// fail outright -- no partial effect -- when the province lacks the
// manpower, capacity, or territorial standing the order needs, so an
// unauthorised or unaffordable order surfaces as a refusal (docs/14 Phase 1)
// rather than a partially-applied mutation.

/** Per-head levy and equipment cost, matching `create_force`'s own pay-obligation scale (`size * 2`). */
const RECRUITMENT_COST_PER_HEAD = 2;

/**
 * Below this, a ruling polity's own institutions start to move against it --
 * an opposition motion opens automatically (docs/18 Phase 2 follow-on).
 * Deliberately independent of the treasury-empty hard wall
 * (`draw.collected <= 0`) a few lines below: the player is never stopped
 * from taxing by a budget-planning step, only warned, in-fiction, that they
 * are spending down legitimacy -- the wall that actually stops them is
 * running out of money to tax, not this.
 */
const OPPOSITION_MOTION_LEGITIMACY_THRESHOLD_BPS = 3_000;

/** An opposition motion already pending or in progress against this polity -- never open a second one on top of it. */
function hasOpenOppositionMotion(procedures: readonly { readonly type: string; readonly subjectId: string | null; readonly stage: string }[], polityId: string): boolean {
  const openStages = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);
  return procedures.some((p) => p.type === "opposition_motion" && p.subjectId === polityId && openStages.has(p.stage));
}

export const materialWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "recruit_from_province",
    description: "Recruit personnel into an existing force from a province's available manpower, paid from a treasury account. Requires the force's polity to control the province, enough available manpower, and enough funds.",
    category: "material",
    invokerAuthority: ["player", "character_director"],
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      forceId: EntityIdSchema,
      categoryId: EntityIdSchema,
      recruitCount: z.number().int().positive().max(50_000),
      payerAccountId: EntityIdSchema,
    }).strict(),
    apply(world, params, context) {
      const actor = world.characters.find((c) => c.id === context.actorId);
      if (!actor) return null;
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return null;
      const category = force.personnel.find((p) => p.categoryId === params.categoryId);
      if (!category) return null;
      const material = findProvinceMaterial(world, params.provinceId);
      if (!material) return null;
      if (material.availableManpower < params.recruitCount) return null;

      const account = world.material.accounts.find((a) => a.id === params.payerAccountId);
      if (!account) return null;
      const cost = params.recruitCount * RECRUITMENT_COST_PER_HEAD;
      if (account.balance < cost) return null;

      const updatedMaterial = applyRecruitmentToMaterial(material, params.recruitCount, context.atStep);
      const txId = randomUUID();
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            provinceMaterial: world.material.provinceMaterial.map((m) =>
              m.provinceId === params.provinceId ? updatedMaterial : m,
            ),
            accounts: world.material.accounts.map((a) =>
              a.id === params.payerAccountId ? { ...a, balance: a.balance - cost } : a,
            ),
            transactions: [
              ...world.material.transactions,
              {
                id: txId,
                atStep: context.atStep,
                kind: "purchase" as const,
                amount: cost,
                sourceAccountId: params.payerAccountId,
                cause: {
                  kind: "action" as const,
                  id: context.actorId,
                  explanation: `Levy and equipment for ${params.recruitCount} recruits into ${force.name}.`,
                },
                visibility: "private" as const,
              },
            ],
            forces: world.material.forces.map((f) =>
              f.id !== params.forceId
                ? f
                : {
                    ...f,
                    personnel: f.personnel.map((p) =>
                      p.categoryId === params.categoryId ? { ...p, fit: p.fit + params.recruitCount } : p,
                    ),
                  },
            ),
          },
        },
        result: {
          summary: `${force.name} recruits ${params.recruitCount} from ${province.name} for ${cost} treasury.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "collect_emergency_taxation",
    description: "Levy emergency taxation or requisition against a controlled province's tax capacity, depositing the collected amount into a treasury account. Yields less, and costs more stability, from an already unstable province.",
    category: "material",
    invokerAuthority: ["player", "character_director"],
    parametersSchema: z.object({
      provinceId: EntityIdSchema,
      accountId: EntityIdSchema,
      requestedAmount: z.number().int().positive(),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const actor = world.characters.find((c) => c.id === context.actorId);
      if (!actor) return null;
      const province = world.map.provinces.find((p) => p.id === params.provinceId);
      if (!province) return null;
      const account = world.material.accounts.find((a) => a.id === params.accountId);
      if (!account) return null;
      const material = findProvinceMaterial(world, params.provinceId);
      if (!material) return null;

      const draw = applyTaxationDraw(material, params.requestedAmount, context.atStep);
      if (draw.collected <= 0) return null;
      const txId = randomUUID();
      // A meaningful bite of unrest is a political fact too, not only a
      // provincial one: it costs the collecting polity some legitimacy
      // (docs/14 Phase 6, "taxation/requisition ... material/political
      // consequences"). A token draw that barely moved stability does not.
      const unrestBps = material.stabilityBps - draw.material.stabilityBps;
      const MEANINGFUL_UNREST_THRESHOLD_BPS = 300;
      const polityLegitimacy = unrestBps > MEANINGFUL_UNREST_THRESHOLD_BPS && province.controllerPolityId
        ? adjustPolityLegitimacy(world.material.polityLegitimacy, province.controllerPolityId, -Math.round(unrestBps / 2), `Emergency taxation of ${province.name}`, txId)
        : world.material.polityLegitimacy;

      // Events as the interface between the internal situation and the
      // player (docs/18 Phase 2 follow-on): the order itself is never
      // blocked by this, only the treasury-empty wall above is.
      const legitimacyRecord = province.controllerPolityId
        ? polityLegitimacy.find((l) => l.polityId === province.controllerPolityId)
        : undefined;
      const opensOppositionMotion = province.controllerPolityId !== null
        && legitimacyRecord !== undefined
        && legitimacyRecord.legitimacyBps <= OPPOSITION_MOTION_LEGITIMACY_THRESHOLD_BPS
        && !hasOpenOppositionMotion(world.material.politicalProcedures, province.controllerPolityId);
      const institution = opensOppositionMotion
        ? world.material.institutions.find((i) => i.polityId === province.controllerPolityId)
        : undefined;
      const politicalProcedures = opensOppositionMotion
        ? [
            ...world.material.politicalProcedures,
            {
              id: `opposition-motion:${txId}`,
              type: "opposition_motion" as const,
              institutionId: institution?.id ?? null,
              // Not sponsored by any named character -- the polity's own
              // institutions move against it automatically, not a rival
              // the engine would otherwise have to invent.
              sponsorCharacterId: "system",
              subjectKind: "polity" as const,
              subjectId: province.controllerPolityId!,
              linkedWorkflowId: "challenge_legitimacy",
              linkedWorkflowParams: { polityId: province.controllerPolityId, challengerCharacterId: "system", reason: `Opposition motion following emergency taxation of ${province.name}.`, magnitudeBps: 500 },
              eligibilityRequirementIds: [],
              eligibleParticipantIds: [],
              stage: "proposed" as const,
              resolutionMechanism: institution ? ("vote" as const) : ("sponsor_discretion" as const),
              openedAtStep: context.atStep,
              deadlineStep: null,
              resolvedAtStep: null,
              visibility: "public" as const,
              voteRecordId: null,
              outcome: null,
              outcomeReason: null,
              sourceEventIds: [txId],
              resultingEventIds: [],
            },
          ]
        : world.material.politicalProcedures;

      return {
        world: {
          ...world,
          material: {
            ...world.material,
            polityLegitimacy,
            politicalProcedures,
            provinceMaterial: world.material.provinceMaterial.map((m) =>
              m.provinceId === params.provinceId ? draw.material : m,
            ),
            accounts: world.material.accounts.map((a) =>
              a.id === params.accountId ? { ...a, balance: a.balance + draw.collected } : a,
            ),
            transactions: [
              ...world.material.transactions,
              {
                id: txId,
                atStep: context.atStep,
                kind: "income" as const,
                amount: draw.collected,
                destinationAccountId: params.accountId,
                cause: {
                  kind: "action" as const,
                  id: context.actorId,
                  explanation: params.reason,
                },
                visibility: "public" as const,
              },
            ],
          },
        },
        result: {
          summary: `${province.name} yields ${draw.collected} in emergency taxation: ${params.reason}`,
          applied: true,
        },
      };
    },
  }),
];
