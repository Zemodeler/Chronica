// Validates scripts/map-gen/zagros-polities.json, prints a coarse coverage map, and checks it against the other five polity files.
//   node scripts/map-gen/check-zagros-polities.cjs
// Plain Node, no dependencies. Exits 1 on any error; warnings do not fail.
// Cloned from check-iraq-polities.cjs. Differences: the polity has no capital and no settlements (none is attested),
// its rings are meant to overlap the Seleucid default (that is the point: they are tested before it), and so
// (a) any overlap with a NON-Seleucid polity ring of another file is reported, at 1 degree and at 0.05 degree,
// (b) no settlement of any other file may lie inside a ring, Seleucid capitals and cities above all.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const SELF = "zagros-polities.json";
const data = JSON.parse(fs.readFileSync(path.join(__dirname, SELF), "utf8"));
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const LON = [41, 53], LAT = [29, 39];
const area = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; };
const inRing = (x, y, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length - 1; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPolity = (p, x, y) => p.territory.some((r) => inRing(x, y, r));
const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const segCross = (a, b, c, d) => orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b) && orient(a, b, c) !== 0 && orient(a, b, d) !== 0 && orient(c, d, a) !== 0 && orient(c, d, b) !== 0;

// Repo sources, for the "does this id already exist" test; the polity files themselves are the plan, not the repo.
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", "test-results", ".git", "docs"]);
const files = [];
const otherPlans = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (["apps", "packages", "scripts"].includes(path.relative(root, dir).split(path.sep)[0]) || dir === root) walk(full); }
    else if (/-polities\.json$/.test(e.name) && path.basename(dir) === "map-gen") { if (e.name !== SELF) otherPlans.push(full); }
    else if (/^ownership-corrections.*\.json$/.test(e.name)) { /* corrections name polity ids but do not define them */ }
    else if (/\.(ts|tsx|mts|cjs|mjs|js|json)$/.test(e.name) && !/^check-.*-polities\.cjs$/.test(e.name)) files.push(full);
  }
})(root);
const corpus = files.map((f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } });
const idInRepo = (id) => corpus.some((t) => t.includes(`"${id}"`) || t.includes(`${id}:`) || t.includes(`'${id}'`));
const others = otherPlans.map((f) => ({ name: path.basename(f), raw: JSON.parse(fs.readFileSync(f, "utf8")) }));
others.forEach((o) => { o.polities = o.raw.polities; });
const plannedElsewhere = new Map();
for (const o of others) for (const q of o.polities) plannedElsewhere.set(q.id, o.name);

const seen = new Set();
const FORMS = new Set(["monarchy", "oligarchic_republic", "popular_republic", "tribal_confederation", "soldier_commune", "league", "temple_state"]);

for (const p of data.polities) {
  const tag = p.id;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) err(`${tag}: id not kebab-case`);
  if (seen.has(p.id)) err(`${tag}: duplicate id`);
  seen.add(p.id);
  if (!FORMS.has(p.governmentForm)) err(`${tag}: bad governmentForm ${p.governmentForm}`);
  if (p.cohesionBps !== null && !(Number.isInteger(p.cohesionBps) && p.cohesionBps >= 0 && p.cohesionBps <= 10000)) err(`${tag}: bad cohesionBps`);
  if (p.cohesionBps === null && !p.reuseExisting) err(`${tag}: null cohesion on a new polity`);
  if (!p.territory || !p.territory.length) err(`${tag}: no territory`);
  if (!p.notes) warn(`${tag}: no notes`);
  if (p.reuseExisting) err(`${tag}: this file defines only new polities`);
  if (idInRepo(p.id)) err(`${tag}: marked new but id already appears in repo sources`);
  if (plannedElsewhere.has(p.id)) err(`${tag}: also defined in ${plannedElsewhere.get(p.id)}`);
  if (p.ruler) err(`${tag}: a ruler was not intended`);
  if (p.capital !== null) err(`${tag}: capital must be null (no seat is attested)`);
  if ((p.otherSettlements || []).length > 0) warn(`${tag}: settlements listed; none was meant to be`);

  (p.territory || []).forEach((r, k) => {
    const rt = `${tag}[${k}]`;
    if (r.length < 5) err(`${rt}: too few vertices`);
    if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) err(`${rt}: not closed`);
    if (area(r) <= 0) err(`${rt}: not counter-clockwise`);
    if (r.length - 1 < 15) warn(`${rt}: ${r.length - 1} vertices (<15)`);
    if (r.length - 1 > 40) warn(`${rt}: ${r.length - 1} vertices (>40)`);
    for (const [x, y] of r) if (x < LON[0] || x > LON[1] || y < LAT[0] || y > LAT[1]) err(`${rt}: vertex ${x},${y} outside the region`);
    const n = r.length - 1;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segCross(r[i], r[i + 1], r[j], r[j + 1])) err(`${rt}: edges ${i} and ${j} cross`);
    }
  });
}

