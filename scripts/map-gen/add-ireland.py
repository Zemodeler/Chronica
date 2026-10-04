"""Extend the shipped map without regenerating or renumbering the rest of it.

Install requirements.txt into .cache/map-gen-python, then run from any directory.
Run after build-map-graph and before add-polity-cities / describe-map-asset.
"""
import hashlib
import json
import math
from pathlib import Path
import random
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.cache/map-gen-python'))
from shapely import make_valid, normalize, set_precision, voronoi_polygons
from shapely.affinity import scale
from shapely.geometry import MultiPoint, Point, Polygon, MultiPolygon, mapping, shape
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

HERE = Path(__file__).resolve().parent
GRAPH = ROOT / 'packages/db/src/punic-wars-map-graph.ts'
MAP = ROOT / 'apps/web/public/maps/punic-wars-provinces.geojson'
TAG = 'ireland-extension-v1'
XKM = 111.2 * math.cos(math.radians(53.5))
YKM = 111.2
GRID = 0.00001
compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
spec = json.loads((HERE / 'ireland-polities.json').read_text(encoding='utf-8'))
graph = GRAPH.read_text(encoding='utf-8')
atlas = json.loads(MAP.read_text(encoding='utf-8'))


def rows(name):
    body = re.search(r'export const ' + name + r'[^=]*= \[([\s\S]*?)\];', graph).group(1)
    return [json.loads(line.strip().rstrip(',')) for line in body.splitlines() if line.strip().startswith('{')]


old_added = {f['id'] for f in atlas['features'] if f['properties'].get('generation') == TAG}
site_ids = {s['id'] for s in spec['settlements']}
atlas['features'] = [f for f in atlas['features'] if f['id'] not in old_added | site_ids]
provinces = [p for p in rows('PUNIC_WARS_GRAPH_PROVINCES') if p['id'] not in old_added]
edges = [e for e in rows('PUNIC_WARS_GRAPH_EDGES') if e['from'] not in old_added and e['to'] not in old_added]
polities = rows('PUNIC_WARS_GRAPH_POLITIES')
cities = [s for s in rows('PUNIC_WARS_GRAPH_SETTLEMENTS') if s['id'] not in site_ids]
features = {f['id']: f for f in atlas['features']}
old_irish = [p for p in provinces if p['id'].startswith('hib-')]
old_shapes = [set_precision(make_valid(shape(features[p['id']]['geometry'])), GRID) for p in old_irish]
countries = json.loads((ROOT / 'apps/web/public/maps/natural-earth-50m-admin0-countries.geojson').read_text(encoding='utf-8'))
republic = shape(next(f['geometry'] for f in countries['features'] if f['properties']['ADMIN'] == 'Ireland'))
uk = shape(next(f['geometry'] for f in countries['features'] if f['properties']['ADMIN'] == 'United Kingdom'))
northern = next(p for p in uk.geoms if p.contains(Point(-6.7, 54.35)))
# Administrative outlines provide the coastline only. Their shared border is dissolved.
land = set_precision(unary_union([republic, northern]), GRID)
missing = land.difference(unary_union(old_shapes))
project = lambda g: scale(g, xfact=XKM, yfact=YKM, origin=(0, 0))
unproject = lambda g: scale(g, xfact=1 / XKM, yfact=1 / YKM, origin=(0, 0))
missing_km = project(missing)
rng = random.Random(270)
seeds = [Point(s['longitude'] * XKM, s['latitude'] * YKM) for s in spec['settlements']]
minx, miny, maxx, maxy = missing_km.bounds
y = miny + 12
while y < maxy:
    x = minx + 12
    while x < maxx:
        point = Point(x + rng.uniform(-8, 8), y + rng.uniform(-8, 8))
        if missing_km.contains(point) and all(point.distance(p) > 18 for p in seeds):
            seeds.append(point)
        x += 32
    y += 32

cells = voronoi_polygons(MultiPoint(seeds), extend_to=missing_km.envelope, ordered=True)
pieces = []
for seed, cell in zip(seeds, cells.geoms):
    clipped = set_precision(unproject(cell).intersection(missing), GRID)
    parts = [clipped] if clipped.geom_type == 'Polygon' else list(clipped.geoms)
    for part in parts:
        if part.geom_type == 'Polygon' and not part.is_empty and project(part).area > 0.01:
            pieces.append((seed, part))
# Small coastal pieces join the closest substantial district. No coastline is discarded.
large = [(seed, part) for seed, part in pieces if project(part).area >= 100]
for seed, part in pieces:
    if project(part).area >= 100:
        continue
    nearest = min(range(len(large)), key=lambda i: project(part).distance(project(large[i][1])))
    target_seed, target = large[nearest]
    large[nearest] = (target_seed, unary_union([target, part]))

