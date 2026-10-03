import {
  DoctrineSchema,
  EstablishmentSchema,
  type BodyTemplate,
  type Doctrine,
  type DoctrineEffect,
  type Honour,
  type MilitaryEstablishment,
  type RankTemplate,
} from "@chronica/shared";

/**
 * How the six great powers of 270 BCE make their armies (scenario v42,
 * docs/plans/armies-in-detail.md).
 *
 * An army was a commander and a list of headcounts, so the consul's legion and
 * the Seleucid king's settlers fought exactly alike, and "Infantry 3 000" was
 * the whole of Carthage's field force. Each power below keeps an establishment:
 * the bodies it raises (a legion, an ala of the allies, a nation's contingent, a
 * phalanx), the formations each draws up, the ranks over them, whom it recruits
 * and on what terms, and the doctrines it opens with. `formArmies` draws every
 * army's men up by it on the first morning, and every levy after.
 *
 * Every other power keeps the flat army it had, and fights as it did.
 *
 * Words a body `matches` are tested against the start of every word in a row
 * of men's name, the row's first and the army's after, and the first body in
 * the list that matches takes them: so the order of the bodies matters where
 * two could claim the same word ("celt" would take Celtiberians to the Gauls,
 * if the Iberians did not come first), and a word every row has -- "infantry",
 * "horse", a power's own name -- is left out, or every man of that kind would
 * go to one body.
 */

// ── Drafts: the schema fills its own defaults ─────────────────────────────

type BodyDraft = Omit<BodyTemplate, "numerals" | "matches" | "isDefault"> & Partial<Pick<BodyTemplate, "numerals" | "matches" | "isDefault">>;
type RankDraft = Omit<RankTemplate, "grade" | "filledBy" | "words"> & Partial<Pick<RankTemplate, "grade" | "filledBy" | "words">>;
type HonourDraft = Omit<Honour, "mortal"> & { readonly mortal?: boolean };
type EstablishmentDraft = Omit<MilitaryEstablishment, "bodies" | "ranks" | "honours" | "recruitment" | "numbered" | "doctrineIds"> & {
  readonly bodies: readonly BodyDraft[];
  readonly ranks: readonly RankDraft[];
  readonly honours: readonly HonourDraft[];
  readonly recruitment: { readonly basis: MilitaryEstablishment["recruitment"]["basis"]; readonly floor?: MilitaryEstablishment["recruitment"]["floor"]; readonly standing?: boolean };
};
type DoctrineDraft = Pick<Doctrine, "id" | "label" | "description" | "polityId"> & {
  readonly appliesTo?: NonNullable<Doctrine["appliesTo"]>;
  readonly effects: readonly DoctrineEffect[];
};

/** Every line but the ships': a camp is dug, and a siege train dragged, on land. */
const LAND_LINES = ["screen", "first", "second", "third", "wing", "reserve"] as const;

const raise = (lever: DoctrineEffect["lever"], band: DoctrineEffect["band"]): DoctrineEffect => ({ lever, direction: "raise", band });
const lower = (lever: DoctrineEffect["lever"], band: DoctrineEffect["band"]): DoctrineEffect => ({ lever, direction: "lower", band });

// The phalanx of the successor kingdoms, as the tacticians count it: files of
// sixteen, sixteen files to a syntagma of 256 (Asclepiodotus 2.8-10), and a
// wing (keras) of thirty-two syntagmata, 8 192 men. The real strengths of 270
// are not recorded; the drill-book numbers are what each body is drawn up to.
const SYNTAGMATA = { label: "syntagma", size: 256, sub: { label: "file", count: 16 } } as const;

// ── Rome ──────────────────────────────────────────────────────────────────

