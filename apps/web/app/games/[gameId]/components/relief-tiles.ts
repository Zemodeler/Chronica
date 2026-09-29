/**
 * The sharp relief under the map: an equirectangular tile pyramid
 * (scripts/map-gen/build-relief-tiles.cjs, public/maps/relief/tiles.json) drawn
 * straight into the canvas's lon/lat world space, so no re-projection happens
 * at draw time and a tile is one drawImage.
 *
 * Tiles are 512 px; z0 is 45 degrees to a tile and each level halves it, so a
 * tile's place is `x = floor((lon + 180) / tileDegrees)`, `y = floor((90 - lat) /
 * tileDegrees)`. Only the tiles in view are fetched, each toned like the base
 * raster (tone-client.ts) before it is kept. Under them the whole-world base
 * raster always shows, so a tile still on its way leaves the old picture, not a
 * hole; over a tile not yet here its coarser ancestor is stretched.
 */
export interface ReliefLevel { readonly zoom: number; readonly tileDegrees: number; readonly tileBounds: readonly [number, number, number, number]; }
export interface ReliefManifest { readonly tileSize: number; readonly minZoom: number; readonly maxZoom: number; readonly levels: readonly ReliefLevel[]; }
export interface TileKey { readonly z: number; readonly x: number; readonly y: number; }
/** A rectangle in longitude/latitude. */
export interface LonLatRect { readonly west: number; readonly east: number; readonly south: number; readonly north: number; }

/** Pixels of the source per degree at zoom `z`. */
export function reliefPixelsPerDegree(manifest: Pick<ReliefManifest, "tileSize">, level: Pick<ReliefLevel, "tileDegrees">): number {
  return manifest.tileSize / level.tileDegrees;
}

/**
 * The coarsest level that still has about a pixel of source for every device
 * pixel (allowing a slight stretch), or the finest there is.
 */
export function reliefZoomFor(manifest: ReliefManifest, devicePixelsPerDegree: number): number {
  for (const level of [...manifest.levels].sort((a, b) => a.zoom - b.zoom)) {
    if (reliefPixelsPerDegree(manifest, level) >= devicePixelsPerDegree * .85) return level.zoom;
  }
  return manifest.maxZoom;
}

/** The tiles of `level` that meet `rect`, nearest the middle of it first. */
export function reliefTilesFor(level: ReliefLevel, rect: LonLatRect): TileKey[] {
  const [minX, minY, maxX, maxY] = level.tileBounds;
  const deg = level.tileDegrees;
  const x0 = Math.max(minX, Math.floor((rect.west + 180) / deg));
  const x1 = Math.min(maxX, Math.floor((rect.east + 180) / deg));
  const y0 = Math.max(minY, Math.floor((90 - rect.north) / deg));
  const y1 = Math.min(maxY, Math.floor((90 - rect.south) / deg));
  const cx = ((rect.west + rect.east) / 2 + 180) / deg - .5;
  const cy = (90 - (rect.south + rect.north) / 2) / deg - .5;
  const tiles: TileKey[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z: level.zoom, x, y });
  return tiles.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
}

const key = (tile: TileKey) => `${tile.z}/${tile.x}/${tile.y}`;
const MAX_KEPT_TILES = 72;
const MAX_LOADING = 6;

type Toner = (raw: ImageBitmap) => Promise<ImageBitmap | null>;

export class ReliefLayer {
  private manifest: ReliefManifest | null = null;
  private readonly tiles = new Map<string, { bitmap: ImageBitmap | null; failed: boolean; used: number }>();
  private readonly loading = new Set<string>();
  private queue: TileKey[] = [];
  private wanted = new Set<string>();
  private frame = 0;
  private disposed = false;

  constructor(private readonly baseUrl: string, private readonly tone: Toner, private readonly onReady: () => void) {
    void fetch(`${baseUrl}/tiles.json`).then((response) => (response.ok ? response.json() : null)).then((json: ReliefManifest | null) => {
      if (this.disposed || json === null) return;
      this.manifest = json;
      this.onReady();
    }).catch(() => { /* no relief: the base raster stands alone */ });
  }

  dispose(): void {
    this.disposed = true;
    for (const tile of this.tiles.values()) tile.bitmap?.close();
    this.tiles.clear();
    this.queue = [];
  }

