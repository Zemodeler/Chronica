import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";
import {
  MAX_RICH_AGENTS_PER_DECISION_POINT,
  MAX_STAR_CONTEXTS_PER_DECISION_POINT,
  selectRelevantActors,
  selectRelevantCharacters,
} from "./selector";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

const index = () => buildAuthorityIndex({ officeSeats: [], forces: world().material.forces }, [], [], 1);

describe("selectRelevantCharacters (sanity)", () => {
  it("excludes the player's own character and dead characters", () => {
    const selected = selectRelevantCharacters(world(), "marcus-atilius");
    expect(selected.some((s) => s.characterId === "marcus-atilius")).toBe(false);
  });

  it("is deterministic across repeated calls against the same world", () => {
    const w = world();
    expect(selectRelevantCharacters(w, "marcus-atilius")).toEqual(selectRelevantCharacters(w, "marcus-atilius"));
  });
});

describe("selectRelevantActors (docs/32, Phase 7 -- combined NPC+star-context budget)", () => {
  it("never returns more than the combined budget", () => {
    const selected = selectRelevantActors(world(), "marcus-atilius", index(), 1);
    expect(selected.length).toBeLessThanOrEqual(MAX_RICH_AGENTS_PER_DECISION_POINT);
  });

  it("never selects more than the star-context cap, even when many candidates outscore every NPC", () => {
    const selected = selectRelevantActors(world(), "marcus-atilius", index(), 1);
    expect(selected.filter((s) => s.kind === "star_context").length).toBeLessThanOrEqual(MAX_STAR_CONTEXTS_PER_DECISION_POINT);
  });

  it("includes a star context for a belligerent polity in this scenario's active war", () => {
    const selected = selectRelevantActors(world(), "marcus-atilius", index(), 1);
    const starContexts = selected.filter((s) => s.kind === "star_context");
    expect(starContexts.some((s) => s.kind === "star_context" && s.context.scopeRef.kind === "polity" && s.context.scopeRef.id === "carthage")).toBe(true);
  });

  it("is deterministic across repeated calls against the same world and step", () => {
    const w = world();
    const idx = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    expect(selectRelevantActors(w, "marcus-atilius", idx, 1)).toEqual(selectRelevantActors(w, "marcus-atilius", idx, 1));
  });

  it("backfills an excess star-context slot with the next-highest NPC rather than wasting the budget", () => {
    // A tiny total budget with a low star-context cap of 0 forces every slot to NPCs (or stay empty if none qualify).
    const selected = selectRelevantActors(world(), "marcus-atilius", index(), 1, 8, 0);
    expect(selected.every((s) => s.kind === "npc")).toBe(true);
  });

  it("respects an explicit maxTotal below the default budget", () => {
    const selected = selectRelevantActors(world(), "marcus-atilius", index(), 1, 1);
    expect(selected.length).toBeLessThanOrEqual(1);
  });
});

describe("matter-driven priority actors (docs/plans/ai-world-matters-runtime.md, Phase 2)", () => {
  it("includes a matter-priority character id in the result, carrying its specific reasons instead of the generic label", () => {
    const reasons = new Map<string, readonly string[]>([["hanno", ["A treasury obligation is due (recorded responsibility)."]]]);
    const selected = selectRelevantActors(world(), "marcus-atilius", index(), 1, MAX_RICH_AGENTS_PER_DECISION_POINT, MAX_STAR_CONTEXTS_PER_DECISION_POINT, ["hanno"], reasons);
    const hannoEntry = selected.find((s) => s.kind === "npc" && s.characterId === "hanno");
    expect(hannoEntry?.kind).toBe("npc");
    if (hannoEntry?.kind === "npc") {
      expect(hannoEntry.reasons).toContain("A treasury obligation is due (recorded responsibility).");
      expect(hannoEntry.reasons).not.toContain("pending-dialogue-commitment");
    }
  });

  it("still respects the combined total and star-context budgets when a matter priority id is supplied", () => {
    const selected = selectRelevantActors(world(), "marcus-atilius", index(), 1, MAX_RICH_AGENTS_PER_DECISION_POINT, MAX_STAR_CONTEXTS_PER_DECISION_POINT, ["hanno"]);
    expect(selected.length).toBeLessThanOrEqual(MAX_RICH_AGENTS_PER_DECISION_POINT);
    expect(selected.filter((s) => s.kind === "star_context").length).toBeLessThanOrEqual(MAX_STAR_CONTEXTS_PER_DECISION_POINT);
  });

  it("falls back to the generic reason when no specific reasons are supplied for a priority id", () => {
    const selected = selectRelevantCharacters(world(), "marcus-atilius", MAX_RICH_AGENTS_PER_DECISION_POINT, ["hanno"]);
    const hannoEntry = selected.find((s) => s.characterId === "hanno");
    expect(hannoEntry?.reasons).toContain("pending-dialogue-commitment");
  });
});
