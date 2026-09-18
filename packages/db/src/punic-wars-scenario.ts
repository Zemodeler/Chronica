import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioDefinition, type Settlement, type WorldState } from "@chronica/shared";

export const PUNIC_WARS_SCENARIO_ID = "00000000-0000-4000-8000-000000000102";
export const PUNIC_WARS_SLUG = "punic-wars";

const italianPolities = [
  ["ligurians", "Ligurian peoples"], ["insubres", "Insubres"], ["boii", "Boii"], ["cenomani", "Cenomani"], ["veneti", "Veneti"], ["etruscan-cities", "Etruscan cities"],
] as const;

// Ids and boundaries match the rendered map's own Italy partition exactly
// (apps/web/lib/punic-wars-geojson.ts's ITALY_GROUNDED_TERRITORIES, 15 real
// modern-region polygons) rather than a separately authored, finer tribal
// breakdown. A gameplay province with no matching map polygon has no
// position to render at -- see the army-vanishing and mismatched-label bugs
// this replaced. Where several old tribal provinces shared one real region
// (e.g. three Liguria provinces, Bruttium and Rhegium), they're merged into
// one gameplay province here too, keeping each region's original controller.
const italy = [
  ["punic-italy-ligurian-coast", "Liguria", "ligurians"],
  ["punic-italy-insubrian-plain", "Insubria", "insubres"],
  ["punic-italy-middle-padus", "Boii", "boii"],
  ["punic-italy-venetian-lagoon", "Veneti", "veneti"],
  ["punic-italy-etrurian-uplands", "Etruria", "rome"],
  ["punic-italy-umbrian-valleys", "Umbria", "rome"],
  ["punic-italy-picenum-coast", "Picenum", "rome"],
  ["punic-italy-latium", "Latium", "rome"],
  ["punic-italy-marsian-highlands", "Marsi and Paeligni", "rome"],
  ["punic-italy-samnium", "Samnium", "rome"],
  ["punic-italy-campanian-plain", "Campania", "rome"],
  ["punic-italy-apulian-coast", "Apulia", "rome"],
  ["punic-italy-lucanian-uplands", "Lucania", "rome"],
  ["punic-italy-bruttian-highlands", "Bruttium", "rome"],
] as const;

// The campaign state, not the rendered GeoJSON, is authoritative for a
// siege. Keep every settlement that appears on the delivered map *within a
// playable province* here as well. Otherwise a place can be visible and
// clickable to a player but impossible for start_siege to resolve.
const visibleSettlementsByProvince: Readonly<Record<string, readonly Settlement[]>> = {
  "punic-italy-ligurian-coast": [
    { id: "settlement-genua", name: "Genua", kind: "port", provinceId: "punic-italy-ligurian-coast", controllerPolityId: "ligurians", size: 45, fortificationLevel: 3 },
  ],
  "punic-italy-insubrian-plain": [
    { id: "settlement-mediolanum", name: "Mediolanum", kind: "city", provinceId: "punic-italy-insubrian-plain", controllerPolityId: "insubres", size: 55, fortificationLevel: 3 },
  ],
  "punic-italy-middle-padus": [
    { id: "settlement-bononia", name: "Felsina", kind: "town", provinceId: "punic-italy-middle-padus", controllerPolityId: "boii", size: 35, fortificationLevel: 2 },
  ],
  "punic-italy-venetian-lagoon": [
    { id: "settlement-patavium", name: "Patavium", kind: "city", provinceId: "punic-italy-venetian-lagoon", controllerPolityId: "veneti", size: 50, fortificationLevel: 2 },
  ],
  "punic-italy-etrurian-uplands": [
    { id: "settlement-volsinii", name: "Volsinii", kind: "fortress", provinceId: "punic-italy-etrurian-uplands", controllerPolityId: "rome", size: 35, fortificationLevel: 4 },
  ],
  "punic-italy-latium": [
    { id: "settlement-rome", name: "Rome", kind: "city", provinceId: "punic-italy-latium", controllerPolityId: "rome", size: 100, fortificationLevel: 6 },
  ],
  "punic-italy-samnium": [
    { id: "settlement-bovianum", name: "Bovianum", kind: "fortress", provinceId: "punic-italy-samnium", controllerPolityId: "rome", size: 25, fortificationLevel: 3 },
  ],
  "punic-italy-campanian-plain": [
    { id: "settlement-naples", name: "Naples", kind: "city", provinceId: "punic-italy-campanian-plain", controllerPolityId: "rome", size: 60, fortificationLevel: 3 },
    { id: "settlement-capua", name: "Capua", kind: "city", provinceId: "punic-italy-campanian-plain", controllerPolityId: "rome", size: 65, fortificationLevel: 4 },
  ],
  "punic-italy-apulian-coast": [
    { id: "settlement-tarentum", name: "Tarentum", kind: "port", provinceId: "punic-italy-apulian-coast", controllerPolityId: "rome", size: 60, fortificationLevel: 4 },
  ],
  "tun-13205935b88806172084765": [
    { id: "settlement-carthage", name: "Carthage", kind: "city", provinceId: "tun-13205935b88806172084765", controllerPolityId: "carthage", size: 100, fortificationLevel: 6 },
  ],
  "ita-72843720b81376294924159-sicily-west": [
    { id: "settlement-lilybaeum", name: "Lilybaeum", kind: "port", provinceId: "ita-72843720b81376294924159-sicily-west", controllerPolityId: "carthage", size: 45, fortificationLevel: 4 },
  ],
  "ita-72843720b81376294924159-sicily-northwest": [
    { id: "settlement-panormus", name: "Panormus", kind: "city", provinceId: "ita-72843720b81376294924159-sicily-northwest", controllerPolityId: "carthage", size: 55, fortificationLevel: 3 },
  ],
  "ita-72843720b81376294924159-sicily-central": [
    { id: "settlement-agrigentum-fort", name: "Fort Agrigentum", kind: "fortress", provinceId: "ita-72843720b81376294924159-sicily-central", controllerPolityId: "carthage", size: 30, fortificationLevel: 4 },
  ],
  "ita-72843720b81376294924159-sicily-southeast": [
    { id: "settlement-syracuse", name: "Syracuse", kind: "port", provinceId: "ita-72843720b81376294924159-sicily-southeast", controllerPolityId: "syracuse", size: 90, fortificationLevel: 5 },
  ],
  "ita-72843720b81376294924159-sicily-northeast": [
    { id: "settlement-messana", name: "Messana", kind: "port", provinceId: "ita-72843720b81376294924159-sicily-northeast", controllerPolityId: "mamertines", size: 50, fortificationLevel: 3 },
  ],
};

