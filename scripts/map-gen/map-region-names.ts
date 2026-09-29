// Province names as regions, not places: every province belongs to a named Roman-era region, and is told apart from the
// others in it by what it really has (a river, a mountain, a people, a coast, a quarter of the compass) -- never by a town,
// a number, or a distance.
import { haversineKm, type Point } from './map-geometry';
import { ADJECTIVE, compassOf, type Compass } from './map-names';
import { REGION_ANCHORS } from './map-regions';

export interface Feature { kind: string; name: string; lon: number; lat: number }

export interface NameInput {
  readonly ids: readonly string[];
  readonly centre: readonly Point[];
  /** Which stretch of land each province stands on; islands differ from the mainland. */
  readonly landmass: readonly number[];
  readonly terrain: readonly string[];
  readonly coast: readonly boolean[];
  readonly coastKm: readonly number[];
  readonly elevMean: readonly number[];
  readonly riverFrac: readonly number[];
  readonly features: readonly Feature[];
}

export interface NameResult {
  readonly names: string[];
  readonly kinds: string[];
  readonly regionNames: string[];
  readonly regionIds: string[];
  readonly regionCounts: Map<string, number>;
  readonly splits: { region: string; provinces: number; districts: string[] }[];
}

export const kebab = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TERRAIN_NOUN = (terrain: string, elev: number, riverFrac: number): string => {
  if (terrain === 'coastal-plain') return 'Coast';
  if (terrain === 'desert-steppe') return 'Steppe';
  if (terrain === 'hills-uplands') return elev > 1100 ? 'Highlands' : 'Uplands';
  return riverFrac > 0.09 ? 'Vale' : 'Hills';
};

function kmeans(points: readonly Point[], k: number): number[] {
  const centres: Point[] = [points[0]!];
  while (centres.length < k) {
    let far = 0, farD = -1;
    points.forEach((p, i) => { const d = Math.min(...centres.map((c) => haversineKm(p, c))); if (d > farD) { farD = d; far = i; } });
    centres.push(points[far]!);
  }
  let label = points.map(() => 0);
  for (let round = 0; round < 12; round++) {
    label = points.map((p) => { let b = 0, bd = Infinity; centres.forEach((c, j) => { const d = haversineKm(p, c); if (d < bd) { bd = d; b = j; } }); return b; });
    for (let j = 0; j < k; j++) {
      const m = points.filter((_, i) => label[i] === j);
      if (m.length) centres[j] = [m.reduce((s, p) => s + p[0], 0) / m.length, m.reduce((s, p) => s + p[1], 0) / m.length];
    }
  }
  return label;
}

