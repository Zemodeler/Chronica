import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import type { NarratorSeed } from "./narrator";
import { ORCHESTRATOR_SYSTEM_PROMPT, orchestrate } from "./orchestrate";
import type { SimModelPort } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";

/**
 * The world's own business is put to one line of a split order (docs/reports/consul-run-issues.md, H6, M1, M4). An order of
 * three commands was asked as three calls, each carrying the season's seeds and the countries with nobody in them: answered
 * faithfully, one seed made two threads, and one empty country two rulers.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ORDER = "March the field army to Rhegium and lay siege to the city. Send a letter to Hieron of Syracuse offering friendship. Ask the Senate to fund a fleet of a hundred ships.";

const seed = (archetype: string, key: string): NarratorSeed => ({
  key, kind: "world_event", archetype, severity: "serious", secret: false, oneShot: false,
  target: { provinceId: null, provinceName: null, polityId: null, polityName: null, characterId: null, characterName: null, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false },
  inPlayerRealm: false, repeated: false, pressureId: null, why: "the world turns", brief: "Something happens.",
} as unknown as NarratorSeed);

function slice() {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const built = buildWorldSlice({ world, clock: definition.clock, offices: definition.government.offices, actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: ORDER, facts: [], dueEvents: [], pendingEvents: [] });
  return { ...built, seeds: [seed("rivalry", "seed-new-thread"), seed("arc_beat", "seed-arc-old-thread")], populationGaps: [{ polityId: "messapians", name: "Messapians", needsLeader: false, needsForce: true, land: [], why: "they border us" }] };
}

describe("a split order", () => {
  it("puts the season's seeds and the empty countries to its first line only", async () => {
    const asked: string[] = [];
    const port: SimModelPort = { complete(_operation, _system, user) {
      asked.push(user);
      const said = user.split("PLAYER ORDER:")[1]?.trim().split("\n")[0] ?? "order";
      return Promise.resolve(JSON.stringify({ narrativeSummary: said, deltas: [], facts: [], outcome: "continue", playerDecision: null, intent: { summary: said, parts: [{ said, acts: [], goals: [], spend: null, factLocalIds: [], whyNot: null }] } }));
    } };
    await orchestrate(port, slice());
    expect(asked.length).toBeGreaterThan(1);
    expect(asked.filter((user) => user.includes("THE WORLD STIRS"))).toHaveLength(1);
    expect(asked.filter((user) => user.includes("COUNTRIES WITH NOBODY IN THEM"))).toHaveLength(1);
  });

  it("asks a turn of an open thread to be advanced, not opened again, and an empty country only for what it lacks", () => {
    const text = renderWorldSlice(slice());
    expect(text).toContain('Open its thread with "storyline_open" carrying seedKey "seed-new-thread"');
    expect(text).not.toContain('seedKey "seed-arc-old-thread"');
    expect(text).toContain("Its thread is already open: advance it, and open no other.");
    expect(text).toContain("what it lacks");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("what it lacks");
  });
});
