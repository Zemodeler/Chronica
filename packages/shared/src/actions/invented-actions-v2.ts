import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema } from "../material-state";
import type { WorldState } from "../world/world-state";
import { EntityNoteSchema, appendEntityNote } from "../gm/campaign-memory";
import { refuse, type WorkflowRefusal } from "../workflows/types";

/**
 * Invented actions V2 (docs/32, Phase 10) -- in-campaign activation,
 * superseding the developer-review-only `capability-request.ts` and the
 * dormant, patch-path-based `define_action`/`invoke_defined_action` V1
 * (`workflows/invented-workflow.ts`).
 *
 * V1's danger was that its effect language was a list of raw JSON-patch
 * operations over the whole world document -- safe only because every use
 * was re-validated against a hand-maintained "protected roots" denylist
 * (`elapsedStep`, `pins`, `schemaVersion`, `playerPlans`, `actorActivities`,
 * docs/27). V2 does not need that denylist at all: its effect language is a
 * small, closed union of named primitives, each of which can only ever
 * reach the exact state a hand-written built-in workflow could already
 * reach through that same primitive. There is no path expression anywhere
 * in this file, so there is nothing for a denylist to protect against.
 *
 * This is a deliberately narrow first cut of that union -- exactly three
 * primitives, chosen because each already has a safe, well-understood,
 * existing analogue elsewhere in the engine:
 *
 *  - `transfer_resource` mirrors `workflows/definitions/economic.ts`'s
 *    `transfer_gold` exactly (clamps to the source's actual balance; a
 *    zero-actual transfer is a silent no-op leg, not a refusal).
 *  - `attach_entity_note` reuses `gm/campaign-memory.ts`'s existing
 *    `EntityNoteSchema`/`appendEntityNote` verbatim -- the same mechanism
 *    the `record_entity_note` GM tool already uses.
 *  - `emit_fact` is pure narrative: it mutates nothing.
 *
 * Deliberately deferred rather than attempted here: typed entity create/
 * update, relationship add/remove, commitments, pressures, and scheduled
 * events. Each of those entity kinds carries invariants a built-in workflow
 * enforces beyond a single field write (e.g. `change_province_control`
 * updates more than just `controllerPolityId`) that this session did not
 * work through carefully enough to expose safely as a generic primitive.
 * Widening the union is a real future step, not a rejected idea -- see
 * docs/32's own note on this.
 */

export const InventedActionV2ParameterTypeSchema = z.enum(["string", "number", "boolean", "entityId"]);
export type InventedActionV2ParameterType = z.infer<typeof InventedActionV2ParameterTypeSchema>;

export const InventedActionV2ParameterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: InventedActionV2ParameterTypeSchema,
  description: z.string().trim().min(1).max(200),
}).strict();
export type InventedActionV2Parameter = z.infer<typeof InventedActionV2ParameterSchema>;

/** Every dynamic value an effect uses is a reference to a declared parameter by name -- never a literal baked into the definition, and never a raw state path. */
export const InventedActionV2EffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("transfer_resource"),
    fromAccountIdParam: z.string().trim().min(1).max(60),
    toAccountIdParam: z.string().trim().min(1).max(60),
    amountParam: z.string().trim().min(1).max(60),
  }).strict(),
  z.object({
    kind: z.literal("attach_entity_note"),
    entityIdParam: z.string().trim().min(1).max(60),
    entityType: z.enum(["force", "building", "settlement", "character", "institution", "other"]),
    textParam: z.string().trim().min(1).max(60),
  }).strict(),
  z.object({
    kind: z.literal("emit_fact"),
    summaryParam: z.string().trim().min(1).max(60),
  }).strict(),
]);
export type InventedActionV2Effect = z.infer<typeof InventedActionV2EffectSchema>;

export const InventedActionV2DefinitionSchema = z.object({
  actionId: z.string().trim().min(3).max(80),
  /** Bumped on redefinition; `docs/31`'s removal-criterion pattern for reviewing prior versions applies here too. */
  version: z.number().int().positive().default(1),
  campaignId: EntityIdSchema,
  intent: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(400),
  parameters: z.array(InventedActionV2ParameterSchema).max(8),
  /** Descriptive only -- a record of the claimed authority basis, not a second authority engine (mirrors `OrderAuthorityBasisSchema`, `actions/orders.ts`). */
  authorityRequirement: z.string().trim().max(300).default(""),
  effects: z.array(InventedActionV2EffectSchema).min(1).max(6),
  successTemplate: z.string().trim().min(1).max(400),
  refusalTemplate: z.string().trim().min(1).max(400),
  createdAtStep: ElapsedStepSchema,
  createdByActorId: EntityIdSchema,
}).strict();
export type InventedActionV2Definition = z.infer<typeof InventedActionV2DefinitionSchema>;

export interface InventedActionV2ValidationIssue {
  readonly path: string;
  readonly message: string;
}

function requireDeclaredParam(paramNames: ReadonlySet<string>, path: string, name: string, issues: InventedActionV2ValidationIssue[]): void {
  if (!paramNames.has(name)) issues.push({ path, message: `References parameter "${name}", which this definition never declared.` });
}

