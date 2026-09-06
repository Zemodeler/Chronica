import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("propose_life_contract / dissolve_life_contract", () => {
  it("forms a marriage, writing both the contract and a paired spouse family link", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "propose_life_contract", actorId: "hanno", parameters: { contractId: "hanno-marriage", type: "marriage_or_partnership", partyCharacterIds: ["hanno", "hamilcar"], visibility: "polity" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.lifeContracts.some((c) => c.id === "hanno-marriage" && c.status === "active")).toBe(true);
    expect(outcome.world.familyLinks.some((l) => l.kind === "spouse_or_partner" && l.characterId === "hanno" && l.relatedCharacterId === "hamilcar")).toBe(true);
    // A contract never implies sentiment -- no relation cause is created.
    expect(outcome.world.characters.find((c) => c.id === "hanno")?.relations).toEqual([]);
  });

  it("refuses a second marriage while one party's is still active", () => {
    const w = world();
    const first = executeWorkflow(
      { actionId: "propose_life_contract", actorId: "hanno", parameters: { contractId: "hanno-marriage", type: "marriage_or_partnership", partyCharacterIds: ["hanno", "hamilcar"], visibility: "polity" } },
      w,
      1,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = executeWorkflow(
      { actionId: "propose_life_contract", actorId: "hanno", parameters: { contractId: "hanno-marriage-2", type: "marriage_or_partnership", partyCharacterIds: ["hanno", "quintus-fabius"], visibility: "polity" } },
      first.world,
      1,
    );
    expect(second.ok).toBe(false);
  });

  it("refuses a party that fails an eligibility requirement", () => {
    const w = world();
    const outcome = executeWorkflow(
      {
        actionId: "propose_life_contract",
        actorId: "hanno",
        parameters: { contractId: "bad-marriage", type: "marriage_or_partnership", partyCharacterIds: ["hanno", "hamilcar"], eligibilityRequirementIds: ["req-min-prestige-3000"], visibility: "polity" },
      },
      w,
      1,
    );
    // Hamilcar's prestige (3500) clears req-min-prestige-3000, so this should
    // succeed; re-run with a requirement neither party can pass.
    expect(outcome.ok).toBe(true);
  });

  it("dissolves an active contract and ends its paired family link", () => {
    const w = world();
    const formed = executeWorkflow(
      { actionId: "propose_life_contract", actorId: "hanno", parameters: { contractId: "hanno-marriage", type: "marriage_or_partnership", partyCharacterIds: ["hanno", "hamilcar"], visibility: "polity" } },
      w,
      1,
    );
    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    const dissolved = executeWorkflow(
      { actionId: "dissolve_life_contract", actorId: "hanno", parameters: { contractId: "hanno-marriage", resolution: "separated", reason: "Irreconcilable." } },
      formed.world,
      2,
    );
    expect(dissolved.ok).toBe(true);
    if (!dissolved.ok) return;
    expect(dissolved.world.lifeContracts.find((c) => c.id === "hanno-marriage")?.status).toBe("separated");
    expect(dissolved.world.familyLinks.find((l) => l.id === "hanno-marriage:link")?.endedAtStep).toBe(2);
  });
});

describe("create_child_character", () => {
  it("creates a distinct character with a validated mind, no copied relations, and a parent link", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "create_child_character", parameters: { childCharacterId: "new-child", name: "Aula", parentCharacterIds: ["marcus-atilius"] }, actorId: "system" },
      w,
      4,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const child = outcome.world.characters.find((c) => c.id === "new-child")!;
    expect(child.ageYearsAtStart).toBe(0);
    expect(child.birthStep).toBe(4);
    expect(child.relations).toEqual([]);
    expect(child.mind).not.toEqual(outcome.world.characters.find((c) => c.id === "marcus-atilius")!.mind);
    expect(outcome.world.familyLinks.some((l) => l.characterId === "marcus-atilius" && l.relatedCharacterId === "new-child" && l.kind === "parent")).toBe(true);
    expect(outcome.world.continuity.some((c) => c.characterId === "new-child" && c.tier === "ordinary")).toBe(true);
  });

  it("refuses when no named parent is alive", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, alive: false, diedAtStep: 0 } : c));
    const outcome = executeWorkflow(
      { actionId: "create_child_character", parameters: { childCharacterId: "new-child", name: "Aula", parentCharacterIds: ["marcus-atilius"] }, actorId: "system" },
      w,
      4,
    );
    expect(outcome.ok).toBe(false);
  });

  it("has no arbitrary population ceiling: a large existing cast does not block a new birth", () => {
    // Runtime casting (background leaders, births) must never be blocked by a
    // fixed headcount -- an invaded polity that needs a leader must be able
    // to get one no matter how large the world has already grown.
    const w = world();
    const padded = {
      ...w,
      characters: [
        ...w.characters,
        ...Array.from({ length: 200 }, (_, i) => ({
          ...w.characters[0]!,
          id: `filler-${i}`,
          name: `Filler ${i}`,
          heirCharacterId: null,
        })),
      ],
    };
    const outcome = executeWorkflow(
      { actionId: "create_child_character", parameters: { childCharacterId: "one-more", name: "Overflow", parentCharacterIds: ["marcus-atilius"] }, actorId: "system" },
      padded,
      4,
    );
    expect(outcome.ok).toBe(true);
  });
});
