// Validates scripts/map-gen/egypt-arabia-polities.json and prints a coarse coverage map.
//   node scripts/map-gen/check-egypt-arabia-polities.cjs
// Plain Node, no dependencies. Exits 1 on any error; warnings do not fail.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "egypt-arabia-polities.json"), "utf8"));
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const LON = [24, 57], LAT = [15, 33];
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

// Repo sources, for the "does this id already exist" test. The map-gen polity files themselves are
// excluded (they are the plan, not the repo); a clash between two of them is reported separately.
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", "test-results", ".git", "docs"]);
const files = [];
const otherPlans = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (["apps", "packages", "scripts"].includes(path.relative(root, dir).split(path.sep)[0]) || dir === root) walk(full); }
    else if (/-polities\.json$/.test(e.name) && path.basename(dir) === "map-gen") { if (e.name !== "egypt-arabia-polities.json") otherPlans.push(full); }
    else if (/\.(ts|tsx|mts|cjs|mjs|js|json)$/.test(e.name) && !/^check-.*-polities\.cjs$/.test(e.name)) files.push(full);
  }
})(root);
const corpus = files.map((f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } });
const idInRepo = (id) => corpus.some((t) => t.includes(`"${id}"`) || t.includes(`${id}:`) || t.includes(`'${id}'`));
const plannedElsewhere = new Map();
for (const f of otherPlans) {
  try { for (const q of JSON.parse(fs.readFileSync(f, "utf8")).polities) plannedElsewhere.set(q.id, path.basename(f)); } catch { /* ignore */ }
}

const seen = new Set();
const KINDS = new Set(["city", "town", "fortress", "port", "village"]);
const FORMS = new Set(["monarchy", "oligarchic_republic", "popular_republic", "tribal_confederation", "soldier_commune", "league", "temple_state"]);
const settlementIds = new Set();

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
  const exists = idInRepo(p.id);
  if (p.reuseExisting && !exists) err(`${tag}: reuseExisting but id not found in repo sources`);
  if (!p.reuseExisting && exists) err(`${tag}: marked new but id already appears in repo sources`);
  if (plannedElsewhere.has(p.id) && !p.reuseExisting) err(`${tag}: also defined in ${plannedElsewhere.get(p.id)}`);
  if (plannedElsewhere.has(p.id) && p.reuseExisting) warn(`${tag}: also defined in ${plannedElsewhere.get(p.id)} (expected: merge)`);
  if (p.ruler && !["high", "medium", "low"].includes(p.ruler.confidence)) err(`${tag}: ruler confidence`);

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

  const all = [];
  if (p.capital) all.push({ ...p.capital, cap: true });
  (p.otherSettlements || []).forEach((s) => all.push(s));
  if ((p.otherSettlements || []).length < 3 || (p.otherSettlements || []).length > 8) warn(`${tag}: ${(p.otherSettlements || []).length} other settlements (wanted 3-8)`);
  for (const s of all) {
    if (!KINDS.has(s.kind)) err(`${tag}/${s.settlementId}: bad kind`);
    if (settlementIds.has(s.settlementId) && s.settlementId !== "settlement-alexandria") err(`${tag}/${s.settlementId}: duplicate settlement id`);
    settlementIds.add(s.settlementId);
    if (!Number.isInteger(s.size) || !Number.isInteger(s.fortificationLevel)) err(`${tag}/${s.settlementId}: size/fortification must be ints`);
  }
  if (!p.capital) err(`${tag}: no capital`);
  else {
    if (p.capital.offMap) err(`${tag}: capital.offMap must not be set (Alexandria is on the map)`);
    if (!inPolity(p, p.capital.lon, p.capital.lat)) err(`${tag}: capital ${p.capital.name} lies outside its own territory`);
    else {
      const holder = data.polities.find((q) => inPolity(q, p.capital.lon, p.capital.lat));
      if (holder && holder.id !== p.id) err(`${tag}: capital ${p.capital.name} would be won by ${holder.id} (earlier in the list)`);
    }
  }
  for (const s of p.otherSettlements || []) {
    if (!inPolity(p, s.lon, s.lat)) warn(`${tag}: ${s.name} lies outside its own polygon`);
    else {
      const holder = data.polities.find((q) => inPolity(q, s.lon, s.lat));
      if (holder && holder.id !== p.id) warn(`${tag}: ${s.name} would be won by ${holder.id} (earlier in the list)`);
    }
  }
}

// Coverage map: 1 degree cells, first match at the cell centre.
const LETTER = { "ptolemaic-egypt": "P", kush: "K", nabataeans: "N", qedar: "Q", lihyan: "L", "hejaz-tribes": "H", "najd-tribes": "D", minaeans: "M", saba: "S", hadramawt: "R", gerrha: "G" };
const letters = new Map();
const used = new Set(Object.values(LETTER));
for (const p of data.polities) {
  let ch = LETTER[p.id];
  if (!ch) { ch = p.id[0].toLowerCase(); while (used.has(ch)) ch = String.fromCharCode(ch.charCodeAt(0) + 1); used.add(ch); }
  letters.set(p.id, ch);
}
console.log("Coverage (1 deg cells, centre point; first listed polity wins; '.' = unclaimed)");
let head = "";
for (let lon = LON[0]; lon < LON[1]; lon++) head += String(lon % 10);
console.log("       lon " + head + "   (" + LON[0] + ".." + LON[1] + "; cell = lon+0.5)");
for (let lat = LAT[1] - 1; lat >= LAT[0]; lat--) {
  let row = "";
  for (let lon = LON[0]; lon < LON[1]; lon++) {
    const p = data.polities.find((q) => inPolity(q, lon + 0.5, lat + 0.5));
    row += p ? letters.get(p.id) : ".";
  }
  console.log(`lat ${String(lat).padStart(2)}.5  ${row}`);
}
console.log("Legend: " + data.polities.map((p) => `${letters.get(p.id)}=${p.id}${p.reuseExisting ? "*" : ""}`).join("  ") + "   (* = existing id)");
if (warnings.length) console.log("\nWarnings:\n - " + warnings.join("\n - "));
if (errors.length) { console.error("\nErrors:\n - " + errors.join("\n - ")); process.exit(1); }
console.log(`\nOK: ${data.polities.length} polities, ${settlementIds.size} settlements.`);
