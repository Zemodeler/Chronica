import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { Commitment } from "./commitments";
import { generateCandidateActions } from "./candidates";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("generateCandidateActions", () => {
  it("always includes the baseline wait candidate, even with no other state", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const candidates = generateCandidateActions({ world: w, character, atStep: 1, commitments: [] });
    expect(candidates.some((c) => c.actionType === "wait")).toBe(true);
  });

  it("proposes fulfill/defer/break only for commitments the character actually owes", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const commitment: Commitment = {
      id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
      actionKind: "payment", description: "Pay the debt.", conditions: "",
      requiredOfficeId: null, requiredResource: null, visibility: "private",
      sourceEventId: null, breachPressureKind: "humiliation", status: "pending",
      createdAtStep: 1, reviewAtStep: 2, resolvedAtStep: null, resolutionReason: null,
    };
    const candidates = generateCandidateActions({ world: w, character, atStep: 5, commitments: [commitment] });
    expect(candidates.some((c) => c.actionType === "fulfill_commitment" && c.sourceCommitmentId === "c1")).toBe(true);
    expect(candidates.some((c) => c.actionType === "defer_commitment" && c.sourceCommitmentId === "c1")).toBe(true);
    expect(candidates.some((c) => c.actionType === "break_commitment" && c.sourceCommitmentId === "c1")).toBe(true);
  });

  it("does not propose fulfill_commitment when the character lacks the required resource", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const commitment: Commitment = {
      id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
      actionKind: "payment", description: "Pay a fortune.", conditions: "",
      requiredOfficeId: null,
      requiredResource: { accountId: character.personalAccountId, minAmount: 999_999_999 },
      visibility: "private", sourceEventId: null, breachPressureKind: "humiliation", status: "pending",
      createdAtStep: 1, reviewAtStep: 2, resolvedAtStep: null, resolutionReason: null,
    };
    const candidates = generateCandidateActions({ world: w, character, atStep: 5, commitments: [commitment] });
    expect(candidates.some((c) => c.actionType === "fulfill_commitment")).toBe(false);
    expect(candidates.some((c) => c.actionType === "defer_commitment")).toBe(true);
    // docs/32: proposing new terms is now an alternative to defer/break when
    // the original terms are no longer within reach.
    expect(candidates.some((c) => c.actionType === "renegotiate_commitment" && c.sourceCommitmentId === "c1")).toBe(true);
  });

  it("never invents a target: advance_plot only appears for a plot this character actually owns", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const candidates = generateCandidateActions({ world: w, character, atStep: 1, commitments: [] });
    expect(candidates.some((c) => c.actionType === "advance_plot")).toBe(false);
  });

  const PLOT_BASE = {
    id: "p1", characterId: "marcus-atilius", goalId: "g1", worldStorylineId: null,
    participantIds: [], allyIds: [], targetIds: [] as string[], objective: "Secure Messana.",
    stage: "forming" as const, momentum: 50, stakes: "x", visibility: "polity" as const,
    currentObstacle: null, nextIntendedMove: "Move toward the strait.",
    status: "active" as const, causalHistory: [], createdAtStep: 0, updatedAtStep: 0,
  };

  it("proposes travel alongside advance_plot when the plot names a province the character is not in", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const otherProvinceId = w.map.provinces.find((p) => p.id !== character.locationProvinceId)!.id;
    const w2 = { ...w, characterPlots: [{ ...PLOT_BASE, targetIds: [otherProvinceId] }] };
    const candidates = generateCandidateActions({ world: w2, character, atStep: 1, commitments: [] });
    expect(candidates.some((c) => c.actionType === "advance_plot")).toBe(true);
    const travel = candidates.find((c) => c.actionType === "travel");
    expect(travel).toBeDefined();
    expect(travel!.targetIds).toEqual([otherProvinceId]);
    expect(travel!.legalWorkflowIds).toContain("move_character");
  });

  it("does not propose travel when the plot's targets are all where the character already is", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const w2 = { ...w, characterPlots: [{ ...PLOT_BASE, targetIds: [character.locationProvinceId] }] };
    const candidates = generateCandidateActions({ world: w2, character, atStep: 1, commitments: [] });
    expect(candidates.some((c) => c.actionType === "travel")).toBe(false);
  });

  it("proposes seek_support for an active goal when the character has an ally", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const goal = { id: "g1", characterId: character.id, objective: "Win the consulship.", category: "acquire_office" as const, targetEntityIds: [], priority: 3, status: "active" as const, visibility: "polity" as const, causalFactIds: [], createdAtStep: 0, updatedAtStep: 0, history: [] };
    const w2 = {
      ...w,
      characterGoals: [goal],
      socialLinks: [{ id: "link-1", subjectCharacterId: character.id, targetCharacterId: "hanno", kind: "ally" as const, sourceEventId: null, createdAtStep: 0, visibility: "polity" as const }],
    };
    const candidates = generateCandidateActions({ world: w2, character, atStep: 1, commitments: [] });
    const seekSupport = candidates.find((c) => c.actionType === "seek_support");
    expect(seekSupport).toBeDefined();
    expect(seekSupport!.targetIds).toEqual(["hanno"]);
    expect(seekSupport!.legalWorkflowIds).toContain("record_character_social_action");
  });

  it("gives request_assistance a real target once the character has a trusted contact, and none otherwise", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const pressure = { id: "pr1", characterId: character.id, kind: "debt" as const, intensity: 40, label: "Owes creditors.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 8, expiresAtStep: null, visibility: "polity" as const, status: "active" as const };
    const withoutAlly = generateCandidateActions({ world: { ...w, characterPressures: [pressure] }, character, atStep: 1, commitments: [] });
    const withoutAllyCandidate = withoutAlly.find((c) => c.actionType === "request_assistance");
    expect(withoutAllyCandidate?.legalWorkflowIds).toEqual([]);

    const w2 = {
      ...w, characterPressures: [pressure],
      socialLinks: [{ id: "link-1", subjectCharacterId: character.id, targetCharacterId: "hanno", kind: "friend" as const, sourceEventId: null, createdAtStep: 0, visibility: "polity" as const }],
    };
    const withAlly = generateCandidateActions({ world: w2, character, atStep: 1, commitments: [] });
    const withAllyCandidate = withAlly.find((c) => c.actionType === "request_assistance");
    expect(withAllyCandidate?.targetIds).toEqual(["hanno"]);
    expect(withAllyCandidate?.legalWorkflowIds).toContain("record_character_social_action");
  });

  it("proposes investigating a genuinely weak suspicion, but not a merely uncertain one", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const weakBelief = { id: "b1", holderCharacterId: character.id, subjectEntityId: "hanno", claim: "Hanno may be moving against Messana.", kind: "suspicion" as const, sourceCharacterId: null, sourceEventId: null, confidence: 25, visibility: "private" as const, learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [], status: "active" as const };
    const w2 = { ...w, characterBeliefs: [weakBelief] };
    const candidates = generateCandidateActions({ world: w2, character, atStep: 1, commitments: [] });
    const investigate = candidates.find((c) => c.actionType === "investigate");
    expect(investigate).toBeDefined();
    expect(investigate!.sourceBeliefId).toBe("b1");
    expect(investigate!.legalWorkflowIds).toContain("investigate");

    const confidentBelief = { ...weakBelief, confidence: 65 };
    const w3 = { ...w, characterBeliefs: [confidentBelief] };
    const noInvestigate = generateCandidateActions({ world: w3, character, atStep: 1, commitments: [] });
    expect(noInvestigate.some((c) => c.actionType === "investigate")).toBe(false);
  });

  it("proposes spread_belief for damaging knowledge about a rival an ally does not yet hold", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const secret = { id: "b1", holderCharacterId: character.id, subjectEntityId: "hanno", claim: "Hanno secretly parleyed with the Mamertines.", kind: "secret" as const, sourceCharacterId: null, sourceEventId: null, confidence: 80, visibility: "private" as const, learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [], status: "active" as const };
    const w2 = {
      ...w, characterBeliefs: [secret],
      socialLinks: [
        { id: "rival-link", subjectCharacterId: character.id, targetCharacterId: "hanno", kind: "rival" as const, sourceEventId: null, createdAtStep: 0, visibility: "polity" as const },
        { id: "ally-link", subjectCharacterId: character.id, targetCharacterId: "gaius-genucius", kind: "ally" as const, sourceEventId: null, createdAtStep: 0, visibility: "polity" as const },
      ],
      characterPressures: [{ id: "pr1", characterId: character.id, kind: "political_danger" as const, intensity: 40, label: "Hanno's rise threatens him.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 8, expiresAtStep: null, visibility: "polity" as const, status: "active" as const }],
    };
    const candidates = generateCandidateActions({ world: w2, character, atStep: 1, commitments: [] });
    const spreadBelief = candidates.find((c) => c.actionType === "spread_belief");
    expect(spreadBelief).toBeDefined();
    expect(spreadBelief!.targetIds).toEqual(["gaius-genucius"]);
    expect(spreadBelief!.sourceBeliefId).toBe("b1");
  });

  it("proposes military_action only when a commanded force shares ground with an at-war enemy force", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const ownForce = w.material.forces.find((f) => f.commanderCharacterId === character.id);
    expect(ownForce).toBeDefined();
    expect(character.polityId).not.toBeNull();
    const ownPolityId = character.polityId!;
    const enemyPolityId = w.map.polities.find((p) => p.id !== ownPolityId)!.id;
    const enemyForce = { ...ownForce!, id: "enemy-force-1", polityId: enemyPolityId, commanderCharacterId: "hanno", controllerCharacterId: "hanno", locationId: ownForce!.locationId };
    const w2 = {
      ...w,
      material: { ...w.material, forces: [...w.material.forces, enemyForce] },
      conflicts: { ...w.conflicts, wars: [...w.conflicts.wars, { polityAId: ownPolityId, polityBId: enemyPolityId }] },
    };
    const candidates = generateCandidateActions({ world: w2, character, atStep: 1, commitments: [] });
    const militaryAction = candidates.find((c) => c.actionType === "military_action");
    expect(militaryAction).toBeDefined();
    expect(militaryAction!.targetIds).toEqual(["enemy-force-1"]);
    expect(militaryAction!.legalWorkflowIds).toContain("start_battle");

    const noWar = generateCandidateActions({
      world: {
        ...w,
        material: { ...w.material, forces: [...w.material.forces, enemyForce] },
        conflicts: { ...w.conflicts, wars: [] },
      },
      character, atStep: 1, commitments: [],
    });
    expect(noWar.some((c) => c.actionType === "military_action")).toBe(false);
  });

  it("proposes sponsor_procedure ahead of seek_office when no appointment procedure is already open", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const ambitiousCharacter = { ...character, ambitions: [{ id: "amb-1", label: "Win the consulship.", kind: "office" as const, targetId: "consul-office", status: "active" as const }] };
    const pressure = { id: "pr1", characterId: character.id, kind: "opportunity" as const, intensity: 30, label: "The consulship has fallen vacant.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 8, expiresAtStep: null, visibility: "polity" as const, status: "active" as const };
    const w2 = { ...w, characterPressures: [pressure] };
    const candidates = generateCandidateActions({ world: w2, character: ambitiousCharacter, atStep: 1, commitments: [] });
    const sponsor = candidates.find((c) => c.actionType === "sponsor_procedure");
    expect(sponsor).toBeDefined();
    expect(sponsor!.proposedProcedure?.type).toBe("appointment");
    expect(sponsor!.proposedProcedure?.linkedWorkflowId).toBe("appoint_to_office");
    expect(candidates.some((c) => c.actionType === "seek_office")).toBe(false);

    const w3 = {
      ...w2,
      material: {
        ...w.material,
        politicalProcedures: [{
          id: "already-open", type: "appointment" as const, institutionId: null, sponsorCharacterId: character.id,
          subjectKind: "office_seat" as const, subjectId: "consul-office", linkedWorkflowId: "appoint_to_office",
          linkedWorkflowParams: {}, eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "proposed" as const,
          resolutionMechanism: "appointment_authority" as const, openedAtStep: 0, deadlineStep: null, resolvedAtStep: null,
          visibility: "polity" as const, voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [],
        }],
      },
    };
    const candidatesWithOpenProcedure = generateCandidateActions({ world: w3, character: ambitiousCharacter, atStep: 1, commitments: [] });
    expect(candidatesWithOpenProcedure.some((c) => c.actionType === "sponsor_procedure")).toBe(false);
    expect(candidatesWithOpenProcedure.some((c) => c.actionType === "seek_office")).toBe(true);
  });
});
