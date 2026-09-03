import { describe, expect, it } from "vitest";
import { resolveCausalRefs, type CausalChainEntry } from "./causal-chain";

const chain: CausalChainEntry[] = [
  { sequence: 0, title: "Public insult", chainId: "chain-1" },
  { sequence: 1, title: "Political opposition", chainId: "chain-1" },
  { sequence: 2, title: "Failed appointment", chainId: "chain-1" },
  { sequence: 3, title: "Unrelated event", chainId: "chain-2" },
];

describe("resolveCausalRefs", () => {
  it("returns no refs for an entry with no chain", () => {
    expect(resolveCausalRefs({ sequence: 5, title: "Solo event" }, chain)).toEqual({ consequences: [] });
  });

  it("finds the immediately-earlier entry in the same chain", () => {
    const refs = resolveCausalRefs(chain[1]!, chain);
    expect(refs.earlier).toEqual({ sequence: 0, title: "Public insult" });
  });

  it("omits earlier for the first entry in a chain", () => {
    const refs = resolveCausalRefs(chain[0]!, chain);
    expect(refs.earlier).toBeUndefined();
  });

  it("lists later entries in the same chain as consequences, bounded by maxChainDepth", () => {
    const refs = resolveCausalRefs(chain[0]!, chain, 1);
    expect(refs.consequences).toEqual([{ sequence: 1, title: "Political opposition" }]);
  });

  it("never crosses into a different chain", () => {
    const refs = resolveCausalRefs(chain[2]!, chain, 5);
    expect(refs.consequences).toEqual([]);
  });
});
