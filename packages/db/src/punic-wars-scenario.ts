import { GovernmentFormSchema, ScenarioDefinitionSchema, WorldStateSchema, formArmies, ordoOfRomanName, type GovernmentForm, type ScenarioDefinition, type WorldState } from "@chronica/shared";
import { PUNIC_IDS } from "./punic-ids";
import { PUNIC_DOCTRINES, PUNIC_ESTABLISHMENTS, SEASONED_ARMIES } from "./punic-wars-establishments";
import { POLITY_META, PUNIC_WARS_GRAPH_EDGES, PUNIC_WARS_GRAPH_POLITIES, PUNIC_WARS_GRAPH_PROVINCES, PUNIC_WARS_GRAPH_SETTLEMENTS } from "./punic-wars-map-graph";
import { foundingPeople, knownRulerId, romanSenators, withFinerSkills } from "./punic-wars-rulers";
import { WORLD_PRESSURES, withWorldPolitics } from "./punic-wars-politics";
import { rosterPeople } from "./punic-wars-rosters";

/**
 * The Mediterranean and the Near East of 270 BCE, on the generated map: 6,384 provinces, 164 powers
 * and every drawn town come from the map's graph (`punic-wars-map-graph.ts`,
 * built by `scripts/map-gen`), and this file adds what the graph cannot know --
 * how each power governs, who its people are, what armies and money they hold.
 * Places are spelt through `PUNIC_IDS`, never by an id.
 */
export const PUNIC_WARS_SCENARIO_ID = "00000000-0000-4000-8000-000000000102";
export const PUNIC_WARS_SLUG = "punic-wars";

const italianPolities = [
  ["ligurians", "Ligurian peoples"], ["insubres", "Insubres"], ["boii", "Boii"], ["cenomani", "Cenomani"], ["veneti", "Veneti"], ["etruscan-cities", "Etruscan cities"],
  // Rome's allies by foedus (see `alliedItaly`), and the Messapians, who are not yet.
  ["umbrians", "Umbrians"], ["picentes", "Picentes"], ["marsi-paeligni", "Marsi and Paeligni"], ["samnites", "Samnites"],
  ["lucanians", "Lucanians"], ["bruttians", "Bruttians"], ["apulian-cities", "Apulian cities"], ["messapians", "Messapians"],
] as const;

/** The powers this scenario writes out itself, apart from the map's list of who holds what. */
const AUTHORED_POLITY_IDS: ReadonlySet<string> = new Set(["rome", "carthage", "syracuse", "mamertines", "rhegium-campanians", ...italianPolities.map(([id]) => id)]);

/**
 * Rome's allies in 270, each bound by its own foedus: who, the terms, and how
 * far it trusts Rome (-100..100) and why. They keep their own governments and
 * pay Rome nothing; they send soldiers when called and make no war or peace
 * but Rome's. That is the whole bargain, and it is what the engine enforces.
 */
const alliedItaly: readonly (readonly [string, number, string, number, string])[] = [
  ["etruscan-cities", 0, "Each Etruscan city made its own peace with Rome after 280, and sends men to Rome's wars.", 0, "Allied since the peaces of the 280s; Volsinii's nobles fear their own people more than Rome."],
  ["umbrians", 0, "Allied since Camerinum's treaty of 310: men for Rome's wars, no war or peace of their own.", 25, "Old allies, with a Latin colony at Narnia to watch the road."],
  ["picentes", 0, "Allied since 299: men for Rome's wars, no war or peace of their own.", -30, "Hemmed in by Roman colonies at Hadria and on the Gallic coast, and close to rising."],
  ["marsi-paeligni", 0, "Allied since 304: the Marsi, Paeligni, Marrucini and Vestini send men to Rome's wars.", 40, "Rome's steadiest allies in the mountains."],
  ["samnites", 0, "Bound to Rome after defeat in 290 and again in 272: men for Rome's wars, no war or peace of their own.", -40, "Beaten twice in twenty years and robbed of land for Roman colonies; some still fight on."],
  ["lucanians", 0, "Bound to Rome after defeat in 272: men for Rome's wars, no war or peace of their own.", -25, "Pyrrhus's allies until two years ago; Paestum and Venusia now watch them."],
  ["bruttians", 0, "Bound to Rome after defeat in 272, when they gave up half the Sila forest.", -40, "Stripped of half their forest, and neighbours to the Campanians of Rhegium."],
  ["apulian-cities", 0, "Tarentum surrendered in 272 and keeps its own laws under a Roman garrison; Arpi and the Daunians have been allies since 326. All send men and ships to Rome's wars.", -15, "Tarentum has a Roman garrison in its citadel and remembers Pyrrhus."],
];

/**
 * The offices of 270 BCE, and a ladder to climb them (scenario v28).
 *
 * The scenario had four offices in the whole world, so every station below a
 * head of state -- a senator, a praetor, a priest, a council elder -- was
 * somebody with no office at all, weighed against his whole power's authority
 * for speaking in a debate. What follows is each power's real government, as
 * far as the period allows it to be known.
 *
 * The ladder is as the law stood in 270. Minimum ages and the order of the
 * rungs were custom, not law, until the lex Villia of 180 and Sulla: a man
 * could stand for the praetorship never having been quaestor, and the
 * aedileship was never required. What was law is the lex Genucia of 342 --
 * nobody to hold the same magistracy again within ten years -- and the orders:
 * a tribune of the plebs and a plebeian aedile had to be plebeians, one consul
 * a year had to be (since 342) and one censor a lustrum (lex Publilia, 339).
 * Custom still weighs: the voters prefer a man who has served below
 * (`sim/elections.ts`). A passed law or a dictator can set the ten years aside;
 * nothing sets aside a man's order.
 */
const CIVIL = ["social_events", "belief_set", "character_intent_set", "political_procedure_open", "political_support_set"];
const MAGISTRATE = [...CIVIL, "project_create", "project_milestone_update", "generic_entity_create", "generic_entity_update", "province_material_shift", "legitimacy_shift"];
const IMPERIUM = [...MAGISTRATE, "force_create", "force_modify", "force_engage", "political_procedure_resolve", "authority_grant_upsert", "character_create", "polity_stance_shift"];
const RULER = [...IMPERIUM, "capital_set"];

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
  { id: "req-gap-praetor-10", kind: "not_held_within_years", label: "Not praetor within ten years (lex Genucia)", params: { officeId: "roman-praetor", years: 10 } },
  { id: "req-gap-aedile-10", kind: "not_held_within_years", label: "Not curule aedile within ten years (lex Genucia)", params: { officeId: "roman-aedile", years: 10 } },
  { id: "req-gap-plebeian-aedile-10", kind: "not_held_within_years", label: "Not plebeian aedile within ten years (lex Genucia)", params: { officeId: "roman-plebeian-aedile", years: 10 } },
  { id: "req-plebeian", kind: "ordo", label: "A plebeian", params: { ordo: "plebeian" } },
  // "No citizen may hold office before he has served ten campaigns" (Polybius
  // 6.19.4) -- the rule of Polybius' own day. In 270 the ladder was custom,
  // not law (see a-career.test.ts), so no office asks it yet; a law may.
  { id: "req-ten-campaigns", kind: "min_campaigns", label: "Ten campaigns served", params: { campaigns: 10 } },
  { id: "req-carthage-polity", kind: "polity_membership", label: "Must belong to Carthage", params: { polityId: "carthage" } },
  { id: "req-syracuse-polity", kind: "polity_membership", label: "Must belong to Syracuse", params: { polityId: "syracuse" } },
  { id: "req-mamertine-polity", kind: "polity_membership", label: "Must belong to the Mamertines", params: { polityId: "mamertines" } },
  { id: "req-campanian-polity", kind: "polity_membership", label: "Must belong to the Campanians of Rhegium", params: { polityId: "rhegium-campanians" } },
];