  /**
   * Draws the tiles for `visible` (projected world space: x = longitude, y =
   * -latitude) onto a context already transformed to that space.
   * `devicePixelsPerDegree` is how many device pixels one degree covers.
   */
  draw(ctx: CanvasRenderingContext2D, visible: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }, devicePixelsPerDegree: number): void {
    const manifest = this.manifest;
    if (manifest === null || this.disposed) return;
    this.frame++;
    const rect: LonLatRect = { west: visible.minX, east: visible.maxX, south: -visible.maxY, north: -visible.minY };
    const zoom = reliefZoomFor(manifest, devicePixelsPerDegree);
    const level = manifest.levels.find((candidate) => candidate.zoom === zoom);
    if (level === undefined) return;
    const wanted = reliefTilesFor(level, rect);
    this.wanted = new Set(wanted.map(key));
    // A pixel of overlap on the right and below keeps the seam between two tiles from showing.
    const bleed = 1 / devicePixelsPerDegree;
    for (const tile of wanted) {
      const entry = this.tiles.get(key(tile));
      if (entry?.bitmap) {
        entry.used = this.frame;
        const deg = level.tileDegrees;
        ctx.drawImage(entry.bitmap, -180 + tile.x * deg, -(90 - tile.y * deg), deg + bleed, deg + bleed);
        continue;
      }
      if (entry === undefined) { this.tiles.set(key(tile), { bitmap: null, failed: false, used: this.frame }); this.queue.push(tile); }
      else if (!entry.failed) entry.used = this.frame;
      this.drawAncestor(ctx, manifest, tile, bleed);
    }
    this.pump(manifest);
    this.evict();
  }

  /** Stretches the nearest coarser tile already here over `tile`'s place. */
  private drawAncestor(ctx: CanvasRenderingContext2D, manifest: ReliefManifest, tile: TileKey, bleed: number): void {
    for (let up = 1; up <= tile.z - manifest.minZoom; up++) {
      const z = tile.z - up;
      const ax = tile.x >> up;
      const ay = tile.y >> up;
      const ancestor = this.tiles.get(key({ z, x: ax, y: ay }));
      if (!ancestor?.bitmap) continue;
      ancestor.used = this.frame;
      const share = manifest.tileSize / 2 ** up;
      const sx = (tile.x - (ax << up)) * share;
      const sy = (tile.y - (ay << up)) * share;
      const deg = manifest.levels.find((level) => level.zoom === tile.z)!.tileDegrees;
      ctx.drawImage(ancestor.bitmap, sx, sy, share, share, -180 + tile.x * deg, -(90 - tile.y * deg), deg + bleed, deg + bleed);
      return;
    }
  }

  /** Starts as many of the wanted tiles as may load at once; a tile no longer in view is not fetched. */
  private pump(manifest: ReliefManifest): void {
    while (this.loading.size < MAX_LOADING && this.queue.length > 0) {
      const tile = this.queue.shift()!;
      if (!this.wanted.has(key(tile))) { this.tiles.delete(key(tile)); continue; }
      this.loading.add(key(tile));
      void this.load(manifest, tile);
    }
  }

  private async load(manifest: ReliefManifest, tile: TileKey): Promise<void> {
    const id = key(tile);
    const entry = this.tiles.get(id);
    try {
      const response = await fetch(`${this.baseUrl}/tiles/${id}.webp`);
      if (!response.ok) throw new Error(String(response.status));
      const raw = await createImageBitmap(await response.blob());
      const toned = await this.tone(raw);
      if (toned === null) throw new Error("not toned");
      if (this.disposed || entry === undefined || this.tiles.get(id) !== entry) { toned.close(); return; }
      entry.bitmap = toned;
    } catch {
      if (entry !== undefined) entry.failed = true;
    } finally {
      this.loading.delete(id);
      if (!this.disposed) { this.onReady(); this.pump(manifest); }
    }
  }

  /** Keeps memory bounded: the tiles least recently drawn go first, never one drawn this frame. */
  private evict(): void {
    if (this.tiles.size <= MAX_KEPT_TILES) return;
    const idle = [...this.tiles].filter(([, tile]) => tile.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [id, tile] of idle) {
      if (this.tiles.size <= MAX_KEPT_TILES) break;
      if (this.loading.has(id)) continue;
      tile.bitmap?.close();
      this.tiles.delete(id);
    }
  }
}