const ROME: EstablishmentDraft = {
  polityId: "rome",
  label: "The manipular legion",
  description: "Citizen legions of three lines of maniples behind a screen of velites, each beside an ala of the Latin and Italian allies under Roman prefects; levied each year from men above a property floor who arm themselves (Polybius 6.19-26).",
  bodies: [
    // Polybius 6.21: 1 200 hastati, 1 200 principes and 600 triarii by age and
    // means, the youngest and poorest as velites, and 300 horse.
    { id: "legion", label: "Legion", naming: "Legio {n}", numerals: "roman", source: "citizen", isDefault: true, matches: ["legion", "legionar", "roman", "citizen"], formationIds: ["velites", "hastati", "principes", "triarii", "equites"] },
    // Polybius 6.26: the allied foot as many as the legion's, the horse three
    // times as many, a fifth of the foot and a third of the horse picked out as
    // extraordinarii to march and camp beside the consul.
    { id: "ala", label: "Ala of the allies", naming: "the {n} Ala of the allies", numerals: "ordinal", source: "ally", matches: ["allied", "ally", "allies", "socii", "latin", "italian", "contingent"], formationIds: ["allied-foot", "extraordinarii", "allied-horse"] },
    // Rome had two duoviri navales of ten ships each since 311 (Livy 9.30) and
    // in 270 no fleet worth the name: the hulls it sails on are its Greek
    // allies' (the socii navales). Polybius 6.19 sends citizens rated under
    // 400 drachmae to the fleet instead of the legions. A fleet is drawn up to
    // the hundred quinqueremes and twenty triremes Rome built in 261
    // (Polybius 1.20), not to the duoviri's ten.
    { id: "fleet", label: "Fleet", naming: "the {n} fleet", numerals: "ordinal", source: "ally", matches: ["ship", "fleet", "trireme", "quinquereme", "transport", "hull"], formationIds: ["ships"] },
  ],
  formations: [
    // Spread among the maniples (Polybius 6.24); counted here as ten bands.
    { id: "velites", label: "Velites", categoryId: "light-infantry", line: "screen", men: 1_200, units: { label: "band", count: 10 } },
    { id: "hastati", label: "Hastati", categoryId: "infantry", line: "first", men: 1_200, units: { label: "maniple", count: 10, sub: { label: "century", count: 2 } } },
    { id: "principes", label: "Principes", categoryId: "infantry", line: "second", men: 1_200, units: { label: "maniple", count: 10, sub: { label: "century", count: 2 } } },
    { id: "triarii", label: "Triarii", categoryId: "infantry", line: "third", men: 600, units: { label: "maniple", count: 10, sub: { label: "century", count: 2 } } },
    // Ten turmae of thirty, three decurions to a turma (Polybius 6.25).
    { id: "equites", label: "Equites", categoryId: "cavalry", line: "wing", men: 300, units: { label: "turma", count: 10 } },
    // Each city's men served as a cohort of their own, named for their people
    // (Livy's Paelignian or Marsic cohort); their strengths varied.
    { id: "allied-foot", label: "Allied cohorts", categoryId: "infantry", line: "first", men: 3_360, units: { label: "cohort", size: 420 } },
    { id: "extraordinarii", label: "Extraordinarii", categoryId: "infantry", line: "reserve", men: 840, units: { label: "cohort", size: 420 } },
    { id: "allied-horse", label: "Allied horse", categoryId: "cavalry", line: "wing", men: 900, units: { label: "turma", count: 30 } },
    { id: "ships", label: "Ships", categoryId: "warship", line: "afloat", men: 120, units: { label: "ship", size: 1 } },
  ],
  ranks: [
    { id: "consul", label: "Consul", level: "army", filledBy: "elected", words: ["consul", "general"], officeIds: ["roman-consul"] },
    { id: "legate", label: "Legate", level: "army", grade: 1, filledBy: "appointed", words: ["legate", "legatus"] },
    // Six to a legion, commanding two at a time by turns (Polybius 6.34); the
    // people had elected sixteen of them a year since 311 (Livy 9.30), the
    // consuls named the rest.
    { id: "military-tribune", label: "Military tribune", level: "body", filledBy: "elected", formationIds: ["velites", "hastati", "principes", "triarii", "equites"], words: ["tribune", "military tribune"], officeIds: ["roman-military-tribune"] },
    // Twelve to a consular army, named by the consuls (Polybius 6.26).
    { id: "prefect-of-the-allies", label: "Prefect of the allies", level: "body", filledBy: "appointed", formationIds: ["allied-foot", "extraordinarii", "allied-horse"], words: ["prefect", "praefectus"] },
    { id: "duumvir-navalis", label: "Duumvir of the fleet", level: "body", filledBy: "elected", formationIds: ["ships"], words: ["duumvir", "admiral"] },
    // The tribunes chose ten centurions for merit and then ten more, and the
    // first chosen sat in the council (Polybius 6.24); the first centurion of
    // the triarii is the primus pilus.
    { id: "primus-pilus", label: "Primus pilus", level: "unit", grade: 0, filledBy: "valour", formationIds: ["triarii"], words: ["primus pilus", "first spear"] },
    { id: "centurio-prior", label: "Centurio prior", level: "unit", grade: 1, filledBy: "valour", formationIds: ["hastati", "principes", "triarii"], words: ["centurion", "centurio", "prior"] },
    { id: "centurio-posterior", label: "Centurio posterior", level: "sub", grade: 2, filledBy: "valour", formationIds: ["hastati", "principes", "triarii"], words: ["centurion", "centurio", "posterior"] },
    // Each centurion chose his own rear-officer (Polybius 6.24).
    { id: "optio", label: "Optio", level: "sub", filledBy: "appointed", formationIds: ["hastati", "principes", "triarii"], words: ["optio"] },
    // Two standard-bearers to a maniple, chosen by the centurions.
    { id: "signifer", label: "Signifer", level: "unit", grade: 3, filledBy: "appointed", formationIds: ["hastati", "principes", "triarii"], words: ["signifer", "standard-bearer"] },
    { id: "decurion", label: "Decurion", level: "unit", filledBy: "appointed", formationIds: ["equites", "allied-horse"], words: ["decurion"] },
    { id: "eques", label: "Eques", level: "ranks", formationIds: ["equites", "allied-horse"], words: ["eques", "trooper", "horseman"] },
    { id: "veles", label: "Veles", level: "ranks", formationIds: ["velites"], words: ["veles", "skirmisher"] },
    { id: "miles", label: "Miles", level: "ranks", words: ["legionary", "soldier", "miles"] },
  ],
  // Polybius 6.37-39.
  honours: [
    { id: "civic-crown", label: "The civic crown of oak", kind: "decoration", for: "saving_a_comrade", standing: "great" },
    { id: "mural-crown", label: "The mural crown", kind: "decoration", for: "first_over_the_wall", standing: "great" },
    { id: "phalerae", label: "Phalerae", kind: "decoration", for: "valour", standing: "marked" },
    { id: "hasta", label: "The gift of a spear", kind: "decoration", for: "valour", standing: "slight" },
    // Beaten to death by the men he had endangered, for sleeping on watch or
    // throwing away his arms.
    { id: "fustuarium", label: "The fustuarium", kind: "punishment", for: "sleeping_on_watch", standing: "marked", mortal: true },
    // A maniple that ran: one man in ten to the fustuarium, the rest on barley
    // and camped outside the rampart.
    { id: "decimation", label: "Decimation", kind: "punishment", for: "flight", standing: "great", mortal: true },
    { id: "barley-rations", label: "Barley for wheat, and reduced in rank", kind: "punishment", for: "flight", standing: "slight" },
  ],
  recruitment: { basis: "property_class", floor: "low", standing: false },
  equipment: "self",
  // Sixteen campaigns for the foot, ten for the horse, and ten before any
  // magistracy (Polybius 6.19).
  serviceCampaigns: { foot: 16, horse: 10 },
  discharge: "none",
  campaignsForOffice: 10,
};

// ── Carthage ──────────────────────────────────────────────────────────────

