import { describe, expect, it } from "vitest";
import { AiOperationSchema, type AiOperation } from "@chronica/shared";
import { ANTHROPIC_OPERATION_TABLES } from "./anthropic-local";
import { OPENAI_OPERATION_TABLES } from "./openai-local";

/**
 * Every operation the engine can name is known to both adapters.
 *
 * A label map gets a test that iterates the enum: an operation missing from
 * the JSON-mode set answers in prose and is dropped as unreadable, and one
 * missing from the effort or token tables runs at whatever the provider
 * defaults to, which is how the Chronicle once ran at the model's highest
 * effort for months without anybody noticing.
 */
const SIMULATION_OPERATIONS: readonly AiOperation[] = [
  "simulate_orchestrate", "simulate_cognition", "compose_chronicle", "reconcile_facts", "repair_deltas", "write_mechanic",
];

describe("the adapters know every operation", () => {
  for (const [name, tables] of [["anthropic", ANTHROPIC_OPERATION_TABLES], ["openai", OPENAI_OPERATION_TABLES]] as const) {
    it(`${name}: every simulation operation answers in JSON`, () => {
      for (const operation of SIMULATION_OPERATIONS) expect(tables.jsonMode.has(operation), operation).toBe(true);
    });
    it(`${name}: every key of every table is an operation`, () => {
      const known = new Set<string>(AiOperationSchema.options);
      for (const operation of tables.jsonMode) expect(known.has(operation), operation).toBe(true);
      for (const operation of Object.keys(tables.outputTokens)) expect(known.has(operation), operation).toBe(true);
    });
  }
  it("openai: the writer of mechanics thinks cheaply and briefly", () => {
    expect(OPENAI_OPERATION_TABLES.lowEffort.has("write_mechanic")).toBe(true);
    expect(OPENAI_OPERATION_TABLES.outputTokens.write_mechanic).toBeLessThanOrEqual(2_000);
  });
});
