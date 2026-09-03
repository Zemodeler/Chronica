import { describe, expect, it } from "vitest";
import { TRAIT_REGISTRY, TraitDefinitionSchema, getTraitDefinition, resolveTraits, validateTraitIds } from "./traits";

describe("TRAIT_REGISTRY", () => {
  it("seeds the initial ten traits, each schema-valid", () => {
    const expectedIds = ["cautious", "bold", "ambitious", "dutiful", "vengeful", "sociable", "disciplined", "deceitful", "compassionate", "cruel"];
    for (const id of expectedIds) {
      const def = getTraitDefinition(id);
      expect(def).toBeDefined();
      expect(() => TraitDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it("never grants a resource/office/knowledge effect — decisionModifiers are bounded numeric nudges only", () => {
    for (const def of Object.values(TRAIT_REGISTRY)) {
      for (const value of Object.values(def.decisionModifiers)) {
        expect(value).toBeGreaterThanOrEqual(-20);
        expect(value).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe("validateTraitIds", () => {
  it("flags an unknown trait id", () => {
    const result = validateTraitIds(["bold", "not-a-real-trait"]);
    expect(result.valid).toEqual(["bold"]);
    expect(result.unknown).toEqual(["not-a-real-trait"]);
  });

  it("flags a mutually incompatible pair", () => {
    const result = validateTraitIds(["bold", "cautious"]);
    expect(result.incompatiblePairs).toEqual([["bold", "cautious"]]);
  });

  it("does not flag a compatible pair", () => {
    const result = validateTraitIds(["bold", "sociable"]);
    expect(result.incompatiblePairs).toEqual([]);
  });
});

describe("resolveTraits", () => {
  it("resolves known ids and silently drops unknown ones", () => {
    const defs = resolveTraits(["bold", "unknown-id"]);
    expect(defs.map((d) => d.id)).toEqual(["bold"]);
  });
});