const CARTHAGE: EstablishmentDraft = {
  polityId: "carthage",
  label: "Armies of many nations",
  description: "A citizen general, appointed and answerable to the Hundred and Four, over subjects, allies and hired men by nation, each under its own captains and speaking its own tongue (Polybius 1.67): Libyan foot, Numidian horse, Balearic slingers, Iberians, Gauls and Greeks, and the sea's best fleet.",
  bodies: [
    // The heavy foot of Carthage's wars, raised from its Libyan subjects. The
    // default, so a levy of no stated nation is Libyan.
    { id: "libyans", label: "Libyan contingent", naming: "the {n} Libyan contingent", numerals: "ordinal", source: "subject", isDefault: true, matches: ["libyan", "african", "libyphoenician"], formationIds: ["libyan-foot"] },
    // At Agrigentum in 262 (Polybius 1.19); the kings of the Massyli and
    // Masaesyli sold or lent their horse.
    { id: "numidians", label: "Numidian contingent", naming: "the {n} Numidian contingent", numerals: "ordinal", source: "ally", matches: ["numidian", "massyl", "masaesyl"], formationIds: ["numidian-horse"] },
    // In Carthaginian pay since at least 406 (Diodorus 13.80).
    { id: "balearics", label: "Balearic contingent", naming: "the {n} Balearic contingent", numerals: "ordinal", source: "mercenary", matches: ["balearic", "slinger"], formationIds: ["balearic-slingers"] },
    // Before the Gauls, so "celt" does not take the Celtiberians.
    { id: "iberians", label: "Iberian contingent", naming: "the {n} Iberian contingent", numerals: "ordinal", source: "mercenary", matches: ["iberian", "spanish", "celtiberian"], formationIds: ["iberian-foot"] },
    { id: "gauls", label: "Gallic contingent", naming: "the {n} Gallic contingent", numerals: "ordinal", source: "mercenary", matches: ["gallic", "gaul", "celt", "ligurian"], formationIds: ["gallic-foot"] },
    { id: "greeks", label: "Greek contingent", naming: "the {n} Greek contingent", numerals: "ordinal", source: "mercenary", matches: ["greek", "hoplite"], formationIds: ["greek-foot"] },
    // The Sacred Band, 2 500 citizens of the best families, was cut to pieces at
    // the Crimisus in 341 (Diodorus 16.80) and raised again by 310 (20.10).
    // Not "carthaginian" among its words: every army of Carthage is called
    // that, and a plain levy would go to the citizens.
    { id: "citizens", label: "Citizen levy", naming: "the {n} citizen levy", numerals: "ordinal", source: "citizen", matches: ["citizen", "sacred"], formationIds: ["sacred-band", "citizen-horse"] },
    { id: "fleet", label: "Fleet", naming: "the {n} fleet", numerals: "ordinal", source: "citizen", matches: ["quinquereme", "fleet", "ship", "trireme", "quadrireme"], formationIds: ["quinqueremes"] },
  ],
  // The sources give the nations and almost never their companies; the
  // companies below are a guess at a size a captain could lead. Every foot
  // contingent stands in one line, nation beside nation: Carthage kept no
  // reserve lines, which is what the legion's three were for.
  formations: [
    { id: "libyan-foot", label: "Libyan foot", categoryId: "infantry", line: "first", men: 4_000, units: { label: "company", size: 200 } },
    { id: "numidian-horse", label: "Numidian horse", categoryId: "cavalry", line: "wing", men: 1_000, units: { label: "troop", size: 100 } },
    { id: "balearic-slingers", label: "Balearic slingers", categoryId: "light-infantry", line: "screen", men: 1_000, units: { label: "band", size: 100 } },
    { id: "iberian-foot", label: "Iberian foot", categoryId: "infantry", line: "first", men: 2_000, units: { label: "company", size: 200 } },
    { id: "gallic-foot", label: "Gallic foot", categoryId: "infantry", line: "first", men: 2_000, units: { label: "company", size: 200 } },
    { id: "greek-foot", label: "Greek hoplites", categoryId: "infantry", line: "first", men: 2_000, units: { label: "lochos", size: 100 } },
    { id: "sacred-band", label: "Sacred Band", categoryId: "infantry", line: "first", men: 2_500, units: { label: "company", size: 250 } },
    { id: "citizen-horse", label: "Citizen horse", categoryId: "cavalry", line: "wing", men: 1_000, units: { label: "troop", size: 100 } },
    { id: "quinqueremes", label: "Quinqueremes", categoryId: "warship", line: "afloat", men: 120, units: { label: "ship", size: 1 } },
  ],
  ranks: [
    { id: "general", label: "General", level: "army", filledBy: "appointed", words: ["general", "strategos", "rab mahanet"], officeIds: ["carthaginian-strategos"] },
    { id: "admiral", label: "Admiral", level: "body", filledBy: "appointed", formationIds: ["quinqueremes"], words: ["admiral", "navarch"] },
    // Each nation's own men over it: Spendius the Campanian, Autaritus the
    // Gaul and Mathos the Libyan led their nations in 241 (Polybius 1.69, 1.77).
    { id: "captain", label: "Captain of a nation", level: "formation", filledBy: "appointed", words: ["captain", "chief"] },
    { id: "company-officer", label: "Company officer", level: "unit", filledBy: "seniority", words: ["officer", "company commander"] },
    { id: "trierarch", label: "Captain of a ship", level: "unit", filledBy: "appointed", formationIds: ["quinqueremes"], words: ["trierarch", "ship's captain"] },
    { id: "interpreter", label: "Interpreter", level: "formation", grade: 1, filledBy: "appointed", words: ["interpreter"] },
    { id: "soldier", label: "Soldier", level: "ranks", words: ["mercenary", "soldier", "spearman"] },
  ],
  honours: [
    // A ring or armlet for every campaign served (Aristotle, Politics 1324b).
    { id: "campaign-armlet", label: "An armlet for the campaign", kind: "decoration", for: "valour", standing: "slight" },
    // Carthage crucified the commander who gave up the citadel of Messana in
    // 264 (Polybius 1.11): a general answered for a defeat with his life.
    { id: "crucifixion", label: "Crucifixion", kind: "punishment", for: "flight", standing: "great", mortal: true },
    { id: "pay-stopped", label: "Pay stopped", kind: "punishment", for: "disobedience", standing: "slight" },
  ],
  recruitment: { basis: "mercenary", floor: "none", standing: true },
  equipment: "state",
  // Hired for the war, not for a term of years; paid off at the end of it, as
  // the men brought home from Sicily in 241 were to be.
  serviceCampaigns: { foot: 12, horse: 12 },
  discharge: "cash",
  campaignsForOffice: 0,
};

// ── Syracuse ──────────────────────────────────────────────────────────────

