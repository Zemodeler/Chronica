import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Find out what Hanno is planning."
 *
 * There was no way to learn anything. A spy is a plot that hurts nobody: it
 * takes the time a plot takes and runs the risks a plot runs, and what it
 * brings home is a report -- secrets, intentions, men and money, friendships --
 * that the man who paid for it now knows.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context: ApplyContext = {
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices,
  warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("spy"), gameId: "game-spy",
};

/** Hanno, with something to hide. */
function world(): WorldState {
  const state = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return {
    ...state,
    characterBeliefs: [...state.characterBeliefs, {
      id: "hanno-secret", holderCharacterId: "hanno-carthage", subjectEntityId: null, claim: "the garrison at Messana will open its gates for silver",
      kind: "secret", sourceCharacterId: null, sourceEventId: null, confidence: 90, visibility: "private", learnedAtStep: 0, expiresAtStep: null,
      supersedesBeliefIds: [], status: "active",
    }],
  };
}

function spiedOn(odds: { success: number; secrecy: number }) {
  const laid = applyDeltas(world(), [WorldDeltaSchema.parse({
    op: "covert_plot_open", localId: "watcher", kind: "espionage", targetCharacterRef: "hanno-carthage", sponsorCharacterRef: "gaius-genucius",
    agentCharacterRef: null, fundingAccountRef: "gaius-purse", spend: 100, cover: "A Greek merchant with too many questions.", expectedInDays: 40,
    reason: "Gaius wants to know what Carthage means to do.",
  })], context);
  expect(laid.rejected).toEqual([]);
  // The odds, pinned: the ladder is tested elsewhere, and this is about what each end of it brings back.
  const plot = laid.world.covertPlots.at(-1)!;
  const fixed = { ...laid.world, covertPlots: laid.world.covertPlots.map((candidate) => (candidate.id === plot.id ? { ...candidate, successOddsBps: odds.success, secrecyBps: odds.secrecy } : candidate)) };
  const ticked = runDeterministicTick({ world: fixed, toDay: plot.resolvesAtStep, ids: createIdFactory("spy-tick"), warfare: definition.warfare, life: definition.life });
  return { plotId: plot.id, ...ticked };
}

describe("a spy", () => {
  it("brings home what the man hides and means, and hurts nobody", () => {
    const { world: after, factProposals, plotId } = spiedOn({ success: 10_000, secrecy: 10_000 });
    expect(after.covertPlots.find((plot) => plot.id === plotId)?.outcome).toBe("learned");
    const hanno = after.characters.find((character) => character.id === "hanno-carthage")!;
    expect(hanno.alive).toBe(true);
    expect(hanno.disqualifyingStatuses).toEqual([]);

    const report = factProposals.find((fact) => fact.kind === "spy_report")!;
    expect(report.visibility).toBe("private");
    expect(report.knownToRefs?.map((ref) => ref.id)).toContain("gaius-genucius");
    // Now it is something Gaius knows.
    const known = after.characterBeliefs.filter((belief) => belief.holderCharacterId === "gaius-genucius" && belief.subjectEntityId === "hanno-carthage");
    expect(known.length).toBeGreaterThan(0);
    const said = [report.summary, ...known.map((belief) => belief.claim)].join(" ");
    expect(said).toMatch(/troubled by|wants|commands|purse|secret/);
  });

  it("is caught, and names the man who sent him", () => {
    const { world: after, factProposals, plotId } = spiedOn({ success: 0, secrecy: 0 });
    expect(after.covertPlots.find((plot) => plot.id === plotId)?.outcome).toBe("discovered");
    expect(factProposals.find((fact) => fact.kind === "spy_caught")?.summary).toMatch(/Gaius Genucius Clepsina/);
    expect(after.characterBeliefs.some((belief) => belief.holderCharacterId === "hanno-carthage" && belief.claim.includes("set a spy on me"))).toBe(true);
  });
});
