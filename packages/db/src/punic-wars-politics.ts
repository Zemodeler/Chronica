import { stationOf, withVices, type ClaimRecord, type PolityAgreement, type PolityOutlook, type PolityStance, type ScenarioHistoricalPressure, type WorldState } from "@chronica/shared";

/**
 * The politics of the wider world in 270 BCE (docs/plans/a-living-world.md §1).
 *
 * The scenario wrote aims for six powers of 168 and grudges only between the
 * Italian allies and Rome, so two hand runs found a world in which no power
 * outside the player's business wanted anything: Ptolemy's section named no
 * Antiochus, Antigonus was never asked, and no war opened in three years that
 * the player had not started. This is what the age actually held between the
 * powers away from Rome -- who hated whom, who claimed whose ground, which
 * peaces stood, and what each government meant to do -- written as ordinary
 * world state the engine weighs (`sim/src/board.ts`, `sim/src/statecraft.ts`).
 *
 * None of it is a script. A grudge is a number the world AI weighs against
 * strength and risk, a claim is a reason rather than a schedule, and a
 * historical leaning (below) is a pressure that is only offered while the
 * world still looks the way it did.
 */

type Stance = readonly [polityId: string, towardPolityId: string, trust: number, why: string];

/** How each power regards the others that matter to it. Directed: Cyrene hates Egypt more than Egypt hates Cyrene. */
const STANCES: readonly Stance[] = [
  // The Successor kingdoms.
  ["ptolemaic-egypt", "seleucid-empire", -65, "The first war over Coele-Syria ended in 271 with nothing settled; Antiochus still wants the coast and its ports."],
  ["seleucid-empire", "ptolemaic-egypt", -70, "Ptolemy holds Coele-Syria, Phoenicia and the cities of the Asian coast, all of which Seleucus was promised at Ipsus."],
  ["macedon", "seleucid-empire", 40, "Antigonus married Antiochus's sister Phila, and the two kings have kept the peace of 278."],
  ["seleucid-empire", "macedon", 40, "A marriage and a peace, and a common rival in Egypt."],
  ["ptolemaic-egypt", "macedon", -40, "Antigonus's garrisons hold Greece, and Ptolemy pays whoever will stand against them."],
  ["macedon", "ptolemaic-egypt", -45, "Egyptian gold and Egyptian fleets keep the Greek cities restless."],
  ["cyrene", "ptolemaic-egypt", -70, "Magas of Cyrene is Ptolemy's half-brother and has called himself king against him; he marched on Egypt in 274."],
  ["ptolemaic-egypt", "cyrene", -50, "A brother in revolt on the western border, and an ally of Antiochus."],
  ["cyrene", "seleucid-empire", 45, "Magas married Antiochus's daughter Apama: Egypt's enemies are one family."],
  ["seleucid-empire", "cyrene", 40, "A son-in-law on Ptolemy's western flank."],
  // Greece against Macedon: the Chremonidean rising is two years off.
  ["athens", "macedon", -70, "A Macedonian garrison sits in the Piraeus and on the Mouseion; Chremonides and his friends mean to be free of it."],
  ["sparta", "macedon", -60, "Areus wants to lead the Greeks again, and Antigonus stands in the way."],
  ["achaean-league", "macedon", -40, "The Achaean towns threw out their Macedonian tyrants and garrisons and do not want them back."],
  ["macedon", "athens", -35, "A city that will rise the moment Macedon looks away."],
  ["macedon", "sparta", -30, "Areus is Ptolemy's man in the Peloponnese."],
  ["athens", "ptolemaic-egypt", 50, "Ptolemy sends grain and promises; Athens looks to Alexandria for its freedom."],
  ["sparta", "ptolemaic-egypt", 45, "Egyptian money pays Spartan mercenaries."],
  ["ptolemaic-egypt", "athens", 40, "A friend against Antigonus, and a city worth being seen to protect."],
  ["athens", "sparta", 30, "Old rivals, newly united against Macedon."],
  ["sparta", "athens", 30, "Old rivals, newly united against Macedon."],
  ["aetolian-league", "macedon", -20, "The Aetolians beat the Gauls at Delphi without Macedon and mean to keep their mountains their own."],
  // Epirus and Macedon: Pyrrhus is two years dead, and his son wants back what his father won.
  ["epirus", "macedon", -60, "Pyrrhus held Macedon and lost it; his son Alexander has not forgotten."],
  ["macedon", "epirus", -50, "Epirus holds three districts Pyrrhus took from Macedon."],
  ["illyria-ardiaei", "epirus", -30, "Illyrian raiders on the Epirote coast."],
  // Asia Minor.
  ["bithynia", "seleucid-empire", -50, "Nicomedes brought the Gauls into Asia to keep his kingdom from Antiochus."],
  ["seleucid-empire", "bithynia", -45, "A king who invited the Galatians across the straits."],
  ["galatians-tolistobogii", "seleucid-empire", -55, "Beaten by Antiochus's elephants, and not reconciled to it."],
  ["galatians-tectosages", "seleucid-empire", -45, "The Galatians live on what they take from the cities of Asia."],
  ["galatians-trocmi", "seleucid-empire", -45, "The Galatians live on what they take from the cities of Asia."],
  ["seleucid-empire", "galatians-tolistobogii", -55, "Raiders in the heart of Asia Minor."],
  ["pergamon", "seleucid-empire", 20, "Philetaerus keeps Seleucid friendship and his own treasury."],
  ["pontus", "seleucid-empire", -25, "A new kingdom that wants nobody's overlordship."],
  ["cappadocia", "seleucid-empire", -20, "The Cappadocian dynasts acknowledge Antioch only when they must."],
  ["armenia", "seleucid-empire", -30, "The Orontids pay tribute when an army is near, and not otherwise."],
  ["rhodes", "ptolemaic-egypt", 35, "Rhodes lives on the Alexandrian grain trade."],
  // The West.
  ["carthage", "syracuse", -40, "A century of wars for Sicily; Hieron is the newest Syracusan to want the whole island."],
  ["syracuse", "carthage", -45, "Carthage holds the west of Sicily and the Greek cities in it."],
  ["massalia", "carthage", -50, "Rivals for the sea from the Rhône to Iberia since Alalia."],
  ["carthage", "massalia", -40, "Greek traders in waters Carthage calls its own."],
  ["massalia", "rome", 45, "Old friends of Rome, and its eyes on the Gallic coast."],
  ["rome", "massalia", 40, "A Greek city that has always kept faith."],
  ["iberia-turdetani", "carthage", -30, "Carthage's Gades taxes the silver road."],
  ["numidian-kingdoms", "carthage", -25, "Carthage takes Numidian horsemen and pays for them as it likes."],
  ["carthage", "numidian-kingdoms", -20, "Horsemen worth hiring and a border worth watching."],
  // Rome's Gauls.
  ["boii", "rome", -60, "Beaten at Lake Vadimon in 283 and not reconciled; Roman colonies creep up the Adriatic coast."],
  ["insubres", "rome", -45, "The Boii's neighbours and kin, who will not stand by if Rome marches north."],
  ["rome", "boii", -40, "The Gauls burned Rome once."],
  ["boii", "insubres", 40, "Kin across the Padus."],
  ["insubres", "boii", 40, "Kin across the Padus."],
  ["rome", "ptolemaic-egypt", 40, "Ptolemy sent envoys in 273 and Rome answered: friends at a distance."],
  ["ptolemaic-egypt", "rome", 40, "A power worth having as a friend, far enough not to be a rival."],
];

