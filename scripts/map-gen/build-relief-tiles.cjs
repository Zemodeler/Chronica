// Sharp shaded-relief tiles for the atlas (see scripts/map-gen/README.md, "Relief tiles").
//
// Reads the AWS Terrarium elevation tiles (z7, Web Mercator) and writes an equirectangular tile pyramid
// the client blits straight into its lon/lat world space (apps/web/app/games/[gameId]/components/relief-tiles.ts):
//
//   apps/web/public/maps/relief/tiles/{z}/{x}/{y}.webp   and   tiles.json
//
// Grid: world-aligned, 512 px tiles, z0 = 45 deg per tile ... z3 = 5.625 deg per tile (0.010986 deg/px, the native
// resolution of Terrarium z7: 1.2 km at the equator, 0.93 km wide at 40N). x = floor((lon + 180) / tileDeg),
// y = floor((90 - lat) / tileDeg).
//
// The image is neutral, for the client's tone pass (atlas-tone.ts): land keeps its regional colour from the
// Natural Earth II raster (blurred until its own relief shading is gone, land only) with a new hillshade from the
// elevation, peaks lightened; sea is blue with depth shading. The coast is the land polygons' (the game's own coverage
// and the Natural Earth 50m countries), the same outline the provinces were grown on, so relief and provinces register.
//
//   MAP_GEN_DATA=<dir holding data/terrarium/7 and coverage.geojson> node scripts/map-gen/build-relief-tiles.cjs [out=<dir>] [x0= x1= y0= y1=]
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATA = process.env.MAP_GEN_DATA || path.join(ROOT, '.map-gen-data');
process.chdir(DATA);
const fs = require('fs');
const dreq = require('module').createRequire(path.join(DATA, 'package.json'));
const sharp = (() => { try { return require('sharp'); } catch { return dreq('sharp'); } })();
const ARG = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const B = { x0: +(ARG.x0 ?? -25), x1: +(ARG.x1 ?? 66), y0: +(ARG.y0 ?? 14), y1: +(ARG.y1 ?? 62) };
const OUT = path.resolve(ARG.out || path.join(ROOT, 'apps/web/public/maps/relief'));
const NE2 = path.join(ROOT, 'apps/web/public/maps/natural-earth-ii-blue-oceans.png');
const COUNTRIES = path.join(ROOT, 'apps/web/public/maps/natural-earth-50m-admin0-countries.geojson');
const t0 = Date.now(); const lap = (m) => console.log(m, 't+' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

const TILE = 512, MAXZ = 3, ZOOMS = [0, 1, 2, 3];
const tileDeg = (z) => 45 / 2 ** z;
const D3 = tileDeg(MAXZ) / TILE;                       // degrees per pixel at the finest level
const TX0 = Math.floor((B.x0 + 180) / tileDeg(MAXZ)), TX1 = Math.floor((B.x1 + 180) / tileDeg(MAXZ));
const TY0 = Math.floor((90 - B.y1) / tileDeg(MAXZ)), TY1 = Math.floor((90 - B.y0) / tileDeg(MAXZ));
const W = (TX1 - TX0 + 1) * TILE, H = (TY1 - TY0 + 1) * TILE;
const LON0 = -180 + TX0 * tileDeg(MAXZ), LAT0 = 90 - TY0 * tileDeg(MAXZ);   // the mosaic's top-left corner

// ---- elevation: the Terrarium z7 mosaic
const Z = 7, N = 2 ** Z, WORLD_PX = N * 256;
const tx = (lon) => Math.floor((lon + 180) / 360 * N);
const ty = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N); };
const SX0 = tx(B.x0) - 1, SX1 = tx(B.x1) + 1, SY0 = ty(B.y1) - 1, SY1 = ty(B.y0) + 1;
const MW = (SX1 - SX0 + 1) * 256, MH = (SY1 - SY0 + 1) * 256;
async function loadElevation() {
  const mos = new Float32Array(MW * MH).fill(NaN);
  for (let X = SX0; X <= SX1; X++) for (let Y = SY0; Y <= SY1; Y++) {
    const f = `data/terrarium/${Z}/${X}/${Y}.png`;
    if (!fs.existsSync(f)) continue;
    const t = await sharp(f).removeAlpha().raw().toBuffer();
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const o = (j * 256 + i) * 3; mos[((Y - SY0) * 256 + j) * MW + (X - SX0) * 256 + i] = t[o] * 256 + t[o + 1] + t[o + 2] / 256 - 32768; }
  }
  return mos;
}
function resampleElevation(mos) {
  const out = new Float32Array(W * H);
  const colX = new Float64Array(W); for (let i = 0; i < W; i++) colX[i] = (((LON0 + (i + .5) * D3) + 180) / 360 * WORLD_PX) - SX0 * 256 - .5;
  for (let j = 0; j < H; j++) {
    const lat = (LAT0 - (j + .5) * D3) * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * WORLD_PX - SY0 * 256 - .5;
    const y0 = Math.max(0, Math.min(MH - 2, Math.floor(y))), fy = Math.min(1, Math.max(0, y - y0));
    for (let i = 0; i < W; i++) {
      const x = colX[i]; const x0 = Math.max(0, Math.min(MW - 2, Math.floor(x))), fx = Math.min(1, Math.max(0, x - x0));
      const a = mos[y0 * MW + x0], b = mos[y0 * MW + x0 + 1], c = mos[(y0 + 1) * MW + x0], d = mos[(y0 + 1) * MW + x0 + 1];
      out[j * W + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

// ---- land: the polygons the provinces were grown on, at full resolution
async function landMask() {
  const polys = [];
  const take = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  const near = (p) => p[0].some(([x, y]) => x >= B.x0 - 2 && x <= B.x1 + 2 && y >= B.y0 - 2 && y <= B.y1 + 2);
  for (const file of [path.join(DATA, 'coverage.geojson'), COUNTRIES]) {
    if (!fs.existsSync(file)) { console.log('missing', file); continue; }
    for (const f of JSON.parse(fs.readFileSync(file)).features) { if (!f.geometry) continue; for (const p of take(f.geometry)) if (near(p)) polys.push(p); }
  }
  const px = ([lon, lat]) => ((lon - LON0) / D3).toFixed(1) + ',' + ((LAT0 - lat) / D3).toFixed(1);
  const ring = (r) => 'M' + r.map(px).join('L') + 'Z';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#000"/>${polys.map((p) => `<path d="${p.map(ring).join('')}" fill="#fff" fill-rule="evenodd"/>`).join('')}</svg>`;
  return sharp(Buffer.from(svg), { density: 72 }).removeAlpha().greyscale().raw().toBuffer();
}
// Lakes (AWMC) are cut out, so Van, Urmia, Sevan and the Dead Sea are water as they are on the provinces' land raster.
async function cutLakes(mask) {
  let shp; try { shp = dreq('shapefile'); } catch { console.log('no shapefile module: lakes not cut'); return mask; }
  const dir = 'data/awmc/inland water'; if (!fs.existsSync(dir)) return mask;
  const s = await shp.open(path.join(dir, fs.readdirSync(dir).find((x) => x.endsWith('.shp'))));
  const px = ([lon, lat]) => ((lon - LON0) / D3).toFixed(1) + ',' + ((LAT0 - lat) / D3).toFixed(1);
  let inner = '';
  for (;;) {
    const r = await s.read(); if (r.done) break;
    if ((r.value.properties.TYPE || '').toLowerCase() !== 'lake') continue;
    const g = r.value.geometry; if (!g) continue;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of list) if (p[0].some(([x, y]) => x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1)) inner += `<path d="${p.map((q) => 'M' + q.map(px).join('L') + 'Z').join('')}" fill="#fff" fill-rule="evenodd"/>`;
  }
  if (!inner) return mask;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#000"/>${inner}</svg>`;
  const lakes = await sharp(Buffer.from(svg), { density: 72 }).removeAlpha().greyscale().raw().toBuffer();
  for (let i = 0; i < mask.length; i++) mask[i] = Math.max(0, mask[i] - lakes[i]);
  return mask;
}

// ---- regional colour: Natural Earth II, land only, blurred until its own relief shading is gone
async function regionalColour(mask) {
  const w = W / 4, h = H / 4;
  const ne = sharp(NE2).removeAlpha();
  const meta = await ne.metadata();
  const left = Math.floor((LON0 + 180) / 360 * meta.width), top = Math.floor((90 - LAT0) / 180 * meta.height);
  const width = Math.round(W * D3 / 360 * meta.width), height = Math.round(H * D3 / 180 * meta.height);
  const crop = await sharp(NE2).removeAlpha().extract({ left, top, width, height }).resize({ width: w, height: h, fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
  const small = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).resize({ width: w, height: h, kernel: 'linear' }).toColourspace('b-w').raw().toBuffer();
  const weight = Buffer.alloc(w * h), premult = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const r = crop[i * 3], g = crop[i * 3 + 1], b = crop[i * 3 + 2];
    const water = b >= g - 4 && b - r > 14;
    const wt = water ? 0 : small[i];
    weight[i] = wt; premult[i * 3] = r * wt / 255; premult[i * 3 + 1] = g * wt / 255; premult[i * 3 + 2] = b * wt / 255;
  }
  const SIGMA = 7;   // about 0.3 degrees
  const bw = await sharp(weight, { raw: { width: w, height: h, channels: 1 } }).blur(SIGMA).toColourspace('b-w').raw().toBuffer();
  const bp = await sharp(premult, { raw: { width: w, height: h, channels: 3 } }).blur(SIGMA).raw().toBuffer();
  if (small.length !== w * h || bw.length !== w * h) throw new Error('single-channel buffer has the wrong size');
  const flat = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const k = bw[i] > 2 ? 255 / bw[i] : 0;
    flat[i * 3] = k ? Math.min(255, bp[i * 3] * k) : 190; flat[i * 3 + 1] = k ? Math.min(255, bp[i * 3 + 1] * k) : 185; flat[i * 3 + 2] = k ? Math.min(255, bp[i * 3 + 2] * k) : 150;
  }
  // The blur of land-weighted colour reaches a few pixels past the coast: enlarge by bicubic to full size.
  return sharp(flat, { raw: { width: w, height: h, channels: 3 } }).resize({ width: W, height: H, kernel: 'cubic' }).raw().toBuffer();
}

// ---- shading
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function shadeMosaic(elev, mask, farLand, colour) {
  const rgba = Buffer.alloc(W * H * 4);
  const ZEN = (90 - 42) * Math.PI / 180, AZ = (360 - 315 + 90) * Math.PI / 180, ZF = 3.2;
  const SEA_SHALLOW = [150, 203, 232], SEA_DEEP = [58, 112, 165];
  for (let j = 0; j < H; j++) {
    const lat = LAT0 - (j + .5) * D3;
    const dx = D3 * 111320 * Math.cos(lat * Math.PI / 180), dy = D3 * 110574;
    const inLat = clamp(Math.min(lat - B.y0, B.y1 - lat), 0, 1);
    for (let i = 0; i < W; i++) {
      const p = j * W + i, o = p * 4;
      const lon = LON0 + (i + .5) * D3;
      const edge = Math.min(inLat, clamp(Math.min(lon - B.x0, B.x1 - lon), 0, 1));   // fade out over the last degree
      const e = elev[p];
      if (Number.isNaN(e)) { rgba[o + 3] = 0; continue; }
      let land = mask[p] / 255;
      if (land < 1 && farLand[p] && e >= 8) land = 1;                                // islands the polygons lack
      // sea, with depth
      const depth = clamp(-e / 3000, 0, 1);
      const sea = [SEA_SHALLOW[0] + (SEA_DEEP[0] - SEA_SHALLOW[0]) * depth, SEA_SHALLOW[1] + (SEA_DEEP[1] - SEA_SHALLOW[1]) * depth, SEA_SHALLOW[2] + (SEA_DEEP[2] - SEA_SHALLOW[2]) * depth];
      let r = sea[0], g = sea[1], b = sea[2];
      if (land > 0) {
        const eL = Math.max(e, 2);
        const w0 = elev[p - 1], w1 = elev[p + 1], n0 = elev[p - W], n1 = elev[p + W];
        const ok = i > 0 && i < W - 1 && j > 0 && j < H - 1 && !Number.isNaN(w0 + w1 + n0 + n1);
        let f = 1;
        if (ok) {
          const dzdx = (Math.max(w1, 2) - Math.max(w0, 2)) / (2 * dx), dzdy = (Math.max(n0, 2) - Math.max(n1, 2)) / (2 * dy);
          const slope = Math.atan(ZF * Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
          const shade = Math.cos(ZEN) * Math.cos(slope) + Math.sin(ZEN) * Math.sin(slope) * Math.cos(AZ - aspect);
          f = clamp(0.42 + 0.78 * shade, 0.3, 1.3);
        }
        // peaks lighten toward snow and bare rock
        const peak = clamp((eL - 1800) / 2600, 0, 1) * 0.45;
        const c = colour[p * 3], d = colour[p * 3 + 1], a = colour[p * 3 + 2];
        const lr = (c + (246 - c) * peak) * f, lg = (d + (244 - d) * peak) * f, lb = (a + (238 - a) * peak) * f;
        r = sea[0] + (lr - sea[0]) * land; g = sea[1] + (lg - sea[1]) * land; b = sea[2] + (lb - sea[2]) * land;
      }
      rgba[o] = clamp(r, 0, 255); rgba[o + 1] = clamp(g, 0, 255); rgba[o + 2] = clamp(b, 0, 255); rgba[o + 3] = Math.round(255 * edge);
    }
  }
  return rgba;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('mosaic', W, 'x', H, 'tiles', TX0, TX1, TY0, TY1);
  const elev = resampleElevation(await loadElevation()); lap('elevation');
  let mask = await landMask(); lap('land');
  mask = await cutLakes(mask); lap('lakes');
  // The polygons follow a 1 km lattice; a light blur and a steep ramp take the staircase out of the coast and keep it crisp.
  {
    const soft = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).blur(1.6).toColourspace('b-w').raw().toBuffer();
    if (soft.length !== W * H) throw new Error('mask blur is not single channel');
    for (let i = 0; i < mask.length; i++) { const t = clamp((soft[i] / 255 - .3) / .4, 0, 1); mask[i] = Math.round(255 * t * t * (3 - 2 * t)); }
  }
  // land far from any polygon's edge, to tell an island the polygons lack from a fringe of the coast
  const near = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).blur(4).toColourspace('b-w').raw().toBuffer();
  if (near.length !== W * H) throw new Error('mask blur is not single channel');
  const farLand = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) farLand[i] = near[i] < 3 ? 1 : 0;
  const colour = await regionalColour(mask); lap('colour');
  const rgba = shadeMosaic(elev, mask, farLand, colour); lap('shade');
  const levels = [];
  fs.rmSync(path.join(OUT, 'tiles'), { recursive: true, force: true });
  let total = 0, count = 0;
  for (const z of ZOOMS) {
    const f = 2 ** (MAXZ - z);                              // finest pixels per this level's pixel
    const lw = W / f, lh = H / f;
    let img = sharp(rgba, { raw: { width: W, height: H, channels: 4 } });
    if (f > 1) img = img.resize({ width: lw, height: lh, kernel: 'lanczos3' });
    // Lay the mosaic on this level's own grid (a coarser tile can start half way along the finest mosaic).
    const startX = TX0 * TILE / f, startY = TY0 * TILE / f;
    const gx0 = Math.floor(startX / TILE), gy0 = Math.floor(startY / TILE);
    const padL = startX - gx0 * TILE, padT = startY - gy0 * TILE;
    const cols = Math.ceil((padL + lw) / TILE), rows = Math.ceil((padT + lh) / TILE);
    const buf = await img.extend({ top: padT, left: padL, bottom: rows * TILE - padT - lh, right: cols * TILE - padL - lw, background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer();
    let written = 0;
    for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < cols; rx++) {
      const tile = await sharp(buf, { raw: { width: cols * TILE, height: rows * TILE, channels: 4 } }).extract({ left: rx * TILE, top: ry * TILE, width: TILE, height: TILE }).raw().toBuffer();
      let any = false; for (let i = 3; i < tile.length; i += 4) if (tile[i] > 0) { any = true; break; }
      if (!any) continue;
      const file = path.join(OUT, 'tiles', String(z), String(gx0 + rx), `${gy0 + ry}.webp`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const bytes = await sharp(tile, { raw: { width: TILE, height: TILE, channels: 4 } }).webp({ quality: 80, alphaQuality: 80 }).toBuffer();
      fs.writeFileSync(file, bytes); total += bytes.length; count++; written++;
    }
    levels.push({ zoom: z, tileDegrees: tileDeg(z), degreesPerPixel: tileDeg(z) / TILE, tileBounds: [gx0, gy0, gx0 + cols - 1, gy0 + rows - 1], tileCount: written });
    lap(`z${z}: ${written} tiles`);
  }
  fs.writeFileSync(path.join(OUT, 'tiles.json'), JSON.stringify({
    name: 'Shaded relief of Europe, North Africa and the Near East',
    format: 'webp', scheme: 'xyz', projection: 'Equirectangular (EPSG:4326), world-aligned: x = floor((lon + 180) / tileDegrees), y = floor((90 - lat) / tileDegrees)',
    bounds: [B.x0, B.y0, B.x1, B.y1], minZoom: ZOOMS[0], maxZoom: MAXZ, tileSize: TILE, levels,
    attribution: 'Elevation: AWS Open Data Terrain Tiles (SRTM, GMTED, ETOPO1 and others). Colour: Natural Earth II. Coast: Natural Earth 50m.',
  }, null, 2));
  console.log('tiles', count, 'MB', (total / 1e6).toFixed(1));
})();
