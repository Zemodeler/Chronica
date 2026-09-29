/**
 * What the provinces outside the hand-named core were called in 270 BC.
 *
 * The map's polygons come from modern administrative units, and the graph took
 * their names with them: a Dacian highland people held "Szabolcs-Szatmár-Bereg",
 * a Carthaginian governor sat in "Aïn Témouchent", and the Midland Britons
 * defended Wolverhampton. Every such unit is named here for the ancient people
 * or region it lay in -- the tribe's land where the sources name one (mostly
 * Ptolemy's and Caesar's peoples, the nearest record there is), the Punic or
 * Libyan town on the African coast, the river's ancient name where a people is
 * unknown, as the Germanic ground already reads ("Albis Heath").
 *
 * Several modern units may share one ancient region. The graph build then
 * qualifies each by where it lies within the region -- "Northern Pannonia",
 * "Central Dardania" -- so every name stays distinct (`qualifyByPosition`).
 * Keys are the source unit's own name within its country, matched loosely so
 * a mis-encoded "BRAGANÃ‡A" still finds "Bragança". Ids never change: saves
 * refer to them.
 */

/** Which table a province's id falls under, or null for ground already named by hand. */
export function namingScopeOf(provinceId: string): NamingScope | null {
  for (const [scope, pattern] of SCOPE_PATTERNS) if (pattern.test(provinceId)) return scope;
  return null;
}

export type NamingScope =
  | "britain" | "helvetia" | "noricum" | "hungary" | "dacia" | "illyria" | "gaul" | "iberia" | "portugal" | "greece"
  | "algeria" | "tunisia" | "libya" | "morocco";

const SCOPE_PATTERNS: readonly (readonly [NamingScope, RegExp])[] = [
  ["britain", /^punic-britain-/],
  ["helvetia", /^che-/],
  ["noricum", /^punic-austria-/],
  ["hungary", /^punic-hungary-/],
  ["dacia", /^punic-thrace-/],
  ["illyria", /^punic-illyria-/],
  ["gaul", /^punic-gaul-/],
  ["iberia", /^punic-iberia-/],
  ["portugal", /^prt-/],
  ["greece", /^punic-greece-/],
  ["algeria", /^dza-/],
  ["tunisia", /^tun-/],
  ["libya", /^lby-/],
  ["morocco", /^mar-/],
];

/**
 * Scopes drawn wholly from modern units: every province in one must be named
 * here, and the build fails if one is not. The others mix modern units with
 * names already given by hand (the Gaulish landscapes, the Thracian peoples,
 * the Greek cities), which keep theirs.
 */
export const WHOLLY_MODERN: ReadonlySet<NamingScope> = new Set(["britain", "helvetia", "noricum", "hungary", "illyria", "iberia", "portugal", "algeria", "tunisia", "libya", "morocco"]);

/** The ancient region, and the modern units that lay in it. */
type Regions = readonly (readonly [string, readonly string[]])[];