/** The peaces that stood in 270, so a war between their powers breaks a treaty and is remembered for it. */
const PEACES: readonly (readonly [polityId: string, otherPolityId: string, terms: string])[] = [
  ["ptolemaic-egypt", "seleucid-empire", "The peace of 271 that ended the first war for Coele-Syria: each kept what he held."],
  ["macedon", "seleucid-empire", "The peace of 278 and Antigonus's marriage to Phila."],
];

/** Ground one power holds and another claims, chosen by prefix and holder from the map as it is. */
const CLAIMS: readonly { readonly claimant: string; readonly holder: string; readonly prefixes: readonly string[]; readonly kind: ClaimRecord["claimKind"]; readonly strengthBps: number; readonly why: string; /** Only the claimed ground that touches the claimant's own. */ readonly bordering?: boolean }[] = [
  { claimant: "seleucid-empire", holder: "ptolemaic-egypt", prefixes: ["jud-", "syr-", "lev-"], kind: "treaty", strengthBps: 8_000, why: "Coele-Syria and Phoenicia were given to Seleucus after Ipsus; Ptolemy took them first." },
  { claimant: "seleucid-empire", holder: "ptolemaic-egypt", prefixes: ["cil-", "lyc-", "ion-"], kind: "conquest", strengthBps: 5_000, why: "The coast of Asia Minor was Seleucus's by conquest; Ptolemy's fleets took its cities." },
  { claimant: "epirus", holder: "macedon", prefixes: ["mac-"], kind: "conquest", strengthBps: 4_000, why: "Pyrrhus was king in Macedon twice, and the western districts were his longest.", bordering: true },
  { claimant: "macedon", holder: "epirus", prefixes: ["mac-"], kind: "historical", strengthBps: 7_000, why: "Macedonian districts Pyrrhus carried off to Epirus." },
  { claimant: "syracuse", holder: "carthage", prefixes: ["sic-"], kind: "historical", strengthBps: 4_000, why: "The Greek cities of the west of Sicily, under Carthage since Agathocles' death." },
  { claimant: "syracuse", holder: "mamertines", prefixes: ["sic-"], kind: "historical", strengthBps: 6_000, why: "Messana was a Greek city until the Mamertines murdered its men and took it." },
];

