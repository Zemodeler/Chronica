import {
  dignitasOfGens,
  gensIdOfNomen,
  masculineNomen,
  ordoOfRomanName,
  parseRomanName,
  personFor,
  pluralOfNomen,
  princepsOf,
  stableHash,
  stirpsOf,
  type Character,
  type CurulHonour,
  type Feud,
  type Gens,
} from "@chronica/shared";
import { CENSORS_300_TO_265, CONSULS_366_TO_270 } from "./punic-wars-fasti";
import { PUNIC_IDS } from "./punic-ids";

/**
 * The noble families of 270 BCE (scenario v56; docs/plans/gentes.md has the sources and the confidence).
 *
 * Every Roman in the world is of a gens; every gens that has had a consul has a record, whether any of
 * its men are alive or not (a man's nobilitas is counted from the dead). Carthage's great houses and the
 * kings' houses are the same record. The living members the scenario did not have are added, each marked
 * in his `creationReason` as historical or invented, and with the confidence the plan gives.
 */

type P = Record<string, unknown> & { id: string; name: string; polityId: string | null; cultureId: string; faithId: string | null; locationProvinceId: string; gender?: "male" | "female"; ageYearsAtStart: number; prestigeBps: number; dynastyId: string | null };

type Conf = "H" | "M" | "L";

interface Branch { readonly cognomen: string; readonly aka?: readonly string[]; readonly ordo?: "patrician" | "plebeian" }

/** The branches of the gentes whose branches matter; every other gens gets its branches from the cognomina of its consuls. */
const BRANCHES: Readonly<Record<string, readonly Branch[]>> = {
  Cornelius: [{ cognomen: "Scipio", aka: ["Barbatus", "Asina", "Calvus"] }, { cognomen: "Lentulus", aka: ["Caudinus"] }, { cognomen: "Arvina", aka: ["Cossus"] }, { cognomen: "Rufinus" }, { cognomen: "Blasio" }, { cognomen: "Merenda" }, { cognomen: "Dolabella" }, { cognomen: "Scapula" }],
  Fabius: [{ cognomen: "Maximus", aka: ["Rullianus", "Gurges", "Verrucosus"] }, { cognomen: "Pictor" }, { cognomen: "Ambustus", aka: ["Dorsuo"] }, { cognomen: "Licinus", aka: ["Buteo"] }],
  Valerius: [{ cognomen: "Maximus", aka: ["Corvus", "Corvinus", "Messalla", "Potitus"] }, { cognomen: "Laevinus" }, { cognomen: "Flaccus" }, { cognomen: "Poplicola" }],
  Claudius: [{ cognomen: "Caecus", aka: ["Russus", "Caudex", "Pulcher", "Crassus"] }, { cognomen: "Canina" }, { cognomen: "Marcellus", ordo: "plebeian" }],
  Aemilius: [{ cognomen: "Mamercinus", aka: ["Privernas"] }, { cognomen: "Barbula" }, { cognomen: "Papus" }, { cognomen: "Lepidus" }, { cognomen: "Paullus" }],
  Manlius: [{ cognomen: "Torquatus", aka: ["Imperiosus", "Atticus"] }, { cognomen: "Capitolinus" }, { cognomen: "Vulso" }],
  Postumius: [{ cognomen: "Albinus", aka: ["Caudinus"] }, { cognomen: "Megellus" }],
  Papirius: [{ cognomen: "Cursor", aka: ["Praetextatus"] }, { cognomen: "Crassus" }],
  Sulpicius: [{ cognomen: "Peticus" }, { cognomen: "Longus" }, { cognomen: "Saverrio", aka: ["Saverrius"] }, { cognomen: "Camerinus", aka: ["Rufus"] }, { cognomen: "Paterculus" }],
  Quinctius: [{ cognomen: "Poenus", aka: ["Capitolinus", "Crispinus"] }, { cognomen: "Claudus" }],
  Servilius: [{ cognomen: "Ahala" }, { cognomen: "Tucca" }],
  Julius: [{ cognomen: "Libo" }, { cognomen: "Iulus" }],
  Caecilius: [{ cognomen: "Metellus", aka: ["Denter"] }],
  Genucius: [{ cognomen: "Clepsina" }, { cognomen: "Aventinensis" }],
  Decius: [{ cognomen: "Mus" }],
  Fulvius: [{ cognomen: "Flaccus" }, { cognomen: "Paetinus", aka: ["Curvus"] }, { cognomen: "Centumalus" }],
  Atilius: [{ cognomen: "Regulus", aka: ["Calenus"] }, { cognomen: "Caiatinus", aka: ["Calatinus"] }],
  Sempronius: [{ cognomen: "Sophus" }, { cognomen: "Blaesus" }],
  Marcius: [{ cognomen: "Rutilus", aka: ["Censorinus"] }, { cognomen: "Philippus" }, { cognomen: "Tremulus" }],
  Junius: [{ cognomen: "Brutus", aka: ["Bubulcus", "Scaeva"] }, { cognomen: "Pera" }],
  Licinius: [{ cognomen: "Calvus" }, { cognomen: "Stolo" }],
};