const definition: ScenarioDefinition = ScenarioDefinitionSchema.parse({
  clock: { epoch: { year: 270, month: 3, day: 1, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 },
  map: {
    terrains: [
      { id: "coastal-plain", label: "Coastal plain", allowedCrossings: ["land", "strait", "sea_lane"], water: false },
      { id: "hills", label: "Hills", allowedCrossings: ["land", "pass"], water: false },
      { id: "hills-uplands", label: "Hills and uplands", allowedCrossings: ["land", "pass"], water: false },
      { id: "mountain-pass", label: "Mountain passes", allowedCrossings: ["pass"], water: false },
      { id: "desert-steppe", label: "Desert and steppe", allowedCrossings: ["land"], water: false },
    ],
    provinceCount: { min: 19, max: 19 },
  },
  warfare: {
    troopCategories: [{ id: "infantry", label: "Infantry", combatWeightBps: 10_000, steadinessBps: 7_000, mobilityBps: 5_000 }],
    routineTactics: [{ id: "hold-ground", label: "Hold prepared ground", factor: "cohesion", phases: ["engagement"], modifierBps: 500 }],
    phases: ["contact", "engagement", "cohesion", "withdrawal", "aftermath"], routCohesionBps: 2_000, arrearsMoralePeriods: 1, arrearsDesertionPeriods: 2,
  },
  government: {
    offices: [{ id: "roman-consul", label: "Roman consul", polityId: "rome", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-election", eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-not-disqualified"] }],
    successionRules: [{ id: "roman-election", label: "Election by the Senate", kind: "elective", institutionId: "roman-senate" }], decreeAuthorityCostBps: 500, decreeMinimumPrestigeBps: 2_000,
  },
  dialogue: { roleSlots: [], namePools: { roman: ["Gaius", "Lucius"], carthaginian: ["Hanno", "Hamilcar"], greek: ["Hieron", "Sosistratus"] } },
  continuity: { startingSeatCount: 1, extraPrincipalsPerPlayer: 1 },
  knowledge: [
    { id: "mamertine-crisis", summary: "In 270 BCE Hieron II's Syracuse contests the Mamertines of Messana. Rome and Carthage remain at peace, but the strait is strategically volatile.", subjectIds: ["syracuse", "mamertines", "rome", "carthage"], provinceIds: ["ita-72843720b81376294924159-sicily-northeast", "ita-72843720b81376294924159-sicily-southeast"] },
    { id: "roman-italian-control", summary: "Rome directly controls its Italian client territories at the opening while their local regional names remain on the map.", subjectIds: ["rome"], provinceIds: ["punic-italy-latium", "punic-italy-samnium", "punic-italy-lucanian-uplands", "punic-italy-bruttian-highlands"] },
  ],
});