const SYRACUSE: EstablishmentDraft = {
  polityId: "syracuse",
  label: "Hieron's citizen army",
  description: "The citizen hoplite phalanx Hieron raised after he let the old mercenaries be cut down by the Mamertines, new mercenaries he could trust beside it, the horse of the well-born, and a royal fleet (Polybius 1.9).",
  bodies: [
    { id: "phalanx", label: "Phalanx of the citizens", naming: "the {n} phalanx of the citizens", numerals: "ordinal", source: "citizen", isDefault: true, matches: ["hoplite", "citizen", "phalanx"], formationIds: ["hoplites"] },
    { id: "mercenaries", label: "Mercenary band", naming: "the {n} mercenary band", numerals: "ordinal", source: "mercenary", matches: ["mercenar", "hired", "campanian"], formationIds: ["mercenary-foot"] },
    { id: "light-troops", label: "Light band", naming: "the {n} light band", numerals: "ordinal", source: "mercenary", matches: ["slinger", "archer", "javelin", "light", "psil"], formationIds: ["psiloi"] },
    { id: "horse", label: "Hipparchy", naming: "the {n} hipparchy", numerals: "ordinal", source: "citizen", matches: ["hippeis", "hipp"], formationIds: ["hippeis"] },
    { id: "fleet", label: "Royal squadron", naming: "the {n} royal squadron", numerals: "ordinal", source: "royal", matches: ["trireme", "quadrireme", "quinquereme", "ship", "fleet"], formationIds: ["warships"] },
  ],
  formations: [
    { id: "hoplites", label: "Hoplites", categoryId: "infantry", line: "first", men: 2_000, units: { label: "lochos", size: 100 } },
    { id: "mercenary-foot", label: "Mercenary foot", categoryId: "infantry", line: "first", men: 1_500, units: { label: "lochos", size: 100 } },
    { id: "psiloi", label: "Psiloi", categoryId: "light-infantry", line: "screen", men: 600, units: { label: "band", size: 100 } },
    { id: "hippeis", label: "Hippeis", categoryId: "cavalry", line: "wing", men: 500, units: { label: "ile", size: 64 } },
    { id: "warships", label: "Warships", categoryId: "warship", line: "afloat", men: 40, units: { label: "ship", size: 1 } },
  ],
  ranks: [
    { id: "king", label: "King", level: "army", filledBy: "hereditary", words: ["king", "basileus"], officeIds: ["syracusan-king"] },
    { id: "strategos", label: "Strategos", level: "body", filledBy: "appointed", words: ["strategos", "general"], officeIds: ["syracusan-strategos"] },
    { id: "navarch", label: "Navarch", level: "body", filledBy: "appointed", formationIds: ["warships"], words: ["navarch", "admiral"] },
    { id: "hipparch", label: "Hipparch", level: "formation", filledBy: "appointed", formationIds: ["hippeis"], words: ["hipparch"] },
    { id: "lochagos", label: "Lochagos", level: "unit", filledBy: "appointed", formationIds: ["hoplites", "mercenary-foot", "psiloi"], words: ["lochagos", "captain"] },
    { id: "trierarch", label: "Trierarch", level: "unit", filledBy: "appointed", formationIds: ["warships"], words: ["trierarch"] },
    { id: "hoplite", label: "Hoplite", level: "ranks", words: ["hoplite", "soldier"] },
  ],
  honours: [
    { id: "crown-of-valour", label: "A crown for valour", kind: "decoration", for: "valour", standing: "marked" },
    { id: "atimia", label: "Disgrace for the thrown shield", kind: "punishment", for: "flight", standing: "marked" },
  ],
  // Men of the hoplite census, called out by age classes for the campaign.
  recruitment: { basis: "citizens", floor: "middling", standing: false },
  equipment: "self",
  serviceCampaigns: { foot: 20, horse: 20 },
  discharge: "none",
  campaignsForOffice: 0,
};

// ── Macedon ───────────────────────────────────────────────────────────────

const MACEDON: EstablishmentDraft = {
  polityId: "macedon",
  label: "The Antigonid phalanx",
  description: "Antigonus Gonatas' kingdom: the levy of the Macedonian countryside in the sarissa phalanx, the hypaspists and Companion horse of the king, Thracian and Illyrian light troops, and the Gauls he took into his pay after beating them at Lysimachia in 277.",
  bodies: [
    { id: "phalanx", label: "Phalanx", naming: "the {n} phalanx", numerals: "ordinal", source: "citizen", isDefault: true, matches: ["phalanx", "phalangite", "sarissa", "pezhetair", "macedonian"], formationIds: ["phalangites"] },
    { id: "hypaspists", label: "Royal guard", naming: "the {n} royal guard", numerals: "ordinal", source: "royal", matches: ["hypaspist", "guard", "agema", "peltast"], formationIds: ["hypaspists"] },
    { id: "companions", label: "Companion cavalry", naming: "the {n} hipparchy of the Companions", numerals: "ordinal", source: "royal", matches: ["companion", "hetair"], formationIds: ["companions"] },
    { id: "light-troops", label: "Light band", naming: "the {n} light band", numerals: "ordinal", source: "mercenary", matches: ["thracian", "illyrian", "agrian", "paeonian", "light"], formationIds: ["light-foot"] },
    // Gonatas took the Gauls he had beaten at Lysimachia into his pay: they
    // were his rearguard when Pyrrhus beat him in 274 (Plutarch, Pyrrhus 26),
    // and he had to put down a mutiny of them at Megara (Polyaenus 4.6.17).
    { id: "mercenaries", label: "Mercenary band", naming: "the {n} mercenary band", numerals: "ordinal", source: "mercenary", matches: ["mercenar", "gallic", "galatian", "gaul", "hired", "greek"], formationIds: ["mercenary-foot"] },
    { id: "fleet", label: "Royal fleet", naming: "the {n} royal fleet", numerals: "ordinal", source: "royal", matches: ["ship", "fleet", "trireme", "quinquereme"], formationIds: ["royal-ships"] },
  ],
  formations: [
    { id: "phalangites", label: "Phalangites", categoryId: "infantry", line: "first", men: 8_192, units: SYNTAGMATA },
    // Between the phalanx and the horse, a picked foot of the king's own.
    { id: "hypaspists", label: "Hypaspists", categoryId: "infantry", line: "first", men: 2_000, units: { label: "chiliarchy", size: 1_000 } },
    // Alexander's 1 800 Companions (Diodorus 17.17) rode in eight ilai, some
    // two hundred to a squadron.
    { id: "companions", label: "Companions", categoryId: "cavalry", line: "wing", men: 1_000, units: { label: "ile", size: 200 } },
    { id: "light-foot", label: "Thracians and Illyrians", categoryId: "light-infantry", line: "screen", men: 2_000, units: { label: "band", size: 100 } },
    { id: "mercenary-foot", label: "Mercenary foot", categoryId: "infantry", line: "first", men: 2_000, units: { label: "company", size: 200 } },
    { id: "royal-ships", label: "Warships", categoryId: "warship", line: "afloat", men: 60, units: { label: "ship", size: 1 } },
  ],
  ranks: [
    { id: "king", label: "King", level: "army", filledBy: "hereditary", words: ["king", "basileus"], officeIds: ["macedon:ruler"] },
    { id: "strategos", label: "Strategos", level: "body", filledBy: "appointed", words: ["strategos", "general"] },
    { id: "navarch", label: "Navarch", level: "body", filledBy: "appointed", formationIds: ["royal-ships"], words: ["navarch", "admiral"] },
    // Over four syntagmata, 1 024 men; there is no level between the phalanx
    // and its syntagmata here, so he stands with the phalanx's officers.
    { id: "chiliarch", label: "Chiliarch", level: "formation", grade: 1, filledBy: "appointed", formationIds: ["phalangites", "hypaspists"], words: ["chiliarch"] },
    { id: "hipparch", label: "Hipparch", level: "formation", filledBy: "appointed", formationIds: ["companions"], words: ["hipparch"] },
    { id: "syntagmatarch", label: "Syntagmatarch", level: "unit", filledBy: "seniority", formationIds: ["phalangites"], words: ["syntagmatarch"] },
    { id: "ilarch", label: "Ilarch", level: "unit", filledBy: "appointed", formationIds: ["companions"], words: ["ilarch"] },
    // The file-leader, first man of sixteen.
    { id: "lochagos", label: "Lochagos", level: "sub", filledBy: "valour", formationIds: ["phalangites"], words: ["lochagos", "file-leader"] },
    { id: "phalangite", label: "Phalangite", level: "ranks", words: ["phalangite", "soldier", "pezhetairos"] },
  ],
  honours: [
    // The dimoirites, a man on double pay for his worth (Arrian 7.23.3).
    { id: "double-pay", label: "Double pay", kind: "decoration", for: "valour", standing: "marked" },
    // Fines for the watch asleep, as the later military code found at
    // Amphipolis sets them out.
    { id: "watch-fine", label: "A fine for the watch", kind: "punishment", for: "sleeping_on_watch", standing: "slight" },
    // The army itself stoned men it judged traitors (Curtius 6.11).
    { id: "stoning", label: "Stoned by the army", kind: "punishment", for: "disobedience", standing: "great", mortal: true },
  ],
  // Called out from the countryside by district for the campaign, the king's
  // guard and his hired men kept on.
  recruitment: { basis: "citizens", floor: "low", standing: false },
  // The royal arsenals armed the phalanx (Livy 42.12 counts Perseus' stores).
  equipment: "state",
  serviceCampaigns: { foot: 20, horse: 20 },
  discharge: "none",
  campaignsForOffice: 0,
};