/** What each gens keeps: its rites, and a tomb where the sources name one. */
const SACRA: Readonly<Record<string, { readonly sacra: readonly string[]; readonly tomb?: string; readonly why: string }>> = {
  Fabius: { sacra: ["the sacra gentilicia of the Fabii on the Quirinal"], why: "Livy 5.46: Fabius Dorsuo carried the gens's rites through the Gauls in 390" },
  Julius: { sacra: ["the rites of Vediovis at Bovillae"], why: "the Julian rites at Bovillae (Tacitus, Annals 2.41)" },
  Nautius: { sacra: ["the keeping of Minerva's rites"], why: "Servius on Aeneid 2.166; Dionysius of Halicarnassus 6.69" },
  Aurelius: { sacra: ["the rites of the Sun"], why: "Festus s.v. Aureliam" },
  Cornelius: { sacra: [], tomb: "the tomb of the Scipiones on the Via Appia", why: "the sarcophagus of Lucius Cornelius Scipio Barbatus (CIL I 6-7)" },
  Valerius: { sacra: ["the sacra of the Valerii on the Velia"], why: "Plutarch, Publicola 23: the Valerii's house on the Velia" },
};

/** Grudges the sources attest, as [gens of the aggrieved, gens aggrieved against, years ago it began, heat, why]. */
const FEUDS: readonly (readonly [string, string, number, number, string])[] = [
  ["Fabius", "Claudius", 34, 2_200, "Fabius Rullianus undid Appius Claudius Caecus's enrolment of the freedmen's sons in the tribes, in the censorship of 304"],
  ["Fabricius", "Cornelius", 5, 2_600, "Fabricius, as censor in 275, struck Publius Cornelius Rufinus off the Senate's roll for owning ten pounds of silver plate (Gellius 4.8)"],
  ["Cornelius", "Fabricius", 5, 3_200, "Rufinus has not forgiven Fabricius his censorship of 275"],
];

interface Seed {
  readonly name: string;
  readonly age: number;
  readonly gender?: "male" | "female";
  readonly prestige: number;
  readonly focus: "martial" | "piety" | "stewardship" | "diplomacy" | "learning" | "intrigue";
  /** Offices he has held by 270 (the rungs), so the elections know what he has been. */
  readonly held?: readonly string[];
  readonly conf: Conf;
  readonly why: string;
  readonly traits?: readonly string[];
}

const CONSULAR = ["roman-quaestor", "roman-praetor", "roman-consul"];

