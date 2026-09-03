import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { RelationCause } from "./character";
import {
  canModifyRelationship,
  deriveReputation,
  deriveRelationDimension,
  listSocialLinks,
  relationshipLabelFor,
  strongestCauses,
} from "./relationship-dimensions";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function cause(overrides: Partial<RelationCause> = {}): RelationCause {
  return {
    id: "c1", label: "x", score: 10, occurredAtStep: 1, decayPerYearBps: 0, encounterMemoryId: null,
    ...overrides,
  };
}

describe("deriveRelationDimension", () => {
  it("is directional: A's dimension toward B is independent of B's toward A", () => {
    const marcus = { ...world().characters.find((c) => c.id === "marcus-atilius")! };
    marcus.relations = [{ subjectCharacterId: "hanno", causes: [cause({ dimensions: { trust: 40 } })] }];
    const hanno = { ...world().characters.find((c) => c.id === "hanno")! };
    hanno.relations = [];

    expect(deriveRelationDimension(marcus, "hanno", "trust")).toBe(40);
    expect(deriveRelationDimension(hanno, "marcus-atilius", "trust")).toBe(0);
  });

  it("falls back to the legacy rule: a cause with no dimensions map counts entirely toward affection, nothing else", () => {
    const character = { ...world().characters[0]!, relations: [{ subjectCharacterId: "target", causes: [cause({ score: 30 })] }] };
    expect(deriveRelationDimension(character, "target", "affection")).toBe(30);
    expect(deriveRelationDimension(character, "target", "trust")).toBe(0);
    expect(deriveRelationDimension(character, "target", "fear")).toBe(0);
  });

  it("clamps the folded total to [-100, 100]", () => {
    const causes = Array.from({ length: 20 }, (_, i) => cause({ id: `c${i}`, dimensions: { fear: 20 } }));
    const character = { ...world().characters[0]!, relations: [{ subjectCharacterId: "target", causes }] };
    expect(deriveRelationDimension(character, "target", "fear")).toBe(100);
  });
});

describe("deriveReputation", () => {
  it("aggregates public-visibility reputation contributions from every character who holds one", () => {
    const w = world();
    const target = w.characters[0]!.id;
    const withReputation = {
      ...w,
      characters: w.characters.map((c, i) =>
        i === 1 ? { ...c, relations: [{ subjectCharacterId: target, causes: [cause({ dimensions: { reputation: -20 } })] }] } : c,
      ),
    };
    expect(deriveReputation(withReputation, target)).toBe(-20);
  });
});

describe("relationshipLabelFor", () => {
  it("labels low, mid, and high scores distinctly for a dimension", () => {
    expect(relationshipLabelFor("trust", -50)).toBe("wary");
    expect(relationshipLabelFor("trust", 0)).toBe("neutral");
    expect(relationshipLabelFor("trust", 50)).toBe("trusting");
  });
});

describe("strongestCauses", () => {
  it("ranks causes by magnitude on the requested dimension and excludes zero-contribution causes", () => {
    const character = {
      ...world().characters[0]!,
      relations: [{
        subjectCharacterId: "target",
        causes: [
          cause({ id: "small", dimensions: { trust: 5 } }),
          cause({ id: "big", dimensions: { trust: -40 } }),
          cause({ id: "irrelevant", dimensions: { fear: 30 } }),
        ],
      }],
    };
    const top = strongestCauses(character, "target", "trust", 2);
    expect(top.map((c) => c.id)).toEqual(["big", "small"]);
  });
});

describe("listSocialLinks", () => {
  it("lists links naming the character as either subject or target", () => {
    const w = {
      ...world(),
      socialLinks: [
        { id: "l1", subjectCharacterId: "a", targetCharacterId: "b", kind: "ally" as const, sourceEventId: null, createdAtStep: 0, visibility: "public" as const },
        { id: "l2", subjectCharacterId: "c", targetCharacterId: "a", kind: "rival" as const, sourceEventId: null, createdAtStep: 0, visibility: "public" as const },
        { id: "l3", subjectCharacterId: "c", targetCharacterId: "d", kind: "kin" as const, sourceEventId: null, createdAtStep: 0, visibility: "public" as const },
      ],
    };
    expect(listSocialLinks(w, "a").map((l) => l.id).sort()).toEqual(["l1", "l2"]);
  });
});

describe("canModifyRelationship", () => {
  it("refuses a favour once affection is already saturated at +100", () => {
    const character = {
      ...world().characters[0]!,
      relations: [{ subjectCharacterId: "target", causes: [cause({ dimensions: { affection: 100 } })] }],
    };
    expect(canModifyRelationship("favour", character, "target")).toBe(false);
    expect(canModifyRelationship("insult", character, "target")).toBe(true);
  });

  it("permits a promise (raises obligation) when obligation is not yet saturated", () => {
    const character = { ...world().characters[0]!, relations: [] };
    expect(canModifyRelationship("promise", character, "target")).toBe(true);
  });
});
