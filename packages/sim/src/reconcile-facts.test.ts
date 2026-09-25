import { describe, expect, it } from "vitest";
import { factsNamingRefusals } from "./reconcile-facts";

const fact = (summary: string, ids: string[], storylineRef: string | null = null) => ({ localId: summary.slice(0, 8), summary, affectedRefs: ids.map((id) => ({ kind: "character", id })), storylineRef });

describe("which facts are worth asking about when an act was refused", () => {
  const refused = [{ delta: { op: "force_create", localId: "legion", name: "Legio Nova", polityId: "rome", commanderCharacterRef: "local:tribune", units: [{ categoryId: "infantry" }] } }];

  it("keeps a fact that names something the refused act names, by handle or by local handle", () => {
    expect(factsNamingRefusals([fact("The tribune takes command.", ["tribune"])], refused)).toHaveLength(1);
    expect(factsNamingRefusals([fact("Rome stirs.", ["rome"])], refused)).toHaveLength(1);
  });

  it("keeps a fact whose summary repeats a name the refused act carries", () => {
    expect(factsNamingRefusals([fact("Legio Nova musters at Capua.", ["nobody"])], refused)).toHaveLength(1);
  });

  it("keeps a fact that belongs to a thread the refused act opened", () => {
    expect(factsNamingRefusals([fact("A quarrel begins.", [], "local:feud")], [{ delta: { op: "storyline_open", localId: "feud", title: "The feud" } }])).toHaveLength(1);
  });

  it("lets a fact that names nothing of it stand without a call", () => {
    expect(factsNamingRefusals([fact("Hieron dines with his court.", ["hieron"])], refused)).toHaveLength(0);
  });

  it("counts what the caller says stands beside the act: an account's owner, the ruler's own power", () => {
    const spend = [{ delta: { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 5 } }];
    expect(factsNamingRefusals([fact("A sum left the consul's chest.", ["rome"])], spend)).toHaveLength(0);
    expect(factsNamingRefusals([fact("A sum left the consul's chest.", ["rome"])], spend, ["rome"])).toHaveLength(1);
  });
});