/** The living members of the gentes the scenario did not have: historical where the sources name them, marked where they do not. */
const NEW_ROMANS: readonly Seed[] = [
  // The Cornelii: Rufinus, Lentulus, Merenda and Dolabella are consuls of 290-274; the Scipiones of the next generation are young men.
  { name: "Publius Cornelius Rufinus", age: 66, prestige: 6_300, focus: "martial", held: CONSULAR, conf: "M", why: "consul in 290 and 277, dictator c. 285; struck from the Senate's roll in 275", traits: ["ambitious"] },
  { name: "Lucius Cornelius Lentulus Caudinus", age: 55, prestige: 6_800, focus: "martial", held: CONSULAR, conf: "M", why: "consul in 275, triumphed over the Samnites" },
  { name: "Servius Cornelius Merenda", age: 50, prestige: 6_200, focus: "diplomacy", held: CONSULAR, conf: "M", why: "consul in 274" },
  { name: "Publius Cornelius Dolabella", age: 60, prestige: 6_100, focus: "martial", held: CONSULAR, conf: "M", why: "consul in 283, beat the Senones and the Boii" },
  { name: "Lucius Cornelius Scipio Barbatus", age: 67, prestige: 7_800, focus: "martial", held: [...CONSULAR, "roman-censor"], conf: "M", why: "consul in 298 and censor in 280, the man of the sarcophagus; no word of his death survives, and the sarcophagus is of a later date", traits: ["dutiful"] },
  { name: "Lucius Cornelius Scipio", age: 38, prestige: 5_400, focus: "martial", conf: "M", why: "consul in 259, censor in 258; the son of Barbatus by the sources' general reading; his age is inferred" },
  { name: "Gnaeus Cornelius Scipio Asina", age: 33, prestige: 5_100, focus: "martial", conf: "L", why: "consul in 260 and 254, taken at Lipara; his father is taken to be Barbatus, which is a reading and not a certainty" },
  { name: "Fabia", age: 30, gender: "female", prestige: 2_200, focus: "diplomacy", conf: "L", why: "the wife of Lucius Cornelius Scipio, of the Fabii by the alliance this record is made to show; the sources do not name her" },
  // The Fabii.
  { name: "Gaius Fabius Licinus", age: 50, prestige: 6_500, focus: "martial", held: CONSULAR, conf: "M", why: "consul in 273, one of the three sent to Ptolemy II's court in 273" },
  { name: "Aemilia", age: 38, gender: "female", prestige: 3_200, focus: "diplomacy", conf: "L", why: "the wife of Quintus Fabius Maximus Gurges, and mother of the boy Quintus; the sources do not name her" },
  { name: "Quintus Fabius Maximus Verrucosus", age: 10, prestige: 2_600, focus: "learning", conf: "M", why: "the future dictator Cunctator, born c. 280 (Plutarch, Fabius 1), a son of Gurges by the usual reading" },
  // The other patrician gentes.
  { name: "Lucius Valerius Flaccus", age: 35, prestige: 5_000, focus: "martial", conf: "M", why: "consul in 261; a young man in 270, his age inferred" },
  { name: "Appius Claudius Caudex", age: 35, prestige: 5_300, focus: "martial", conf: "L", why: "consul in 264, who put the army across to Messana; taken as a brother of Russus, as some read him" },
  { name: "Publius Claudius Pulcher", age: 20, prestige: 3_200, focus: "diplomacy", conf: "L", why: "consul in 249, who lost the fleet at Drepana; a boy of twenty in 270, a son of Caecus by the common reading" },
  { name: "Marcus Aemilius Lepidus", age: 55, prestige: 6_300, focus: "diplomacy", held: CONSULAR, conf: "M", why: "consul in 285" },
  { name: "Lucius Manlius Vulso Longus", age: 35, prestige: 5_200, focus: "martial", conf: "M", why: "consul in 256 and 250; his age inferred" },
  { name: "Titus Manlius Torquatus", age: 25, prestige: 3_900, focus: "martial", conf: "L", why: "consul in 235 and 224, censor in 231; a boy in 270, his age a guess" },
  { name: "Aulus Manlius Torquatus Atticus", age: 28, prestige: 4_000, focus: "learning", conf: "L", why: "consul in 244 and 241, censor in 247; his age a guess" },
  { name: "Publius Sulpicius Saverrio", age: 68, prestige: 7_000, focus: "martial", held: [...CONSULAR, "roman-censor"], conf: "M", why: "consul in 304 and 279 (the battle of Asculum), censor in 300" },
  { name: "Gaius Sulpicius Paterculus", age: 30, prestige: 4_800, focus: "martial", conf: "M", why: "consul in 258; his age inferred" },
  { name: "Gaius Quinctius Claudus", age: 50, prestige: 6_200, focus: "martial", held: CONSULAR, conf: "M", why: "consul in 271, who won the last war with the Samnites' allies at Tarentum's gates" },
  { name: "Gaius Servilius Tucca", age: 55, prestige: 6_100, focus: "martial", held: CONSULAR, conf: "M", why: "consul in 284" },
  { name: "Gaius Nautius Rutilus", age: 62, prestige: 6_000, focus: "martial", held: CONSULAR, conf: "M", why: "consul in 287" },
  { name: "Lucius Papirius Praetextatus", age: 60, prestige: 6_800, focus: "learning", held: [...CONSULAR, "roman-censor"], conf: "M", why: "censor in 272 with Curius" },
  // The plebeian nobiles.
  { name: "Lucius Caecilius Metellus", age: 20, prestige: 3_800, focus: "martial", conf: "M", why: "consul in 251 and 247, who beat the Carthaginians at Panormus; his father Denter fell at Arretium as consul in 284 (hence the gens's first consul)" },
  { name: "Gnaeus Domitius Calvinus Maximus", age: 55, prestige: 6_400, focus: "martial", held: [...CONSULAR, "roman-censor"], conf: "M", why: "consul in 283, censor in 280" },
  { name: "Gaius Aelius Paetus", age: 60, prestige: 6_000, focus: "learning", held: CONSULAR, conf: "M", why: "consul in 286" },
  { name: "Quintus Caedicius Noctua", age: 65, prestige: 6_100, focus: "martial", held: [...CONSULAR, "roman-censor"], conf: "L", why: "consul in 289, censor in 283; taken as the father of the tribune Quintus Caedicius, which is a guess" },
  { name: "Gaius Atilius Regulus", age: 33, prestige: 4_500, focus: "martial", conf: "L", why: "consul in 257 and 250; taken as a kinsman of Marcus Atilius Regulus, brother or cousin" },
  { name: "Quintus Mamilius Vitulus", age: 33, prestige: 4_400, focus: "diplomacy", conf: "M", why: "consul in 262, taken as the brother of Lucius Mamilius Vitulus" },
  { name: "Gaius Aquillius Florus", age: 30, prestige: 4_300, focus: "martial", conf: "M", why: "consul in 259; his age inferred" },
  { name: "Gaius Junius Bubulcus Brutus", age: 55, prestige: 6_000, focus: "martial", held: CONSULAR, conf: "L", why: "consul in 291 and 277 (the fasti's two or three men of the name are read here as one), who fought the Samnites" },
];

