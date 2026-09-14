import { z } from "zod";
import { DEFAULT_FORCE_SUPPLY_STATE, EntityIdSchema } from "../../material-state";
import { availableBalance } from "../../world/money-reservations";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";

const randomUUID = () => globalThis.crypto.randomUUID();

// World matters, Phase 5: supply and logistics (docs/plans/
// ai-world-matters-runtime.md, "Supply and logistics"). Every real
// consequence a `supply_review` matter's response can produce -- money
// spent, stores obtained, a route established, or a hostile disruption --
// goes through exactly one of these two workflows, never through a
// detector. No detector in `matters/detectors/supply.ts` may write
// `provisionStatus`/`provisionedThroughStep` itself.
//
// `purchase`/`requisition`/`forage`/`reroute`/`assessment` are one
// workflow with a `method` discriminant rather than five separate tools --
// the combined Game Master tool surface has a hard provider limit
// (`gm/player-plans.test.ts`'s "keeps the combined tool surface within the
// provider limit"), and these five are genuinely one family: alternative
// ways an already-selected actor answers the SAME matter about their OWN
// force's supply. `raid_supply_route` stays separate because it names a
// different actor acting against someone ELSE's force, not a response to
// one's own supply_review matter.
const MAX_EXTEND_STEPS = 60;

