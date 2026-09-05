import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  executeWorkflow,
  generateCandidateActions,
  rankCandidates,
  selectRelevantCharacters,
} from "@chronica/shared";
import { buildIntentInvocation, hasActiveAgencyState, isEligibleForNpcAgency } from "./character-agency";

// Regression: in the opening 270 BCE Punic Wars scenario, Carthage existed
// only as a force with no goal, plot, pressure, relationship, or
// participation in the Messana crisis it sits beside -- so Hanno never had
// anything for character agency to act on, and the deterministic selector's
// "important" tier (a force commander, nothing more) was excluded from NPC
// agency outright. These tests pin down the whole path an opening turn needs:
// selection, a real (non-wait) candidate, and a workflow the Game Master can
// actually invoke -- never free-form prose standing in for Carthage acting.

const HANNO = "hanno-carthage";
const OTHER_PLAYER_CHARACTER = "gaius-genucius";

function world() {
  return structuredClone(punicWarsScenario.initialWorld);
}

describe("Carthage's opening-turn agency", () => {
  it("selects Hanno as relevant even though the player is someone else entirely", () => {
    const selected = selectRelevantCharacters(world(), OTHER_PLAYER_CHARACTER);
    expect(selected.some((entry) => entry.characterId === HANNO)).toBe(true);
  });

  it("gives Hanno explicit scenario relevance (a real goal, plot, and pressure), not just a commanded force", () => {
    expect(hasActiveAgencyState(world(), HANNO)).toBe(true);
  });

  it("does not broadly admit force commanders with no authored agency state", () => {
    // Gaius commands no force here, but the point holds generally: a bare
    // "important" selection tier from commanding a force is not, on its own,
    // enough to be eligible for full candidate generation -- only explicit,
    // scenario-authored relevance is.
    expect(isEligibleForNpcAgency("ordinary", false, "important", false)).toBe(false);
    expect(isEligibleForNpcAgency("ordinary", false, "important", hasActiveAgencyState(world(), HANNO))).toBe(true);
  });

  it("generates a real, non-wait top candidate for Hanno from his authored plot", () => {
    const w = world();
    const hanno = w.characters.find((character) => character.id === HANNO)!;
    const candidates = generateCandidateActions({ world: w, character: hanno, atStep: 1, commitments: [] });
    const top = rankCandidates(w, hanno, candidates, 1)[0];

    expect(top).toBeDefined();
    expect(top!.candidate.actionType).not.toBe("wait");
    expect(top!.candidate.actionType).toBe("advance_plot");
    expect(top!.candidate.legalWorkflowIds).toContain("advance_character_plot");
  });

  it("turns that candidate into an executable proposal with authoritative ids and actor", () => {
    const w = world();
    const hanno = w.characters.find((character) => character.id === HANNO)!;
    const candidates = generateCandidateActions({ world: w, character: hanno, atStep: 1, commitments: [] });
    const top = rankCandidates(w, hanno, candidates, 1)[0]!;

    const invocation = buildIntentInvocation(top.candidate, w);
    expect(invocation).not.toBeNull();
    expect(invocation?.actionId).toBe("advance_character_plot");
    expect(invocation?.actorId).toBe(HANNO);
    expect(invocation?.parameters["plotId"]).toBe("hanno-plot-messana-watch");
  });

  it("records a validated Carthaginian action when that proposal is actually executed", () => {
    const w = world();
    const hanno = w.characters.find((character) => character.id === HANNO)!;
    const candidates = generateCandidateActions({ world: w, character: hanno, atStep: 1, commitments: [] });
    const top = rankCandidates(w, hanno, candidates, 1)[0]!;
    const invocation = buildIntentInvocation(top.candidate, w)!;

    const outcome = executeWorkflow(invocation, w, 1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const plot = outcome.world.characterPlots?.find((candidate) => candidate.id === "hanno-plot-messana-watch");
      expect(plot?.stage).toBe("preparing");
      expect(outcome.result.summary).toContain("Hanno of Carthage");
    }
  });
});