/** [parent or husband or elder brother, kind, child or wife or younger brother]. Names are exact. */
const LINKS: readonly (readonly [string, "parent" | "spouse_or_partner" | "sibling" | "other_relative", string])[] = [
  ["Lucius Cornelius Scipio Barbatus", "parent", "Lucius Cornelius Scipio"],
  ["Lucius Cornelius Scipio Barbatus", "parent", "Gnaeus Cornelius Scipio Asina"],
  ["Lucius Cornelius Scipio", "spouse_or_partner", "Fabia"],
  ["Gaius Fabius Licinus", "parent", "Fabia"],
  ["Quintus Fabius Maximus Gurges", "spouse_or_partner", "Aemilia"],
  ["Quintus Fabius Maximus Gurges", "parent", "Quintus Fabius Maximus Verrucosus"],
  ["Aemilia", "parent", "Quintus Fabius Maximus Verrucosus"],
  ["Appius Claudius Russus", "sibling", "Appius Claudius Caudex"],
  ["Appius Claudius Russus", "sibling", "Publius Claudius Pulcher"],
  ["Lucius Mamilius Vitulus", "sibling", "Quintus Mamilius Vitulus"],
  ["Marcus Atilius Regulus", "other_relative", "Gaius Atilius Regulus"],
  ["Quintus Caedicius Noctua", "parent", "Quintus Caedicius"],
  ["Titus Manlius Torquatus", "other_relative", "Aulus Manlius Torquatus Atticus"],
];

/** The royal and foreign houses, by [house id, nomen, plural, kind, polity, members' exact names]. */
const HOUSES_ABROAD: readonly { id: string; nomen: string; plural: string; kind: "noble" | "royal"; polityId: string; note: string; members: readonly string[]; sacra?: readonly string[] }[] = [
  { id: "gens-barca", nomen: "Barca", plural: "the Barcids", kind: "noble", polityId: "carthage", note: "The Barcids: the name is 'lightning'; Hamilcar Barca was born c. 275 and the sources do not name his father (this head is invented).", members: ["Hannibal the Barcid", "Imilce", "Hamilcar Barca", "Arisha Barcid"] },
  { id: "gens-hanno", nomen: "Hanno", plural: "the Hannonids", kind: "noble", polityId: "carthage", note: "The landed party's house, after Hanno the Great; a reconstruction.", members: ["Hanno of Carthage", "Arishat", "Batbaal", "Bomilcar son of Hanno"] },
  { id: "gens-gisgo", nomen: "Gisgo", plural: "the Gisgonids", kind: "noble", polityId: "carthage", note: "The house of Gisco; Hannibal son of Gisco commanded at Agrigentum in 262.", members: ["Hannibal Gisco", "Elishat", "Sophonba", "Himilco son of Gisgo", "Bomilcar son of Gisco"] },
  { id: "gens-mago", nomen: "Mago", plural: "the Magonids", kind: "noble", polityId: "carthage", note: "The old ruling line (c. 550 to 340), ended by a failed coup; what is left of it in 270 is a reconstruction.", members: ["Mago the Elder"] },
  { id: "gens-hieronid", nomen: "Hieron", plural: "the Hieronids", kind: "royal", polityId: "syracuse", note: "Hiero II's house: a son of the noble Hierocles, who claimed descent from Gelon; his children are born after 270.", members: ["Hieron II", "Philistis"] },
  { id: "gens-leptines", nomen: "Leptines", plural: "the house of Leptines", kind: "noble", polityId: "syracuse", note: "Hiero's father-in-law, the best house of Syracuse (Polybius 1.9).", members: ["Leptines of Syracuse"] },
  { id: "gens-lagid", nomen: "Lagus", plural: "the Ptolemies", kind: "royal", polityId: "ptolemaic-egypt", note: "The house of Ptolemy son of Lagus.", members: ["Ptolemy II Philadelphus", "Arsinoe II", "Ptolemy son of Ptolemy", "Magas of Cyrene"] },
  { id: "gens-antigonid", nomen: "Antigonus", plural: "the Antigonids", kind: "royal", polityId: "macedon", note: "The house of Antigonus the One-Eyed, restored in Macedon by Gonatas.", members: ["Antigonus Gonatas", "Phila", "Demetrius son of Antigonus"] },
  { id: "gens-seleucid", nomen: "Seleucus", plural: "the Seleucids", kind: "royal", polityId: "seleucid-empire", note: "The house of Seleucus Nicator; his co-regent son Seleucus (executed c. 267) is not seeded.", members: ["Antiochus I Soter", "Stratonice", "Antiochus son of Antiochus"] },
];