/** What each of the great powers away from Italy means to do. Secret, like every outlook. */
const OUTLOOKS: readonly Omit<PolityOutlook, "updatedAtStep" | "lastChangeReason">[] = [
  { polityId: "seleucid-empire", primaryObjective: "Hold the whole inheritance of Seleucus from the Aegean to the Indus, and take back Coele-Syria when Egypt can be beaten.", concerns: [{ label: "Ptolemy holding Coele-Syria and the Asian coast", level: "high" }, { label: "the Galatians raiding the cities of Asia", level: "medium" }, { label: "the eastern satrapies drifting away", level: "medium" }], intentions: ["rebuild the army after the last war and strike for Coele-Syria when Egypt is distracted", "keep the Galatians in their hills", "keep Macedon a friend"], riskTolerance: 55 },
  { polityId: "ptolemaic-egypt", primaryObjective: "Keep Coele-Syria and the sea, and keep Antigonus busy in Greece with Egyptian money rather than Egyptian blood.", concerns: [{ label: "Antiochus wanting Coele-Syria back", level: "high" }, { label: "Magas of Cyrene calling himself king", level: "high" }, { label: "Macedon mastering Greece", level: "medium" }], intentions: ["fund the Greek cities against Macedon", "hold the Syrian frontier forts", "bring Cyrene back under Alexandria, by marriage or by force"], riskTolerance: 45 },
  { polityId: "macedon", primaryObjective: "Hold Macedon and the Greek fortresses that hold Greece -- Corinth, Chalcis, Demetrias, the Piraeus.", concerns: [{ label: "Athens and Sparta stirred up by Egypt", level: "high" }, { label: "Alexander of Epirus wanting his father's conquests back", level: "medium" }, { label: "Gauls on the northern border", level: "medium" }], intentions: ["keep the garrisons in Greece whatever it costs", "put down a Greek rising before Egypt can land an army", "watch Epirus"], riskTolerance: 50 },
  { polityId: "epirus", primaryObjective: "Win back what Pyrrhus held, beginning with Macedon's western districts.", concerns: [{ label: "Antigonus Gonatas, stronger every year", level: "high" }, { label: "Illyrian raiders on the coast", level: "low" }], intentions: ["strike at Macedon when its army is busy in Greece", "take Acarnania"], riskTolerance: 65 },
  { polityId: "athens", primaryObjective: "Throw out the Macedonian garrison and be free, with Sparta and Egypt beside her.", concerns: [{ label: "the garrison in the Piraeus", level: "high" }, { label: "a Macedonian army at the gates", level: "high" }], intentions: ["bind Sparta and Ptolemy in an alliance against Antigonus", "rise when the alliance is ready"], riskTolerance: 60 },
  { polityId: "sparta", primaryObjective: "Lead the Greeks against Macedon, as Sparta once led them against Persia.", concerns: [{ label: "Macedonian garrisons in the Peloponnese", level: "high" }, { label: "money for mercenaries", level: "medium" }], intentions: ["march against the Macedonian garrisons with Athens", "win the Peloponnesian cities to Sparta's side"], riskTolerance: 60 },
  { polityId: "cyrene", primaryObjective: "Keep Cyrene a kingdom of its own, never again a province of Alexandria.", concerns: [{ label: "Ptolemy wanting Cyrene back", level: "high" }, { label: "the Libyan nomads of the interior", level: "low" }], intentions: ["march on Egypt again when Ptolemy is at war elsewhere", "keep Antiochus's friendship"], riskTolerance: 55 },
  { polityId: "bithynia", primaryObjective: "Keep Bithynia free of Antioch, with Gallic swords if need be.", concerns: [{ label: "Antiochus's armies in Asia Minor", level: "high" }], intentions: ["keep the Galatians pointed at Seleucid ground", "found a royal city on the Propontis"], riskTolerance: 50 },
  { polityId: "pergamon", primaryObjective: "Keep the treasure of Pergamon and grow quietly between the kings.", concerns: [{ label: "the Galatians", level: "high" }, { label: "Antioch deciding Pergamon is too rich", level: "medium" }], intentions: ["pay the Galatians off or hire men to keep them away", "keep Antiochus friendly"], riskTolerance: 30 },
  { polityId: "galatians-tolistobogii", primaryObjective: "Live on the cities of Asia: tribute, plunder and service for pay.", concerns: [{ label: "Antiochus's elephants", level: "medium" }], intentions: ["raid the cities of western Asia Minor for tribute", "sell their swords to whichever king pays"], riskTolerance: 70 },
  { polityId: "achaean-league", primaryObjective: "Keep the Achaean towns free of tyrants and garrisons, and draw more towns into the League.", concerns: [{ label: "Macedonian garrisons in Corinth and Argos", level: "high" }], intentions: ["win neighbouring towns to the League", "join a Greek rising against Macedon if it looks like winning"], riskTolerance: 40 },
  { polityId: "aetolian-league", primaryObjective: "Hold Delphi and the mountains, and grow by protecting those who join.", concerns: [{ label: "Macedon", level: "medium" }, { label: "the Acarnanians", level: "low" }], intentions: ["draw the towns around Delphi into the League", "raid Acarnania"], riskTolerance: 55 },
  { polityId: "massalia", primaryObjective: "Keep the sea from the Rhône to Iberia open to Massalia and shut to Carthage.", concerns: [{ label: "Carthaginian fleets", level: "high" }, { label: "the Gallic tribes behind the city", level: "medium" }], intentions: ["keep Rome a friend", "found trading posts along the Iberian coast"], riskTolerance: 30 },
  { polityId: "numidian-kingdoms", primaryObjective: "Keep the Numidian chiefs their own masters, selling horsemen to Carthage on their own terms.", concerns: [{ label: "Carthage pushing its frontier inland", level: "medium" }], intentions: ["raid the Carthaginian frontier when Carthage is busy at sea", "settle the quarrels between the chiefs"], riskTolerance: 55 },
  { polityId: "iberia-turdetani", primaryObjective: "Keep the silver of the Baetis in Turdetanian hands.", concerns: [{ label: "Carthage at Gades", level: "medium" }], intentions: ["trade with Carthage without being ruled by it"], riskTolerance: 35 },
  { polityId: "insubres", primaryObjective: "Keep the Padus plain Gallic.", concerns: [{ label: "Rome's colonies on the Adriatic", level: "high" }], intentions: ["stand with the Boii if Rome comes north", "hire Gaesatae from beyond the Alps if war comes"], riskTolerance: 55 },
  { polityId: "illyria-ardiaei", primaryObjective: "Make the Ardiaean kingdom master of the Adriatic coast.", concerns: [{ label: "Epirus and the Greek colonies", level: "medium" }], intentions: ["raid the coasts of Epirus and the Greek colonies", "bring the neighbouring Illyrian peoples under the king"], riskTolerance: 65 },
  { polityId: "armenia", primaryObjective: "Pay Antioch as little as can be paid, and be a kingdom.", concerns: [{ label: "a Seleucid army in the north", level: "medium" }], intentions: ["withhold tribute when Antiochus is busy in the west"], riskTolerance: 50 },
  { polityId: "pontus", primaryObjective: "Make Pontus a kingdom no one can overlook.", concerns: [{ label: "Antioch", level: "medium" }, { label: "the Galatians", level: "medium" }], intentions: ["take the Greek cities of the coast under protection", "stay friends with the Galatians who helped against Antiochus"], riskTolerance: 50 },
  { polityId: "rhodes", primaryObjective: "Keep the sea free for Rhodian ships.", concerns: [{ label: "pirates", level: "high" }, { label: "any one king mastering the Aegean", level: "medium" }], intentions: ["hunt pirates", "stay friends with Alexandria"], riskTolerance: 30 },
  { polityId: "thrace-odrysians", primaryObjective: "Rebuild the Odrysian kingdom out of the ruin the Gauls left.", concerns: [{ label: "the Gauls of Tylis", level: "high" }, { label: "Macedon", level: "medium" }], intentions: ["bring the neighbouring Thracian peoples back under the Odrysian king"], riskTolerance: 50 },
];

