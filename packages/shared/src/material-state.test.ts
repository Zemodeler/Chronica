import { describe, expect, it } from "vitest";
import {
  GovernmentInstitutionSchema,
  MaterialWorldStateSchema,
  MoneyTransactionSchema,
} from "./material-state";

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
});
