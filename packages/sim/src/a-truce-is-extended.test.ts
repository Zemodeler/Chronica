import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

// A fresh seed for each context: one seed reused made two rows with one id (`ids.unique`).
let contexts = 0;

/**
 * A truce accepted over the one that runs is its extension. It was refused as "already stand in truce" while the letter that
 * asked for it was told as agreed, and the old truce lapsed on its day (a playtest as the Mamertine leader, twice).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

function as(written: readonly unknown[], state: WorldState) {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`truce-${state.elapsedStep}-${(contexts += 1)}`), gameId: "game-truce", orderDeltas: new Set(),
  };
  return applyDeltas(state, deltas, context);
}

const open = (localId: string, kind: string, forDays: number | null) => ({
  op: "agreement_open", localId, kind, polityId: "rome", otherPolityId: "syracuse", terms: `A ${kind}.`, forDays, sourceMessageRef: null, visibility: "public", reason: "Test.",
});

describe("a truce is extended", () => {
  it("goes on to the later date, as one agreement, when a second is accepted over it", () => {
    const start = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const atWar = as([open("war", "war", null)], start).world;
    const made = as([open("truce-1", "truce", 100)], atWar);
    expect(JSON.stringify(made.rejected ?? [])).toBe("[]");
    const truce = made.world;
    const first = truce.polityAgreements.filter((agreement) => agreement.kind === "truce" && agreement.status === "active");
    expect(first).toHaveLength(1);
    const later = { ...truce, elapsedStep: truce.elapsedStep + 80 };
    const extended = as([open("truce-2", "truce", 180)], later);
    expect(extended.rejected ?? []).toEqual([]);
    const active = extended.world.polityAgreements.filter((agreement) => agreement.kind === "truce" && agreement.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]!.untilStep).toBe(later.elapsedStep + 180);
    expect(active[0]!.untilStep!).toBeGreaterThan(first[0]!.untilStep!);
  });
});
