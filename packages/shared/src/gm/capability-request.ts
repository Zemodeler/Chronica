import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

// Capability-gap safeguard (GM refactor, requirement 7).
//
// This records a need that cannot honestly be expressed as a world-data
// interaction. When the Game Master can describe a safe data operation, it
// should define and use a campaign workflow instead. A capability request is
// a *record*, not an instruction: it never mutates the staged or committed
// world and carries no patch paths.
//
// The attempted action is recorded as unresolved/unsupported so the turn stays
// honest about it. It remains in the developer audit, which shows exactly what
// was asked for and why nothing happened; it is never player-facing history.

/**
 * Shapes that would make a request executable rather than descriptive. A
 * request carrying any of these is rejected outright: the point of the
 * safeguard is that a model cannot smuggle a mutation through the text of a
 * request for a mutation.
 */
const MUTATION_INSTRUCTION_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /"?\bop"?\s*:\s*"?(add|replace|remove|move|copy|test)\b/i, reason: "a JSON-patch operation" },
  { pattern: /"?\bpath"?\s*:\s*"?\//i, reason: "a JSON-patch path" },
  { pattern: /(^|[\s"'(])\/(characters|material|map|conflicts|storylines|actions|operations|continuity|commitments|pins|schemaVersion|elapsedStep)(\/|\[|\b)/i, reason: "a world-state pointer" },
  { pattern: /\[id\s*=/i, reason: "an entity selector" },
  { pattern: /\{\{[a-z][a-zA-Z0-9_]*\}\}/, reason: "a patch placeholder" },
];

export function findMutationInstruction(text: string): string | null {
  for (const { pattern, reason } of MUTATION_INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

const DescriptiveTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .superRefine((value, context) => {
      const found = findMutationInstruction(value);
      if (found !== null) {
        context.addIssue({
          code: "custom",
          message: `A capability request describes an unmet need; it may not contain ${found}.`,
        });
      }
    });

/**
 * A proposed parameter for the tool a developer might write. It is a type
 * declaration, not a value assignment, and deliberately cannot express where
 * in the world the value would be written.
 */
export const CapabilityParameterSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
    type: z.enum(["string", "number", "boolean", "entity_id"]),
    required: z.boolean().default(true),
    purpose: DescriptiveTextSchema(200),
  })
  .strict();
export type CapabilityParameter = z.infer<typeof CapabilityParameterSchema>;

/** What the Game Master may say when no registered tool fits. */
export const CapabilityRequestSchema = z
  .object({
    /** What the actor was trying to do, in plain terms. */
    requestedIntent: DescriptiveTextSchema(600),
    /** Why every registered tool was inadequate. */
    whyNoRegisteredToolFits: DescriptiveTextSchema(600),
    actorId: EntityIdSchema,
    targetEntityIds: z.array(EntityIdSchema).max(10).default([]),
    /** The tool a developer might add. A name only -- never a definition that executes. */
    proposedToolName: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/),
    proposedParameters: z.array(CapabilityParameterSchema).max(12).default([]),
    /** The state change such a tool would make, described, not specified. */
    expectedStateEffect: DescriptiveTextSchema(600),
    /** Rules the capability must respect if it is ever built. */
    safetyConstraints: z.array(DescriptiveTextSchema(240)).max(10).default([]),
    /** Scenario context a reviewer needs to judge whether this belongs in the game. */
    scenarioContext: DescriptiveTextSchema(600),
    /**
     * docs/32, Part C.5: which existing generic primitives (`create_entity`,
     * `create_project`, ...) were actually tried before concluding none fit --
     * a reviewer reading "nothing was tried" versus "every primitive was tried
     * and each was wrong for a stated reason" needs very different follow-up.
     */
    compositionAttempted: z.array(z.string().regex(/^[a-z][a-z0-9_]{2,79}$/)).max(10).default([]),
    /**
     * The closest tool actually invoked alongside this request, if one was --
     * `record_entity_note` recording the same intent, a `create_entity` call
     * with a best-inferable shape. Null only when nothing plausible existed
     * even as a fallback.
     */
    bestAvailableFallbackToolName: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/).nullable().default(null),
  })
  .strict();
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;

/** One turn's outcome for a capability request that has now been seen more than once. */
export const CapabilityRequestObservedOutcomeSchema = z
  .object({
    atStep: ElapsedStepSchema,
    /** What actually happened for the requester that turn -- the best-effort fallback's own summary, or "nothing" when there was none. */
    summary: z.string().trim().min(1).max(400),
  })
  .strict();
export type CapabilityRequestObservedOutcome = z.infer<typeof CapabilityRequestObservedOutcomeSchema>;

/** A capability request as recorded against a turn. Stamped by the pipeline, never by a model. */
export interface RecordedCapabilityRequest {
  readonly id: string;
  readonly atStep: number;
  readonly request: CapabilityRequest;
  /** Always "unsupported": the attempt was recorded and nothing was applied. */
  readonly resolution: "unsupported";
  /** How many times this same capability gap (by `proposedToolName`) has now been recorded for this game. */
  readonly usageCount: number;
  /** One entry per turn this gap recurred, oldest first -- append-only, never rewritten. */
  readonly observedOutcomes: readonly CapabilityRequestObservedOutcome[];
}

export const RECORDED_CAPABILITY_RESOLUTION = "unsupported" as const;

export function recordCapabilityRequest(
  request: CapabilityRequest,
  atStep: number,
  id: string,
): RecordedCapabilityRequest {
  return { id, atStep, request, resolution: RECORDED_CAPABILITY_RESOLUTION, usageCount: 1, observedOutcomes: [] };
}

/**
 * A later turn hits the same named gap again: increments the dedupe count
 * and appends this turn's outcome, rather than the caller inserting a
 * duplicate row. The identity of "the same gap" is the caller's own
 * decision (typically matching `proposedToolName`) -- this only merges once
 * that match has already been made.
 */
export function mergeCapabilityRequestUsage(
  existing: RecordedCapabilityRequest,
  outcome: CapabilityRequestObservedOutcome,
): RecordedCapabilityRequest {
  return { ...existing, usageCount: existing.usageCount + 1, observedOutcomes: [...existing.observedOutcomes, outcome] };
}

/** The exact, factual sentence kept in the developer audit for an unsupported attempt. */
export function capabilityLimitationFact(request: CapabilityRequest, actorName: string): string {
  return `${actorName} attempted something the simulation does not model: ${request.requestedIntent} No world change followed, and the attempt is recorded as unresolved.`;
}

export const RecordedCapabilityRequestStepSchema = ElapsedStepSchema;