const mine = data.polities[0];
// (b) no settlement of any other file inside a ring
const pins = [];
for (const o of others) {
  for (const q of o.polities) for (const s of [q.capital, ...(q.otherSettlements || [])]) if (s && s.lon !== undefined) pins.push({ file: o.name, polity: q.id, s });
  for (const s of o.raw.seleucidCities || []) pins.push({ file: o.name, polity: "seleucid-empire", s });
}
for (const { file, polity, s } of pins) if (inPolity(mine, s.lon, s.lat)) err(`${s.name} (${polity}, ${file}) lies inside a ring of ${mine.id}`);
// The Seleucid places this polity must keep, by name, in case a file gives them under another polity.
const KEEP = [["Susa", 48.2, 32.2], ["Ecbatana", 48.5, 34.8], ["Laodicea in Media", 48.3, 34.1], ["Arbela", 44.0, 36.2], ["Kirkuk", 44.4, 35.5], ["Nineveh", 43.15, 36.36], ["Nippur", 45.2, 32.1], ["Babylon", 44.4, 32.5], ["Seleucia on the Tigris", 44.5, 33.1], ["Gabae", 51.7, 32.65], ["Persepolis", 52.9, 29.9], ["Bisitun", 47.43, 34.39]];
for (const [name, x, y] of KEEP) if (inPolity(mine, x, y)) err(`${name} (${x},${y}) lies inside a ring of ${mine.id}`);

// (a) fine overlap with non-Seleucid polities of the other files
const fine = new Map();
let cells = 0;
for (let x = LON[0]; x < LON[1]; x += 0.05) for (let y = LAT[0]; y < LAT[1]; y += 0.05) {
  if (!inPolity(mine, x, y)) continue;
  cells++;
  for (const o of others) for (const q of o.polities) if (q.id !== "seleucid-empire" && inPolity(q, x, y)) fine.set(`${q.id} (${o.name})`, (fine.get(`${q.id} (${o.name})`) || 0) + 1);
}
for (const [k, n] of fine) (n / cells > 0.01 ? err : warn)(`ring cells also inside ${k}: ${n} of ${cells} (${((100 * n) / cells).toFixed(1)}%)`);

const letters = new Map([[mine.id, "Z"]]);
const overlapPairs = new Map();
let seleucidCells = 0;
console.log("Coverage (1 deg cells, centre point). Z = this file only; S = this file over the Seleucid default (intended); '#' = also a DIFFERENT non-Seleucid polity; '+' = only another file; '.' = unclaimed");
let head = "";
for (let lon = LON[0]; lon < LON[1]; lon++) head += String(lon % 10);
console.log("       lon " + head + "   (" + LON[0] + ".." + LON[1] + "; cell = lon+0.5)");
for (let lat = LAT[1] - 1; lat >= LAT[0]; lat--) {
  let row = "";
  for (let lon = LON[0]; lon < LON[1]; lon++) {
    const x = lon + 0.5, y = lat + 0.5;
    const inMine = inPolity(mine, x, y);
    let other = null;
    let seleucid = false;
    for (const o of others) for (const q of o.polities) if (inPolity(q, x, y)) { if (q.id === "seleucid-empire") seleucid = true; else if (!other) other = q; }
    if (inMine && other) { row += "#"; const k = `${mine.id} vs ${other.id}`; overlapPairs.set(k, (overlapPairs.get(k) || 0) + 1); }
    else if (inMine && seleucid) { row += "S"; seleucidCells++; }
    else if (inMine) row += "Z";
    else if (other || seleucid) row += "+";
    else row += ".";
  }
  console.log(`lat ${String(lat).padStart(2)}.5  ${row}`);
}
console.log(`Legend: Z=${mine.id}`);
if (overlapPairs.size) console.log("\nOverlap cells with other files' non-Seleucid polities:\n" + [...overlapPairs].map(([k, n]) => `  ${k}: ${n}`).join("\n"));
if (warnings.length) console.log("\nWarnings:\n - " + warnings.join("\n - "));
if (errors.length) { console.error("\nErrors:\n - " + errors.join("\n - ")); process.exit(1); }
console.log(`\nOK: ${data.polities.length} polity, ${mine.territory.length} rings, ${seleucidCells} coarse cells over the Seleucid default, ${pins.length} settlements of other files checked.`);
