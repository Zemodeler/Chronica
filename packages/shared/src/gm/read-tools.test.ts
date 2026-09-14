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

describe("inspect_account (world matters, Phase 4)", () => {
  it("shows full balance and obligation detail to the account's own owner", () => {
    const tool = READ_TOOL_BY_NAME.get("inspect_account")!;
    const result = tool.read(context(world()), { accountId: "marcus-purse" });
    expect(result.ok).toBe(true);
    const data = result.data as { balance: number; availableBalance: number; obligations: readonly { id: string }[] };
    expect(data.balance).toBe(1_200);
    expect(data.obligations.some((o) => o.id === "legio-pay")).toBe(true);
  });

  it("withholds balance from a character with no recorded access", () => {
    const tool = READ_TOOL_BY_NAME.get("inspect_account")!;
    const result = tool.read({ ...context(world()), actorCharacterId: "hanno" }, { accountId: "marcus-purse" });
    expect(result.ok).toBe(true);
    expect(result.data).not.toHaveProperty("balance");
    expect(result.factual).toContain("no recorded access");
  });

  it("reports the account as not found when no such account exists", () => {
    const tool = READ_TOOL_BY_NAME.get("inspect_account")!;
    const result = tool.read(context(world()), { accountId: "nowhere" });
    expect(result.ok).toBe(false);
  });
});

describe("inspect_income_source (world matters, Phase 4)", () => {
  it("reports terms and recent receipts", () => {
    const w = world();
    w.material.incomeSources = [{
      id: "sicily-tax", kind: "tax", label: "Sicilian taxation", beneficiaryAccountId: "marcus-purse",
      originKind: "polity", originId: "rome", amount: 100, cadenceSteps: 8, nextDueStep: 8, collectionRateBps: 10_000, active: true,
    }];
    const tool = READ_TOOL_BY_NAME.get("inspect_income_source")!;
    const result = tool.read(context(w), { incomeSourceId: "sicily-tax" });
    expect(result.ok).toBe(true);
    expect(result.factual).toContain("Sicilian taxation");
    expect(result.factual).toContain("100/period");
  });
});

describe("list_due_obligations (world matters, Phase 4)", () => {
  it("lists legio-pay as due at step 1", () => {
    const tool = READ_TOOL_BY_NAME.get("list_due_obligations")!;
    const result = tool.read({ ...context(world()), atStep: 1 }, {});
    expect(result.ok).toBe(true);
    const data = result.data as { dueObligations: readonly { obligationId: string }[] };
    expect(data.dueObligations.some((o) => o.obligationId === "legio-pay")).toBe(true);
  });
});

describe("list_pending_diplomatic_messages (world matters, Phase 7)", () => {
  it("lists a message awaiting reply", () => {
    const outcome = executeWorkflow(
      { actionId: "send_diplomatic_message", actorId: "hanno", parameters: { messageId: "msg-1", kind: "peace_offer", fromPolityId: "carthage", fromCharacterId: "hanno", toPolityId: "rome", toCharacterId: "marcus-atilius", subject: "A negotiated peace", terms: "Withdraw from Sicily.", replyDueByStep: 10 } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const tool = READ_TOOL_BY_NAME.get("list_pending_diplomatic_messages")!;
    const result = tool.read(context(outcome.world), {});
    expect(result.ok).toBe(true);
    const data = result.data as { pendingMessages: readonly { messageId: string }[] };
    expect(data.pendingMessages.some((m) => m.messageId === "msg-1")).toBe(true);
    expect(result.factual).toContain("A negotiated peace");
  });

  it("does not list an already-answered message", () => {
    const sent = executeWorkflow(
      { actionId: "send_diplomatic_message", actorId: "hanno", parameters: { messageId: "msg-1", kind: "peace_offer", fromPolityId: "carthage", fromCharacterId: "hanno", toPolityId: "rome", toCharacterId: "marcus-atilius", subject: "A negotiated peace", terms: "Withdraw from Sicily." } },
      world(),
      1,
    );
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const answered = executeWorkflow(
      { actionId: "answer_diplomatic_message", actorId: "marcus-atilius", parameters: { messageId: "msg-1", answer: "accepted", answeredByCharacterId: "marcus-atilius", answerText: "Rome accepts." } },
      sent.world,
      2,
    );
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const tool = READ_TOOL_BY_NAME.get("list_pending_diplomatic_messages")!;
    const result = tool.read(context(answered.world), {});
    const data = result.data as { pendingMessages: readonly { messageId: string }[] };
    expect(data.pendingMessages).toHaveLength(0);
  });
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
      { actionId: "set_support_position", actorId: "marcus-atilius", parameters: { procedureId: "senate-censure-marcus", supporterKind: "character", supporterId: "marcus-atilius", position: "oppose", reasonKind: "belief", reasonLabel: "He does not believe he is at fault." } },
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
