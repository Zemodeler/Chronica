import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type Fact, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { composeChronicle, whoIsWho } from "./chronicle";
import { coastalProvinceIds } from "./narrator";
import { createIdFactory, type SimModelPort } from "./ports";

/**
 * What a live run of real orders showed was wrong with the record, and was
 * not an error anywhere: the answer to "start a church" buried among nine
 * entries of the wider world's news, a historian who wrote two men as one --
 * "Mamertine spokesman Furius" -- and a grain fleet sunk off a province in
 * the Carpathians.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

let factCount = 0;
function fact(summary: string, affected: Fact["affectedEntities"]): Fact {
  factCount += 1;
  return {
    id: `fact-${factCount}`,
    kind: "event",
    summary,
    time: { day: 1, minute: 540 },
    atStep: 1,
    affectedEntities: affected,
    visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    causalDepth: 0,
    causalFactIds: [],
    storylineId: null,
  } as unknown as Fact;
}

function recordingHistorian(): { port: SimModelPort; shown: string[] } {
  const shown: string[] = [];
  return { shown, port: { complete: (_op, _system, user) => { shown.push(user); return Promise.reject(new Error("unscripted")); } } };
}

describe("the answer to the order comes first, and the world does not bury it", () => {
  it("leads with the order's own matter and carries only a few of the world's", async () => {
    const answer = fact("Gaius Genucius founded a temple of the Unconquered Sun in Rome.", [{ kind: "character", id: "gaius-genucius" }]);
    const elsewhere = Array.from({ length: 9 }, (_, index) =>
      fact(`Something happened in a far country, number ${index + 1}.`, [{ kind: "polity", id: `far-power-${index}` }]));
    const { port } = recordingHistorian();
    const record = await composeChronicle({
      port, clock: definition.clock, observer: { kind: "character", id: "gaius-genucius" }, observerPolityId: "rome",
      facts: [...elsewhere, answer], from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 },
      narrative: [], frictions: [], orderFactIds: new Set([answer.id]), ownEntityIds: new Set(["rome", "gaius-genucius"]),
    });
    expect(record.entries[0]!.factIds).toContain(answer.id);
    expect(record.entries.length).toBeLessThanOrEqual(1 + 3);
  });
});

describe("who is who", () => {
  it("tells the historian each person apart, with their station and their power", async () => {
    const state = world();
    const both = fact("Gaius Genucius and the Mamertine spokesman met.", [
      { kind: "character", id: "gaius-genucius" },
      { kind: "character", id: "mamertine-spokesman" },
    ]);
    const { port, shown } = recordingHistorian();
    await composeChronicle({
      port, clock: definition.clock, observer: { kind: "character", id: "gaius-genucius" }, observerPolityId: "rome",
      facts: [both], from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      orderFactIds: new Set([both.id]), ownEntityIds: new Set(["rome", "gaius-genucius"]),
      describePerson: whoIsWho(state, definition.government.offices),
    });
    expect(shown[0]).toContain("each a different person");
    expect(shown[0]).toContain("Gaius Genucius Clepsina, Roman consul, of Roman Republic");
    expect(shown[0]).toContain("Mamertine spokesman");
  });
});

describe("storms at sea", () => {
  it("can only happen where there is sea", () => {
    const coastal = coastalProvinceIds(world());
    expect(coastal.has("ita-72843720b81376294924159-sicily-west")).toBe(true);
    // A province of the Balkan interior, which the map calls a coastal plain.
    expect(coastal.has("punic-illyria-srb-41074048b91434818545320")).toBe(false);
  });
});

describe("a journey off the map", () => {
  it("is the world answering, not a malformed order", () => {
    const state = world();
    const result = applyDeltas(state, [WorldDeltaSchema.parse({
      op: "character_state_set", characterRef: "gaius-genucius", moveToProvinceId: "punic-egypt-nile-delta", reason: "To Egypt, for a wife.",
    })], {
      now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices,
      warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("far"), gameId: "game-far",
    });
    expect(result.rejected[0]!.kind).toBe("world");
    expect(result.rejected[0]!.reason).toContain("beyond the lands this world maps");
  });
});

describe("matters that name nobody", () => {
  it("stay apart unless they came from the order", async () => {
    // A live run wrote Arvernian roadworks and a temple theft at Ghadamis into
    // the same entry as a raid in Lucania, because every fact naming nobody
    // was folded into one matter.
    const roads = fact("The hill roads of the Arvernian Cones were finished.", []);
    const theft = fact("Temple silver was stolen at Ghadamis.", []);
    const { port } = recordingHistorian();
    const record = await composeChronicle({
      port, clock: definition.clock, observer: { kind: "character", id: "gaius-genucius" }, observerPolityId: "rome",
      facts: [roads, theft], from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      orderFactIds: new Set(),
    });
    expect(record.entries.every((entry) => entry.factIds.length === 1)).toBe(true);
  });
});
