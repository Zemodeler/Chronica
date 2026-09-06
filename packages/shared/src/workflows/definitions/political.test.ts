import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import { validateCandidate } from "../policy";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("give_territory", () => {
  // Regression: territory used to change hands with zero linkage to any
  // agreement at all -- give_territory is now the diplomatic-cession path
  // (valid resolution path #3), and it is refused without a real, accepted
  // message between exactly the two powers involved.

  function sentMessage(w: ReturnType<typeof world>, overrides: { fromPolityId: string; fromCharacterId: string; toPolityId: string }) {
    return executeWorkflow(
      {
        actionId: "send_diplomatic_message",
        actorId: overrides.fromCharacterId,
        parameters: {
          messageId: "msg-cession-1",
          kind: "letter",
          fromPolityId: overrides.fromPolityId,
          fromCharacterId: overrides.fromCharacterId,
          toPolityId: overrides.toPolityId,
          subject: "Cession of western Sicily",
          terms: "Carthage cedes western Sicily to Rome in exchange for peace.",
        },
      },
      w,
      0,
    );
  }

  it("refuses when no message with the given id exists", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "give_territory", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-west", newControllerPolityId: "rome", authorizingMessageId: "nope" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('No diplomatic message with the id "nope"');
  });

  it("refuses when the referenced message was never accepted", () => {
    const sent = sentMessage(world(), { fromPolityId: "carthage", fromCharacterId: "hanno", toPolityId: "rome" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const outcome = executeWorkflow(
      { actionId: "give_territory", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-west", newControllerPolityId: "rome", authorizingMessageId: "msg-cession-1" } },
      sent.world,
      0,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("not accepted");
  });

  it("refuses when the accepted message was between different powers than the cession names", () => {
    const sent = sentMessage(world(), { fromPolityId: "carthage", fromCharacterId: "hanno", toPolityId: "rome" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const answered = executeWorkflow(
      { actionId: "answer_diplomatic_message", actorId: "marcus-atilius", parameters: { messageId: "msg-cession-1", answer: "accepted", answeredByCharacterId: "marcus-atilius", answerText: "Rome accepts." } },
      sent.world,
      0,
    );
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    // A real, accepted message -- but for a different province than named here, and the workflow can only check the polities, so instead assert the party mismatch path directly: cede a province currently held by neither party to the message.
    const outcome = executeWorkflow(
      { actionId: "give_territory", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-southeast", newControllerPolityId: "rome", authorizingMessageId: "msg-cession-1" } },
      answered.world,
      0,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("cannot authorize ceding");
  });

  it("succeeds when the message was accepted between exactly the old controller and the new one", () => {
    const sent = sentMessage(world(), { fromPolityId: "carthage", fromCharacterId: "hanno", toPolityId: "rome" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const answered = executeWorkflow(
      { actionId: "answer_diplomatic_message", actorId: "marcus-atilius", parameters: { messageId: "msg-cession-1", answer: "accepted", answeredByCharacterId: "marcus-atilius", answerText: "Rome accepts." } },
      sent.world,
      0,
    );
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const outcome = executeWorkflow(
      { actionId: "give_territory", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-west", newControllerPolityId: "rome", authorizingMessageId: "msg-cession-1" } },
      answered.world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-west")?.controllerPolityId).toBe("rome");
  });
});

describe("start_war", () => {
  // docs/27: a refusal must identify the existing conflict, not degrade to a
  // generic "cannot be applied" message.
  it("names both polities when they are already at war", () => {
    // The First Punic War scenario opens with Rome and Carthage already at
    // war, so this exercises the conflict path directly without staging one.
    const w = world();
    expect(w.conflicts.wars).toEqual([{ polityAId: "carthage", polityBId: "rome" }]);
    const outcome = executeWorkflow({ actionId: "start_war", actorId: "test-actor", parameters: { polityAId: "carthage", polityBId: "rome" } }, w, 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("already at war");
    expect(outcome.message).toContain("Carthage");
    expect(outcome.message).toContain("Roman Republic");
  });

  it("names the missing polity id, classified as a recoverable lookup failure", () => {
    const w = world();
    const outcome = executeWorkflow({ actionId: "start_war", actorId: "test-actor", parameters: { polityAId: "atlantis", polityBId: "rome" } }, w, 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('with the id "atlantis"');
  });

  // docs/28: a replay fixture -- the same command against the same snapshot
  // must yield byte-identical resulting state, run twice independently.
  it("produces byte-identical resulting state given the same snapshot and parameters", () => {
    const invocation = { actionId: "start_war" as const, actorId: "test-actor", parameters: { polityAId: "rome", polityBId: "syracuse" } };
    const outcomeA = executeWorkflow(invocation, world(), 0);
    const outcomeB = executeWorkflow(invocation, world(), 0);
    expect(outcomeA).toEqual(outcomeB);
  });
});

describe("end_war", () => {
  it("still executes directly (the shape a resolved political procedure's authorized invocation uses)", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "end_war", actorId: "system", parameters: { polityAId: "rome", polityBId: "carthage", termsLabel: "A negotiated peace." } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.conflicts.wars).toEqual([]);
  });

  it("cannot be proposed directly by a player order or the world director -- peace requires a procedure (docs/14 Phase 6)", () => {
    const w = world();
    const invocation = { actionId: "end_war", actorId: "marcus-atilius", parameters: { polityAId: "rome", polityBId: "carthage", termsLabel: "I hereby declare peace." } };
    const asPlayer = validateCandidate({ correlationId: "11111111-1111-1111-1111-111111111111", source: "player_directive", sourceRef: "d", sourceRationale: "", requestedInvocation: invocation }, w);
    const asWorldDirector = validateCandidate({ correlationId: "22222222-2222-2222-2222-222222222222", source: "world_director_synthesis", sourceRef: "d", sourceRationale: "", requestedInvocation: invocation }, w);
    expect(asPlayer?.kind).toBe("authority_mismatch");
    expect(asWorldDirector?.kind).toBe("authority_mismatch");
  });
});

describe("rename_polity", () => {
  it("renames a polity", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "rename_polity", actorId: "test-actor", parameters: { polityId: "carthage", newName: "Carthaginian Empire" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.polities.find((p) => p.id === "carthage")?.name).toBe("Carthaginian Empire");
  });

  it("is not applicable to an unknown polity", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "rename_polity", actorId: "test-actor", parameters: { polityId: "atlantis", newName: "Whatever" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("vassalize_polity and revoke_vassalage", () => {
  it("creates a tribute obligation, then deactivates it on revocation", () => {
    const w = world();
    const vassalized = executeWorkflow(
      { actionId: "vassalize_polity", actorId: "test-actor", parameters: { overlordPolityId: "rome", vassalPolityId: "carthage", vassalPayerAccountId: "hanno-purse", tributeObligationId: "carthage-tribute", tributeAmount: 200, cadenceSteps: 4, atStep: 0 } },
      w,
      0,
    );
    expect(vassalized.ok).toBe(true);
    if (!vassalized.ok) return;
    const obligation = vassalized.world.material.obligations.find((o) => o.id === "carthage-tribute");
    expect(obligation?.kind).toBe("tribute");
    expect(obligation?.active).toBe(true);

    const revoked = executeWorkflow(
      { actionId: "revoke_vassalage", actorId: "test-actor", parameters: { tributeObligationId: "carthage-tribute", reason: "Carthage throws off the yoke." } },
      vassalized.world,
      0,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.world.material.obligations.find((o) => o.id === "carthage-tribute")?.active).toBe(false);
  });

  it("vassalize_polity is not applicable when the tribute obligation id is already used", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "vassalize_polity", actorId: "test-actor", parameters: { overlordPolityId: "rome", vassalPolityId: "carthage", vassalPayerAccountId: "hanno-purse", tributeObligationId: "legio-pay", tributeAmount: 200, cadenceSteps: 4, atStep: 0 } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });

  it("revoke_vassalage is not applicable to an unknown obligation", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "revoke_vassalage", actorId: "test-actor", parameters: { tributeObligationId: "nowhere", reason: "n/a" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("arrange_marriage_alliance", () => {
  it("records a marriage alliance between characters of different polities", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "arrange_marriage_alliance", actorId: "test-actor", parameters: { characterAId: "marcus-atilius", characterBId: "hanno", relationId: "rome-carthage-marriage", sourceNote: "A dynastic marriage seals an uneasy truce." } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.politicalRelations?.some((r) => r.id === "rome-carthage-marriage" && r.kind === "alliance")).toBe(true);
  });

  it("is not applicable to an unknown character", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "arrange_marriage_alliance", actorId: "test-actor", parameters: { characterAId: "marcus-atilius", characterBId: "nobody", relationId: "some-relation", sourceNote: "n/a" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});
