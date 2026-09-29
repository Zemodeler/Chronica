// Ancient regions (coarse) and the rules that turn Pleiades titles into province names a Roman-era player can read.
import type { Point } from './map-geometry';
import { haversineKm, ringContains } from './map-geometry';

const box = (x0: number, x1: number, y0: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export interface Region {
  readonly key: string;
  /** Two to four letters; the prefix of every province id inside it. */
  readonly slug: string;
  /** How a player reads it after "in": "Heraclea in Thrace". */
  readonly name: string;
  readonly shapes: readonly (readonly Point[])[];
}

// First match wins, so an island or a narrow region comes before the wide one around it.
export const REGIONS: readonly Region[] = [
  { key: 'sicily', slug: 'sic', name: 'Sicily', shapes: [box(12.2, 15.62, 36.5, 38.4), box(14.0, 14.7, 35.7, 36.2)] },
  { key: 'sardinia', slug: 'sard', name: 'Sardinia', shapes: [box(8.0, 9.9, 38.8, 41.35)] },
  { key: 'corsica', slug: 'cor', name: 'Corsica', shapes: [box(8.5, 9.6, 41.3, 43.1)] },
  { key: 'balearics', slug: 'bal', name: 'the Balearic Isles', shapes: [box(1.1, 4.5, 38.5, 40.2)] },
  { key: 'crete', slug: 'cre', name: 'Crete', shapes: [box(23.4, 26.4, 34.8, 35.75)] },
  { key: 'cyprus', slug: 'cyp', name: 'Cyprus', shapes: [box(32, 34.8, 34.5, 35.8)] },
  { key: 'ireland', slug: 'hib', name: 'Ireland', shapes: [[[-10.8, 51.3], [-6.0, 51.3], [-5.3, 52.5], [-5.3, 54.5], [-5.9, 55.6], [-10.8, 55.6]]] },
  { key: 'britain', slug: 'bri', name: 'Britain', shapes: [[[-8, 49.9], [1.5, 49.9], [1.5, 52], [1.8, 52], [1.8, 59], [-8, 59]]] },
  { key: 'turdetania', slug: 'tur', name: 'Turdetania', shapes: [box(-8.9, -1.6, 35.9, 38.6)] },
  { key: 'lusitania', slug: 'lus', name: 'Lusitania', shapes: [box(-10, -6.8, 38.6, 42.4)] },
  { key: 'iberia', slug: 'ibe', name: 'Iberia', shapes: [[[-10, 35.9], [3.6, 35.9], [3.6, 42.4], [1.5, 42.6], [-1.8, 43.3], [-2.0, 43.9], [-10, 44]]] },
  { key: 'alps', slug: 'alp', name: 'the Alps', shapes: [box(5.8, 14.2, 45.6, 47.9)] },
  { key: 'cisalpine', slug: 'cis', name: 'Cisalpine Gaul', shapes: [box(6.6, 13.6, 44.0, 46.0)] },
  { key: 'illyria', slug: 'ill', name: 'Illyria', shapes: [[[13.3, 46.3], [20.5, 46.3], [20.5, 42.0], [19.5, 41.2], [18.4, 41.5], [16.5, 42.4], [14.8, 43.9], [13.6, 44.9]]] },
  { key: 'italy', slug: 'it', name: 'Italy', shapes: [box(7, 19, 37.8, 44.6)] },
  { key: 'pannonia', slug: 'pan', name: 'Pannonia', shapes: [box(15.5, 23, 45, 48.6)] },
  { key: 'gaul', slug: 'gal', name: 'Gaul', shapes: [[[-5.2, 42.3], [8.0, 42.3], [8.0, 47.3], [7.3, 49.5], [6.5, 51.5], [7.2, 53.8], [-5.2, 53.8]]] },
  { key: 'germania', slug: 'ger', name: 'Germania', shapes: [box(5.5, 25, 47.3, 56)] },
  { key: 'dacia', slug: 'dac', name: 'Dacia', shapes: [box(20, 30, 43.6, 49)] },
  { key: 'moesia', slug: 'moe', name: 'Moesia', shapes: [box(20, 29, 42.0, 44.2)] },
  { key: 'thrace', slug: 'thr', name: 'Thrace', shapes: [box(22.5, 29.5, 40.3, 43)] },
  { key: 'macedonia', slug: 'mac', name: 'Macedonia', shapes: [box(20.5, 24.5, 39.8, 42)] },
  { key: 'epirus', slug: 'epi', name: 'Epirus', shapes: [box(19, 21.3, 38.9, 40.9)] },
  { key: 'greece', slug: 'gre', name: 'Greece', shapes: [box(19, 24.6, 36.2, 39.9)] },
  { key: 'ionia', slug: 'ion', name: 'Ionia and the Aegean', shapes: [box(24.6, 29, 35.6, 39.6)] },
  { key: 'colchis', slug: 'col', name: 'Colchis', shapes: [box(39.8, 46, 41, 43.5)] },
  { key: 'armenia', slug: 'arm', name: 'Armenia', shapes: [box(38.8, 47, 37, 42.5)] },
  { key: 'bithynia', slug: 'bit', name: 'Bithynia', shapes: [box(26.5, 32.6, 39.9, 41.4)] },
  { key: 'paphlagonia', slug: 'pap', name: 'Paphlagonia', shapes: [box(32.6, 36, 40.9, 42.3)] },
  { key: 'pontus', slug: 'pon', name: 'Pontus', shapes: [box(36, 41.8, 39.8, 41.9)] },
  { key: 'galatia', slug: 'gala', name: 'Galatia', shapes: [box(30.6, 35.2, 38.9, 40.9)] },
  { key: 'phrygia', slug: 'phr', name: 'Phrygia', shapes: [box(28.6, 31.4, 37.5, 39.9)] },
  { key: 'lycia', slug: 'lyc', name: 'Lycia and Pamphylia', shapes: [box(28.2, 32.6, 36.0, 37.6)] },
  { key: 'cilicia', slug: 'cil', name: 'Cilicia', shapes: [box(32.6, 37.4, 36.0, 37.4)] },
  { key: 'cappadocia', slug: 'cap', name: 'Cappadocia', shapes: [box(33.5, 38.8, 37.2, 39.9)] },
  { key: 'anatolia', slug: 'ana', name: 'Asia Minor', shapes: [box(26, 45, 36, 42.5)] },
  { key: 'syria', slug: 'syr', name: 'Syria', shapes: [box(35, 42.5, 32.9, 37.3)] },
  { key: 'judaea', slug: 'jud', name: 'Judaea', shapes: [box(34, 36.3, 29.4, 33.0)] },
  { key: 'egypt', slug: 'egy', name: 'Egypt', shapes: [box(24.9, 35.0, 22, 32)] },
  { key: 'cyrenaica', slug: 'cyr', name: 'Cyrenaica', shapes: [box(19, 25, 29.5, 33.3)] },
  { key: 'mauretania', slug: 'mau', name: 'Mauretania', shapes: [box(-10, -1.5, 28, 37)] },
  { key: 'numidia', slug: 'num', name: 'Numidia', shapes: [box(-1.5, 8.3, 32.5, 37.3)] },
  { key: 'africa', slug: 'afr', name: 'Africa', shapes: [box(8.3, 12.5, 31.5, 37.6)] },
  { key: 'tripolitania', slug: 'tri', name: 'Tripolitania', shapes: [box(9, 19.5, 28, 33.6)] },
  { key: 'gaetulia', slug: 'gae', name: 'Gaetulia', shapes: [box(-1.5, 12.5, 26, 32.5)] },
  { key: 'garamantia', slug: 'gar', name: 'Garamantia', shapes: [box(9, 20, 23, 30)] },
  { key: 'scythia', slug: 'scy', name: 'Scythia', shapes: [box(28, 40, 44, 48)] },
  { key: 'sarmatia', slug: 'sarm', name: 'Sarmatia', shapes: [box(23, 46, 48, 59)] },
  // the eastern theatres, after every box the shipped provinces were named by, so no earlier id moves
  { key: 'iran', slug: 'irn', name: 'Iran', shapes: [box(44, 64, 24.5, 40)] },
  { key: 'caucasus', slug: 'cau', name: 'the Caucasus', shapes: [box(39.5, 51.5, 38.4, 44.5)] },
  { key: 'levant', slug: 'lev', name: 'the Levant', shapes: [box(34, 43, 29, 37.8)] },
  { key: 'arabia', slug: 'ara', name: 'Arabia', shapes: [box(33, 57, 15.5, 33)] },
];

function shapeDistance(shape: readonly Point[], lon: number, lat: number): number {
  if (ringContains(shape, lon, lat)) return 0;
  let best = Infinity;
  for (const vertex of shape) best = Math.min(best, haversineKm([lon, lat], vertex));
  return best;
}

export function regionOf(lon: number, lat: number): Region {
  for (const region of REGIONS) if (region.shapes.some((shape) => ringContains(shape, lon, lat))) return region;
  let best = REGIONS[0]!;
  let bestDistance = Infinity;
  for (const region of REGIONS) {
    const distance = Math.min(...region.shapes.map((shape) => shapeDistance(shape, lon, lat)));
    if (distance < bestDistance) { bestDistance = distance; best = region; }
  }
  return best;
}

const MODERN_WORD = /\b(tell|tel|khirbet|khirbat|ain|bir|qasr|jebel|djebel|oued|wadi|nahr|kafr|deir|beni|sidi|monte|monti|santa|santo|san|sao|castel|castello|castro|villa|cerro|pico|cueva|los|las|el|al|ben|ras|hisn|tepe|hoyuk|kale|koy|yeni|eski|buyuk|kucuk|near|place|site|unnamed|unknown|modern|hill|mount|cape|bay|lake|river|island|port|fort|castle|church|monastery|tumulus|necropolis|cemetery|sanctuary|temple|mine|quarry|farm|camp|bridge|road|aqueduct|cave|grotto|spring|well|cistern|pass|gate|wall|tower|barrow|hillfort|oppidum|settlement|city|town|village|de|del|della|di|von|van|le|la|les|du|des|da|do|dos|das|untitled|praefectura|regio|regionis|provincia|dioecesis|nomos|eparchy|kastron|kastro)\b/i;
const MODERN_START = /^(valea|dealul|dealu|movila|cetatea|cetate|piatra|magura|hradiste|gradiste|castro|castel|castell|acqua|acque|monte|villa|borgo|torre|ponte|porto|campo|casal|cala|san|santa|santo|saint|st|bad|neu|alt|klein|gross|new|old|upper|lower)/i;
const MODERN_END = /(berg|burg|stein|dorf|heim|hausen|kirchen|stadt|skaya|skiy|evo|ovo|abad|kale|koy|hisar|dag|feld|bach|tepe|ello|etta|ella|ano|ino|ini|ani|eni)$/i;
const LATIN_GREEK_END = /(a|ae|um|us|is|on|os|ion|ium|ia|ai|es|ii|i|o|e|as|ys|ax|ex|ix|ene|ous|oi|er|ur)$/i;
// north of the Alps only the Latin and Greek endings are trusted: -e, -er, -i and -o there are mostly Dutch, German and Czech
const NORTH_END = /(a|ae|um|us|is|on|os|ion|ium|ia|ai|es|ii|as|ys|ax|ex|ix|ous|oi)$/i;
const NOT_ANCIENT = /(ij|ck|sch|tz|dt|kk|stad|wijk|veen|dijk|ovice|ingen|wald|holz|hout|vaart)|^(ober|unter|nieder|hoch|beau|saint)/i;
const SECOND_WORDS = /^(Minor|Major|Magna|Parva|Superior|Inferior|Nova|Vetus|Nea|Palaia)$/i;

/** The ancient name in a Pleiades title, or null when the title carries only a modern or descriptive one. */
export function ancientNameOf(title: string | null, lat = 40): string | null {
  if (!title) return null;
  const alternatives = title
    .split('/')
    .map((a) => a.replace(/\([^)]*\)/g, ' ').replace(/^\s*\(?[A-Z]\)\s*/, '').replace(/^\*+/, '').replace(/\?+$/, '').replace(/\s+/g, ' ').trim())
    .filter((a) => a.length > 0);
  for (const alternative of alternatives) {
    const name = alternative.replace(/^(Col\.?|Colonia|Municipium)\s+/, '').trim();
    if (!/^[A-Za-z][A-Za-z ]*$/.test(name) || name.length < 4) continue;
    const words = name.split(' ');
    if (words.length > 2) continue;
    if (words.some((w) => !/^[A-Z]/.test(w))) continue;
    if (MODERN_WORD.test(name) || MODERN_START.test(name)) continue;
    if (words.length === 2 && !SECOND_WORDS.test(words[1]!) && !(LATIN_GREEK_END.test(words[0]!) && LATIN_GREEK_END.test(words[1]!))) continue;
    if (!(lat >= 47 ? NORTH_END : LATIN_GREEK_END).test(words[words.length - 1]!)) continue;
    if (NOT_ANCIENT.test(name) || words.some((w) => MODERN_AUDIT.test(w))) continue;
    if (words.some((w) => MODERN_END.test(w) && !/(ia|ium|eia)$/i.test(w))) continue;
    return name;
  }
  return null;
}