export const ANCIENT_REGIONS: Readonly<Record<NamingScope, Regions>> = {
  britain: [
    // The far north and the isles: Pytheas's Orcades, Pliny's Ebudae and Haemodae.
    ["Haemodae", ["Shetland Islands"]],
    ["Orcades", ["Orkney Islands"]],
    ["Ebudae", ["Na h-Eileanan Siar"]],
    ["Caledonii", ["Highland"]],
    ["Vacomagi", ["Moray"]],
    ["Taexali", ["Aberdeenshire", "Aberdeen City"]],
    ["Venicones", ["Angus", "Perth and Kinross", "Dundee City", "Fife"]],
    ["Maeatae", ["Stirling", "Clackmannanshire", "Falkirk"]],
    ["Epidii", ["Argyll and Bute"]],
    ["Clota", ["West Dunbartonshire", "East Dunbartonshire", "Inverclyde", "Glasgow City", "Renfrewshire", "East Renfrewshire", "North Lanarkshire"]],
    ["Damnonii", ["South Lanarkshire", "North Ayrshire", "East Ayrshire", "South Ayrshire"]],
    ["Votadini", ["City of Edinburgh", "West Lothian", "Midlothian", "East Lothian", "Northumberland"]],
    ["Selgovae", ["Scottish Borders"]],
    ["Novantae", ["Dumfries and Galloway"]],
    ["Tinea", ["North Tyneside", "Newcastle upon Tyne", "South Tyneside", "Gateshead", "Sunderland"]],
    ["Vedra", ["County Durham"]],
    ["Dunum Bay", ["Hartlepool", "Stockton-on-Tees", "Redcar and Cleveland", "Darlington", "Middlesbrough"]],
    ["Carvetii", ["Cumbria"]],
    ["Brigantes", ["North Yorkshire", "York"]],
    // The Arras burials of the Wolds are this people's, and of this century.
    ["Parisi", ["East Riding of Yorkshire", "Kingston upon Hull, City of"]],
    ["Abus", ["North Lincolnshire", "North East Lincolnshire"]],
    ["Cambodunum", ["Bradford", "Leeds", "Calderdale", "Kirklees", "Wakefield"]],
    ["Danum", ["Barnsley", "Doncaster", "Rotherham", "Sheffield"]],
    ["Belisama", ["Lancashire", "Blackburn with Darwen", "Blackpool"]],
    ["Mamucion", ["Rochdale", "Bury", "Bolton", "Oldham", "Salford", "Tameside", "Manchester", "Trafford", "Stockport"]],
    ["Seteia", ["Sefton", "Liverpool", "Knowsley", "St. Helens", "Halton", "Warrington", "Wigan", "Wirral"]],
    ["Deva", ["Cheshire West and Chester", "Cheshire East"]],
    ["Trisantona", ["Stoke-on-Trent", "Staffordshire"]],
    ["Cornovii", ["Telford and Wrekin", "Shropshire", "Walsall", "Wolverhampton", "Sandwell", "Dudley", "Birmingham"]],
    ["Abona Valley", ["Coventry", "Solihull", "Warwickshire"]],
    ["Corieltauvi", ["Leicestershire", "Leicester", "Rutland", "Nottinghamshire", "Nottingham", "Derbyshire", "Derby", "Lincolnshire", "Northamptonshire"]],
    ["Iceni", ["Norfolk", "Suffolk", "Cambridgeshire", "Peterborough"]],
    ["Trinovantes", ["Essex", "Southend-on-Sea", "Thurrock", "Havering", "Barking and Dagenham", "Redbridge", "Newham", "Waltham Forest"]],
    ["Catuvellauni", ["Hertfordshire", "Luton", "Central Bedfordshire", "Bedford", "Milton Keynes", "Buckinghamshire", "Barnet", "Enfield", "Haringey"]],
    ["Tamesis", ["City of London", "Westminster", "Camden", "Islington", "Kensington and Chelsea", "Hammersmith and Fulham", "Tower Hamlets", "Hackney"]],
    ["Tamesis Heath", ["Brent", "Harrow", "Hillingdon", "Ealing", "Hounslow"]],
    ["Tamesis Marshes", ["Southwark", "Lambeth", "Wandsworth", "Lewisham", "Greenwich"]],
    ["Anderida Forest", ["Surrey", "Croydon", "Sutton", "Merton", "Kingston upon Thames", "Richmond upon Thames"]],
    ["Cantiaci", ["Kent", "Medway", "Bexley", "Bromley"]],
    ["Regni", ["East Sussex", "Brighton and Hove", "West Sussex"]],
    ["Atrebates", ["West Berkshire", "Reading", "Wokingham", "Bracknell Forest", "Windsor and Maidenhead", "Slough"]],
    ["Belgae", ["Wiltshire", "Hampshire", "Southampton", "Portsmouth"]],
    ["Vectis", ["Isle of Wight"]],
    ["Dobunni", ["Gloucestershire", "Worcestershire", "Herefordshire, County of", "South Gloucestershire", "Bristol, City of", "Bath and North East Somerset", "North Somerset", "Swindon", "Oxfordshire"]],
    ["Durotriges", ["Dorset", "Bournemouth, Christchurch and Poole", "Somerset"]],
    ["Dumnonii", ["Devon", "Torbay", "Plymouth"]],
    // Pytheas's Belerion, where the tin was worked, and the tin islands off it.
    ["Belerion", ["Cornwall"]],
    ["Cassiterides", ["Isles of Scilly"]],
    ["Mona", ["Isle of Anglesey"]],
    ["Ordovices", ["Gwynedd", "Conwy", "Powys"]],
    ["Deceangli", ["Flintshire", "Denbighshire", "Wrexham"]],
    ["Demetae", ["Pembrokeshire", "Carmarthenshire", "Ceredigion", "Swansea", "Neath Port Talbot", "Bridgend"]],
    ["Silures", ["Monmouthshire", "Newport", "Blaenau Gwent", "Torfaen", "Caerphilly", "Cardiff", "Merthyr Tydfil", "Rhondda Cynon Taf", "Vale of Glamorgan"]],
    // Ptolemy's peoples of the north of Ireland.
    ["Robogdii", ["Causeway Coast and Glens"]],
    ["Vennicnii", ["Derry City and Strabane"]],
    ["Darini", ["Mid and East Antrim", "Antrim and Newtownabbey", "Belfast", "Lisburn and Castlereagh"]],
    ["Voluntii", ["Ards and North Down", "Newry, Mourne and Down", "Armagh City, Banbridge and Craigavon"]],
    ["Erdini", ["Mid Ulster", "Fermanagh and Omagh"]],
  ],
  helvetia: [
    ["Rauraci", ["Basel-Stadt", "Basel-Landschaft", "Jura", "Solothurn"]],
    ["Tigurini", ["Aargau", "Zürich", "Schaffhausen", "Thurgau", "Zug"]],
    ["Venonetes", ["St. Gallen", "Appenzell Ausserrhoden", "Appenzell Innerrhoden", "Glarus"]],
    ["Verbigeni", ["Luzern", "Schwyz", "Obwalden", "Nidwalden", "Uri"]],
    // La Tène itself is on the lake of Neuchâtel.
    ["Helvetii", ["Bern", "Fribourg", "Neuchâtel"]],
    ["Lemannus Shore", ["Vaud"]],
    ["Genava", ["Genève"]],
    ["Seduni", ["Valais"]],
    ["Lepontii", ["Ticino"]],
    ["Raetian Alps", ["Graubünden"]],
  ],
  noricum: [
    ["Norici", ["Niederösterreich", "Wien", "Oberösterreich"]],
    ["Boii by Lake Peiso", ["Burgenland"]],
    ["Ambisontes", ["Salzburg"]],
    ["Taurisci", ["Steiermark", "Kärnten"]],
    ["Brigantii", ["Vorarlberg"]],
    ["Breuni", ["Tirol"]],
  ],
  hungary: [
    ["Pannonia", ["Győr-Moson-Sopron", "Komárom-Esztergom", "Vas", "Fejér"]],
    ["Lake Pelso", ["Veszprém", "Zala", "Somogy"]],
    ["Hercuniates", ["Tolna", "Baranya"]],
    // Pliny's Pathissus, the Tisza.
    ["Pathissus Plain", ["Pest", "Jász-Nagykun-Szolnok", "Bács-Kiskun", "Csongrád-Csanád", "Békés", "Hajdú-Bihar"]],
    ["Anartes", ["Nógrád", "Heves", "Borsod-Abaúj-Zemplén", "Szabolcs-Szatmár-Bereg"]],
  ],
  // The rivers north of the Danube by the names Herodotus and Ptolemy give them.
  dacia: [
    ["Samus Valley", ["CLUJ", "BISTRITA-NASAUD", "SALAJ", "SATU MARE", "MARAMURES"]],
    ["Crisius", ["BIHOR", "ARAD"]],
    ["Marisus Valley", ["MURES", "ALBA", "HUNEDOARA"]],
    ["Aluta Highlands", ["HARGHITA", "COVASNA", "BRASOV", "SIBIU"]],
    ["Tibiscus", ["TIMIS", "CARAS-SEVERIN"]],
    ["Ordessos", ["ARGES", "DAMBOVITA"]],
    ["Naparis", ["PRAHOVA", "IALOMITA", "BUZAU"]],
    ["Getic Plain", ["ILFOV", "BUCURESTI", "CALARASI", "GIURGIU", "TELEORMAN", "BRAILA"]],
    ["Rhabon Valley", ["GORJ", "DOLJ", "MEHEDINTI"]],
    ["Aluta Valley", ["OLT", "VALCEA"]],
    ["Porata", ["BOTOSANI", "IASI", "VASLUI"]],
    ["Hierasus", ["SUCEAVA", "NEAMT", "BACAU", "GALATI", "VRANCEA"]],
    ["Peuce", ["TULCEA"]],
    ["Tomis", ["CONSTANTA"]],
  ],
  illyria: [
    ["Taurisci", ["Vzhodna"]],
    ["Carni", ["Zahodna Slovenija"]],
    ["Dravus Valley", ["Međimurje", "Varaždin", "Koprivnica-Križevci", "Virovitica-Podravina", "Bjelovar-Bilogora"]],
    ["Colapiani", ["City of Zagreb", "Zagreb County", "Krapina-Zagorje", "Karlovac"]],
    ["Segestica", ["Sisak-Moslavina"]],
    ["Breuci", ["Požega-Slavonia", "Brod-Posavina", "Brčko District"]],
    ["Amantini", ["Osijek-Baranja", "Vukovar-Syrmia", "Syrmia District"]],
    ["Histria", ["Istria"]],
    ["Liburnia", ["Primorje-Gorski Kotar", "Zadar County", "Šibenik-Knin"]],
    ["Iapodes", ["Lika-Senj"]],
    ["Delmatae", ["Split-Dalmatia", "Federation of Bosnia and Herzegovina"]],
    ["Daorsi", ["Dubrovnik-Neretva"]],
    ["Maezaei", ["Republika Srpska"]],
    ["Scordisci", ["North Backa District", "West Backa District", "South Backa District", "Macva District", "Kolubara District"]],
    ["Tibiscus", ["North Banat District", "Central Banat District", "South Banat District"]],
    // The Scordisci's own town, by its Celtic name.
    ["Singidunum", ["Belgrade"]],
    ["Margus Valley", ["Podunavlje District", "Branicevo District", "Pomoravlje District", "Sumadija District"]],
    ["Timacus Valley", ["Bor District", "Zajecar District"]],
    ["Triballi", ["Nisava District", "Pirot District", "Toplica District"]],
    ["Autariatae", ["Moravica District", "Zlatibor District", "Raska District", "Rasina District"]],
    ["Dardania", ["Jablanica District", "Pcinja District", "District of Mitrovica", "District of Peja", "District of Prishtina", "District of Ferizaj", "District of Gjilan", "District of Gjakova", "District of Prizren"]],
    ["Pirustae", ["Pljevlja Municipality", "Plužine Municipality", "Žabljak Municipality", "Šavnik Municipality", "Mojkovac Municipality", "Kolašin Municipality"]],
    ["Drinus Highlands", ["Bijelo Polje Municipality", "Petnjica Municipality", "Rožaje Municipality", "Berane Municipality", "Andrijevica Municipality", "Plav Municipality", "Gusinje Municipality"]],
    ["Docleatae", ["Nikšić Municipality", "Danilovgrad Municipality", "Podgorica Municipality", "Cetinje Municipality"]],
    // Rhizon, where Teuta will shelter from Rome.
    ["Rhizonic Gulf", ["Herceg Novi Municipality", "Kotor Municipality", "Tivat Municipality"]],
    ["Ardiaei", ["Budva Municipality", "Bar Municipality", "Ulcinj Municipality"]],
    ["Drilon Valley", ["Kukës", "Dibër"]],
    ["Labeates", ["Shkodër"]],
    ["Lissus", ["Lezhë"]],
    ["Epidamnus", ["Durrës"]],
    ["Taulantii", ["Tiranë"]],
    ["Parthini", ["Elbasan"]],
    ["Apolloniatis", ["Fier"]],
    ["Dassaretae", ["Berat", "Korçë"]],
    ["Chaonia", ["Gjirokastër"]],
    ["Amantia", ["Vlorë"]],
    ["Penestae", ["Polog"]],
    ["Scupi", ["Skopje"]],
    ["Paeonia", ["Northeast", "East", "Southeast"]],
    ["Axius Valley", ["Vardar"]],
    ["Lychnidus", ["Southwest"]],
    ["Pelagonia", ["Pelagonia"]],
  ],
  // The departments follow the Gaulish civitates closely: most keep a people's name to this day.
  gaul: [
    ["Nemetocenna", ["Pas-de-Calais"]],
    ["Scaldis Valley", ["Nord"]],
    ["Ambiani", ["Somme"]],
    ["Caleti", ["Seine-Maritime"]],
    ["Arduenna Forest", ["Ardennes"]],
    ["Suessiones", ["Aisne"]],
    ["Bellovaci", ["Oise"]],
    ["Eburovices", ["Eure"]],
    ["Lexovii", ["Calvados"]],
    ["Unelli", ["Manche"]],
    ["Parisii", ["Val-d'Oise", "Seine-Saint-Denis", "Hauts-de-Seine", "Val-de-Marne", "Yvelines", "Essonne"]],
    ["Meldi", ["Seine-et-Marne"]],
    ["Mediomatrici", ["Meuse"]],
    ["Remi", ["Marne"]],
    ["Leuci", ["Meurthe-et-Moselle"]],
    ["Esuvii", ["Orne"]],
    ["Coriosolites", ["Côtes d'Armor"]],
    ["Tricasses", ["Aube"]],
    ["Osismii", ["Finistère"]],
    ["Redones", ["Ille-et-Vilaine"]],
    ["Diablintes", ["Mayenne"]],
    ["Lingones", ["Haute-Marne"]],
    ["Cenomani", ["Sarthe"]],
    ["Armorican Veneti", ["Morbihan"]],
    ["Senones", ["Yonne"]],
    ["Carnutes", ["Eure-et-Loir", "Loiret", "Loir-et-Cher"]],
    ["Mandubii", ["Côte-d'Or"]],
    ["Andecavi", ["Maine-et-Loire"]],
    ["Namnetes", ["Loire-Atlantique"]],
    ["Turones", ["Indre-et-Loire"]],
    ["Aedui", ["Nièvre"]],
    ["Sequani", ["Haute-Saône", "Doubs", "Jura", "Territoire de Belfort"]],
    // Haut-Rhin was drawn as "Upper Rhenus Terrace", the name of a German province too.
    ["Rauracian Terrace", ["Upper Rhenus Terrace"]],
    ["Bituriges", ["Cher", "Indre"]],
    ["Pictones", ["Vienne", "Deux-Sèvres", "Vendée"]],
    ["Arverni", ["Allier", "Cantal"]],
    ["Ambarri", ["Ain"]],
    ["Lemovices", ["Haute-Vienne", "Creuse", "Corrèze"]],
    ["Allobroges", ["Haute-Savoie", "Isère"]],
    ["Ceutrones", ["Savoie"]],
    ["Segusiavi", ["Rhône", "Loire"]],
    ["Santones", ["Charente", "Charente-Maritime"]],
    ["Vellavi", ["Haute-Loire"]],
    ["Petrocorii", ["Dordogne"]],
    ["Meduli", ["Gironde"]],
    ["Helvii", ["Ardèche"]],
    ["Vocontii", ["Drôme"]],
    ["Caturiges", ["Hautes-Alpes"]],
    ["Cadurci", ["Lot"]],
    ["Gabali", ["Lozère"]],
    ["Nitiobroges", ["Lot-et-Garonne"]],
    ["Ruteni", ["Aveyron"]],
    ["Albici", ["Alpes-de-Haute-Provence"]],
    ["Tectosages", ["Tarn-et-Garonne", "Haute-Garonne", "Tarn"]],
    ["Cavari", ["Vaucluse"]],
    ["Arecomici", ["Gard"]],
    ["Tarbelli", ["Landes", "Pyrénées-Atlantiques"]],
    ["Deciates", ["Alpes-Maritimes"]],
    ["Ausci", ["Gers"]],
    ["Longostaletes", ["Hérault"]],
    ["Oxybii", ["Var"]],
    ["Elisyces", ["Aude"]],
    ["Bigerriones", ["Hautes-Pyrénées"]],
    ["Consoranni", ["Ariège"]],
    ["Sordones", ["Pyrénées-Orientales"]],
    ["Corsica", ["Haute-Corse", "Corse-du-Sud"]],
  ],
  iberia: [
    ["Astures", ["Principado de Asturias"]],
    ["Cantabri", ["Cantabria"]],
    ["Caristii", ["País Vasco/Euskadi"]],
    ["Vascones", ["Comunidad Foral de Navarra"]],
    ["Berones", ["La Rioja"]],
    ["Gallaeci", ["Galicia"]],
    ["Ilergetes", ["Cataluña/Catalunya"]],
    ["Vaccaei", ["Castilla y León"]],
    ["Celtiberia", ["Aragón"]],
    ["Carpetani", ["Comunidad de Madrid"]],
    ["Oretani", ["Castilla-La Mancha"]],
    ["Balearic Isles", ["Illes Balears"]],
    ["Edetani", ["Comunitat Valenciana"]],
    ["Vettones", ["Extremadura"]],
    ["Contestani", ["Región de Murcia"]],
    ["Turdetania", ["Andalucía"]],
    // Abyla, the African Pillar of Heracles; Rusaddir, a Phoenician harbour.
    ["Abyla", ["Ciudad Autónoma de Ceuta"]],
    ["Rusaddir", ["Ciudad Autónoma de Melilla"]],
    ["Fortunate Isles", ["Canarias"]],
  ],
  portugal: [
    ["Grovii", ["Viana do Castelo"]],
    ["Bracari", ["Braga"]],
    ["Tamagani", ["Vila Real"]],
    ["Zoelae", ["Bragança"]],
    ["Cale", ["Porto"]],
    ["Lusitani", ["Viseu"]],
    ["Turduli Veteres", ["Aveiro"]],
    ["Herminian Hills", ["Guarda"]],
    ["Conimbriga", ["Coimbra"]],
    ["Igaeditani", ["Castelo Branco"]],
    ["Lusitanian Coast", ["Leiria"]],
    ["Scallabis", ["Santarém"]],
    ["Celtici", ["Portalegre", "Beja"]],
    ["Olisipo", ["Lisboa"]],
    ["Ebora", ["Évora"]],
    ["Salacia", ["Setúbal"]],
    // Herodotus's Cynetes, the westernmost people of Europe.
    ["Cynetes", ["Faro"]],
    ["Ocean Isles", ["Região Autónoma da Madeira"]],
  ],
  greece: [
    ["Hebrus", ["Evros"]],
    ["Abdera", ["Xanthi"]],
    ["Cicones", ["Rodopi"]],
    ["Hestiaeotis", ["Trikala"]],
    ["Cassopaea", ["Preveza"]],
  ],
  // The Punic coast by its harbours; Numidia by its Libyan towns and its two kingdoms.
  algeria: [
    ["Hippo", ["Annaba"]],
    ["Tuniza", ["El Tarf"]],
    ["Rusicade", ["Skikda"]],
    ["Igilgili", ["Jijel"]],
    ["Saldae", ["Bejaia"]],
    ["Rusgunia", ["Boumerdès"]],
    ["Ikosim", ["Algiers"]],
    ["Tipasa", ["Tipaza"]],
    ["Cartenna", ["Chlef"]],
    ["Quiza", ["Mostaganem"]],
    ["Masaesylian Coast", ["Oran"]],
    // Siga, Syphax's capital in the next generation.
    ["Siga", ["Aïn Témouchent"]],
    ["Cirta", ["Constantine"]],
    ["Calama", ["Guelma"]],
    ["Thagaste", ["Souk Ahras"]],
    ["Theveste", ["Tébessa"]],
    ["Sitifis", ["Sétif"]],
    ["Aurasius", ["Batna"]],
    ["Mascula", ["Khenchela"]],
    ["Mileu", ["Mila"]],
    ["Vescera", ["Biskra"]],
    ["Massylia", ["Oum El Bouaghi", "M'Sila", "Bordj Bou Arreridj"]],
    ["Masaesylia", ["Tlemcen", "Sidi Bel Abbès", "Saïda", "Mascara", "Blida", "Médéa", "Tizi Ouzou", "Bouira"]],
    ["Chinalaph", ["Aïn Defla", "Relizane", "Tissemsilt"]],
    ["Gaetulia", ["Tiaret", "Djelfa", "Laghouat", "Naâma", "El Bayadh"]],
    ["Tritonis", ["El Oued"]],
    ["Melanogaetuli", ["Ghardaia", "Ouargla", "Béchar", "Adrar", "Tindouf"]],
    ["Atarantes", ["Illizi", "Tamanrasset"]],
  ],
  tunisia: [
    ["Carthaginian heartland", ["Tunis"]],
    ["Utica", ["Bizerte"]],
    ["Megara", ["Ariana"]],
    ["Bagradas", ["Manouba"]],
    ["Vaga", ["Béja"]],
    ["Neapolis", ["Nabeul"]],
    ["Maxula", ["Ben Arous"]],
    ["Bulla", ["Jendouba"]],
    ["Thuburbo", ["Zaghouan"]],
    ["Mactaris", ["Siliana"]],
    ["Sicca", ["El Kef"]],
    ["Hadrumetum", ["Sousse"]],
    ["Byzacium", ["Kairouan"]],
    ["Ruspina", ["Monastir"]],
    ["Thapsus", ["Mahdia"]],
    ["Thala", ["Kasserine"]],
    ["Sufes", ["Sidi Bouzid"]],
    ["Thaenae", ["Sfax"]],
    ["Capsa", ["Gafsa"]],
    // Lake Tritonis, the Chott el Djerid.
    ["Tritonis", ["Tozeur", "Kébili", "Tataouine"]],
    ["Tacape", ["Gabès"]],
    ["Gigthis", ["Médenine"]],
  ],
  libya: [
    ["Zuchis", ["An Nuqat al Khams"]],
    ["Oea", ["Tajura' wa an Nawahi al Arba"]],
    ["Sabratha", ["Az Zawiyah"]],
    // Polybius's Emporia, the Punic trading towns of the Syrtic coast.
    ["Emporia", ["Al Jifarah"]],
    ["Lepcis", ["Al Marqab"]],
    ["Thubactis", ["Misratah"]],
    ["Macae", ["Mizdah"]],
    ["Syrtis", ["Surt"]],
    ["Cydamus", ["Ghadamis"]],
    ["Cyrene", ["Al Jabal al Akhdar"]],
    ["Barca", ["Al Marj"]],
    ["Darnis", ["Al Qubbah"]],
    // Berenice after 246; in 270 still the Euhesperides.
    ["Euhesperides", ["Benghazi"]],
    ["Marmarica", ["Al Butnan"]],
    ["Augila", ["Ajdabiya"]],
    ["Phazania", ["Ash Shati'", "Sabha", "Murzuq", "Ghat", "Al Jufrah"]],
    ["Garama", ["Wadi al Hayaa"]],
    ["Libyan Waste", ["Al Kufrah"]],
  ],
  morocco: [
    ["Tingis", ["Tangier-Tetouan-Al Hoceima"]],
    ["Sala", ["Rabat-Salé-Kenitra"]],
    ["Volubilis", ["Fez-Meknes"]],
    ["Mulucha", ["Oriental"]],
    ["Autololes", ["Casablanca-Settat", "Marrakech-Safi"]],
    ["Mount Atlas", ["Béni Mellal-Khénifra"]],
    ["Darat", ["Drâa-Tafilalet"]],
    ["Masathat", ["Souss-Massa"]],
    ["Pharusii", ["Guelmim-Oued Noun"]],
    ["Perorsi", ["Laâyoune-Sakia El Hamra"]],
    ["Western Aethiopians", ["Dakhla-Oued Ed-Dahab"]],
  ],
};

