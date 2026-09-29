import { stableHash } from "../determinism";

/**
 * What a people called their sons (scenario v34), and the culture a power's
 * people belong to, read from its id. Used wherever a person has to be made
 * with a name: a founding ruler, a man renamed from his title, the leader of a
 * rising that restores a power nobody is left in.
 *
 * Names a man of 270 could have borne. The pools were drawn from whoever the
 * sources name, which is mostly later men: a Suebian chief of 270 BC was
 * called Chariomerus, a Cheruscan king of the first century AD, and an
 * Iberian lord Indibilis, who fought Scipio. The famous of later centuries are
 * out; what stands in for them is built from the same peoples' naming stock --
 * Gaulish and Germanic compounds, the Iberian names of the Ascoli bronze, the
 * Illyrian and Thracian names of common inscriptions, the Libyan names of the
 * Dougga dedication -- and belongs to nobody the histories remember.
 */
export type Culture = "italic" | "etruscan" | "greek" | "celtic" | "germanic" | "iberian" | "illyrian" | "thracian" | "libyan" | "anatolian";

export const POOLS: Readonly<Record<Culture, { readonly first: readonly string[]; readonly second?: readonly string[] }>> = {
  italic: {
    first: ["Statius", "Numerius", "Ovius", "Paquius", "Herius", "Minius", "Trebius", "Salvius", "Pacius", "Marius", "Vibius", "Novius", "Seppius"],
    second: ["Egnatius", "Papius", "Pontius", "Staius", "Decitius", "Obellius", "Calavius", "Magius", "Vettius", "Herennius", "Lucilius", "Ninnius", "Aufidius"],
  },
  etruscan: {
    first: ["Larth", "Arnth", "Vel", "Aule", "Sethre", "Laris", "Avle", "Marce", "Tite"],
    second: ["Spurinna", "Tarchna", "Vipinas", "Ceicna", "Velimna", "Hulchnie", "Matuna", "Pumpu", "Alethna", "Partunu"],
  },
  greek: {
    first: ["Menippus", "Cleonymus", "Eudamidas", "Aristomachus", "Nicostratus", "Polycrates", "Demetrius", "Hegesander", "Callicrates", "Theodotus", "Archidamus", "Pantaleon", "Agelaus", "Epicydes", "Menecrates", "Cleomenes", "Lysippus", "Philoxenus", "Phylarchus", "Eurycleides", "Micion", "Thrasybulus", "Glaucon", "Hippias", "Leontiades", "Timolaus", "Aristippus", "Nicias", "Euphron", "Deinocrates", "Xenares", "Charixenus", "Hermocrates", "Philinus", "Sosibius", "Pythodorus", "Andronicus", "Aristodemus", "Damocritus", "Eumenes", "Callias", "Stratocles", "Nicander", "Diocles", "Xenophantus"],
  },
  celtic: {
    first: ["Brennos", "Ambigatos", "Britomaros", "Segovesos", "Bellovesos", "Comontorios", "Acichorios", "Bolgios", "Leonnorios", "Lutarios", "Atepomaros", "Ategnatos", "Excingos", "Toutobodos", "Dannotalos", "Carantomagos", "Esumagios", "Senobogios", "Vindomaros", "Cobromaros", "Ollognatos", "Andobrogios", "Camulognatos", "Epomeduos", "Nertomaros", "Dagovassos", "Litumaros", "Suadurix", "Cintugnatos", "Biturix", "Eposognatos", "Tancorix", "Uxellimos", "Catumandos", "Ressimaros", "Nemetogenos", "Iccavos", "Dubnocoveros", "Veniximaros", "Ammacos", "Boduos", "Cattos", "Matugenos", "Rextugenos", "Cassimaros", "Andecamulos", "Ollodagos", "Ivomagos", "Divicatos", "Senognatos"],
  },
  germanic: {
    first: ["Harimer", "Gaisomer", "Ansuwald", "Segibrand", "Wandil", "Audagast", "Hrodawulf", "Leudomer", "Aginwald", "Swanagast", "Walhamund", "Fraujamer", "Berhtogar", "Hlewamund", "Ingwamer", "Raginamer", "Hathuwald", "Sigiwulf", "Austrogast", "Wakramund", "Thiudagast", "Ermunamer", "Ansugisl", "Wiligast", "Haduberht"],
  },
  iberian: {
    first: ["Istolatios", "Indortes", "Umargibas", "Bastugitas", "Sosinaden", "Balciadin", "Turtumelis", "Ordumeles", "Agirnes", "Luspanar", "Sanibelser", "Illurtibas", "Estopeles", "Tautindals", "Bennabels", "Atullo", "Arranes", "Umarbeles", "Nalbeaden", "Adimels", "Sosimilus", "Urgidar"],
  },
  illyrian: {
    first: ["Pleuratus", "Monunius", "Mytilus", "Bardylis", "Glaucias", "Clitus", "Grabos", "Sirras", "Dazos", "Epicadus", "Plator", "Verzo", "Tritus", "Temus", "Scerdis"],
  },
  thracian: {
    first: ["Seuthes", "Cotys", "Rhesos", "Dromichaetes", "Cersobleptes", "Teres", "Sitalces", "Amadocus", "Hebryzelmis", "Cothelas", "Medocus", "Sparadokos", "Bithys", "Dizzalas", "Tarsas", "Zeipas", "Moskon", "Bendidoros"],
  },
  libyan: {
    first: ["Zelalsan", "Aelymas", "Iarbas", "Ateban", "Iepmatath", "Palu", "Ilaten", "Zamar"],
  },
  // Iranian and native names of the Persian satrapies of Asia Minor and Armenia, which their dynasts still bore. It stands, until each
  // has a pool of its own, for the peoples east and south of Anatolia too -- Iranian, Caucasian, Arabian, Nubian and Judaean: the
  // closest stock there is, and not their own.
  anatolian: {
    first: ["Ariarathes", "Orophernes", "Datames", "Pharnaces", "Artabazus", "Mithrobuzanes", "Ariobarzanes", "Orontes", "Zariadres", "Artavasdes", "Pylaemenes", "Corylas", "Oltaces", "Kretines", "Kendebas", "Moagetes"],
  },
};