// ── The Seleucid kingdom ──────────────────────────────────────────────────

const SELEUCIDS: EstablishmentDraft = {
  polityId: "seleucid-empire",
  label: "The army of the settlers",
  description: "Antiochus I's army: a phalanx of military settlers (katoikoi) holding land in the king's colonies, the guard and the agema, Companion horse, Indian elephants kept at Apamea, mercenaries, and the levies of the peoples of Asia.",
  bodies: [
    // At Magnesia in 190 the phalanx was 16 000 (Livy 37.40); what Antiochus I
    // could put in the field in 270 is not recorded.
    { id: "phalanx", label: "Phalanx", naming: "the {n} phalanx", numerals: "ordinal", source: "settler", isDefault: true, matches: ["phalanx", "phalangite", "settler", "katoik", "sarissa", "macedonian"], formationIds: ["phalangites"] },
    { id: "guard", label: "Royal guard", naming: "the {n} royal guard", numerals: "ordinal", source: "royal", matches: ["guard", "hypaspist", "agema", "argyraspid", "silver"], formationIds: ["guard-foot", "agema"] },
    { id: "companions", label: "Companion cavalry", naming: "the {n} hipparchy of the Companions", numerals: "ordinal", source: "settler", matches: ["companion", "hetair"], formationIds: ["companions"] },
    // Seleucus had five hundred from Chandragupta (Strabo 15.2.9), and the
    // herd and its stables were kept at Apamea (Strabo 16.2.10). Sixteen of
    // them broke the Galatians in the "Elephant Victory" (Lucian, Zeuxis 8-11).
    { id: "elephants", label: "Elephant herd", naming: "the {n} herd", numerals: "ordinal", source: "royal", matches: ["elephant", "indian"], formationIds: ["war-elephants"] },
    { id: "mercenaries", label: "Mercenary band", naming: "the {n} mercenary band", numerals: "ordinal", source: "mercenary", matches: ["mercenar", "greek", "galatian", "gallic", "gaul", "thracian", "hired"], formationIds: ["mercenary-foot"] },
    { id: "levies", label: "Levy of Asia", naming: "the {n} levy of Asia", numerals: "ordinal", source: "subject", matches: ["levy", "levies", "asian", "persian", "median", "mede", "syrian", "arab", "cardac", "cyrtian", "elymae", "dahae", "archer", "slinger"], formationIds: ["levy-foot", "levy-horse"] },
    { id: "fleet", label: "Royal fleet", naming: "the {n} royal fleet", numerals: "ordinal", source: "royal", matches: ["ship", "fleet", "trireme", "quinquereme"], formationIds: ["royal-ships"] },
  ],
  formations: [
    { id: "phalangites", label: "Phalangites", categoryId: "infantry", line: "first", men: 8_192, units: SYNTAGMATA },
    { id: "guard-foot", label: "Hypaspists", categoryId: "infantry", line: "first", men: 2_000, units: { label: "chiliarchy", size: 1_000 } },
    // A thousand at Magnesia (Livy 37.40).
    { id: "agema", label: "Agema", categoryId: "cavalry", line: "wing", men: 1_000, units: { label: "ile", size: 250 } },
    { id: "companions", label: "Companions", categoryId: "cavalry", line: "wing", men: 1_000, units: { label: "ile", size: 250 } },
    // Before the line, as at Raphia, each beast with its driver and its guard of foot.
    { id: "war-elephants", label: "Indian elephants", categoryId: "elephant", line: "screen", men: 100, units: { label: "elephant", size: 1 } },
    { id: "mercenary-foot", label: "Mercenary foot", categoryId: "infantry", line: "first", men: 2_000, units: { label: "company", size: 200 } },
    { id: "levy-foot", label: "Archers and slingers", categoryId: "light-infantry", line: "screen", men: 3_000, units: { label: "band", size: 100 } },
    { id: "levy-horse", label: "Horse", categoryId: "cavalry", line: "wing", men: 1_000, units: { label: "troop", size: 100 } },
    { id: "royal-ships", label: "Warships", categoryId: "warship", line: "afloat", men: 60, units: { label: "ship", size: 1 } },
  ],
  ranks: [
    { id: "king", label: "King", level: "army", filledBy: "hereditary", words: ["king", "basileus"], officeIds: ["seleucid-empire:ruler"] },
    { id: "strategos", label: "Strategos", level: "body", filledBy: "appointed", words: ["strategos", "general"] },
    { id: "elephantarch", label: "Elephantarch", level: "formation", filledBy: "appointed", formationIds: ["war-elephants"], words: ["elephantarch", "master of the elephants"] },
    { id: "chiliarch", label: "Chiliarch", level: "formation", grade: 1, filledBy: "appointed", formationIds: ["phalangites", "guard-foot"], words: ["chiliarch"] },
    { id: "hipparch", label: "Hipparch", level: "formation", filledBy: "appointed", formationIds: ["agema", "companions", "levy-horse"], words: ["hipparch"] },
    { id: "syntagmatarch", label: "Syntagmatarch", level: "unit", filledBy: "seniority", formationIds: ["phalangites"], words: ["syntagmatarch"] },
    // The drivers were called "Indians" whoever they were (Polybius 1.40).
    { id: "mahout", label: "Driver", level: "unit", filledBy: "appointed", formationIds: ["war-elephants"], words: ["mahout", "driver", "indian"] },
    { id: "lochagos", label: "Lochagos", level: "sub", filledBy: "valour", formationIds: ["phalangites"], words: ["lochagos", "file-leader"] },
    { id: "phalangite", label: "Phalangite", level: "ranks", words: ["phalangite", "soldier", "settler"] },
  ],
  honours: [
    { id: "double-pay", label: "Double pay", kind: "decoration", for: "valour", standing: "marked" },
    { id: "kleros-forfeit", label: "The allotment forfeit", kind: "punishment", for: "flight", standing: "great" },
  ],
  recruitment: { basis: "settlers", floor: "none", standing: false },
  // How the settlers were armed is not known: from their own allotments is the
  // likelier reading.
  equipment: "self",
  serviceCampaigns: { foot: 20, horse: 20 },
  // The land is held for the service; the son inherits both.
  discharge: "land",
  campaignsForOffice: 0,
};

