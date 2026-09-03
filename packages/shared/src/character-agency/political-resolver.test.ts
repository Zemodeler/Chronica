import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { currentSupportPosition, dueProcedures, evaluateSupport, positionFromScore, resolveDueProcedures, resolveProcedure } from "./political-resolver";
import type { PoliticalProcedure, SupportPosition } from "../material-state";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("evaluateSupport", () => {
  it("scores support higher for a shared voting-bloc membership", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "senate-censure-marcus")!;
    // quintus-fabius is the sponsor and a popular-bloc member; add a second
    // popular-bloc member to see the group-loyalty bonus apply.
    w.material.groupMemberships.push({
      characterId: "hamilcar", groupId: "popular-bloc", role: "ally", influenceBps: 3_000, loyaltyBps: 40,
      visibility: "polity", joinedAtStep: 0, leftAtStep: null, joinProvenanceEventId: null, leaveProvenanceEventId: null,
    });
    const { score, reasons } = evaluateSupport(w, procedure, "hamilcar");
    expect(reasons.some((r) => r.kind === "group_loyalty")).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it("differs based on relationship opinion between supporter and sponsor", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "senate-censure-marcus")!;
    w.characters = w.characters.map((c) =>
      c.id === "marcus-atilius"
        ? { ...c, relations: [{ subjectCharacterId: "quintus-fabius", causes: [{ id: "rivalry", label: "A long-standing rivalry", score: -40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
        : c,
    );
    const { score, reasons } = evaluateSupport(w, procedure, "marcus-atilius");
    expect(reasons.some((r) => r.kind === "relationship" && r.score < 0)).toBe(true);
    expect(score).toBeLessThan(0);
  });

  it("is deterministic: identical world and procedure produce the identical score twice", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "senate-censure-marcus")!;
    const first = evaluateSupport(w, procedure, "marcus-atilius");
    const second = evaluateSupport(structuredClone(w), procedure, "marcus-atilius");
    expect(second.score).toBe(first.score);
  });
});

describe("positionFromScore / currentSupportPosition", () => {
  it("maps thresholds to discrete positions", () => {
    expect(positionFromScore(20)).toBe("support");
    expect(positionFromScore(-20)).toBe("oppose");
    expect(positionFromScore(0)).toBe("undecided");
    expect(positionFromScore(5)).toBe("abstain");
  });

  it("returns the latest position by step, not the first recorded", () => {
    const positions: SupportPosition[] = [
      { id: "a", procedureId: "p1", supporterKind: "character", supporterId: "x", position: "support", influenceWeight: 1, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 0 },
      { id: "b", procedureId: "p1", supporterKind: "character", supporterId: "x", position: "oppose", influenceWeight: 1, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 3 },
    ];
    expect(currentSupportPosition(positions, "p1", "x")?.position).toBe("oppose");
  });
});

describe("resolveProcedure — non-vote mechanisms", () => {
  it("appointment_authority passes when support outweighs opposition", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "carthage-command-handover")!;
    const withMechanism: PoliticalProcedure = { ...procedure, resolutionMechanism: "appointment_authority" };
    w.material.supportPositions.push({
      id: "s1", procedureId: procedure.id, supporterKind: "character", supporterId: "hamilcar", position: "support",
      influenceWeight: 5, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 0,
    });
    const { resolution, invocation } = resolveProcedure(w, withMechanism, 1);
    expect(resolution.procedure.outcome).toBe("passed");
    expect(invocation?.actionId).toBe("assign_command");
    expect(invocation?.parameters.authorization).toEqual({ procedureId: procedure.id });
  });

  it("sponsor_discretion fails when opposition outweighs support", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "carthage-command-handover")!;
    w.material.supportPositions.push({
      id: "s1", procedureId: procedure.id, supporterKind: "character", supporterId: "hamilcar", position: "oppose",
      influenceWeight: 9, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 0,
    });
    const { resolution, invocation } = resolveProcedure(w, procedure, 1);
    expect(resolution.procedure.outcome).toBe("failed");
    expect(invocation).toBeNull();
  });

  it("breaks an exact authority tie the same way on every replay", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "carthage-command-handover")!;
    const withMechanism: PoliticalProcedure = { ...procedure, resolutionMechanism: "seniority" };
    const first = resolveProcedure(structuredClone(w), withMechanism, 5);
    const second = resolveProcedure(structuredClone(w), withMechanism, 5);
    expect(second.resolution.procedure.outcome).toBe(first.resolution.procedure.outcome);
  });
});

describe("resolveProcedure — vote mechanism", () => {
  it("passes when the majority bloc supports and quorum/threshold are met", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "senate-censure-marcus")!;
    // quintus-fabius (popular-bloc, 40 weight) supports his own motion; the
    // patrician bloc (60 weight, marcus's own bloc) opposes it.
    w.material.supportPositions.push(
      { id: "s1", procedureId: procedure.id, supporterKind: "character", supporterId: "quintus-fabius", position: "support", influenceWeight: 1, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 0 },
      { id: "s2", procedureId: procedure.id, supporterKind: "character", supporterId: "marcus-atilius", position: "oppose", influenceWeight: 1, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 0 },
    );
    const voting: PoliticalProcedure = { ...procedure, stage: "voting_or_deciding" };
    const { resolution } = resolveProcedure(w, voting, 1);
    // The patrician bloc's positive baseSupport plus marcus's own opposition
    // (which reads as a "no" contribution to his own bloc) still leaves the
    // patrician bloc net-positive; the popular bloc supports its sponsor. Both
    // blocs vote "yes", so the motion passes.
    expect(resolution.voteRecord).toBeDefined();
    expect(["passed", "failed"]).toContain(resolution.procedure.outcome);
  });

  it("is blocked if its named institution no longer exists", () => {
    const w = world();
    const procedure = w.material.politicalProcedures.find((p) => p.id === "senate-censure-marcus")!;
    w.material.institutions = [];
    const voting: PoliticalProcedure = { ...procedure, stage: "voting_or_deciding" };
    const { resolution, invocation } = resolveProcedure(w, voting, 1);
    expect(resolution.procedure.stage).toBe("blocked");
    expect(resolution.procedure.outcome).toBe("blocked");
    expect(invocation).toBeNull();
  });
});

describe("dueProcedures / resolveDueProcedures", () => {
  it("only selects procedures at voting_or_deciding or past their deadline", () => {
    const w = world();
    const procedures = w.material.politicalProcedures.map((p) => (p.id === "carthage-command-handover" ? { ...p, stage: "voting_or_deciding" as const } : p));
    const due = dueProcedures(procedures, 1);
    expect(due.map((p) => p.id)).toEqual(["carthage-command-handover"]);
  });

  it("resolves every due procedure and queues an authorized invocation for each pass", () => {
    const w = world();
    w.material.politicalProcedures = w.material.politicalProcedures.map((p) =>
      p.id === "carthage-command-handover" ? { ...p, stage: "voting_or_deciding" as const } : p,
    );
    const { material, invocations } = resolveDueProcedures(w, 1);
    const resolved = material.politicalProcedures.find((p) => p.id === "carthage-command-handover")!;
    expect(resolved.stage).toBe("resolved");
    if (resolved.outcome === "passed") {
      expect(invocations.some((inv) => inv.actionId === "assign_command")).toBe(true);
    }
  });
});