const ETRUSCAN = new Set(["etruscan-cities"]);
const ITALIC = new Set(["umbrians", "picentes", "marsi-paeligni", "samnites", "lucanians", "bruttians", "apulian-cities", "messapians", "veneti"]);
const GREEK = new Set([
  "acarnania", "achaean-league", "aeolis-communities", "aetolian-league", "arcadian-league", "argos", "athens", "boeotian-league", "cretan-cities-east",
  "cretan-cities-west", "cycladic-islanders", "cyrene", "elis", "epirus", "ionia-communities", "ionian-islands", "macedon", "massalia", "megalopolis",
  "messenia", "phocian-league", "rhodes", "sparta",
  // Asia Minor's Greek cities and the Macedonian kingdoms that ruled the rest by Greek officials.
  "bithynia", "euxine-greek-cities", "heraclea-pontica", "hellespont-propontic-cities", "pergamon", "ptolemaic-egypt", "seleucid-empire",
]);
const ANATOLIAN = new Set([
  "armenia", "cappadocia", "colchis", "paphlagonia", "pisidia-isauria", "pontus",
  "atropatene", "caspian-peoples", "caucasian-albania", "caucasian-iberia", "makran-tribes",
  "gerrha", "hejaz-tribes", "ituraeans", "judea", "kush", "lihyan", "marsh-peoples", "minaeans", "nabataeans", "najd-tribes", "qedar", "saba", "scenitae-arabs",
]);
const LIBYAN = new Set(["gaetuli", "garamantes", "mauretanian-peoples", "numidian-kingdoms", "canarian-peoples"]);

export function cultureOf(polityId: string): Culture {
  if (ETRUSCAN.has(polityId)) return "etruscan";
  if (ITALIC.has(polityId)) return "italic";
  if (GREEK.has(polityId)) return "greek";
  if (LIBYAN.has(polityId)) return "libyan";
  if (ANATOLIAN.has(polityId)) return "anatolian";
  if (/^(germania-|low-countries-)/.test(polityId)) return "germanic";
  if (/^(iberia-|lusitanians|balearic)/.test(polityId)) return "iberian";
  if (/^(illyria-|pannonii)/.test(polityId)) return "illyrian";
  if (/^(thrace-|thracian-|carpathian-)/.test(polityId)) return "thracian";
  return "celtic";
}


/** A man's name as his people would give it, stable for the same power and role, and not one of `used`. */
export function aNameFor(polityId: string, role: string, used: ReadonlySet<string>): string {
  const pool = POOLS[cultureOf(polityId)];
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const first = pool.first[stableHash([polityId, role, "first", attempt]) % pool.first.length]!;
    const name = pool.second === undefined ? first : `${first} ${pool.second[stableHash([polityId, role, "second", attempt]) % pool.second.length]!}`;
    if (!used.has(name)) return name;
  }
  return `${pool.first[0]!} of the ${polityId}`;
}

