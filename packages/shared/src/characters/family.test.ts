import { describe, expect, it } from "vitest";
import { WorldStateSchema } from "../world/world-state";
import { firstPunicWarScenario } from "@chronica/db";
import { childrenOf, familyLinksOf, reciprocalFamilyLinkKind } from "./family";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("reciprocalFamilyLinkKind", () => {
  it("maps parent/child, guardian/ward as inverse pairs, and symmetric kinds to themselves", () => {
    expect(reciprocalFamilyLinkKind("parent")).toBe("child");
    expect(reciprocalFamilyLinkKind("child")).toBe("parent");
    expect(reciprocalFamilyLinkKind("guardian")).toBe("ward");
    expect(reciprocalFamilyLinkKind("sibling")).toBe("sibling");
    expect(reciprocalFamilyLinkKind("spouse_or_partner")).toBe("spouse_or_partner");
  });
});

describe("familyLinksOf / childrenOf", () => {
  it("resolves the authored parent link from both directions", () => {
    const w = world();
    const parentSide = familyLinksOf(w, "marcus-atilius");
    expect(parentSide.some((v) => v.kind === "parent" && v.counterpartCharacterId === "marcus-atilius-minor")).toBe(true);

    const childSide = familyLinksOf(w, "marcus-atilius-minor");
    expect(childSide.some((v) => v.kind === "child" && v.counterpartCharacterId === "marcus-atilius")).toBe(true);
  });

  it("lists children via the parent-side link", () => {
    expect(childrenOf(world(), "marcus-atilius")).toContain("marcus-atilius-minor");
  });
});

describe("WorldStateSchema family-graph validation", () => {
  it("rejects a self-link", () => {
    const w = world();
    w.familyLinks.push({ id: "bad", characterId: "marcus-atilius", relatedCharacterId: "marcus-atilius", kind: "parent", startedAtStep: 0, endedAtStep: null, visibility: "polity", provenanceEventId: null });
    expect(WorldStateSchema.safeParse(w).success).toBe(false);
  });

  it("rejects a duplicate active link of the same kind between the same two characters", () => {
    const w = world();
    w.familyLinks.push({ id: "dup", characterId: "marcus-atilius", relatedCharacterId: "marcus-atilius-minor", kind: "parent", startedAtStep: 0, endedAtStep: null, visibility: "polity", provenanceEventId: null });
    expect(WorldStateSchema.safeParse(w).success).toBe(false);
  });

  it("rejects a parent/child relationship running in both directions between the same two characters", () => {
    const w = world();
    w.familyLinks.push({ id: "reverse", characterId: "marcus-atilius-minor", relatedCharacterId: "marcus-atilius", kind: "parent", startedAtStep: 0, endedAtStep: null, visibility: "polity", provenanceEventId: null });
    expect(WorldStateSchema.safeParse(w).success).toBe(false);
  });

  it("rejects a family link naming an unknown character", () => {
    const w = world();
    w.familyLinks.push({ id: "ghost", characterId: "marcus-atilius", relatedCharacterId: "nobody", kind: "sibling", startedAtStep: 0, endedAtStep: null, visibility: "polity", provenanceEventId: null });
    expect(WorldStateSchema.safeParse(w).success).toBe(false);
  });

  it("accepts an ended duplicate alongside a new active link of the same kind", () => {
    const w = world();
    w.familyLinks = w.familyLinks.map((link) => (link.characterId === "marcus-atilius" ? { ...link, endedAtStep: 5 } : link));
    w.familyLinks.push({ id: "renewed", characterId: "marcus-atilius", relatedCharacterId: "marcus-atilius-minor", kind: "parent", startedAtStep: 6, endedAtStep: null, visibility: "polity", provenanceEventId: null });
    expect(WorldStateSchema.safeParse(w).success).toBe(true);
  });
});