export function nameProvinces(input: NameInput): NameResult {
  const N = input.ids.length;
  const centre = input.centre;
  const regionNames: string[] = new Array(N).fill('');

  // ---- which region each province lies in
  const anchorLand = REGION_ANCHORS.map((a) => {
    let best = -1, bestKm = 60;
    for (let i = 0; i < N; i++) { const d = haversineKm([a.lon, a.lat], centre[i]!); if (d < bestKm) { bestKm = d; best = i; } }
    return best < 0 ? -1 : input.landmass[best]!;
  });
  for (let i = 0; i < N; i++) {
    const same = REGION_ANCHORS.map((_, a) => a).filter((a) => anchorLand[a] === input.landmass[i]);
    const pool = same.length > 0 ? same : REGION_ANCHORS.map((_, a) => a);
    let best = pool[0]!, bestScore = Infinity;
    for (const a of pool) {
      const anchor = REGION_ANCHORS[a]!;
      const score = haversineKm([anchor.lon, anchor.lat], centre[i]!) / (anchor.weight ?? 1);
      if (score < bestScore) { bestScore = score; best = a; }
    }
    regionNames[i] = REGION_ANCHORS[best]!.name;
  }
  const members = new Map<string, number[]>();
  regionNames.forEach((r, i) => (members.get(r) ?? members.set(r, []).get(r)!).push(i));

  // ---- features by degree cell
  const grid = new Map<string, Feature[]>();
  for (const f of input.features) (grid.get(`${Math.floor(f.lon)},${Math.floor(f.lat)}`) ?? grid.set(`${Math.floor(f.lon)},${Math.floor(f.lat)}`, []).get(`${Math.floor(f.lon)},${Math.floor(f.lat)}`)!).push(f);
  const nearest = (i: number, kinds: string[], maxKm: number): Feature | null => {
    const [lon, lat] = centre[i]!;
    let best: Feature | null = null, bestD = maxKm;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const f of grid.get(`${Math.floor(lon) + dx},${Math.floor(lat) + dy}`) ?? []) {
      if (!kinds.includes(f.kind)) continue;
      const d = haversineKm([lon, lat], [f.lon, f.lat]);
      if (d < bestD || (d === bestD && best && f.name < best.name)) { bestD = d; best = f; }
    }
    return best;
  };

  const taken = new Set<string>();
  const names: string[] = new Array(N).fill('');
  const kinds: string[] = new Array(N).fill('');
  const splits: NameResult['splits'] = [];
  const regionCounts = new Map<string, number>([...members].map(([r, m]) => [r, m.length]));
  const claim = (i: number, name: string, kind: string): boolean => {
    if (taken.has(name.toLowerCase())) return false;
    taken.add(name.toLowerCase());
    names[i] = name;
    kinds[i] = kind;
    return true;
  };
  const meanOf = (m: readonly number[]): Point => [m.reduce((s, i) => s + centre[i]![0], 0) / m.length, m.reduce((s, i) => s + centre[i]![1], 0) / m.length];
  const PREFIX = ['Further', 'Outer', 'Inner', 'Upper', 'Lower', 'Border', 'Remote', 'Farther'];

  // ---- a unit is a region, or a named part of a big one; it names its provinces
  // `plain` is true when the unit's own name already carries a compass word, so its parts are told apart without one.
  const nameUnit = (head: string, m: readonly number[], plain: boolean): void => {
    if (m.length === 1 && claim(m[0]!, head, 'region')) return;
    const mid = meanOf(m);
    const spread = Math.max(1, ...m.map((i) => haversineKm(mid, centre[i]!)));
    const coastalOrder = [...m].filter((i) => input.coast[i]).sort((a, b) => input.coastKm[b]! - input.coastKm[a]!);
    const uplandOrder = [...m].sort((a, b) => input.elevMean[b]! - input.elevMean[a]!);
    const sorted = [...m].sort((a, b) => input.ids[a]!.localeCompare(input.ids[b]!));
    const done = new Set<number>();
    const character = (i: number): string => (input.coast[i] ? 'coastal' : input.elevMean[i]! > 600 ? 'upland' : 'lowland');
    const direction = (i: number): string => ADJECTIVE[compassOf(mid, centre[i]!) as Compass];
    const noun = (i: number): string => TERRAIN_NOUN(input.terrain[i]!, input.elevMean[i]!, input.riverFrac[i]!);
    // 1. what each has of its own: a river, a mountain, a people; the same one may name several, told apart by the ground or the quarter
    const own = (i: number): { kind: string; forms: string[] }[] => {
      const out: { kind: string; forms: string[] }[] = [];
      const river = input.riverFrac[i]! >= 0.03 ? nearest(i, ['river'], 20) : null;
      if (river) out.push({ kind: 'river', forms: [`${head} on the ${river.name}`, ...(plain ? [] : [`${direction(i)} ${head} on the ${river.name}`])] });
      const mountain = input.elevMean[i]! >= 450 ? nearest(i, ['mountain'], 30) : null;
      if (mountain) { const bare = mountain.name.replace(/^(Mons|Montes|Mount)\s+/, ''); out.push({ kind: 'mountain', forms: [`${head} beneath Mons ${bare}`, ...(plain ? [] : [`${direction(i)} ${head} beneath Mons ${bare}`])] }); }
      const people = nearest(i, ['people'], 55);
      if (people) out.push({ kind: 'people', forms: [`${noun(i)} of the ${people.name}`, `${direction(i)} ${noun(i).toLowerCase()} of the ${people.name}`, `Further ${direction(i).toLowerCase()} ${noun(i).toLowerCase()} of the ${people.name}`] });
      const lake = nearest(i, ['lake'], 25);
      if (lake) out.push({ kind: 'lake', forms: [`${head} by Lake ${lake.name.replace(/^(Lacus|Lake)\s+/, '')}`] });
      return out;
    };
    for (const pass of [0, 1, 2]) {
      for (const i of sorted) {
        if (done.has(i)) continue;
        for (const o of own(i)) {
          const form = o.forms[pass];
          if (form !== undefined && claim(i, form, o.kind)) { done.add(i); break; }
        }
      }
    }
    // 2. the shore and the heights
    if (coastalOrder.length && !done.has(coastalOrder[0]!) && claim(coastalOrder[0]!, `Coastal ${head}`, 'coast')) done.add(coastalOrder[0]!);
    if (m.length > 3 && !done.has(uplandOrder[0]!) && input.elevMean[uplandOrder[0]!]! > 500 && claim(uplandOrder[0]!, `Upland ${head}`, 'upland')) done.add(uplandOrder[0]!);
    // 3. the rest by quarter of the compass (or, in a part already named for one, by the lie of the ground), then with a prefix
    for (const i of sorted) {
      if (done.has(i)) continue;
      const central = haversineKm(mid, centre[i]!) < 0.22 * spread;
      const heading = plain ? '' : central ? 'Central' : direction(i);
      const ch = character(i);
      const bare = (words: string[]): string => words.filter(Boolean).join(' ');
      const options = plain ? [`${ch[0]!.toUpperCase()}${ch.slice(1)} ${head}`] : [bare([heading, head]), bare([heading, ch, head])];
      for (const pre of PREFIX) options.push(bare([pre, heading.toLowerCase(), plain ? ch : '', head]).replace(/^(\w)/, (c) => c.toUpperCase()), bare([pre, heading.toLowerCase(), ch, head]));
      for (const pre of ['Middle', 'Hither', 'Outlying']) options.push(bare([pre, plain ? '' : heading.toLowerCase(), ch, head]));
      if (plain) for (const pre of ['', ...PREFIX]) options.push(bare([pre, direction(i).toLowerCase(), 'reaches of', head]).replace(/^(\w)/, (c) => c.toUpperCase()), bare([pre, direction(i).toLowerCase(), ch, 'reaches of', head]).replace(/^(\w)/, (c) => c.toUpperCase()));
      const kind = plain ? 'ground' : central ? 'central' : 'compass';
      for (let k = 0; k < options.length; k++) if (claim(i, options[k]!, k === 0 ? kind : 'compound')) { done.add(i); break; }
      if (!done.has(i)) throw new Error(`cannot name ${input.ids[i]} in ${head}`);
    }
  };

  for (const [region, m] of [...members].sort(([a], [b]) => a.localeCompare(b))) {
    if (m.length <= 26) { nameUnit(region, m, false); continue; }
    // a big region is split into named districts first: by the people or river at its heart, else by quarter
    const k = Math.ceil(m.length / 13);
    const label = kmeans(m.map((i) => centre[i]!), k);
    const mid = meanOf(m);
    const reach = Math.max(...m.map((i) => haversineKm(mid, centre[i]!)));
    const districts: string[] = [];
    const seen = new Set<string>();
    const parts = Array.from({ length: k }, (_, j) => m.filter((_, idx) => label[idx] === j)).filter((p) => p.length > 0);
    for (const part of parts) {
      const c = meanOf(part);
      // the feature nearest the district's heart that is not already the name of another
      const heart = [...part].sort((a, b) => haversineKm(c, centre[a]!) - haversineKm(c, centre[b]!))[0]!;
      const feature = ['people', 'river', 'mountain'].map((kind) => nearest(heart, [kind], kind === 'people' ? 60 : 40)).find((f) => f && !seen.has(f.name));
      let head: string;
      let plain: boolean;
      if (feature) {
        seen.add(feature.name);
        head = feature.kind === 'people' ? `${region} of the ${feature.name}` : feature.kind === 'river' ? `${region} on the ${feature.name}` : `${region} beneath Mons ${feature.name.replace(/^(Mons|Montes|Mount)\s+/, '')}`;
        plain = false;
      } else {
        const dir = haversineKm(mid, c) < 0.15 * reach ? 'Central' : ADJECTIVE[compassOf(mid, c) as Compass];
        let n = 0;
        let candidate = `${dir} ${region}`;
        while (taken.has(candidate.toLowerCase()) || districts.includes(candidate)) { candidate = `${PREFIX[n % PREFIX.length]!} ${dir.toLowerCase()} ${region}`; n++; if (n > 40) break; }
        head = candidate;
        plain = true;
      }
      districts.push(head);
      nameUnit(head, part, plain);
    }
    splits.push({ region, provinces: m.length, districts });
  }
  return { names, kinds, regionNames, regionIds: regionNames.map(kebab), regionCounts, splits };
}
