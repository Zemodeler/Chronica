import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("grant_holding", () => {
  it("grants a character a holding tied to an existing income source", () => {
    const w = world();
    const withIncome = executeWorkflow(
      { actionId: "create_income_source", actorId: "test-actor", parameters: { incomeSourceId: "latium-estate-income", label: "Latium estate", kind: "land", beneficiaryAccountId: "marcus-purse", originKind: "holding", originId: "latium-estate", amount: 50, cadenceSteps: 4 } },
      w,
      0,
    );
    expect(withIncome.ok).toBe(true);
    if (!withIncome.ok) return;

    const outcome = executeWorkflow(
      { actionId: "grant_holding", actorId: "test-actor", parameters: { holdingId: "latium-estate", title: "Estate of Latium", territoryId: "ita-72843720b863019116732", legalHolderCharacterId: "marcus-atilius", incomeSourceId: "latium-estate-income", successionRuleId: "roman-appointment" } },
      withIncome.world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.holdings.find((h) => h.id === "latium-estate")?.legalHolderCharacterId).toBe("marcus-atilius");
  });

  it("is not applicable to an unknown income source", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "grant_holding", actorId: "test-actor", parameters: { holdingId: "latium-estate", title: "Estate of Latium", territoryId: "ita-72843720b863019116732", legalHolderCharacterId: "marcus-atilius", incomeSourceId: "nowhere", successionRuleId: "roman-appointment" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});