/** The kings' kin the sources name: [name, age, the king whose house, kind, heir?, conf, why]. */
const ROYAL_KIN: readonly { name: string; age: number; gender: "male" | "female"; king: string; is: "wife" | "son"; heir?: true; conf: Conf; why: string }[] = [
  { name: "Arsinoe II", age: 46, gender: "female", king: "Ptolemy II Philadelphus", is: "wife", conf: "M", why: "Ptolemy II's sister and wife, married c. 276 to 273; she died in 270 or 268, the sources dispute which" },
  { name: "Ptolemy son of Ptolemy", age: 14, gender: "male", king: "Ptolemy II Philadelphus", is: "son", heir: true, conf: "M", why: "the future Ptolemy III, born c. 284, a son of Ptolemy II by Arsinoe I" },
  { name: "Phila", age: 26, gender: "female", king: "Antigonus Gonatas", is: "wife", conf: "M", why: "daughter of Seleucus I, married to Antigonus c. 276" },
  { name: "Demetrius son of Antigonus", age: 5, gender: "male", king: "Antigonus Gonatas", is: "son", heir: true, conf: "M", why: "the future Demetrius II, born c. 275" },
  { name: "Stratonice", age: 30, gender: "female", king: "Antiochus I Soter", is: "wife", conf: "M", why: "daughter of Demetrius Poliorcetes, married to Antiochus I" },
  { name: "Antiochus son of Antiochus", age: 17, gender: "male", king: "Antiochus I Soter", is: "son", conf: "M", why: "the future Antiochus II, born c. 287; the elder co-regent Seleucus is not seeded" },
];

/** Names whose fasti entries in an earlier year (a larger number of years BCE) are another man's -- a father's, a grandfather's -- and not the character's of the same name. */
const OWN_UNTIL_YEAR_BCE: Readonly<Record<string, number>> = {
  "Lucius Papirius Cursor": 272,
  "Publius Decius Mus": 279,
  // The man of the same name in the fasti is an ancestor, and the character is a younger man who has held none of them.
  "Lucius Cornelius Scipio": 0,
  "Titus Manlius Torquatus": 0,
  "Marcus Livius Denter": 0,
  "Gaius Marcius Rutilus": 0,
  "Publius Sempronius Sophus": 0,
  "Marcus Atilius Regulus": 0,
  "Gaius Junius Bubulcus Brutus": 291,
};

const yearsToStep = (yearBce: number): number => -(yearBce - 270) * 365;

const nomenOf = (name: string): string | null => parseRomanName(name).nomen;

/** The gens id of a person's name, or null. */
function gensKeyOf(name: string): string | null {
  const nomen = nomenOf(name);
  return nomen === null ? null : gensIdOfNomen(nomen);
}

export interface GentesSeeded {
  /** Every character: the ones given, patched with a gens and the parts of a Roman name, and the new ones. */
  readonly characters: readonly Record<string, unknown>[];
  readonly accounts: readonly Record<string, unknown>[];
  readonly familyLinks: readonly Record<string, unknown>[];
  readonly gentes: readonly Gens[];
}

/**
 * Seat the gentes into the opening world: patch every character with his gens, add the missing living members and their ties,
 * write each gens from the fasti and the tables above. Throws on a name the tables name and the world has not (a mistake in this file).
 */