// ── The Ptolemaic kingdom ─────────────────────────────────────────────────

const PTOLEMIES: EstablishmentDraft = {
  polityId: "ptolemaic-egypt",
  label: "The army of the cleruchs",
  description: "Ptolemy II's army: a phalanx of Macedonian and Greek cleruchs holding land for service, the guard, cleruch horse in numbered hipparchies, Greek mercenaries, African elephants newly hunted on the Red Sea coast, and the largest fleet of the age.",
  bodies: [
    // Native Egyptians are not in it. The machimoi served as guards and
    // marines; twenty thousand of them were first armed and drilled as
    // phalangites for Raphia in 217 (Polybius 5.65) -- a reform waiting to
    // happen, and one with consequences the dynasty did not enjoy.
    { id: "phalanx", label: "Phalanx", naming: "the {n} phalanx", numerals: "ordinal", source: "settler", isDefault: true, matches: ["phalanx", "phalangite", "cleruch", "settler", "sarissa", "macedonian"], formationIds: ["phalangites"] },
    // Before the hipparchies, so "Horse of the guard" is the guard's.
    // At Raphia the agema was 3 000 foot, the household horse 700 (Polybius 5.65).
    { id: "guard", label: "Royal guard", naming: "the {n} royal guard", numerals: "ordinal", source: "royal", matches: ["guard", "agema", "hypaspist"], formationIds: ["guard-foot", "guard-horse"] },
    // The papyri number the cleruch hipparchies; their strength is not known.
    { id: "hipparchy", label: "Hipparchy", naming: "the {n} hipparchy", numerals: "ordinal", source: "settler", matches: ["hipp", "horse", "cavalry", "companion"], formationIds: ["cleruch-horse"] },
    // Ptolemy marooned the four thousand Gauls who plotted against him on an
    // island in the Nile (Pausanias 1.7.2): his hired men in 270 are Greeks.
    { id: "mercenaries", label: "Mercenary band", naming: "the {n} mercenary band", numerals: "ordinal", source: "mercenary", matches: ["mercenar", "greek", "galatian", "gallic", "thracian", "hired"], formationIds: ["mercenary-foot"] },
    { id: "light-troops", label: "Light band", naming: "the {n} light band", numerals: "ordinal", source: "mercenary", matches: ["cretan", "archer", "slinger", "javelin", "light"], formationIds: ["light-foot"] },
    // Ptolemais of the Hunts was founded on the Red Sea for the elephant hunt
    // under Ptolemy II (Strabo 16.4.7). The forest elephant is the smaller
    // beast, and broke before the Indian at Raphia (Polybius 5.84).
    { id: "elephants", label: "Elephant herd", naming: "the {n} herd", numerals: "ordinal", source: "royal", matches: ["elephant", "african"], formationIds: ["war-elephants"] },
    // Two ships of thirty banks, one of twenty and down through the great
    // polyremes to the fours and threes, 336 warships in all by Callixenus'
    // count (Athenaeus 5.203d), under his navarch Callicrates of Samos.
    { id: "fleet", label: "Royal fleet", naming: "the {n} royal fleet", numerals: "ordinal", source: "royal", matches: ["ship", "fleet", "trireme", "quinquereme", "polyreme", "warship"], formationIds: ["royal-ships"] },
  ],
  formations: [
    { id: "phalangites", label: "Phalangites", categoryId: "infantry", line: "first", men: 8_192, units: SYNTAGMATA },
    { id: "guard-foot", label: "Agema", categoryId: "infantry", line: "first", men: 3_000, units: { label: "chiliarchy", size: 1_000 } },
    { id: "guard-horse", label: "Household horse", categoryId: "cavalry", line: "wing", men: 700, units: { label: "ile", size: 100 } },
    { id: "cleruch-horse", label: "Cleruch horse", categoryId: "cavalry", line: "wing", men: 500, units: { label: "ile", size: 100 } },
    { id: "mercenary-foot", label: "Mercenary foot", categoryId: "infantry", line: "first", men: 2_000, units: { label: "company", size: 200 } },
    { id: "light-foot", label: "Cretans and light foot", categoryId: "light-infantry", line: "screen", men: 1_000, units: { label: "band", size: 100 } },
    { id: "war-elephants", label: "African elephants", categoryId: "elephant", line: "screen", men: 100, units: { label: "elephant", size: 1 } },
    { id: "royal-ships", label: "Warships", categoryId: "warship", line: "afloat", men: 120, units: { label: "ship", size: 1 } },
  ],
  ranks: [
    { id: "king", label: "King", level: "army", filledBy: "hereditary", words: ["king", "basileus", "pharaoh"], officeIds: ["ptolemaic-egypt:ruler"] },
    { id: "strategos", label: "Strategos", level: "body", filledBy: "appointed", words: ["strategos", "general"] },
    { id: "navarch", label: "Navarch", level: "body", filledBy: "appointed", formationIds: ["royal-ships"], words: ["navarch", "admiral"] },
    { id: "hipparch", label: "Hipparch", level: "body", filledBy: "appointed", formationIds: ["cleruch-horse", "guard-horse"], words: ["hipparch"] },
    { id: "elephantarch", label: "Elephantarch", level: "formation", filledBy: "appointed", formationIds: ["war-elephants"], words: ["elephantarch", "master of the elephants"] },
    { id: "chiliarch", label: "Chiliarch", level: "formation", grade: 1, filledBy: "appointed", formationIds: ["phalangites", "guard-foot"], words: ["chiliarch"] },
    { id: "syntagmatarch", label: "Syntagmatarch", level: "unit", filledBy: "seniority", formationIds: ["phalangites"], words: ["syntagmatarch"] },
    { id: "trierarch", label: "Trierarch", level: "unit", filledBy: "appointed", formationIds: ["royal-ships"], words: ["trierarch"] },
    { id: "lochagos", label: "Lochagos", level: "sub", filledBy: "valour", formationIds: ["phalangites"], words: ["lochagos", "file-leader"] },
    { id: "cleruch", label: "Cleruch", level: "ranks", words: ["cleruch", "phalangite", "soldier"] },
  ],
  honours: [
    { id: "gift-of-land", label: "A larger allotment", kind: "decoration", for: "valour", standing: "marked" },
    { id: "kleros-forfeit", label: "The allotment taken back", kind: "punishment", for: "flight", standing: "great" },
  ],
  recruitment: { basis: "settlers", floor: "none", standing: false },
  equipment: "self",
  serviceCampaigns: { foot: 20, horse: 20 },
  // The cleruch's allotment -- a hundred arourai for a horseman in the drained
  // Fayum -- was the pay for service before it began.
  discharge: "land",
  campaignsForOffice: 0,
};