const initialWorld: WorldState = WorldStateSchema.parse({
  schemaVersion: 2,
  pins: { scenarioId: PUNIC_WARS_SCENARIO_ID, scenarioVersion: 16, libraryVersion: 1 },
  elapsedStep: 0,
  instant: { day: 0, minute: 0 },
  map: {
    polities: [
      { id: "rome", name: "Roman Republic", capitalSettlementId: "settlement-rome" },
      { id: "carthage", name: "Carthage", capitalSettlementId: "settlement-carthage" },
      { id: "syracuse", name: "Kingdom of Syracuse", capitalSettlementId: "settlement-syracuse" },
      { id: "mamertines", name: "Mamertines of Messana", capitalSettlementId: "settlement-messana" },
      ...italianPolities.map(([id, name]) => ({ id, name, capitalSettlementId: null })),
    ],
    politicalRelations: [],
    provinces: [
      ...italy.map(([id, name, controllerPolityId]) => ({ id, name, formerNames: [], terrainId: id === "punic-italy-latium" || id === "punic-italy-campanian-plain" ? "coastal-plain" : "hills", settlements: visibleSettlementsByProvince[id] ?? [], controllerPolityId, controlFirmnessBps: controllerPolityId === "rome" ? 9_000 : 7_000, tier: "far" as const })),
      { id: "tun-13205935b88806172084765", name: "Carthaginian heartland", formerNames: [], terrainId: "coastal-plain", settlements: visibleSettlementsByProvince["tun-13205935b88806172084765"]!, controllerPolityId: "carthage", controlFirmnessBps: 9_000, tier: "far" },
      { id: "ita-72843720b81376294924159-sicily-west", name: "Lilybaeum and western Sicily", formerNames: [], terrainId: "coastal-plain", settlements: visibleSettlementsByProvince["ita-72843720b81376294924159-sicily-west"]!, controllerPolityId: "carthage", controlFirmnessBps: 8_500, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-northwest", name: "Panormus and the north-west", formerNames: [], terrainId: "hills", settlements: visibleSettlementsByProvince["ita-72843720b81376294924159-sicily-northwest"]!, controllerPolityId: "carthage", controlFirmnessBps: 8_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-central", name: "Agrigentum and the south-west", formerNames: [], terrainId: "hills", settlements: visibleSettlementsByProvince["ita-72843720b81376294924159-sicily-central"]!, controllerPolityId: "carthage", controlFirmnessBps: 8_000, tier: "focus" },
      { id: "ita-72843720b81376294924159-sicily-southeast", name: "Syracuse and the south-east", formerNames: [], terrainId: "coastal-plain", settlements: visibleSettlementsByProvince["ita-72843720b81376294924159-sicily-southeast"]!, controllerPolityId: "syracuse", controlFirmnessBps: 8_500, tier: "focus" },
      {
        id: "ita-72843720b81376294924159-sicily-northeast",
        name: "Messana and the strait",
        formerNames: [],
        terrainId: "coastal-plain",
        settlements: visibleSettlementsByProvince["ita-72843720b81376294924159-sicily-northeast"]!,
        // Mount Etna is an operational destination inside this coarse province;
        // it is not a separate province that an army can be teleported to.
        positions: [
          { id: "position-mount-etna", provinceId: "ita-72843720b81376294924159-sicily-northeast", label: "Mount Etna", type: "pass", combatModifierBps: 700, capacity: 3 },
          { id: "position-messana-strait", provinceId: "ita-72843720b81376294924159-sicily-northeast", label: "Messana strait", type: "coast", combatModifierBps: 0, capacity: null },
        ],
        controllerPolityId: "mamertines",
        controlFirmnessBps: 7_500,
        tier: "focus",
      },
    ],
    // Real Italian geography, chained north-to-south with a Messana-strait and
    // a Carthage-Sicily crossing closing the loop to Africa. "land" is used
    // throughout, including the two water crossings, because a legal edge
    // needs its crossing type admitted by BOTH sides' terrain
    // (packages/shared/src/world/map.ts) and most of these provinces are
    // "hills" (land + pass only, no strait/sea_lane) -- this graph exists so
    // adjacency-based systems (the Reaction Director's "nearby entities who
    // might react", near/far/coarse event scoping) have something to read at
    // all, not to model precise naval logistics.
    edges: [
      ["punic-italy-ligurian-coast", "punic-italy-insubrian-plain"],
      ["punic-italy-ligurian-coast", "punic-italy-etrurian-uplands"],
      ["punic-italy-insubrian-plain", "punic-italy-middle-padus"],
      ["punic-italy-insubrian-plain", "punic-italy-venetian-lagoon"],
      ["punic-italy-middle-padus", "punic-italy-venetian-lagoon"],
      ["punic-italy-middle-padus", "punic-italy-etrurian-uplands"],
      ["punic-italy-etrurian-uplands", "punic-italy-umbrian-valleys"],
      ["punic-italy-etrurian-uplands", "punic-italy-latium"],
      ["punic-italy-umbrian-valleys", "punic-italy-picenum-coast"],
      ["punic-italy-umbrian-valleys", "punic-italy-latium"],
      ["punic-italy-umbrian-valleys", "punic-italy-marsian-highlands"],
      ["punic-italy-picenum-coast", "punic-italy-marsian-highlands"],
      ["punic-italy-latium", "punic-italy-marsian-highlands"],
      ["punic-italy-latium", "punic-italy-campanian-plain"],
      ["punic-italy-marsian-highlands", "punic-italy-samnium"],
      ["punic-italy-samnium", "punic-italy-campanian-plain"],
      ["punic-italy-samnium", "punic-italy-apulian-coast"],
      ["punic-italy-samnium", "punic-italy-lucanian-uplands"],
      ["punic-italy-campanian-plain", "punic-italy-lucanian-uplands"],
      ["punic-italy-apulian-coast", "punic-italy-lucanian-uplands"],
      ["punic-italy-lucanian-uplands", "punic-italy-bruttian-highlands"],
      ["punic-italy-bruttian-highlands", "ita-72843720b81376294924159-sicily-northeast"],
      ["tun-13205935b88806172084765", "ita-72843720b81376294924159-sicily-west"],
      ["ita-72843720b81376294924159-sicily-west", "ita-72843720b81376294924159-sicily-northwest"],
      ["ita-72843720b81376294924159-sicily-northwest", "ita-72843720b81376294924159-sicily-central"],
      ["ita-72843720b81376294924159-sicily-central", "ita-72843720b81376294924159-sicily-southeast"],
      ["ita-72843720b81376294924159-sicily-southeast", "ita-72843720b81376294924159-sicily-northeast"],
    ].map(([from, to]) => ({ from, to, crossing: "land" as const, distance: 1 })),
  },
  characters: [
    { id: "gaius-genucius", name: "Gaius Genucius Clepsina", cultureId: "roman", faithId: null, dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 45, officeId: "roman-consul", personalAccountId: "gaius-purse", skills: { martial: 65, intrigue: 40, learning: 50, piety: 45, stewardship: 55, diplomacy: 60, body: 65, subSkills: {} }, traits: ["dutiful", "disciplined"], healthBps: 9_000, prestigeBps: 7_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // Carthage is a real party watching the Messana crisis, not a passive
    // name on the map: an active goal and plot (character-sim phase 3) give
    // Hanno explicit scenario relevance from the opening turn, and the
    // pressure names why it is on his mind now rather than as flavor text.
    { id: "hanno-carthage", name: "Hanno of Carthage", cultureId: "carthaginian", faithId: null, dynastyId: null, locationProvinceId: "tun-13205935b88806172084765", polityId: "carthage", ageYearsAtStart: 48, officeId: null, personalAccountId: "hanno-purse", skills: { martial: 55, intrigue: 65, learning: 50, piety: 50, stewardship: 70, diplomacy: 65, body: 55, subSkills: {} }, traits: ["ambitious", "deceitful"], mind: { drives: { security: 55, status: 65, wealth: 60, family: 40, faith: 35, duty: 45, revenge: 30 }, temperament: { boldness: 55, caution: 50, honesty: 35, sociability: 55, discipline: 45, cruelty: 40 }, riskTolerance: 55, values: [], taboos: [], currentPressures: ["hanno-pressure-messana"] }, healthBps: 8_500, prestigeBps: 7_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // A cautious, status-conscious ruler measuring every move against the Mamertine threat -- an authored
    // mind and relationship state (character-sim phase 2), demonstrating the fields without hardcoding
    // engine behavior to them: the simulation still reads Hieron II through the same canonical schema
    // every other character uses.
    { id: "hieron-ii", name: "Hieron II", cultureId: "greek", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-southeast", polityId: "syracuse", ageYearsAtStart: 38, officeId: null, personalAccountId: "hieron-purse", skills: { martial: 70, intrigue: 55, learning: 60, piety: 55, stewardship: 60, diplomacy: 65, body: 65, subSkills: {} }, traits: ["cautious", "dutiful"], mind: { drives: { security: 65, status: 70, wealth: 50, family: 50, faith: 45, duty: 70, revenge: 30 }, temperament: { boldness: 35, caution: 75, honesty: 55, sociability: 55, discipline: 65, cruelty: 30 }, riskTolerance: 30, values: ["dutiful"], taboos: ["deceitful"], currentPressures: ["mamertine-pressure-hieron"] }, healthBps: 9_000, prestigeBps: 7_500, relations: [{ subjectCharacterId: "mamertine-spokesman", causes: [{ id: "hieron-mamertine-rivalry", label: "The Mamertines seized Messana from Syracuse by treachery.", score: -18, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -25, fear: 10, respect: -5 } }] }], ambitions: [{ id: "secure-sicily", label: "Secure Syracuse against the Mamertines", kind: "peace", targetId: "mamertines", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // A bold, embattled spokesman under active military pressure -- distinct temperament and drives
    // from Hieron II despite a similar martial skill, so their dialogue and any future decisions read
    // as different people under different pressure, not palette-swapped stat blocks.
    { id: "mamertine-spokesman", name: "Mamertine spokesman", cultureId: "italic", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-northeast", polityId: "mamertines", ageYearsAtStart: 35, officeId: null, personalAccountId: "mamertine-purse", skills: { martial: 60, intrigue: 45, learning: 35, piety: 45, stewardship: 45, diplomacy: 50, body: 70, subSkills: {} }, traits: ["bold", "vengeful"], mind: { drives: { security: 70, status: 45, wealth: 40, family: 55, faith: 40, duty: 55, revenge: 55 }, temperament: { boldness: 70, caution: 30, honesty: 50, sociability: 45, discipline: 40, cruelty: 45 }, riskTolerance: 70, values: [], taboos: [], currentPressures: ["mamertine-pressure-spokesman"] }, healthBps: 8_500, prestigeBps: 5_500, relations: [{ subjectCharacterId: "hieron-ii", causes: [{ id: "mamertine-hieron-fear", label: "Syracusan forces press their border at Messana.", score: -12, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { fear: 30, trust: -10 } }] }], ambitions: [{ id: "hold-messana", label: "Hold Messana", kind: "restoration", targetId: "settlement-messana", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // The men who actually held Rome, Syracuse and Carthage in 270 BCE, so the
    // opening world is a political situation rather than one consul and three
    // placeholders. Each is here because the year gives them something to be
    // doing: Dentatus has an aqueduct half-built and the standing of a man who
    // beat Pyrrhus, Ogulnius has the coinage question, Vibellius is holding
    // Rhegium against the Republic that means to take it back. Ages are at the
    // scenario's opening; where a man's exact role in 270 is not recorded, his
    // attested career in the decade around it is what he is given.
    { id: "manius-curius", name: "Manius Curius Dentatus", cultureId: "roman", faithId: null, dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 60, officeId: null, personalAccountId: "curius-purse", skills: { martial: 80, intrigue: 35, learning: 50, piety: 65, stewardship: 70, diplomacy: 55, body: 55, subSkills: {} }, traits: ["dutiful", "disciplined"], mind: { drives: { security: 50, status: 45, wealth: 20, family: 40, faith: 60, duty: 85, revenge: 20 }, temperament: { boldness: 55, caution: 55, honesty: 80, sociability: 45, discipline: 80, cruelty: 25 }, riskTolerance: 40, values: ["dutiful"], taboos: ["deceitful"], currentPressures: [] }, healthBps: 6_500, prestigeBps: 9_500, relations: [], ambitions: [{ id: "finish-the-anio", label: "See the Anio water brought into Rome", kind: "restoration", targetId: "settlement-rome", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    { id: "quintus-ogulnius", name: "Quintus Ogulnius Gallus", cultureId: "roman", faithId: null, dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 47, officeId: null, personalAccountId: "ogulnius-purse", skills: { martial: 45, intrigue: 55, learning: 70, piety: 70, stewardship: 75, diplomacy: 70, body: 50, subSkills: {} }, traits: ["ambitious", "methodical"], mind: { drives: { security: 45, status: 70, wealth: 55, family: 50, faith: 60, duty: 65, revenge: 25 }, temperament: { boldness: 45, caution: 65, honesty: 60, sociability: 70, discipline: 70, cruelty: 25 }, riskTolerance: 40, values: [], taboos: [], currentPressures: ["ogulnius-pressure-coinage"] }, healthBps: 8_500, prestigeBps: 7_000, relations: [], ambitions: [{ id: "roman-silver", label: "Put Rome's own silver into the hands of its allies", kind: "wealth", targetId: "rome", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Rome's other war of 270, and the one its own historians were least proud
    // of: a Campanian legion sent to garrison Rhegium killed the citizens and
    // kept the city. Vibellius holds it still, and the Republic means to end it.
    { id: "decius-vibellius", name: "Decius Vibellius", cultureId: "italic", faithId: null, dynastyId: null, locationProvinceId: "punic-italy-bruttian-highlands", polityId: "rome", ageYearsAtStart: 41, officeId: null, personalAccountId: "vibellius-purse", skills: { martial: 65, intrigue: 60, learning: 30, piety: 30, stewardship: 40, diplomacy: 35, body: 65, subSkills: {} }, traits: ["bold", "vengeful"], mind: { drives: { security: 80, status: 55, wealth: 65, family: 35, faith: 25, duty: 20, revenge: 50 }, temperament: { boldness: 75, caution: 35, honesty: 25, sociability: 40, discipline: 35, cruelty: 70 }, riskTolerance: 75, values: [], taboos: [], currentPressures: ["vibellius-pressure-siege"] }, healthBps: 8_000, prestigeBps: 3_000, relations: [], ambitions: [{ id: "keep-rhegium", label: "Keep Rhegium and his men's necks", kind: "restoration", targetId: "punic-italy-bruttian-highlands", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Syracuse is a court, not one king: Leptines is the aristocrat whose
    // daughter Hieron married, and the reason the city accepted him at all.
    { id: "leptines-syracuse", name: "Leptines of Syracuse", cultureId: "greek", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-southeast", polityId: "syracuse", ageYearsAtStart: 58, officeId: null, personalAccountId: "leptines-purse", skills: { martial: 50, intrigue: 60, learning: 65, piety: 55, stewardship: 70, diplomacy: 75, body: 45, subSkills: {} }, traits: ["cautious", "methodical"], mind: { drives: { security: 70, status: 60, wealth: 55, family: 75, faith: 45, duty: 60, revenge: 20 }, temperament: { boldness: 35, caution: 75, honesty: 60, sociability: 70, discipline: 65, cruelty: 20 }, riskTolerance: 30, values: [], taboos: [], currentPressures: [] }, healthBps: 7_500, prestigeBps: 7_000, relations: [{ subjectCharacterId: "hieron-ii", causes: [{ id: "leptines-hieron-kin", label: "Hieron married his daughter, and rules with his house behind him.", score: 35, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: 40, affection: 30, respect: 35 } }] }], ambitions: [{ id: "keep-the-house", label: "Keep his house at the centre of Syracuse", kind: "office", targetId: "syracuse", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Carthage fights its wars through admirals, and Hannibal Gisco commanded
    // its fleets in the war that followed. In 270 he is the officer watching
    // the strait for the men who will have to decide about it.
    { id: "hannibal-gisco", name: "Hannibal Gisco", cultureId: "carthaginian", faithId: null, dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-west", polityId: "carthage", ageYearsAtStart: 39, officeId: null, personalAccountId: "gisco-purse", skills: { martial: 70, intrigue: 45, learning: 50, piety: 45, stewardship: 55, diplomacy: 45, body: 60, subSkills: {} }, traits: ["bold", "disciplined"], mind: { drives: { security: 60, status: 60, wealth: 45, family: 45, faith: 40, duty: 70, revenge: 30 }, temperament: { boldness: 70, caution: 45, honesty: 55, sociability: 45, discipline: 70, cruelty: 40 }, riskTolerance: 60, values: [], taboos: [], currentPressures: ["gisco-pressure-strait"] }, healthBps: 9_000, prestigeBps: 6_000, relations: [], ambitions: [{ id: "hold-the-strait", label: "Keep the strait open to Carthage and shut to anyone else", kind: "other", targetId: "ita-72843720b81376294924159-sicily-northeast", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
  ],
  continuity: [], encounters: [],
  // Carthage is named as a participant, not merely adjacent to the crisis: it
  // has its own stake in whether Messana falls to Syracuse or holds.
  storylines: [{ id: "rhegium-recovery", title: "Rhegium and the Campanian Legion", participantIds: ["gaius-genucius", "decius-vibellius", "manius-curius"], provinceId: "punic-italy-bruttian-highlands", phase: "escalating", stakes: "Rome must retake a city its own garrison murdered and kept, in front of every ally watching how the Republic treats a broken oath.", history: ["The Campanian legion sent to hold Rhegium killed its citizens and took the city for itself.", "The Senate has resolved that the matter be ended."], nextDevelopment: "The consular army turns south, or the Senate finds someone else to send.", visibility: "public", updatedAtStep: 0 }, { id: "mamertine-syracusan-crisis", title: "The Messana Crisis", participantIds: ["hieron-ii", "mamertine-spokesman", "hanno-carthage"], provinceId: "ita-72843720b81376294924159-sicily-northeast", phase: "escalating", stakes: "Syracuse seeks to contain the Mamertines without drawing Rome and Carthage into a wider war.", history: ["Hieron II's forces pressure the Mamertines around the Strait of Messana.", "Carthage watches the strait for any opening or threat to its own position in Sicily."], nextDevelopment: "Envoys may seek outside support if the local balance collapses.", visibility: "public", updatedAtStep: 0 }],
  conflicts: { battles: [], sieges: [], wars: [] },
  // What each power privately means to do. Secret by design -- nobody inside
  // the world reads another's -- and the reason anyone away from the player's
  // business has something to pursue at all.
  polityOutlooks: [
    { polityId: "rome", primaryObjective: "Finish the settlement of Italy on Rome's terms, and be seen to keep faith while doing it.", concerns: [{ label: "Rhegium still held by the Campanian legion", level: "high" }, { label: "the Gallic peoples of the Padus", level: "medium" }, { label: "Carthage's fleets in the western sea", level: "low" }], intentions: ["recover Rhegium and make an example of its garrison", "keep the Greek cities of the south quiet by protecting them", "avoid any quarrel across the strait before Italy is settled"], riskTolerance: 55, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "carthage", primaryObjective: "Keep western Sicily and the sea lanes to it, without a war against Rome.", concerns: [{ label: "Syracuse growing strong at Messana", level: "high" }, { label: "Roman power reaching the strait", level: "medium" }, { label: "the cost of mercenaries", level: "medium" }], intentions: ["watch the strait and answer whoever moves first", "hold Lilybaeum, Panormus and Agrigentum whatever happens east of them", "buy friends among the Sicilian cities rather than garrison them"], riskTolerance: 45, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "syracuse", primaryObjective: "Master all Greek Sicily, beginning with the Mamertines at Messana.", concerns: [{ label: "the Mamertines raiding Syracusan territory", level: "high" }, { label: "Carthage intervening if Messana falls", level: "high" }, { label: "Rome taking an interest in Sicily", level: "medium" }], intentions: ["press the Mamertines hard enough to take Messana", "keep Carthage neutral while it is done", "give Rome no reason to cross"], riskTolerance: 40, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "mamertines", primaryObjective: "Hold Messana, by whoever's help can be got.", concerns: [{ label: "the Syracusan army at the border", level: "high" }, { label: "no ally of their own", level: "high" }], intentions: ["seek a protector before Syracuse closes on the city", "raid for what the city needs while the roads are open"], riskTolerance: 75, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "boii", primaryObjective: "Keep the Padus plain out of Roman hands.", concerns: [{ label: "Roman colonies creeping north", level: "high" }, { label: "quarrels with the Insubres", level: "low" }], intentions: ["watch the passes into Etruria", "make common cause with the Insubres and Ligurians if Rome marches"], riskTolerance: 60, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
  ],
  characterPressures: [
    { id: "mamertine-pressure-hieron", characterId: "hieron-ii", kind: "political_danger", intensity: 55, label: "The Mamertine crisis threatens to draw in Rome or Carthage.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 730, expiresAtStep: null, visibility: "polity" },
    { id: "mamertine-pressure-spokesman", characterId: "mamertine-spokesman", kind: "military_emergency", intensity: 70, label: "Syracusan forces threaten Messana directly.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 545, expiresAtStep: null, visibility: "public" },
    { id: "hanno-pressure-messana", characterId: "hanno-carthage", kind: "political_danger", intensity: 45, label: "Syracuse's move against Messana could reshape the strategic balance across the strait before Carthage has answered it.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 730, expiresAtStep: null, visibility: "polity" },
    { id: "ogulnius-pressure-coinage", characterId: "quintus-ogulnius", kind: "political_danger", intensity: 35, label: "Rome pays its allies in bronze and borrowed coin while Greek cities pay in silver.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 365, expiresAtStep: null, visibility: "polity" },
    { id: "vibellius-pressure-siege", characterId: "decius-vibellius", kind: "military_emergency", intensity: 80, label: "Rome has not forgiven Rhegium, and the legions are coming south for it.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 180, expiresAtStep: null, visibility: "public" },
    { id: "gisco-pressure-strait", characterId: "hannibal-gisco", kind: "political_danger", intensity: 50, label: "Whoever holds Messana holds the crossing, and Carthage holds neither.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 365, expiresAtStep: null, visibility: "polity" },
  ].map((pressure) => ({ ...pressure, status: "active" })),
  socialLinks: [
    { id: "hieron-mamertine-rivals", subjectCharacterId: "hieron-ii", targetCharacterId: "mamertine-spokesman", kind: "rival", sourceEventId: null, createdAtStep: 0, visibility: "public" },
  ],
  characterBeliefs: [
    { id: "hieron-suspects-rome", holderCharacterId: "hieron-ii", subjectEntityId: "rome", claim: "Rome may intervene at Messana if the crisis escalates further.", kind: "suspicion", sourceCharacterId: null, sourceEventId: null, confidence: 55, visibility: "private", learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [] },
    { id: "hanno-suspects-rome-watching", holderCharacterId: "hanno-carthage", subjectEntityId: "rome", claim: "Rome is watching the strait as closely as Carthage is, and would not welcome a unilateral Carthaginian move on Messana.", kind: "suspicion", sourceCharacterId: null, sourceEventId: null, confidence: 50, visibility: "private", learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [] },
  ].map((belief) => ({ ...belief, status: "active" })),
  material: {
    currency: { id: "denarius", name: "Denarii", unitName: "denarius", unitNamePlural: "denarii", symbol: "D" },
    accounts: [
      { id: "gaius-purse", owner: { kind: "character", id: "gaius-genucius" }, currencyId: "denarius", balance: 1_200, status: "active", visibility: "private" },
      { id: "hanno-purse", owner: { kind: "character", id: "hanno-carthage" }, currencyId: "denarius", balance: 1_100, status: "active", visibility: "private" },
      { id: "hieron-purse", owner: { kind: "character", id: "hieron-ii" }, currencyId: "denarius", balance: 1_000, status: "active", visibility: "private" },
      { id: "mamertine-purse", owner: { kind: "character", id: "mamertine-spokesman" }, currencyId: "denarius", balance: 700, status: "active", visibility: "private" },
      { id: "curius-purse", owner: { kind: "character", id: "manius-curius" }, currencyId: "denarius", balance: 900, status: "active", visibility: "private" },
      { id: "ogulnius-purse", owner: { kind: "character", id: "quintus-ogulnius" }, currencyId: "denarius", balance: 1_300, status: "active", visibility: "private" },
      { id: "vibellius-purse", owner: { kind: "character", id: "decius-vibellius" }, currencyId: "denarius", balance: 600, status: "active", visibility: "private" },
      { id: "leptines-purse", owner: { kind: "character", id: "leptines-syracuse" }, currencyId: "denarius", balance: 1_400, status: "active", visibility: "private" },
      { id: "gisco-purse", owner: { kind: "character", id: "hannibal-gisco" }, currencyId: "denarius", balance: 950, status: "active", visibility: "private" },
    ],
    accountAccess: [
      ["gaius", "gaius-genucius"], ["hanno", "hanno-carthage"], ["hieron", "hieron-ii"], ["mamertine", "mamertine-spokesman"],
      ["curius", "manius-curius"], ["ogulnius", "quintus-ogulnius"], ["vibellius", "decius-vibellius"], ["leptines", "leptines-syracuse"], ["gisco", "hannibal-gisco"],
    ].map(([id, characterId]) => ({ id: `${id}-purse-access`, characterId, accountId: `${id}-purse`, permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: characterId })),
    incomeSources: [], obligations: [], transactions: [], capturableValues: [], holdings: [],
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
    reservedPowers: [], motions: [], voteRecords: [],
    eligibilityRequirements: [
      { id: "req-alive", kind: "alive", label: "Must be alive", params: {} },
      { id: "req-roman-polity", kind: "polity_membership", label: "Must belong to Rome", params: { polityId: "rome" } },
      { id: "req-not-disqualified", kind: "not_disqualified", label: "Must carry no disqualifying status", params: {} },
    ],
    officeSeats: [
      { id: "roman-consul:seat:0", officeId: "roman-consul", seatIndex: 0, holderCharacterId: "gaius-genucius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-not-disqualified"] },
      // Rome elected two consuls a year, and the scenario only ever seated
      // one. The empty chair matters mechanically: a player who declares
      // themselves consul has nowhere to sit if the college is modelled as a
      // single seat, and starts the game holding no office at all.
      { id: "roman-consul:seat:1", officeId: "roman-consul", seatIndex: 1, holderCharacterId: null, status: "vacant", vacancyCause: "never_filled", termStartedAtStep: null, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-not-disqualified"] },
    ],
    forces: [
      { id: "roman-field-army", name: "Roman field army", polityId: "rome", commanderCharacterId: "gaius-genucius", controllerCharacterId: "gaius-genucius", locationId: "punic-italy-latium", authorizedStrength: 4_000, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_500, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "carthaginian-garrison", name: "Carthaginian field force", polityId: "carthage", commanderCharacterId: "hanno-carthage", controllerCharacterId: "hanno-carthage", locationId: "tun-13205935b88806172084765", authorizedStrength: 3_500, personnel: [{ categoryId: "infantry", label: "Infantry", fit: 3_000, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "syracusan-army", name: "Syracusan army", polityId: "syracuse", commanderCharacterId: "hieron-ii", controllerCharacterId: "hieron-ii", locationId: "ita-72843720b81376294924159-sicily-southeast", authorizedStrength: 3_000, personnel: [{ categoryId: "infantry", label: "Hoplites", fit: 2_600, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "mamertine-garrison", name: "Mamertine garrison", polityId: "mamertines", commanderCharacterId: "mamertine-spokesman", controllerCharacterId: "mamertine-spokesman", locationId: "ita-72843720b81376294924159-sicily-northeast", authorizedStrength: 1_600, personnel: [{ categoryId: "infantry", label: "Mercenaries", fit: 1_400, unavailable: [] }], moraleBps: 7_000, cohesionBps: 7_000, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
    ],
  },
});

export const punicWarsScenario = { definition, initialWorld } as const;
