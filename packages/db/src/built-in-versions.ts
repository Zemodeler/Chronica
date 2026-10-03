/**
 * What each version of a built-in scenario changed, oldest first.
 *
 * This was thirty-seven inserts, one per version, and every one of them wrote
 * the *current* code's definition and opening world under its own number. On
 * a fresh database every version was therefore the same scenario; on an old
 * one each row was whatever the code said the day it first ran. A game
 * "pinned to v24" was pinned to nothing in particular.
 *
 * Now only the last version here is written from code, and only if its row
 * does not exist yet: a version's row is its snapshot, written once, never
 * rewritten, and never re-seeded as a different version. Older versions live
 * on in the databases that already hold them, which are the only databases
 * with games pinned to them; a game is moved forward deliberately, with
 * `repinGame` (queries/repin.ts), never by editing an old row.
 *
 * Changing a built-in scenario, then, means adding an entry at the end with a
 * version one higher. Editing the scenario's code without doing so changes
 * nothing in any database that already has the current version.
 */
export interface BuiltInScenarioVersion {
  readonly version: number;
  /** Stored on the row, for whoever reads the history in the database. */
  readonly notes: string;
}

/** The Numidian Decision, version by version. */
export const FIRST_PUNIC_WAR_VERSIONS: readonly BuiltInScenarioVersion[] = [
  // Version 2 replaces the former Latium ID with the ID in the delivered
  // GeoJSON. Existing version-1 saves remain pinned to their immutable
  // record; new databases begin directly with the corrected version.
  { version: 2, notes: "Aligns every simulated province with the delivered map geometry so armies always have a renderable location." },
  // Version 3 is the first under Simulation Loop v1: the scenario clock is
  // now a calendar epoch plus day spans rather than seasons-per-year, and the
  // starting world is schema 2 (instant-authoritative). A version-2 row cannot
  // be edited in place, and a game pinned to it would no longer load.
  { version: 3, notes: "Continuous time: a calendar epoch and day-based spans replace the seasonal turn clock." },
  // Version 4 widens the Roman command office's authorised actions. With only
  // force powers, a consul who raised legions and appointed their officers had
  // every appointment recorded as an authority breach.
  { version: 4, notes: "Gives the Roman command office the appointment and project powers a consul raising legions actually exercises." },
  // Version 5 drops the workflow reference every political procedure carried.
  // The engine it named was removed with the turn system, nothing read it,
  // and a procedure's real need is to say what is being decided.
  { version: 5, notes: "Replaces each political procedure's dead workflow reference with a plain label saying what is being decided." },
  // Version 6 widens the office again, for the same reason version 4 did.
  // The political, material, arrangement and battle deltas all arrived after
  // the office was last written, so a consul putting a motion to the Senate
  // -- the thing a consul most obviously does -- was recorded as
  // insubordination.
  { version: 6, notes: "Widens both offices to the powers a head of state actually exercises: putting questions to the council, moving the polity's own standing and provinces, founding arrangements, and giving battle." },
  // Version 7: world schema 3. Storylines shed the fields of a deleted
  // director architecture and the narrator's ledger arrives -- see
  // `WORLD_SCHEMA_VERSION`.
  { version: 7, notes: "World schema 3: storylines with provenance and a closed phase vocabulary, and the narrator's ledger." },
];