// ── Doctrines ─────────────────────────────────────────────────────────────

/**
 * The ways of war each power opens with. Every one gives something and takes
 * something: an edge with no price is the thing the engine refuses to believe.
 */
const DOCTRINE_DRAFTS: readonly DoctrineDraft[] = [
  // Rome.
  {
    id: "rome-triplex-acies", polityId: "rome", label: "The triplex acies",
    description: "Hastati, principes and triarii in three lines of maniples in open order: a tired line falls back through the gaps and a fresh one comes up. Supple on broken ground, and thinner in front than a phalanx -- Pyrrhus' pikes drove the legions back at Heraclea and Asculum.",
    appliesTo: { lines: ["first", "second", "third"] },
    effects: [raise("line_relief", "marked"), raise("rough_ground", "slight"), lower("frontal_weight", "slight")],
  },
  {
    id: "rome-marching-camp", polityId: "rome", label: "The fortified marching camp",
    description: "Ditch, rampart and palisade dug every evening on the same plan, so every man knows his street (Polybius 6.27-32). An army with a camp behind it does not break as easily; it marches hours less a day for it.",
    appliesTo: { lines: [...LAND_LINES] },
    effects: [raise("steadiness", "slight"), lower("march_speed", "slight")],
  },
  {
    id: "rome-dilectus", polityId: "rome", label: "The yearly levy of the assidui",
    description: "Every citizen above the property floor owes campaigns, and the allies owe men by the formula: no power in the west can call so many. But the legions are raised for the year and sent home, so they never drill long.",
    // A slight ceiling, not a marked one: a marked one put drill's limit below
    // the veterans of Pyrrhus the legion opens with, so no consul could ever
    // drill his army at all.
    effects: [raise("manpower_basis", "marked"), lower("drill_ceiling", "slight")],
  },
  // Carthage.
  {
    id: "carthage-many-nations", polityId: "carthage", label: "A host of many nations",
    description: "Libyans, Numidians, Balearians, Iberians, Gauls and Greeks, hired or levied by nation under their own captains, giving and taking orders through interpreters (Polybius 1.67). Any people with men to sell can fill the ranks, and the slingers and horse are the best in the west; but hired men are dear, and dangerous the month their pay is late.",
    effects: [raise("manpower_basis", "marked"), raise("screen", "slight"), raise("levy_cost", "marked"), lower("pay_discipline", "marked")],
  },
  {
    id: "carthage-answerable-generals", polityId: "carthage", label: "Generals answerable to the Hundred and Four",
    description: "A general who loses is tried by the judges, and may be crucified. The armies stay Carthage's rather than their generals' -- and the generals are careful men, slow to press a victory they might have to answer for.",
    effects: [lower("loyalty_to_general", "marked"), lower("pursuit", "slight")],
  },
  {
    id: "carthage-seamanship", polityId: "carthage", label: "The best seamen of the age",
    description: "Crews who row and manoeuvre as nobody else can, and fight by the ram: they sweep an enemy's oars and hole him from astern (Polybius 1.51). Few marines aboard, so a ship that is grappled and boarded is a ship lost.",
    appliesTo: { categoryIds: ["warship"] },
    effects: [raise("drill_ceiling", "marked"), lower("boarding", "slight")],
  },
  // Syracuse.
  {
    id: "syracuse-citizen-army", polityId: "syracuse", label: "Hieron's citizen army",
    description: "Hieron let the old mercenaries be cut down by the Mamertines and raised his own citizens in their place (Polybius 1.9). They are loyal, and bear a late payday better than hired men; but there are few of them, and they are citizens with farms, not soldiers who drill all year.",
    effects: [lower("loyalty_to_general", "marked"), raise("pay_discipline", "slight"), lower("manpower_basis", "slight"), lower("drill_ceiling", "slight")],
  },
  {
    id: "syracuse-engines", polityId: "syracuse", label: "The engineers of Syracuse",
    description: "The catapult was invented at Syracuse for Dionysius in 399 (Diodorus 14.42), and the city has kept its engineers since. Its siege works go forward fast, at the cost of a train that is slow on the road and dear to keep.",
    appliesTo: { lines: [...LAND_LINES] },
    effects: [raise("siege_craft", "marked"), lower("march_speed", "slight"), raise("levy_cost", "slight")],
  },
  // Macedon.
  {
    id: "macedon-sarissa-phalanx", polityId: "macedon", label: "The sarissa phalanx",
    description: "Sixteen deep behind pikes of eighteen feet, five points before every man in front: nothing on earth stands against it head on. It wants level ground, keeps no second line to relieve it, and the pike takes long drilling before a file handles it as one.",
    appliesTo: { formationIds: ["phalangites"] },
    effects: [raise("frontal_weight", "marked"), raise("steadiness", "slight"), lower("rough_ground", "marked"), lower("drill_rate", "slight")],
  },
  {
    id: "macedon-besiegers-engineers", polityId: "macedon", label: "The Besieger's engineers",
    description: "Antigonus is the son of Demetrius the Besieger, whose nine-storey helepolis went against Rhodes in 305 (Diodorus 20.91). The house still keeps engineers and their engines: sieges go forward fast, and the train is slow and costly.",
    appliesTo: { lines: [...LAND_LINES] },
    effects: [raise("siege_craft", "marked"), lower("march_speed", "slight"), raise("levy_cost", "slight")],
  },
  // The Seleucids.
  {
    id: "seleucid-sarissa-phalanx", polityId: "seleucid-empire", label: "The sarissa phalanx",
    description: "The settlers fight as Macedonians, sixteen deep behind the long pike: irresistible head on, helpless on broken ground, with no second line, and slow to train.",
    appliesTo: { formationIds: ["phalangites"] },
    effects: [raise("frontal_weight", "marked"), raise("steadiness", "slight"), lower("rough_ground", "marked"), lower("drill_rate", "slight")],
  },
  {
    id: "seleucid-indian-elephants", polityId: "seleucid-empire", label: "Indian elephants",
    description: "The great Indian bull, with its driver and tower: horses that have never seen one will not face it, as the Galatians found. A wounded beast turns on its own side, and each eats as much as a company of men.",
    appliesTo: { categoryIds: ["elephant"] },
    effects: [raise("frontal_weight", "marked"), raise("screen", "slight"), lower("steadiness", "marked"), lower("supply_need", "marked")],
  },
  {
    id: "seleucid-military-colonies", polityId: "seleucid-empire", label: "The military colonies",
    description: "Macedonians and Greeks settled on allotments from Lydia to Bactria, owing the king a son to the phalanx. The phalanx renews itself and is the dynasty's; but its men live a thousand miles apart, and are long in coming to the muster.",
    effects: [raise("manpower_basis", "marked"), lower("loyalty_to_general", "slight"), lower("muster_speed", "marked")],
  },
  // The Ptolemies.
  {
    id: "ptolemaic-sarissa-phalanx", polityId: "ptolemaic-egypt", label: "The sarissa phalanx",
    description: "The cleruchs fight as Macedonians, sixteen deep behind the long pike: irresistible head on, helpless on broken ground, with no second line, and slow to train.",
    appliesTo: { formationIds: ["phalangites"] },
    effects: [raise("frontal_weight", "marked"), raise("steadiness", "slight"), lower("rough_ground", "marked"), lower("drill_rate", "slight")],
  },
  {
    id: "ptolemaic-cleruchy", polityId: "ptolemaic-egypt", label: "Land for service",
    description: "The cleruch holds his allotment for his service, and his son after him: the veteran's claim is met before he has made it, and the men live within a few days of Alexandria. But only Macedonians and Greeks hold allotments, and the Egyptians, who are nearly all of the kingdom, are not called.",
    effects: [lower("veteran_claim", "marked"), raise("muster_speed", "slight"), lower("manpower_basis", "marked")],
  },
  {
    id: "ptolemaic-african-elephants", polityId: "ptolemaic-egypt", label: "African elephants",
    description: "Forest elephants caught by the hunters of Ptolemais on the Red Sea: smaller than the Indian, and they broke before the Indian beasts at Raphia (Polybius 5.84). Frightening to horse, dangerous to their own side, and hungry.",
    appliesTo: { categoryIds: ["elephant"] },
    effects: [raise("frontal_weight", "slight"), raise("screen", "slight"), lower("steadiness", "marked"), lower("supply_need", "slight")],
  },
  {
    id: "ptolemaic-great-ships", polityId: "ptolemaic-egypt", label: "The great ships",
    description: "Polyremes of ten, thirteen and twenty banks carrying companies of marines: once they close, they board and carry anything afloat. They are slow, and their crews eat a province's grain.",
    appliesTo: { categoryIds: ["warship"] },
    effects: [raise("boarding", "marked"), lower("march_speed", "slight"), lower("supply_need", "slight")],
  },
];

