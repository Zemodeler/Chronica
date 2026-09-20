import { describe, expect, it } from "vitest";
import { trimToCaps } from "./orchestrate";

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
