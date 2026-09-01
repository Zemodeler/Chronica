import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioDefinition, type WorldState } from "@chronica/shared";

export const PUNIC_WARS_SCENARIO_ID = "00000000-0000-4000-8000-000000000102";
export const PUNIC_WARS_SLUG = "punic-wars";

const italianPolities = [
  ["ligurians", "Ligurian peoples"], ["insubres", "Insubres"], ["boii", "Boii"], ["cenomani", "Cenomani"], ["veneti", "Veneti"], ["etruscan-cities", "Etruscan cities"],
  ["sabines", "Sabines"], ["umbrians", "Umbrians"], ["picentes", "Picentes"], ["marsi-paeligni", "Marsi and Paeligni"], ["campanians", "Campanians"], ["samnites", "Samnites"],
  ["daunians", "Daunians"], ["peucetians", "Peucetians"], ["messapians", "Messapians"], ["tarentines", "Tarentines"], ["lucanians", "Lucanians"], ["bruttians", "Bruttians"], ["rhegines", "Rhegines"],
] as const;

const italy = [
  ["punic-italy-liguria", "Liguria", "ligurians"], ["punic-italy-insubria", "Insubria", "insubres"], ["punic-italy-boii", "Boii", "boii"], ["punic-italy-cenomani", "Cenomani", "cenomani"], ["punic-italy-veneti", "Veneti", "veneti"],
  ["punic-italy-etruria", "Etruria", "etruscan-cities"], ["punic-italy-latium", "Latium", "rome"], ["punic-italy-sabines", "Sabines", "sabines"], ["punic-italy-umbrians", "Umbria", "umbrians"], ["punic-italy-picentes", "Picenum", "picentes"],
  ["punic-italy-marsi", "Marsi and Paeligni", "marsi-paeligni"], ["punic-italy-campania", "Campania", "campanians"], ["punic-italy-samnium", "Samnium", "samnites"], ["punic-italy-daunians", "Daunia", "daunians"], ["punic-italy-peucetians", "Peucetia", "peucetians"],
  ["punic-italy-messapians", "Messapia", "messapians"], ["punic-italy-tarentines", "Tarentum", "tarentines"], ["punic-italy-lucanians", "Lucania", "lucanians"], ["punic-italy-bruttians", "Bruttium", "bruttians"], ["punic-italy-rhegines", "Rhegium", "rhegines"],
] as const;