/**
 * A modern unit's name as a key: letters and digits only, lowercased, so
 * accents, spacing, invisible marks and the source's mis-encoded letters all
 * fall away ("Bordj Bou Arreridj" carries a stray right-to-left mark).
 */
export function looseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_SCOPE: ReadonlyMap<NamingScope, ReadonlyMap<string, string>> = new Map(
  (Object.entries(ANCIENT_REGIONS) as [NamingScope, Regions][]).map(([scope, regions]) => {
    const byKey = new Map<string, string>();
    for (const [ancient, modern] of regions) {
      for (const name of modern) {
        const key = looseKey(name);
        if (byKey.has(key)) throw new Error(`ancient-province-names: ${scope} names "${name}" twice`);
        byKey.set(key, ancient);
      }
    }
    return [scope, byKey];
  }),
);

/** The ancient region a modern unit lay in, or null where the table has none. */
export function ancientRegionOf(provinceId: string, sourceName: string): string | null {
  const scope = namingScopeOf(provinceId);
  if (scope === null) return null;
  return BY_SCOPE.get(scope)?.get(looseKey(sourceName)) ?? null;
}

const COMPASS: readonly (readonly [string, number, number])[] = [
  ["Central", 0, 0],
  ["Northern", 0, 1], ["Southern", 0, -1], ["Eastern", 1, 0], ["Western", -1, 0],
  ["North-eastern", 0.71, 0.71], ["North-western", -0.71, 0.71], ["South-eastern", 0.71, -0.71], ["South-western", -0.71, -0.71],
];

