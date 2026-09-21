import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { AiTimeoutError, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { orchestrate, trimToCaps } from "./orchestrate";
import type { SimModelPort } from "./ports";
import { buildWorldSlice } from "./slice";

describe("an answer that went past a ceiling", () => {
  it("drops the tail rather than the whole answer", () => {
    // From a live game: twenty-five deltas against a cap of twenty-four, so
    // the schema rejected all twenty-five, the repair retry produced another
    // long answer, and the burst committed having done nothing at all.
    // Twenty-four good acts thrown away over the twenty-fifth is the worst
    // trade in the pipeline.
    const long = { deltas: Array.from({ length: 30 }, (_, index) => ({ op: "belief_set", n: index })) };
    const trimmed = trimToCaps(long) as { deltas: { n: number }[] };
    expect(trimmed.deltas).toHaveLength(24);
    // The model puts the important things first, so the tail is what goes.
    expect(trimmed.deltas[0]!.n).toBe(0);
  });

  it("holds every list to its own ceiling, and leaves a short one alone", () => {
    const output = {
      deltas: [{ op: "belief_set" }],
      facts: Array.from({ length: 20 }, () => ({})),
      delegations: Array.from({ length: 12 }, () => ({})),
      schedule: [],
      narrativeSummary: "Untouched.",
    };
    const trimmed = trimToCaps(output) as Record<string, unknown[]> & { narrativeSummary: string };
    expect(trimmed.deltas).toHaveLength(1);
    expect(trimmed.facts).toHaveLength(16);
    expect(trimmed.delegations).toHaveLength(8);
    expect(trimmed.narrativeSummary).toBe("Untouched.");
  });

  it("passes anything that is not an object straight through", () => {
    expect(trimToCaps(null)).toBeNull();
    expect(trimToCaps("not json")).toBe("not json");
    expect(trimToCaps([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("a call that ran out of time", () => {
  const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
  const world: WorldState = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const slice = buildWorldSlice({
    world,
    clock: definition.clock,
    offices: definition.government.offices,
    actorRef: { kind: "character", id: world.characters[0]!.id },
    actorPolityId: "rome",
    orderText: "Raise two legions.",
    facts: [],
    dueEvents: [],
    pendingEvents: [],
  });

  it("does not spend the repair on a prompt that was never wrong", async () => {
    // The repair exists to answer a complaint about the shape of an answer,
    // and it re-sends the whole slice to do it. A deadline is not a complaint:
    // the prompt was fine, so the second call waits exactly as long and ends
    // exactly the same way, having doubled what the player waits for nothing.
    let calls = 0;
    const port: SimModelPort = {
      complete() {
        calls += 1;
        return Promise.reject(new AiTimeoutError("simulate_orchestrate", 30_000));
      },
    };

    const result = await orchestrate(port, slice);

    expect(calls).toBe(1);
    expect(result.calls).toBe(1);
    expect(result.parseFailure).toContain("30s");
    // The burst still continues, and the player is told the machinery of state
    // produced nothing -- which is true, and better than a stack trace.
    expect(result.output.deltas).toEqual([]);
  });

  it("still repairs an answer the schema actually refused", async () => {
    let calls = 0;
    const port: SimModelPort = {
      complete() {
        calls += 1;
        return Promise.resolve(JSON.stringify({ intent: "not an object" }));
      },
    };

    await orchestrate(port, slice);

    expect(calls).toBe(2);
  });
});

describe("an answer with one bad line in it", () => {
  const definition2 = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
  const world2: WorldState = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const slice2 = buildWorldSlice({
    world: world2,
    clock: definition2.clock,
    offices: definition2.government.offices,
    actorRef: { kind: "character", id: world2.characters[0]!.id },
    actorPolityId: "rome",
    orderText: "Pay the garrison.",
    facts: [],
    dueEvents: [],
    pendingEvents: [],
  });

  it("keeps the other deltas without spending a repair call", async () => {
    // From a live burst: `deltas.N.kind: Invalid option`, which threw away the
    // whole proposal and bought a second full-price call to be told most of
    // the same thing again.
    let calls = 0;
    const port: SimModelPort = {
      complete() {
        calls += 1;
        return Promise.resolve(JSON.stringify({
          intent: { summary: "Pay them.", domains: [] },
          narrativeSummary: "The garrison was paid.",
          frictions: [],
          deltas: [
            { op: "legitimacy_shift", target: "polity", targetId: "rome", legitimacyBpsDelta: -100, causeLabel: "The garrison's arrears", reason: "The money had to come from somewhere." },
            // "hearsay" is not one of the kinds a belief may have. One word,
            // and the whole proposal used to go with it.
            { op: "belief_set", kind: "hearsay", characterRef: "marcus", claim: "The grain is short.", confidence: 50, reason: "He was told so." },
          ],
          facts: [],
          delegations: [],
          schedule: [],
          cognitionCandidates: [],
          outcome: "continue",
          playerDecision: null,
        }));
      },
    };

    const result = await orchestrate(port, slice2);

    expect(calls).toBe(1);
    expect(result.parseFailure).toBeNull();
    expect(result.output.deltas).toHaveLength(1);
    expect(result.output.deltas[0]!.op).toBe("legitimacy_shift");
    // And it says what it threw away, so a field that keeps appearing here can
    // be traced back to the prompt or the schema.
    expect(result.salvaged).toEqual(["deltas.1"]);
  });
});