const romanOffices = [
  office({ id: "roman-quaestor", label: "Roman quaestor", polityId: "rome", kind: "magistracy", rank: 1, seatCount: 4, termDays: 365, authorisedActionIds: MAGISTRATE, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election-tribal", eligibilityRequirementIds: [...romanReqs, "req-standing-3000"] }),
  // Elected by the plebs alone, sacrosanct, and able to forbid any magistrate's
  // act inside the city -- but not past the first milestone, nor a dictator's.
  office({ id: "roman-tribune", label: "Tribune of the plebs", polityId: "rome", kind: "magistracy", rank: 1, seatCount: 10, termDays: 365, vetoes: true, tribunician: true, authorisedActionIds: CIVIL, successionRuleId: "roman-election-plebeian", eligibilityRequirementIds: [...romanReqs, "req-plebeian", "req-standing-3000"] }),
  // The curule aediles, elected by the whole people.
  office({ id: "roman-aedile", label: "Roman aedile", polityId: "rome", kind: "magistracy", rank: 2, seatCount: 2, termDays: 365, authorisedActionIds: MAGISTRATE, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election-tribal", eligibilityRequirementIds: [...romanReqs, "req-standing-4000", "req-gap-aedile-10"] }),
  // The plebs' own aediles, older than the curule pair, chosen in its council.
  office({ id: "roman-plebeian-aedile", label: "Plebeian aedile", polityId: "rome", kind: "magistracy", rank: 2, seatCount: 2, termDays: 365, authorisedActionIds: MAGISTRATE, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election-plebeian", eligibilityRequirementIds: [...romanReqs, "req-plebeian", "req-standing-4000", "req-gap-plebeian-aedile-10"] }),
  office({ id: "roman-praetor", label: "Roman praetor", polityId: "rome", kind: "magistracy", rank: 3, seatCount: 1, termDays: 365, authorisedActionIds: IMPERIUM, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election-centuriate", eligibilityRequirementIds: [...romanReqs, "req-standing-5000", "req-gap-praetor-10"] }),
  office({ id: "roman-censor", label: "Roman censor", polityId: "rome", kind: "magistracy", rank: 5, seatCount: 2, termDays: 548, cycleDays: 1_826, ordoSeats: { plebeian: 1 }, authorisedActionIds: MAGISTRATE, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "roman-election-centuriate", eligibilityRequirementIds: [...romanReqs, "req-standing-7500"] }),
  // Named by a consul on the Senate's word, for six months, over everyone: a
  // consular, by the law that made the office.
  office({ id: "roman-dictator", label: "Roman dictator", polityId: "rome", kind: "magistracy", rank: 6, termDays: 182, authorisedActionIds: RULER, treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], successionRuleId: "roman-dictatorship", eligibilityRequirementIds: [...romanReqs, "req-held-consul"] }),
  // The censors' roll: the men who had held a curule office or the plebs'
  // aedileship, and whomever else they thought fit.
  office({ id: "roman-senator", label: "Roman senator", polityId: "rome", kind: "membership", seatCount: 300, enrolsFormerMagistrates: true, enrolsFromRank: 2, authorisedActionIds: CIVIL, successionRuleId: "roman-enrolment", eligibilityRequirementIds: romanReqs }),
  // Six to a legion, twenty-four for the four legions of a year. Since 311 the
  // people elected sixteen in the tribes, and the consuls named the rest, the
  // "rufuli": an elected college a consul may add to. An officer of the legion
  // he is posted to, with no command of his own but what his consul gives him.
  office({ id: "roman-military-tribune", label: "Military tribune", polityId: "rome", kind: "membership", seatCount: 16, termDays: 365, authorisedActionIds: ["social_events", "belief_set", "character_intent_set", "political_support_set"], successionRuleId: "roman-military-tribunes", eligibilityRequirementIds: [...romanReqs, "req-standing-3000"] }),
  office({ id: "roman-pontifex-maximus", label: "Pontifex maximus", polityId: "rome", kind: "priesthood", authorisedActionIds: CIVIL, successionRuleId: "roman-cooptation", eligibilityRequirementIds: romanReqs }),
  office({ id: "roman-pontiff", label: "Roman pontiff", polityId: "rome", kind: "priesthood", seatCount: 9, ordoSeats: { plebeian: 4 }, authorisedActionIds: CIVIL, successionRuleId: "roman-cooptation", eligibilityRequirementIds: romanReqs }),
  // An augur who saw bad omens could stop an assembly meeting that day. Five of
  // the nine places were the plebeians' since the lex Ogulnia.
  office({ id: "roman-augur", label: "Roman augur", polityId: "rome", kind: "priesthood", seatCount: 9, ordoSeats: { plebeian: 5 }, vetoes: true, authorisedActionIds: CIVIL, successionRuleId: "roman-cooptation", eligibilityRequirementIds: romanReqs }),
  office({ id: "roman-vestal", label: "Vestal", polityId: "rome", kind: "priesthood", seatCount: 6, authorisedActionIds: ["social_events", "belief_set", "character_intent_set"], successionRuleId: "roman-vestal-choice", eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-not-disqualified", "req-free-born", "req-female"] }),
];

const carthaginianReqs = ["req-alive", "req-carthage-polity", "req-not-disqualified", "req-free-born", "req-male"];

/** Departments the world opens with (v35): formed long ago, and as experienced as a department can be. */
const seeded = (id: string, polityId: string, name: string, levers: string[], officeIds: string[], extra: { headOfficeId?: string; gates?: { institutionId: string; act: string }[] } = {}) => ({
  id, scope: { kind: "polity", id: polityId }, name, levers, officeIds,
  headOfficeId: extra.headOfficeId ?? null, deputyOfficeIds: [], pay: "honorary",
  foundedAtStep: 0, formsAtStep: 0, experienceDays: 3_600, countedAtStep: 0,
  mechanicRuleId: null, standingEntityId: null, effects: [], gates: extra.gates ?? [], origin: "scenario", abolishedAtStep: null,
});
const SEEDED_DEPARTMENTS = [
  // The quaestors kept the treasury in the temple of Saturn, and paid out
  // nothing the Senate had not voted.
  seeded("rome-aerarium", "rome", "The Treasury of Saturn", ["tax_roll"], ["roman-quaestor"], { gates: [{ institutionId: "roman-senate", act: "spend" }] }),
  // The census, the rolls of the tribes, and the public contracts let every
  // five years -- the roads, the sewers, the collection of the rents.
  seeded("rome-censorship", "rome", "The Censorship", ["audit", "public_works_cost"], ["roman-censor"], { gates: [{ institutionId: "roman-senate", act: "spend" }] }),
  // The markets and the corn of the city.
  seeded("rome-aediles", "rome", "The Aediles", ["grain"], ["roman-aedile", "roman-plebeian-aedile"]),
  seeded("rome-praetor", "rome", "The Urban Praetor's Court", ["courts"], ["roman-praetor"], { headOfficeId: "roman-praetor" }),
  seeded("rome-pontiffs", "rome", "The College of Pontiffs", ["public_rites"], ["roman-pontiff"], { headOfficeId: "roman-pontifex-maximus" }),
  // Carthage's revenues were counted by its own officers of the accounts, and
  // spent as the elders allowed.
  seeded("carthage-accounts", "carthage", "The Office of the Accounts", ["tax_roll", "public_works_cost"], ["carthaginian-accountant"], { gates: [{ institutionId: "carthaginian-council", act: "spend" }] }),
  // The court of the council that judged the generals when they came home.
  seeded("carthage-hundred-and-four", "carthage", "The Hundred and Four", ["courts"], ["carthaginian-judge"], { gates: [{ institutionId: "carthaginian-hundred-and-four", act: "judge_commander" }] }),
  seeded("carthage-priests", "carthage", "The Priests of Baal Hammon", ["public_rites"], ["carthaginian-priest"]),
];
const otherPowersOffices = [
  // Two suffetes a year, elected by the citizens: Carthage's consuls.
  office({ id: "carthaginian-suffete", label: "Carthaginian suffete", polityId: "carthage", kind: "magistracy", rank: 2, seatCount: 2, termDays: 365, authorisedActionIds: IMPERIUM, treasuryAccountId: "carthage-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "carthaginian-election", eligibilityRequirementIds: [...carthaginianReqs, "req-standing-6000"] }),
  office({ id: "carthaginian-elder", label: "Carthaginian elder", polityId: "carthage", kind: "membership", seatCount: 30, enrolsFormerMagistrates: true, authorisedActionIds: CIVIL, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: carthaginianReqs }),
  // The court that judged generals, drawn from the council.
  office({ id: "carthaginian-judge", label: "Judge of the Hundred and Four", polityId: "carthage", kind: "membership", seatCount: 104, authorisedActionIds: CIVIL, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: carthaginianReqs }),
  // Punic inscriptions name a chief of the accounts, the rab mahshabim, over
  // the city's revenues: the office Hannibal would fight as suffete.
  office({ id: "carthaginian-accountant", label: "Officer of the Accounts", polityId: "carthage", kind: "magistracy", rank: 1, seatCount: 3, authorisedActionIds: MAGISTRATE, treasuryAccountId: "carthage-treasury", treasuryPermissions: ["view", "propose_spending"], successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: carthaginianReqs }),
  office({ id: "carthaginian-priest", label: "Priest of Baal Hammon", polityId: "carthage", kind: "priesthood", seatCount: 10, authorisedActionIds: CIVIL, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: carthaginianReqs }),
  office({ id: "syracusan-friend", label: "Friend of the King of Syracuse", polityId: "syracuse", kind: "membership", seatCount: 20, authorisedActionIds: CIVIL, successionRuleId: "syracusan-appointment", eligibilityRequirementIds: ["req-alive", "req-syracuse-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "syracusan-strategos", label: "Syracusan strategos", polityId: "syracuse", kind: "magistracy", rank: 1, seatCount: 3, authorisedActionIds: IMPERIUM, successionRuleId: "syracusan-appointment", eligibilityRequirementIds: ["req-alive", "req-syracuse-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  // The eponymous priest the year was named by.
  office({ id: "syracusan-amphipolos", label: "Priest of Olympian Zeus", polityId: "syracuse", kind: "priesthood", seatCount: 1, termDays: 365, authorisedActionIds: CIVIL, successionRuleId: "syracusan-lot", eligibilityRequirementIds: ["req-alive", "req-syracuse-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "mamertine-councillor", label: "Mamertine councillor", polityId: "mamertines", kind: "membership", seatCount: 20, authorisedActionIds: CIVIL, successionRuleId: "mamertine-acclamation", eligibilityRequirementIds: ["req-alive", "req-mamertine-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "campanian-leader", label: "Leader of the Campanians at Rhegium", polityId: "rhegium-campanians", kind: "magistracy", rank: 1, authorisedActionIds: RULER, successionRuleId: "campanian-acclamation", eligibilityRequirementIds: ["req-alive", "req-campanian-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
  office({ id: "campanian-councillor", label: "Campanian councillor", polityId: "rhegium-campanians", kind: "membership", seatCount: 20, authorisedActionIds: CIVIL, successionRuleId: "campanian-acclamation", eligibilityRequirementIds: ["req-alive", "req-campanian-polity", "req-not-disqualified", "req-not-enslaved", "req-male"] }),
];

/**
 * Everybody else on the map: a ruler, a council, a priesthood each. Crude --
 * a Greek league is not a Gaulish tribe -- but without it a player who is a
 * chieftain of the Boii or a councillor of Epirus has no office to hold.
 */
const templatePolities: readonly (readonly [string, string])[] = [
  ...italianPolities,
  ...PUNIC_WARS_GRAPH_POLITIES.filter((polity) => !AUTHORED_POLITY_IDS.has(polity.polityId)).map((polity) => [polity.polityId, polity.name] as const),
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
    provinceCount: { min: PUNIC_WARS_GRAPH_PROVINCES.length, max: PUNIC_WARS_GRAPH_PROVINCES.length },
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
        // Only once one of them is actually there.
        forcesPresent: [{ polityIds: ["rome", "carthage"], provinceId: PUNIC_IDS.messana }],
      },
      target: { polityId: "rome", provinceId: PUNIC_IDS.messana, otherPolityId: "carthage" },
      brief: "A protector has been asked for at Messana, and one of the great powers has moved -- a garrison put ashore, a fleet standing into the strait, a magistrate sent to take the city's submission. The other will not have it: the strait is three miles wide and whoever holds both sides of it holds everything that passes. The power that crossed is named below. Decide what the other did about it, and who in each government carried the argument. Open the war itself with \"agreement_open\" of kind \"war\" between rome and carthage, record the breaking as a public fact naming both powers and Messana, and give the men who pushed for it a \"character_intent_set\". Do not fight it here -- opening it is the whole of this, and the campaign belongs to the people who will have to make it.",
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
    // The age away from Italy (v43).
    ...WORLD_PRESSURES,
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
      // Skirmishers who fight at a distance and run before they are caught:
      // the velites, Balearic slingers, Cretan archers, the levies of Asia
      // (v42). Little in a stand-up fight, quick, and first to give way.
      { id: "light-infantry", label: "Light infantry", combatWeightBps: 7_000, steadinessBps: 4_500, mobilityBps: 7_000 },
      // The war elephants of the successor kings (v42), counted by the beast.
      // A head is never worth more than the baseline here, so what an elephant
      // does to horse that have never seen one is its power's doctrine's to
      // say; what the category says is that a wounded one turns on its own
      // side as readily as on the enemy.
      { id: "elephant", label: "Elephants", combatWeightBps: 9_500, steadinessBps: 3_500, mobilityBps: 5_000 },
    ],
    routineTactics: [{ id: "hold-ground", label: "Hold prepared ground", factor: "cohesion", phases: ["engagement"], modifierBps: 500 }],
    phases: ["contact", "engagement", "cohesion", "withdrawal", "aftermath"], routCohesionBps: 2_000, arrearsMoralePeriods: 1, arrearsDesertionPeriods: 2,
  },
  government: {
    offices: [{ id: "roman-consul", label: "Roman consul", polityId: "rome", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "rome-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-election-centuriate", eligibilityRequirementIds: [...romanReqs, "req-standing-6000", "req-gap-consul-10"], ordoSeats: { plebeian: 1 }, termDays: 365, kind: "magistracy", rank: 4 },
      // The other powers' heads. Without an office a king of Syracuse
      // negotiating for Syracuse was recorded as insubordinate, which made
      // every foreign government's ordinary business a breach.
      { id: "syracusan-king", label: "King of Syracuse", polityId: "syracuse", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "syracuse-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "syracusan-succession", eligibilityRequirementIds: ["req-alive", "req-not-disqualified"], kind: "magistracy", rank: 3 },
      { id: "mamertine-leader", label: "Leader of the Mamertines", polityId: "mamertines", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "mamertine-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "mamertine-acclamation", eligibilityRequirementIds: ["req-alive", "req-not-disqualified"], kind: "magistracy", rank: 2 },
      { id: "carthaginian-strategos", label: "Carthaginian commander in Sicily", polityId: "carthage", authorisedActionIds: ["force_create", "force_modify", "project_create", "project_milestone_update", "character_create", "authority_grant_upsert", "character_intent_set", "polity_stance_shift", "social_events", "political_procedure_open", "political_procedure_resolve", "political_support_set", "legitimacy_shift", "province_material_shift", "generic_entity_create", "generic_entity_update", "force_engage", "belief_set"], sponsorableCategories: [], treasuryAccountId: "carthage-treasury", treasuryPermissions: ["view", "propose_spending", "spend_without_vote"], incomeSourceId: null, expectedBlocId: null, successionRuleId: "carthaginian-appointment", eligibilityRequirementIds: ["req-alive", "req-not-disqualified"] },
      ...romanOffices,
      ...otherPowersOffices,
      ...templateOffices,
    ],
    successionRules: [
      // The Senate elected nobody. Consuls, praetors and censors were chosen
      // by the people voting in their centuries; quaestors, aediles and the
      // tribunes of the plebs by the people voting in their tribes.
      { id: "roman-election-centuriate", label: "Election by the Centuriate Assembly", kind: "elective", institutionId: "roman-comitia-centuriata" },
      { id: "roman-election-tribal", label: "Election by the Tribal Assembly", kind: "elective", institutionId: "roman-comitia-tributa" },
      { id: "roman-election-plebeian", label: "Election by the Council of the Plebs", kind: "elective", institutionId: "roman-concilium-plebis" },
      { id: "roman-military-tribunes", label: "Sixteen elected in the tribes, the rest named by the consuls", kind: "elective", institutionId: "roman-comitia-tributa", appointerOfficeIds: ["roman-consul"] },
      { id: "syracusan-succession", label: "Hereditary kingship", kind: "primogeniture", institutionId: null },
      { id: "mamertine-acclamation", label: "Acclamation by the assembly of the Mamertines", kind: "elective", institutionId: "mamertine-assembly" },
      { id: "campanian-acclamation", label: "Acclamation by the assembly of the legion", kind: "elective", institutionId: "campanian-assembly" },
      { id: "carthaginian-appointment", label: "Appointment by the Council of Carthage", kind: "appointment", institutionId: null },
      { id: "carthaginian-election", label: "Election by the citizens of Carthage", kind: "elective", institutionId: "carthaginian-assembly" },
      { id: "roman-dictatorship", label: "Named by a consul on the Senate's word", kind: "appointment", institutionId: null, appointerOfficeIds: ["roman-consul"] },
      // The lex Ovinia gave the censors the roll of the Senate.
      { id: "roman-enrolment", label: "Enrolled by the censors, or by holding a magistracy", kind: "appointment", institutionId: null, appointerOfficeIds: ["roman-censor"] },
      { id: "roman-cooptation", label: "Chosen by the college", kind: "elective", institutionId: null },
      { id: "roman-vestal-choice", label: "Chosen by the pontifex maximus", kind: "appointment", institutionId: null, appointerOfficeIds: ["roman-pontifex-maximus"] },
      { id: "syracusan-appointment", label: "Appointment by the king", kind: "appointment", institutionId: null },
      { id: "syracusan-lot", label: "Chosen by lot from the great houses", kind: "elective", institutionId: null },
      { id: "template-succession", label: "Succession by custom", kind: "primogeniture", institutionId: null },
      { id: "template-appointment", label: "Chosen by the ruler and the elders", kind: "appointment", institutionId: null },
    ], decreeAuthorityCostBps: 500, decreeMinimumPrestigeBps: 2_000,
  },
  dialogue: { roleSlots: [], namePools: { roman: ["Gaius", "Lucius"], carthaginian: ["Hanno", "Hamilcar"], greek: ["Hieron", "Sosistratus"] } },
  continuity: { startingSeatCount: 1, extraPrincipalsPerPlayer: 1 },
  knowledge: [
    { id: "mamertine-crisis", summary: "In 270 BCE Hieron II's Syracuse contests the Mamertines of Messana. Rome and Carthage remain at peace, but the strait is strategically volatile.", subjectIds: ["syracuse", "mamertines", "rome", "carthage"], provinceIds: [PUNIC_IDS.messana, PUNIC_IDS.syracuse] },
    { id: "roman-italian-control", summary: "Rome governs Latium and Campania. The Etruscans, Umbrians, Picentes, Marsi and Paeligni, Samnites, Lucanians, Bruttians and the Apulian cities are its allies by foedus: their own laws, no tribute, soldiers for Rome's wars, no war or peace of their own. The Samnites, Lucanians and Bruttians were beaten only in 272; the Picentes are restless; the Messapians are still free.", subjectIds: ["rome", "samnites", "picentes", "messapians"], provinceIds: [PUNIC_IDS.rome, PUNIC_IDS.bovianum, PUNIC_IDS.asculum, PUNIC_IDS.brundisium] },
  ],
});

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
  // The allies. Leagues with an assembly and a war-leader hold together
  // better than hill peoples who answer village by village.
  samnites: 4_000,
  "marsi-paeligni": 4_000,
  "apulian-cities": 3_500,
  messapians: 3_500,
  picentes: 3_500,
  umbrians: 3_000,
  lucanians: 3_000,
  bruttians: 3_000,
  veneti: 3_500,
  cenomani: 3_000,
  insubres: 3_000,
  boii: 3_000,
  ligurians: 2_200,
};

/** Peoples the map names but nobody ever organised: loose unless said otherwise. */
const DEFAULT_COHESION = 3_000;
/** The map builder gives the powers it adds (Anatolia's) a cohesion of their own; the ones above keep theirs. */
const cohesionFor = (polityId: string): number => COHESION_BY_POLITY[polityId] ?? POLITY_META[polityId]?.cohesionBps ?? DEFAULT_COHESION;

/**
 * What sort of government each power had in 270 (scenario v33; leaders seated from v34): the seed its
 * constitution grows from (`sim/constitutions.ts`). Rome, Carthage, Syracuse,
 * the Mamertines and the Campanians of Rhegium have their chambers written out
 * below; everyone else is grown from this word, varied by a seed. A people not
 * named here is read from its cohesion -- loose peoples are confederations of
 * tribes, which is what most of the drawn world was.
 */
const GOVERNMENT_FORM_BY_POLITY: Readonly<Record<string, GovernmentForm>> = {
  rome: "oligarchic_republic",
  carthage: "oligarchic_republic",
  syracuse: "monarchy",
  mamertines: "soldier_commune",
  "rhegium-campanians": "soldier_commune",
  // Italy: the Samnites, Lucanians and Bruttians were leagues of cantons under
  // an elected meddix; the Etruscan cities a league of oligarchies.
  samnites: "league", lucanians: "league", bruttians: "league", "marsi-paeligni": "league", umbrians: "league", "etruscan-cities": "league",
  "apulian-cities": "oligarchic_republic",
  // Greece and the islands.
  "achaean-league": "league", "aetolian-league": "league", acarnania: "league", "boeotian-league": "league", "phocian-league": "league", "arcadian-league": "league", "cycladic-islanders": "league",
  athens: "popular_republic", argos: "popular_republic", "ionia-communities": "popular_republic", "aeolis-communities": "popular_republic", "ionian-islands": "popular_republic",
  massalia: "oligarchic_republic", rhodes: "oligarchic_republic", elis: "oligarchic_republic", messenia: "oligarchic_republic", megalopolis: "oligarchic_republic",
  "cretan-cities-east": "oligarchic_republic", "cretan-cities-west": "oligarchic_republic",
  // Kings.
  macedon: "monarchy", epirus: "monarchy", cyrene: "monarchy", sparta: "monarchy", "numidian-kingdoms": "monarchy", "mauretanian-peoples": "monarchy",
  garamantes: "monarchy", "illyria-ardiaei": "monarchy", "illyria-dardani": "monarchy", "illyria-taulantii": "monarchy", "thrace-odrysians": "monarchy", "thrace-getae": "monarchy",
};
const governmentFormFor = (polityId: string): GovernmentForm | null => {
  const form = GOVERNMENT_FORM_BY_POLITY[polityId] ?? POLITY_META[polityId]?.governmentForm;
  return form === undefined ? null : GovernmentFormSchema.parse(form);
};

const settlementsByProvince = new Map<string, (typeof PUNIC_WARS_GRAPH_SETTLEMENTS)[number][]>();
for (const settlement of PUNIC_WARS_GRAPH_SETTLEMENTS) {
  const at = settlementsByProvince.get(settlement.provinceId);
  if (at === undefined) settlementsByProvince.set(settlement.provinceId, [{ ...settlement }]);
  else at.push({ ...settlement });
}

/**
 * Mount Etna is an operational destination inside the province holding Messana,
 * and so is the strait: neither is a province an army can be teleported to.
 */
const POSITIONS_BY_PROVINCE: Readonly<Record<string, readonly { id: string; provinceId: string; label: string; type: "pass" | "coast"; combatModifierBps: number; capacity: number | null }[]>> = {
  [PUNIC_IDS.messana]: [
    { id: "position-mount-etna", provinceId: PUNIC_IDS.messana, label: "Mount Etna", type: "pass", combatModifierBps: 700, capacity: 3 },
    { id: "position-messana-strait", provinceId: PUNIC_IDS.messana, label: "Messana strait", type: "coast", combatModifierBps: 0, capacity: null },
  ],
};

/**
 * The opening world with somebody in every chair (`punic-wars-rulers.ts`,
 * scenario v34): the five powers written out below keep their own people, and
 * every other power that holds ground is given its ruler, seated, by name.
 */
function withFoundingPeople<T extends {
  readonly map: { readonly polities: readonly { id: string; name: string; capitalSettlementId: string | null; cohesionBps: number; governmentForm?: GovernmentForm | null }[]; readonly provinces: readonly { id: string; controllerPolityId: string | null; settlements: readonly { id: string }[] }[] };
  readonly characters: readonly unknown[];
  readonly material: { readonly accounts: readonly unknown[]; readonly officeSeats: readonly unknown[] };
}>(raw: T): unknown {
  const founding = foundingPeople(raw.map.polities, raw.map.provinces, WRITTEN_OUT, governmentFormFor);
  // The Senate's own named men, seated after the four the scenario always had.
  const senate = romanSenators(raw.material.officeSeats.filter((seat) => (seat as { officeId?: string }).officeId === "roman-senator").length);
  // Everybody else in the chairs of the five powers written out by hand (v37).
  const seatedSoFar = [...raw.material.officeSeats, ...founding.officeSeats, ...senate.officeSeats] as { officeId: string; seatIndex: number }[];
  const rosters = rosterPeople(definition.government.offices, seatedSoFar);
  return {
    ...raw,
    characters: [...raw.characters, ...founding.characters, ...senate.characters, ...rosters.characters]
      .map((character) => withFinerSkills(character as { id: string; name: string; skills: Record<string, unknown> }))
      // Every Roman is a patrician or a plebeian, by his gens.
      .map((character) => ((character as { polityId?: string }).polityId === "rome" && (character as { ordo?: string }).ordo === undefined
        ? { ...character, ordo: ordoOfRomanName((character as { name: string }).name) }
        : character)),
    material: {
      ...raw.material,
      accounts: [...raw.material.accounts, ...founding.accounts, ...senate.accounts, ...rosters.accounts],
      officeSeats: [...raw.material.officeSeats, ...founding.officeSeats, ...senate.officeSeats, ...rosters.officeSeats],
    },
  };
}
const WRITTEN_OUT: ReadonlySet<string> = new Set(["rome", "carthage", "syracuse", "mamertines", "rhegium-campanians"]);

const unformedWorld: WorldState = WorldStateSchema.parse(withFoundingPeople({
  schemaVersion: 3,
  pins: { scenarioId: PUNIC_WARS_SCENARIO_ID, scenarioVersion: 43, libraryVersion: 1 },
  elapsedStep: 0,
  instant: { day: 0, minute: 0 },
  map: {
    settlementCatalogueVersion: 40,
    polities: [
      // 35 a month for every thousand men (v30), so the Republic can keep
      // twenty thousand under arms -- two consular armies, as it did -- for
      // 700 of its ~1 300 a month rather than nearly all of it. The other half
      // of every consular army is allies, who come armed and paid by their own.
      { id: "rome", name: "Roman Republic", headOfficeId: "roman-consul", capitalSettlementId: "settlement-rome", cohesionBps: cohesionFor("rome"), soldierPayPerThousand: 35, governmentForm: governmentFormFor("rome") },
      { id: "carthage", name: "Carthage", headOfficeId: "carthaginian-strategos", capitalSettlementId: "settlement-carthage", cohesionBps: cohesionFor("carthage"), governmentForm: governmentFormFor("carthage"), commandTenure: "indefinite_answerable" },
      { id: "syracuse", name: "Kingdom of Syracuse", capitalSettlementId: "settlement-syracuse", cohesionBps: cohesionFor("syracuse"), governmentForm: governmentFormFor("syracuse") },
      { id: "mamertines", name: "Mamertines of Messana", capitalSettlementId: "settlement-messana", cohesionBps: cohesionFor("mamertines"), governmentForm: governmentFormFor("mamertines") },
      // The Campanian legion sent to garrison Rhegium killed the citizens and
      // kept the city -- the same thing the Mamertines did at Messana, in the
      // same decade. Filing them under Rome made the Republic unable to attack
      // them at all: two forces of one power will not fight each other, so the
      // assault on Rhegium was refused by the engine and the siege could never
      // end. They are what they actually were: a power holding a city.
      { id: "rhegium-campanians", name: "Campanian legion of Rhegium", capitalSettlementId: "settlement-rhegium", cohesionBps: cohesionFor("rhegium-campanians"), governmentForm: governmentFormFor("rhegium-campanians") },
      ...italianPolities.map(([id, name]) => ({ id, name, capitalSettlementId: PUNIC_WARS_GRAPH_POLITIES.find((polity) => polity.polityId === id)?.capitalSettlementId ?? null, cohesionBps: cohesionFor(id), governmentForm: governmentFormFor(id) })),
      // Everyone else who holds ground on this map: the Gaulish and Iberian
      // peoples, the Britons, the Germanic and Illyrian and Thracian
      // communities, the Greek leagues and cities, Macedon, Epirus, the
      // Numidian and Mauretanian kingdoms. They were drawn for as long as the
      // map has existed; until now none of them was written down, so nothing in
      // the simulation could see, name, or answer them.
      ...PUNIC_WARS_GRAPH_POLITIES
        .filter((polity) => !AUTHORED_POLITY_IDS.has(polity.polityId))
        .map((polity) => ({ id: polity.polityId, name: polity.name, capitalSettlementId: polity.capitalSettlementId, cohesionBps: cohesionFor(polity.polityId), governmentForm: governmentFormFor(polity.polityId) })),
    ],
    politicalRelations: [],
    // The whole map, exactly as the asset draws it: every drawn settlement is
    // in the world (else it is visible and clickable and impossible to besiege)
    // and no undrawn one is invented.
    provinces: PUNIC_WARS_GRAPH_PROVINCES.map((province) => ({
      id: province.id,
      name: province.name,
      formerNames: [...province.formerNames],
      terrainId: province.terrainId,
      areaKm2: province.areaKm2,
      geo: province.geo,
      settlements: settlementsByProvince.get(province.id) ?? [],
      ...(POSITIONS_BY_PROVINCE[province.id] === undefined ? {} : { positions: POSITIONS_BY_PROVINCE[province.id] }),
      controllerPolityId: province.controllerPolityId,
      controlFirmnessBps: province.controlFirmnessBps,
    })),
    edges: PUNIC_WARS_GRAPH_EDGES,
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
    { id: "gaius-genucius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }], name: "Gaius Genucius Clepsina", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: PUNIC_IDS.rome, polityId: "rome", ageYearsAtStart: 45, officeId: "roman-consul", personalAccountId: "gaius-purse", skills: { martial: 65, intrigue: 40, learning: 50, piety: 45, stewardship: 55, diplomacy: 60, body: 65, subSkills: {} }, traits: ["dutiful", "disciplined"], healthBps: 9_000, prestigeBps: 7_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // Genucius's colleague for 270 (scenario v29). Rome's two consuls sat
    // alone for twenty-eight versions with the second chair empty; Blasio, a
    // patrician Cornelius, held it that year, and was consul again in 257 and
    // censor after. He keeps the city while Genucius takes the army south.
    { id: "gnaeus-cornelius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }], name: "Gnaeus Cornelius Blasio", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: PUNIC_IDS.rome, polityId: "rome", ageYearsAtStart: 42, officeId: "roman-consul", personalAccountId: "blasio-purse", skills: { martial: 55, intrigue: 50, learning: 55, piety: 55, stewardship: 65, diplomacy: 60, body: 55, subSkills: {} }, traits: ["ambitious", "methodical"], healthBps: 9_000, prestigeBps: 7_000, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // Carthage is a real party watching the Messana crisis, not a passive
    // name on the map: an active goal and plot (character-sim phase 3) give
    // Hanno explicit scenario relevance from the opening turn, and the
    // pressure names why it is on his mind now rather than as flavor text.
    { id: "hanno-carthage", name: "Hanno of Carthage", cultureId: "carthaginian", faithId: "faith-punic", dynastyId: null, locationProvinceId: PUNIC_IDS.carthage, polityId: "carthage", ageYearsAtStart: 48, officeId: "carthaginian-strategos", personalAccountId: "hanno-purse", skills: { martial: 55, intrigue: 65, learning: 50, piety: 50, stewardship: 70, diplomacy: 65, body: 55, subSkills: {} }, traits: ["ambitious", "deceitful"], mind: { drives: { security: 55, status: 65, wealth: 60, family: 40, faith: 35, duty: 45, revenge: 30 }, temperament: { boldness: 55, caution: 50, honesty: 35, sociability: 55, discipline: 45, cruelty: 40 }, riskTolerance: 55, values: [], taboos: [], currentPressures: ["hanno-pressure-messana"] }, healthBps: 8_500, prestigeBps: 7_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null },
    // A cautious, status-conscious ruler measuring every move against the Mamertine threat -- an authored
    // mind and relationship state (character-sim phase 2), demonstrating the fields without hardcoding
    // engine behavior to them: the simulation still reads Hieron II through the same canonical schema
    // every other character uses.
    { id: "hieron-ii", name: "Hieron II", cultureId: "greek", faithId: "faith-greek", dynastyId: null, locationProvinceId: PUNIC_IDS.syracuse, polityId: "syracuse", ageYearsAtStart: 38, officeId: "syracusan-king", personalAccountId: "hieron-purse", skills: { martial: 70, intrigue: 55, learning: 60, piety: 55, stewardship: 60, diplomacy: 65, body: 65, subSkills: {} }, traits: ["cautious", "dutiful"], mind: { drives: { security: 65, status: 70, wealth: 50, family: 50, faith: 45, duty: 70, revenge: 30 }, temperament: { boldness: 35, caution: 75, honesty: 55, sociability: 55, discipline: 65, cruelty: 30 }, riskTolerance: 30, values: ["dutiful"], taboos: ["deceitful"], currentPressures: ["mamertine-pressure-hieron"] }, healthBps: 9_000, prestigeBps: 7_500, relations: [{ subjectCharacterId: "mamertine-spokesman", causes: [{ id: "hieron-mamertine-rivalry", label: "The Mamertines seized Messana from Syracuse by treachery.", score: -18, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -25, fear: 10, respect: -5 } }] }], ambitions: [{ id: "secure-sicily", label: "Secure Syracuse against the Mamertines", kind: "peace", targetId: "mamertines", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // A bold, embattled spokesman under active military pressure -- distinct temperament and drives
    // from Hieron II despite a similar martial skill, so their dialogue and any future decisions read
    // as different people under different pressure, not palette-swapped stat blocks.
    { id: "mamertine-spokesman", name: "Statius Mettius", cultureId: "italic", faithId: "faith-italic", dynastyId: null, locationProvinceId: PUNIC_IDS.messana, polityId: "mamertines", ageYearsAtStart: 35, officeId: "mamertine-leader", personalAccountId: "mamertine-purse", skills: { martial: 60, intrigue: 45, learning: 35, piety: 45, stewardship: 45, diplomacy: 50, body: 70, subSkills: {} }, traits: ["bold", "vengeful"], mind: { drives: { security: 70, status: 45, wealth: 40, family: 55, faith: 40, duty: 55, revenge: 55 }, temperament: { boldness: 70, caution: 30, honesty: 50, sociability: 45, discipline: 40, cruelty: 45 }, riskTolerance: 70, values: [], taboos: [], currentPressures: ["mamertine-pressure-spokesman"] }, healthBps: 8_500, prestigeBps: 5_500, relations: [{ subjectCharacterId: "hieron-ii", causes: [{ id: "mamertine-hieron-fear", label: "Syracusan forces press their border at Messana.", score: -12, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { fear: 30, trust: -10 } }] }], ambitions: [{ id: "hold-messana", label: "Hold Messana", kind: "restoration", targetId: "settlement-messana", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // The men who actually held Rome, Syracuse and Carthage in 270 BCE, so the
    // opening world is a political situation rather than one consul and three
    // placeholders. Each is here because the year gives them something to be
    // doing: Dentatus has an aqueduct half-built and the standing of a man who
    // beat Pyrrhus, Ogulnius has the coinage question, Vibellius is holding
    // Rhegium against the Republic that means to take it back. Ages are at the
    // scenario's opening; where a man's exact role in 270 is not recorded, his
    // attested career in the decade around it is what he is given.
    { id: "manius-curius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }, { officeId: "roman-consul", lastHeldAtStep: 0 }, { officeId: "roman-censor", lastHeldAtStep: 0 }], name: "Manius Curius Dentatus", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: PUNIC_IDS.rome, polityId: "rome", ageYearsAtStart: 60, officeId: null, personalAccountId: "curius-purse", skills: { martial: 80, intrigue: 35, learning: 50, piety: 65, stewardship: 70, diplomacy: 55, body: 55, subSkills: {} }, traits: ["dutiful", "disciplined"], mind: { drives: { security: 50, status: 45, wealth: 20, family: 40, faith: 60, duty: 85, revenge: 20 }, temperament: { boldness: 55, caution: 55, honesty: 80, sociability: 45, discipline: 80, cruelty: 25 }, riskTolerance: 40, values: ["dutiful"], taboos: ["deceitful"], currentPressures: [] }, healthBps: 6_500, prestigeBps: 9_500, relations: [], ambitions: [{ id: "finish-the-anio", label: "See the Anio water brought into Rome", kind: "restoration", targetId: "settlement-rome", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    { id: "quintus-ogulnius", officesHeld: [{ officeId: "roman-quaestor", lastHeldAtStep: 0 }, { officeId: "roman-tribune", lastHeldAtStep: 0 }, { officeId: "roman-aedile", lastHeldAtStep: 0 }, { officeId: "roman-praetor", lastHeldAtStep: 0 }], name: "Quintus Ogulnius Gallus", cultureId: "roman", faithId: "faith-roman", dynastyId: null, locationProvinceId: PUNIC_IDS.rome, polityId: "rome", ageYearsAtStart: 47, officeId: null, personalAccountId: "ogulnius-purse", skills: { martial: 45, intrigue: 55, learning: 70, piety: 70, stewardship: 75, diplomacy: 70, body: 50, subSkills: {} }, traits: ["ambitious", "methodical"], mind: { drives: { security: 45, status: 70, wealth: 55, family: 50, faith: 60, duty: 65, revenge: 25 }, temperament: { boldness: 45, caution: 65, honesty: 60, sociability: 70, discipline: 70, cruelty: 25 }, riskTolerance: 40, values: [], taboos: [], currentPressures: ["ogulnius-pressure-coinage"] }, healthBps: 8_500, prestigeBps: 7_000, relations: [], ambitions: [{ id: "roman-silver", label: "Put Rome's own silver into the hands of its allies", kind: "wealth", targetId: "rome", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Rome's other war of 270, and the one its own historians were least proud
    // of: a Campanian legion sent to garrison Rhegium killed the citizens and
    // kept the city. Vibellius holds it still, and the Republic means to end it.
    { id: "decius-vibellius", name: "Decius Vibellius", cultureId: "italic", faithId: "faith-italic", dynastyId: null, locationProvinceId: PUNIC_IDS.rhegium, polityId: "rhegium-campanians", ageYearsAtStart: 41, officeId: "campanian-leader", personalAccountId: "vibellius-purse", skills: { martial: 65, intrigue: 60, learning: 30, piety: 30, stewardship: 40, diplomacy: 35, body: 65, subSkills: {} }, traits: ["bold", "vengeful"], mind: { drives: { security: 80, status: 55, wealth: 65, family: 35, faith: 25, duty: 20, revenge: 50 }, temperament: { boldness: 75, caution: 35, honesty: 25, sociability: 40, discipline: 35, cruelty: 70 }, riskTolerance: 75, values: [], taboos: [], currentPressures: ["vibellius-pressure-siege"] }, healthBps: 8_000, prestigeBps: 3_000, relations: [], ambitions: [{ id: "keep-rhegium", label: "Keep Rhegium and his men's necks", kind: "restoration", targetId: PUNIC_IDS.rhegium, status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Syracuse is a court, not one king: Leptines is the aristocrat whose
    // daughter Hieron married, and the reason the city accepted him at all.
    { id: "leptines-syracuse", name: "Leptines of Syracuse", cultureId: "greek", faithId: "faith-greek", dynastyId: null, locationProvinceId: PUNIC_IDS.syracuse, polityId: "syracuse", ageYearsAtStart: 58, officeId: null, personalAccountId: "leptines-purse", skills: { martial: 50, intrigue: 60, learning: 65, piety: 55, stewardship: 70, diplomacy: 75, body: 45, subSkills: {} }, traits: ["cautious", "methodical"], mind: { drives: { security: 70, status: 60, wealth: 55, family: 75, faith: 45, duty: 60, revenge: 20 }, temperament: { boldness: 35, caution: 75, honesty: 60, sociability: 70, discipline: 65, cruelty: 20 }, riskTolerance: 30, values: [], taboos: [], currentPressures: [] }, healthBps: 7_500, prestigeBps: 7_000, relations: [{ subjectCharacterId: "hieron-ii", causes: [{ id: "leptines-hieron-kin", label: "Hieron married his daughter, and rules with his house behind him.", score: 35, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: 40, affection: 30, respect: 35 } }] }], ambitions: [{ id: "keep-the-house", label: "Keep his house at the centre of Syracuse", kind: "office", targetId: "syracuse", status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
    // Carthage fights its wars through admirals, and Hannibal Gisco commanded
    // its fleets in the war that followed. In 270 he is the officer watching
    // the strait for the men who will have to decide about it.
    { id: "hannibal-gisco", name: "Hannibal Gisco", cultureId: "carthaginian", faithId: "faith-punic", dynastyId: null, locationProvinceId: PUNIC_IDS.lilybaeum, polityId: "carthage", ageYearsAtStart: 39, officeId: null, personalAccountId: "gisco-purse", skills: { martial: 70, intrigue: 45, learning: 50, piety: 45, stewardship: 55, diplomacy: 45, body: 60, subSkills: {} }, traits: ["bold", "disciplined"], mind: { drives: { security: 60, status: 60, wealth: 45, family: 45, faith: 40, duty: 70, revenge: 30 }, temperament: { boldness: 70, caution: 45, honesty: 55, sociability: 45, discipline: 70, cruelty: 40 }, riskTolerance: 60, values: [], taboos: [], currentPressures: ["gisco-pressure-strait"] }, healthBps: 9_000, prestigeBps: 6_000, relations: [], ambitions: [{ id: "hold-the-strait", label: "Keep the strait open to Carthage and shut to anyone else", kind: "other", targetId: PUNIC_IDS.messana, status: "active" }], heirCharacterId: null, alive: true, diedAtStep: null },
  ],
  continuity: [], encounters: [],
  // Carthage is named as a participant, not merely adjacent to the crisis: it
  // has its own stake in whether Messana falls to Syracuse or holds.
  storylines: [{ id: "rhegium-recovery", title: "Rhegium and the Campanian Legion", participantIds: ["gaius-genucius", "decius-vibellius", "manius-curius"], provinceId: PUNIC_IDS.rhegium, phase: "escalating", stakes: "Rome must retake a city its own garrison murdered and kept, in front of every ally watching how the Republic treats a broken oath.", history: ["The Campanian legion sent to hold Rhegium killed its citizens and took the city for itself.", "The Senate has resolved that the matter be ended."], nextDevelopment: "The consular army turns south, or the Senate finds someone else to send.", visibility: "public", updatedAtStep: 0 }, { id: "mamertine-syracusan-crisis", title: "The Messana Crisis", participantIds: ["hieron-ii", "mamertine-spokesman", "hanno-carthage"], provinceId: PUNIC_IDS.messana, phase: "escalating", stakes: "Syracuse seeks to contain the Mamertines without drawing Rome and Carthage into a wider war.", history: ["Hieron II's forces pressure the Mamertines around the Strait of Messana.", "Carthage watches the strait for any opening or threat to its own position in Sicily."], nextDevelopment: "Envoys may seek outside support if the local balance collapses.", visibility: "public", updatedAtStep: 0 }],
  conflicts: { battles: [], sieges: [], wars: [] },
  // Who is in charge of what beneath the consuls and the suffetes (v35,
  // docs/plans/departments.md). Named once, as the sources have them; every
  // other power opens with its ruler holding all of it. What Rome's consuls
  // keep is the war, the watch and the state's letters -- the Republic had no
  // ministry of any of them. Old institutions open with the ten years of
  // experience a department can have.
  departments: SEEDED_DEPARTMENTS,
  // Rome is already at war with the men holding Rhegium: the Senate has
  // resolved the matter be ended, and the army is marching. Saying so in state
  // is what lets the assault happen at all.
  polityAgreements: [...alliedItaly.map(([polityId, since, terms]) => ({
    id: `foedus-${polityId}`,
    kind: "foedus",
    polityId,
    otherPolityId: "rome",
    terms,
    sinceStep: since,
    untilStep: null,
    sourceMessageId: null,
    status: "active",
    endedAtStep: null,
    endedReason: null,
    visibility: "public",
  })), {
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
  // How far each ally trusts the power it follows. The newest allies were
  // enemies two years ago; the Picentes will rise in 269 and the Samnites'
  // last war is not quite over.
  polityStances: [
    ...alliedItaly.map(([polityId, , , trustScore, why]) => ({ polityId, towardPolityId: "rome", trustScore, lastShiftReason: why, lastShiftAtStep: 0 })),
    { polityId: "messapians", towardPolityId: "rome", trustScore: -50, lastShiftReason: "Tarentum's old allies, and the last free people of the south.", lastShiftAtStep: 0 },
  ],
  // What each power privately means to do. Secret by design -- nobody inside
  // the world reads another's -- and the reason anyone away from the player's
  // business has something to pursue at all.
  polityOutlooks: [
    { polityId: "rome", primaryObjective: "Finish the settlement of Italy on Rome's terms, and be seen to keep faith while doing it.", concerns: [{ label: "Rhegium still held by the Campanian legion", level: "high" }, { label: "the allies beaten in 272, and the restless Picentes", level: "medium" }, { label: "the Gallic peoples of the Padus", level: "medium" }, { label: "Carthage's fleets in the western sea", level: "low" }], intentions: ["recover Rhegium and make an example of its garrison", "keep the Greek cities of the south quiet by protecting them", "avoid any quarrel across the strait before Italy is settled"], riskTolerance: 55, updatedAtStep: 0, lastChangeReason: "The opening situation of 270 BCE." },
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
    // The drachma, not the denarius (first struck c. 211). In 270 the silver
    // of the western Mediterranean ran on the drachma standard: Syracuse's and
    // Carthage's Sicilian coinage, the Greek cities', and the Romano-Campanian
    // didrachms Rome is about to strike. Rome itself still counts in bronze.
    currency: { id: "drachma", name: "Drachmae", unitName: "drachma", unitNamePlural: "drachmae", symbol: "Dr" },
    accounts: [
      { id: "gaius-purse", owner: { kind: "character", id: "gaius-genucius" }, currencyId: "drachma", balance: 1_200, status: "active", visibility: "private" },
      { id: "blasio-purse", owner: { kind: "character", id: "gnaeus-cornelius" }, currencyId: "drachma", balance: 1_300, status: "active", visibility: "private" },
      { id: "hanno-purse", owner: { kind: "character", id: "hanno-carthage" }, currencyId: "drachma", balance: 1_100, status: "active", visibility: "private" },
      { id: "hieron-purse", owner: { kind: "character", id: "hieron-ii" }, currencyId: "drachma", balance: 1_000, status: "active", visibility: "private" },
      { id: "mamertine-purse", owner: { kind: "character", id: "mamertine-spokesman" }, currencyId: "drachma", balance: 700, status: "active", visibility: "private" },
      { id: "curius-purse", owner: { kind: "character", id: "manius-curius" }, currencyId: "drachma", balance: 900, status: "active", visibility: "private" },
      { id: "ogulnius-purse", owner: { kind: "character", id: "quintus-ogulnius" }, currencyId: "drachma", balance: 1_300, status: "active", visibility: "private" },
      { id: "vibellius-purse", owner: { kind: "character", id: "decius-vibellius" }, currencyId: "drachma", balance: 600, status: "active", visibility: "private" },
      { id: "leptines-purse", owner: { kind: "character", id: "leptines-syracuse" }, currencyId: "drachma", balance: 1_400, status: "active", visibility: "private" },
      { id: "gisco-purse", owner: { kind: "character", id: "hannibal-gisco" }, currencyId: "drachma", balance: 950, status: "active", visibility: "private" },
      // The powers' own chests. There were none at all: nine personal purses
      // and no treasury anywhere, so a war cost nobody anything, no office
      // could confer fiscal reach because there was nothing to reach, and
      // VISION §7's whole economy -- income, expenditure, surplus -- had no
      // subject. A republic that cannot run out of money is not a republic
      // anybody has to govern.
      { id: "rome-treasury", owner: { kind: "polity", id: "rome" }, currencyId: "drachma", balance: 9_000, status: "active", visibility: "polity" },
      { id: "carthage-treasury", owner: { kind: "polity", id: "carthage" }, currencyId: "drachma", balance: 16_000, status: "active", visibility: "polity" },
      { id: "syracuse-treasury", owner: { kind: "polity", id: "syracuse" }, currencyId: "drachma", balance: 5_200, status: "active", visibility: "polity" },
      { id: "mamertine-treasury", owner: { kind: "polity", id: "mamertines" }, currencyId: "drachma", balance: 2_500, status: "active", visibility: "polity" },
      // The chest each army carries. Empty at the opening -- nobody has taken
      // anything yet -- but real, because it is where plunder lands and what
      // an army paid out of what it takes is paid from. Without one, an order
      // about an army's own money has to be routed through its commander's
      // private purse, which is a different arrangement wearing the same coat:
      // a man's own money does not march away when he loses a battle.
      ...[
        ["roman-field-army", 400], ["campanian-legion", 260], ["carthaginian-fleet", 350],
        ["syracusan-squadron", 150], ["allied-greek-hulls", 40], ["carthaginian-garrison", 300],
        ["syracusan-army", 200], ["mamertine-garrison", 90]
      ].map(([forceId, balance]) => ({
        id: `${forceId as string}-chest`,
        owner: { kind: "force" as const, id: forceId as string },
        currencyId: "drachma",
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
      { id: "curius-sabine-farm", title: "The Sabine farm", territoryId: PUNIC_IDS.rome, legalHolderCharacterId: "manius-curius", incomeSourceId: "curius-sabine-farm-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "genucian-estates", title: "The Genucian estates", territoryId: PUNIC_IDS.rome, legalHolderCharacterId: "gaius-genucius", incomeSourceId: "genucian-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "cornelian-estates", title: "The Cornelian estates", territoryId: PUNIC_IDS.rome, legalHolderCharacterId: "gnaeus-cornelius", incomeSourceId: "cornelian-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "ogulnian-estates", title: "The Ogulnian lands in Campania", territoryId: PUNIC_IDS.capua, legalHolderCharacterId: "quintus-ogulnius", incomeSourceId: "ogulnian-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "hanno-estates", title: "Hanno's estates in the African hinterland", territoryId: PUNIC_IDS.carthage, legalHolderCharacterId: "hanno-carthage", incomeSourceId: "hanno-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "gisco-estates", title: "The Gisconid farms", territoryId: PUNIC_IDS.carthage, legalHolderCharacterId: "hannibal-gisco", incomeSourceId: "gisco-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
      { id: "leptines-estates", title: "The house of Leptines' estates", territoryId: PUNIC_IDS.syracuse, legalHolderCharacterId: "leptines-syracuse", incomeSourceId: "leptines-estates-yield", successionRuleId: "roman-household", physicalControlBps: 10_000 },
    ],
    institutions: [
      {
        id: "roman-senate",
        polityId: "rome",
        name: "Senate",
        votingBlocs: [
          { id: "patrician-bloc", name: "The patrician houses", representedInterest: "landed nobility", weight: 60, baseSupport: 20, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["nobles", "landed"] },
          { id: "popular-bloc", name: "The plebeian new men", representedInterest: "the people", weight: 40, baseSupport: -10, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons"] },
        ],
        // Former magistrates: the world's factions, clients and the landed sit here too.
        // Every chamber here decides by the votes cast. A bloc that abstains
        // is undecided, and counting it against sank a fleet 49 to none.
        franchise: "council",
        // Laid before it only by a magistrate who could convene it.
        convenedByOfficeIds: ["roman-consul", "roman-praetor", "roman-dictator", "roman-tribune"],
        totalVotingWeight: 100,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
      },
      // The assemblies of the Roman people, which elected the magistrates and
      // passed the laws. The centuries were weighted by wealth: the equites and
      // the first class held 98 of the 193 and voted first.
      {
        id: "roman-comitia-centuriata",
        polityId: "rome",
        name: "Centuriate Assembly",
        votingBlocs: [
          { id: "centuriate-first-class", name: "First class", representedInterest: "the propertied", weight: 98, baseSupport: 10, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["landed", "merchants"] },
          { id: "centuriate-lower-classes", name: "Lower classes", representedInterest: "smallholders", weight: 95, baseSupport: -5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons", "soldiers"] },
        ],
        franchise: "citizens",
        // Called only by a magistrate with imperium.
        convenedByOfficeIds: ["roman-consul", "roman-praetor", "roman-dictator"],
        totalVotingWeight: 193,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
      },
      // Thirty-three tribes since 299, four urban and twenty-nine rural, one
      // vote each: the whole people by tribes, called by a consul or praetor.
      {
        id: "roman-comitia-tributa",
        polityId: "rome",
        name: "Tribal Assembly",
        votingBlocs: [
          { id: "tribal-rural", name: "Rural tribes", representedInterest: "farmers", weight: 29, baseSupport: 5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons", "landed"] },
          { id: "tribal-urban", name: "Urban tribes", representedInterest: "the city plebs", weight: 4, baseSupport: -5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons"] },
        ],
        franchise: "citizens",
        convenedByOfficeIds: ["roman-consul", "roman-praetor", "roman-dictator"],
        totalVotingWeight: 33,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
      },
      // The same tribes without the patricians: the plebs' own council, called
      // by its tribunes. It elected the tribunes and the plebeian aediles, and
      // since the lex Hortensia of 287 what it resolved bound the whole people.
      {
        id: "roman-concilium-plebis",
        polityId: "rome",
        name: "Council of the Plebs",
        votingBlocs: [
          { id: "plebeian-rural", name: "Rural tribes", representedInterest: "plebeian farmers", weight: 29, baseSupport: 0, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons"] },
          { id: "plebeian-urban", name: "Urban tribes", representedInterest: "the city plebs", weight: 4, baseSupport: -5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons"] },
        ],
        franchise: "citizens",
        convenedByOfficeIds: ["roman-tribune"],
        powers: ["laws", "elections", "judgment"],
        totalVotingWeight: 33,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
      },
      // Carthage (v33). The council of elders -- the "senate" the Greeks and
      // Romans wrote of, some three hundred men of the great houses -- decided
      // war, peace and money; where it and the suffetes could not agree, the
      // matter went to the people, who also elected the suffetes. The Hundred
      // and Four judged the generals who came home.
      {
        id: "carthaginian-council",
        polityId: "carthage",
        name: "Council of Elders",
        votingBlocs: [
          { id: "carthage-landed-houses", name: "The landed houses", representedInterest: "the African estates", weight: 55, baseSupport: 5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["landed", "nobles"] },
          { id: "carthage-maritime-houses", name: "The maritime houses", representedInterest: "trade and the fleet", weight: 45, baseSupport: 10, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["merchants"] },
        ],
        totalVotingWeight: 100,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        powers: ["laws", "war", "taxes", "constitution"],
        advisory: false,
        franchise: "council",
        refersFailuresTo: "carthaginian-assembly",
      },
      {
        id: "carthaginian-hundred-and-four",
        polityId: "carthage",
        name: "Tribunal of the Hundred and Four",
        votingBlocs: [
          { id: "carthage-judges", name: "The judges", representedInterest: "the council's senior men", weight: 104, baseSupport: 0, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["nobles"] },
        ],
        totalVotingWeight: 104,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        powers: ["judgment"],
        advisory: false,
        franchise: "council",
      },
      {
        id: "carthaginian-assembly",
        polityId: "carthage",
        name: "Assembly of the People",
        votingBlocs: [
          { id: "carthage-propertied-citizens", name: "The propertied citizens", representedInterest: "the shopkeepers and shipowners", weight: 50, baseSupport: 5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["merchants", "landed"] },
          { id: "carthage-common-people", name: "The common people", representedInterest: "the city's poor", weight: 50, baseSupport: -5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons"] },
        ],
        totalVotingWeight: 100,
        quorumBps: 4_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        powers: ["elections", "laws", "war"],
        advisory: false,
        franchise: "citizens",
      },
      // Syracuse (v33). Hieron governed through his friends and let the
      // assembly acclaim what he had decided; neither bound him.
      {
        id: "syracusan-council",
        polityId: "syracuse",
        name: "Council of the King's Friends",
        votingBlocs: [
          { id: "syracuse-kings-friends", name: "The king's friends", representedInterest: "the crown", weight: 50, baseSupport: 20, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["crown"] },
          { id: "syracuse-old-families", name: "The old families", representedInterest: "the great houses of Syracuse", weight: 50, baseSupport: -5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["nobles", "landed"] },
        ],
        totalVotingWeight: 100,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        advisory: true,
        franchise: "council",
      },
      {
        id: "syracusan-assembly",
        polityId: "syracuse",
        name: "Assembly of the Syracusans",
        votingBlocs: [
          { id: "syracuse-citizens", name: "The citizens", representedInterest: "the people of Syracuse", weight: 100, baseSupport: 5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["commons", "merchants"] },
        ],
        totalVotingWeight: 100,
        quorumBps: 3_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        powers: ["war", "laws"],
        advisory: true,
        franchise: "citizens",
      },
      // The Mamertines (v33): Campanian mercenaries who took Messana, and
      // governed it as an army governs itself -- an assembly of the men, and
      // magistrates (meddices) they chose.
      {
        id: "mamertine-assembly",
        polityId: "mamertines",
        name: "Assembly of the Mamertines",
        votingBlocs: [
          { id: "mamertine-old-hands", name: "The old Campanian hands", representedInterest: "the men who took the city", weight: 60, baseSupport: 10, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["soldiers", "veterans"] },
          { id: "mamertine-settled-men", name: "The settled men", representedInterest: "the men who took land and wives", weight: 40, baseSupport: 0, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["soldiers", "landed"] },
        ],
        totalVotingWeight: 100,
        quorumBps: 4_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        advisory: false,
        franchise: "soldiers",
      },
      {
        id: "mamertine-council",
        polityId: "mamertines",
        name: "Council of the Mamertines",
        votingBlocs: [
          { id: "mamertine-captains", name: "The meddices and captains", representedInterest: "the officers", weight: 100, baseSupport: 5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["soldiers"] },
        ],
        totalVotingWeight: 100,
        quorumBps: 5_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        advisory: true,
        franchise: "council",
      },
      // The Campanians of Rhegium (v33): the same thing, across the strait.
      {
        id: "campanian-assembly",
        polityId: "rhegium-campanians",
        name: "Assembly of the Campanian Legion",
        votingBlocs: [
          { id: "campanian-legionaries", name: "The legionaries", representedInterest: "the men of the legion", weight: 70, baseSupport: 10, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["soldiers"] },
          { id: "campanian-officers", name: "The officers", representedInterest: "Decius's captains", weight: 30, baseSupport: 5, yesThreshold: 15, noThreshold: -15, causes: [], interests: ["soldiers", "nobles"] },
        ],
        totalVotingWeight: 100,
        quorumBps: 4_000,
        passageThresholdBps: 5_001,
        denominator: "cast",
        advisory: false,
        franchise: "soldiers",
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
      { id: "roman-consul:seat:0", officeId: "roman-consul", seatIndex: 0, holderCharacterId: "gaius-genucius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [...romanReqs, "req-standing-6000", "req-gap-consul-10"] },
      // Rome elected two consuls a year, and both chairs are filled (v29): a
      // player who declares themselves consul takes one of these men's
      // places, or puts one of them out of it.
      { id: "roman-consul:seat:1", officeId: "roman-consul", seatIndex: 1, holderCharacterId: "gnaeus-cornelius", status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [...romanReqs, "req-standing-6000", "req-gap-consul-10"] },
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
      { id: "rome-ager-publicus", kind: "land", label: "Rents of the public land", beneficiaryAccountId: "rome-treasury", originKind: "polity", originId: "rome", amount: 330, cadenceSteps: 30, nextDueStep: 30, active: true },
      // The allies pay Rome no tribute, but the land Rome took from them when
      // it beat them is Rome's, rented out or cut for timber. Each rent runs
      // through its ally's country, so a revolt cuts it off.
      { id: "rome-sila-forest", kind: "land", label: "Timber and pitch of the Sila forest, taken from the Bruttians in 272", beneficiaryAccountId: "rome-treasury", originKind: "polity", originId: "rome", counterpartyPolityId: "bruttians", amount: 150, cadenceSteps: 30, nextDueStep: 30, active: true },
      { id: "rome-samnite-land", kind: "land", label: "Rents of the land taken from the Samnites", beneficiaryAccountId: "rome-treasury", originKind: "polity", originId: "rome", counterpartyPolityId: "samnites", amount: 150, cadenceSteps: 30, nextDueStep: 30, active: true },
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
      // 147 for the 4 200 foot of a full legion at 35 a thousand, 32 for its
      // 300 horse at three times the foot's rate (Polybius 6.39: two obols a
      // day for a foot soldier, a drachma for a horseman), and 50 for the
      // allies' grain: Polybius says the allied infantry drew its ration free,
      // where a Roman had the price stopped from his pay. Their wages are their
      // own cities'. (190 until v42, for 4 000 places and no horse.)
      { id: "rome-legion-pay", kind: "army_pay", label: "Pay of the legions, and grain for their allies", payerAccountId: "rome-treasury", amount: 229, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "rome-magistracies", kind: "salary", label: "The magistracies and the public works", payerAccountId: "rome-treasury", amount: 190, cadenceSteps: 30, nextDueStep: 30, priority: 500, arrears: 0, missedPeriods: 0, active: true },
      { id: "carthage-fleet-pay", kind: "army_pay", label: "Pay of the fleet and its crews", payerAccountId: "carthage-treasury", amount: 430, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "carthage-mercenaries", kind: "army_upkeep", label: "The hired men of Libya and Iberia", payerAccountId: "carthage-treasury", amount: 520, cadenceSteps: 30, nextDueStep: 30, priority: 850, arrears: 0, missedPeriods: 0, active: true },
      { id: "syracuse-squadron-pay", kind: "army_pay", label: "Pay of the Syracusan squadron", payerAccountId: "syracuse-treasury", amount: 210, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "mamertine-soldiery", kind: "army_pay", label: "The soldiery that holds Messana", payerAccountId: "mamertine-treasury", amount: 120, cadenceSteps: 30, nextDueStep: 30, priority: 950, arrears: 0, missedPeriods: 0, active: true },
      // Hieron's hoplites and the allied hulls Rome sails on had no wages at
      // all: `syracuse-squadron-pay` covers the forty triremes and nothing
      // else, and `rome-legion-pay` the field army and nothing else. Priced
      // off this scenario's own rates -- 0.075 a man a month, as the legions
      // were paid until v30 (now Rome's 35 a thousand, on its 4 000 places)
      // and the Mamertine mercenaries still are, and a fraction of a
      // warship's pay for transports the allied cities crew and maintain
      // themselves, Rome bearing only their victualling in the field.
      { id: "syracuse-army-pay", kind: "army_pay", label: "Pay of the Syracusan army", payerAccountId: "syracuse-treasury", amount: 225, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true },
      { id: "rome-allied-hulls", kind: "army_upkeep", label: "Victualling of the allied hulls", payerAccountId: "rome-treasury", amount: 40, cadenceSteps: 30, nextDueStep: 30, priority: 800, arrears: 0, missedPeriods: 0, active: true },
    ],
    forces: [
      // A consular army was half allies: Latin and Italian cohorts raised,
      // armed and paid by their own cities under the foedus and led by Roman
      // prefects. Rome owes the legionaries their pay and the allies only their
      // grain, which is why the pay below is more than 4 000 men at 35 a thousand.
      //
      // One legion and one ala, as Polybius 6.21 and 6.26 count them (v42):
      // 3 000 hastati, principes and triarii, 1 200 velites and 300 horse, the
      // allies a little under strength, as allied contingents usually were. It had no
      // horse and no velites before, which no consular army ever lacked. The
      // establishment (`punic-wars-establishments.ts`) draws it up as Legio I
      // and the first Ala of the allies on the first morning.
      { id: "roman-field-army", name: "Roman field army", polityId: "rome", commanderCharacterId: "gaius-genucius", controllerCharacterId: "gaius-genucius", locationId: PUNIC_IDS.rome, authorizedStrength: 9_600, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_000, unavailable: [] }, { categoryId: "light-infantry", label: "Velites", fit: 1_200, unavailable: [] }, { categoryId: "cavalry", label: "Roman horse", fit: 300, unavailable: [] }, { categoryId: "infantry", label: "Allied infantry", fit: 3_520, unavailable: [] }, { categoryId: "cavalry", label: "Allied horse", fit: 840, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "rome-legion-pay", payArrearsPeriods: 0, history: [] },
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
      { id: "campanian-legion", name: "Campanian legion of Rhegium", polityId: "rhegium-campanians", commanderCharacterId: "decius-vibellius", controllerCharacterId: "decius-vibellius", locationId: PUNIC_IDS.rhegium, authorizedStrength: 4_000, personnel: [{ categoryId: "infantry", label: "Campanian mercenaries", fit: 3_600, unavailable: [] }], moraleBps: 6_500, cohesionBps: 7_000, fatigueBps: 1_000, provisionStatus: "shortage", provisionedThroughStep: 120, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "carthaginian-fleet", name: "Carthaginian fleet", polityId: "carthage", commanderCharacterId: "hannibal-gisco", controllerCharacterId: "hannibal-gisco", locationId: PUNIC_IDS.lilybaeum, authorizedStrength: 120, personnel: [{ categoryId: "warship", label: "Quinqueremes", fit: 110, unavailable: [] }], moraleBps: 8_000, cohesionBps: 7_500, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "carthage-fleet-pay", payArrearsPeriods: 0, history: [] },
      { id: "syracusan-squadron", name: "Syracusan squadron", polityId: "syracuse", commanderCharacterId: "leptines-syracuse", controllerCharacterId: "leptines-syracuse", locationId: PUNIC_IDS.syracuse, authorizedStrength: 40, personnel: [{ categoryId: "warship", label: "Triremes", fit: 35, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "syracuse-squadron-pay", payArrearsPeriods: 0, history: [] },
      { id: "allied-greek-hulls", name: "Allied Greek hulls", polityId: "rome", commanderCharacterId: "gaius-genucius", controllerCharacterId: "gaius-genucius", locationId: PUNIC_IDS.rhegium, authorizedStrength: 20, personnel: [{ categoryId: "warship", label: "Allied transports", fit: 18, unavailable: [] }], moraleBps: 6_500, cohesionBps: 6_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "rome-allied-hulls", payArrearsPeriods: 0, history: [] },
      // Carthage fought by nations (v42): Libyan subjects for the heavy foot,
      // Numidian horse, Balearic slingers, and hired Iberians and Gauls, each
      // under its own captains. It was "Infantry 3 000" before. The same men,
      // in the contingents the establishment draws them up in.
      { id: "carthaginian-garrison", name: "Carthaginian field force", polityId: "carthage", commanderCharacterId: "hanno-carthage", controllerCharacterId: "hanno-carthage", locationId: PUNIC_IDS.carthage, authorizedStrength: 3_500, personnel: [{ categoryId: "infantry", label: "Libyan foot", fit: 1_500, unavailable: [] }, { categoryId: "cavalry", label: "Numidian horse", fit: 400, unavailable: [] }, { categoryId: "light-infantry", label: "Balearic slingers", fit: 300, unavailable: [] }, { categoryId: "infantry", label: "Iberian mercenaries", fit: 500, unavailable: [] }, { categoryId: "infantry", label: "Gallic mercenaries", fit: 300, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "carthage-mercenaries", payArrearsPeriods: 0, history: [] },
      // Hieron's army after he was rid of the old mercenaries (Polybius 1.9,
      // v42): the citizen hoplites he raised, the new hired men he could trust,
      // and the horse of the well-born.
      { id: "syracusan-army", name: "Syracusan army", polityId: "syracuse", commanderCharacterId: "hieron-ii", controllerCharacterId: "hieron-ii", locationId: PUNIC_IDS.syracuse, authorizedStrength: 3_000, personnel: [{ categoryId: "infantry", label: "Hoplites", fit: 2_000, unavailable: [] }, { categoryId: "infantry", label: "Mercenaries", fit: 700, unavailable: [] }, { categoryId: "cavalry", label: "Syracusan horse", fit: 300, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "syracuse-army-pay", payArrearsPeriods: 0, history: [] },
      { id: "mamertine-garrison", name: "Mamertine garrison", polityId: "mamertines", commanderCharacterId: "mamertine-spokesman", controllerCharacterId: "mamertine-spokesman", locationId: PUNIC_IDS.messana, authorizedStrength: 1_600, personnel: [{ categoryId: "infantry", label: "Mercenaries", fit: 1_400, unavailable: [] }], moraleBps: 7_000, cohesionBps: 7_000, fatigueBps: 1_000, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "mamertine-soldiery", payArrearsPeriods: 0, history: [] },
      // The Hellenistic kingdoms opened with no army at all, which made the
      // three richest powers on the map the three most defenceless (v42).
      // Each now has a standing field army under its king -- not its full war
      // strength, which in the next fifty years ran to 60 000 and more at
      // Raphia, but the guard, the hired men and the part of the phalanx under
      // arms in a year of peace, the First Syrian War just over. Nobody pays
      // them yet, and truthfully: these kingdoms keep no treasury in the
      // scenario (`findPayProblems` asks only that a power with a chest pay its
      // armies from it), and their pay comes when their chests do.
      //
      // Antigonus Gonatas' army at Pella: veterans of Lysimachia (277) and of
      // the war with Pyrrhus that ended at Argos in 272.
      { id: "macedonian-royal-army", name: "Macedonian royal army", polityId: "macedon", commanderCharacterId: knownRulerId("macedon"), controllerCharacterId: knownRulerId("macedon"), locationId: PUNIC_IDS.pella, authorizedStrength: 14_000, personnel: [{ categoryId: "infantry", label: "Phalangites", fit: 7_000, unavailable: [] }, { categoryId: "infantry", label: "Hypaspists", fit: 2_000, unavailable: [] }, { categoryId: "cavalry", label: "Companion horse", fit: 800, unavailable: [] }, { categoryId: "light-infantry", label: "Thracian and Illyrian light troops", fit: 1_500, unavailable: [] }, { categoryId: "infantry", label: "Gallic mercenaries", fit: 2_000, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
      // Antiochus I's at Apamea, the Seleucid war-capital where the elephants
      // and the royal stud were kept (Strabo 16.2.10). The king himself is at
      // Antioch, a few days' march down the Orontes.
      { id: "seleucid-royal-army", name: "Seleucid royal army", polityId: "seleucid-empire", commanderCharacterId: knownRulerId("seleucid-empire"), controllerCharacterId: knownRulerId("seleucid-empire"), locationId: PUNIC_IDS.apamea, authorizedStrength: 17_000, personnel: [{ categoryId: "infantry", label: "Phalangites of the settlers", fit: 8_000, unavailable: [] }, { categoryId: "infantry", label: "Foot of the guard", fit: 2_000, unavailable: [] }, { categoryId: "cavalry", label: "Agema horse", fit: 500, unavailable: [] }, { categoryId: "cavalry", label: "Companion horse", fit: 1_000, unavailable: [] }, { categoryId: "infantry", label: "Greek and Galatian mercenaries", fit: 2_000, unavailable: [] }, { categoryId: "light-infantry", label: "Archers and slingers of Asia", fit: 2_000, unavailable: [] }, { categoryId: "cavalry", label: "Median horse", fit: 500, unavailable: [] }, { categoryId: "elephant", label: "Indian elephants", fit: 60, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
      // Ptolemy II's at Alexandria, and the greatest fleet of the age in its
      // harbour -- a part of it: the rest kept the Aegean islands and the
      // Syrian coast.
      { id: "ptolemaic-royal-army", name: "Ptolemaic royal army", polityId: "ptolemaic-egypt", commanderCharacterId: knownRulerId("ptolemaic-egypt"), controllerCharacterId: knownRulerId("ptolemaic-egypt"), locationId: PUNIC_IDS.alexandria, authorizedStrength: 17_000, personnel: [{ categoryId: "infantry", label: "Phalangites of the cleruchs", fit: 8_000, unavailable: [] }, { categoryId: "infantry", label: "Foot of the guard", fit: 2_000, unavailable: [] }, { categoryId: "cavalry", label: "Horse of the guard", fit: 500, unavailable: [] }, { categoryId: "cavalry", label: "Cleruch horse", fit: 1_500, unavailable: [] }, { categoryId: "infantry", label: "Greek mercenaries", fit: 3_000, unavailable: [] }, { categoryId: "light-infantry", label: "Cretan archers", fit: 1_000, unavailable: [] }, { categoryId: "elephant", label: "African elephants", fit: 40, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
      { id: "ptolemaic-royal-fleet", name: "Ptolemaic royal fleet", polityId: "ptolemaic-egypt", commanderCharacterId: knownRulerId("ptolemaic-egypt"), controllerCharacterId: knownRulerId("ptolemaic-egypt"), locationId: PUNIC_IDS.alexandria, authorizedStrength: 100, personnel: [{ categoryId: "warship", label: "Royal warships", fit: 90, unavailable: [] }], moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: null, payArrearsPeriods: 0, history: [] },
    ],
  },
}));

/**
 * The opening world with its armies drawn up (v42): the six great powers'
 * establishments and opening doctrines, and every army of theirs formed by
 * them -- legions and alae, contingents by nation, phalanxes and herds --
 * with the drill and experience the armies standing on the first morning
 * already have (`SEASONED_ARMIES`). Everyone else's armies stay flat.
 */
const initialWorld: WorldState = WorldStateSchema.parse(formArmies(
  // v43: the wider world's grudges, peaces, claims and aims (punic-wars-politics.ts).
  withWorldPolitics({ ...unformedWorld, establishments: [...PUNIC_ESTABLISHMENTS], doctrines: [...PUNIC_DOCTRINES] }),
  0,
  { seasoned: (force) => SEASONED_ARMIES[force.id] },
));

export const punicWarsScenario = { definition, initialWorld } as const;

/** What the v34 migration of a save needs to seat the same people the opening world has. */
export const punicWarsFounding = { writtenOut: WRITTEN_OUT, formOf: governmentFormFor } as const;
