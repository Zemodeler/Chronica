import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../workflows/executor";
import { READ_TOOL_BY_NAME, type ReadToolContext } from "./read-tools";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

const context = (world: ReadToolContext["world"]): ReadToolContext => ({
  world,
  atStep: 0,
  actorCharacterId: "marcus-atilius",
  privateInformation: "omit",
});

describe("inspect_active_conflicts", () => {
  // docs/27: a siege should give its front province the same way a battle
  // already does, instead of forcing a second lookup from settlementId.
  it("includes the besieged settlement's province", () => {
    const started = executeWorkflow(
      { actionId: "start_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", invadingForceIds: ["legio-i"] } },
      world(),
      0,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const tool = READ_TOOL_BY_NAME.get("inspect_active_conflicts")!;
    const result = tool.read(context(started.world), {});
    expect(result.ok).toBe(true);
    const sieges = (result.data as { sieges: readonly { settlementId: string; provinceId: string | null }[] }).sieges;
    const siege = sieges.find((s) => s.settlementId === "messana-city");
    expect(siege?.provinceId).not.toBeNull();
    expect(siege?.provinceId).toBe(
      started.world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === "messana-city"))?.id,
    );
    expect(result.factual).toContain("messana-city at");
  });
});

describe("inspect_political_procedure", () => {
  // docs/29: a recorded position is a fact; an unaddressed participant gets
  // a labelled suggestion, never a position of their own.
  it("returns a recorded position and a suggested lean for an unaddressed participant", () => {
    const pledged = executeWorkflow(
      { actionId: "pledge_support", actorId: "marcus-atilius", parameters: { procedureId: "senate-censure-marcus", supporterKind: "character", supporterId: "marcus-atilius", position: "oppose", reasonKind: "belief", reasonLabel: "He does not believe he is at fault." } },
      world(),
      0,
    );
    expect(pledged.ok).toBe(true);
    if (!pledged.ok) return;

    const tool = READ_TOOL_BY_NAME.get("inspect_political_procedure")!;
    const result = tool.read(context(pledged.world), { procedureId: "senate-censure-marcus" });
    expect(result.ok).toBe(true);
    const data = result.data as {
      supportPositions: readonly { supporterId: string; position: string; reasons: readonly string[] }[];
      suggestions: readonly { characterId: string; suggestedLean: string }[];
    };
    expect(data.supportPositions).toHaveLength(1);
    expect(data.supportPositions[0]?.supporterId).toBe("marcus-atilius");
    expect(data.supportPositions[0]?.position).toBe("oppose");
    expect(data.supportPositions[0]?.reasons).toEqual(["He does not believe he is at fault."]);
    expect(data.suggestions.some((s) => s.characterId === "quintus-fabius")).toBe(true);
    expect(data.suggestions.find((s) => s.characterId === "quintus-fabius")?.suggestedLean).toBeDefined();
    expect(result.factual).toContain("context only, not a decision");
  });

  it("is not found for an unknown procedure", () => {
    const tool = READ_TOOL_BY_NAME.get("inspect_political_procedure")!;
    const result = tool.read(context(world()), { procedureId: "nowhere" });
    expect(result.ok).toBe(false);
  });
});
