import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { plotsOf, reviewCast } from "./cast";
import { ensureConstitutions } from "./constitutions";
import type { SimModelPort } from "./ports";

/**
 * The standing cast (docs/plans/a-living-world.md §4): everybody runs on rules
 * until he matters to the player's story, and then the model plays him -- once
 * a burst, handed what he did lately and what lies open to him.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = () => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });

describe("the standing cast", { timeout: 120_000 }, () => {
  it("is the consul's colleague and the men of the Rhegium thread the player is party to, and not the powers across the sea", () => {
    const cast = reviewCast(opening(), "gaius-genucius").cast.members;
    const ids = cast.map((member) => member.characterId);
    expect(ids).toContain("gnaeus-cornelius");
    expect(ids).toContain("decius-vibellius");
    // The cast rule of 2026-10-08 ("anything that interacts directly with the player"): Hanno, Hieron and the Mamertines' spokesman were in it for the Messana thread and for
    // commanding or ruling; none of them has written to the player, been ordered or written to by him, or stands in his army, office or household, so they run on the rules.
    for (const far of ["hanno-carthage", "hieron-ii", "mamertine-spokesman"]) expect(ids, far).not.toContain(far);
    // Never the player, and never more than the seats.
    expect(ids).not.toContain("gaius-genucius");
    expect(cast.length).toBeLessThanOrEqual(8);
  });

  it("gives a foreign ruler the wider world's seat for the turns he deals with the player, and not before", () => {
    const world = opening();
    const hieron = world.characters.find((character) => character.id === "hieron-ii")!;
    const letter = { id: "m-hieron", kind: "letter", fromPolityId: "syracuse", fromCharacterId: "hieron-ii", toPolityId: "rome", toCharacterId: "gaius-genucius", subject: "Messana", terms: "Send aid.", sentAtStep: 0, replyDueByStep: 30, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "private", onRefusal: null } as never;
    expect(plotsOf(world, hieron, "gaius-genucius")).toEqual([]);
    const written = plotsOf({ ...world, diplomacy: [...world.diplomacy, letter] }, hieron, "gaius-genucius");
    expect(written.map((plot) => plot.kind)).toContain("letter");
    expect(written.find((plot) => plot.kind === "letter")!.earns).toBe("world");
  });

  it("keeps a member through a quiet review, and lets him go only after his stay", () => {
    let world = reviewCast(opening(), "gaius-genucius");
    const hanno = () => world.cast.members.find((member) => member.characterId === "decius-vibellius");
    expect(hanno()?.reviews).toBe(0);
    // His thread closes: he matters less, but not at once out of the story.
    world = { ...world, storylines: world.storylines.map((storyline) => ({ ...storyline, phase: "closed" as const, closedAtStep: 0 })) };
    world = reviewCast(world, "gaius-genucius");
    expect(hanno()).toBeDefined();
  });

  it("is asked in the first burst, told why, and shown what lies open to it", async () => {
    const sections: string[] = [];
    const port: SimModelPort = {
      complete(operation, _system, user) {
        if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
        if (operation === "simulate_cognition") sections.push(user);
        return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
      },
    };
    const result = await runSimulationBurst({
      world: opening(), clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
      burstId: "cast", gameId: "the-cast", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: null, spanDays: 30, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    expect(result.world.cast.members.length).toBeGreaterThan(0);
    const all = sections.join("\n");
    // The cast rule (2026-10-08, docs/plans/government.md): a person is in it for an interaction with the player. At the opening that is the consul's colleague, who rules
    // with him, and Decius Vibellius, in the Rhegium thread the player is party to; both are asked in the first round, as cast.
    expect(all).toMatch(/^## .+ \[decius-vibellius\]/m);
    expect(all).toMatch(/one of the people who matter now/);
    // His standing look comes once a burst; he may be asked again for his
    // own business -- news that lands on him, a letter owed -- but not as cast.
    const decius = sections.flatMap((section) => section.split(/^(?=## )/m)).filter((part) => /^## .+ \[decius-vibellius\]/.test(part));
    expect(decius.filter((part) => part.includes("one of the people who matter now"))).toHaveLength(1);
    expect(decius.some((part) => /caught up in Rhegium/.test(part))).toBe(true);
  });
});
