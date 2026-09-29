import { describe, expect, it } from "vitest";
import { TRAIT_REGISTRY, TraitDefinitionSchema, canonicalTraitIds, getTraitDefinition, leaning, observeTraits, resolveTraits, validateTraitIds } from "./traits";

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

describe("the people around you decide what you are", () => {
  const traitsOf = (held: readonly string[]) => () => held;
  const ids = () => { let n = 0; return (prefix: string) => `${prefix}-${(n += 1)}`; };

  it("takes two people saying it before it is who somebody is", () => {
    // One hostile legate does not get to rename the player "deceitful".
    const first = observeTraits([], [{ characterId: "marcus", observerCharacterId: "hanno", traitId: "bold", note: "He crossed before dawn." }], traitsOf([]), 10, ids());
    expect(first.observations).toHaveLength(1);
    expect(first.confirmed).toHaveLength(0);

    const second = observeTraits(first.observations, [{ characterId: "marcus", observerCharacterId: "quintus", traitId: "bold", note: "He never waits for the Senate." }], traitsOf([]), 20, ids());
    expect(second.confirmed).toEqual([{ characterId: "marcus", traitId: "bold", observerCharacterIds: ["hanno", "quintus"] }]);
  });

  it("does not let one person say it twice and call that agreement", () => {
    const once = observeTraits([], [{ characterId: "marcus", observerCharacterId: "hanno", traitId: "bold", note: "Again." }], traitsOf([]), 10, ids());
    const twice = observeTraits(once.observations, [{ characterId: "marcus", observerCharacterId: "hanno", traitId: "bold", note: "Still." }], traitsOf([]), 20, ids());
    expect(twice.observations).toHaveLength(1);
    expect(twice.confirmed).toHaveLength(0);
  });

  it("does not let one contrary voice unmake what somebody is known to be", () => {
    // It took two people to put "cautious" there. One contrary opinion is on
    // record, and does not unmake it.
    const outcome = observeTraits([], [{ characterId: "marcus", observerCharacterId: "hanno", traitId: "bold", note: "He seemed rash to me." }], traitsOf(["cautious"]), 10, ids());
    expect(outcome.observations).toHaveLength(1);
    expect(outcome.lost).toHaveLength(0);
    expect(outcome.confirmed).toHaveLength(0);
    expect(outcome.refused[0]!.reason).toContain("contradicts");
  });

  it("lets two people who saw the opposite take a trait away, as two gave it", () => {
    const first = observeTraits([], [{ characterId: "marcus", observerCharacterId: "hanno", traitId: "bold", note: "He charged the elephants." }], traitsOf(["cautious"]), 10, ids());
    const second = observeTraits(first.observations, [{ characterId: "marcus", observerCharacterId: "quintus", traitId: "bold", note: "He crossed before the Senate spoke." }], traitsOf(["cautious"]), 20, ids());
    expect(second.lost).toEqual([{ characterId: "marcus", traitId: "cautious", contradictedBy: "bold", observerCharacterIds: ["hanno", "quintus"] }]);
    // The opposite is not who he is yet: a third person has to see it once the old name is gone.
    expect(second.confirmed).toHaveLength(0);
    const third = observeTraits(second.observations, [{ characterId: "marcus", observerCharacterId: "gisco", traitId: "bold", note: "Again." }], traitsOf([]), 30, ids());
    expect(third.confirmed[0]?.traitId).toBe("bold");
  });

  it("counts against a trait only what was seen since he was last seen to be it", () => {
    const old = observeTraits([], [{ characterId: "marcus", observerCharacterId: "hanno", traitId: "bold", note: "Once, years ago." }], traitsOf(["cautious"]), 10, ids());
    const since = [...old.observations, { id: "seen-cautious", characterId: "marcus", observerCharacterId: "gisco", traitId: "cautious", note: "He waited us out.", atStep: 50 }];
    const outcome = observeTraits(since, [{ characterId: "marcus", observerCharacterId: "quintus", traitId: "bold", note: "Rash today." }], traitsOf(["cautious"]), 60, ids());
    expect(outcome.lost).toHaveLength(0);
  });

  it("refuses a word the engine does not have, without failing anything else", () => {
    const outcome = observeTraits([], [
      { characterId: "marcus", observerCharacterId: "hanno", traitId: "lugubrious", note: "A sad man." },
      { characterId: "marcus", observerCharacterId: "hanno", traitId: "bold", note: "And a rash one." },
    ], traitsOf([]), 10, ids());
    expect(outcome.refused).toHaveLength(1);
    expect(outcome.observations).toHaveLength(1);
  });

  it("does not let anybody observe themselves into a character", () => {
    const outcome = observeTraits([], [{ characterId: "marcus", observerCharacterId: "marcus", traitId: "bold", note: "I am bold." }], traitsOf([]), 10, ids());
    expect(outcome.observations).toHaveLength(0);
    expect(outcome.refused[0]!.reason).toContain("themselves");
  });

  it("stops when the world has said enough about somebody", () => {
    const full = ["cautious", "bold", "dutiful", "sociable", "disciplined", "compassionate", "vengeful", "cruel"];
    const outcome = observeTraits([], [{ characterId: "marcus", observerCharacterId: "hanno", traitId: "ambitious", note: "One more." }], traitsOf(full), 10, ids());
    expect(outcome.observations).toHaveLength(0);
  });
});

describe("reducing a description to words the engine has", () => {
  it("maps what a live world was actually storing as traits", () => {
    // Every one of these was a real trait on a real character in a real save,
    // and not one of them conferred anything: the dialogue guidance NPC
    // prompts read and the incompatibilities the observation rule checks both
    // live in the registry, and none of these were in it.
    expect(canonicalTraitIds(["methodical"])).toEqual(["disciplined"]);
    expect(canonicalTraitIds(["charismatic"])).toEqual(["sociable"]);
    expect(canonicalTraitIds(["cavalry leader", "pragmatic"])).toEqual(["disciplined"]);
    expect(canonicalTraitIds(["hellenistic_governor", "administrative"])).toEqual(["disciplined"]);
    expect(canonicalTraitIds(["protective of tribal autonomy"])).toEqual(["compassionate"]);
  });

  it("passes a real registry id straight through, whoever authored it", () => {
    expect(canonicalTraitIds(["bold", "dutiful"])).toEqual(["bold", "dutiful"]);
  });

  it("drops what it cannot place rather than storing furniture", () => {
    expect(canonicalTraitIds(["anti-roman", "hellenic"])).toEqual([]);
  });

  it("keeps neither half of a contradiction it has no basis to settle", () => {
    expect(canonicalTraitIds(["cautious", "reckless"])).toEqual([]);
  });

  it("is order-stable, so two identically-described people are identical", () => {
    expect(canonicalTraitIds(["loyal", "bold"])).toEqual(canonicalTraitIds(["bold", "loyal"]));
  });
});

describe("which way a man's character pulls", () => {
  it("sums what his traits say about one kind of decision, and nothing for a stranger", () => {
    expect(leaning({ traits: ["bold"] }, "risk")).toBe(10);
    expect(leaning({ traits: ["cautious"] }, "risk")).toBe(-10);
    expect(leaning({ traits: ["deceitful", "cruel"] }, "honesty")).toBe(-12);
    expect(leaning({ traits: ["deceitful", "cruel"] }, "cruelty")).toBe(12);
    expect(leaning({ traits: [] }, "risk")).toBe(0);
    expect(leaning({ traits: ["hellenistic_governor"] }, "risk")).toBe(0);
  });
});