export const PUNIC_DOCTRINES: readonly Doctrine[] = DOCTRINE_DRAFTS.map((draft) => DoctrineSchema.parse({
  ...draft,
  origin: "scenario",
  adoptedAtStep: 0,
  upkeepAccountId: null,
  adoptedByCharacterId: null,
  forceId: null,
  settledThroughStep: null,
  lapsedAtStep: null,
}));

export const PUNIC_ESTABLISHMENTS: readonly MilitaryEstablishment[] = [ROME, CARTHAGE, SYRACUSE, MACEDON, SELEUCIDS, PTOLEMIES].map((draft) => EstablishmentSchema.parse({
  ...draft,
  doctrineIds: PUNIC_DOCTRINES.filter((doctrine) => doctrine.polityId === draft.polityId).map((doctrine) => doctrine.id),
}));

/**
 * What the armies standing on the first morning have behind them. A levy is
 * raw and a hired company is not (`SOURCE_QUALITY`); these are the armies
 * that are neither, because they have already fought.
 */
export const SEASONED_ARMIES: Readonly<Record<string, { trainingBps: number; experienceBps: number }>> = {
  // Veterans of Pyrrhus (280-275) and of Curius' Samnite and Lucanian
  // campaigns since; a citizen militia, so drilled only so far.
  "roman-field-army": { trainingBps: 3_500, experienceBps: 3_000 },
  "allied-greek-hulls": { trainingBps: 3_000, experienceBps: 2_000 },
  // Long-service hired men, who held Lilybaeum against Pyrrhus in 277.
  "carthaginian-garrison": { trainingBps: 4_500, experienceBps: 4_000 },
  // They beat Pyrrhus' fleet in the strait in 276.
  "carthaginian-fleet": { trainingBps: 6_000, experienceBps: 4_500 },
  // Hieron's new citizens, blooded against the Mamertines.
  "syracusan-army": { trainingBps: 3_000, experienceBps: 2_000 },
  "syracusan-squadron": { trainingBps: 3_500, experienceBps: 2_500 },
  // Lysimachia in 277, Pyrrhus from 274 to his death at Argos in 272.
  "macedonian-royal-army": { trainingBps: 4_500, experienceBps: 4_000 },
  // The Galatian war and the First Syrian War (274-271).
  "seleucid-royal-army": { trainingBps: 3_500, experienceBps: 3_000 },
  // Cleruchs called up for the First Syrian War, farmers since.
  "ptolemaic-royal-army": { trainingBps: 3_000, experienceBps: 2_000 },
  "ptolemaic-royal-fleet": { trainingBps: 4_500, experienceBps: 3_500 },
};
