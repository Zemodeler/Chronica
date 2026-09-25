import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OrchestratorOutputSchema } from "./proposal";
import { WORLD_DELTA_OPS, WorldDeltaSchema } from "./deltas";
import { measureSchema, restoreDefaults, toProviderSchema } from "./provider-schema";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function walk(node: unknown, visit: (node: Json) => void): void {
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (!isObject(node)) return;
  visit(node);
  for (const child of Object.values(node)) walk(child, visit);
}

describe("the delta union in the providers' dialect", () => {
  const schema = toProviderSchema(OrchestratorOutputSchema);

  it("forbids unknown keys and requires every key of every object", () => {
    walk(schema, (node) => {
      if (node.type !== "object" || !isObject(node.properties)) return;
      expect(node.additionalProperties).toBe(false);
      expect(new Set(node.required as string[])).toEqual(new Set(Object.keys(node.properties)));
    });
  });

  it("carries no defaults, bounds or oneOf, which the dialect rejects", () => {
    walk(schema, (node) => {
      for (const key of ["default", "oneOf", "minimum", "maximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "format"]) {
        expect(node).not.toHaveProperty(key);
      }
    });
  });

  it("turns an open record into a list of pairs", () => {
    walk(schema, (node) => {
      if (node.type === "object") expect(isObject(node.additionalProperties)).toBe(false);
    });
  });

  it("keeps the named definitions rather than inlining fifty operations", () => {
    expect(isObject(schema.$defs)).toBe(true);
    expect(Object.keys(schema.$defs as Json).length).toBeGreaterThan(5);
    const size = measureSchema(schema);
    expect(size.chars).toBeGreaterThan(10_000);
  });

  it("is not recursive", () => {
    expect(() => z.toJSONSchema(OrchestratorOutputSchema, { io: "input", cycles: "throw" })).not.toThrow();
  });
});

describe("an answer in the dialect, restored", () => {
  it("drops the nulls that stand for absent fields, for every operation", () => {
    // Every op with a minimal valid delta, written as the provider would
    // return it: every optional field present as null.
    const minimal: Record<string, Json> = {
      money_transfer: { op: "money_transfer", fromAccountRef: "a", toAccountRef: null, amount: 5, reason: "x" },
    };
    for (const op of WORLD_DELTA_OPS) {
      const sample = minimal[op];
      if (sample === undefined) continue;
      const nulled = { ...sample, localId: null };
      const restored = restoreDefaults(WorldDeltaSchema, nulled);
      expect(WorldDeltaSchema.safeParse(restored).success).toBe(true);
    }
  });

  it("rebuilds a record that travelled as pairs", () => {
    const delta = {
      op: "generic_entity_create", localId: "stall", kind: "stall", label: "A cutlery stall", ownerRef: { kind: "character", id: "marcus-metellus" },
      attributes: [{ key: "wares", value: "cutlery" }, { key: "opened", value: 3 }], provinceId: null, effects: [], upkeep: null, reason: "x",
    };
    const restored = restoreDefaults(WorldDeltaSchema, delta) as Json;
    expect(restored.attributes).toEqual({ wares: "cutlery", opened: 3 });
    expect(WorldDeltaSchema.safeParse(restored).success).toBe(true);
  });

  it("leaves a genuine null alone", () => {
    const delta = { op: "money_transfer", fromAccountRef: "a", toAccountRef: null, amount: 5, reason: "x" };
    const restored = restoreDefaults(WorldDeltaSchema, delta) as Json;
    expect(restored.toAccountRef).toBeNull();
  });

  it("restores a whole orchestrator answer with absent lists written as null", () => {
    const answer = {
      intent: { summary: "Nothing.", domains: ["military"] }, narrativeSummary: "Nothing happened.", frictions: null, deltas: [], worldDeltas: null,
      facts: null, discoveries: null, delegations: null, schedule: null, cognitionCandidates: null, outcome: "continue", playerDecision: null, watch: null,
    };
    const restored = restoreDefaults(OrchestratorOutputSchema, answer);
    expect(OrchestratorOutputSchema.safeParse(restored).success).toBe(true);
  });
});
