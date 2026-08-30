import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioDefinition, type WorldState } from "@chronica/shared";

export const CHRONICA_SYSTEM_USER_ID = "00000000-0000-4000-8000-000000000001";
export const FIRST_PUNIC_WAR_SCENARIO_ID = "00000000-0000-4000-8000-000000000101";
export const FIRST_PUNIC_WAR_SLUG = "first-punic-war";

const definition: ScenarioDefinition = ScenarioDefinitionSchema.parse({
  clock: { stepLabel: "season", stepLabelPlural: "seasons", stepsPerYear: 4, minSpan: 1, maxSpan: 4, epoch: { year: 264, month: 3, day: 1, era: "BCE" } },
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
    offices: [{ id: "roman-command", label: "Roman field command", polityId: "rome", authorisedActionIds: [], sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-appointment" }],
    successionRules: [{ id: "roman-appointment", label: "Senatorial appointment", kind: "appointment", institutionId: null }],
    decreeAuthorityCostBps: 500,
    decreeMinimumPrestigeBps: 2_000,
  },
  dialogue: { roleSlots: [], namePools: { roman: ["Marcus", "Gaius"], carthaginian: ["Hanno", "Hamilcar"] } },
  continuity: { startingSeatCount: 1, extraPrincipalsPerPlayer: 1 },
  knowledge: [{ id: "sicily-frontier", summary: "Rome and Carthage contest Sicily at the opening of the First Punic War.", subjectIds: ["rome", "carthage"], provinceIds: ["drepanum", "agrigentum"] }],
});

const initialWorld: WorldState = WorldStateSchema.parse({
  schemaVersion: 1,
  pins: { scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, scenarioVersion: 1, libraryVersion: 1 },
  elapsedStep: 0,
  map: {
    // These IDs deliberately match the delivered geographic map asset. A
    // political overlay can therefore paint the real regions at turn zero.
    polities: [{ id: "carthage", name: "Carthage", capitalSettlementId: "carthage-city" }, { id: "rome", name: "Roman Republic", capitalSettlementId: "rome-city" }, { id: "syracuse", name: "Kingdom of Syracuse", capitalSettlementId: "syracuse-city" }],
    provinces: [
      { id: "ita-72843720b863019116732", name: "Latium", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "rome-city", name: "Rome", kind: "city", controllerPolityId: "rome", size: 100, fortificationLevel: 6 }], controllerPolityId: "rome", controlFirmnessBps: 9_000, tier: "far" },
      { id: "tun-13205935b88806172084765", name: "Carthaginian heartland", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "carthage-city", name: "Carthage", kind: "city", controllerPolityId: "carthage", size: 100, fortificationLevel: 6 }], controllerPolityId: "carthage", controlFirmnessBps: 9_000, tier: "far" },
      { id: "ita-72843720b81376294924159-sicily-west", name: "Western Sicily", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "drepanum-city", name: "Drepanum", kind: "port", controllerPolityId: "carthage", size: 55, fortificationLevel: 3 }], controllerPolityId: "carthage", controlFirmnessBps: 8_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-northwest", name: "North-western Sicily", formerNames: [], terrainId: "hills", settlements: [{ id: "palermo-city", name: "Panormus", kind: "city", controllerPolityId: "carthage", size: 65, fortificationLevel: 2 }], controllerPolityId: "carthage", controlFirmnessBps: 7_500, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-central", name: "Agrigentum and the south-west", formerNames: [], terrainId: "hills", settlements: [], controllerPolityId: "carthage", controlFirmnessBps: 7_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-southeast", name: "South-eastern Sicily", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "syracuse-city", name: "Syracuse", kind: "city", controllerPolityId: "syracuse", size: 90, fortificationLevel: 5 }], controllerPolityId: "syracuse", controlFirmnessBps: 8_500, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-northeast", name: "North-eastern Sicily", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "messana-city", name: "Messana", kind: "port", controllerPolityId: "rome", size: 55, fortificationLevel: 3 }], controllerPolityId: "rome", controlFirmnessBps: 7_000, tier: "focus" },
    ],
    edges: [
      { from: "ita-72843720b81376294924159-sicily-west", to: "ita-72843720b81376294924159-sicily-northwest", crossing: "land", distance: 1 },
      { from: "ita-72843720b81376294924159-sicily-northwest", to: "ita-72843720b81376294924159-sicily-central", crossing: "land", distance: 1 },
      { from: "ita-72843720b81376294924159-sicily-central", to: "ita-72843720b81376294924159-sicily-southeast", crossing: "land", distance: 1 },
      { from: "ita-72843720b81376294924159-sicily-southeast", to: "ita-72843720b81376294924159-sicily-northeast", crossing: "land", distance: 1 },
    ],
  },
  actions: [],
  characters: [
    { id: "marcus-atilius", name: "Marcus Atilius", cultureId: "roman", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-northeast", polityId: "rome", ageYearsAtStart: 38, officeId: "roman-command", personalAccountId: "marcus-purse", skills: { martial: 70, intrigue: 35, learning: 45, piety: 40, stewardship: 55, diplomacy: 50, body: 70, subSkills: {} }, traits: [], healthBps: 9_000, prestigeBps: 6_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    { id: "hanno", name: "Hanno", cultureId: "carthaginian", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-west", polityId: "carthage", ageYearsAtStart: 45, officeId: null, personalAccountId: "hanno-purse", skills: { martial: 65, intrigue: 45, learning: 45, piety: 40, stewardship: 50, diplomacy: 55, body: 60, subSkills: {} }, traits: [], healthBps: 8_500, prestigeBps: 6_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
  ],
  continuity: [], encounters: [], storylines: [],
  conflicts: { battles: [{ battleId: "sicilian-frontier", participantForceIds: ["legio-i", "carthaginian-army"] }], sieges: [], wars: [{ polityAId: "carthage", polityBId: "rome" }] },
  material: {
    currency: { id: "denarius", name: "Denarii", unitName: "denarius", unitNamePlural: "denarii", symbol: "D" },
    accounts: [{ id: "marcus-purse", owner: { kind: "character", id: "marcus-atilius" }, currencyId: "denarius", balance: 1_200, status: "active", visibility: "private" }, { id: "hanno-purse", owner: { kind: "character", id: "hanno" }, currencyId: "denarius", balance: 900, status: "active", visibility: "private" }],
    accountAccess: [{ id: "marcus-purse-access", characterId: "marcus-atilius", accountId: "marcus-purse", permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: "marcus-atilius" }, { id: "hanno-purse-access", characterId: "hanno", accountId: "hanno-purse", permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: "hanno" }],
    incomeSources: [],
    obligations: [{ id: "legio-pay", kind: "army_pay", label: "Pay for Legio I", payerAccountId: "marcus-purse", amount: 100, cadenceSteps: 1, nextDueStep: 1, priority: 1, arrears: 0, missedPeriods: 0, active: true }, { id: "carthaginian-pay", kind: "army_pay", label: "Pay for the Carthaginian army", payerAccountId: "hanno-purse", amount: 100, cadenceSteps: 1, nextDueStep: 1, priority: 1, arrears: 0, missedPeriods: 0, active: true }],
    transactions: [], capturableValues: [], holdings: [], institutions: [], reservedPowers: [], motions: [], voteRecords: [],
    forces: [{ id: "legio-i", name: "Legio I", polityId: "rome", commanderCharacterId: "marcus-atilius", controllerCharacterId: "marcus-atilius", locationId: "ita-72843720b81376294924159-sicily-northeast", authorizedStrength: 4_000, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_200, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 4, payObligationId: "legio-pay", payArrearsPeriods: 0, history: [] }, { id: "carthaginian-army", name: "Carthaginian Army", polityId: "carthage", commanderCharacterId: "hanno", controllerCharacterId: "hanno", locationId: "ita-72843720b81376294924159-sicily-west", authorizedStrength: 3_000, personnel: [{ categoryId: "infantry", label: "Infantry", fit: 2_500, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 1_500, provisionStatus: "provisioned", provisionedThroughStep: 4, payObligationId: "carthaginian-pay", payArrearsPeriods: 0, history: [] }],
  },
});

export const firstPunicWarScenario = { definition, initialWorld } as const;
