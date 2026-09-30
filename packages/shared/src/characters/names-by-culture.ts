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
export type Culture = "italic" | "etruscan" | "greek" | "celtic" | "germanic" | "iberian" | "illyrian" | "thracian" | "libyan" | "anatolian" | "iranian" | "arabian" | "sabaean" | "judaean" | "mesopotamian" | "nubian";

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
  // Native and Iranian names of the Persian satrapies of Asia Minor, which their dynasts still bore. It also stands, for want of a
  // pool of their own, for Caucasian Iberia, Albania and Colchis, whose names of 270 are hardly attested.
  anatolian: {
    first: ["Ariarathes", "Orophernes", "Datames", "Pharnaces", "Artabazus", "Mithrobuzanes", "Ariobarzanes", "Orontes", "Zariadres", "Artavasdes", "Pylaemenes", "Corylas", "Oltaces", "Kretines", "Kendebas", "Moagetes"],
  },
  // Achaemenid-Iranian stock as Greek writers spelled it: the Orontids of Armenia and the Median satraps of Atropatene.
  iranian: {
    first: ["Orontes", "Sames", "Arsames", "Abdissares", "Atropates", "Artabazanes", "Hydarnes", "Tiribazus", "Pharnabazus", "Artabanus", "Bagoas", "Mazaeus", "Oxathres", "Bagadates", "Mithrenes", "Artaphernes", "Rhoesaces", "Oxyartes", "Phraates", "Spitamenes"],
  },
  // North Arabian and Nabataean names from the Nabataean, Qedarite (Tell el-Maskhuta bowl) and Lihyanite inscriptions and their Greek spellings.
  arabian: {
    first: ["Aretas", "Malichus", "Obodas", "Rabbel", "Gashmu", "Qaynu", "Nuhai", "Hani", "Talmi", "Shahr", "Taymu", "Amru", "Wahballat", "Abdobodat", "Abdmanat"],
  },
  // South Arabian names of the Sabaean and Minaean royal inscriptions.
  sabaean: {
    first: ["Karibil", "Ilisharah", "Sumhuali", "Yadail", "Wahabil", "Yithiamar", "Abiyada", "Waqahil", "Ilyafa", "Dharih"],
  },
  // The Hebrew and Aramaic stock of Yehud, with the Greek forms Jewish families took in the third century: the priestly house, the Tobiads.
  judaean: {
    first: ["Onias", "Simon", "Eleazar", "Jochanan", "Matthias", "Judas", "Jason", "Joseph", "Tobias", "Hyrcanus", "Joshua", "Zadok", "Eliashib", "Jaddua", "Manasseh", "Jonathan", "Dositheus", "Nehemiah", "Hezekiah", "Hananiah", "Shemaiah"],
  },
  // Theophoric names of Seleucid Babylonia as the cuneiform tablets of Babylon and Uruk give them, for the Chaldean and Aramaic tribes of the marshes.
  mesopotamian: {
    first: ["Nabu-rimannu", "Kidinnu", "Bel-ahhe-iddina", "Anu-uballit", "Anu-belshunu", "Bel-reushunu", "Marduk-shapik-zeri", "Nanaya-iddin", "Shamash-iddin", "Nidintu-Anu", "Bel-zer-ibni", "Nabu-ahhe-iddin", "Anu-aha-ittannu"],
  },
  // Meroitic royal names (Arkamani, the Ergamenes of the Greeks, reigned about 270).
  nubian: {
    first: ["Arkamani", "Adikhalamani", "Amanislo", "Sabrakamani", "Arnekhamani", "Amanikhabale", "Yesbokheamani", "Tanyidamani"],
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
const ANATOLIAN = new Set(["cappadocia", "colchis", "paphlagonia", "pisidia-isauria", "pontus", "caucasian-albania", "caucasian-iberia"]);
const IRANIAN = new Set(["armenia", "atropatene", "caspian-peoples", "makran-tribes", "zagros-tribes"]);
const ARABIAN = new Set(["gerrha", "hejaz-tribes", "ituraeans", "lihyan", "najd-tribes", "nabataeans", "qedar", "scenitae-arabs"]);
const SABAEAN = new Set(["minaeans", "saba"]);
const JUDAEAN = new Set(["judea"]);
const MESOPOTAMIAN = new Set(["marsh-peoples"]);
const NUBIAN = new Set(["kush"]);
const LIBYAN = new Set(["gaetuli", "garamantes", "mauretanian-peoples", "numidian-kingdoms", "canarian-peoples"]);

export function cultureOf(polityId: string): Culture {
  if (ETRUSCAN.has(polityId)) return "etruscan";
  if (ITALIC.has(polityId)) return "italic";
  if (GREEK.has(polityId)) return "greek";
  if (LIBYAN.has(polityId)) return "libyan";
  if (ANATOLIAN.has(polityId)) return "anatolian";
  if (IRANIAN.has(polityId)) return "iranian";
  if (ARABIAN.has(polityId)) return "arabian";
  if (SABAEAN.has(polityId)) return "sabaean";
  if (JUDAEAN.has(polityId)) return "judaean";
  if (MESOPOTAMIAN.has(polityId)) return "mesopotamian";
  if (NUBIAN.has(polityId)) return "nubian";
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

