import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { CampaignMemorySchema, EMPTY_CAMPAIGN_MEMORY, MAX_CAMPAIGN_RECENT_TURNS, foldTurnIntoCampaignMemory } from "./campaign-memory";
import { deriveOpenThreads, renderOpenThreads, summarizeTurnFacts } from "./memory";
import type { FactualEvent } from "./session";

function turn(atStep: number, summary: string) {
  return { atStep, summary, executedActionIds: ["create_force"], unresolvedActionCount: 0 };
}

describe("campaign memory", () => {
  it("keeps recent turns in full and compacts the rest into the durable summary", () => {
    let memory = EMPTY_CAMPAIGN_MEMORY;
    for (let step = 1; step <= MAX_CAMPAIGN_RECENT_TURNS + 3; step += 1) {
      memory = foldTurnIntoCampaignMemory(memory, turn(step, `Step ${step} happened in detail.`));
    }

    expect(memory.recentTurns).toHaveLength(MAX_CAMPAIGN_RECENT_TURNS);
    expect(memory.recentTurns[0]?.atStep).toBe(4);
    expect(memory.recentTurns.at(-1)?.atStep).toBe(MAX_CAMPAIGN_RECENT_TURNS + 3);
    // The turns that fell out are not lost, only shortened.
    expect(memory.durableSummary).toContain("Step 1:");
    expect(memory.durableSummary).toContain("Step 3:");
    expect(memory.updatedAtStep).toBe(MAX_CAMPAIGN_RECENT_TURNS + 3);
    expect(CampaignMemorySchema.safeParse(memory).success).toBe(true);
  });

  it("replaces rather than duplicates a turn folded in twice", () => {
    const once = foldTurnIntoCampaignMemory(EMPTY_CAMPAIGN_MEMORY, turn(1, "First account."));
    const twice = foldTurnIntoCampaignMemory(once, turn(1, "Corrected account."));

    expect(twice.recentTurns).toHaveLength(1);
    expect(twice.recentTurns[0]?.summary).toBe("Corrected account.");
  });

  it("stays inside its schema bounds however long a campaign runs", () => {
    let memory = EMPTY_CAMPAIGN_MEMORY;
    for (let step = 1; step <= 200; step += 1) {
      memory = foldTurnIntoCampaignMemory(memory, turn(step, `Step ${step}: a long and detailed account of everything that happened, repeated at length.`));
    }
    expect(memory.durableSummary.length).toBeLessThanOrEqual(3_000);
    expect(CampaignMemorySchema.safeParse(memory).success).toBe(true);
  });
});

describe("summarizeTurnFacts", () => {
  const event = (id: string, summary: string, kind: FactualEvent["kind"] = "action"): FactualEvent => ({
    id, atStep: 1, kind, actionId: "create_force", actorId: "marcus-atilius", parameters: {}, summary, materialConsequence: kind === "action",
  });

  it("is built from executed tool results, not from anyone's prose", () => {
    const summary = summarizeTurnFacts(1, [event("f1", "Legio II raised in Latium."), event("f2", "Legio II moves to Sicily.")], []);

    expect(summary.atStep).toBe(1);
    expect(summary.summary).toContain("Legio II raised in Latium.");
    expect(summary.summary).toContain("Legio II moves to Sicily.");
    expect(summary.executedActionIds).toEqual(["create_force"]);
    expect(summary.unresolvedActionCount).toBe(0);
  });

  it("counts unsupported attempts without counting them as actions", () => {
    const gap = event("f1", "An attempt the simulation does not model. No world change followed.", "capability_gap");
    const summary = summarizeTurnFacts(2, [gap], [{
      id: "capability-2-1",
      atStep: 2,
      resolution: "unsupported",
      usageCount: 1,
      observedOutcomes: [],
      request: {
        requestedIntent: "Swear an oath.",
        whyNoRegisteredToolFits: "No tool for it.",
        actorId: "marcus-atilius",
        targetEntityIds: [],
        proposedToolName: "swear_oath",
        proposedParameters: [],
        expectedStateEffect: "A binding promise.",
        safetyConstraints: [],
        scenarioContext: "Roman oaths matter.",
        compositionAttempted: [],
        bestAvailableFallbackToolName: null,
      },
    }]);

    expect(summary.executedActionIds).toEqual([]);
    expect(summary.unresolvedActionCount).toBe(1);
  });

  it("says so plainly when a turn changed nothing", () => {
    expect(summarizeTurnFacts(3, [], []).summary).toBe("No world change occurred this turn.");
  });
});

describe("open threads", () => {
  it("read every unfinished thing straight out of committed state", () => {
    const threads = deriveOpenThreads(firstPunicWarScenario.initialWorld);

    expect(threads.wars.length).toBeGreaterThan(0);
    expect(threads.wars[0]).toContain("at war with");
    expect(renderOpenThreads(threads)).toContain("Wars in progress");
  });

  it("say so rather than rendering an empty scaffold when nothing is open", () => {
    const quiet = {
      ...structuredClone(firstPunicWarScenario.initialWorld),
      conflicts: { battles: [], sieges: [], wars: [] },
      chronicleChains: [],
      commitments: [],
      characterPressures: [],
      operations: [],
      map: { ...firstPunicWarScenario.initialWorld.map, politicalRelations: [] },
      material: { ...firstPunicWarScenario.initialWorld.material, politicalProcedures: [] },
    };

    expect(renderOpenThreads(deriveOpenThreads(quiet))).toBe("Nothing is currently unresolved.");
  });
});

describe("an army standing on someone else's ground", () => {
  // The regression this guards: a legion marches into a neighbour's territory
  // without a war, a battle, or a siege, and leaves no trace in any thread --
  // so the invaded power has nothing to notice and reliably does nothing.
  const invaded = () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const foreignProvince = world.map.provinces.find((province) => province.controllerPolityId !== null && province.controllerPolityId !== "rome");
    world.material.forces = world.material.forces.map((force) =>
      force.polityId === "rome" ? { ...force, locationId: foreignProvince!.id } : force,
    );
    return { world, foreignProvince: foreignProvince! };
  };

  it("is an unresolved thread naming the force, its owner, and whose ground it stands on", () => {
    const { world, foreignProvince } = invaded();
    const threads = deriveOpenThreads(world);

    expect(threads.incursions.length).toBeGreaterThan(0);
    expect(threads.incursions[0]).toContain(foreignProvince.name);
    expect(renderOpenThreads(threads)).toContain("Foreign forces on another power's ground");
  });

  it("says nothing about a force sitting at home", () => {
    expect(deriveOpenThreads(structuredClone(firstPunicWarScenario.initialWorld)).incursions).toEqual([]);
  });

  it("names an invaded power that has no living leader, so one can be given to it", () => {
    const { world, foreignProvince } = invaded();
    const host = foreignProvince.controllerPolityId!;
    world.characters = world.characters.map((character) => (character.polityId === host ? { ...character, alive: false } : character));

    expect(deriveOpenThreads(world).leaderlessPolities.some((entry) => entry.includes(host))).toBe(true);
  });
});