new = []
new_shapes = []
new_features = []
for seed, district in large:
    centre = district.representative_point()
    digest = int(hashlib.sha256(f'{seed.x:.6f},{seed.y:.6f},{centre.x:.5f},{centre.y:.5f}'.encode()).hexdigest()[:8], 16) % (36 ** 5)
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    suffix = ''
    for _ in range(5):
        suffix = digits[digest % 36] + suffix
        digest //= 36
    province_id = 'hib-' + suffix
    inside = district.representative_point()
    contained_sites = [s for s in spec['settlements'] if district.covers(Point(s['longitude'], s['latitude']))]
    if contained_sites:
        polity = next(p for p in spec['polities'] if p['polityId'] == contained_sites[0]['polityId'])
    else:
        polity = min(spec['polities'], key=lambda p: min(((inside.x - lon) * XKM) ** 2 + ((inside.y - lat) * YKM) ** 2 for lon, lat in p['anchors']))
    coast = district.boundary.intersection(land.boundary).length > 0.0001
    terrain = 'coastal-plain' if coast else 'hills'
    number = 1 + sum(p['controllerPolityId'] == polity['polityId'] for p in new)
    name = f"{polity['region']} {'coast' if coast else 'interior'} {number}"
    if contained_sites:
        name = f"District of {contained_sites[0]['name']}"
    province = dict(id=province_id, name=name, terrainId=terrain, controllerPolityId=polity['polityId'], controlFirmnessBps=5000,
                    areaKm2=max(1, round(project(district).area)), geo=dict(latitude=round(inside.y, 5), longitude=round(inside.x, 5)),
                    formerNames=[s['name'] for s in contained_sites])
    new.append(province)
    new_shapes.append(district)
    new_features.append(dict(type='Feature', id=province_id, geometry=mapping(district), properties=dict(kind='province', name=name, terrain=terrain,
                            regionId=polity['region'].lower().replace(' ', '-'), generation=TAG)))

# Node the entire Irish boundary network together: the renderer requires the
# same vertices on both sides, including junctions with the existing Ulster arcs.
all_provinces = old_irish + new
all_shapes = old_shapes + new_shapes
tree = STRtree(all_shapes)
faces_by_id = {p['id']: [] for p in all_provinces}
network = unary_union([g.boundary for g in all_shapes])
for face in polygonize(network):
    point = face.representative_point()
    matches = tree.query(point, predicate='within')
    if len(matches):
        faces_by_id[all_provinces[int(matches[0])]['id']].append(face)
all_shapes = [normalize(set_precision(unary_union(faces_by_id[p['id']]), GRID)) for p in all_provinces]
features.update({f['id']: f for f in new_features})
for province, geometry in zip(all_provinces, all_shapes):
    features[province['id']]['geometry'] = mapping(geometry)
if any(g.is_empty or not g.is_valid for g in all_shapes):
    raise ValueError('Invalid or empty Irish province')
if project(missing.difference(unary_union(all_shapes))).area > 0.1:
    raise ValueError('Ireland coverage has gaps')
if len({p['id'] for p in provinces + new}) != len(provinces + new):
    raise ValueError('Province id collision')

def distance(a, b):
    return max(1, round(math.hypot((a['geo']['longitude'] - b['geo']['longitude']) * XKM,
                                  (a['geo']['latitude'] - b['geo']['latitude']) * YKM)))


def add_edge(a, b, crossing):
    first, second = sorted([a['id'], b['id']])
    if not any(e['from'] == first and e['to'] == second for e in edges):
        edges.append(dict(from_=first, to=second, crossing=crossing, distance=distance(a, b)))
        edges[-1]['from'] = edges[-1].pop('from_')


# Build adjacency from the exact emitted segments, also checking shared topology.
segment_owners = {}
for province, geometry in zip(all_provinces, all_shapes):
    parts = [geometry] if geometry.geom_type == 'Polygon' else geometry.geoms
    for part in parts:
        for ring in [part.exterior, *part.interiors]:
            coordinates = list(ring.coords)
            for a, b in zip(coordinates, coordinates[1:]):
                key = tuple(sorted([a, b]))
                segment_owners.setdefault(key, set()).add(province['id'])
by_id = {p['id']: p for p in all_provinces}
new_ids = {p['id'] for p in new}
for owners in segment_owners.values():
    if len(owners) > 2:
        raise ValueError('More than two provinces share a boundary')
    if len(owners) == 2 and owners & new_ids:
        a, b = list(owners)
        add_edge(by_id[a], by_id[b], 'land')