export function seatGentes(people: readonly Record<string, unknown>[], links: readonly Record<string, unknown>[]): GentesSeeded {
  const existing = people as unknown as readonly P[];
  const byName = new Map(existing.map((person) => [person.name, person]));
  const rome = existing.find((person) => person.id === "gnaeus-cornelius")!;

  // ── The new people ──────────────────────────────────────────────────────
  const newCharacters: Record<string, unknown>[] = [];
  const newAccounts: Record<string, unknown>[] = [];
  const newLinks: Record<string, unknown>[] = [];
  const made = new Map<string, P>();
  for (const seed of NEW_ROMANS) {
    if (byName.has(seed.name)) throw new Error(`The gentes seed adds somebody the world already has: ${seed.name}`);
    const id = `rome-gens-${stableHash(["gens", seed.name]).toString(36).slice(0, 6)}`;
    const { character, account } = personFor({
      id, name: seed.name, polityId: "rome", cultureId: "roman", faithId: "faith-roman", provinceId: PUNIC_IDS.rome, age: seed.age,
      ...(seed.gender === undefined ? {} : { gender: seed.gender }), prestigeBps: seed.prestige, focus: seed.focus, traits: seed.traits ?? [], officeId: null,
      balance: seed.age < 14 ? 0 : seed.held === undefined ? 3_000 : 6_000, officesHeld: seed.held ?? [],
    }, 0);
    const reason = seed.conf === "L" ? `Invented or doubtful (${seed.conf}): ${seed.why}.` : `Historical (${seed.conf}): ${seed.why}.`;
    newCharacters.push({ ...character, creationReason: reason.slice(0, 320) });
    newAccounts.push(account);
    made.set(seed.name, character as unknown as P);
  }
  for (const kin of ROYAL_KIN) {
    const king = byName.get(kin.king);
    if (king === undefined) throw new Error(`The gentes seed names a king the world does not have: ${kin.king}`);
    const id = `${king.polityId}-gens-${stableHash(["gens", kin.name]).toString(36).slice(0, 6)}`;
    const { character, account } = personFor({
      id, name: kin.name, polityId: king.polityId ?? "", cultureId: king.cultureId, faithId: king.faithId, provinceId: king.locationProvinceId, age: kin.age, gender: kin.gender,
      prestigeBps: Math.round(king.prestigeBps * (kin.is === "wife" ? 0.45 : 0.35)), focus: "diplomacy", officeId: null, balance: kin.age < 14 ? 0 : 6_000,
    }, 0);
    newCharacters.push({ ...character, creationReason: `Historical (${kin.conf}): ${kin.why}.`.slice(0, 320) });
    newAccounts.push(account);
    made.set(kin.name, character as unknown as P);
  }
  const lookup = (name: string): P => {
    const found = made.get(name) ?? byName.get(name);
    if (found === undefined) throw new Error(`The gentes seed names somebody the world does not have: ${name}`);
    return found;
  };
  const link = (characterId: string, relatedCharacterId: string, kind: string): void => {
    newLinks.push({ id: `family-${stableHash([characterId, relatedCharacterId, kind, "gens"]).toString(36)}`, characterId, relatedCharacterId, kind, startedAtStep: 0, endedAtStep: null, visibility: "public", provenanceEventId: null });
  };
  for (const [from, kind, to] of LINKS) link(lookup(from).id, lookup(to).id, kind);
  for (const kin of ROYAL_KIN) {
    const king = lookup(kin.king);
    const person = lookup(kin.name);
    link(king.id, person.id, kin.is === "wife" ? "spouse_or_partner" : "parent");
  }

  // ── Which gens each person is of ────────────────────────────────────────
  const everyone: P[] = [...existing, ...newCharacters.map((character) => character as unknown as P)];
  const abroad = new Map<string, string>();
  for (const house of HOUSES_ABROAD) for (const member of house.members) abroad.set(member, house.id);
  const gensOfPerson = (person: P): string | null => abroad.get(person.name) ?? (person.cultureId === "roman" || person.polityId === "rome" ? gensKeyOf(person.name) : null);

  // ── The gentes from the fasti and the tables ────────────────────────────
  const branchesOf = new Map<string, Branch[]>();
  const nomenById = new Map<string, string>();
  const noteNomen = (name: string): string | null => {
    const nomen = nomenOf(name);
    if (nomen === null) return null;
    const stem = masculineNomen(nomen);
    nomenById.set(gensIdOfNomen(stem), stem);
    return gensIdOfNomen(stem);
  };
  for (const person of everyone) if (person.cultureId === "roman" || person.polityId === "rome") noteNomen(person.name);
  for (const [, names] of CONSULS_366_TO_270) for (const name of names) noteNomen(name);
  for (const [, patrician, plebeian] of CENSORS_300_TO_265) for (const name of [patrician, plebeian]) if (name !== "") noteNomen(name);
  for (const [stem, branches] of Object.entries(BRANCHES)) branchesOf.set(gensIdOfNomen(stem), [...branches]);

  const honoursOf = new Map<string, CurulHonour[]>();
  const stirpsFor = (gensId: string, name: string): string | null => {
    const parts = parseRomanName(name);
    const stirpes = branchesOf.get(gensId) ?? [];
    const probe: Gens = { id: gensId, kind: "noble", nomen: "x", plural: "x", polityId: "rome", stirpes: stirpes.map((branch) => ({ cognomen: branch.cognomen, aka: [...(branch.aka ?? [])], ...(branch.ordo === undefined ? {} : { ordo: branch.ordo }) })), honours: [], imagines: 0, sacra: [], sacraKeeperId: null, tomb: null, feuds: [], alliances: [], princepsId: null, dignitasBps: 0, keptAtStep: 0 };
    const known = stirpsOf(probe, { name });
    if (known !== null) return known;
    const first = parts.cognomen?.split(" ")[0] ?? null;
    if (first === null) return null;
    if (!stirpes.some((branch) => branch.cognomen === first)) branchesOf.set(gensId, [...stirpes, { cognomen: first }]);
    return first;
  };
  const characterNamed = new Map<string, P[]>();
  for (const person of everyone) characterNamed.set(person.name, [...(characterNamed.get(person.name) ?? []), person]);
  const addHonour = (kind: CurulHonour["kind"], name: string, year: number): void => {
    const gensId = gensKeyOf(name);
    if (gensId === null) return;
    const owner = characterNamed.get(name)?.[0];
    const cutoff = OWN_UNTIL_YEAR_BCE[name];
    const own = owner !== undefined && (cutoff === undefined || year <= cutoff);
    const list = honoursOf.get(gensId) ?? [];
    list.push({ kind, who: name, characterId: own ? owner!.id : null, stirps: stirpsFor(gensId, name), atStep: yearsToStep(year) });
    honoursOf.set(gensId, list);
  };
  for (const [year, names] of CONSULS_366_TO_270) for (const name of names) addHonour("consul", name, year);
  for (const [year, patrician, plebeian] of CENSORS_300_TO_265) for (const name of [patrician, plebeian]) if (name !== "") addHonour("censor", name, year);

  // ── Patch every person ──────────────────────────────────────────────────
  const gensRecords = new Map<string, Gens>();
  const ordoOfGens = (gensId: string, name: string): "patrician" | "plebeian" => {
    const stem = nomenById.get(gensId);
    const stirps = stem === undefined ? undefined : (branchesOf.get(gensId) ?? []).find((branch) => stirpsOf({ id: gensId, kind: "noble", nomen: stem, plural: "", polityId: "rome", stirpes: [{ cognomen: branch.cognomen, aka: [...(branch.aka ?? [])] }], honours: [], imagines: 0, sacra: [], sacraKeeperId: null, tomb: null, feuds: [], alliances: [], princepsId: null, dignitasBps: 0, keptAtStep: 0 }, { name }) !== null);
    if (stirps?.ordo !== undefined) return stirps.ordo;
    return ordoOfRomanName(`Gaius ${stem ?? "x"}`);
  };
  const patched: Record<string, unknown>[] = [];
  const bearing = new Map<string, P[]>();
  for (const person of everyone) {
    const gensId = gensOfPerson(person);
    if (gensId === null) { patched.push(person); continue; }
    const parts = person.cultureId === "roman" || person.polityId === "rome" ? parseRomanName(person.name) : null;
    const next: Record<string, unknown> = {
      ...person, dynastyId: gensId,
      ...(parts === null ? {} : {
        ...(parts.nomen === null ? {} : { nomen: parts.nomen }),
        ...(parts.praenomen === null ? {} : { praenomen: parts.praenomen }),
        ...(parts.cognomen === null ? {} : { cognomen: parts.cognomen }),
        ordo: ordoOfGens(gensId, person.name),
      }),
    };
    patched.push(next);
    bearing.set(gensId, [...(bearing.get(gensId) ?? []), next as unknown as P]);
  }

  // Kings' heirs.
  for (const kin of ROYAL_KIN) {
    if (kin.heir !== true) continue;
    const king = patched.findIndex((person) => (person as P).name === kin.king);
    if (king >= 0) patched[king] = { ...patched[king]!, heirCharacterId: lookup(kin.name).id };
  }

  // ── The records ─────────────────────────────────────────────────────────
  const allIds = new Set<string>([...honoursOf.keys(), ...bearing.keys(), ...HOUSES_ABROAD.map((house) => house.id)]);
  for (const gensId of [...allIds].sort()) {
    const house = HOUSES_ABROAD.find((candidate) => candidate.id === gensId);
    const stem = nomenById.get(gensId);
    const honours = (honoursOf.get(gensId) ?? []).sort((a, b) => a.atStep - b.atStep);
    const sacra = stem === undefined ? undefined : SACRA[stem];
    const base: Gens = house !== undefined
      ? {
        id: gensId, kind: house.kind, nomen: house.nomen, plural: house.plural, polityId: house.polityId, stirpes: [], honours: [], imagines: 0, sacra: [], sacraKeeperId: null,
        tomb: null, feuds: [], alliances: [], princepsId: null, dignitasBps: 0, keptAtStep: 0, note: house.note.slice(0, 300),
      }
      : {
        id: gensId, kind: "noble", nomen: stem ?? gensId, plural: pluralOfNomen(stem ?? gensId), polityId: "rome",
        ordo: ordoOfGens(gensId, `Gaius ${stem ?? ""}`),
        stirpes: (branchesOf.get(gensId) ?? []).map((branch) => ({ cognomen: branch.cognomen, aka: [...(branch.aka ?? [])], ...(branch.ordo === undefined ? {} : { ordo: branch.ordo }) })),
        honours, imagines: 0, sacra: [...(sacra?.sacra ?? [])], sacraKeeperId: null, tomb: sacra?.tomb ?? null, feuds: [], alliances: [], princepsId: null, dignitasBps: 0, keptAtStep: 0,
        note: sacra === undefined ? "Fasti: Broughton, via the table on Wikipedia's list of Roman consuls." : `Fasti: Broughton. ${sacra.why}.`.slice(0, 300),
      };
    gensRecords.set(gensId, base);
  }

  // Feuds.
  for (const [aggrieved, against, yearsAgo, heat, why] of FEUDS) {
    const from = gensRecords.get(gensIdOfNomen(aggrieved));
    const to = gensRecords.get(gensIdOfNomen(against));
    if (from === undefined || to === undefined) throw new Error(`A feud is written for a gens the world does not have: ${aggrieved} against ${against}`);
    const feud: Feud = { againstGensId: to.id, reason: why.slice(0, 240), sinceStep: -yearsAgo * 365, renewedAtStep: -yearsAgo * 365, intensityBps: heat };
    gensRecords.set(from.id, { ...from, feuds: [...from.feuds, feud] });
  }

  // Alliances: every marriage in the world, between two gentes.
  const personById = new Map(patched.map((person) => [(person as P).id, person as unknown as P]));
  for (const row of [...links, ...newLinks]) {
    if (row.kind !== "spouse_or_partner") continue;
    const a = personById.get(row.characterId as string);
    const b = personById.get(row.relatedCharacterId as string);
    if (a === undefined || b === undefined || a.dynastyId === null || b.dynastyId === null || a.dynastyId === b.dynastyId) continue;
    const groom = a.gender === "female" ? b : a;
    const bride = a.gender === "female" ? a : b;
    const sinceStep = -((stableHash([groom.id, bride.id, "wed"]) % 9) + 3) * 365;
    for (const [self, other] of [[groom.dynastyId!, bride.dynastyId!], [bride.dynastyId!, groom.dynastyId!]] as const) {
      const gens = gensRecords.get(self);
      if (gens === undefined || gens.alliances.some((alliance) => alliance.withGensId === other)) continue;
      gensRecords.set(self, { ...gens, alliances: [...gens.alliances, { withGensId: other, sinceStep, renewedAtStep: sinceStep, strengthBps: 6_000, groomId: groom.id, brideId: bride.id }] });
    }
  }

  // Heads, imagines and dignitas, as the pass would write them.
  const result: Gens[] = [];
  for (const gens of [...gensRecords.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    // As the schema will read them: a character the scenario wrote without a sex is a man, and without a birth day is as old as he began.
    const living = (bearing.get(gens.id) ?? []).map((person) => ({ ...person, gender: person.gender ?? "male", alive: (person as { alive?: boolean }).alive ?? true, birthStep: (person as { birthStep?: number | null }).birthStep ?? null })) as unknown as Character[];
    const first = princepsOf(gens, living, 0);
    const members = new Set(gens.honours.map((honour) => honour.characterId ?? honour.who));
    const withHead: Gens = { ...gens, princepsId: first?.id ?? null, imagines: Math.min(400, members.size) };
    result.push({
      ...withHead, dignitasBps: dignitasOfGens(withHead, living),
      sacraKeeperId: withHead.sacra.length === 0 ? null : first?.id ?? null,
    });
  }
  return { characters: patched, accounts: newAccounts, familyLinks: newLinks, gentes: result };
}
