import type { z } from "zod";
import type { WorldState } from "../world/world-state";
import type { AuthorityDomain, AuthorityIndex, AuthorityPower, AuthorityScope } from "../authority/authority-grant";
import type { WorldInstant } from "../world/instant";

// The typed world-tool layer (docs/32, Part C.1): a thin dispatch-first
// surface over the existing ~90-workflow `WORKFLOW_REGISTRY`, not a rewrite
// of it. A tool either names an already-registered workflow to invoke
// (`dispatch`) or, when nothing registered fits, applies a small generic
// primitive directly (`fallback`) -- `workflows/executor.ts` itself never
// changes, and nothing here can mutate the world outside one of those two
// paths.

export interface WorldToolContext {
  readonly actorId: string;
  readonly atStep: number;
  /**
   * The real current `WorldInstant` (docs/32 corrective pass, requirement 4)
   * -- `record_fact` stamps this, never a hardcoded epoch. Optional so
   * existing test fixtures that only ever cared about `atStep` keep
   * compiling; a real caller (`GameMasterSession`) always supplies it.
   */
  readonly atInstant?: WorldInstant;
  /** Present when the caller has one built for this turn; omit to skip the authority check entirely (matches `GameMasterSession.authorityGate`'s own opt-in default). */
  readonly authorityIndex?: AuthorityIndex;
  /**
   * A monotonic, per-session counter for this call (docs/32 corrective
   * pass, requirement 4) -- `record_fact` uses it to build a deterministic,
   * collision-free fact id instead of `Math.random()`. Optional for the same
   * reason as `atInstant`; a real caller always supplies it.
   */
  readonly factSequence?: number;
}

/** What a tool wants invoked: an existing workflow id plus the parameters to call it with. */
export interface WorldToolDispatch {
  readonly workflowId: string;
  readonly workflowParams: Record<string, unknown>;
}

export interface WorldToolAuthorityRequirement {
  readonly domain: AuthorityDomain;
  readonly scope: AuthorityScope;
  readonly power: AuthorityPower;
}

export type WorldToolOutcome =
  | {
    readonly ok: true;
    readonly world: WorldState;
    readonly summary: string;
    /** Facts a tool produced that belong in the fact ledger (Part A's `worldFacts` table), never inside the hashed snapshot -- the caller persists these, e.g. via `insertWorldFacts`. */
    readonly factsToPersist?: readonly import("../world/facts").Fact[];
  }
  | { readonly ok: false; readonly reason: string };

/** A tool with no mutation at all -- an inspection. Returns data, never a world. */
export type WorldToolReadOutcome =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: string };

export interface WorldToolDefinition<Params = unknown> {
  readonly id: string;
  readonly description: string;
  readonly parametersSchema: z.ZodType<Params>;
  /** Whether this call needs standing, and over what -- null means this particular call needs none (e.g. spending from one's own account). */
  readonly authorityRequirement?: (params: Params, ctx: WorldToolContext) => WorldToolAuthorityRequirement | null;
  /** Names an existing workflow to run, or null to fall through to `fallback`. */
  readonly dispatch: (world: WorldState, params: Params, ctx: WorldToolContext) => WorldToolDispatch | null;
  /** The true generic primitive, for when no registered workflow fits. Absent means this tool only ever dispatches. */
  readonly fallback?: (world: WorldState, params: Params, ctx: WorldToolContext) => WorldToolOutcome;
}

export type AnyWorldToolDefinition = WorldToolDefinition<any>;

/** A read-only counterpart to `WorldToolDefinition` -- `inspect_entity`/`inspect_context`. Never touches `WORKFLOW_REGISTRY` or the authority gate; a read has nothing to authorize. */
export interface WorldReadToolDefinition<Params = unknown> {
  readonly id: string;
  readonly description: string;
  readonly parametersSchema: z.ZodType<Params>;
  readonly read: (world: WorldState, params: Params, ctx: WorldToolContext) => WorldToolReadOutcome;
}
export type AnyWorldReadToolDefinition = WorldReadToolDefinition<any>;
