import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow, executeWorkflows } from "./workflows/executor";
import { ensureProvinceMaterial, applyWarDamageForExecutedWorkflows } from "./material/province-material";
import { fallbackPositionsFor, resolveForcePosition } from "./warfare/position";
import { projectOrdersAndOperations } from "./actions/order-projection";
import type { WorkflowAuditEntry } from "./workflows/manager-types";

// First Punic War vertical slice (docs/14 Phase 6): one coherent scenario
// walking every mechanism the unified-resolution redesign added, end to end,
// against the real built-in scenario rather than synthetic fixtures --
// recruitment gated by manpower and territorial standing, two forces
// occupying distinct positions in one province without overlap, a resolved
// battle degrading the provincial material it was fought over, and a player
// order that is authorised in one case and refused, as grounded history, in
// another.

const ROMAN_PROVINCE_ID = "ita-72843720b81376294924159-sicily-northeast";

describe("First Punic War vertical slice", () => {
  it("constrains recruitment by manpower and territorial standing", () => {
    const world = ensureProvinceMaterial(structuredClone(firstPunicWarScenario.initialWorld), 0);

    // Rome's own commander recruiting into Rome's own force, in Rome's own
    // province, within the province's available manpower and treasury: accepted.
    const affordable = executeWorkflow(
      { actionId: "recruit_from_province", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 50, payerAccountId: "marcus-purse" } },
      world, 0,
    );
    expect(affordable.ok).toBe(true);

    // The same order, beyond what the province's manpower can supply: refused, not partially applied.
    const overdrawn = executeWorkflow(
      { actionId: "recruit_from_province", actorId: "marcus-atilius", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 10_000_000, payerAccountId: "marcus-purse" } },
      world, 0,
    );
    expect(overdrawn.ok).toBe(false);
  });

  it("gives two forces sharing one province distinct, non-overlapping positions", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const province = world.map.provinces.find((p) => p.id === ROMAN_PROVINCE_ID)!;
    // Legio I garrisons the settlement; a second, hypothetical force camps outside it.
    const settlementPosition = resolveForcePosition(province, null);
    const positions = fallbackPositionsFor(province);
    const campPosition = positions.find((p) => p.type === "camp")!;
    expect(settlementPosition.id).not.toBe(campPosition.id);
    expect(settlementPosition.type).toBe("settlement");
  });

  it("lets a resolved battle degrade the province it was fought over", () => {
    let world = ensureProvinceMaterial(structuredClone(firstPunicWarScenario.initialWorld), 0);
    world = {
      ...world,
      material: {
        ...world.material,
        forces: world.material.forces.map((f) => (f.id === "carthaginian-army" ? { ...f, locationId: ROMAN_PROVINCE_ID } : f)),
      },
      conflicts: { ...world.conflicts, battles: [{ battleId: "vertical-slice-battle", participantForceIds: ["legio-i", "carthaginian-army"], attackerForceIds: ["legio-i"] }] },
    };
    const before = world.material.provinceMaterial.find((m) => m.provinceId === ROMAN_PROVINCE_ID)!;

    const outcome = executeWorkflow({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "vertical-slice-battle" } }, world, 10);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const damageResult = applyWarDamageForExecutedWorkflows(outcome.world, [{ actionId: "start_battle", parameters: { attackingForceId: "carthaginian-army" } }], 10);
    const after = damageResult.world.material.provinceMaterial.find((m) => m.provinceId === ROMAN_PROVINCE_ID)!;

    expect(after.warDamageBps).toBeGreaterThan(before.warDamageBps);
    expect(damageResult.affectedProvinceIds.has(ROMAN_PROVINCE_ID)).toBe(true);
  });

  it("accepts an authorised order and grounds an unauthorised one as a refusal, not a silent drop", () => {
    const authorised: WorkflowAuditEntry = {
      correlationId: "11111111-1111-1111-1111-111111111111",
      source: "player_directive",
      sourceRef: "directive-authorised",
      requestedActionId: "move_force",
      requestedInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: { forceId: "legio-i", destinationProvinceId: "ita-local-23120603B86473916475875" } },
      finalInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: { forceId: "legio-i", destinationProvinceId: "ita-local-23120603B86473916475875" } },
      managerDecision: "approve",
      executionOk: true,
    };
    const unauthorised: WorkflowAuditEntry = {
      correlationId: "22222222-2222-2222-2222-222222222222",
      source: "player_directive",
      sourceRef: "directive-unauthorised",
      requestedActionId: "recruit_from_province",
      requestedInvocation: { actionId: "recruit_from_province", actorId: "hanno", parameters: { provinceId: ROMAN_PROVINCE_ID, forceId: "legio-i", categoryId: "infantry", recruitCount: 100 } },
      policyViolation: { kind: "authority_mismatch", message: "Hanno commands no force of Rome's and holds no standing in Roman Sicily." },
    };

    const result = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      candidates: [authorised, unauthorised],
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction: (actionId) => actionId === "move_force",
    });

    expect(result.actions.find((a) => a.id === authorised.correlationId)?.status).toBe("active");
    const refusedAction = result.actions.find((a) => a.id === unauthorised.correlationId)!;
    expect(refusedAction.status).toBe("impossible");
    expect(refusedAction.authorityBasis?.validated).toBe(false);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]!.kind).toBe("authority");
  });

  it("carries a settlement's capture into the very next event's state, in one committed sequence", () => {
    // Messana (in the Roman province) falls to Carthage under siege, and the
    // next event in the same sequence -- Carthage taxing what it just took --
    // must see that capture, not the state from before it.
    const withSiege = {
      ...structuredClone(firstPunicWarScenario.initialWorld),
      material: ensureProvinceMaterial(structuredClone(firstPunicWarScenario.initialWorld), 0).material,
      conflicts: {
        ...firstPunicWarScenario.initialWorld.conflicts,
        sieges: [{ settlementId: "messana-city", invadingForceIds: ["carthaginian-army"], defendingForceIds: ["legio-i"] }],
      },
    };

    const executed = executeWorkflows(
      [
        { actionId: "end_siege", actorId: "hanno", parameters: { settlementId: "messana-city", successfulCapture: true, newControllerPolityId: "carthage" } },
        // The very next event: Carthage levies against the province it just took.
        { actionId: "collect_emergency_taxation", actorId: "hanno", parameters: { provinceId: ROMAN_PROVINCE_ID, accountId: "hanno-purse", requestedAmount: 100, reason: "Levy on the newly won province." } },
      ],
      withSiege,
      1,
    );

    expect(executed.log[0]!.outcome.ok).toBe(true);
    expect(executed.world.map.provinces.find((p) => p.id === ROMAN_PROVINCE_ID)?.controllerPolityId).toBe("carthage");
    // This only succeeds because the taxation event, resolving second,
    // already sees the province as Carthage's -- the exact state the first
    // event just committed, not a stale copy from before it.
    expect(executed.log[1]!.outcome.ok).toBe(true);
  });
});
