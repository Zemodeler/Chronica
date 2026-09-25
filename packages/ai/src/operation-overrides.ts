import type { AiOperation } from "@chronica/shared";

/**
 * Per-operation knobs for measuring, not for production: `CHRONICA_AI_MODEL_<OPERATION>`
 * names a model for one operation ahead of the selected local model and the
 * tier table, and `CHRONICA_AI_EFFORT_<OPERATION>` sets its reasoning effort.
 * The operation is upper-cased: `CHRONICA_AI_MODEL_SIMULATE_COGNITION`,
 * `CHRONICA_AI_EFFORT_COMPOSE_CHRONICLE`. Plan §1's effort/model step runs the
 * same five orders with these set and keeps a change only if the audit shows
 * the same acts carried out and the Chronicles read no worse.
 */
export type ReasoningEffort = "low" | "medium" | "high";

const variable = (prefix: string, operation: AiOperation): string => `${prefix}_${operation.toUpperCase()}`;

export function modelOverrideFor(operation: AiOperation, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[variable("CHRONICA_AI_MODEL", operation)]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

export function effortOverrideFor(operation: AiOperation, env: NodeJS.ProcessEnv = process.env): ReasoningEffort | undefined {
  const value = env[variable("CHRONICA_AI_EFFORT", operation)]?.trim();
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}
