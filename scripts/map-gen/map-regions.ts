// The named regions of the Roman-era world, as anchor points. A province belongs to the region whose anchor is nearest
// (weighted, and on the same landmass where the region has an anchor there), so a region is the ground closest to its heart.
// Names are the attested ancient ones; where a people gave its name to a country the country takes the people's name.
export interface RegionAnchor {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** A larger weight claims more ground; 1 is an ordinary region. */
  readonly weight?: number;
}

const r = (name: string, lon: number, lat: number, weight = 1): RegionAnchor => ({ name, lon, lat, weight });

export const REGION_ANCHORS: readonly RegionAnchor[] = [
  // Italy
  r('Liguria', 8.7, 44.3), r('Taurinia', 7.7, 45.0), r('Salassia', 7.3, 45.7), r('Insubria', 9.0, 45.5), r('Cenomania', 10.3, 45.4), r('Venetia', 11.9, 45.5),
  r('Aemilia', 10.9, 44.6), r('Ager Gallicus', 12.7, 43.7), r('Picenum', 13.5, 42.9), r('Umbria', 12.5, 43.0), r('Etruria', 11.3, 43.0, 1.3),
  r('Latium', 12.9, 41.75), r('Sabinum', 12.9, 42.35), r('Marsia', 13.7, 42.0), r('Samnium', 14.6, 41.5), r('Campania', 14.3, 41.0), r('Daunia', 15.6, 41.5),
  r('Peucetia', 16.7, 41.0), r('Messapia', 18.0, 40.3), r('Lucania', 15.9, 40.3), r('Bruttium', 16.3, 39.1), r('Aeolian Isles', 14.9, 38.5),
  // Sicily, Sardinia, Corsica, Malta, the Balearics
  r('Elymia', 12.6, 37.9), r('Sicania', 13.6, 37.5), r('Sicelia', 14.4, 37.7), r('Peloris', 15.3, 38.1), r('Syracusia', 15.0, 37.1),
  r('Sardinia', 9.0, 40.0, 1.5), r('Corsica', 9.1, 42.2), r('Melita', 14.4, 35.9), r('Baliares', 2.9, 39.6), r('Pityusae', 1.4, 38.95),
  // Gaul
  r('Aquitania', -0.5, 44.0), r('Pictonia', -0.3, 46.5), r('Armorica', -3.0, 48.2), r('Aulercia', 0.3, 48.1), r('Caletia', 0.7, 49.6), r('Andecavia', -0.5, 47.4),
  r('Turonia', 0.8, 47.3), r('Carnutia', 1.5, 48.2), r('Biturigia', 2.4, 47.0), r('Lemovicia', 1.3, 45.8), r('Petrocoria', 0.7, 45.1), r('Cadurcia', 1.5, 44.5),
  r('Ruthenia', 2.6, 44.3), r('Arvernia', 3.2, 45.4), r('Aeduia', 4.2, 46.9), r('Segusiavia', 4.4, 45.8), r('Senonia', 3.4, 48.2), r('Lingonia', 5.2, 47.8),
  r('Sequania', 5.9, 47.0), r('Helvetia', 8.0, 47.0), r('Allobrogia', 5.7, 45.4), r('Vocontia', 5.6, 44.3), r('Salluvia', 5.6, 43.6), r('Volcae', 3.5, 43.8),
  r('Tectosagia', 1.5, 43.4), r('Belgica', 4.3, 49.6), r('Nervia', 3.8, 50.4), r('Menapia', 3.5, 51.3), r('Morinia', 2.2, 50.6), r('Ambiania', 2.3, 49.9),
  r('Mediomatricia', 6.3, 49.0), r('Leucia', 5.9, 48.4), r('Treveria', 6.6, 49.8), r('Eburonia', 5.4, 50.5), r('Ubia', 7.0, 50.7), r('Tribocia', 7.6, 48.5),
  r('Batavia', 5.3, 52.0), r('Frisia', 5.9, 53.2),
  // Germania and the north
  r('Bructeria', 7.5, 52.2), r('Sugambria', 7.8, 51.2), r('Chattia', 9.3, 51.2), r('Cheruscia', 9.5, 52.1), r('Angrivaria', 8.9, 52.7), r('Chaucia', 8.4, 53.5),
  r('Langobardia', 10.6, 53.2), r('Semnonia', 13.2, 52.4), r('Hermundurica', 11.3, 50.6), r('Suebia', 9.4, 48.5), r('Agri Decumates', 8.4, 48.3),
  r('Hercynia', 10.8, 49.6), r('Vindelicia', 11.2, 48.2), r('Cimbria', 9.4, 56.0), r('Teutonia', 10.0, 54.4), r('Rugia', 14.5, 54.0), r('Vandalia', 16.0, 51.5),
  r('Gothonia', 18.5, 53.6), r('Sarmatia', 26.0, 51.5, 3), r('Marcomannia', 14.6, 49.8), r('Quadia', 17.2, 49.0), r('Boihaemum', 14.0, 50.2),
  r('Scandia', 12.5, 58.0),
  // Alps and the Danube
  r('Raetia', 10.8, 47.0), r('Noricum', 14.0, 47.1), r('Pannonia Superior', 16.4, 47.0), r('Pannonia Inferior', 18.4, 46.2), r('Savia', 15.8, 45.7),
  r('Iazygia', 20.5, 47.2), r('Banat', 21.6, 45.5), r('Dacia', 24.0, 46.0, 1.3), r('Getia', 26.8, 46.8), r('Muntenia', 25.6, 44.2), r('Scythia Minor', 28.6, 44.4),
  r('Moesia Superior', 21.5, 44.0), r('Moesia Inferior', 25.6, 43.6), r('Triballia', 23.0, 43.4), r('Dardania', 21.2, 42.4), r('Paeonia', 22.2, 41.5),
  r('Scythia', 33.0, 46.5, 2), r('Taurica', 34.0, 45.1),
  // Illyria and the Adriatic
  r('Histria', 13.9, 45.3), r('Liburnia', 15.2, 44.4), r('Dalmatia', 16.6, 43.6), r('Delmatae', 17.8, 44.0), r('Illyria', 19.3, 42.5), r('Taulantia', 19.8, 41.1),
  // Macedon, Thrace, Greece
  r('Macedonia', 22.0, 40.9), r('Chalcidice', 23.5, 40.3), r('Thessaly', 22.1, 39.5), r('Epirus', 20.6, 39.6), r('Odrysia', 25.5, 42.0), r('Bessica', 24.0, 41.8),
  r('Thracian Chersonese', 26.5, 40.5), r('Thynia', 27.8, 41.3), r('Attica', 23.7, 38.0), r('Boeotia', 23.2, 38.4), r('Phocis', 22.4, 38.5), r('Aetolia', 21.6, 38.6),
  r('Acarnania', 21.0, 38.7), r('Achaea', 22.0, 38.1), r('Arcadia', 22.3, 37.6), r('Laconia', 22.5, 36.9), r('Messenia', 21.8, 37.2), r('Elis', 21.5, 37.8),
  r('Argolis', 22.9, 37.6), r('Euboea', 24.0, 38.6), r('Cyclades', 25.2, 37.2), r('Sporades', 24.0, 39.1), r('Thasos and Samothrace', 25.0, 40.5), r('Lemnos and Imbros', 25.2, 39.9),
  r('Ionian Isles', 20.0, 38.5), r('Crete', 25.0, 35.2), r('Lesbos', 26.3, 39.2), r('Chios', 26.0, 38.4), r('Samos', 26.7, 37.7), r('Dodecanese', 27.1, 36.7), r('Rhodes', 28.0, 36.2),
  // Iberia
  r('Turdetania', -5.8, 37.6), r('Bastetania', -3.0, 37.3), r('Oretania', -3.6, 38.7), r('Contestania', -0.5, 38.5), r('Edetania', -0.5, 39.8), r('Ilercavonia', 0.3, 40.6),
  r('Ilergetia', 0.8, 41.7), r('Lacetania', 1.6, 42.2), r('Indiketia', 2.8, 42.1), r('Cessetania', 1.4, 41.2), r('Laietania', 2.2, 41.6), r('Vasconia', -1.5, 42.8),
  r('Autrigonia', -3.2, 43.0), r('Cantabria', -4.3, 43.2), r('Asturia', -5.8, 43.0), r('Gallaecia', -8.0, 42.5), r('Vaccaea', -4.8, 41.6), r('Carpetania', -3.7, 40.2),
  r('Celtiberia', -2.2, 41.2), r('Lusitania', -7.7, 39.3), r('Vettonia', -6.1, 40.4), r('Cynesia', -8.0, 37.3), r('Baeturia', -6.4, 38.2),
  // Britain and Ireland
  r('Dumnonia', -4.0, 50.5), r('Durotrigia', -2.5, 50.8), r('Atrebatia', -1.2, 51.3), r('Cantium', 0.9, 51.2), r('Trinovantia', 0.6, 51.9), r('Icenia', 0.9, 52.6),
  r('Catuvellaunia', -0.4, 51.9), r('Dobunnia', -2.1, 51.8), r('Siluria', -3.5, 51.8), r('Ordovicia', -3.7, 52.8), r('Cornovia', -2.8, 52.6), r('Corieltavia', -0.8, 52.7),
  r('Brigantia', -2.0, 54.0), r('Parisia', -0.5, 54.0), r('Votadinia', -2.8, 55.7), r('Novantia', -4.2, 55.0), r('Damnonia', -4.5, 56.2), r('Caledonia', -4.4, 57.3, 1.3),
  r('Ebudae', -6.5, 57.5), r('Orcades', -3.2, 58.8), r('Ulster', -6.5, 54.8), r('Connacht', -8.8, 53.8), r('Munster', -8.8, 52.0), r('Leinster', -6.8, 53.0),
  // Asia Minor
  r('Troad', 26.5, 39.8), r('Mysia', 27.8, 39.7), r('Aeolis', 26.9, 39.0), r('Lydia', 28.2, 38.4), r('Ionia', 27.3, 37.9), r('Caria', 28.3, 37.2), r('Lycia', 29.6, 36.6),
  r('Pamphylia', 31.0, 37.0), r('Pisidia', 30.8, 37.8), r('Phrygia', 30.2, 39.0), r('Lycaonia', 32.5, 37.8), r('Cilicia Tracheia', 33.5, 36.5), r('Cilicia Pedias', 35.3, 37.0),
  r('Cappadocia', 35.3, 38.5), r('Galatia', 32.8, 39.8), r('Bithynia', 30.0, 40.6), r('Paphlagonia', 33.8, 41.0), r('Pontus', 36.5, 40.6), r('Themiscyra', 37.5, 41.0),
  r('Armenia Minor', 38.3, 39.8), r('Sophene', 39.2, 38.3), r('Armenia', 42.0, 39.9), r('Commagene', 37.9, 37.6), r('Colchis', 41.5, 41.5),
  // Africa west of Egypt
  r('Zeugitana', 10.0, 37.0), r('Byzacena', 10.2, 35.4), r('Emporia', 10.5, 34.0), r('Numidia', 6.5, 36.3), r('Massaesylia', 1.5, 35.5), r('Mauretania', -3.0, 35.0),
  r('Tingitana', -5.8, 34.5), r('Gaetulia', -1.0, 31.0, 2), r('Atlas', -6.0, 32.0), r('Fortunate Isles', -16.0, 28.2), r('Tripolitania', 13.0, 32.6), r('Syrtica', 17.5, 31.0),
  r('Garamantia', 13.0, 26.5, 2), r('Cyrenaica', 21.8, 32.6), r('Augilae', 21.3, 29.1), r('Marmarica', 24.5, 31.2),
  // Egypt
  r('Mareotis', 29.6, 31.0), r('Saite Delta', 30.9, 30.9), r('Sebennyte Delta', 31.4, 31.1), r('Mendesian Delta', 31.9, 30.9), r('Arabian Nome', 32.4, 30.3),
  r('Heliopolite Nome', 31.3, 30.1), r('Memphite Nome', 31.2, 29.8), r('Arsinoite Nome', 30.8, 29.3), r('Heracleopolite Nome', 30.9, 28.6), r('Oxyrhynchite Nome', 30.7, 28.1),
  r('Hermopolite Nome', 30.8, 27.5), r('Lycopolite Nome', 31.1, 27.0), r('Abydene Nome', 31.9, 26.2), r('Coptite Nome', 32.8, 26.0), r('Theban Nome', 32.7, 25.6),
  r('Apollonopolite Nome', 32.9, 25.0), r('Ombite Nome', 32.9, 24.4), r('Elephantine', 32.9, 23.9), r('Sinai', 33.8, 29.0), r('Trogodytice', 34.0, 26.3), r('Eastern Desert', 32.6, 27.0),
  r('Ammonium', 25.5, 29.2), r('Great Oasis', 30.5, 25.5), r('Little Oasis', 28.9, 28.3), r('Dakhla', 29.1, 25.7), r('Berenice Troglodytica', 34.6, 23.5),
  // Arabia
  r('Midian', 35.5, 28.0), r('Lihyan', 37.8, 26.6), r('Tema', 38.5, 27.7), r('Dumat', 39.9, 29.8), r('Hejaz', 39.7, 23.5), r('Yathrib', 39.6, 24.5), r('Tihama', 41.5, 19.5),
  r('Asir', 42.5, 18.3), r('Najran', 44.2, 17.6), r('Najd', 44.0, 25.0, 2), r('Yamama', 46.5, 23.0), r('Gerrha', 49.8, 26.2), r('Dilmun', 50.4, 26.6), r('Hail', 41.7, 27.5),
  // The Levant
  r('Phoenicia', 35.6, 33.6), r('Damascene', 36.4, 33.5), r('Galilee', 35.4, 32.9), r('Samaria', 35.2, 32.2), r('Judea', 35.1, 31.6), r('Philistia', 34.6, 31.6),
  r('Idumea', 34.9, 30.9), r('Gilead', 35.9, 32.3), r('Moab', 35.8, 31.3), r('Edom', 35.5, 30.3), r('Ammonitis', 36.2, 31.9), r('Hauran', 36.6, 32.8),
  r('Seleucis', 36.1, 35.9), r('Apamene', 36.6, 35.3), r('Chalybonitis', 37.3, 36.1), r('Cyrrhestice', 37.2, 36.7), r('Palmyrene', 38.5, 34.4), r('Osrhoene', 39.0, 37.1),
  r('Syrian Mesopotamia', 40.6, 36.6),
  // The Caucasus
  r('Caucasian Iberia', 44.4, 41.9), r('Albania', 47.6, 41.0), r('Caucasian Armenia', 44.6, 40.3),
  // Iran
  r('Atropatene', 46.5, 37.9), r('Carduchia', 45.3, 36.7), r('Matiane', 46.3, 35.0), r('Media', 48.5, 34.4), r('Rhagiana', 51.4, 35.6), r('Cadusia', 49.6, 37.1),
  r('Hyrcania', 54.5, 37.0), r('Tapuria', 52.5, 36.0), r('Parthia', 58.0, 37.3), r('Margiana', 60.6, 36.8), r('Aria', 61.0, 34.5), r('Paraetacene', 52.0, 33.0),
  r('Elymais', 49.6, 31.8), r('Susiana', 48.3, 31.7), r('Uxia', 50.3, 30.5), r('Persis', 53.0, 29.8), r('Carmania', 57.0, 29.5), r('Gedrosia', 61.0, 26.5),
  r('Drangiana', 61.0, 31.3), r('Choarene', 55.5, 35.5),
  // finer regions where the first table left a region too large to name well
  r('Mardia', 51.0, 32.0), r('Cossaea', 47.8, 33.7), r('Kambadene', 47.0, 34.6), r('Sagartia', 52.6, 31.2), r('Carmania Deserta', 57.6, 31.4), r('Nisaea', 56.8, 37.6),
  r('Astauene', 58.6, 37.5), r('Traxiane', 62.5, 35.7), r('Ichthyophagia', 58.0, 25.6), r('Oreitia', 61.8, 25.9), r('Parikania', 59.6, 27.3), r('Zarangia', 61.6, 30.4),
  r('Ayrarat', 44.6, 40.0), r('Gugark', 44.0, 41.1), r('Syunik', 46.1, 39.3), r('Vaspurakan', 43.1, 38.5), r('Gargarea', 47.0, 41.6), r('Utik', 46.6, 40.5),
  r('Caspiane', 48.9, 40.4), r('Mil Steppe', 47.9, 39.6), r('Kambysene', 45.6, 41.7), r('Moschice', 42.8, 41.6), r('Lazica', 41.7, 42.2), r('Suania', 42.6, 43.0),
  r('Tisia', 20.2, 46.3), r('Crisia', 21.8, 46.9), r('Upper Tisia', 21.3, 48.2), r('Bastarnia', 25.5, 48.2), r('Napoca', 23.6, 46.7), r('Sarmizegetusa', 22.8, 45.6),
  r('Carpathian Arc', 25.6, 45.7), r('Oltenia', 24.0, 44.8), r('Cotinia', 19.0, 49.6), r('Veneda', 21.0, 52.5), r('Aestia', 22.0, 55.0), r('Galindia', 21.5, 53.7), r('Borysthenia', 31.5, 50.3),
  r('Iol', 2.5, 36.5), r('Titteri', 3.0, 35.9), r('Massaesyli', 0.5, 35.2), r('Zab', 5.5, 35.0), r('Aures', 6.6, 35.3), r('Hodna', 4.5, 35.7), r('Nementcha', 7.6, 35.0),
  r('Sus', -9.0, 30.2), r('Sala', -6.5, 34.0), r('Baquatia', -5.4, 34.3), r('Atlas Maior', -5.0, 31.8), r('Draa', -6.0, 30.0), r('Malva', -3.0, 34.5),
  r('Mzab', 3.5, 32.5), r('Saoura', -1.5, 29.5), r('Tafilalt', -4.3, 31.3), r('Massyli', 7.5, 36.0), r('Cirtensis', 6.6, 36.4), r('Thusca', 8.3, 36.9),
  r('Sicca', 8.7, 36.2), r('Capsa', 8.7, 34.4), r('Nefzaoua', 8.5, 33.4), r('Hermaea', 10.8, 37.0), r('Byzacium', 10.6, 35.8), r('Leptitana', 14.2, 32.3),
  r('Nasamonia', 19.0, 29.8), r('Macae', 15.0, 31.6),
  r('Qasim', 43.5, 26.3), r('Sudair', 45.5, 25.8), r('Kharj', 47.3, 24.2), r('Tuwayq', 46.0, 22.5),
  r('Bracara', -8.4, 41.6), r('Lucensis', -7.6, 43.0), r('Artabria', -8.5, 43.2), r('Limicia', -7.7, 42.0), r('Bastulia', -5.0, 36.6), r('Mastiene', -1.0, 37.6),
  r('Vacomagia', -3.6, 57.2), r('Taexalia', -2.5, 57.3), r('Caerenia', -5.0, 58.3), r('Epidia', -5.7, 55.7),
  r('Tyanitis', 34.6, 37.8), r('Cataonia', 36.0, 38.2), r('Garsauritis', 33.9, 38.5), r('Melitene', 38.3, 38.4), r('Timonitis', 34.5, 41.3), r('Domanitis', 32.5, 40.6),
  r('Sinopis', 35.1, 41.9), r('Chaldia', 39.6, 40.6), r('Tolistobogia', 30.9, 39.5), r('Trocmia', 34.3, 39.8),
  r('Tarquinia', 11.8, 42.2), r('Volaterrae', 10.7, 43.4), r('Clusina', 11.9, 43.0), r('Falerii', 12.3, 42.3), r('Poseidonia', 15.0, 40.4), r('Siritis', 16.6, 40.3),
  r('Namnetia', -1.6, 47.3), r('Venetia Armoricana', -2.8, 47.7), r('Osismia', -4.3, 48.4), r('Coriosolitia', -2.2, 48.4), r('Redonia', -1.7, 48.1),
];
