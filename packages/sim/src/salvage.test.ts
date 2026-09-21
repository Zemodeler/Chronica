import { describe, expect, it } from "vitest";
import { z } from "zod";
import { salvageAgainst } from "./salvage";

/** Close enough to the real contracts to fail the same way they do. */
const Delta = z.object({ op: z.enum(["move", "pay"]), kind: z.enum(["fact", "rumour"]).optional() }).strict();
const Fact = z.object({ summary: z.string(), affectedRefs: z.array(z.object({ kind: z.enum(["character", "polity"]) })).default([]) }).strict();
const Output = z.object({ deltas: z.array(Delta).default([]), facts: z.array(Fact).default([]) }).strict();

/** Parse, salvage what the schema named, parse again -- what both stages now do. */
function readWithSalvage(value: unknown) {
  const first = Output.safeParse(value);
  if (first.success) return { data: first.data, dropped: [] as readonly string[] };
  const rescued = salvageAgainst(value, first.error.issues);
  if (rescued === null) return null;
  const second = Output.safeParse(rescued.value);
  return second.success ? { data: second.data, dropped: rescued.dropped } : null;
}

describe("keeping the answer and losing the bad line", () => {
  it("drops the one delta the schema named and keeps the rest", () => {
    // Observed on a live burst: `deltas.15.kind: Invalid option`, and fifteen
    // good deltas discarded with it at the cost of a second full-price call.
    const answer = {
      deltas: [{ op: "move" }, { op: "pay", kind: "gossip" }, { op: "pay" }],
      facts: [],
    };
    const read = readWithSalvage(answer)!;
    expect(read.data.deltas).toEqual([{ op: "move" }, { op: "pay" }]);
    expect(read.dropped).toEqual(["deltas.1"]);
  });

  it("costs a bad reference its fact's reference, not the fact", () => {
    // The innermost list is the one that gives way. A fact naming one entity
    // the schema does not recognise is still a fact that happened.
    const answer = {
      deltas: [],
      facts: [{ summary: "The fleet sailed.", affectedRefs: [{ kind: "character" }, { kind: "weather" }] }],
    };
    const read = readWithSalvage(answer)!;
    expect(read.data.facts).toEqual([{ summary: "The fleet sailed.", affectedRefs: [{ kind: "character" }] }]);
    expect(read.dropped).toEqual(["facts.0.affectedRefs.1"]);
  });

  it("strips an unrecognised key rather than dropping what it was attached to", () => {
    // A key outside the contract is one nothing downstream could have read, so
    // deleting it loses nothing; dropping the delta would lose the act.
    const answer = { deltas: [{ op: "move", note: "he hurried" }], facts: [] };
    const read = readWithSalvage(answer)!;
    expect(read.data.deltas).toEqual([{ op: "move" }]);
    expect(read.dropped).toEqual(["deltas.0: note"]);
  });

  it("removes several bad entries at once without shifting the good ones", () => {
    const answer = {
      deltas: [{ op: "move" }, { op: "nope" }, { op: "pay" }, { op: "also-nope" }, { op: "move" }],
      facts: [],
    };
    const read = readWithSalvage(answer)!;
    expect(read.data.deltas).toEqual([{ op: "move" }, { op: "pay" }, { op: "move" }]);
  });

  it("refuses when the fault is not inside any list", () => {
    // Nothing here can be given up short of the whole answer, which is the
    // model repair's job and not this one's.
    const rescued = salvageAgainst({ deltas: "not a list" }, Output.safeParse({ deltas: "not a list" }).error!.issues);
    expect(rescued).toBeNull();
  });

  it("refuses an answer that is wrong all through", () => {
    // Past a dozen complaints this is not a good answer with a bad line in it,
    // and handing back a shredded version of what the model said is worse than
    // asking it again.
    const many = Array.from({ length: 20 }, () => ({ op: "nope" }));
    const parsed = Output.safeParse({ deltas: many });
    expect(salvageAgainst({ deltas: many }, parsed.error!.issues)).toBeNull();
  });

  it("never changes the answer it was given", () => {
    const answer = { deltas: [{ op: "move" }, { op: "nope" }], facts: [] };
    const before = structuredClone(answer);
    readWithSalvage(answer);
    expect(answer).toEqual(before);
  });
});