const definition: ScenarioDefinition = ScenarioDefinitionSchema.parse({
  clock: { stepLabel: "season", stepLabelPlural: "seasons", stepsPerYear: 4, minSpan: 1, maxSpan: 4, epoch: { year: 270, month: 3, day: 1, era: "BCE" } },
  map: {
    terrains: [
      { id: "coastal-plain", label: "Coastal plain", allowedCrossings: ["land", "strait", "sea_lane"], water: false },
      { id: "hills", label: "Hills", allowedCrossings: ["land", "pass"], water: false },
    ],
    provinceCount: { min: 26, max: 26 },
  },
  warfare: {
    troopCategories: [{ id: "infantry", label: "Infantry", combatWeightBps: 10_000, steadinessBps: 7_000, mobilityBps: 5_000 }],
    routineTactics: [{ id: "hold-ground", label: "Hold prepared ground", factor: "cohesion", phases: ["engagement"], modifierBps: 500 }],
    phases: ["contact", "engagement", "cohesion", "withdrawal", "aftermath"], routCohesionBps: 2_000, arrearsMoralePeriods: 1, arrearsDesertionPeriods: 2,
  },
  government: {
    offices: [{ id: "roman-consul", label: "Roman consul", polityId: "rome", authorisedActionIds: [], sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-election" }],
    successionRules: [{ id: "roman-election", label: "Consular election", kind: "elective", institutionId: null }], decreeAuthorityCostBps: 500, decreeMinimumPrestigeBps: 2_000,
  },
  dialogue: { roleSlots: [], namePools: { roman: ["Gaius", "Lucius"], carthaginian: ["Hanno", "Hamilcar"], greek: ["Hieron", "Sosistratus"] } },
  continuity: { startingSeatCount: 1, extraPrincipalsPerPlayer: 1 },
  knowledge: [
    { id: "mamertine-crisis", summary: "In 270 BCE Hieron II's Syracuse contests the Mamertines of Messana. Rome and Carthage remain at peace, but the strait is strategically volatile.", subjectIds: ["syracuse", "mamertines", "rome", "carthage"], provinceIds: ["ita-72843720b81376294924159-sicily-northeast", "ita-72843720b81376294924159-sicily-southeast"] },
    { id: "roman-italian-alliance", summary: "Rome's Italian allies retain local identities while belonging to its military and diplomatic sphere; these ties are visible context rather than automatic commitments.", subjectIds: ["rome", "samnites", "lucanians", "bruttians"], provinceIds: ["punic-italy-latium", "punic-italy-samnium", "punic-italy-lucanians", "punic-italy-bruttians"] },
  ],
});

const initialWorld: WorldState = WorldStateSchema.parse({
  schemaVersion: 1,
  pins: { scenarioId: PUNIC_WARS_SCENARIO_ID, scenarioVersion: 1, libraryVersion: 1 },
  elapsedStep: 0,
  map: {
    polities: [
      { id: "rome", name: "Roman Republic", capitalSettlementId: "settlement-rome" },
      { id: "carthage", name: "Carthage", capitalSettlementId: "settlement-carthage" },
      { id: "syracuse", name: "Kingdom of Syracuse", capitalSettlementId: "settlement-syracuse" },
      { id: "mamertines", name: "Mamertines of Messana", capitalSettlementId: "settlement-messana" },
      ...italianPolities.map(([id, name]) => ({ id, name, capitalSettlementId: null })),
    ],
    politicalRelations: [
      ...["sabines", "umbrians", "picentes", "marsi-paeligni", "campanians", "samnites", "daunians", "peucetians", "messapians", "tarentines", "lucanians", "bruttians", "rhegines"].map((memberPolityId) => ({ id: `rome-alliance-${memberPolityId}`, kind: "alliance" as const, leaderPolityId: "rome", memberPolityId, sourceNote: "Roman Italian alliance at the 270 BCE opening; descriptive only, with no automatic military effect." })),
    ],
    provinces: [
      ...italy.map(([id, name, controllerPolityId]) => ({ id, name, formerNames: [], terrainId: id === "punic-italy-latium" || id === "punic-italy-campania" ? "coastal-plain" : "hills", settlements: id === "punic-italy-latium" ? [{ id: "settlement-rome", name: "Rome", kind: "city", controllerPolityId: "rome", size: 100, fortificationLevel: 6 }] : [], controllerPolityId, controlFirmnessBps: controllerPolityId === "rome" ? 9_000 : 7_000, tier: "far" as const })),
      { id: "tun-13205935b88806172084765", name: "Carthaginian heartland", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "settlement-carthage", name: "Carthage", kind: "city", controllerPolityId: "carthage", size: 100, fortificationLevel: 6 }], controllerPolityId: "carthage", controlFirmnessBps: 9_000, tier: "far" },
      { id: "ita-72843720b81376294924159-sicily-west", name: "Lilybaeum and western Sicily", formerNames: [], terrainId: "coastal-plain", settlements: [], controllerPolityId: "carthage", controlFirmnessBps: 8_500, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-northwest", name: "Panormus and the north-west", formerNames: [], terrainId: "hills", settlements: [], controllerPolityId: "carthage", controlFirmnessBps: 8_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-central", name: "Agrigentum and the south-west", formerNames: [], terrainId: "hills", settlements: [], controllerPolityId: "carthage", controlFirmnessBps: 8_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-southeast", name: "Syracuse and the south-east", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "settlement-syracuse", name: "Syracuse", kind: "city", controllerPolityId: "syracuse", size: 90, fortificationLevel: 5 }], controllerPolityId: "syracuse", controlFirmnessBps: 8_500, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-northeast", name: "Messana and the strait", formerNames: [], terrainId: "coastal-plain", settlements: [{ id: "settlement-messana", name: "Messana", kind: "port", controllerPolityId: "mamertines", size: 50, fortificationLevel: 3 }], controllerPolityId: "mamertines", controlFirmnessBps: 7_500, tier: "focus" },
    ],
    edges: [],
  },
  actions: [],
  characters: [
    { id: "gaius-genucius", name: "Gaius Genucius Clepsina", cultureId: "roman", faithId: null, dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 45, officeId: "roman-consul", personalAccountId: "gaius-purse", skills: { martial: 65, intrigue: 40, learning: 50, piety: 45, stewardship: 55, diplomacy: 60, body: 65, subSkills: {} }, traits: [], healthBps: 9_000, prestigeBps: 7_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    { id: "hanno-carthage", name: "Hanno of Carthage", cultureId: "carthaginian", faithId: null, dynastyId: null, locationProvinceId: "tun-13205935b88806172084765", polityId: "carthage", ageYearsAtStart: 48, officeId: null, personalAccountId: "hanno-purse", skills: { martial: 55, intrigue: 65, learning: 50, piety: 50, stewardship: 70, diplomacy: 65, body: 55, subSkills: {} }, traits: [], healthBps: 8_500, prestigeBps: 7_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    { id: "hieron-ii", name: "Hieron II", cultureId: "greek", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-southeast", polityId: "syracuse", ageYearsAtStart: 38, officeId: null, personalAccountId: "hieron-purse", skills: { martial: 70, intrigue: 55, learning: 60, piety: 55, stewardship: 60, diplomacy: 65, body: 65, subSkills: {} }, traits: [], healthBps: 9_000, prestigeBps: 7_500, relations: [], ambitions: [{ id: "secure-sicily", label: "Secure Syracuse against the Mamertines", kind: "peace", targetId: "mamertines", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    { id: "mamertine-spokesman", name: "Mamertine spokesman", cultureId: "italic", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-northeast", polityId: "mamertines", ageYearsAtStart: 35, officeId: null, personalAccountId: "mamertine-purse", skills: { martial: 60, intrigue: 45, learning: 35, piety: 45, stewardship: 45, diplomacy: 50, body: 70, subSkills: {} }, traits: [], healthBps: 8_500, prestigeBps: 5_500, relations: [], ambitions: [{ id: "hold-messana", label: "Hold Messana", kind: "restoration", targetId: "messana-city", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
  ],
  continuity: [], encounters: [],
  storylines: [{ id: "mamertine-syracusan-crisis", title: "The Messana Crisis", participantIds: ["hieron-ii", "mamertine-spokesman"], provinceId: "ita-72843720b81376294924159-sicily-northeast", phase: "escalating", stakes: "Syracuse seeks to contain the Mamertines without drawing Rome and Carthage into a wider war.", history: ["Hieron II's forces pressure the Mamertines around the Strait of Messana."], nextDevelopment: "Envoys may seek outside support if the local balance collapses.", visibility: "public", updatedAtStep: 0 }],
  conflicts: { battles: [], sieges: [], wars: [] },
  material: {
    currency: { id: "denarius", name: "Denarii", unitName: "denarius", unitNamePlural: "denarii", symbol: "D" },
    accounts: [
      { id: "gaius-purse", owner: { kind: "character", id: "gaius-genucius" }, currencyId: "denarius", balance: 1_200, status: "active", visibility: "private" },
      { id: "hanno-purse", owner: { kind: "character", id: "hanno-carthage" }, currencyId: "denarius", balance: 1_100, status: "active", visibility: "private" },
      { id: "hieron-purse", owner: { kind: "character", id: "hieron-ii" }, currencyId: "denarius", balance: 1_000, status: "active", visibility: "private" },
      { id: "mamertine-purse", owner: { kind: "character", id: "mamertine-spokesman" }, currencyId: "denarius", balance: 700, status: "active", visibility: "private" },
    ],
    accountAccess: [
      ["gaius", "gaius-genucius"], ["hanno", "hanno-carthage"], ["hieron", "hieron-ii"], ["mamertine", "mamertine-spokesman"],
    ].map(([id, characterId]) => ({ id: `${id}-purse-access`, characterId, accountId: `${id}-purse`, permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: characterId })),
    incomeSources: [], obligations: [], transactions: [], capturableValues: [], holdings: [], institutions: [], reservedPowers: [], motions: [], voteRecords: [],
    forces: [
      { id: "roman-field-army", name: "Roman field army", polityId: "rome", commanderCharacterId: "gaius-genucius", controllerCharacterId: "gaius-genucius", locationId: "punic-italy-latium", authorizedStrength: 4_000, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_500, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 4, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "carthaginian-garrison", name: "Carthaginian field force", polityId: "carthage", commanderCharacterId: "hanno-carthage", controllerCharacterId: "hanno-carthage", locationId: "tun-13205935b88806172084765", authorizedStrength: 3_500, personnel: [{ categoryId: "infantry", label: "Infantry", fit: 3_000, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 4, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "syracusan-army", name: "Syracusan army", polityId: "syracuse", commanderCharacterId: "hieron-ii", controllerCharacterId: "hieron-ii", locationId: "ita-72843720b81376294924159-sicily-southeast", authorizedStrength: 3_000, personnel: [{ categoryId: "infantry", label: "Hoplites", fit: 2_600, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 4, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "mamertine-garrison", name: "Mamertine garrison", polityId: "mamertines", commanderCharacterId: "mamertine-spokesman", controllerCharacterId: "mamertine-spokesman", locationId: "ita-72843720b81376294924159-sicily-northeast", authorizedStrength: 1_600, personnel: [{ categoryId: "infantry", label: "Mercenaries", fit: 1_400, unavailable: [] }], moraleBps: 7_000, cohesionBps: 7_000, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 4, payObligationId: null, payArrearsPeriods: 0, history: [] },
    ],
  },
});

export const punicWarsScenario = { definition, initialWorld } as const;
