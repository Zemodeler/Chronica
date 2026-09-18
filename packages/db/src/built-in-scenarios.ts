import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioDefinition, type WorldState } from "@chronica/shared";

export { PUNIC_WARS_SCENARIO_ID, PUNIC_WARS_SLUG, punicWarsScenario } from "./punic-wars-scenario";

export const CHRONICA_SYSTEM_USER_ID = "00000000-0000-4000-8000-000000000001";
export const FIRST_PUNIC_WAR_SCENARIO_ID = "00000000-0000-4000-8000-000000000101";
export const FIRST_PUNIC_WAR_SLUG = "first-punic-war";

const definition: ScenarioDefinition = ScenarioDefinitionSchema.parse({
  clock: { epoch: { year: 264, month: 3, day: 1, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 },
  map: {
    terrains: [
      { id: "coastal-plain", label: "Coastal plain", allowedCrossings: ["land", "strait", "sea_lane"], water: false },
      { id: "hills", label: "Hills", allowedCrossings: ["land", "pass"], water: false },
    ],
    provinceCount: { min: 7, max: 7 },
  },
  warfare: {
    troopCategories: [{ id: "infantry", label: "Infantry", combatWeightBps: 10_000, steadinessBps: 7_000, mobilityBps: 5_000 }],
    routineTactics: [{ id: "hold-ground", label: "Hold prepared ground", factor: "cohesion", phases: ["engagement"], modifierBps: 500 }],
    phases: ["contact", "engagement", "cohesion", "withdrawal", "aftermath"],
    routCohesionBps: 2_000,
    arrearsMoralePeriods: 1,
    arrearsDesertionPeriods: 2,
  },
  government: {
    offices: [{ id: "roman-command", label: "Roman field command", polityId: "rome", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set", "social_events", "polity_stance_shift"], sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-election", eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-min-prestige-3000", "req-not-disqualified"] }],
    successionRules: [{ id: "roman-election", label: "Election by the Senate", kind: "elective", institutionId: "roman-senate" }],
    decreeAuthorityCostBps: 500,
    decreeMinimumPrestigeBps: 2_000,
  },
  dialogue: { roleSlots: [], namePools: { roman: ["Marcus", "Gaius"], carthaginian: ["Hanno", "Hamilcar"] } },
  continuity: { startingSeatCount: 1, extraPrincipalsPerPlayer: 1, maxTotalCharacters: 64 },
  knowledge: [{ id: "sicily-frontier", summary: "Rome and Carthage contest Sicily at the opening of the First Punic War.", subjectIds: ["rome", "carthage"], provinceIds: ["drepanum", "agrigentum"] }],
  // Life vertical slice (character-sim phase 5): modest, clearly-labeled
  // mortality/incapacity rates -- authored only for this demo scenario, so
  // punic-wars-scenario.ts's own behaviour is unchanged unless a follow-up
  // authors rates there too. One inheritance rule for Marcus's estate.
  life: {
    lifeStages: [
      { id: "youth", label: "youth", minAgeYears: 0, maxAgeYears: 17, mortalityRatePerYearBps: 20, incapacityRatePerYearBps: 0, recoveryRatePerYearBps: 0 },
      { id: "adult", label: "adulthood", minAgeYears: 18, maxAgeYears: 54, mortalityRatePerYearBps: 40, incapacityRatePerYearBps: 20, recoveryRatePerYearBps: 4_000 },
      { id: "elder", label: "old age", minAgeYears: 55, maxAgeYears: null, mortalityRatePerYearBps: 250, incapacityRatePerYearBps: 150, recoveryRatePerYearBps: 1_500 },
    ],
    inheritanceRules: [
      { id: "marcus-estate-rule", kind: "primogeniture", institutionId: null, debtsTransfer: true },
    ],
    reviewIntervalSteps: 365,
  },
  // Chronicle-first legibility vertical slice (character-sim phase 6): the
  // player's opening dispatch, not a new fact system -- the Senate rivalry
  // named here is exactly what `senate-censure-marcus` (above) can resolve.
  chronicle: {
    openingContext: "Rome and Carthage contest Sicily. The Senate is divided between the patrician bloc that backs Marcus Atilius's command and a popular bloc that blames him for the stalemate at Drepanum.",
    historicalBackground: [
      { title: "The stalemate at Drepanum", body: "Marcus Atilius's fleet has held the line at Drepanum for a full season without a decisive engagement.", knowledgeStatus: "confirmed" },
      { title: "Whispers of censure", body: "Some in the Senate murmur that Quintus Fabius means to move against Marcus before the next vote.", knowledgeStatus: "rumour" },
    ],
    openingTensions: ["The Senate's patience with the Sicilian stalemate is running out.", "Carthage's own command over its army in the west is not yet settled."],
    terminology: { institution: "Senate", office: "command" },
  },
});

const initialWorld: WorldState = WorldStateSchema.parse({
  schemaVersion: 3,
  pins: { scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, scenarioVersion: 7, libraryVersion: 1 },
  elapsedStep: 0,
  instant: { day: 0, minute: 0 },
  map: {
    // These IDs deliberately match the delivered geographic map asset. A
    // political overlay can therefore paint the real regions at turn zero.
    polities: [{ id: "carthage", name: "Carthage", capitalSettlementId: "carthage-city" }, { id: "rome", name: "Roman Republic", capitalSettlementId: "settlement-rome" }, { id: "syracuse", name: "Kingdom of Syracuse", capitalSettlementId: "syracuse-city" }],
    provinces: [
      { id: "ita-local-23120603B86473916475875", name: "Latium", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "settlement-rome", name: "Rome", kind: "city", provinceId: "ita-local-23120603B86473916475875", controllerPolityId: "rome", size: 100, fortificationLevel: 6 }], controllerPolityId: "rome", controlFirmnessBps: 9_000, tier: "far" },
      { id: "tun-13205935b88806172084765", name: "Carthaginian heartland", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "carthage-city", name: "Carthage", kind: "city", provinceId: "tun-13205935b88806172084765", controllerPolityId: "carthage", size: 100, fortificationLevel: 6 }], controllerPolityId: "carthage", controlFirmnessBps: 9_000, tier: "far" },
      { id: "ita-72843720b81376294924159-sicily-west", name: "Western Sicily", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "drepanum-city", name: "Drepanum", kind: "port", provinceId: "ita-72843720b81376294924159-sicily-west", controllerPolityId: "carthage", size: 55, fortificationLevel: 3 }], controllerPolityId: "carthage", controlFirmnessBps: 8_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-northwest", name: "North-western Sicily", formerNames: [], terrainId: "hills", settlements: [{ id: "palermo-city", name: "Panormus", kind: "city", provinceId: "ita-72843720b81376294924159-sicily-northwest", controllerPolityId: "carthage", size: 65, fortificationLevel: 2 }], controllerPolityId: "carthage", controlFirmnessBps: 7_500, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-central", name: "Agrigentum and the south-west", formerNames: [], terrainId: "hills", settlements: [], controllerPolityId: "carthage", controlFirmnessBps: 7_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-southeast", name: "South-eastern Sicily", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "syracuse-city", name: "Syracuse", kind: "city", provinceId: "ita-72843720b81376294924159-sicily-southeast", controllerPolityId: "syracuse", size: 90, fortificationLevel: 5 }], controllerPolityId: "syracuse", controlFirmnessBps: 8_500, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-northeast", name: "North-eastern Sicily", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "messana-city", name: "Messana", kind: "port", provinceId: "ita-72843720b81376294924159-sicily-northeast", controllerPolityId: "rome", size: 55, fortificationLevel: 3 }], controllerPolityId: "rome", controlFirmnessBps: 7_000, tier: "focus" },
    ],
    edges: [
      { from: "ita-72843720b81376294924159-sicily-west", to: "ita-72843720b81376294924159-sicily-northwest", crossing: "land", distance: 1 },
      { from: "ita-72843720b81376294924159-sicily-northwest", to: "ita-72843720b81376294924159-sicily-central", crossing: "land", distance: 1 },
      { from: "ita-72843720b81376294924159-sicily-central", to: "ita-72843720b81376294924159-sicily-southeast", crossing: "land", distance: 1 },
      { from: "ita-72843720b81376294924159-sicily-southeast", to: "ita-72843720b81376294924159-sicily-northeast", crossing: "land", distance: 1 },
    ],
  },
  characters: [
    { id: "marcus-atilius", name: "Marcus Atilius", cultureId: "roman", faithId: null, dynastyId: "atilii", locationProvinceId: "ita-72843720b81376294924159-sicily-northeast", polityId: "rome", ageYearsAtStart: 38, officeId: "roman-command", personalAccountId: "marcus-purse", skills: { martial: 70, intrigue: 35, learning: 45, piety: 40, stewardship: 55, diplomacy: 50, body: 70, subSkills: {} }, traits: [], healthBps: 9_000, prestigeBps: 6_000, relations: [], ambitions: [], heirCharacterId: "marcus-atilius-minor", alive: true, diedAtStep: null, disqualifyingStatuses: [] },
    // Life vertical slice (character-sim phase 5): Marcus's son and named
    // heir -- a distinct character with no copied relations/mind, an
    // ordinary continuity tier, and his own estate claim through primogeniture.
    { id: "marcus-atilius-minor", name: "Marcus Atilius the Younger", cultureId: "roman", faithId: null, dynastyId: "atilii", locationProvinceId: "ita-local-23120603B86473916475875", polityId: "rome", ageYearsAtStart: 16, officeId: null, personalAccountId: "marcus-minor-purse", skills: { martial: 30, intrigue: 20, learning: 35, piety: 30, stewardship: 25, diplomacy: 25, body: 40, subSkills: {} }, traits: [], healthBps: 10_000, prestigeBps: 500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null, disqualifyingStatuses: [] },
    { id: "hanno", name: "Hanno", cultureId: "carthaginian", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-west", polityId: "carthage", ageYearsAtStart: 45, officeId: null, personalAccountId: "hanno-purse", skills: { martial: 65, intrigue: 45, learning: 45, piety: 40, stewardship: 50, diplomacy: 55, body: 60, subSkills: {} }, traits: [], healthBps: 8_500, prestigeBps: 6_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null, disqualifyingStatuses: [] },
    // Political vertical slice (character-sim phase 4): a rival senator who
    // sponsors the Senate's censure procedure against Marcus, and a
    // subordinate Carthaginian commander Hanno may hand tactical command to.
    { id: "quintus-fabius", name: "Quintus Fabius", cultureId: "roman", faithId: null, dynastyId: null, locationProvinceId: "ita-local-23120603B86473916475875", polityId: "rome", ageYearsAtStart: 52, officeId: null, personalAccountId: "quintus-purse", skills: { martial: 40, intrigue: 55, learning: 60, piety: 45, stewardship: 60, diplomacy: 65, body: 45, subSkills: {} }, traits: [], healthBps: 8_000, prestigeBps: 5_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null, disqualifyingStatuses: [] },
    { id: "hamilcar", name: "Hamilcar", cultureId: "carthaginian", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-west", polityId: "carthage", ageYearsAtStart: 30, officeId: null, personalAccountId: "hamilcar-purse", skills: { martial: 60, intrigue: 40, learning: 40, piety: 40, stewardship: 40, diplomacy: 45, body: 65, subSkills: {} }, traits: [], healthBps: 9_500, prestigeBps: 3_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null, disqualifyingStatuses: [] },
  ],
  continuity: [
    { characterId: "marcus-atilius-minor", tier: "ordinary", notability: 0, encounterIds: [], lastingChanges: [], plan: null },
  ],
  encounters: [], storylines: [],
  // Life vertical slice (character-sim phase 5): one canonical parent/child
  // tie, matching the authored heirCharacterId above.
  familyLinks: [
    { id: "marcus-atilius:parent:marcus-atilius-minor", characterId: "marcus-atilius", relatedCharacterId: "marcus-atilius-minor", kind: "parent", startedAtStep: 0, endedAtStep: null, visibility: "polity", provenanceEventId: null },
  ],
  conflicts: { battles: [{ battleId: "sicilian-frontier", participantForceIds: ["legio-i", "carthaginian-army"], attackerForceIds: ["legio-i"] }], sieges: [], wars: [{ polityAId: "carthage", polityBId: "rome" }] },
  material: {
    currency: { id: "denarius", name: "Denarii", unitName: "denarius", unitNamePlural: "denarii", symbol: "D" },
    accounts: [
      { id: "marcus-purse", owner: { kind: "character", id: "marcus-atilius" }, currencyId: "denarius", balance: 1_200, status: "active", visibility: "private" },
      { id: "hanno-purse", owner: { kind: "character", id: "hanno" }, currencyId: "denarius", balance: 900, status: "active", visibility: "private" },
      { id: "quintus-purse", owner: { kind: "character", id: "quintus-fabius" }, currencyId: "denarius", balance: 800, status: "active", visibility: "private" },
      { id: "hamilcar-purse", owner: { kind: "character", id: "hamilcar" }, currencyId: "denarius", balance: 400, status: "active", visibility: "private" },
      { id: "marcus-minor-purse", owner: { kind: "character", id: "marcus-atilius-minor" }, currencyId: "denarius", balance: 50, status: "active", visibility: "private" },
    ],
    accountAccess: [
      { id: "marcus-purse-access", characterId: "marcus-atilius", accountId: "marcus-purse", permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: "marcus-atilius" },
      { id: "hanno-purse-access", characterId: "hanno", accountId: "hanno-purse", permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: "hanno" },
      { id: "quintus-purse-access", characterId: "quintus-fabius", accountId: "quintus-purse", permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: "quintus-fabius" },
      { id: "hamilcar-purse-access", characterId: "hamilcar", accountId: "hamilcar-purse", permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: "hamilcar" },
      { id: "marcus-minor-purse-access", characterId: "marcus-atilius-minor", accountId: "marcus-minor-purse", permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: "marcus-atilius-minor" },
    ],
    incomeSources: [],
    obligations: [{ id: "legio-pay", kind: "army_pay", label: "Pay for Legio I", payerAccountId: "marcus-purse", amount: 100, cadenceSteps: 30, nextDueStep: 30, priority: 1, arrears: 0, missedPeriods: 0, active: true }, { id: "carthaginian-pay", kind: "army_pay", label: "Pay for the Carthaginian army", payerAccountId: "hanno-purse", amount: 100, cadenceSteps: 30, nextDueStep: 30, priority: 1, arrears: 0, missedPeriods: 0, active: true }],
    transactions: [], capturableValues: [], holdings: [],
    // Political vertical slice (character-sim phase 4): a Roman Senate that
    // decides by vote, and a Carthaginian command decision that needs no
    // institution at all -- one polity's authority is generic data, not an
    // engine-level assumption about how government works.
    institutions: [
      {
        id: "roman-senate",
        polityId: "rome",
        name: "Senate",
        votingBlocs: [
          { id: "patrician-bloc", name: "Patrician bloc", representedInterest: "landed nobility", weight: 60, baseSupport: 20, yesThreshold: 15, noThreshold: -15, causes: [] },
          { id: "popular-bloc", name: "Popular bloc", representedInterest: "the people", weight: 40, baseSupport: -10, yesThreshold: 15, noThreshold: -15, causes: [] },
        ],
        totalVotingWeight: 100,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "total",
      },
    ],
    reservedPowers: [],
    motions: [],
    voteRecords: [],
    eligibilityRequirements: [
      { id: "req-alive", kind: "alive", label: "Must be alive", params: {} },
      { id: "req-roman-polity", kind: "polity_membership", label: "Must belong to Rome", params: { polityId: "rome" } },
      { id: "req-min-prestige-3000", kind: "min_prestige", label: "Must hold at least 3000bps prestige", params: { minPrestigeBps: 3_000 } },
      { id: "req-not-disqualified", kind: "not_disqualified", label: "Must carry no disqualifying status", params: {} },
    ],
    politicalGroups: [
      { id: "patrician-bloc", name: "Patrician bloc", polityId: "rome", type: "faction", leaderCharacterId: "marcus-atilius", platform: ["Defend the incumbent command"], resourceAccountId: null, publicReputationBps: 6_000, active: true },
      { id: "popular-bloc", name: "Popular bloc", polityId: "rome", type: "faction", leaderCharacterId: "quintus-fabius", platform: ["Hold commanders accountable for reverses"], resourceAccountId: null, publicReputationBps: 4_000, active: true },
    ],
    groupMemberships: [
      { characterId: "marcus-atilius", groupId: "patrician-bloc", role: "leader", influenceBps: 8_000, loyaltyBps: 70, visibility: "polity", joinedAtStep: 0, leftAtStep: null, joinProvenanceEventId: null, leaveProvenanceEventId: null },
      { characterId: "quintus-fabius", groupId: "popular-bloc", role: "leader", influenceBps: 7_000, loyaltyBps: 65, visibility: "polity", joinedAtStep: 0, leftAtStep: null, joinProvenanceEventId: null, leaveProvenanceEventId: null },
    ],
    officeSeats: [
      { id: "roman-command:seat:0", officeId: "roman-command", seatIndex: 0, holderCharacterId: "marcus-atilius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-min-prestige-3000", "req-not-disqualified"] },
    ],
    politicalProcedures: [
      {
        id: "senate-censure-marcus",
        type: "removal",
        institutionId: "roman-senate",
        sponsorCharacterId: "quintus-fabius",
        subjectKind: "office_seat",
        subjectId: "roman-command",
        label: "Censure the consul for the stalemate at Drepanum and remove him from command.",
        eligibilityRequirementIds: ["req-alive", "req-roman-polity"],
        eligibleParticipantIds: ["marcus-atilius", "quintus-fabius"],
        stage: "gathering_support",
        resolutionMechanism: "vote",
        openedAtStep: 0,
        deadlineStep: null,
        resolvedAtStep: null,
        visibility: "polity",
        voteRecordId: null,
        outcome: null,
        outcomeReason: null,
        sourceEventIds: [],
        resultingEventIds: [],
      },
      {
        id: "carthage-command-handover",
        type: "command_assignment",
        institutionId: null,
        sponsorCharacterId: "hanno",
        subjectKind: "force",
        subjectId: "carthaginian-army",
        label: "Hand the Carthaginian army over to Hamilcar.",
        eligibilityRequirementIds: [],
        eligibleParticipantIds: ["hanno", "hamilcar"],
        stage: "gathering_support",
        resolutionMechanism: "sponsor_discretion",
        openedAtStep: 0,
        deadlineStep: null,
        resolvedAtStep: null,
        visibility: "polity",
        voteRecordId: null,
        outcome: null,
        outcomeReason: null,
        sourceEventIds: [],
        resultingEventIds: [],
      },
    ],
    supportPositions: [],
    polityLegitimacy: [
      { polityId: "rome", legitimacyBps: 7_500, institutionalConfidenceBps: 7_000, causes: [] },
      { polityId: "carthage", legitimacyBps: 7_000, institutionalConfidenceBps: 6_500, causes: [] },
    ],
    institutionLegitimacy: [{ institutionId: "roman-senate", legitimacyBps: 7_000, causes: [] }],
    // Life vertical slice (character-sim phase 5): Marcus's estate, settled
    // by primogeniture on death -- his son inherits the purse, never the
    // office (roman-command is refilled only through the Senate's own
    // procedure, per the political vertical slice above).
    inheritanceRules: [{ id: "marcus-estate-rule", kind: "primogeniture", institutionId: null, debtsTransfer: true }],
    estates: [
      { id: "marcus-estate", ownerCharacterId: "marcus-atilius", accountIds: ["marcus-purse"], holdingIds: [], obligationIds: ["legio-pay"], inheritanceRuleId: "marcus-estate-rule", testamentaryBeneficiaryIds: [], status: "intact", settledAtStep: null },
    ],
    inheritanceTransfers: [],
    forces: [{ id: "legio-i", name: "Legio I", polityId: "rome", commanderCharacterId: "marcus-atilius", controllerCharacterId: "marcus-atilius", locationId: "ita-72843720b81376294924159-sicily-northeast", authorizedStrength: 4_000, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_200, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "legio-pay", payArrearsPeriods: 0, history: [] }, { id: "carthaginian-army", name: "Carthaginian Army", polityId: "carthage", commanderCharacterId: "hanno", controllerCharacterId: "hanno", locationId: "ita-72843720b81376294924159-sicily-west", authorizedStrength: 3_000, personnel: [{ categoryId: "infantry", label: "Infantry", fit: 2_500, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 1_500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "carthaginian-pay", payArrearsPeriods: 0, history: [] }],
  },
});

export const firstPunicWarScenario = { definition, initialWorld } as const;