export const logisticsWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "manage_force_supply",
    description: "Answer a force's own supply_review matter, by one of five methods: purchase (spend from an account, proportional to what it can actually afford), requisition (take from a province's own stores -- no payment, but raises the province's war damage and lowers stability), forage (a small, free extension -- never a substitute for a real supply line for long), reroute (record a new ordinary source/route, no immediate effect on provisioning), or assessment (a grounded star-context judgment of current condition, when no character can plausibly author the observation directly -- cite the basis).",
    category: "military",
    invokerAuthority: ["player", "character_director", "world_director"],
    parametersSchema: z.discriminatedUnion("method", [
      z.object({
        method: z.literal("purchase"),
        forceId: EntityIdSchema,
        accountId: EntityIdSchema,
        amount: z.number().int().positive(),
        extendBySteps: z.number().int().min(1).max(MAX_EXTEND_STEPS),
        reason: z.string().min(1).max(240),
      }).strict(),
      z.object({
        method: z.literal("requisition"),
        forceId: EntityIdSchema,
        provinceId: EntityIdSchema,
        extendBySteps: z.number().int().min(1).max(MAX_EXTEND_STEPS),
        reason: z.string().min(1).max(240),
      }).strict(),
      z.object({
        method: z.literal("forage"),
        forceId: EntityIdSchema,
        reason: z.string().min(1).max(240),
      }).strict(),
      z.object({
        method: z.literal("reroute"),
        forceId: EntityIdSchema,
        sourceRef: z.object({ kind: z.string().min(1).max(40), id: EntityIdSchema }).strict().nullable(),
        routeProvinceIds: z.array(EntityIdSchema).max(8),
        reason: z.string().min(1).max(240),
      }).strict(),
      z.object({
        method: z.literal("assessment"),
        forceId: EntityIdSchema,
        provisionStatus: z.enum(["provisioned", "shortage", "critical"]),
        reason: z.string().min(1).max(240),
      }).strict(),
    ]),
    apply(world, params, context) {
      const force = world.material.forces.find((f) => f.id === params.forceId);
      if (!force) return refuse(`No force "${params.forceId}" exists.`);
      const supplyState = force.supply ?? DEFAULT_FORCE_SUPPLY_STATE;

      if (params.method === "purchase") {
        const account = world.material.accounts.find((a) => a.id === params.accountId);
        if (!account) return refuse(`No account "${params.accountId}" exists.`);
        const payable = Math.min(params.amount, availableBalance(world.material, params.accountId));
        if (payable <= 0) return refuse(`Account "${params.accountId}" has no available balance to spend on supplies.`);
        const fraction = payable / params.amount;
        const grantedSteps = Math.max(1, Math.round(params.extendBySteps * fraction));
        const txId = randomUUID();
        return {
          world: {
            ...world,
            material: {
              ...world.material,
              accounts: world.material.accounts.map((a) => (a.id === params.accountId ? { ...a, balance: a.balance - payable } : a)),
              transactions: [
                ...world.material.transactions,
                { id: txId, atStep: context.atStep, kind: "purchase" as const, amount: payable, sourceAccountId: params.accountId, cause: { kind: "action" as const, id: context.actorId, explanation: params.reason }, visibility: "polity" as const },
              ],
              forces: world.material.forces.map((f) =>
                f.id === force.id
                  ? { ...f, provisionedThroughStep: Math.max(f.provisionedThroughStep, context.atStep) + grantedSteps, provisionStatus: "provisioned" as const, supply: { ...supplyState, lastConfirmedAtStep: context.atStep } }
                  : f,
              ),
            },
          },
          result: {
            summary: payable < params.amount
              ? `${payable} of ${params.amount} spent on supplies for "${force.name}"; provisioning extended by ${grantedSteps} steps.`
              : `${payable} spent on supplies for "${force.name}": ${params.reason}`,
            applied: true,
          },
        };
      }

      if (params.method === "requisition") {
        const material = world.material.provinceMaterial.find((m) => m.provinceId === params.provinceId);
        if (!material) return refuse(`No province material record for "${params.provinceId}" exists.`);
        return {
          world: {
            ...world,
            material: {
              ...world.material,
              provinceMaterial: world.material.provinceMaterial.map((m) =>
                m.provinceId === params.provinceId
                  ? { ...m, warDamageBps: Math.min(10_000, m.warDamageBps + 200), stabilityBps: Math.max(0, m.stabilityBps - 300), lastMaterialUpdateStep: context.atStep }
                  : m,
              ),
              forces: world.material.forces.map((f) =>
                f.id === force.id
                  ? { ...f, provisionedThroughStep: Math.max(f.provisionedThroughStep, context.atStep) + params.extendBySteps, provisionStatus: "provisioned" as const, supply: { ...supplyState, lastConfirmedAtStep: context.atStep } }
                  : f,
              ),
            },
          },
          result: { summary: `"${force.name}" requisitions supplies from ${params.provinceId}: ${params.reason}`, applied: true },
        };
      }

      if (params.method === "forage") {
        const grantedSteps = 3;
        return {
          world: {
            ...world,
            material: {
              ...world.material,
              forces: world.material.forces.map((f) =>
                f.id === force.id
                  ? { ...f, provisionedThroughStep: Math.max(f.provisionedThroughStep, context.atStep) + grantedSteps, provisionStatus: f.provisionStatus === "critical" ? "shortage" as const : "provisioned" as const, supply: { ...supplyState, lastConfirmedAtStep: context.atStep } }
                  : f,
              ),
            },
          },
          result: { summary: `"${force.name}" forages for supplies: ${params.reason}`, applied: true },
        };
      }

      if (params.method === "reroute") {
        return {
          world: {
            ...world,
            material: {
              ...world.material,
              forces: world.material.forces.map((f) =>
                f.id === force.id ? { ...f, supply: { ...supplyState, sourceRef: params.sourceRef, routeProvinceIds: params.routeProvinceIds } } : f,
              ),
            },
          },
          result: { summary: `"${force.name}"'s supply route recorded: ${params.reason}`, applied: true },
        };
      }

      // method === "assessment"
      if (force.provisionStatus === params.provisionStatus) return refuse(`"${force.name}" is already assessed as "${params.provisionStatus}".`);
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id === force.id ? { ...f, provisionStatus: params.provisionStatus, supply: { ...supplyState, lastConfirmedAtStep: context.atStep } } : f,
            ),
          },
        },
        result: { summary: `"${force.name}"'s supply condition assessed as ${params.provisionStatus}: ${params.reason}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "raid_supply_route",
    description: "A hostile actor disrupts a target force's supply: degrades its provisionedThroughStep and records the disruption. The doc's own real consequence for interrupted supply -- never a detector's own doing.",
    category: "military",
    invokerAuthority: ["player", "character_director"],
    parametersSchema: z.object({
      targetForceId: EntityIdSchema,
      degradeBySteps: z.number().int().min(1).max(MAX_EXTEND_STEPS),
      reason: z.string().min(1).max(240),
    }).strict(),
    apply(world, params, context) {
      const force = world.material.forces.find((f) => f.id === params.targetForceId);
      if (!force) return refuse(`No force "${params.targetForceId}" exists.`);
      const degraded = Math.max(context.atStep, force.provisionedThroughStep - params.degradeBySteps);
      return {
        world: {
          ...world,
          material: {
            ...world.material,
            forces: world.material.forces.map((f) =>
              f.id === force.id
                ? {
                  ...f,
                  provisionedThroughStep: degraded,
                  provisionStatus: degraded <= context.atStep ? "critical" as const : "shortage" as const,
                  supply: { ...(f.supply ?? DEFAULT_FORCE_SUPPLY_STATE), disruptions: [...(f.supply?.disruptions ?? []), params.reason].slice(-6) },
                }
                : f,
            ),
          },
        },
        result: { summary: `"${force.name}"'s supply route is raided: ${params.reason}`, applied: true },
      };
    },
  }),
];
