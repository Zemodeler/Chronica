import type { MaterialWorldViewModel } from "@chronica/shared";

export const demoMaterialView: MaterialWorldViewModel = {
  characterName: "Marcus Atilius",
  currencyName: "Denarii",
  personalAccount: {
    id: "account-personal",
    label: "Your personal purse",
    balance: 1200,
    permissions: ["view", "spend_without_vote"],
    status: "active",
    recentChanges: [],
  },
  accessibleTreasuries: [],
  income: [],
  holdings: [],
  government: {
    institutionName: "Royal court",
    reservedPowers: [],
    motionStatus: "none",
    blocs: [],
  },
  forces: [
    {
      id: "force-royal-host",
      name: "Royal host",
      authorizedStrength: 4000,
      totalHeadcount: 3200,
      fitStrength: 3200,
      effectiveStrength: 3200,
      unavailable: 0,
      provisionLabel: "Well provisioned",
      provisionedThroughLabel: "Step 20",
      payStatus: "Paid",
      changeExplanation: "No change recorded yet this turn.",
    },
  ],
  orderReadback: {
    payerLabel: "No order pending",
    cost: 0,
    approvalLabel: "No approval required.",
  },
  visibility: "private",
};
