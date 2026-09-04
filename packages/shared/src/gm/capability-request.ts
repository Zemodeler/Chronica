import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

// Capability-gap safeguard (GM refactor, requirement 7).
//
// This replaces the invented-workflow escape hatch. When the Game Master needs
// an action no registered tool represents, it may say so -- and nothing else.
// A capability request is a *record*, not an instruction: it never mutates the
// staged or committed world, it carries no patch paths, and the executor has
// no code path that turns one into a mutation. A developer reviews it offline
// and, if the capability is warranted, writes a real typed workflow.
//
// The attempted action is recorded as unresolved/unsupported so the turn stays
// honest about it: the Chronicle may report the factual limitation, and the
// audit shows exactly what was asked for and why nothing happened.

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
  })
  .strict();
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;

/** A capability request as recorded against a turn. Stamped by the pipeline, never by a model. */
export interface RecordedCapabilityRequest {
  readonly id: string;
  readonly atStep: number;
  readonly request: CapabilityRequest;
  /** Always "unsupported": the attempt was recorded and nothing was applied. */
  readonly resolution: "unsupported";
}

export const RECORDED_CAPABILITY_RESOLUTION = "unsupported" as const;

export function recordCapabilityRequest(
  request: CapabilityRequest,
  atStep: number,
  id: string,
): RecordedCapabilityRequest {
  return { id, atStep, request, resolution: RECORDED_CAPABILITY_RESOLUTION };
}

/** The exact, factual sentence a Chronicle entry may carry for an unsupported attempt. */
export function capabilityLimitationFact(request: CapabilityRequest, actorName: string): string {
  return `${actorName} attempted something the simulation does not model: ${request.requestedIntent} No world change followed, and the attempt is recorded as unresolved.`;
}

export const RecordedCapabilityRequestStepSchema = ElapsedStepSchema;
