import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// The Game Master's terminal output (GM refactor, requirements 1 and 8).
//
// The report is a *description of what the tools already did*, not a
// declaration of what happened. Every world change this turn came from a tool
// call executed against the staged world before this report was written; the
// report exists so the pipeline knows the GM considered itself finished, and
// so the Chronicle has a factual per-event seed to narrate from.
//
// Nothing here can create state. `factRefs` point at events the staged
// executor already recorded; a report referring to an event that never
// happened is rejected rather than believed.

export const TurnReportEventSchema = z
  .object({
    /**
     * Ids of factual events (staged tool results) this line accounts for.
     * Must all exist; a line with no valid ref is dropped rather than narrated.
     */
    factRefs: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
    /** Plain factual account, bounded by what those events actually did. */
    summary: z.string().trim().min(1).max(600),
    /** Whose event this is, for Chronicle casting and relevance. */
    participantCharacterIds: z.array(EntityIdSchema).max(8).default([]),
    /** Where it happened, when the event is placed. */
    provinceId: EntityIdSchema.nullable().default(null),
    visibility: z.enum(["public", "polity", "private"]).default("public"),
    /** 0-10; only orders Chronicle display, never whether the event occurred. */
    salience: z.number().int().min(0).max(10).default(5),
    /** Which player directive, if any, this event answers. */
    directiveRef: z.string().trim().max(120).nullable().default(null),
    chainPosition: z.enum(["root", "reaction", "spread", "distant", "pressure"]).default("root"),
  })
  .strict();
export type TurnReportEvent = z.infer<typeof TurnReportEventSchema>;

/** The Game Master's account of one player directive as an attempt with an outcome. */
export const TurnReportDirectiveOutcomeSchema = z
  .object({
    directiveId: z.string().trim().min(1).max(120),
    outcome: z.enum(["carried_out", "partially_carried_out", "refused", "failed", "unsupported"]),
    /** Must be the deterministic reason a tool returned, not an invented one. */
    reason: z.string().trim().min(1).max(600),
    factRefs: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  })
  .strict();
export type TurnReportDirectiveOutcome = z.infer<typeof TurnReportDirectiveOutcomeSchema>;

export const GameMasterTurnReportSchema = z
  .object({
    /** One line per player directive. Every submitted directive must appear. */
    directiveOutcomes: z.array(TurnReportDirectiveOutcomeSchema).max(40).default([]),
    /** Everything worth narrating this turn, player and world alike. */
    events: z.array(TurnReportEventSchema).max(32).default([]),
    /** Threads the GM considers still open, for next turn's memory. */
    openThreads: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
    /** Exact, factual account of the turn for campaign memory. No voice, no colour. */
    turnSummary: z.string().trim().min(1).max(1_200),
  })
  .strict();
export type GameMasterTurnReport = z.infer<typeof GameMasterTurnReportSchema>;

/**
 * What is persisted beside a committed turn: the report the Game Master
 * finished with (null when it never finished and the pipeline supplied a
 * deterministic account instead), the factual event log every Chronicle entry
 * was built from, and how the loop ended.
 *
 * Kept as a plain interface rather than a schema because it is written by the
 * pipeline and read only for review -- nothing untrusted ever produces one.
 */
export interface CommittedGameMasterReport {
  readonly atStep: number;
  readonly termination: string;
  readonly modelSteps: number;
  readonly report: GameMasterTurnReport | null;
  readonly events: readonly {
    readonly id: string;
    readonly kind: string;
    readonly actionId: string;
    readonly actorId: string;
    readonly summary: string;
    readonly materialConsequence: boolean;
  }[];
  readonly capabilityRequestIds: readonly string[];
}