export type Compass = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';
const COMPASS: readonly Compass[] = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];

/** Which way `to` lies from `from`. */
export function compassOf(from: Point, to: Point): Compass {
  const dx = (to[0] - from[0]) * Math.cos(((from[1] + to[1]) / 2) * (Math.PI / 180));
  const dy = to[1] - from[1];
  const angle = Math.atan2(dy, dx);
  return COMPASS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8]!;
}

export const ADJECTIVE: Readonly<Record<Compass, string>> = {
  north: 'Northern', 'north-east': 'North-eastern', east: 'Eastern', 'south-east': 'South-eastern',
  south: 'Southern', 'south-west': 'South-western', west: 'Western', 'north-west': 'North-western',
};

/** What no Roman-era name contains: English, German and Slavic place-name endings and prefixes, letters Latin and Greek did not use. */
export const MODERN_AUDIT = /villa|(ville|burg|burgh|ton|ham|ford|wick|bury|ley|by|stadt|heim|dorf|berg|stein|ovo|evo|skiy|sky|grad|gorod|dam|bach|kirchen|sz|cz|zs|ij|tj)$|^(saint|mount|monte|san|santa|st)\b|[wj]|[^a-z ]/i;

/** Names of peoples, regions, rivers, mountains and capes: the ending is no test (Cherusci, Rhenus, Albis differ), only a modern look is. */
export function featureNameOf(title: string | null): string | null {
  if (!title) return null;
  for (const alternative of title.split('/')) {
    const name = alternative.replace(/\([^)]*\)/g, ' ').replace(/^\*+/, '').replace(/\?+$/, '').replace(/\s+/g, ' ').trim();
    if (!/^[A-Za-z][A-Za-z ]*$/.test(name) || name.length < 4) continue;
    const words = name.split(' ');
    if (words.length > 2 || words.some((w) => !/^[A-Z]/.test(w))) continue;
    if (MODERN_WORD.test(name) || MODERN_START.test(name) || NOT_ANCIENT.test(name) || words.some((w) => MODERN_AUDIT.test(w))) continue;
    return name;
  }
  return null;
}