/**
 * Leanings of the age away from Rome: pressures the narrator offers only while
 * the world still looks as it did, and which the world AI reads as a pull on
 * the two powers named (`statecraft.ts`). Dates follow the period -- the
 * Chremonidean war began in 268 or 267, the second war for Coele-Syria in 260,
 * Alexander of Epirus invaded Macedon about 264 -- but a pressure is a lean,
 * not an appointment: it holds only while both powers stand and are at peace,
 * and the world AI weighs it against strength and risk like any other reason.
 */
const PRESSURES: readonly ScenarioHistoricalPressure[] = [
  {
    id: "the-chremonidean-rising",
    label: "Athens and Sparta mean to throw off Macedon, with Egypt behind them",
    kind: "world_event", severity: "grave", weight: 18, secret: false, oneShot: false,
    when: { politiesExist: ["athens", "sparta", "macedon"], polityHolds: [], atWar: [], atPeace: [{ polityId: "athens", otherPolityId: "macedon" }], notBeforeDay: 540, notAfterDay: 2_200, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "athens", provinceId: null, otherPolityId: "macedon" },
    brief: "Athens has had enough of the Macedonian garrison. Chremonides and his friends have bound Athens and Sparta together, and Ptolemy has promised ships and money. Decide how it comes to the point -- a decree, an embassy to Sparta, a garrison refused its pay -- and open the war with \"agreement_open\" of kind \"war\" between Athens and Macedon. An alliance between Athens and Sparta may be opened beside it. Record the rising as a public fact naming the powers.",
  },
  {
    id: "coele-syria-again",
    label: "Antiochus wants Coele-Syria back",
    kind: "world_event", severity: "grave", weight: 14, secret: false, oneShot: false,
    when: { politiesExist: ["seleucid-empire", "ptolemaic-egypt"], polityHolds: [], atWar: [], atPeace: [{ polityId: "seleucid-empire", otherPolityId: "ptolemaic-egypt" }], notBeforeDay: 2_900, notAfterDay: 6_000, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "seleucid-empire", provinceId: null, otherPolityId: "ptolemaic-egypt" },
    brief: "The Seleucid court has never accepted that Coele-Syria is Egypt's. Decide what brings it to the point -- a frontier fort, a dynastic insult, a city that changes sides -- and whether it is Antioch that strikes or Alexandria that strikes first. Open it with \"agreement_open\" of kind \"war\" and record the breaking of the peace of 271 as a public fact naming both powers.",
  },
  {
    id: "alexander-of-epirus-marches",
    label: "Pyrrhus's son wants Macedon",
    kind: "world_event", severity: "serious", weight: 10, secret: false, oneShot: false,
    when: { politiesExist: ["epirus", "macedon"], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 1_800, notAfterDay: 3_300, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "epirus", provinceId: null, otherPolityId: "macedon" },
    brief: "Alexander of Epirus has his father's ambition and fewer of his father's men. Decide whether he waits for Antigonus to be busy in Greece, and what he takes first. If he moves, open it with \"agreement_open\" of kind \"war\" between Epirus and Macedon and record it as a public fact.",
  },
  {
    id: "the-galatians-ride",
    label: "The Galatians ride against the cities of Asia",
    kind: "world_event", severity: "serious", weight: 10, secret: false, oneShot: false,
    when: { politiesExist: ["galatians-tolistobogii", "seleucid-empire"], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 120, notAfterDay: null, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "galatians-tolistobogii", provinceId: null, otherPolityId: "seleucid-empire" },
    brief: "The Galatians of Asia live on what the cities pay them to go away. Decide which cities they ride against this season, who pays and who is burned, and whether Antioch answers. Record it as a public fact naming the Galatians and the cities' master; where it comes to war, open it with \"agreement_open\" of kind \"war\".",
  },
  {
    id: "magas-marches",
    label: "Magas of Cyrene marches on Egypt again",
    kind: "world_event", severity: "serious", weight: 8, secret: false, oneShot: false,
    when: { politiesExist: ["cyrene", "ptolemaic-egypt"], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 365, notAfterDay: 7_300, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "cyrene", provinceId: null, otherPolityId: "ptolemaic-egypt" },
    brief: "Magas of Cyrene called himself king and marched on Egypt once, and turned back only because the Libyans rose behind him. Decide whether Egypt being busy elsewhere tempts him again, or whether Alexandria moves first against Cyrene. Where it comes to war, open it with \"agreement_open\" of kind \"war\" and record it as a public fact naming both.",
  },
];