# Join any disconnected island/sliver component by a water crossing; never
# let a geometric near miss silently leave a playable province unreachable.
connected = {p['id'] for p in old_irish}
while True:
    previous = len(connected)
    for edge in edges:
        if edge['from'] in connected and edge['to'] in by_id:
            connected.add(edge['to'])
        if edge['to'] in connected and edge['from'] in by_id:
            connected.add(edge['from'])
    if len(connected) == len(by_id):
        break
    if len(connected) != previous:
        continue
    a, b = min(((by_id[a], p) for a in connected for p in new if p['id'] not in connected), key=lambda pair: distance(*pair))
    ga, gb = all_shapes[all_provinces.index(a)], all_shapes[all_provinces.index(b)]
    gap_km = project(ga).distance(project(gb))
    crossing = 'land' if gap_km < 1 else 'strait' if gap_km <= 80 else 'sea_lane'
    if crossing != 'land':
        a['terrainId'] = b['terrainId'] = 'coastal-plain'
        features[a['id']]['properties']['terrain'] = features[b['id']]['properties']['terrain'] = 'coastal-plain'
    add_edge(a, b, crossing)

for polity in spec['polities']:
    if not polity.get('existing') and not any(p['polityId'] == polity['polityId'] for p in polities):
        polities.append({key: polity[key] for key in ['polityId', 'name', 'capitalSettlementId']})
for site in spec['settlements']:
    index = next(i for i, g in enumerate(all_shapes) if g.covers(Point(site['longitude'], site['latitude'])))
    home = all_provinces[index]
    if home['controllerPolityId'] != site['polityId']:
        raise ValueError(f"City {site['name']} is outside its polity")
    cities.append(dict(id=site['id'], name=site['name'], kind='city', provinceId=home['id'], controllerPolityId=site['polityId'], size=6, fortificationLevel=1))
    atlas['features'].append(dict(type='Feature', id=site['id'], geometry=dict(type='Point', coordinates=[site['longitude'], site['latitude']]),
                                  properties=dict(kind='settlement', name=site['name'], provinceId=home['id'], type='city', historicalBasis=site['basis'])))

for name, values in [('PUNIC_WARS_GRAPH_PROVINCES', provinces + new), ('PUNIC_WARS_GRAPH_EDGES', edges),
                     ('PUNIC_WARS_GRAPH_POLITIES', polities), ('PUNIC_WARS_GRAPH_SETTLEMENTS', cities)]:
    key = (lambda p: (p['from'], p['to'])) if name.endswith('EDGES') else (lambda p: p.get('id', p.get('polityId')))
    rendered = '[\n' + '\n'.join('  ' + compact(row) + ',' for row in sorted(values, key=key)) + '\n];'
    graph = re.sub(r'(export const ' + name + r'[^=]*= )\[[\s\S]*?\];', lambda m: m.group(1) + rendered, graph)
graph = re.sub(r'Provinces: \d+\. Borders: \d+\. Polities: \d+\. Settlements: \d+\.',
               f'Provinces: {len(provinces + new)}. Borders: {len(edges)}. Polities: {len(polities)}. Settlements: {len(cities)}.', graph)
for polity in spec['polities']:
    if polity.get('existing'):
        continue
    pattern = r'  "' + re.escape(polity['polityId']) + r'": \{[\s\S]*?\},?\n'
    graph = re.sub(pattern, '', graph)
    graph = graph.replace('export const POLITY_META: Readonly<Record<string, { readonly cohesionBps: number | null; readonly governmentForm: string }>> = {',
                          'export const POLITY_META: Readonly<Record<string, { readonly cohesionBps: number | null; readonly governmentForm: string }>> = {\n'
                          + '  ' + compact(polity['polityId']) + ': ' + compact(dict(cohesionBps=3500, governmentForm='tribal_confederation')) + ',')
atlas['features'].extend(new_features)
research_path = HERE / 'city-research.json'
research = json.loads(research_path.read_text(encoding='utf-8'))
research['settlements'] = [s for s in research['settlements'] if s['id'] not in site_ids] + spec['settlements']
research['sources'] = list(dict.fromkeys(research['sources'] + [s['source'] for s in spec['settlements']]))
GRAPH.write_text(graph, encoding='utf-8', newline='\n')
MAP.write_text('{"type":"FeatureCollection","features":[\n' + ',\n'.join(compact(f) for f in atlas['features']) + '\n]}\n', encoding='utf-8', newline='\n')
research_path.write_text(json.dumps(research, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
(HERE / 'ireland-extension.json').write_text(json.dumps({'provinceIds': sorted(new_ids)}, indent=2) + '\n', encoding='utf-8', newline='\n')
print(f'Added {len(new)} Irish provinces, 4 polities, and {len(spec["settlements"])} city markers; retained {len(old_irish)} existing provinces.')
