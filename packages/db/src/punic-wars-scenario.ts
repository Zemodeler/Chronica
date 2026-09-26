import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioDefinition, type Settlement, type WorldState } from "@chronica/shared";
import { PUNIC_WARS_GRAPH_EDGES, PUNIC_WARS_GRAPH_POLITIES, PUNIC_WARS_GRAPH_PROVINCES, PUNIC_WARS_GRAPH_SETTLEMENTS } from "./punic-wars-map-graph";

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
  "punic-italy-bruttian-highlands": [
    { id: "settlement-rhegium", name: "Rhegium", kind: "port", provinceId: "punic-italy-bruttian-highlands", controllerPolityId: "rhegium-campanians", size: 40, fortificationLevel: 3 },
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

/**
 * The offices of 270 BCE, and a ladder to climb them (scenario v28).
 *
 * The scenario had four offices in the whole world, so every station below a
 * head of state -- a senator, a praetor, a priest, a council elder -- was
 * somebody with no office at all, weighed against his whole power's authority
 * for speaking in a debate. What follows is each power's real government, as
 * far as the period allows it to be known.
 *
 * Rome's ages and order are custom rather than law in 270 (the lex Villia is
 * ninety years off); the ten-year gap before a second consulship is the lex
 * Genucia's, and is law. A passed law or a dictator can set any of it aside.
 */
const CIVIL = ["social_events", "belief_set", "character_intent_set", "political_procedure_open", "political_support_set"];
const MAGISTRATE = [...CIVIL, "project_create", "project_milestone_update", "generic_entity_create", "generic_entity_update", "province_material_shift", "legitimacy_shift"];
const IMPERIUM = [...MAGISTRATE, "force_create", "force_modify", "force_engage", "political_procedure_resolve", "authority_grant_upsert", "character_create", "polity_stance_shift"];
const RULER = [...IMPERIUM];

// Free-born and male, the Vestals apart: what the law asks of anybody who holds anything.
const romanReqs = ["req-alive", "req-roman-polity", "req-not-disqualified", "req-free-born", "req-male"];
const office = (fields: Record<string, unknown>) => ({
  sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, ...fields,
});

const ladderRequirements = [
  ...[25, 30, 35, 38].map((years) => ({ id: `req-age-${years}`, kind: "min_age", label: `At least ${years} years old`, params: { years } })),
  ...[3_000, 4_000, 5_000, 6_000, 7_500].map((minPrestigeBps) => ({ id: `req-standing-${minPrestigeBps}`, kind: "min_prestige", label: `Of standing at least ${minPrestigeBps}`, params: { minPrestigeBps } })),
  ...(["quaestor", "praetor", "consul"] as const).map((rung) => ({ id: `req-held-${rung}`, kind: "held_office", label: `Has been ${rung}`, params: { officeId: `roman-${rung}` } })),
  { id: "req-free-born", kind: "legal_status", label: "Born free", params: { statuses: ["free"] } },
  { id: "req-not-enslaved", kind: "legal_status", label: "Not a slave", params: { statuses: ["free", "freed"] } },
  { id: "req-male", kind: "gender", label: "A man", params: { gender: "male" } },
  { id: "req-female", kind: "gender", label: "A woman", params: { gender: "female" } },
  { id: "req-gap-consul-10", kind: "not_held_within_years", label: "Not consul within ten years (lex Genucia)", params: { officeId: "roman-consul", years: 10 } },
  { id: "req-carthage-polity", kind: "polity_membership", label: "Must belong to Carthage", params: { polityId: "carthage" } },
  { id: "req-syracuse-polity", kind: "polity_membership", label: "Must belong to Syracuse", params: { polityId: "syracuse" } },
  { id: "req-mamertine-polity", kind: "polity_membership", label: "Must belong to the Mamertines", params: { polityId: "mamertines" } },
  { id: "req-campanian-polity", kind: "polity_membership", label: "Must belong to the Campanians of Rhegium", params: { polityId: "rhegium-campanians" } },
];

const romanOffices = [
  office({ id: "roman-quaestor", label: "Roman quaestor", polityId: "rome", kind: "magistracy", rank: 1, seatCount: 4, termDays: 365, authorisedActionIds: MAGISTRATE, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election", eligibilityRequirementIds: [...romanReqs, "req-age-25", "req-standing-3000"] }),
  office({ id: "roman-tribune", label: "Tribune of the plebs", polityId: "rome", kind: "magistracy", rank: 1, seatCount: 10, termDays: 365, vetoes: true, authorisedActionIds: CIVIL, successionRuleId: "roman-election", eligibilityRequirementIds: [...romanReqs, "req-age-25", "req-standing-3000"] }),
  office({ id: "roman-aedile", label: "Roman aedile", polityId: "rome", kind: "magistracy", rank: 2, seatCount: 4, termDays: 365, authorisedActionIds: MAGISTRATE, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election", eligibilityRequirementIds: [...romanReqs, "req-age-30", "req-standing-4000", "req-held-quaestor"] }),
  office({ id: "roman-praetor", label: "Roman praetor", polityId: "rome", kind: "magistracy", rank: 3, seatCount: 1, termDays: 365, authorisedActionIds: IMPERIUM, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election", eligibilityRequirementIds: [...romanReqs, "req-age-35", "req-standing-5000", "req-held-quaestor"] }),
  office({ id: "roman-censor", label: "Roman censor", polityId: "rome", kind: "magistracy", rank: 5, seatCount: 2, termDays: 548, cycleDays: 1_826, authorisedActionIds: MAGISTRATE, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election", eligibilityRequirementIds: [...romanReqs, "req-standing-7500", "req-held-consul"] }),
  // Named by a consul on the Senate's word, for six months, over everyone.
  office({ id: "roman-dictator", label: "Roman dictator", polityId: "rome", kind: "magistracy", rank: 6, termDays: 182, authorisedActionIds: RULER, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], successionRuleId: "roman-dictatorship", eligibilityRequirementIds: [...romanReqs, "req-held-consul"] }),
  office({ id: "roman-senator", label: "Roman senator", polityId: "rome", kind: "membership", seatCount: 300, enrolsFormerMagistrates: true, authorisedActionIds: CIVIL, successionRuleId: "roman-enrolment", eligibilityRequirementIds: romanReqs }),
  office({ id: "roman-pontifex-maximus", label: "Pontifex maximus", polityId: "rome", kind: "priesthood", authorisedActionIds: CIVIL, successionRuleId: "roman-cooptation", eligibilityRequirementIds: romanReqs }),
  office({ id: "roman-pontiff", label: "Roman pontiff", polityId: "rome", kind: "priesthood", seatCount: 9, authorisedActionIds: CIVIL, successionRuleId: "roman-cooptation", eligibilityRequirementIds: romanReqs }),
  // An augur who saw bad omens could stop an assembly meeting that day.
  office({ id: "roman-augur", label: "Roman augur", polityId: "rome", kind: "priesthood", seatCount: 9, vetoes: true, authorisedActionIds: CIVIL, successionRuleId: "roman-cooptation", eligibilityRequirementIds: romanReqs }),
  office({ id: "roman-vestal", label: "Vestal", polityId: "rome", kind: "priesthood", seatCount: 6, authorisedActionIds: ["social_events", "belief_set", "character_intent_set"], successionRuleId: "roman-vestal-choice", eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-not-disqualified", "req-free-born", "req-female"] }),
];

const carthaginianReqs = ["req-alive", "req-carthage-polity", "req-not-disqualified", "req-free-born", "req-male"];
const otherPowersOffices = [
  // Two suffetes a year, elected by the citizens: Carthage's consuls.
  office({ id: "carthaginian-suffete", label: "Carthaginian suffete", polityId: "carthage", kind: "magistracy", rank: 2, seatCount: 2, termDays: 365, authorisedActionIds: IMPERIUM, treasuryAccountId: "carthage-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "carthaginian-election", eligibilityRequirementIds: [...carthaginianReqs, "req-standing-6000"] }),
  office({ id: "carthaginian-elder", label: "Carthaginian elder", polityId: "carthage", kind: "membership", seatCount: 30, enrolsFormerMagistrates: true, authorisedActionIds: CIVIL, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: carthaginianReqs }),
  // The court that judged generals, drawn from the council.
  office({ id: "carthaginian-judge", label: "Judge of the Hundred and Four", polityId: "carthage", kind: "membership", seatCount: 104, authorisedActionIds: CIVIL, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: carthaginianReqs }),
  office({ id: "carthaginian-priest", label: "Priest of Baal Hammon", polityId: "carthage", kind: "priesthood", seatCount: 10, authorisedActionIds: CIVIL, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: carthaginianReqs }),
  office({ id: "syracusan-friend", label: "Friend of the King of Syracuse", polityId: "syracuse", kind: "membership", seatCount: 20, authorisedActionIds: CIVIL, successionRuleId: "syracusan-appointment", eligibilityRequirementIds: ["req-alive", "req-syracuse-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "syracusan-strategos", label: "Syracusan strategos", polityId: "syracuse", kind: "magistracy", rank: 1, seatCount: 3, authorisedActionIds: IMPERIUM, successionRuleId: "syracusan-appointment", eligibilityRequirementIds: ["req-alive", "req-syracuse-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  // The eponymous priest the year was named by.
  office({ id: "syracusan-amphipolos", label: "Priest of Olympian Zeus", polityId: "syracuse", kind: "priesthood", seatCount: 1, termDays: 365, authorisedActionIds: CIVIL, successionRuleId: "syracusan-lot", eligibilityRequirementIds: ["req-alive", "req-syracuse-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "mamertine-councillor", label: "Mamertine councillor", polityId: "mamertines", kind: "membership", seatCount: 20, authorisedActionIds: CIVIL, successionRuleId: "mamertine-acclamation", eligibilityRequirementIds: ["req-alive", "req-mamertine-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "campanian-leader", label: "Leader of the Campanians at Rhegium", polityId: "rhegium-campanians", kind: "magistracy", rank: 1, authorisedActionIds: RULER, successionRuleId: "mamertine-acclamation", eligibilityRequirementIds: ["req-alive", "req-campanian-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "campanian-councillor", label: "Campanian councillor", polityId: "rhegium-campanians", kind: "membership", seatCount: 20, authorisedActionIds: CIVIL, successionRuleId: "mamertine-acclamation", eligibilityRequirementIds: ["req-alive", "req-campanian-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
];

/**
 * Everybody else on the map: a ruler, a council, a priesthood each. Crude --
 * a Greek league is not a Gaulish tribe -- but without it a player who is a
 * chieftain of the Boii or a councillor of Epirus has no office to hold.
 */
const templatePolities: readonly (readonly [string, string])[] = [
  ...italianPolities,
  ...PUNIC_WARS_GRAPH_POLITIES.filter((polity) => !["rome", "carthage", "syracuse", "mamertines", "rhegium-campanians", ...italianPolities.map(([id]) => id)].includes(polity.polityId)).map((polity) => [polity.polityId, polity.name] as const),
];
const templateRequirements = templatePolities.map(([id, name]) => ({ id: `req-${id}-polity`, kind: "polity_membership", label: `Must belong to ${name}`.slice(0, 160), params: { polityId: id } }));
const templateOffices = templatePolities.flatMap(([id, name]) => {
  const reqs = ["req-alive", `req-${id}-polity`, "req-not-disqualified", "req-not-enslaved"];
  return [
    office({ id: `${id}-ruler`, label: `Ruler of the ${name}`.slice(0, 120), polityId: id, kind: "magistracy", rank: 1, authorisedActionIds: RULER, successionRuleId: "template-succession", eligibilityRequirementIds: reqs }),
    office({ id: `${id}-councillor`, label: `Councillor of the ${name}`.slice(0, 120), polityId: id, kind: "membership", seatCount: 30, authorisedActionIds: CIVIL, successionRuleId: "template-appointment", eligibilityRequirementIds: reqs }),
    office({ id: `${id}-priest`, label: `Priest of the ${name}`.slice(0, 120), polityId: id, kind: "priesthood", seatCount: 5, authorisedActionIds: CIVIL, successionRuleId: "template-appointment", eligibilityRequirementIds: reqs }),
  ];
});


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
    provinceCount: { min: 779, max: 779 },
  },
  /**
   * What a Roman of a given standing is worth, in the units this scenario's
   * treasuries are kept in.
   *
   * The census classes are the frame: the Senate's own property qualification
   * sat an order of magnitude above the equestrian one, which sat an order
   * above the assidui who could afford their own arms, which sat above the
   * capite censi who could not. The numbers here are those ratios in the
   * scenario's own money rather than in asses, because what a sum means is a
   * property of this economy and nothing the engine could work out.
   */
  wealth: {
    bands: [
      { id: "capite-censi", label: "counted by his head and nothing else", min: 0, max: 40,
        words: ["poor", "capite", "censi", "proletarian", "labourer", "laborer", "peasant", "slave", "freedman", "servant", "shepherd", "rower", "sailor"] },
      { id: "assidui", label: "a man who can arm himself", min: 10, max: 150,
        words: ["soldier", "legionary", "ranker", "assidui", "smallholder", "farmer", "artisan", "craftsman", "smith", "veteran"] },
      { id: "citizen", label: "a household of some standing", min: 60, max: 600,
        words: ["citizen", "plebeian", "plebian", "commoner", "centurion", "shopkeeper", "trader", "scribe", "clerk", "priest", "physician", "teacher"] },
      { id: "equestrian", label: "money enough to be courted for it", min: 400, max: 5_000,
        words: ["merchant", "shipowner", "equestrian", "equites", "eques", "knight", "landowner", "banker", "financier", "publican", "officer", "tribune", "decurion", "magistrate"] },
      { id: "senatorial", label: "a fortune that is itself a kind of office", min: 2_500, max: 60_000,
        words: ["patrician", "senatorial", "senator", "aristocracy", "aristocrat", "noble", "nobility", "consul", "praetor", "king", "queen", "prince", "royal", "dynast", "tyrant", "suffete"] },
    ],
    defaultBandId: "citizen",
  },
  /**
   * How long people live in the third century BCE, and what shortens it.
   *
   * The rates are per year in basis points and are for adults who survived
   * childhood -- which every named person in this scenario has. Roman
   * epigraphic and skeletal evidence gives an adult male of twenty-five
   * something like a 1 to 1.5 percent chance of dying in the next year, rising
   * steeply from the mid-fifties; a consul of sixty-five is on borrowed time
   * and knew it. The engine multiplies all of this by what a person actually
   * exposes themselves to (`mortality.ts`), so a general in a camp in a plague
   * province is several times a senator at home, which is the historical
   * pattern and not a penalty for playing boldly.
   *
   * Reviewed every thirty days, staggered across the cast by id, because a
   * world that holds one great review a year for everybody at once produces
   * years in which nobody dies and years in which half the Senate does.
   */
  life: {
    lifeStages: [
      { id: "childhood", label: "childhood", minAgeYears: 0, maxAgeYears: 14, mortalityRatePerYearBps: 200, incapacityRatePerYearBps: 20, recoveryRatePerYearBps: 5_000 },
      { id: "young", label: "youth", minAgeYears: 15, maxAgeYears: 29, mortalityRatePerYearBps: 120, incapacityRatePerYearBps: 60, recoveryRatePerYearBps: 5_000 },
      { id: "prime", label: "prime", minAgeYears: 30, maxAgeYears: 44, mortalityRatePerYearBps: 180, incapacityRatePerYearBps: 90, recoveryRatePerYearBps: 4_000 },
      { id: "late", label: "later years", minAgeYears: 45, maxAgeYears: 54, mortalityRatePerYearBps: 330, incapacityRatePerYearBps: 160, recoveryRatePerYearBps: 3_000 },
      { id: "elder", label: "old age", minAgeYears: 55, maxAgeYears: 64, mortalityRatePerYearBps: 700, incapacityRatePerYearBps: 320, recoveryRatePerYearBps: 2_000 },
      { id: "great-age", label: "great age", minAgeYears: 65, maxAgeYears: null, mortalityRatePerYearBps: 1_400, incapacityRatePerYearBps: 600, recoveryRatePerYearBps: 1_200 },
    ],
    inheritanceRules: [
      { id: "roman-household", kind: "primogeniture", institutionId: null, debtsTransfer: true },
    ],
    reviewIntervalSteps: 30,
  },
  // What this age was pulling toward, each offered only while the world still
  // looks like the condition it names -- and each offered once. None of these
  // is an event: nothing here makes Mylae or the mercenary war happen. They
  // make them *reachable*, so a Mediterranean that goes the way this one went
  // is one likely outcome among several rather than a rail the player rides.
  //
  // Every condition is checked against the live world. If Carthage never fights
  // a long war, its mercenaries are never owed years of arrears and the mutiny
  // that nearly destroyed it simply never becomes available.
  historicalPressures: [
    {
      id: "unpaid-mercenaries",
      label: "Carthage fights with hired men and pays them late",
      kind: "world_event",
      severity: "grave",
      weight: 16,
      when: { politiesExist: ["carthage"], notBeforeDay: 730 },
      target: { polityId: "carthage", provinceId: null },
      brief: "Carthage's army is not Carthaginian. Libyans, Iberians and Gauls have served a long war on promises, and the treasury has been meeting other obligations first. Decide what the arrears have come to and who speaks for the men. Put it on their captains with \"character_create\" and \"character_intent_set\", move the province they are quartered in with \"province_material_shift\", and record the grievance as a public fact naming Carthage. If they are past being argued with, they hold ground and are a power: \"polity_create\" breaking from Carthage.",
    },
    {
      id: "messana-invites-a-protector",
      label: "Messana sits on the strait and cannot hold it alone",
      kind: "world_event",
      severity: "serious",
      weight: 14,
      when: { politiesExist: ["mamertines"], notAfterDay: 2_920 },
      target: { polityId: "mamertines", provinceId: null },
      brief: "The Mamertines hold Messana and hold it on sufferance: the strait is worth more than they are, and both great powers know the way across. Decide which of them the Mamertines send to, what they offer, and what the faction that wanted the other one does about it. Use \"diplomatic_message_send\" in their own name, and record the appeal as a fact naming Messana and whoever it was sent to. The answer is not yours to give.",
    },
    {
      // Messana asking is one event. A great power answering, and the other
      // one refusing to let it stand, is what the asking turns into -- and it
      // is only reachable once the asking has happened, which is what
      // "afterPressureIds" is for. Nothing here makes it happen: if the
      // Mamertines were never answered, or Rome and Carthage are already at
      // war, or one of them is gone, the age simply goes differently.
      id: "the-strait-is-crossed",
      label: "Whoever crosses to Messana has crossed the strait",
      kind: "world_event",
      severity: "grave",
      weight: 24,
      when: {
        politiesExist: ["rome", "carthage", "mamertines"],
        afterPressureIds: ["messana-invites-a-protector"],
        atPeace: [{ polityId: "rome", otherPolityId: "carthage" }],
      },
      target: { polityId: "rome", provinceId: "ita-72843720b81376294924159-sicily-northeast", otherPolityId: "carthage" },
      brief: "A protector has been asked for at Messana, and one of the great powers has moved -- a garrison put ashore, a fleet standing into the strait, a magistrate sent to take the city's submission. The other will not have it: the strait is three miles wide and whoever holds both sides of it holds everything that passes. Decide which of them crossed, what the other did about it, and who in each government carried the argument. Open the war itself with \"agreement_open\" of kind \"war\" between rome and carthage, record the breaking as a public fact naming both powers and Messana, and give the men who pushed for it a \"character_intent_set\". Do not fight it here -- opening it is the whole of this, and the campaign belongs to the people who will have to make it.",
    },
    {
      id: "a-fleet-can-be-copied",
      label: "A sea power's advantage is a design, and designs wash ashore",
      kind: "world_event",
      severity: "serious",
      weight: 10,
      when: { politiesExist: ["carthage"], atWar: [{ polityId: "rome", otherPolityId: "carthage" }] },
      target: { polityId: null, provinceId: null },
      brief: "A Carthaginian warship has come into the hands of a power that has no navy -- driven ashore, taken at a landing, or sold by someone who should not have sold it. Decide who has it and what they do about it: a hull on a beach is not a fleet, and copying it is a project of months with shipwrights who have never built one. Open it with \"project_create\" whose outcome is a force, and record the find as a fact naming the province it came ashore in.",
    },
    {
      id: "storm-season",
      label: "These are not seas to keep a fleet at sea in",
      kind: "world_event",
      severity: "grave",
      weight: 12,
      when: { notBeforeDay: 365 },
      target: { polityId: null, provinceId: null },
      brief: "A fleet has been caught out of season. Decide whose, where, and how much of it is gone -- and remember that ships lost at sea take their crews with them, which is manpower no province gets back this year. Change what it costs now with \"force_modify\" or by destroying the force outright, shift the provinces that raised those men with \"province_material_shift\", and record it as a public fact. If the fleet belonged to nobody in this war, it is somebody's grain convoy instead.",
    },
    {
      id: "a-general-who-outgrows-his-city",
      label: "A long command far from home makes a man loyal to his army",
      kind: "person_problem",
      severity: "serious",
      weight: 12,
      secret: true,
      when: { notBeforeDay: 1_460 },
      target: { polityId: null, provinceId: null },
      brief: "Someone who has held an army in the field for years has begun to treat it as his own: paying it from his own takings, settling his own quarrels with it, answering his government later and later. Choose the commander from PEOPLE -- it must be someone who actually commands. Put it on them with \"character_intent_set\" (private) and a \"character_pressure_set\", and record what they have already done as a private fact known to them alone.",
    },
  ],
  warfare: {
    troopCategories: [
      { id: "infantry", label: "Infantry", combatWeightBps: 10_000, steadinessBps: 7_000, mobilityBps: 5_000 },
      // A quinquereme is a fighting ship and a transport at once, which is what
      // the whole war turned on: whoever held the sea decided who could cross.
      { id: "warship", label: "Warships", combatWeightBps: 9_000, steadinessBps: 6_000, mobilityBps: 8_000, naval: true, transportPerHead: 30 },
      // The arm both powers actually fought these wars with and the scenario
      // had no word for: Numidian and Gallic horse, worth more per head than a
      // foot soldier and far quicker, and worth much less standing still. An
      // auxiliary taken into a legion has to stay the kind of troops he is --
      // dissolved into the line, a cavalry wing fights like a maniple.
      // Worth less than a legionary in a stand-up fight and far more
      // everywhere else: `combatWeightBps` is capped at the 10 000 baseline,
      // so the difference that matters here is the other two numbers -- horse
      // break sooner when made to hold ground, and run down a supply train or
      // a beaten army as nothing on foot can.
      { id: "cavalry", label: "Horse", combatWeightBps: 9_500, steadinessBps: 4_500, mobilityBps: 9_500 },
    ],
    routineTactics: [{ id: "hold-ground", label: "Hold prepared ground", factor: "cohesion", phases: ["engagement"], modifierBps: 500 }],
    phases: ["contact", "engagement", "cohesion", "withdrawal", "aftermath"], routCohesionBps: 2_000, arrearsMoralePeriods: 1, arrearsDesertionPeriods: 2,
  },
  government: {
    offices: [{ id: "roman-consul", label: "Roman consul", polityId: "rome", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-election", eligibilityRequirementIds: [...romanReqs, "req-age-38", "req-standing-6000", "req-held-praetor", "req-gap-consul-10"], termDays: 365, kind: "magistracy", rank: 4 },
      // The other powers' heads. Without an office a king of Syracuse
      // negotiating for Syracuse was recorded as insubordinate, which made
      // every foreign government's ordinary business a breach.
      { id: "syracusan-king", label: "King of Syracuse", polityId: "syracuse", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "syracuse-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "syracusan-succession", eligibilityRequirementIds: ["req-alive", "req-not-disqualified"] },
      { id: "mamertine-leader", label: "Leader of the Mamertines", polityId: "mamertines", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "mamertine-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "mamertine-acclamation", eligibilityRequirementIds: ["req-alive", "req-not-disqualified"] },
      { id: "carthaginian-strategos", label: "Carthaginian commander in Sicily", polityId: "carthage", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "carthage-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: ["req-alive", "req-not-disqualified"] },
      ...romanOffices,
      ...otherPowersOffices,
      ...templateOffices,
    ],
    successionRules: [
      { id: "roman-election", label: "Election by the Senate", kind: "elective", institutionId: "roman-senate" },
      { id: "syracusan-succession", label: "Hereditary kingship", kind: "primogeniture", institutionId: null },
      { id: "mamertine-acclamation", label: "Acclamation by the soldiery", kind: "elective", institutionId: null },
      { id: "carthaginian-appointment", label: "Appointment by the Council of Carthage", kind: "appointment", institutionId: null },
      { id: "carthaginian-election", label: "Election by the citizens of Carthage", kind: "elective", institutionId: null },
      { id: "roman-dictatorship", label: "Named by a consul on the Senate's word", kind: "appointment", institutionId: null },
      { id: "roman-enrolment", label: "Enrolled by the censors, or by holding a magistracy", kind: "appointment", institutionId: null },
      { id: "roman-cooptation", label: "Chosen by the college", kind: "elective", institutionId: null },
      { id: "roman-vestal-choice", label: "Chosen by the pontifex maximus", kind: "appointment", institutionId: null },
      { id: "syracusan-appointment", label: "Appointment by the king", kind: "appointment", institutionId: null },
      { id: "syracusan-lot", label: "Chosen by lot from the great houses", kind: "elective", institutionId: null },
      { id: "template-succession", label: "Succession by custom", kind: "primogeniture", institutionId: null },
      { id: "template-appointment", label: "Chosen by the ruler and the elders", kind: "appointment", institutionId: null },
    ], decreeAuthorityCostBps: 500, decreeMinimumPrestigeBps: 2_000,
  },
  dialogue: { roleSlots: [], namePools: { roman: ["Gaius", "Lucius"], carthaginian: ["Hanno", "Hamilcar"], greek: ["Hieron", "Sosistratus"] } },
  continuity: { startingSeatCount: 1, extraPrincipalsPerPlayer: 1 },
  knowledge: [
    { id: "mamertine-crisis", summary: "In 270 BCE Hieron II's Syracuse contests the Mamertines of Messana. Rome and Carthage remain at peace, but the strait is strategically volatile.", subjectIds: ["syracuse", "mamertines", "rome", "carthage"], provinceIds: ["ita-72843720b81376294924159-sicily-northeast", "ita-72843720b81376294924159-sicily-southeast"] },
    { id: "roman-italian-control", summary: "Rome directly controls its Italian client territories at the opening while their local regional names remain on the map.", subjectIds: ["rome"], provinceIds: ["punic-italy-latium", "punic-italy-samnium", "punic-italy-lucanian-uplands", "punic-italy-bruttian-highlands"] },
  ],
});

/**
 * The places this scenario is actually about, authored rather than derived:
 * their settlements, their operational positions, and control set deliberately.
 * The rest of the map comes from the generated graph, and these win wherever
 * the two describe the same province.
 */
const handAuthoredProvinces = [
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
];

/**
 * Italy north-to-south, with the Messana strait and the Carthage-Sicily
 * crossing closing the loop to Africa. These stay hand-written because they
 * are the routes the opening is fought over, and because "land" is used for
 * the two water crossings deliberately: the provinces either side are
 * authored as "hills", which admits no strait, and the campaign has always
 * treated both as ordinary marches.
 */
const handAuthoredEdges = [
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
  ["punic-italy-lucanian-uplands", "punic-italy-bruttian-highlands"],
  ["ita-72843720b81376294924159-sicily-west", "ita-72843720b81376294924159-sicily-northwest"],
  ["ita-72843720b81376294924159-sicily-northwest", "ita-72843720b81376294924159-sicily-central"],
  ["ita-72843720b81376294924159-sicily-central", "ita-72843720b81376294924159-sicily-southeast"],
  ["ita-72843720b81376294924159-sicily-southeast", "ita-72843720b81376294924159-sicily-northeast"],
].map(([from, to]) => ({ from: from!, to: to!, crossing: "land" as const, distance: 1 }));

/**
 * The two crossings that are water, and always were.
 *
 * The strait at Messana and the passage from Sicily to Africa were authored as
 * land edges because nothing in the engine could tell the difference, so a
 * legion walked to Sicily and the First Punic War could be fought without a
 * ship. They are what makes Sicily an island.
 */
const handAuthoredWaterEdges = [
  { from: "punic-italy-bruttian-highlands", to: "ita-72843720b81376294924159-sicily-northeast", crossing: "strait" as const, distance: 1 },
  { from: "tun-13205935b88806172084765", to: "ita-72843720b81376294924159-sicily-west", crossing: "sea_lane" as const, distance: 2 },
];

const edgeKey = (from: string, to: string): string => [from, to].sort().join("|");

/**
 * A crossing is legal only where the terrain on *both* sides admits it
 * (`packages/shared/src/world/map.ts`). The derived graph reaches Corsica from
 * Etruria by strait, and Etruria was authored as "hills", which admits neither
 * strait nor sea lane. Any authored province the graph gives a water crossing
 * is therefore recorded as the coastal plain it evidently is, rather than
 * dropping the crossing or maintaining the same fact in two places.
 */
const waterCrossingProvinceIds = new Set(
  [...PUNIC_WARS_GRAPH_EDGES, ...handAuthoredWaterEdges].filter((edge) => edge.crossing !== "land").flatMap((edge) => [edge.from, edge.to]),
);
const authoredProvinces = handAuthoredProvinces.map((province) =>
  waterCrossingProvinceIds.has(province.id) && province.terrainId !== "coastal-plain"
    ? { ...province, terrainId: "coastal-plain" }
    : province);
const authoredEdges = [...handAuthoredEdges, ...handAuthoredWaterEdges];
const authoredProvinceIds = new Set(authoredProvinces.map((province) => province.id));
const authoredEdgeKeys = new Set(authoredEdges.map((edge) => edgeKey(edge.from, edge.to)));
const authoredPolityIds = new Set<string>(["rome", "carthage", "syracuse", "mamertines", ...italianPolities.map(([id]) => id)]);

/**
 * How far each power on this map acts as one thing.
 *
 * Everything here was modelled identically -- a polity with a capital and a
 * foreign policy -- so the Boii behaved like a republic with a chancellery and
 * a treaty struck with one Ligurian bound every Ligurian. Most of these names
 * are peoples, not states: they are one word on a map covering communities who
 * never agreed to be covered by it.
 *
 * Roughly: a city-state or republic whose centre plainly speaks for it is high;
 * a kingdom held by a person is a little lower, because it is only as united as
 * the man holding it; a confederation is halfway; a people who left no central
 * institution at all is low, and the engine will treat each of its provinces as
 * answering for itself.
 */
const COHESION_BY_POLITY: Readonly<Record<string, number>> = {
  rome: 8_500,
  carthage: 8_000,
  syracuse: 7_500,
  mamertines: 6_000,
  "rhegium-campanians": 6_000,
  "etruscan-cities": 4_000,
  veneti: 3_500,
  cenomani: 3_000,
  insubres: 3_000,
  boii: 3_000,
  ligurians: 2_200,
};

/** Peoples the map names but nobody ever organised: loose unless said otherwise. */
const DEFAULT_COHESION = 3_000;
const cohesionFor = (polityId: string): number => COHESION_BY_POLITY[polityId] ?? DEFAULT_COHESION;

const graphSettlementsByProvince = new Map<string, { id: string; name: string; kind: string; provinceId: string; controllerPolityId: string; size: number; fortificationLevel: number }[]>();
for (const settlement of PUNIC_WARS_GRAPH_SETTLEMENTS) {
  // Authored provinces bring their own settlements; taking the graph's copy too
  // would duplicate an id, which the province graph refuses outright.
  if (authoredProvinceIds.has(settlement.provinceId)) continue;
  const existing = graphSettlementsByProvince.get(settlement.provinceId);
  if (existing === undefined) graphSettlementsByProvince.set(settlement.provinceId, [{ ...settlement }]);
  else existing.push({ ...settlement });
}

const initialWorld: WorldState = WorldStateSchema.parse({
  schemaVersion: 3,
  pins: { scenarioId: PUNIC_WARS_SCENARIO_ID, scenarioVersion: 23, libraryVersion: 1 },
  elapsedStep: 0,
  instant: { day: 0, minute: 0 },
  map: {
    polities: [
      { id: "rome", name: "Roman Republic", capitalSettlementId: "settlement-rome", cohesionBps: cohesionFor("rome") },
      { id: "carthage", name: "Carthage", capitalSettlementId: "settlement-carthage", cohesionBps: cohesionFor("carthage") },
      { id: "syracuse", name: "Kingdom of Syracuse", capitalSettlementId: "settlement-syracuse", cohesionBps: cohesionFor("syracuse") },
      { id: "mamertines", name: "Mamertines of Messana", capitalSettlementId: "settlement-messana", cohesionBps: cohesionFor("mamertines") },
      // The Campanian legion sent to garrison Rhegium killed the citizens and
      // kept the city -- the same thing the Mamertines did at Messana, in the
      // same decade. Filing them under Rome made the Republic unable to attack
      // them at all: two forces of one power will not fight each other, so the
      // assault on Rhegium was refused by the engine and the siege could never
      // end. They are what they actually were: a power holding a city.
      { id: "rhegium-campanians", name: "Campanian legion of Rhegium", capitalSettlementId: "settlement-rhegium", cohesionBps: cohesionFor("rhegium-campanians") },
      ...italianPolities.map(([id, name]) => ({ id, name, capitalSettlementId: null, cohesionBps: cohesionFor(id) })),
      // Everyone else who holds ground on this map: the Gaulish and Iberian
      // peoples, the Britons, the Germanic and Illyrian and Thracian
      // communities, the Greek leagues and cities, Macedon, Epirus, the
      // Numidian and Mauretanian kingdoms. They were drawn for as long as the
      // map has existed; until now none of them was written down, so nothing in
      // the simulation could see, name, or answer them.
      ...PUNIC_WARS_GRAPH_POLITIES
        .filter((polity) => !authoredPolityIds.has(polity.polityId))
        .map((polity) => ({ id: polity.polityId, name: polity.name, capitalSettlementId: polity.capitalSettlementId, cohesionBps: cohesionFor(polity.polityId) })),
    ],
    politicalRelations: [],
    provinces: [
      ...authoredProvinces,
      // The rest of the drawn world, exactly as the map already shows it. See
      // `authoredProvinces` above for why these two lists exist separately.
      ...PUNIC_WARS_GRAPH_PROVINCES
        .filter((province) => !authoredProvinceIds.has(province.id))
        .map((province) => ({
          id: province.id,
          name: province.name,
          formerNames: [],
          terrainId: province.terrainId,
          // Exactly the settlements the map draws here -- no more, no fewer. A
          // drawn settlement missing from the world is visible and clickable
          // and impossible to besiege, and an undrawn one invented here would
          // be a city in Pannonia no polygon ever claimed.
          settlements: graphSettlementsByProvince.get(province.id) ?? [],
          controllerPolityId: province.controllerPolityId,
          controlFirmnessBps: province.controlFirmnessBps,
          tier: "far" as const,
        })),
    ],
    edges: [
      ...authoredEdges,
      ...PUNIC_WARS_GRAPH_EDGES.filter((edge) => !authoredEdgeKeys.has(edgeKey(edge.from, edge.to))),
    ],
  },
  // The gods of each people, so a priest has a faith to serve and a man's
  // belief is something the world knows about him.
  faiths: [
    { id: "faith-roman", name: "The Roman gods", foundedAtStep: 0, founderCharacterId: null },
    { id: "faith-punic", name: "The gods of Carthage", foundedAtStep: 0, founderCharacterId: null },
    { id: "faith-greek", name: "The Olympian gods", foundedAtStep: 0, founderCharacterId: null },
    { id: "faith-italic", name: "The Italic gods", foundedAtStep: 0, founderCharacterId: null },
  ],
  characters: [
    { id: "gaius-genucius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }], name: "Gaius Genucius Clepsina", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 45, officeId: "roman-consul", personalAccountId: "gaius-purse", skills: { martial: 65, intrigue: 40, learning: 50, piety: 45, stewardship: 55, diplomacy: 60, body: 65, subSkills: {} }, traits: ["dutiful", "disciplined"], healthBps: 9_000, prestigeBps: 7_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // Genucius's colleague for 270 (scenario v29). Rome's two consuls sat
    // alone for twenty-eight versions with the second chair empty; Blasio, a
    // patrician Cornelius, held it that year, and was consul again in 257 and
    // censor after. He keeps the city while Genucius takes the army south.
    { id: "gnaeus-cornelius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }], name: "Gnaeus Cornelius Blasio", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 42, officeId: "roman-consul", personalAccountId: "blasio-purse", skills: { martial: 55, intrigue: 50, learning: 55, piety: 55, stewardship: 65, diplomacy: 60, body: 55, subSkills: {} }, traits: ["ambitious", "methodical"], healthBps: 9_000, prestigeBps: 7_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // Carthage is a real party watching the Messana crisis, not a passive
    // name on the map: an active goal and plot (character-sim phase 3) give
    // Hanno explicit scenario relevance from the opening turn, and the
    // pressure names why it is on his mind now rather than as flavor text.
    { id: "hanno-carthage", name: "Hanno of Carthage", cultureId: "carthaginian", faithId: "faith-punic", dynastyId: null, locationProvinceId: "tun-13205935b88806172084765", polityId: "carthage", ageYearsAtStart: 48, officeId: "carthaginian-strategos", personalAccountId: "hanno-purse", skills: { martial: 55, intrigue: 65, learning: 50, piety: 50, stewardship: 70, diplomacy: 65, body: 55, subSkills: {} }, traits: ["ambitious", "deceitful"], mind: { drives: { security: 55, status: 65, wealth: 60, family: 40, faith: 35, duty: 45, revenge: 30 }, temperament: { boldness: 55, caution: 50, honesty: 35, sociability: 55, discipline: 45, cruelty: 40 }, riskTolerance: 55, values: [], taboos: [], currentPressures: ["hanno-pressure-messana"] }, healthBps: 8_500, prestigeBps: 7_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // A cautious, status-conscious ruler measuring every move against the Mamertine threat -- an authored
    // mind and relationship state (character-sim phase 2), demonstrating the fields without hardcoding
    // engine behavior to them: the simulation still reads Hieron II through the same canonical schema
    // every other character uses.
    { id: "hieron-ii", name: "Hieron II", cultureId: "greek", faithId: "faith-greek", dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-southeast", polityId: "syracuse", ageYearsAtStart: 38, officeId: "syracusan-king", personalAccountId: "hieron-purse", skills: { martial: 70, intrigue: 55, learning: 60, piety: 55, stewardship: 60, diplomacy: 65, body: 65, subSkills: {} }, traits: ["cautious", "dutiful"], mind: { drives: { security: 65, status: 70, wealth: 50, family: 50, faith: 45, duty: 70, revenge: 30 }, temperament: { boldness: 35, caution: 75, honesty: 55, sociability: 55, discipline: 65, cruelty: 30 }, riskTolerance: 30, values: ["dutiful"], taboos: ["deceitful"], currentPressures: ["mamertine-pressure-hieron"] }, healthBps: 9_000, prestigeBps: 7_500, relations: [{ subjectCharacterId: "mamertine-spokesman", causes: [{ id: "hieron-mamertine-rivalry", label: "The Mamertines seized Messana from Syracuse by treachery.", score: -18, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -25, fear: 10, respect: -5 } }] }], ambitions: [{ id: "secure-sicily", label: "Secure Syracuse against the Mamertines", kind: "peace", targetId: "mamertines", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // A bold, embattled spokesman under active military pressure -- distinct temperament and drives
    // from Hieron II despite a similar martial skill, so their dialogue and any future decisions read
    // as different people under different pressure, not palette-swapped stat blocks.
    { id: "mamertine-spokesman", name: "Mamertine spokesman", cultureId: "italic", faithId: "faith-italic", dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-northeast", polityId: "mamertines", ageYearsAtStart: 35, officeId: "mamertine-leader", personalAccountId: "mamertine-purse", skills: { martial: 60, intrigue: 45, learning: 35, piety: 45, stewardship: 45, diplomacy: 50, body: 70, subSkills: {} }, traits: ["bold", "vengeful"], mind: { drives: { security: 70, status: 45, wealth: 40, family: 55, faith: 40, duty: 55, revenge: 55 }, temperament: { boldness: 70, caution: 30, honesty: 50, sociability: 45, discipline: 40, cruelty: 45 }, riskTolerance: 70, values: [], taboos: [], currentPressures: ["mamertine-pressure-spokesman"] }, healthBps: 8_500, prestigeBps: 5_500, relations: [{ subjectCharacterId: "hieron-ii", causes: [{ id: "mamertine-hieron-fear", label: "Syracusan forces press their border at Messana.", score: -12, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { fear: 30, trust: -10 } }] }], ambitions: [{ id: "hold-messana", label: "Hold Messana", kind: "restoration", targetId: "settlement-messana", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // The men who actually held Rome, Syracuse and Carthage in 270 BCE, so the
    // opening world is a political situation rather than one consul and three
    // placeholders. Each is here because the year gives them something to be
    // doing: Dentatus has an aqueduct half-built and the standing of a man who
    // beat Pyrrhus, Ogulnius has the coinage question, Vibellius is holding
    // Rhegium against the Republic that means to take it back. Ages are at the
    // scenario's opening; where a man's exact role in 270 is not recorded, his
    // attested career in the decade around it is what he is given.
    { id: "manius-curius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }, { officeId: "roman-consul", lastHeldAtStep: 0 }, { officeId: "roman-censor", lastHeldAtStep: 0 }], name: "Manius Curius Dentatus", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 60, officeId: null, personalAccountId: "curius-purse", skills: { martial: 80, intrigue: 35, learning: 50, piety: 65, stewardship: 70, diplomacy: 55, body: 55, subSkills: {} }, traits: ["dutiful", "disciplined"], mind: { drives: { security: 50, status: 45, wealth: 20, family: 40, faith: 60, duty: 85, revenge: 20 }, temperament: { boldness: 55, caution: 55, honesty: 80, sociability: 45, discipline: 80, cruelty: 25 }, riskTolerance: 40, values: ["dutiful"], taboos: ["deceitful"], currentPressures: [] }, healthBps: 6_500, prestigeBps: 9_500, relations: [], ambitions: [{ id: "finish-the-anio", label: "See the Anio water brought into Rome", kind: "restoration", targetId: "settlement-rome", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    { id: "quintus-ogulnius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-tribune", lastHeldAtStep: 0 }, { officeId: "roman-aedile", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }], name: "Quintus Ogulnius Gallus", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: "punic-italy-latium", polityId: "rome", ageYearsAtStart: 47, officeId: null, personalAccountId: "ogulnius-purse", skills: { martial: 45, intrigue: 55, learning: 70, piety: 70, stewardship: 75, diplomacy: 70, body: 50, subSkills: {} }, traits: ["ambitious", "methodical"], mind: { drives: { security: 45, status: 70, wealth: 55, family: 50, faith: 60, duty: 65, revenge: 25 }, temperament: { boldness: 45, caution: 65, honesty: 60, sociability: 70, discipline: 70, cruelty: 25 }, riskTolerance: 40, values: [], taboos: [], currentPressures: ["ogulnius-pressure-coinage"] }, healthBps: 8_500, prestigeBps: 7_000, relations: [], ambitions: [{ id: "roman-silver", label: "Put Rome's own silver into the hands of its allies", kind: "wealth", targetId: "rome", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Rome's other war of 270, and the one its own historians were least proud
    // of: a Campanian legion sent to garrison Rhegium killed the citizens and
    // kept the city. Vibellius holds it still, and the Republic means to end it.
    { id: "decius-vibellius", name: "Decius Vibellius", cultureId: "italic", faithId: "faith-italic", dynastyId: null, locationProvinceId: "punic-italy-bruttian-highlands", polityId: "rhegium-campanians", ageYearsAtStart: 41, officeId: "campanian-leader", personalAccountId: "vibellius-purse", skills: { martial: 65, intrigue: 60, learning: 30, piety: 30, stewardship: 40, diplomacy: 35, body: 65, subSkills: {} }, traits: ["bold", "vengeful"], mind: { drives: { security: 80, status: 55, wealth: 65, family: 35, faith: 25, duty: 20, revenge: 50 }, temperament: { boldness: 75, caution: 35, honesty: 25, sociability: 40, discipline: 35, cruelty: 70 }, riskTolerance: 75, values: [], taboos: [], currentPressures: ["vibellius-pressure-siege"] }, healthBps: 8_000, prestigeBps: 3_000, relations: [], ambitions: [{ id: "keep-rhegium", label: "Keep Rhegium and his men's necks", kind: "restoration", targetId: "punic-italy-bruttian-highlands", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Syracuse is a court, not one king: Leptines is the aristocrat whose
    // daughter Hieron married, and the reason the city accepted him at all.
    { id: "leptines-syracuse", name: "Leptines of Syracuse", cultureId: "greek", faithId: "faith-greek", dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-southeast", polityId: "syracuse", ageYearsAtStart: 58, officeId: null, personalAccountId: "leptines-purse", skills: { martial: 50, intrigue: 60, learning: 65, piety: 55, stewardship: 70, diplomacy: 75, body: 45, subSkills: {} }, traits: ["cautious", "methodical"], mind: { drives: { security: 70, status: 60, wealth: 55, family: 75, faith: 45, duty: 60, revenge: 20 }, temperament: { boldness: 35, caution: 75, honesty: 60, sociability: 70, discipline: 65, cruelty: 20 }, riskTolerance: 30, values: [], taboos: [], currentPressures: [] }, healthBps: 7_500, prestigeBps: 7_000, relations: [{ subjectCharacterId: "hieron-ii", causes: [{ id: "leptines-hieron-kin", label: "Hieron married his daughter, and rules with his house behind him.", score: 35, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: 40, affection: 30, respect: 35 } }] }], ambitions: [{ id: "keep-the-house", label: "Keep his house at the centre of Syracuse", kind: "office", targetId: "syracuse", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Carthage fights its wars through admirals, and Hannibal Gisco commanded
    // its fleets in the war that followed. In 270 he is the officer watching
    // the strait for the men who will have to decide about it.
    { id: "hannibal-gisco", name: "Hannibal Gisco", cultureId: "carthaginian", faithId: "faith-punic", dynastyId: null, locationProvinceId: "ita-72843720b81376294924159-sicily-west", polityId: "carthage", ageYearsAtStart: 39, officeId: null, personalAccountId: "gisco-purse", skills: { martial: 70, intrigue: 45, learning: 50, piety: 45, stewardship: 55, diplomacy: 45, body: 60, subSkills: {} }, traits: ["bold", "disciplined"], mind: { drives: { security: 60, status: 60, wealth: 45, family: 45, faith: 40, duty: 70, revenge: 30 }, temperament: { boldness: 70, caution: 45, honesty: 55, sociability: 45, discipline: 70, cruelty: 40 }, riskTolerance: 60, values: [], taboos: [], currentPressures: ["gisco-pressure-strait"] }, healthBps: 9_000, prestigeBps: 6_000, relations: [], ambitions: [{ id: "hold-the-strait", label: "Keep the strait open to Carthage and shut to anyone else", kind: "other", targetId: "ita-72843720b81376294924159-sicily-northeast", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
  ],
  continuity: [], encounters: [],
  // Carthage is named as a participant, not merely adjacent to the crisis: it
  // has its own stake in whether Messana falls to Syracuse or holds.
  storylines: [{ id: "rhegium-recovery", title: "Rhegium and the Campanian Legion", participantIds: ["gaius-genucius", "decius-vibellius", "manius-curius"], provinceId: "punic-italy-bruttian-highlands", phase: "escalating", stakes: "Rome must retake a city its own garrison murdered and kept, in front of every ally watching how the Republic treats a broken oath.", history: ["The Campanian legion sent to hold Rhegium killed its citizens and took the city for itself.", "The Senate has resolved that the matter be ended."], nextDevelopment: "The consular army turns south, or the Senate finds someone else to send.", visibility: "public", updatedAtStep: 0 }, { id: "mamertine-syracusan-crisis", title: "The Messana Crisis", participantIds: ["hieron-ii", "mamertine-spokesman", "hanno-carthage"], provinceId: "ita-72843720b81376294924159-sicily-northeast", phase: "escalating", stakes: "Syracuse seeks to contain the Mamertines without drawing Rome and Carthage into a wider war.", history: ["Hieron II's forces pressure the Mamertines around the Strait of Messana.", "Carthage watches the strait for any opening or threat to its own position in Sicily."], nextDevelopment: "Envoys may seek outside support if the local balance collapses.", visibility: "public", updatedAtStep: 0 }],
  conflicts: { battles: [], sieges: [], wars: [] },
  // Rome is already at war with the men holding Rhegium: the Senate has
  // resolved the matter be ended, and the army is marching. Saying so in state
  // is what lets the assault happen at all.
  polityAgreements: [{
    id: "war-rome-rhegium",
    kind: "war",
    polityId: "rome",
    otherPolityId: "rhegium-campanians",
    terms: "Rome means to retake Rhegium from the garrison that seized it and killed its citizens.",
    sinceStep: 0,
    untilStep: null,
    sourceMessageId: null,
    status: "active",
    endedAtStep: null,
    endedReason: null,
    visibility: "public",
  }],
  // What each power privately means to do. Secret by design -- nobody inside
  // the world reads another's -- and the reason anyone away from the player's
  // business has something to pursue at all.
  polityOutlooks: [
    { polityId: "rome", primaryObjective: "Finish the settlement of Italy on Rome's terms, and be seen to keep faith while doing it.", concerns: [{ label: "Rhegium still held by the Campanian legion", level: "high" }, { label: "the Gallic peoples of the Padus", level: "medium" }, { label: "Carthage's fleets in the western sea", level: "low" }], intentions: ["recover Rhegium and make an example of its garrison", "keep the Greek cities of the south quiet by protecting them", "avoid any quarrel across the strait before Italy is settled"], riskTolerance: 55, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "carthage", primaryObjective: "Keep western Sicily and the sea lanes to it, without a war against Rome.", concerns: [{ label: "Syracuse growing strong at Messana", level: "high" }, { label: "Roman power reaching the strait", level: "medium" }, { label: "the cost of mercenaries", level: "medium" }], intentions: ["watch the strait and answer whoever moves first", "hold Lilybaeum, Panormus and Agrigentum whatever happens east of them", "buy friends among the Sicilian cities rather than garrison them"], riskTolerance: 45, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "syracuse", primaryObjective: "Master all Greek Sicily, beginning with the Mamertines at Messana.", concerns: [{ label: "the Mamertines raiding Syracusan territory", level: "high" }, { label: "Carthage intervening if Messana falls", level: "high" }, { label: "Rome taking an interest in Sicily", level: "medium" }], intentions: ["press the Mamertines hard enough to take Messana", "keep Carthage neutral while it is done", "give Rome no reason to cross"], riskTolerance: 40, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "mamertines", primaryObjective: "Hold Messana, by whoever's help can be got.", concerns: [{ label: "the Syracusan army at the border", level: "high" }, { label: "no ally of their own", level: "high" }], intentions: ["seek a protector before Syracuse closes on the city", "raid for what the city needs while the roads are open"], riskTolerance: 75, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
    { polityId: "rhegium-campanians", primaryObjective: "Keep Rhegium, and keep their necks.", concerns: [{ label: "a consular army marching south", level: "high" }, { label: "nobody in Italy will shelter them", level: "high" }], intentions: ["hold the walls and make the siege cost more than the city is worth", "look for any power that would rather Rome did not hold the strait"], riskTolerance: 80, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
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
      { id: "blasio-purse", owner: { kind: "character", id: "gnaeus-cornelius" }, currencyId: "denarius", balance: 1_300, status: "active", visibility: "private" },
      { id: "hanno-purse", owner: { kind: "character", id: "hanno-carthage" }, currencyId: "denarius", balance: 1_100, status: "active", visibility: "private" },
      { id: "hieron-purse", owner: { kind: "character", id: "hieron-ii" }, currencyId: "denarius", balance: 1_000, status: "active", visibility: "private" },
      { id: "mamertine-purse", owner: { kind: "character", id: "mamertine-spokesman" }, currencyId: "denarius", balance: 700, status: "active", visibility: "private" },
      { id: "curius-purse", owner: { kind: "character", id: "manius-curius" }, currencyId: "denarius", balance: 900, status: "active", visibility: "private" },
      { id: "ogulnius-purse", owner: { kind: "character", id: "quintus-ogulnius" }, currencyId: "denarius", balance: 1_300, status: "active", visibility: "private" },
      { id: "vibellius-purse", owner: { kind: "character", id: "decius-vibellius" }, currencyId: "denarius", balance: 600, status: "active", visibility: "private" },
      { id: "leptines-purse", owner: { kind: "character", id: "leptines-syracuse" }, currencyId: "denarius", balance: 1_400, status: "active", visibility: "private" },
      { id: "gisco-purse", owner: { kind: "character", id: "hannibal-gisco" }, currencyId: "denarius", balance: 950, status: "active", visibility: "private" },
      // The powers' own chests. There were none at all: nine personal purses
      // and no treasury anywhere, so a war cost nobody anything, no office
      // could confer fiscal reach because there was nothing to reach, and
      // VISION §7's whole economy -- income, expenditure, surplus -- had no
      // subject. A republic that cannot run out of money is not a republic
      // anybody has to govern.
      { id: "rome-treasury", owner: { kind: "polity", id: "rome" }, currencyId: "denarius", balance: 9_000, status: "active", visibility: "polity" },
      { id: "carthage-treasury", owner: { kind: "polity", id: "carthage" }, currencyId: "denarius", balance: 16_000, status: "active", visibility: "polity" },
      { id: "syracuse-treasury", owner: { kind: "polity", id: "syracuse" }, currencyId: "denarius", balance: 5_200, status: "active", visibility: "polity" },
      { id: "mamertine-treasury", owner: { kind: "polity", id: "mamertines" }, currencyId: "denarius", balance: 2_500, status: "active", visibility: "polity" },
      // The chest each army carries. Empty at the opening -- nobody has taken
      // anything yet -- but real, because it is where plunder lands and what
      // an army paid out of what it takes is paid from. Without one, an order
      // about an army's own money has to be routed through its commander's
      // private purse, which is a different arrangement wearing the same coat:
      // a man's own money does not march away when he loses a battle.
      ...[
        ["roman-field-army", 400], ["campanian-legion", 260], ["carthaginian-fleet", 350],
        ["syracusan-squadron", 150], ["allied-greek-hulls", 40], ["carthaginian-garrison", 300],
        ["syracusan-army", 200], ["mamertine-garrison", 90],
      ].map(([forceId, balance]) => ({
        id: `${forceId as string}-chest`,
        owner: { kind: "force" as const, id: forceId as string },
        currencyId: "denarius",
        balance: balance as number,
        status: "active" as const,
        visibility: "polity" as const,
      })),
    ],
    accountAccess: [
      ["gaius", "gaius-genucius"], ["blasio", "gnaeus-cornelius"], ["hanno", "hanno-carthage"], ["hieron", "hieron-ii"], ["mamertine", "mamertine-spokesman"],
      ["curius", "manius-curius"], ["ogulnius", "quintus-ogulnius"], ["vibellius", "decius-vibellius"], ["leptines", "leptines-syracuse"], ["gisco", "hannibal-gisco"],
    ].map(([id, characterId]) => ({ id: `${id}-purse-access`, characterId, accountId: `${id}-purse`, permissions: ["view", "spend_without_vote"], sourceKind: "ownership", sourceId: characterId })),
    transactions: [], capturableValues: [],
    /**
     * The land the great men live on.
     *
     * There was none: every holding in the world was an empty list, so a
     * senator was a purse and an opinion, and a private citizen had nothing
     * to improve, mortgage, lose or leave to his son. Each estate's yield is
     * what `holding_create` would set for an estate of that size in that
     * province, so land authored here and land bought in play are the same
     * kind of thing. Curius's is famously small.
     */
    holdings: [
      { id: "curius-sabine-farm", title: "The Sabine farm", territoryId: "punic-italy-latium", legalHolderCharacterId: "manius-curius", incomeSourceId: "curius-sabine-farm-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "genucian-estates", title: "The Genucian estates", territoryId: "punic-italy-latium", legalHolderCharacterId: "gaius-genucius", incomeSourceId: "genucian-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "cornelian-estates", title: "The Cornelian estates", territoryId: "punic-italy-latium", legalHolderCharacterId: "gnaeus-cornelius", incomeSourceId: "cornelian-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "ogulnian-estates", title: "The Ogulnian lands in Campania", territoryId: "punic-italy-campanian-plain", legalHolderCharacterId: "quintus-ogulnius", incomeSourceId: "ogulnian-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "hanno-estates", title: "Hanno's estates in the African hinterland", territoryId: "tun-13205935b88806172084765", legalHolderCharacterId: "hanno-carthage", incomeSourceId: "hanno-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "gisco-estates", title: "The Gisconid farms", territoryId: "tun-13205935b88806172084765", legalHolderCharacterId: "hannibal-gisco", incomeSourceId: "gisco-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "leptines-estates", title: "The house of Leptines' estates", territoryId: "ita-72843720b81376294924159-sicily-southeast", legalHolderCharacterId: "leptines-syracuse", incomeSourceId: "leptines-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
    ],
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
      ...ladderRequirements,
      ...templateRequirements,
    ],
    officeSeats: [
      { id: "roman-consul:seat:0", officeId: "roman-consul", seatIndex: 0, holderCharacterId: "gaius-genucius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [...romanReqs, "req-age-38", "req-standing-6000", "req-held-praetor", "req-gap-consul-10"] },
      // Rome elected two consuls a year, and both chairs are filled (v29): a
      // player who declares themselves consul takes one of these men's
      // places, or puts one of them out of it.
      { id: "roman-consul:seat:1", officeId: "roman-consul", seatIndex: 1, holderCharacterId: "gnaeus-cornelius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [...romanReqs, "req-age-38", "req-standing-6000", "req-held-praetor", "req-gap-consul-10"] },
      { id: "syracusan-king:seat:0", officeId: "syracusan-king", seatIndex: 0, holderCharacterId: "hieron-ii", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: ["req-alive", "req-not-disqualified"] },
      { id: "mamertine-leader:seat:0", officeId: "mamertine-leader", seatIndex: 0, holderCharacterId: "mamertine-spokesman", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: ["req-alive", "req-not-disqualified"] },
      { id: "carthaginian-strategos:seat:0", officeId: "carthaginian-strategos", seatIndex: 0, holderCharacterId: "hanno-carthage", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: ["req-alive", "req-not-disqualified"] },
      // The councils, with the men the world names in them. The rest of each is implied.
      { id: "roman-senator:seat:0", officeId: "roman-senator", seatIndex: 0, holderCharacterId: "gaius-genucius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      { id: "roman-senator:seat:1", officeId: "roman-senator", seatIndex: 1, holderCharacterId: "manius-curius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      { id: "roman-senator:seat:2", officeId: "roman-senator", seatIndex: 2, holderCharacterId: "quintus-ogulnius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      { id: "roman-senator:seat:3", officeId: "roman-senator", seatIndex: 3, holderCharacterId: "gnaeus-cornelius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      { id: "carthaginian-elder:seat:0", officeId: "carthaginian-elder", seatIndex: 0, holderCharacterId: "hanno-carthage", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      { id: "carthaginian-elder:seat:1", officeId: "carthaginian-elder", seatIndex: 1, holderCharacterId: "hannibal-gisco", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      { id: "syracusan-friend:seat:0", officeId: "syracusan-friend", seatIndex: 0, holderCharacterId: "leptines-syracuse", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
      { id: "campanian-leader:seat:0", officeId: "campanian-leader", seatIndex: 0, holderCharacterId: "decius-vibellius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
    ],
    /**
     * What each power takes in, in the units its treasury is kept in.
     *
     * Rome in 270 BCE lives off the land tax of its own citizens and the
     * obligations of the Italian allies, who mostly owe men rather than money;
     * Carthage lives off trade and the tribute of its African subjects, which
     * is why it is the richer power and why a long war hurts it in a different
     * place. The counterparty is named where the money comes from abroad, so a
     * war can actually cut it -- which is what `counterpartyPolityId` is for
     * and what nothing in this scenario previously gave it to do.
     */
    incomeSources: [
      { id: "rome-tributum", kind: "tax", label: "The tributum on Roman citizens", beneficiaryAccountId: "rome-treasury", originKind: "polity", originId: "rome", amount: 1_100, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 9_000, active: true },
      { id: "rome-allied-contributions", kind: "tribute", label: "Contributions of the Italian allies", beneficiaryAccountId: "rome-treasury", originKind: "polity", originId: "rome", amount: 600, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 8_000, active: true },
      { id: "rome-ager-publicus", kind: "land", label: "Rents of the public land", beneficiaryAccountId: "rome-treasury", originKind: "polity", originId: "rome", amount: 330, cadenceSteps: 30, nextDueStep: 30, active: true },
      { id: "carthage-harbour-dues", kind: "trade", label: "Harbour dues at Carthage", beneficiaryAccountId: "carthage-treasury", originKind: "polity", originId: "carthage", amount: 1_400, cadenceSteps: 30, nextDueStep: 30, active: true },
      { id: "carthage-african-tribute", kind: "tribute", label: "Tribute of the African subjects", beneficiaryAccountId: "carthage-treasury", originKind: "polity", originId: "carthage", amount: 960, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 8_500, active: true },
      { id: "syracuse-tax", kind: "tax", label: "The Syracusan tithe", beneficiaryAccountId: "syracuse-treasury", originKind: "polity", originId: "syracuse", amount: 620, cadenceSteps: 30, nextDueStep: 30, active: true },
      // What the estates above pay their owners, month by month.
      ...([
        ["curius-sabine-farm", "The Sabine farm", "curius-purse", 40],
        ["genucian-estates", "The Genucian estates", "gaius-purse", 100],
        ["cornelian-estates", "The Cornelian estates", "blasio-purse", 110],
        ["ogulnian-estates", "The Ogulnian lands in Campania", "ogulnius-purse", 125],
        ["hanno-estates", "Hanno's estates in the African hinterland", "hanno-purse", 240],
        ["gisco-estates", "The Gisconid farms", "gisco-purse", 100],
        ["leptines-estates", "The house of Leptines' estates", "leptines-purse", 90],
      ] as const).map(([holdingId, title, purse, amount]) => ({
        id: `${holdingId}-yield`, kind: "land" as const, label: `Yield of ${title}`, beneficiaryAccountId: purse,
        originKind: "holding" as const, originId: holdingId, amount, cadenceSteps: 30, nextDueStep: 30, active: true,
      })),
      { id: "mamertine-tolls", kind: "trade", label: "Tolls on the strait", beneficiaryAccountId: "mamertine-treasury", originKind: "polity", originId: "mamertines", amount: 250, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 7_000, active: true },
    ],
    /**
     * And what it costs them to stand still.
     *
     * Pay is the first charge on every treasury here and the one that bites
     * first: `arrearsMoralePeriods` and `arrearsDesertionPeriods` in the
     * warfare rules have always described what happens to an unpaid army and
     * had no unpaid army to describe, because nothing was ever owed.
     */
    obligations: [
      { id: "rome-legion-pay", kind: "army_pay", label: "Pay of the field army", payerAccountId: "rome-treasury", amount: 300, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "rome-magistracies", kind: "salary", label: "The magistracies and the public works", payerAccountId: "rome-treasury", amount: 190, cadenceSteps: 30, nextDueStep: 30, priority: 500, arrears: 0, missedPeriods: 0, active: true },
      { id: "carthage-fleet-pay", kind: "army_pay", label: "Pay of the fleet and its crews", payerAccountId: "carthage-treasury", amount: 430, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "carthage-mercenaries", kind: "army_upkeep", label: "The hired men of Libya and Iberia", payerAccountId: "carthage-treasury", amount: 520, cadenceSteps: 30, nextDueStep: 30, priority: 850, arrears: 0, missedPeriods: 0, active: true },
      { id: "syracuse-squadron-pay", kind: "army_pay", label: "Pay of the Syracusan squadron", payerAccountId: "syracuse-treasury", amount: 210, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "mamertine-soldiery", kind: "army_pay", label: "The soldiery that holds Messana", payerAccountId: "mamertine-treasury", amount: 120, cadenceSteps: 30, nextDueStep: 30, priority: 950, arrears: 0, missedPeriods: 0, active: true },
      // Hieron's hoplites and the allied hulls Rome sails on had no wages at
      // all: `syracuse-squadron-pay` covers the forty triremes and nothing
      // else, and `rome-legion-pay` the field army and nothing else. Priced
      // off this scenario's own rates -- 0.075 a man a month, as the legions
      // and the Mamertine mercenaries are both paid, and a fraction of a
      // warship's pay for transports the allied cities crew and maintain
      // themselves, Rome bearing only their victualling in the field.
      { id: "syracuse-army-pay", kind: "army_pay", label: "Pay of the Syracusan army", payerAccountId: "syracuse-treasury", amount: 225, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "rome-allied-hulls", kind: "army_upkeep", label: "Victualling of the allied hulls", payerAccountId: "rome-treasury", amount: 40, cadenceSteps: 30, nextDueStep: 30, priority: 800, arrears: 0, missedPeriods: 0, active: true },
    ],
    forces: [
      { id: "roman-field-army", name: "Roman field army", polityId: "rome", commanderCharacterId: "gaius-genucius", controllerCharacterId: "gaius-genucius", locationId: "punic-italy-latium", authorizedStrength: 4_000, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_500, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "rome-legion-pay", payArrearsPeriods: 0, history: [] },
      // The one force here that nobody has undertaken to pay, and deliberately
      // so. `rhegium-campanians` keeps no treasury: these men were Rome's
      // garrison, murdered the citizens they were sent to protect, and hold
      // the city for themselves. "Nobody has undertaken to pay them" is the
      // true reading of their position and half the reason they cannot go
      // back -- not an obligation somebody forgot to author.
      //
      // Carthage is a sea power and Rome in 270 BCE is not: the Republic has a
      // handful of allied hulls and no fleet of its own, which is exactly the
      // asymmetry the First Punic War was fought to overturn.
      { id: "campanian-legion", name: "Campanian legion of Rhegium", polityId: "rhegium-campanians", commanderCharacterId: "decius-vibellius", controllerCharacterId: "decius-vibellius", locationId: "punic-italy-bruttian-highlands", authorizedStrength: 4_000, personnel: [{ categoryId: "infantry", label: "Campanian mercenaries", fit: 3_600, unavailable: [] }], moraleBps: 6_500, cohesionBps: 7_000, fatigueBps: 1_000, provisionStatus: "shortage", provisionedThroughStep: 120, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "carthaginian-fleet", name: "Carthaginian fleet", polityId: "carthage", commanderCharacterId: "hannibal-gisco", controllerCharacterId: "hannibal-gisco", locationId: "ita-72843720b81376294924159-sicily-west", authorizedStrength: 120, personnel: [{ categoryId: "warship", label: "Quinqueremes", fit: 110, unavailable: [] }], moraleBps: 8_000, cohesionBps: 7_500, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "carthage-fleet-pay", payArrearsPeriods: 0, history: [] },
      { id: "syracusan-squadron", name: "Syracusan squadron", polityId: "syracuse", commanderCharacterId: "leptines-syracuse", controllerCharacterId: "leptines-syracuse", locationId: "ita-72843720b81376294924159-sicily-southeast", authorizedStrength: 40, personnel: [{ categoryId: "warship", label: "Triremes", fit: 35, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "syracuse-squadron-pay", payArrearsPeriods: 0, history: [] },
      { id: "allied-greek-hulls", name: "Allied Greek hulls", polityId: "rome", commanderCharacterId: "gaius-genucius", controllerCharacterId: "gaius-genucius", locationId: "punic-italy-bruttian-highlands", authorizedStrength: 20, personnel: [{ categoryId: "warship", label: "Allied transports", fit: 18, unavailable: [] }], moraleBps: 6_500, cohesionBps: 6_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "rome-allied-hulls", payArrearsPeriods: 0, history: [] },
      { id: "carthaginian-garrison", name: "Carthaginian field force", polityId: "carthage", commanderCharacterId: "hanno-carthage", controllerCharacterId: "hanno-carthage", locationId: "tun-13205935b88806172084765", authorizedStrength: 3_500, personnel: [{ categoryId: "infantry", label: "Infantry", fit: 3_000, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "carthage-mercenaries", payArrearsPeriods: 0, history: [] },
      { id: "syracusan-army", name: "Syracusan army", polityId: "syracuse", commanderCharacterId: "hieron-ii", controllerCharacterId: "hieron-ii", locationId: "ita-72843720b81376294924159-sicily-southeast", authorizedStrength: 3_000, personnel: [{ categoryId: "infantry", label: "Hoplites", fit: 2_600, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "syracuse-army-pay", payArrearsPeriods: 0, history: [] },
      { id: "mamertine-garrison", name: "Mamertine garrison", polityId: "mamertines", commanderCharacterId: "mamertine-spokesman", controllerCharacterId: "mamertine-spokesman", locationId: "ita-72843720b81376294924159-sicily-northeast", authorizedStrength: 1_600, personnel: [{ categoryId: "infantry", label: "Mercenaries", fit: 1_400, unavailable: [] }], moraleBps: 7_000, cohesionBps: 7_000, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "mamertine-soldiery", payArrearsPeriods: 0, history: [] },
    ],
  },
});

export const punicWarsScenario = { definition, initialWorld } as const;