/**
 * Structural validation only -- there is nothing else to check, because the
 * closed effect union above cannot express a mutation outside its own three
 * safe primitives. Every use re-runs this (`invokeInventedActionV2` calls it
 * first), matching docs/27's "every use re-validated... exactly like a
 * built-in command" for V1.
 */
export function validateInventedActionV2Definition(definition: InventedActionV2Definition): readonly InventedActionV2ValidationIssue[] {
  const issues: InventedActionV2ValidationIssue[] = [];
  const paramNames = new Set(definition.parameters.map((p) => p.name));
  const seen = new Set<string>();
  for (const param of definition.parameters) {
    if (seen.has(param.name)) issues.push({ path: "parameters", message: `Parameter "${param.name}" is declared more than once.` });
    seen.add(param.name);
  }
  definition.effects.forEach((effect, index) => {
    const path = `effects[${index}]`;
    if (effect.kind === "transfer_resource") {
      requireDeclaredParam(paramNames, `${path}.fromAccountIdParam`, effect.fromAccountIdParam, issues);
      requireDeclaredParam(paramNames, `${path}.toAccountIdParam`, effect.toAccountIdParam, issues);
      requireDeclaredParam(paramNames, `${path}.amountParam`, effect.amountParam, issues);
    } else if (effect.kind === "attach_entity_note") {
      requireDeclaredParam(paramNames, `${path}.entityIdParam`, effect.entityIdParam, issues);
      requireDeclaredParam(paramNames, `${path}.textParam`, effect.textParam, issues);
    } else {
      requireDeclaredParam(paramNames, `${path}.summaryParam`, effect.summaryParam, issues);
    }
  });
  return issues;
}

export interface InventedActionV2InvokeContext {
  readonly actorId: string;
  readonly atStep: number;
}

export interface InventedActionV2Result {
  readonly world: WorldState;
  readonly summary: string;
}

function readParam(params: Readonly<Record<string, unknown>>, name: string): unknown {
  return params[name];
}

/**
 * Runs a validated definition's effects against `world`, in order. On
 * failure, nothing changes -- the player's attempt still gets an honest
 * refusal, never a silent partial application (docs/32's invented-action
 * rule: "a rejected invented definition changes nothing").
 */
export function invokeInventedActionV2(
  definition: InventedActionV2Definition,
  world: WorldState,
  params: Readonly<Record<string, unknown>>,
  context: InventedActionV2InvokeContext,
): InventedActionV2Result | WorkflowRefusal {
  const issues = validateInventedActionV2Definition(definition);
  if (issues.length > 0) {
    return refuse(`This defined action is no longer valid and cannot be used: ${issues.map((issue) => issue.message).join("; ")}`);
  }

  let nextWorld = world;
  const summaries: string[] = [];
  let noteCounter = 0;

  for (const effect of definition.effects) {
    if (effect.kind === "transfer_resource") {
      const fromAccountId = readParam(params, effect.fromAccountIdParam);
      const toAccountId = readParam(params, effect.toAccountIdParam);
      const amount = readParam(params, effect.amountParam);
      if (typeof fromAccountId !== "string" || typeof toAccountId !== "string") {
        return refuse(`"${effect.fromAccountIdParam}" and "${effect.toAccountIdParam}" must each resolve to an account id.`);
      }
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return refuse(`"${effect.amountParam}" must resolve to a positive amount.`);
      }
      const src = nextWorld.material.accounts.find((a) => a.id === fromAccountId);
      const dst = nextWorld.material.accounts.find((a) => a.id === toAccountId);
      if (!src || !dst) return refuse(`No account exists for one of "${fromAccountId}"/"${toAccountId}".`);
      const actual = Math.min(amount, src.balance);
      if (actual === 0) continue;
      nextWorld = {
        ...nextWorld,
        material: {
          ...nextWorld.material,
          accounts: nextWorld.material.accounts.map((a) => {
            if (a.id === fromAccountId) return { ...a, balance: a.balance - actual };
            if (a.id === toAccountId) return { ...a, balance: a.balance + actual };
            return a;
          }),
        },
      };
      summaries.push(`Transferred ${actual} from ${src.id} to ${dst.id}.`);
    } else if (effect.kind === "attach_entity_note") {
      const entityId = readParam(params, effect.entityIdParam);
      const text = readParam(params, effect.textParam);
      if (typeof entityId !== "string" || typeof text !== "string" || text.trim().length === 0) {
        return refuse(`"${effect.entityIdParam}"/"${effect.textParam}" must resolve to an entity id and non-empty text.`);
      }
      const note = EntityNoteSchema.parse({
        id: `note-${context.atStep}-${context.actorId}-${noteCounter++}`,
        entityId,
        entityType: effect.entityType,
        text,
        createdAtStep: context.atStep,
      });
      nextWorld = { ...nextWorld, campaignMemory: appendEntityNote(nextWorld.campaignMemory, note) };
      summaries.push(`Noted: ${text}`);
    } else {
      const summary = readParam(params, effect.summaryParam);
      if (typeof summary !== "string" || summary.trim().length === 0) {
        return refuse(`"${effect.summaryParam}" must resolve to non-empty narrative text.`);
      }
      summaries.push(summary);
    }
  }

  return { world: nextWorld, summary: summaries.length > 0 ? summaries.join(" ") : definition.successTemplate };
}