/** Punic Wars, version by version. */
export const PUNIC_WARS_VERSIONS: readonly BuiltInScenarioVersion[] = [
  // Version 5 fixes settlements missing a provinceId in some provinces,
  // which failed WorldStateSchema validation and blocked hosting entirely.
  { version: 5, notes: "Fixes settlements missing provinceId that broke world-state validation on game creation." },
  // Version 6 adds the Roman Senate institution and eligibility requirement
  // records that were missing entirely, which made every sponsor_procedure
  // (Senate petitions, command authorizations, office elections) fail its
  // dry run unconditionally -- canSponsorProcedure rejects any institutionId
  // that doesn't exist in world.material.institutions.
  { version: 6, notes: "Adds the Roman Senate institution and eligibility requirements, which were missing and made every political procedure fail." },
  // Version 7 adds the province adjacency graph (map.edges), which was
  // entirely empty -- every "which nearby polities might react" computation
  // (Reaction Director, near/far/coarse event scoping) silently had nothing
  // to read, so no neighboring polity could ever be proposed as a reactor
  // no matter what happened in its territory.
  { version: 7, notes: "Adds the province adjacency graph, which was empty and silently disabled every neighbor-based reaction system." },
  // Version 8 seats the second consul. Rome had two; the scenario modelled
  // one, already held, so a player who declared themselves consul found the
  // college full and started the game holding no office -- and therefore no
  // Authority at all.
  { version: 8, notes: "Seats the second Roman consul, so a player who declares a consulship has a lawful seat to take." },
  // Version 9 fixes the Mamertine spokesman's ambition, which named the
  // wrong-scenario settlement id "messana-city" instead of this scenario's
  // own "settlement-messana" (start_siege and any other settlement-naming
  // tool refuse an id that doesn't resolve). It also gives Carthage real
  // agency from the opening turn: an active goal, plot, and pressure over
  // the Messana crisis, and Hanno's own place among the storyline's
  // participants -- previously Carthage was a force with nothing for
  // character agency to act on, so it never proposed anything the Game
  // Master could invoke.
  { version: 9, notes: "Fixes the Mamertine spokesman's ambition to name this scenario's own settlement id, and gives Carthage/Hanno an authored goal, plot, and pressure over the Messana crisis so Carthage has real agency from the opening turn." },
  // Version 10 makes the playable world agree with the rendered map. A
  // settlement shown inside a simulated province is now present in that
  // province's authoritative state, so it can be inspected and besieged.
  { version: 10, notes: "Adds every rendered settlement in a playable province to the authoritative starting world, preventing map-visible settlements from being impossible to inspect or besiege." },
  // Version 11 aligns Etruria and Volsinii's authoritative controllers
  // with the opening map. Before this version the opening overlay displayed
  // Rome, but the seeded world assigned the territory to the Etruscan
  // cities; after the first turn the persisted state replaced the overlay
  // and made the territory appear to switch sides.
  { version: 11, notes: "Aligns Etruria and Volsinii's authoritative Roman control with the opening map, preventing their controller from changing after the first turn." },
  // Version 12: same cutover as the First Punic War's version 3 above.
  { version: 12, notes: "Continuous time: a calendar epoch and day-based spans replace the seasonal turn clock." },
  // Version 13: same office-powers widening as the First Punic War's version 4.
  { version: 13, notes: "Gives the Roman consulship the appointment and project powers it actually exercises." },
  // Version 14: same procedure-label change as the First Punic War's version 5.
  { version: 14, notes: "Replaces each political procedure's dead workflow reference with a plain label saying what is being decided." },
  // Version 15: same office widening as the First Punic War's version 6.
  { version: 15, notes: "Widens both offices to the powers a head of state actually exercises: putting questions to the council, moving the polity's own standing and provinces, founding arrangements, and giving battle." },
  // Version 16 gives the world people of its own. The scenario named four
  // characters, so everyone outside the player's business was a country with
  // nobody in it: Syracuse never moved on Messana and Carthage negotiated
  // with no one, because there was nobody there to do it. This adds the men
  // who actually held these places in 270 BCE, the standing aims each
  // government is pursuing privately, and Rome's own unfinished war at
  // Rhegium -- the material the ambient cast reasons from.
  { version: 16, notes: "Adds the historical cast of 270 BCE (Dentatus, Ogulnius, Vibellius at Rhegium, Leptines of Syracuse, Hannibal Gisco), every power's standing aims, and the Rhegium storyline, so the world away from the player has people and purposes of its own." },
  // Version 17 makes the whole drawn map authoritative. The scenario had
  // written down twenty provinces and ten polities -- Italy, Sicily and the
  // Carthaginian heartland -- while the map drew the western Mediterranean
  // entire, and everything outside those twenty was an overlay painted over
  // ground the simulation had no record of. When that overlay stopped being
  // merged into the view, the rest of the world simply went blank, because
  // there had never been anything behind it. All 779 provinces the map gives
  // a controller are now real state, with derived terrain, 2,227 borders, and
  // the 126 peoples who hold them: the Gauls, Iberians, Britons, Germans,
  // Illyrians, Thracians, the Greek leagues, Macedon, Epirus, the Numidian
  // and Mauretanian kingdoms.
  { version: 17, notes: "Makes the whole drawn map authoritative: all 779 controlled provinces, their borders and the 126 peoples who hold them become real world state instead of an overlay painted over ground the simulation had no record of." },
  // Version 18: world schema 3, as the First Punic War's version 7. The world
  // now makes trouble of its own: storylines the narrator seeds and the
  // orchestrator advances, with a ledger so the pacing replays.
  { version: 18, notes: "World schema 3: storylines with provenance and a closed phase vocabulary, and the narrator's ledger, so the world away from the player can start things of its own." },
  // Version 19 gives the world outside the player's own army the things it
  // was missing: letters between powers, war and peace as state rather than a
  // trust score, a map an army has to actually cross, and ships -- without
  // which Sicily was another province of Italy and a naval war could be
  // fought by walking.
  { version: 19, notes: "Makes the straits water and gives the powers fleets, so crossing to Sicily needs ships; adds the naval troop category the period actually fought with." },
  // Version 20 seats the other powers' heads. Hieron negotiating for Syracuse
  // and Hanno for Carthage were recorded as insubordinate, because neither
  // held an office and authority derives from offices.
  { version: 20, notes: "Gives Syracuse, the Mamertines and Carthage's command in Sicily offices and seats them, so a foreign head of state acting for his own power is not recorded as a breach." },
  // Version 21: the Campanian legion holding Rhegium becomes the power it
  // actually was. Filed under Rome, it could not be attacked at all -- two
  // forces of one power will not fight each other -- so the siege ran to the
  // assault and the engine refused it. It now holds Rhegium as its own
  // polity, with its own army, its own aims, and Rome's war against it
  // already on the books.
  { version: 21, notes: "Makes the Campanian legion at Rhegium its own power with its own army and aims, and records Rome's war against it, so the siege the scenario is about can actually be fought." },
  // Nobody in this world had ever aged: `life` was defaulted to no bands at
  // all, so the mortality roll that has existed since the character system
  // was written could never fire. Six bands off Roman evidence, reviewed
  // monthly. And the war the age is named for becomes reachable: Messana
  // asking for a protector is one pressure, and a great power crossing the
  // strait while the other refuses to have it is the pressure that follows
  // it -- held back by `afterPressureIds` until the asking has happened.
  { version: 22, notes: "Gives the age its own mortality -- six historical bands, reviewed monthly -- and chains the crossing of the strait to Messana having asked for a protector, so the First Punic War is something this world can fall into." },
  // What a Roman of a given standing is actually worth, off the census
  // classes. Without bands the declaration prompt asked for the standing and
  // the money in the same breath and believed whatever came back.
  { version: 23, notes: "Bounds what a person of a given standing is worth by the Roman census classes, so a common soldier cannot open with a senator's fortune and a merchant invented to lend money has something to lend." },
  // An economy, which this scenario simply did not have: nine personal
  // purses, no treasury anywhere, nothing coming in and nothing owed. A war
  // cost nobody anything, no office could confer fiscal reach because there
  // was nothing to reach, and VISION §7 had no subject.
  { version: 24, notes: "Gives each power a treasury, what it takes in and what it owes, and gives each office the chest it answers for -- so a war costs money, an unpaid army can go unpaid, and the ruler can read his own books." },
  // Version 25 connects the armies to the money. Version 24 authored what
  // each power owed and never said which army any of it paid: all eight
  // forces carried a null pay obligation, so the tick's arrears rules --
  // and with them the scenario's own `arrearsMoralePeriods` and
  // `arrearsDesertionPeriods` -- could not reach a single one of them. The
  // Mamertines run out of money in the eleventh month and the garrison
  // holding Messana never noticed.
  { version: 25, notes: "Names the army behind every wage bill, and pays Hieron's hoplites and Rome's allied hulls at all -- so an unpaid army loses its morale and then its men, instead of a treasury going broke while the men holding the city never hear of it." },
  // Version 26 gives every army a chest of its own. Until now every account
  // in the world belonged to a person or a government, so an army could only
  // ever be paid by somebody sitting still somewhere else, plunder had
  // nowhere to go, and "they will be paid out of what they take" was an
  // order the engine could narrate and not obey.
  { version: 26, notes: "Gives every army the chest it carries, so plunder has somewhere to land and an army can be paid out of what it takes rather than only out of a treasury." },
  // Version 27 is the economy the powers can actually run on, and the land
  // men live on. Rome took in 920 a month and a new legion's pay was most of
  // its surplus; it now takes in about 1 800, and every power has thousands
  // in hand. The consulship runs for a year and is refilled by election, and
  // the leading men own estates, so a private citizen has land of his own to
  // improve.
  { version: 27, notes: "Roughly doubles every power's revenue (Rome to about 1 800 a month) and lifts the Mamertine treasury to thousands; gives the consulship its one-year term; and gives the leading men estates that pay them and can be improved." },
  // Version 28 is every station a person can hold: Rome's quaestors,
  // tribunes, aediles, praetor, censors, dictator, Senate and priesthoods,
  // with the ladder between them; Carthage's suffetes, elders and the
  // Hundred and Four; Syracuse's court; and a ruler, council and priesthood
  // for every other power on the map.
  { version: 28, notes: "Gives every power its real offices -- Rome's full ladder of magistracies with ages, rungs and the ten-year gap, the Senate, the priesthoods; Carthage's suffetes and councils; Syracuse's court; a ruler, council and priesthood for everyone else -- and seats the named men in them." },
  // Version 29 seats Gnaeus Cornelius Blasio, the second consul of 270,
  // in the chair the scenario had always left empty.
  { version: 29, notes: "Seats the second consul of 270, Gnaeus Cornelius Blasio, with his purse, estates and Senate seat, so both consular chairs are filled." },
  // Version 30 cuts what Rome pays a soldier by more than half, and names the rate, so new
  // legions are priced from it rather than guessed.
  { version: 30, notes: "Lowers Roman soldiers' pay to 35 a month for every thousand men and says so in the treasury, so Rome can keep twenty thousand under arms; the field army's pay falls from 300 to 140." },
  // Version 31 puts the map back in 270: Carthage keeps the Punic coast of Africa and
  // loses Iberia, the Numidian interior and Morocco; Macedon holds Thessaly, Corinth and
  // Chalcis; Cyrene is Magas's kingdom. Money is counted in drachmae, and the Roman
  // assemblies, not the Senate, elect the magistrates.
  { version: 31, notes: "Corrects the opening map to 270 BCE (Carthage out of Iberia, the Numidian interior and Morocco; Macedon in Thessaly, Corinth and Euboea; Cyrene independent; anachronistic tribes and towns removed), counts money in drachmae, and has the Centuriate and Tribal Assemblies, not the Senate, elect the magistrates." },
  // Version 32 makes Rome's allies what they were: the Etruscans, Umbrians, Picentes, Marsi
  // and Paeligni, Samnites, Lucanians, Bruttians and Apulian cities govern themselves and
  // follow Rome by foedus -- soldiers, not tribute, and no war or peace of their own. Rome
  // keeps Latium and Campania and its Latin colonies. The Messapians hold the Sallentine
  // peninsula, free until 267.
  { version: 32, notes: "Rome's Italian allies become polities bound by foedus (soldiers for Rome's wars, no tribute, no war or peace of their own); Rome keeps Latium, Campania and its Latin colonies, gains an allied contingent and loses the allied tribute; Messapia is split from Apulia and free." },
  // Version 33 gives every power a government: Carthage its council, tribunal and
  // assembly, Syracuse the king's council, the Mamertines and the Campanians of Rhegium
  // their soldiers' assemblies, and every other power a form its constitution grows from.
  { version: 33, notes: "Every power governs itself through chambers: Carthage's Council of Elders, Hundred and Four and Assembly of the People; Syracuse's advisory councils; the Mamertine and Campanian soldiers' assemblies; and a government form for every other power, from which its chambers and offices are grown. Rome's blocs now lean by what they want." },
  // Version 34 puts somebody in every chair: every power that holds ground begins with
  // its ruler seated by name -- the known kings of 270 as themselves, everyone else named
  // as his people named their sons -- and every league with its commander of horse. The
  // Mamertines' leader is Statius Mettius.
  { version: 34, notes: "Every power begins with a named ruler in his seat (Antigonus Gonatas, Areus I, Magas, Alexander II and the rest by name), every league with a commander of horse, so no power opens by calling an election; the Mamertine spokesman is Statius Mettius." },
  // Version 35 puts somebody in charge of the state's work: Rome's treasury,
  // censorship, aediles, praetor's court and pontiffs, and Carthage's
  // accounts, the Hundred and Four and the priests of Baal Hammon are
  // departments, and their officers' gifts are what the work is done with.
  { version: 35, notes: "Rome and Carthage open with departments: the Treasury of Saturn, the Censorship, the Aediles, the Urban Praetor's Court and the College of Pontiffs; the Office of the Accounts (a new office), the Hundred and Four and the Priests of Baal Hammon. A lever no department holds is the ruler's, and a man holding too much does all of it worse." },
  // Version 36 swaps the map. The 780 provinces become 6,384 organic ones grown from the
  // settlements alive in 270 BCE, Anatolia, Egypt, Arabia, Iraq, the Levant, the Caucasus and Iran added; a new map asset (...0203) carries them.
  { version: 36, notes: "A new map of 6,384 provinces over Europe, North Africa and the Near East as far as Iran, with open desert that belongs to nobody, named for the regions they lie in (the old town names are kept as aliases), with each province's area, and every border's distance in kilometres: marches, letters and voyages now take as long as the ground is long, and a province's people are counted by its area. Ownership follows the old map by overlay, and the east opens with thirty-five new powers (the marsh peoples, the Scenitae Arabs and the Zagros hill tribes among them; the Seleucid and Ptolemaic kingdoms, Pergamon, Bithynia, Pontus, Cappadocia, Armenia, the Galatian tribes, Caucasian Iberia, Judea, the Nabataeans and others). Named places keep their settlements, and Antiochus I, Ptolemy II, Philetaerus, Nicomedes I, Mithridates I and Pharnavaz I sit in their seats." },
  // Version 37 puts somebody in every chair that matters.
  { version: 37, notes: "Rome's quaestors, tribunes of the plebs, aediles, urban praetor, censors, pontiffs, augurs and Vestals are named people, as are Carthage's suffetes, judges, elders and officers of the accounts, Syracuse's generals and friends of the king, and the councillors of the Mamertines and the Campanians; every major kingdom and league opens with its council, generals and priests named as well as its ruler. Hovering over an office says exactly what its holder may do." },
  { version: 38, notes: "Every polity opens with cities and a capital. Adds researched ancient centres and explicitly modeled assembly and market towns where no contemporary urban seat is attested. A captured capital remains an ordinary settlement and is not automatically promoted on recapture." },
  { version: 39, notes: "Surviving polities choose replacement capitals after losing their seats. Recapture restores a displaced capital automatically only while the same war remains active; after peace or in a later war, an explicit capital-designation order is required." },
  { version: 40, notes: "Replaces generated assembly and market labels with documented ancient place names or archaeological site names. Records dating and polity-attribution uncertainty, preserves real site coordinates, and upgrades old generic labels without changing conquest or capital history." },
  { version: 41, notes: "Rome as its constitution stood in 270. Every Roman is a patrician or a plebeian by his gens; tribunes of the plebs and the two new plebeian aediles are plebeians, chosen by a new Council of the Plebs that only the tribunes convene; one consul a year and one censor a lustrum must be plebeians, as must four pontiffs and five augurs. Ages and the order of the rungs are custom rather than law (the voters favour a man who has served below), the lex Genucia bars any magistracy again within ten years, and the dictator is a consular. Only a consul, praetor, dictator or tribune may put a question to the Senate, and only a magistrate with imperium may call the assemblies. Seats are filled the way their offices are: the censors enrol the Senate, a consul names the dictator, the pontifex maximus chooses the Vestals, the people elect sixteen military tribunes and the consuls name the rest, and nobody's power to appoint reaches an elected magistracy." },
  // Version 42 gives the six great powers armies made of something: each keeps an
  // establishment (punic-wars-establishments.ts) that draws its armies up, and opening
  // doctrines that each give and take.
  { version: 42, notes: "Armies are drawn up the way each great power built them. Rome's field army is a legion -- velites, hastati, principes and triarii in maniples, and Roman horse -- beside an ala of the allies with its own horse; Carthage's field force is Libyan foot, Numidian horse, Balearic slingers and Iberian and Gallic mercenaries, each nation under its own captains; Hieron's army is citizen hoplites, hired men and horse. Macedon, the Seleucid kingdom and Egypt, which had no army at all, open with standing royal armies: the sarissa phalanx, guards and Companion horse, mercenaries and light troops, Indian elephants at Apamea and African elephants and the royal fleet at Alexandria. Each power opens with its doctrines -- the triplex acies and the marching camp, a host of many nations, the sarissa phalanx -- every one with its price. Light infantry and elephants are new kinds of troops." },
  // Version 43 gives the wider world its politics (punic-wars-politics.ts), so
  // powers away from Rome have something to want (docs/plans/a-living-world.md).
  { version: 43, notes: "The world beyond Italy has its quarrels. The Successor kings regard each other as they did in 270: Egypt and the Seleucids at a peace of 271 that settled nothing, with Antiochus claiming Coele-Syria, Phoenicia and the Asian coast; Macedon and the Seleucids friends by marriage; Athens and Sparta bitter against the Macedonian garrisons and leaning on Egypt; Magas of Cyrene in revolt against his half-brother; Epirus wanting back what Pyrrhus held; Bithynia and the Galatians against Antioch; Carthage and Syracuse, Massalia and Carthage, the Boii and Rome. Twenty-one more powers have aims of their own, and the age leans toward the Chremonidean rising, a second war for Coele-Syria, Epirus marching on Macedon, Galatian raids and Magas marching on Egypt -- while the world still looks the way it did." },
  // Version 44 carries the data the 2026-10-02 play-test fixes needed (docs/reports/2026-10-03-codex-hand-playtest-triage.md).
  { version: 44, notes: "Transports are a kind of ship of their own, a hundred and twenty men a hull, and the allied Greek hulls are transports, so a consul can ferry his army across the strait. A legion's ladder runs miles, optio, signifer, centurions, and every rank says who gives it. The sixteen military tribunes are young men between twenty and forty-five, not former consuls. The great houses of Rome, Syracuse and Carthage open with their wives, sons and daughters, so a man can marry into one and have heirs." },
];

/** The version the code seeds: the last one written down. */
export function currentBuiltInVersion(versions: readonly BuiltInScenarioVersion[]): BuiltInScenarioVersion {
  const last = versions.at(-1);
  if (last === undefined) throw new Error("A built-in scenario has no versions.");
  return last;
}
