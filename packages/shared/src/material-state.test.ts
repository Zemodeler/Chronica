import { describe, expect, it } from "vitest";
import {
  GovernmentInstitutionSchema,
  MaterialWorldStateSchema,
  MoneyTransactionSchema,
  OfficeSeatSchema,
  PoliticalProcedureSchema,
} from "./material-state";

const MINIMAL_MATERIAL = {
  currency: { id: "livre", name: "Livre tournois", unitName: "denier", unitNamePlural: "deniers" },
  accounts: [], accountAccess: [], incomeSources: [], obligations: [], transactions: [],
  capturableValues: [], holdings: [], institutions: [], reservedPowers: [], motions: [], voteRecords: [], forces: [],
};

describe("material state schemas", () => {
  it("rejects an institution whose declared weight does not match its blocs", () => {
    const result = GovernmentInstitutionSchema.safeParse({
      id: "senate",
      polityId: "rome",
      name: "Senate",
      votingBlocs: [
        {
          id: "nobles",
          name: "Nobles",
          representedInterest: "land",
          weight: 40,
          baseSupport: 0,
          yesThreshold: 15,
          noThreshold: -15,
          causes: [],
        },
      ],
      totalVotingWeight: 100,
      quorumBps: 5000,
      passageThresholdBps: 5001,
      denominator: "total",
    });

    expect(result.success).toBe(false);
  });

  it("rejects causeless money movement", () => {
    const result = MoneyTransactionSchema.safeParse({
      id: "transaction-1",
      atStep: 12,
      kind: "transfer",
      amount: 20,
      cause: {
        kind: "action",
        id: "action-1",
        explanation: "A lawful payment.",
      },
      visibility: "private",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a minimal authoritative material snapshot", () => {
    const result = MaterialWorldStateSchema.safeParse({
      currency: {
        id: "livre",
        name: "Livre tournois",
        unitName: "denier",
        unitNamePlural: "deniers",
      },
      accounts: [],
      accountAccess: [],
      incomeSources: [],
      obligations: [],
      transactions: [],
      capturableValues: [],
      holdings: [],
      institutions: [],
      reservedPowers: [],
      motions: [],
      voteRecords: [],
      forces: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a holding whose income source does not exist", () => {
    const result = MaterialWorldStateSchema.safeParse({
      currency: {
        id: "livre",
        name: "Livre tournois",
        unitName: "denier",
        unitNamePlural: "deniers",
      },
      accounts: [],
      accountAccess: [],
      incomeSources: [],
      obligations: [],
      transactions: [],
      capturableValues: [],
      holdings: [
        {
          id: "drepanum",
          title: "Count of Drepanum",
          territoryId: "province-drepanum",
          legalHolderCharacterId: "marcus",
          incomeSourceId: "missing-income",
          successionRuleId: "primogeniture",
          physicalControlBps: 7500,
        },
      ],
      institutions: [],
      reservedPowers: [],
      motions: [],
      voteRecords: [],
      forces: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a held office seat with no holder", () => {
    const result = OfficeSeatSchema.safeParse({
      id: "seat-1", officeId: "office-1", seatIndex: 0, holderCharacterId: null, status: "held",
      vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null,
      appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects two office seats sharing the same office and seat index", () => {
    const result = MaterialWorldStateSchema.safeParse({
      ...MINIMAL_MATERIAL,
      officeSeats: [
        { id: "seat-1", officeId: "office-1", seatIndex: 0, holderCharacterId: "a", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
        { id: "seat-2", officeId: "office-1", seatIndex: 0, holderCharacterId: "b", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a resolved procedure with no recorded outcome", () => {
    const result = PoliticalProcedureSchema.safeParse({
      id: "proc-1", type: "decree", institutionId: null, sponsorCharacterId: "a", subjectKind: "polity", subjectId: "rome",
      linkedWorkflowId: "add_gold", linkedWorkflowParams: {}, eligibilityRequirementIds: [], eligibleParticipantIds: [],
      stage: "resolved", resolutionMechanism: "decree_authority", openedAtStep: 0, deadlineStep: null,
      resolvedAtStep: 1, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null,
      sourceEventIds: [], resultingEventIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a vote-mechanism procedure with no named institution", () => {
    const result = PoliticalProcedureSchema.safeParse({
      id: "proc-1", type: "vote", institutionId: null, sponsorCharacterId: "a", subjectKind: "polity", subjectId: "rome",
      linkedWorkflowId: "add_gold", linkedWorkflowParams: {}, eligibilityRequirementIds: [], eligibleParticipantIds: [],
      stage: "proposed", resolutionMechanism: "vote", openedAtStep: 0, deadlineStep: null,
      resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null,
      sourceEventIds: [], resultingEventIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a motion that references a nonexistent institution", () => {
    const result = MaterialWorldStateSchema.safeParse({
      ...MINIMAL_MATERIAL,
      politicalProcedures: [
        { id: "proc-1", type: "decree", institutionId: "missing-institution", sponsorCharacterId: "a", subjectKind: "polity", subjectId: "rome", linkedWorkflowId: "add_gold", linkedWorkflowParams: {}, eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "proposed", resolutionMechanism: "sponsor_discretion", openedAtStep: 0, deadlineStep: null, resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });
});