/**
 * Where several provinces fall in one ancient region, each is named for where
 * it lies in it: two apart along whichever way they differ most, more by the
 * compass round the region's middle, each word given once. A region of more
 * than nine has to be split in the table instead.
 */
export function qualifyByPosition(region: string, members: readonly { readonly id: string; readonly lon: number; readonly lat: number }[]): Map<string, string> {
  const named = new Map<string, string>();
  if (members.length === 1) {
    named.set(members[0]!.id, region);
    return named;
  }
  if (members.length > COMPASS.length) throw new Error(`ancient-province-names: ${region} spans ${members.length} provinces; split it`);
  const midLat = members.reduce((sum, member) => sum + member.lat, 0) / members.length;
  const midLon = members.reduce((sum, member) => sum + member.lon, 0) / members.length;
  const squeeze = Math.cos((midLat * Math.PI) / 180);
  const offsets = members.map((member) => ({ id: member.id, x: (member.lon - midLon) * squeeze, y: member.lat - midLat }));
  if (members.length === 2) {
    const [a, b] = offsets as [typeof offsets[number], typeof offsets[number]];
    const eastWest = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y);
    const aFirst = eastWest ? a.x < b.x : a.y > b.y;
    const [first, second] = eastWest ? ["Western", "Eastern"] : ["Northern", "Southern"];
    named.set(a.id, `${aFirst ? first : second} ${region}`);
    named.set(b.id, `${aFirst ? second : first} ${region}`);
    return named;
  }
  // The assignment that fits all of them best at once, not each in turn: a
  // greedy one left the last province whatever word was over.
  const reach = Math.max(...offsets.map((offset) => Math.hypot(offset.x, offset.y)), 1e-9);
  const cost = offsets.map((offset) => COMPASS.map(([, x, y]) => (offset.x / reach - x) ** 2 + (offset.y / reach - y) ** 2));
  const best = new Map<number, { total: number; words: number[] }>([[0, { total: 0, words: [] }]]);
  for (let index = 0; index < offsets.length; index++) {
    const next = new Map<number, { total: number; words: number[] }>();
    for (const [used, sofar] of best) {
      for (let word = 0; word < COMPASS.length; word++) {
        if ((used & (1 << word)) !== 0) continue;
        const total = sofar.total + cost[index]![word]!;
        const key = used | (1 << word);
        const held = next.get(key);
        if (held === undefined || total < held.total - 1e-12) next.set(key, { total, words: [...sofar.words, word] });
      }
    }
    best.clear();
    for (const [key, value] of next) best.set(key, value);
  }
  const chosen = [...best.values()].sort((a, b) => a.total - b.total)[0]!.words;
  offsets.forEach((offset, index) => named.set(offset.id, `${COMPASS[chosen[index]!]![0]} ${region}`));
  return named;
}