/** The age's pressures away from Italy, for the scenario definition. */
export const WORLD_PRESSURES: readonly ScenarioHistoricalPressure[] = PRESSURES;

/**
 * The opening world with the wider world's politics in it: stances, peaces,
 * claims and aims, for powers that exist on the map. A power the map does not
 * carry is skipped rather than invented.
 */
export function withWorldPolitics(world: WorldState): WorldState {
  const exists = new Set(world.map.polities.map((polity) => polity.id));
  const both = (a: string, b: string): boolean => exists.has(a) && exists.has(b);

  const stanceKey = (stance: Pick<PolityStance, "polityId" | "towardPolityId">): string => `${stance.polityId}>${stance.towardPolityId}`;
  const written = new Set(world.polityStances.map(stanceKey));
  const stances: PolityStance[] = STANCES
    .filter(([from, toward]) => both(from, toward) && !written.has(`${from}>${toward}`))
    .map(([polityId, towardPolityId, trustScore, why]) => ({ polityId, towardPolityId, trustScore, lastShiftReason: why, lastShiftAtStep: 0 }));

  const peaces: PolityAgreement[] = PEACES
    .filter(([a, b]) => both(a, b))
    .map(([polityId, otherPolityId, terms]) => ({
      id: `peace-${polityId}-${otherPolityId}`.slice(0, 120), kind: "peace", polityId, otherPolityId, terms,
      sinceStep: 0, untilStep: null, sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public",
    }));

  const owner = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  const touches = (provinceId: string, polityId: string): boolean => world.map.edges.some((edge) =>
    (edge.from === provinceId && owner.get(edge.to) === polityId) || (edge.to === provinceId && owner.get(edge.from) === polityId));
  const claims: ClaimRecord[] = CLAIMS.filter((claim) => both(claim.claimant, claim.holder)).flatMap((claim) => world.map.provinces
    .filter((province) => province.controllerPolityId === claim.holder && claim.prefixes.some((prefix) => province.id.startsWith(prefix)))
    .filter((province) => claim.bordering !== true || touches(province.id, claim.claimant))
    .map((province) => ({
      id: `claim-${claim.claimant}-${province.id}`.slice(0, 120), locationKind: "province" as const, locationId: province.id,
      claimantPolityId: claim.claimant, claimKind: claim.kind, strengthBps: claim.strengthBps, rationale: claim.why,
      startedAtStep: 0, endedAtStep: null, status: "active" as const,
    })));

  const hasOutlook = new Set(world.polityOutlooks.map((outlook) => outlook.polityId));
  const outlooks: PolityOutlook[] = OUTLOOKS
    .filter((outlook) => exists.has(outlook.polityId) && !hasOutlook.has(outlook.polityId))
    .map((outlook) => ({ ...outlook, updatedAtStep: 0, lastChangeReason: "As the year 270 found it." }));

  // Everybody whose nature nobody wrote is born with one (`characters/vices.ts`).
  const heads = new Set(world.map.polities.map((polity) => polity.headOfficeId).filter((id): id is string => typeof id === "string"));
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));
  // Offices are held by seat: the map's generated officials carry none on themselves.
  const seatOf = new Map(world.material.officeSeats.filter((seat) => seat.holderCharacterId !== null).map((seat) => [seat.holderCharacterId!, seat.officeId]));
  const characters = world.characters.map((character) => {
    const office = character.officeId ?? seatOf.get(character.id) ?? null;
    return withVices(character, stationOf({ officeId: office }, commanders.has(character.id), office !== null && (heads.has(office) || /:ruler$/.test(office))));
  });

  return {
    ...world,
    characters,
    polityStances: [...world.polityStances, ...stances],
    polityAgreements: [...world.polityAgreements, ...peaces],
    polityOutlooks: [...world.polityOutlooks, ...outlooks],
    map: { ...world.map, claimRecords: [...(world.map.claimRecords ?? []), ...claims] },
  };
}
